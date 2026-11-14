import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { InterestRateChangeService, prepareRateChange, rateBeforeChange, type RateChangeContext, type RateChangeInput, type RecordRateChangeRequest } from "./InterestRateChangeService";
import { refreshedSelection } from "../pages/loansPageSections";
import { resolveRateBaseline } from "../setup/interestRateHistory";
import { LoanKind, type Loan } from "../types";
import type { InterestRateHistoryEntry } from "../types/InterestRateHistory";

// ---------------------------------------------------------------------
// Interest Rate History, Stage 3.3 - fixes from the desktop verification:
//   1. consecutive changes / corrections from one open loan window;
//   2. the old rate of a record-only change (OD / CC / DOD, and a first
//      change replacing the recorded rate from the start date).
// Synthetic loans only; no database is opened. The Rust command's own
// tests cover its stale check against a real (in-memory) database.
// ---------------------------------------------------------------------

function facility(change: Partial<Loan> = {}): Loan {
    return {
        id: "loan-syn",
        accountId: "bank",
        loanAccountId: "loan-acct",
        lenderInstitutionId: null,
        loanType: "Overdraft",
        loanKind: LoanKind.OVERDRAFT,
        name: "Synthetic Facility",
        principalAmount: 0,
        interestRate: 11,
        interestType: "REDUCING",
        tenureMonths: null,
        emiAmount: null,
        startDate: "2026-01-10",
        maturityDate: null,
        outstandingPrincipal: 0,
        outstandingInterest: 0,
        paidInstallments: 0,
        currencyId: "INR",
        status: "ACTIVE",
        rateType: "FIXED",
        createdAt: "2026-01-10T00:00:00Z",
        updatedAt: "2026-01-10T00:00:00Z",
        ...change,
    } as Loan;
}

function entry(id: string, effectiveFrom: string, rate: number, change: Partial<InterestRateHistoryEntry> = {}): InterestRateHistoryEntry {
    return {
        id,
        loanId: "loan-syn",
        effectiveFrom,
        effectiveUntil: null,
        rate,
        previousRate: null,
        rateType: "FIXED",
        source: "LENDER_NOTICE",
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

function input(change: Partial<RateChangeInput> = {}): RateChangeInput {
    return { rate: 12, effectiveFrom: "2026-05-01", rateType: "FIXED", source: "LENDER_NOTICE", reference: "", notes: "", option: null, correcting: null, correctionReason: "", ...change };
}

let counter = 0;
const ids = () => ({ newId: () => `id-${++counter}`, now: `2026-06-01T00:00:${String(++counter % 60).padStart(2, "0")}.000Z` });

function ready(result: ReturnType<typeof prepareRateChange>) {
    if (result.status !== "READY") throw new Error(result.issues.map(issue => issue.message).join(" | "));
    return result;
}

const FACILITIES: Array<[string, Partial<Loan>]> = [
    ["Overdraft", { loanType: "Overdraft" }],
    ["Cash Credit", { loanType: "Cash Credit" }],
    ["Dropline Overdraft", { loanType: "Dropline Overdraft" }],
];

// =====================================================================
// 2. The old rate of a record-only change
// =====================================================================

describe("record-only changes show the rate they replace (not '-')", () => {
    const history = [entry("e0", "2026-01-10", 11, { source: "INITIAL" }), entry("e1", "2026-03-01", 11.5, { previousRate: 11 })];

    it.each(FACILITIES)("%s with history: the rate in force the day before the change", (_label, kind) => {
        const ctx: RateChangeContext = { available: true, loan: facility(kind), schedule: [], linkedScheduleIds: [], history };
        const result = ready(prepareRateChange(ctx, input({ rate: 12, effectiveFrom: "2026-05-01" }), ids()));

        expect(result.proposal).toBeNull();
        expect(result.oldRate).toBe(11.5);
    });

    it.each(FACILITIES)("%s: a change between two recorded rates takes the earlier one, never a later or upcoming one", (_label, kind) => {
        const withUpcoming = [...history, entry("e2", "2026-09-01", 13, { previousRate: 11.5 })];
        const ctx: RateChangeContext = { available: true, loan: facility(kind), schedule: [], linkedScheduleIds: [], history: withUpcoming };

        expect(ready(prepareRateChange(ctx, input({ effectiveFrom: "2026-02-15" }), ids())).oldRate).toBe(11);
        expect(ready(prepareRateChange(ctx, input({ effectiveFrom: "2026-10-01", rate: 12.5 }), ids())).oldRate).toBe(13);
    });

    it.each(FACILITIES)("%s with no history: the loan's own recorded rate (the baseline saved with the change)", (_label, kind) => {
        const ctx: RateChangeContext = { available: true, loan: facility({ ...kind, interestRate: 11.25 }), schedule: [], linkedScheduleIds: [], history: [] };
        const result = ready(prepareRateChange(ctx, input({ rate: 12, effectiveFrom: "2026-04-01" }), ids()));

        expect(result.request.initialEntry?.rate).toBe(11.25);
        expect(result.oldRate).toBe(11.25);
    });

    it.each(FACILITIES)("%s: a first change from the start date replaces the recorded rate - that rate is the old one", (_label, kind) => {
        const ctx: RateChangeContext = { available: true, loan: facility({ ...kind, interestRate: 11.25 }), schedule: [], linkedScheduleIds: [], history: [] };
        const result = ready(prepareRateChange(ctx, input({ rate: 11.75, effectiveFrom: "2026-01-10", correctionReason: "Lender confirmed" }), ids()));

        expect(result.request.supersedes?.id).toBe(result.request.initialEntry?.id);
        expect(result.oldRate).toBe(11.25);
    });

    it("a correction's old rate is the entry it replaces", () => {
        const ctx: RateChangeContext = { available: true, loan: facility(), schedule: [], linkedScheduleIds: [], history };
        const result = ready(prepareRateChange(ctx, input({ rate: 11.4, effectiveFrom: "2026-03-01", correcting: history[1]!, correctionReason: "Typo" }), ids()));

        expect(result.oldRate).toBe(11.5);
    });

    it("is the same previous rate the save stores (latest live entry before the date; corrected entry left out)", () => {
        const live = [entry("e0", "2026-01-10", 11, { source: "INITIAL" }), entry("e1", "2026-03-01", 11.5)];
        const baseline = resolveRateBaseline(facility(), live);

        expect(rateBeforeChange(live, { effectiveFrom: "2026-03-01", correcting: null }, baseline, false)).toBe(11);
        expect(rateBeforeChange(live, { effectiveFrom: "2026-03-02", correcting: null }, baseline, false)).toBe(11.5);
        expect(rateBeforeChange(live, { effectiveFrom: "2026-01-10", correcting: null }, baseline, false)).toBeNull();
    });
});

// =====================================================================
// 1. Consecutive changes and corrections from one open loan window
// =====================================================================

/**
 * A stand-in for the database, with the save's stale check (the same
 * fields record_rate_change_atomic compares): the loan's stored rate and
 * the live history ids must be exactly as when the change was prepared.
 */
function fakeDatabase(initial: Loan) {
    const state = { loan: { ...initial }, history: [] as InterestRateHistoryEntry[] };
    const live = () => state.history.filter(row => row.supersededAt === null);

    function save(request: RecordRateChangeRequest, today = "2026-06-01") {
        const liveIds = live().map(row => row.id).sort();
        if (request.expected.interestRate !== state.loan.interestRate || JSON.stringify([...request.expected.liveHistoryIds].sort()) !== JSON.stringify(liveIds)) {
            throw new Error("The loan has changed since this rate change was prepared (its rate, rate history or schedule). Nothing was saved - prepare it again.");
        }
        const rows = [request.initialEntry, request.entry].filter((row): row is NonNullable<typeof row> => row !== null);
        for (const row of rows) {
            const before = live().filter(other => other.effectiveFrom < row.effectiveFrom && other.id !== request.supersedes?.id);
            state.history.push(entry(row.id, row.effectiveFrom, row.rate, { source: row.source, createdAt: row.createdAt, previousRate: before.length ? before[before.length - 1]!.rate : null }));
        }
        if (request.supersedes) {
            const target = state.history.find(row => row.id === request.supersedes!.id)!;
            Object.assign(target, { supersededBy: request.entry.id, supersededAt: "2026-06-01", correctionReason: request.supersedes.reason });
        }
        const inForce = live().filter(row => row.effectiveFrom <= today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).pop();
        state.loan = { ...state.loan, interestRate: inForce?.rate ?? state.loan.interestRate };
    }

    function service(): InterestRateChangeService {
        const created = new InterestRateChangeService();
        Object.defineProperty(created, "loans", { value: { getById: vi.fn(async (id: string) => (id === state.loan.id ? { ...state.loan } : null)) } });
        Object.defineProperty(created, "history", {
            value: { isAvailable: vi.fn(async () => true), findByLoan: vi.fn(async () => state.history.map(row => ({ ...row }))) },
        });
        Object.defineProperty(created, "schedules", { value: { getAllByLoanId: vi.fn(async () => []) } });
        Object.defineProperty(created, "payments", { value: { getAllByLoanId: vi.fn(async () => []) } });
        return created;
    }

    return { state, save, service };
}

describe("several changes and corrections from one open loan window", () => {
    beforeEach(() => {
        counter = 0;
    });

    it("loadContext reads the loan from the database, not the (older) object on screen", async () => {
        const opened = facility({ interestRate: 11 });
        const db = fakeDatabase(opened);
        db.state.loan.interestRate = 11.5;

        const context = await db.service().loadContext(opened);

        expect(context.loan.interestRate).toBe(11.5);
        expect(opened.interestRate).toBe(11);
    });

    it("loadContext falls back to the screen's loan only when it can no longer be read", async () => {
        const db = fakeDatabase(facility());
        const context = await db.service().loadContext(facility({ id: "gone" }));

        expect(context.loan.id).toBe("gone");
    });

    it("change, change, correction - all from the loan object the window was opened with", async () => {
        const opened = facility({ interestRate: 11 });
        const db = fakeDatabase(opened);

        // As the history section does after every save: reload the context.
        let context = await db.service().loadContext(opened);
        db.save(ready(prepareRateChange(context, input({ rate: 11.5, effectiveFrom: "2026-03-01" }), ids())).request);

        context = await db.service().loadContext(opened);
        const second = ready(prepareRateChange(context, input({ rate: 12, effectiveFrom: "2026-05-01" }), ids()));
        expect(second.oldRate).toBe(11.5);
        db.save(second.request);

        context = await db.service().loadContext(opened);
        const correcting = context.history.find(row => row.supersededAt === null && row.rate === 12)!;
        const correction = ready(prepareRateChange(context, input({ rate: 11.9, effectiveFrom: "2026-05-01", correcting, correctionReason: "Notice misread" }), ids()));
        db.save(correction.request);

        const live = db.state.history.filter(row => row.supersededAt === null).map(row => [row.effectiveFrom, row.rate]);
        expect(live).toEqual([
            ["2026-01-10", 11],
            ["2026-03-01", 11.5],
            ["2026-05-01", 11.9],
        ]);
        expect(db.state.history.find(row => row.id === correcting.id)?.correctionReason).toBe("Notice misread");
        expect(db.state.loan.interestRate).toBe(11.9);
    });

    it("the stale check still refuses a change prepared before another save (nothing is written)", async () => {
        const opened = facility({ interestRate: 11 });
        const db = fakeDatabase(opened);

        const before = await db.service().loadContext(opened);
        const first = ready(prepareRateChange(before, input({ rate: 11.5, effectiveFrom: "2026-03-01" }), ids()));
        const stale = ready(prepareRateChange(before, input({ rate: 12, effectiveFrom: "2026-05-01" }), ids()));
        db.save(first.request);
        const snapshot = JSON.stringify(db.state);

        expect(() => db.save(stale.request)).toThrow(/has changed since this rate change was prepared/);
        expect(JSON.stringify(db.state)).toBe(snapshot);
    });

    it("a context built from the screen's old object (the Stage 3.2 defect) is exactly what the stale check refuses", async () => {
        const opened = facility({ interestRate: 11 });
        const db = fakeDatabase(opened);
        db.save(ready(prepareRateChange(await db.service().loadContext(opened), input({ rate: 11.5, effectiveFrom: "2026-03-01" }), ids())).request);

        const fromScreenObject: RateChangeContext = { ...(await db.service().loadContext(opened)), loan: opened };
        const request = ready(prepareRateChange(fromScreenObject, input({ rate: 12, effectiveFrom: "2026-05-01" }), ids())).request;

        expect(request.expected.interestRate).toBe(11);
        expect(() => db.save(request)).toThrow(/has changed/);
    });
});

describe("the Loans page keeps an open loan's details on the reloaded loan", () => {
    const a = facility({ id: "a", interestRate: 11 });
    const b = facility({ id: "b", interestRate: 9 });

    it("swaps in the reloaded copy of the same loan", () => {
        const reloadedA = { ...a, interestRate: 11.5 };
        expect(refreshedSelection(a, [b, reloadedA])).toBe(reloadedA);
    });

    it("nothing open stays closed; a loan no longer listed keeps its object", () => {
        expect(refreshedSelection(null, [a, b])).toBeNull();
        expect(refreshedSelection(a, [b])).toBe(a);
    });
});
