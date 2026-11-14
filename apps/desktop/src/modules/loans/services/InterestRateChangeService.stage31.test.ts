import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { EMIScheduleGenerator } from "./EMIScheduleGenerator";
import { EMIScheduleService } from "./EMIScheduleService";
import { LoanService } from "./LoanService";
import { LoanKind, LoanPaymentStatus, type Loan, type LoanPaymentSchedule, type UpdateLoanRequest } from "../types";
import type { InterestRateHistoryEntry } from "../types/InterestRateHistory";
import { currentLoanRate } from "../setup/interestRateHistory";
import { prepareRateChange, rateChangeMode, replacesRecordedRate, type RateChangeContext, type RateChangeInput } from "./InterestRateChangeService";

// ---------------------------------------------------------------------
// Interest Rate History, Stage 3.1: OD / CC / DOD rate changes, upcoming
// rates and the baseline of a loan with no history. Synthetic loans only;
// no database is opened (the Rust command's own tests cover the save).
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
        reference: "SYN-NOTICE-9",
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

function blocked(result: ReturnType<typeof prepareRateChange>) {
    if (result.status !== "BLOCKED") throw new Error("expected BLOCKED");
    return result.issues;
}

// The three overdraft facilities: one loan_kind, told apart by loanType (and a Dropline's steps).
const FACILITIES: Array<[string, Partial<Loan>]> = [
    ["Overdraft", { loanKind: LoanKind.OVERDRAFT, loanType: "Overdraft" }],
    ["Cash Credit", { loanKind: LoanKind.OVERDRAFT, loanType: "Cash Credit" }],
    ["Dropline Overdraft", { loanKind: LoanKind.OVERDRAFT, loanType: "Dropline Overdraft" }],
];

// =====================================================================
describe("OD / CC / DOD rate changes go through the history workflow, record-only", () => {
    it.each(FACILITIES)("%s: a change is recorded with its date and source; no schedule, no proposal", (_label, facility) => {
        counter = 0;
        const od = context({ loan: loan({ ...facility, interestRate: 10.5 }), schedule: [], linkedScheduleIds: [] });
        const result = ready(prepareRateChange(od, input({ rate: 11, effectiveFrom: "2026-04-01", option: null }), ids()));

        expect(result.mode.kind).toBe("RECORD_ONLY");
        expect(result.proposal).toBeNull();
        expect(result.request.schedule).toBeNull();
        // The facility's original rate first (no history yet), then the change.
        expect(result.request.initialEntry).toMatchObject({ id: "id-1", rate: 10.5, effectiveFrom: "2026-01-10", source: "INITIAL" });
        expect(result.request.entry).toMatchObject({ id: "id-2", rate: 11, effectiveFrom: "2026-04-01", source: "LENDER_NOTICE", reference: "SYN-NOTICE-9" });
        expect(result.request.expected.interestRate).toBe(10.5);
    });

    it.each(FACILITIES)("%s: never asks for a recalculation option, even with a schedule array present", (_label, facility) => {
        expect(rateChangeMode(loan(facility), schedule()).kind).toBe("RECORD_ONLY");
    });

    it("an upcoming OD rate is recorded now and is not the current rate until its date", () => {
        const history = [entry("e0", "2026-01-10", 10.5, { source: "INITIAL" }), entry("e1", "2026-09-01", 11.25)];
        const od = loan({ loanKind: LoanKind.OVERDRAFT, interestRate: 10.5 });

        expect(currentLoanRate(od, history, "2026-08-31").rate).toBe(10.5);
        expect(currentLoanRate(od, history, "2026-09-01").rate).toBe(11.25);
    });
});

// =====================================================================
describe("upcoming (future-dated) rates and later changes", () => {
    const history = [
        entry("e0", "2026-01-10", 12, { source: "INITIAL" }),
        entry("e1", "2026-08-01", 13, { previousRate: 12 }),
        entry("e2", "2026-10-01", 14, { previousRate: 13 }),
    ];

    it("a change between two upcoming ones is prepared against the full timeline and leaves the history to the stale check", () => {
        const od = context({ loan: loan({ loanKind: LoanKind.OVERDRAFT }), schedule: [], linkedScheduleIds: [], history });
        const result = ready(prepareRateChange(od, input({ rate: 13.5, effectiveFrom: "2026-09-01", option: null }), ids()));

        expect(result.request.initialEntry).toBeNull();
        expect(result.request.expected.liveHistoryIds).toEqual(["e0", "e1", "e2"]);
    });

    it("a repriced Term Loan sees later upcoming changes in its proposal", () => {
        const result = ready(prepareRateChange(context({ history }), input({ rate: 12.5, effectiveFrom: "2026-05-20" }), ids()));

        expect(result.warnings.join(" ")).toMatch(/Later recorded rate change/);
        expect(result.proposal!.change.oldRate).toBe(12);
    });

    it("a second change on an upcoming entry's date is refused - correct that entry instead", () => {
        const od = context({ loan: loan({ loanKind: LoanKind.OVERDRAFT }), schedule: [], linkedScheduleIds: [], history });
        expect(blocked(prepareRateChange(od, input({ rate: 15, effectiveFrom: "2026-10-01", option: null }), ids()))[0]!.message).toMatch(/Correct that entry/);
    });
});

// =====================================================================
describe("a loan with no history: a safe, deterministic baseline", () => {
    it("the first change records the loan's stored rate from its start date first, in the same request", () => {
        counter = 0;
        const result = ready(prepareRateChange(context(), input(), ids()));

        expect(result.request.initialEntry).toEqual({
            id: "id-1",
            effectiveFrom: "2026-01-10",
            rate: 12,
            rateType: "FLOATING",
            source: "INITIAL",
            reference: null,
            documentId: null,
            notes: null,
            createdAt: "2026-06-01T00:00:00.000Z",
        });
        expect(result.request.supersedes).toBeNull();
    });

    it("the same snapshot and ids always give the same request", () => {
        counter = 0;
        const first = prepareRateChange(context(), input(), ids());
        counter = 0;
        expect(prepareRateChange(context(), input(), ids())).toEqual(first);
    });

    it("preparing never changes the loan, its schedule or its (empty) history", () => {
        const snapshot = context();
        const before = JSON.stringify(snapshot);
        prepareRateChange(snapshot, input(), ids());
        expect(JSON.stringify(snapshot)).toBe(before);
    });

    it.each([
        ["a missing stored rate", { interestRate: Number.NaN }, /missing or invalid/],
        ["an invalid start date", { startDate: "2026-02-30" }, /start date/],
    ])("with %s nothing is prepared (nothing is fabricated)", (_label, change, message) => {
        const issues = blocked(prepareRateChange(context({ loan: loan(change as Partial<Loan>), schedule: [] }), input({ option: null }), ids()));
        expect(issues.map(issue => issue.message).join(" ")).toMatch(message);
    });

    it("only superseded rows and no live one: ambiguous, so nothing is prepared", () => {
        const history = [entry("old", "2026-01-10", 12, { source: "INITIAL", supersededBy: "gone", supersededAt: "2026-01-11", correctionReason: "Synthetic" })];
        expect(blocked(prepareRateChange(context({ history }), input(), ids()))[0]!.message).toMatch(/ambiguous/);
    });

    describe("a first change from the start date replaces the recorded rate, with an audit trail", () => {
        const fromStart = (change: Partial<RateChangeInput> = {}) => input({ rate: 11, effectiveFrom: "2026-01-10", ...change });

        it("is recognised only for a loan with no history", () => {
            expect(replacesRecordedRate(context(), fromStart())).toBe(true);
            expect(replacesRecordedRate(context({ history: [entry("e0", "2026-01-10", 12, { source: "INITIAL" })] }), fromStart())).toBe(false);
            expect(replacesRecordedRate(context(), input())).toBe(false);
        });

        it("needs a reason, and the same rate is refused (nothing would change)", () => {
            expect(blocked(prepareRateChange(context(), fromStart(), ids()))[0]).toMatchObject({ field: "correctionReason" });
            expect(blocked(prepareRateChange(context(), fromStart({ rate: 12, correctionReason: "x" }), ids()))[0]!.message).toMatch(/already this loan's rate/);
        });

        it("records the stored rate, then supersedes it with the new INITIAL rate - one request", () => {
            counter = 0;
            const od = context({ loan: loan({ loanKind: LoanKind.OVERDRAFT }), schedule: [], linkedScheduleIds: [] });
            const result = ready(prepareRateChange(od, fromStart({ option: null, correctionReason: " Sanction letter " }), ids()));

            expect(result.request.initialEntry).toMatchObject({ id: "id-1", rate: 12, source: "INITIAL", effectiveFrom: "2026-01-10" });
            expect(result.request.entry).toMatchObject({ id: "id-2", rate: 11, source: "INITIAL", effectiveFrom: "2026-01-10" });
            expect(result.request.supersedes).toEqual({ id: "id-1", reason: "Sanction letter" });
        });

        it("a repriced Term Loan reprices from the start against the recorded rate it replaces", () => {
            const result = ready(prepareRateChange(context(), fromStart({ correctionReason: "Sanction letter" }), ids()));

            expect(result.proposal!.replaces).toEqual({ effectiveFrom: "2026-01-10", rate: 12 });
            expect(result.request.schedule!.fromInstalment).toBe(4);
        });
    });

    it("a Term Loan with no instalment schedule is recorded only (nothing to reprice)", () => {
        const result = ready(prepareRateChange(context({ schedule: [], linkedScheduleIds: [] }), input({ option: null }), ids()));
        expect(result.mode).toMatchObject({ kind: "RECORD_ONLY", reason: expect.stringMatching(/no instalment schedule/) });
        expect(result.request.schedule).toBeNull();
    });
});

// =====================================================================
describe("no edit path overwrites the rate (LoanService.update)", () => {
    const repository = { getById: vi.fn(), update: vi.fn(), linkLoanAccount: vi.fn(), updateOverdraftAtomic: vi.fn() };
    const scheduleRepository = { getAllByLoanId: vi.fn() };

    function service(): LoanService {
        const created = new LoanService();
        Object.defineProperty(created, "repository", { value: repository });
        Object.defineProperty(created, "scheduleRepository", { value: scheduleRepository });
        Object.defineProperty(created, "institutionRepository", { value: { getByName: vi.fn().mockResolvedValue(null), create: vi.fn() } });
        return created;
    }

    const request = (change: Partial<UpdateLoanRequest> = {}): UpdateLoanRequest =>
        ({ id: "loan-syn", name: "Synthetic", loanType: "Term Loan", principalAmount: 120_000, interestRate: 12, interestType: "REDUCING", startDate: "2026-01-10", currencyId: "INR", status: "ACTIVE", ...change }) as UpdateLoanRequest;

    beforeEach(() => {
        vi.clearAllMocks();
        scheduleRepository.getAllByLoanId.mockResolvedValue([]);
    });

    it.each([["Term Loan", {} as Partial<Loan>], ...FACILITIES])("%s: a changed rate is refused before anything is written", async (_label, kind) => {
        repository.getById.mockResolvedValue(loan({ ...kind, interestRate: 12 }));

        await expect(service().update(request({ interestRate: 12.5 }))).rejects.toThrow(/Use Record rate change/);

        expect(repository.update).not.toHaveBeenCalled();
        expect(repository.updateOverdraftAtomic).not.toHaveBeenCalled();
        expect(scheduleRepository.getAllByLoanId).not.toHaveBeenCalled();
    });
});

// =====================================================================
describe("EMIScheduleService.generateSchedule never prices across a recorded rate change", () => {
    function service(history: InterestRateHistoryEntry[]) {
        const created = new EMIScheduleService();
        const create = vi.fn();
        Object.defineProperty(created, "loanRepository", { value: { getById: vi.fn().mockResolvedValue(loan()), updateAccountingBalances: vi.fn() } });
        Object.defineProperty(created, "scheduleRepository", { value: { getAllByLoanId: vi.fn().mockResolvedValue([]), create } });
        Object.defineProperty(created, "rateHistoryRepository", { value: { findByLoan: vi.fn().mockResolvedValue(history) } });
        return { created, create };
    }

    it("refuses, writing nothing, when the history holds another rate", async () => {
        const { created, create } = service([entry("e0", "2026-01-10", 12, { source: "INITIAL" }), entry("e1", "2026-09-01", 13)]);
        await expect(created.generateSchedule("loan-syn")).rejects.toThrow(/recorded interest rate changes/);
        expect(create).not.toHaveBeenCalled();
    });

    it("generates as before with no history", async () => {
        const { created, create } = service([]);
        await created.generateSchedule("loan-syn");
        expect(create).toHaveBeenCalledTimes(12);
    });
});

// =====================================================================
describe("source scan: every statement that writes loans.interest_rate is guarded", () => {
    const appRoot = join(__dirname, "..", "..", "..", "..");
    const read = (path: string) => readFileSync(join(appRoot, path), "utf8").replace(/\r\n/g, "\n");

    function files(dir: string, pattern: RegExp): string[] {
        return readdirSync(join(appRoot, dir)).flatMap(name => {
            const path = join(dir, name);
            if (statSync(join(appRoot, path)).isDirectory()) return name === "node_modules" || name === "migrations" ? [] : files(path, pattern);
            return pattern.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
        });
    }

    it("only three writers exist: the guarded edit (TS), the guarded OD edit (Rust) and the rate-change command", () => {
        const writers = [...files("src", /\.tsx?$/), ...files("src-tauri/src", /\.rs$/)]
            .filter(path => {
                const text = read(path);
                const production = path.endsWith(".rs") ? text.split("#[cfg(test)]")[0]! : text;
                return /interest_rate\s*=\s*\?/.test(production);
            })
            .map(path => relative(appRoot, join(appRoot, path)).replace(/\\/g, "/"))
            .sort();

        expect(writers).toEqual(["src-tauri/src/overdraft_update.rs", "src-tauri/src/rate_change.rs", "src/modules/loans/repositories/LoanRepository.ts"]);
    });

    it("LoanService.update refuses a rate change before it calls either repository writer", () => {
        const text = read("src/modules/loans/services/LoanService.ts");
        const update = text.slice(text.indexOf("async update("));
        const guard = update.indexOf("directRateEditRefusal(");

        expect(guard).toBeGreaterThan(0);
        expect(guard).toBeLessThan(update.indexOf("this.repository.update("));
        expect(guard).toBeLessThan(update.indexOf("this.repository.updateOverdraftAtomic("));
    });

    it("the OD edit command refuses a rate change before its UPDATE", () => {
        const text = read("src-tauri/src/overdraft_update.rs").split("#[cfg(test)]")[0]!;
        expect(text.indexOf("Use Record rate change")).toBeGreaterThan(0);
        expect(text.indexOf("Use Record rate change")).toBeLessThan(text.indexOf("interest_rate = ?"));
    });

    it("the edit forms show the rate read-only when editing", () => {
        expect(read("src/modules/loans/components/LoanForm.tsx")).toMatch(/readOnly=\{editMode\}/);
        expect(read("src/modules/loans/components/OverdraftForm.tsx")).toMatch(/readOnly=\{rateLocked\}/);
        expect(read("src/modules/loans/components/EditLoanDialog.tsx")).toMatch(/\n\s*rateLocked\n/);
    });
});
