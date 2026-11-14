import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { EMIScheduleGenerator } from "./EMIScheduleGenerator";
import { LoanKind, LoanPaymentStatus, type Loan, type LoanPaymentSchedule } from "../types";
import type { InterestRateHistoryEntry } from "../types/InterestRateHistory";
import {
    InterestRateChangeService,
    currentRateEntry,
    isDetailsOnlyCorrection,
    prepareRateChange,
    rateChangeMode,
    validateRateChangeInput,
    type RateChangeContext,
    type RateChangeInput,
} from "./InterestRateChangeService";

// ---------------------------------------------------------------------
// Synthetic Term Loan: 1,20,000 at 12% from 10/01/2026, 12 instalments due
// on the 10th from 10/02/2026, the first three paid. No real data.
// ---------------------------------------------------------------------

function loan(change: Partial<Loan> = {}): Loan {
    return {
        id: "loan-syn",
        accountId: "bank",
        loanAccountId: "loan-acct",
        lenderInstitutionId: null,
        loanType: "Term Loan",
        loanKind: LoanKind.TERM_LOAN,
        name: "Synthetic Term Loan",
        loanAccountNumber: "SYN-0001",
        principalAmount: 120_000,
        interestRate: 12,
        interestType: "REDUCING",
        tenureMonths: 12,
        emiAmount: 10_661.85,
        startDate: "2026-01-10",
        maturityDate: "2027-01-10",
        outstandingPrincipal: 92_000,
        outstandingInterest: 5_000,
        paidInstallments: 3,
        currencyId: "INR",
        status: "ACTIVE",
        rateType: "FLOATING",
        interestCalculationMethod: "MONTHLY_RATE",
        scheduleSource: "GENERATED",
        firstEmiDate: "2026-02-10",
        createdAt: "2026-01-10T00:00:00Z",
        updatedAt: "2026-01-10T00:00:00Z",
        ...change,
    } as Loan;
}

function schedule(paid = 3): LoanPaymentSchedule[] {
    return new EMIScheduleGenerator()
        .generate({ loanId: "loan-syn", principalAmount: 120_000, interestRate: 12, interestType: "REDUCING", tenureMonths: 12, startDate: "2026-01-10", firstEmiDate: "2026-02-10" })
        .map((row, index) =>
            index < paid
                ? { ...row, id: `s${row.installmentNumber}`, status: LoanPaymentStatus.PAID, paidDate: row.dueDate, paidAmount: row.totalAmount, transactionId: `txn-${index + 1}` }
                : { ...row, id: `s${row.installmentNumber}` }
        );
}

function entry(id: string, effectiveFrom: string, rate: number, change: Partial<InterestRateHistoryEntry> = {}): InterestRateHistoryEntry {
    return {
        id,
        loanId: "loan-syn",
        effectiveFrom,
        effectiveUntil: null,
        rate,
        previousRate: null,
        rateType: "FLOATING",
        source: "MANUAL",
        reference: null,
        documentId: null,
        notes: null,
        appliedFromInstalment: null,
        createdAt: `${effectiveFrom}T00:00:00Z`,
        supersededBy: null,
        supersededAt: null,
        correctionReason: null,
        ...change,
    };
}

function context(change: Partial<RateChangeContext> = {}): RateChangeContext {
    return { available: true, loan: loan(), schedule: schedule(), linkedScheduleIds: ["s1", "s2", "s3"], history: [], ...change };
}

function input(change: Partial<RateChangeInput> = {}): RateChangeInput {
    return {
        rate: 13,
        effectiveFrom: "2026-05-20",
        rateType: "FLOATING",
        source: "LENDER_NOTICE",
        reference: " SYN-NOTICE-7 ",
        notes: "",
        option: "PRESERVE_TENURE",
        correcting: null,
        correctionReason: "",
        ...change,
    };
}

let counter = 0;
const ids = () => ({ newId: () => `id-${++counter}`, now: "2026-06-01T00:00:00.000Z" });

function ready(result: ReturnType<typeof prepareRateChange>) {
    if (result.status !== "READY") throw new Error(result.issues.map(issue => issue.message).join(" | "));
    return result;
}

// =====================================================================
describe("which loans are repriced", () => {
    it("a Term Loan with FinWea's own schedule is repriced", () => {
        expect(rateChangeMode(loan())).toEqual({ kind: "REPRICE" });
    });

    it("everything else records the rate history only, with the reason", () => {
        expect(rateChangeMode(loan({ loanKind: LoanKind.OVERDRAFT }))).toMatchObject({ kind: "RECORD_ONLY", reason: expect.stringMatching(/never calculates its interest/) });
        expect(rateChangeMode(loan({ scheduleSource: "LENDER_CSV" }))).toMatchObject({ kind: "RECORD_ONLY", reason: expect.stringMatching(/lender's revised schedule/) });
        expect(rateChangeMode(loan({ interestType: "FLAT" }))).toMatchObject({ kind: "RECORD_ONLY", reason: expect.stringMatching(/Flat-interest/) });
        expect(rateChangeMode(loan({ balloonAmount: 10_000 }))).toMatchObject({ kind: "RECORD_ONLY", reason: expect.stringMatching(/balloon/) });
    });
});

// =====================================================================
describe("input validation", () => {
    const fields = (value: RateChangeInput, of = loan()) => validateRateChangeInput(value, of, rateChangeMode(of)).map(issue => issue.field);

    it("requires a valid rate and date, not before the loan started", () => {
        expect(fields(input({ rate: null }))).toContain("rate");
        expect(fields(input({ rate: 100.5 }))).toContain("rate");
        expect(fields(input({ effectiveFrom: "" }))).toContain("effectiveFrom");
        expect(fields(input({ effectiveFrom: "2026-02-30" }))).toContain("effectiveFrom");
        expect(fields(input({ effectiveFrom: "2026-01-09" }))).toContain("effectiveFrom");
        expect(fields(input())).toEqual([]);
    });

    it("requires an explicit recalculation choice only where the schedule is repriced", () => {
        expect(fields(input({ option: null }))).toEqual(["option"]);
        expect(fields(input({ option: null }), loan({ loanKind: LoanKind.OVERDRAFT }))).toEqual([]);
        expect(fields(input({ option: null }), loan({ scheduleSource: "LENDER_CSV" }))).toEqual([]);
    });

    it("a correction needs its reason; the original rate stays on the start date", () => {
        const wrong = entry("e1", "2026-05-20", 15);
        expect(fields(input({ correcting: wrong }))).toContain("correctionReason");
        const initial = entry("e0", "2026-01-10", 12, { source: "INITIAL" });
        expect(fields(input({ correcting: initial, correctionReason: "x", effectiveFrom: "2026-02-01" }))).toContain("effectiveFrom");
    });

    it("a details-only correction needs no recalculation choice", () => {
        const wrong = entry("e1", "2026-05-20", 13);
        const detailsOnly = input({ correcting: wrong, correctionReason: "Reference typo", option: null });
        expect(isDetailsOnlyCorrection(detailsOnly)).toBe(true);
        expect(fields(detailsOnly)).toEqual([]);
    });
});

// =====================================================================
describe("preparing the save from the Stage 2 proposal", () => {
    it("a loan with no history: its original rate is recorded first, from its own terms", () => {
        const result = ready(prepareRateChange(context(), input(), ids()));

        expect(result.request.initialEntry).toMatchObject({ effectiveFrom: "2026-01-10", rate: 12, rateType: "FLOATING", source: "INITIAL" });
        expect(result.request.entry).toMatchObject({ effectiveFrom: "2026-05-20", rate: 13, source: "LENDER_NOTICE", reference: "SYN-NOTICE-7", notes: null });
        expect(result.request.supersedes).toBeNull();
    });

    it("a loan with history does not record its original rate again", () => {
        const result = ready(prepareRateChange(context({ history: [entry("e0", "2026-01-10", 12, { source: "INITIAL" })] }), input(), ids()));

        expect(result.request.initialEntry).toBeNull();
        expect(result.request.expected.liveHistoryIds).toEqual(["e0"]);
    });

    it("sends the snapshot the proposal was made from, for the stale check", () => {
        const ctx = context();
        const result = ready(prepareRateChange(ctx, input(), ids()));

        expect(result.request.expected.interestRate).toBe(12);
        expect(result.request.expected.schedule).toHaveLength(12);
        expect(result.request.expected.schedule[0]).toMatchObject({ id: "s1", status: "PAID", transactionId: "txn-1", settledBeforeFinwea: false });
    });

    it("replaces only the proposed future instalments, keeping each existing row's id", () => {
        const result = ready(prepareRateChange(context(), input(), ids()));
        const proposal = result.proposal!;

        expect(result.request.schedule!.fromInstalment).toBe(proposal.recalculatedFromInstalment);
        expect(result.request.schedule!.emiAmount).toBe(proposal.proposedEmis[0]);
        expect(result.request.schedule!.rows.map(row => [row.installmentNumber, row.id])).toEqual(proposal.proposedInstalments.map(row => [row.installmentNumber, `s${row.installmentNumber}`]));
        expect(result.request.schedule!.rows.map(row => row.totalAmount)).toEqual(proposal.proposedInstalments.map(row => row.totalAmount));
    });

    it("keeping the EMI may add instalments, which get new ids", () => {
        const result = ready(prepareRateChange(context(), input({ rate: 24, option: "PRESERVE_EMI" }), ids()));
        const added = result.request.schedule!.rows.filter(row => row.installmentNumber > 12);

        expect(added.length).toBeGreaterThan(0);
        expect(added.every(row => row.id.startsWith("id-"))).toBe(true);
        expect(result.request.schedule!.emiAmount).toBe(result.proposal!.currentEmi);
    });

    it("protected or ambiguous instalments block the change, with Stage 2's reason", () => {
        const partly = schedule().map((row, index) => (index === 3 ? { ...row, status: LoanPaymentStatus.PARTIAL, paidAmount: 100 } : row));
        const result = prepareRateChange(context({ schedule: partly }), input(), ids());

        expect(result.status).toBe("BLOCKED");
        expect(result.status === "BLOCKED" && result.issues[0]!.message).toMatch(/partly paid/);
    });

    it("refuses a conflicting or duplicate rate on a recorded date", () => {
        const history = [entry("e0", "2026-01-10", 12, { source: "INITIAL" }), entry("e1", "2026-05-20", 12.5)];
        const result = prepareRateChange(context({ history }), input(), ids());
        expect(result.status === "BLOCKED" && result.issues[0]!.message).toMatch(/12\.5% is already recorded/);
    });

    it("a correction supersedes the entry, re-prices from it, and never reuses it", () => {
        const history = [entry("e0", "2026-01-10", 12, { source: "INITIAL" }), entry("e1", "2026-05-20", 15)];
        const result = ready(prepareRateChange(context({ history }), input({ rate: 14, correcting: history[1]!, correctionReason: "Synthetic typo" }), ids()));

        expect(result.request.supersedes).toEqual({ id: "e1", reason: "Synthetic typo" });
        expect(result.request.initialEntry).toBeNull();
        expect(result.proposal!.replaces).toEqual({ effectiveFrom: "2026-05-20", rate: 15 });
        expect(result.proposal!.change).toMatchObject({ oldRate: 15, newRate: 14 });
    });

    it("correcting the original rate keeps it the original (source INITIAL)", () => {
        const history = [entry("e0", "2026-01-10", 12, { source: "INITIAL" })];
        const result = ready(prepareRateChange(context({ history }), input({ rate: 11.5, effectiveFrom: "2026-01-10", correcting: history[0]!, correctionReason: "Sanction letter" }), ids()));

        expect(result.request.entry.source).toBe("INITIAL");
        expect(result.proposal!.recalculatedFromInstalment).toBe(4);
    });

    it("a details-only correction leaves the schedule alone", () => {
        const history = [entry("e0", "2026-01-10", 12, { source: "INITIAL" }), entry("e1", "2026-05-20", 13)];
        const result = ready(prepareRateChange(context({ history }), input({ correcting: history[1]!, correctionReason: "Reference", option: null }), ids()));

        expect(result.proposal).toBeNull();
        expect(result.request.schedule).toBeNull();
    });

    it("refuses a correction of an entry that is no longer live (stale screen)", () => {
        const gone = entry("e1", "2026-05-20", 15, { supersededAt: "2026-05-21", supersededBy: "e2", correctionReason: "x" });
        const result = prepareRateChange(context({ history: [entry("e0", "2026-01-10", 12, { source: "INITIAL" }), gone] }), input({ correcting: gone, correctionReason: "again" }), ids());
        expect(result.status === "BLOCKED" && result.issues[0]!.message).toMatch(/no longer current/);
    });

    it("an Overdraft / Cash Credit / Dropline records history only: no schedule, no proposal", () => {
        const od = context({ loan: loan({ loanKind: LoanKind.OVERDRAFT }), schedule: [], linkedScheduleIds: [] });
        const result = ready(prepareRateChange(od, input({ option: null }), ids()));

        expect(result.mode.kind).toBe("RECORD_ONLY");
        expect(result.proposal).toBeNull();
        expect(result.request.schedule).toBeNull();
        expect(result.request.initialEntry).toMatchObject({ rate: 12, source: "INITIAL" });

        const duplicate = prepareRateChange({ ...od, history: [entry("e0", "2026-01-10", 12, { source: "INITIAL" }), entry("e1", "2026-05-20", 13)] }, input({ option: null }), ids());
        expect(duplicate.status === "BLOCKED" && duplicate.issues[0]!.message).toMatch(/already recorded/);
    });

    it("a lender CSV schedule is never repriced; its rate can be recorded", () => {
        const result = ready(prepareRateChange(context({ loan: loan({ scheduleSource: "LENDER_CSV" }) }), input({ option: null }), ids()));
        expect(result.request.schedule).toBeNull();
    });

    it("nothing can be prepared until migration 054 is applied", () => {
        const result = prepareRateChange(context({ available: false }), input(), ids());
        expect(result.status === "BLOCKED" && result.issues[0]!.message).toMatch(/migration 054/);
    });

    it("is deterministic for the same input and ids", () => {
        counter = 0;
        const first = prepareRateChange(context(), input(), ids());
        counter = 0;
        expect(prepareRateChange(context(), input(), ids())).toEqual(first);
    });
});

// =====================================================================
describe("the request matches the Rust command's fields exactly", () => {
    const rust = readFileSync(join(__dirname, "../../../../src-tauri/src/rate_change.rs"), "utf8");
    const fieldsOf = (struct: string) =>
        [...rust.slice(rust.indexOf(`pub struct ${struct} {`), rust.indexOf("}", rust.indexOf(`pub struct ${struct} {`))).matchAll(/pub (\w+):/g)]
            .map(match => match[1]!.replace(/_(\w)/g, (_, letter: string) => letter.toUpperCase()))
            .sort();

    it("top level, expected state, schedule rows, entries and replacement", () => {
        const result = ready(prepareRateChange(context(), input(), ids()));
        const { request } = result;

        expect(Object.keys(request).sort()).toEqual(fieldsOf("RecordRateChangeRequest"));
        expect(Object.keys(request.expected).sort()).toEqual(fieldsOf("ExpectedLoanState"));
        expect(Object.keys(request.expected.schedule[0]!).sort()).toEqual(fieldsOf("ExpectedScheduleRow"));
        expect(Object.keys(request.entry).sort()).toEqual(fieldsOf("NewRateEntry"));
        expect(Object.keys(request.initialEntry!).sort()).toEqual(fieldsOf("NewRateEntry"));
        expect(Object.keys(request.schedule!).sort()).toEqual(fieldsOf("ScheduleReplacement"));
        expect(Object.keys(request.schedule!.rows[0]!).sort()).toEqual(fieldsOf("NewScheduleRow"));
    });
});

// =====================================================================
describe("saving", () => {
    it("calls the one atomic command and returns a refusal as its plain message", async () => {
        const { request } = ready(prepareRateChange(context(), input(), ids()));
        invoke.mockResolvedValueOnce(undefined);
        await new InterestRateChangeService().save(request);
        expect(invoke).toHaveBeenCalledWith("record_rate_change_atomic", { request });

        invoke.mockRejectedValueOnce("error returned from database: RATE_CHANGE_REFUSED: The loan has changed since this rate change was prepared.");
        await expect(new InterestRateChangeService().save(request)).rejects.toThrow(/^The loan has changed since/);
    });
});

describe("current rate", () => {
    it("is the latest live entry in force today; a future or superseded one is not current", () => {
        const history = [
            entry("e0", "2026-01-10", 12, { source: "INITIAL" }),
            entry("e1", "2026-05-20", 13),
            entry("bad", "2026-05-25", 99, { supersededAt: "2026-05-26", supersededBy: "e1", correctionReason: "x" }),
            entry("e2", "2026-09-01", 14),
        ];
        expect(currentRateEntry(history, "2026-06-01")?.id).toBe("e1");
        expect(currentRateEntry(history, "2026-01-09")).toBeNull();
        expect(currentRateEntry([], "2026-06-01")).toBeNull();
    });
});
