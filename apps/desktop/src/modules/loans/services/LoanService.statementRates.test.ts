import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { EMIScheduleGenerator } from "./EMIScheduleGenerator";
import { prepareRateChange, type RateChangeContext, type RateChangeInput } from "./InterestRateChangeService";
import { LoanService, statementRateHistoryRequest } from "./LoanService";
import { emptyRateChangeInput } from "../components/rates/RecordRateChangeDialog";
import { confirmedStatementRates, rateReviewFromFacility, termRateChangeInputs } from "../statementImport/statementRateProposals";
import { LoanKind, type CreateLoanRequest, type Loan } from "../types";
import type { InterestRateHistoryEntry } from "../types/InterestRateHistory";

// ---------------------------------------------------------------------
// Interest Rate History, Stage 4: how a statement's confirmed rate changes
// reach the save. OD / CC / DOD: in the one create request (the Rust
// command's own tests prove it is written atomically and rolled back on
// any failure). Term Loan: never with the loan - through the reviewed
// Keep EMI / Keep Tenure workflow afterwards. Synthetic data only.
// ---------------------------------------------------------------------

const HISTORY: NonNullable<CreateLoanRequest["statementRateHistory"]> = {
    originalRate: 11.25,
    changes: [
        { effectiveFrom: "2026-09-01", rate: 12, rateType: "FLOATING", reference: "s.pdf, page 2", notes: "From the lender statement: \"b\"" },
        { effectiveFrom: "2026-06-01", rate: 11.75, rateType: null, reference: "s.pdf, page 1", notes: "From the lender statement: \"a\"" },
    ],
};

function odRequest(change: Partial<CreateLoanRequest> = {}): CreateLoanRequest {
    return {
        loanKind: LoanKind.OVERDRAFT,
        loanType: "Cash Credit",
        name: "Synthetic Cash Credit",
        lenderInstitutionId: "lender-1",
        principalAmount: 0,
        interestRate: 12,
        interestType: "REDUCING",
        startDate: "2026-04-01",
        outstandingPrincipal: 0,
        outstandingInterest: 0,
        paidInstallments: 0,
        currencyId: "INR",
        status: "ACTIVE",
        creditLimit: 2_500_000,
        openingUsed: 0,
        openingUsedAsOf: "2026-04-01",
        linkedAccountIds: ["bank-1"],
        ...change,
    } as CreateLoanRequest;
}

describe("statementRateHistoryRequest: ids and save times, in date order", () => {
    it("sorts by date, gives each change its own id and a distinct, increasing save time", () => {
        let n = 0;
        const request = statementRateHistoryRequest(HISTORY, "2026-11-12T10:00:00.000Z", () => `id-${++n}`)!;

        expect(request.initialRate).toBe(11.25);
        expect(request.changes.map(change => [change.id, change.effectiveFrom, change.rate, change.createdAt])).toEqual([
            ["id-1", "2026-06-01", 11.75, "2026-11-12T10:00:00.001Z"],
            ["id-2", "2026-09-01", 12, "2026-11-12T10:00:00.002Z"],
        ]);
        expect(request.changes[0]).toMatchObject({ reference: "s.pdf, page 1", notes: "From the lender statement: \"a\"", rateType: null });
    });

    it("absent history sends nothing (every existing caller is unchanged)", () => {
        expect(statementRateHistoryRequest(undefined, "2026-11-12T10:00:00.000Z")).toBeUndefined();
        expect(statementRateHistoryRequest(null, "2026-11-12T10:00:00.000Z")).toBeUndefined();
    });
});

describe("LoanService.create", () => {
    const repository = { createAtomic: vi.fn(), findLiveByLoanAccountNumber: vi.fn() };

    function service(): LoanService {
        const created = new LoanService();
        Object.defineProperty(created, "repository", { value: repository });
        Object.defineProperty(created, "institutionRepository", { value: { getByName: vi.fn().mockResolvedValue(null), create: vi.fn() } });
        return created;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        repository.findLiveByLoanAccountNumber.mockResolvedValue([]);
    });

    it("an Overdraft sends its confirmed statement rates in the one atomic create request", async () => {
        await service().create(odRequest({ statementRateHistory: HISTORY }));

        expect(repository.createAtomic).toHaveBeenCalledTimes(1);
        const sent = repository.createAtomic.mock.calls[0]![0];
        expect(sent.overdraft).toMatchObject({ creditLimit: 2_500_000 });
        expect(sent.schedule).toEqual([]);
        expect(sent.loan.interestRate).toBe(12);
        expect(typeof sent.initialRateHistoryId).toBe("string");
        expect(sent.statementRateHistory.initialRate).toBe(11.25);
        expect(sent.statementRateHistory.changes.map((change: { effectiveFrom: string }) => change.effectiveFrom)).toEqual(["2026-06-01", "2026-09-01"]);
    });

    it("an Overdraft without statement rates is created exactly as before", async () => {
        await service().create(odRequest());

        expect(repository.createAtomic.mock.calls[0]![0].statementRateHistory).toBeUndefined();
    });

    it("a Term Loan with statement rates is refused before anything is written", async () => {
        const term = { ...odRequest(), loanKind: LoanKind.TERM_LOAN, statementRateHistory: HISTORY } as CreateLoanRequest;

        await expect(service().create(term)).rejects.toThrow(/recorded after it is created, through Record rate change/);
        expect(repository.createAtomic).not.toHaveBeenCalled();
        expect(repository.findLiveByLoanAccountNumber).not.toHaveBeenCalled();
    });
});

describe("Term Loan follow-up: the existing reviewed workflow, never automatic", () => {
    // A synthetic Term Loan created from a statement at its original 9.5%.
    const loan = {
        id: "loan-syn",
        name: "Synthetic Term Loan",
        loanKind: LoanKind.TERM_LOAN,
        loanType: "Term Loan",
        principalAmount: 600_000,
        interestRate: 9.5,
        interestType: "REDUCING",
        tenureMonths: 84,
        startDate: "2025-01-10",
        firstEmiDate: "2025-02-10",
        rateType: "FLOATING",
        interestCalculationMethod: "MONTHLY_RATE",
        scheduleSource: "GENERATED",
        status: "ACTIVE",
    } as unknown as Loan;
    const schedule = new EMIScheduleGenerator()
        .generate({ loanId: "loan-syn", principalAmount: 600_000, interestRate: 9.5, interestType: "REDUCING", tenureMonths: 84, startDate: "2025-01-10", firstEmiDate: "2025-02-10" })
        .map(row => ({ ...row, id: `s${row.installmentNumber}` }));
    const initial: InterestRateHistoryEntry = {
        id: "initial",
        loanId: "loan-syn",
        effectiveFrom: "2025-01-10",
        effectiveUntil: null,
        rate: 9.5,
        previousRate: null,
        rateType: "FLOATING",
        source: "INITIAL",
        reference: null,
        documentId: null,
        notes: null,
        appliedFromInstalment: null,
        createdAt: "2025-01-10T00:00:00Z",
        supersededBy: null,
        supersededAt: null,
        correctionReason: null,
    };
    const context: RateChangeContext = { available: true, loan, schedule, linkedScheduleIds: [], history: [initial] };

    const confirmed = confirmedStatementRates(
        rateReviewFromFacility({ rateHistory: [{ effectiveDate: "2026-04-10", rate: 10.25, previousRate: 9.5, page: 3, raw: "10/04/2026 ROI changed from 9.50% to 10.25%", origin: "TEXT", datesInText: ["2026-04-10"] }] }, "Floating"),
        { loanKind: LoanKind.TERM_LOAN, startDate: "2025-01-10", loanRate: 9.5, today: "2026-11-12" },
        "synthetic-term.pdf"
    );
    const prefilled = (): RateChangeInput => ({ ...emptyRateChangeInput(context), ...termRateChangeInputs(confirmed)[0]!.input });

    it("the prefilled change is not ready until Keep EMI or Keep Tenure is chosen", () => {
        const result = prepareRateChange(context, prefilled());

        expect(result.status).toBe("BLOCKED");
        expect(result.status === "BLOCKED" && result.issues.map(issue => issue.field)).toContain("option");
    });

    it("with a choice: the existing proposal and save request - source statement, evidence kept", () => {
        const result = prepareRateChange(context, { ...prefilled(), option: "PRESERVE_EMI" }, { newId: (() => { let n = 0; return () => `id-${++n}`; })(), now: "2026-11-12T00:00:00Z" });
        if (result.status !== "READY") throw new Error(result.issues.map(issue => issue.message).join(" | "));

        expect(result.oldRate).toBe(9.5);
        expect(result.proposal).not.toBeNull();
        expect(result.request.initialEntry).toBeNull();
        expect(result.request.entry).toMatchObject({
            effectiveFrom: "2026-04-10",
            rate: 10.25,
            rateType: "FLOATING",
            source: "STATEMENT_IMPORT",
            reference: "synthetic-term.pdf, page 3",
            notes: 'From the lender statement: "10/04/2026 ROI changed from 9.50% to 10.25%"',
        });
        expect(result.request.schedule?.fromInstalment).toBe(16);
    });
});
