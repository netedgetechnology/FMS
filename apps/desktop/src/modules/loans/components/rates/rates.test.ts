import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { EMIScheduleGenerator } from "../../services/EMIScheduleGenerator";
import { prepareRateChange, rateChangeMode, type RateChangeContext, type RateChangeInput } from "../../services/InterestRateChangeService";
import { LoanKind, LoanPaymentStatus, type Loan } from "../../types";
import type { InterestRateHistoryEntry } from "../../types/InterestRateHistory";
import { InterestRateHistoryView } from "./InterestRateHistoryView";
import { RateChangeForm, emptyRateChangeInput, saveConfirmedRateChange } from "./RecordRateChangeDialog";
import { RateChangeReview } from "./RateChangeReview";

// No DOM test setup exists (vitest environment: "node"), so the screens are
// rendered to static markup; their rules are tested in the service tests.
// Synthetic loan only.

const LOAN = {
    id: "loan-syn",
    name: "Synthetic Term Loan",
    loanKind: LoanKind.TERM_LOAN,
    loanType: "Term Loan",
    principalAmount: 120_000,
    interestRate: 12,
    interestType: "REDUCING",
    rateType: "FLOATING",
    interestCalculationMethod: "MONTHLY_RATE",
    scheduleSource: "GENERATED",
    startDate: "2026-01-10",
    status: "ACTIVE",
} as unknown as Loan;

const SCHEDULE = new EMIScheduleGenerator()
    .generate({ loanId: "loan-syn", principalAmount: 120_000, interestRate: 12, interestType: "REDUCING", tenureMonths: 12, startDate: "2026-01-10", firstEmiDate: "2026-02-10" })
    .map((row, index) => ({ ...row, id: `s${index + 1}`, ...(index < 3 ? { status: LoanPaymentStatus.PAID, paidAmount: row.totalAmount, transactionId: `txn-${index + 1}` } : {}) }));

const entry = (id: string, effectiveFrom: string, rate: number, change: Partial<InterestRateHistoryEntry> = {}): InterestRateHistoryEntry => ({
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
});

const HISTORY = [
    entry("e0", "2026-01-10", 12, { source: "INITIAL", effectiveUntil: "2026-05-19" }),
    entry("e1", "2026-05-20", 13, { previousRate: 12, source: "LENDER_NOTICE", reference: "SYN-NOTICE-7", appliedFromInstalment: 5, effectiveUntil: "2026-08-31" }),
    entry("wrong", "2026-05-20", 31, { supersededBy: "e1", supersededAt: "2026-05-21 10:00:00", correctionReason: "Synthetic typo: 13 not 31" }),
    entry("e2", "2026-09-01", 12.5, { previousRate: 13 }),
];

const context = (change: Partial<RateChangeContext> = {}): RateChangeContext => ({ available: true, loan: LOAN, schedule: SCHEDULE, linkedScheduleIds: [], history: [], ...change });

const view = (props: Partial<Parameters<typeof InterestRateHistoryView>[0]>) =>
    renderToStaticMarkup(createElement(InterestRateHistoryView, { loan: LOAN, available: true, history: [], today: "2026-06-15", onRecord: vi.fn(), onCorrect: vi.fn(), ...props }));

describe("Interest Rate History on loan details", () => {
    it("before migration 054: says no history is available, and recording is disabled", () => {
        const html = view({ available: false, recordBlockedReason: "Rate changes can be recorded once the database update (migration 054) is applied." });

        expect(html).toContain('data-state="unavailable"');
        expect(html).toContain("no historical rates are known");
        expect(html).toContain("from the loan&#x27;s terms (no confirmed history)");
        expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\s*Record rate change/);
    });

    it("no history yet: the loan's rate is labelled as its terms, not as history", () => {
        const html = view({});

        expect(html).toContain('data-state="empty"');
        expect(html).toContain("12% <span");
        expect(html).toContain("no confirmed history");
        expect(html).not.toContain("<table");
    });

    it("confirmed history: chronological, with previous rate, change, source, reference, current and upcoming markers", () => {
        const html = view({ history: HISTORY });
        const rows = [...html.matchAll(/data-entry="(\w+)"/g)].map(match => match[1]);

        expect(rows).toEqual(["e0", "e1", "e2"]);
        expect(html).toContain("13% <span");
        expect(html).toContain("· Floating · from 20/05/2026");
        expect(html).toMatch(/data-entry="e1"[\s\S]*?data-current="true"/);
        expect(html.match(/data-current="true"/g)).toHaveLength(1);
        expect(html).toContain("Upcoming");
        expect(html).toContain("+1 pp");
        expect(html).toContain("-0.5 pp");
        expect(html).toContain("Lender notice");
        expect(html).toContain("repriced from instalment 5");
        expect(html).toContain("SYN-NOTICE-7");
        expect(html).toContain("19/05/2026");
        expect(html).toContain('data-chart="rate-trend"');
    });

    it("keeps the correction history, with the reason and what replaced it", () => {
        const html = view({ history: HISTORY });

        expect(html).toContain('data-section="corrections"');
        expect(html).toContain("31% from 20/05/2026");
        expect(html).toContain("by 13% from 20/05/2026");
        expect(html).toContain("Synthetic typo: 13 not 31");
    });
});

describe("the rate change form", () => {
    const form = (ctx: RateChangeContext, input: RateChangeInput = emptyRateChangeInput(ctx)) =>
        renderToStaticMarkup(createElement(RateChangeForm, { context: ctx, input, issues: [], onChange: vi.fn() }));

    it("a repriced Term Loan asks how to recalculate, with no default", () => {
        const html = form(context());

        expect(html).toContain("How to Recalculate");
        expect(html).not.toContain('data-mode="record-only"');
        expect(emptyRateChangeInput(context()).option).toBeNull();
    });

    it("an Overdraft explains it records history only, and asks no recalculation choice", () => {
        const html = form(context({ loan: { ...LOAN, loanKind: LoanKind.OVERDRAFT } as Loan, schedule: [] }));

        expect(html).toContain('data-mode="record-only"');
        expect(html).toContain("never calculates its interest");
        expect(html).not.toContain("How to Recalculate");
    });

    it("a lender CSV loan explains why it is not repriced", () => {
        expect(form(context({ loan: { ...LOAN, scheduleSource: "LENDER_CSV" } as Loan }))).toContain("FinWea does not reprice it");
    });

    it("a correction asks for the reason; correcting the original rate keeps its date", () => {
        const corrected = form(context({ history: HISTORY }), emptyRateChangeInput(context({ history: HISTORY }), HISTORY[1]!));
        expect(corrected).toContain("Reason for the Correction");

        const initial = form(context({ history: HISTORY }), emptyRateChangeInput(context({ history: HISTORY }), HISTORY[0]!));
        expect(initial).toMatch(/id="rate-change-date"[^>]*disabled=""/);
        expect(initial).not.toContain('id="rate-change-source"');
    });
});

describe("reviewing before saving", () => {
    const ready = (ctx: RateChangeContext, input: RateChangeInput) => {
        const result = prepareRateChange(ctx, input, { newId: () => "id", now: "2026-06-01T00:00:00Z" });
        if (result.status !== "READY") throw new Error("not ready");
        return result;
    };
    const review = (ctx: RateChangeContext, input: RateChangeInput) => {
        const result = ready(ctx, input);
        return renderToStaticMarkup(createElement(RateChangeReview, { input, mode: result.mode, proposal: result.proposal, warnings: result.warnings, oldRate: result.oldRate }));
    };
    const base: RateChangeInput = { ...emptyRateChangeInput(context()), rate: 24, effectiveFrom: "2026-05-20", option: "PRESERVE_EMI" };

    it("shows the impact, protected instalments, and current vs proposed instalments", () => {
        const html = review(context(), base);

        expect(html).toContain("Recalculated from");
        expect(html).toContain("Instalments left");
        expect(html).toContain("Interest still to pay");
        expect(html).toContain('data-protected="3"');
        expect(html).toContain("#1 (paid, linked to a bank transaction)");
        expect(html).toContain("(new)");
        expect(html).toContain("24% x 21d");
    });

    it("a record-only change says the schedule is not changed, and why", () => {
        const od = context({ loan: { ...LOAN, loanKind: LoanKind.OVERDRAFT } as Loan, schedule: [] });
        const html = review(od, { ...base, option: null });

        expect(html).toContain('data-schedule="unchanged"');
        expect(html).toContain(rateChangeMode(od.loan).kind === "RECORD_ONLY" ? "never calculates its interest" : "?");
    });
});

describe("confirming and saving", () => {
    const prepared = prepareRateChange(context(), { ...emptyRateChangeInput(context()), rate: 13, effectiveFrom: "2026-05-20", option: "PRESERVE_TENURE" });

    it("nothing is saved without the confirmation tick, or from a blocked change", async () => {
        const service = { save: vi.fn() };
        const notify = vi.fn();

        expect(await saveConfirmedRateChange(prepared, false, service, notify, false)).toEqual({ saved: false, error: null });
        expect(await saveConfirmedRateChange({ status: "BLOCKED", issues: [], warnings: [] }, true, service, notify, false)).toEqual({ saved: false, error: null });
        expect(await saveConfirmedRateChange(null, true, service, notify, false)).toEqual({ saved: false, error: null });
        expect(service.save).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });

    it("the success toast comes only after the save succeeded", async () => {
        const order: string[] = [];
        const service = { save: vi.fn(async () => void order.push("save")) };
        const notify = vi.fn(() => void order.push("toast"));

        expect(await saveConfirmedRateChange(prepared, true, service, notify, false)).toEqual({ saved: true, error: null });
        expect(order).toEqual(["save", "toast"]);
        expect(notify).toHaveBeenCalledWith("Interest rate change saved.");
    });

    it("a refused or failed save shows its message and no toast", async () => {
        const service = { save: vi.fn(async () => Promise.reject(new Error("The loan has changed since this rate change was prepared."))) };
        const notify = vi.fn();

        expect(await saveConfirmedRateChange(prepared, true, service, notify, false)).toEqual({ saved: false, error: "The loan has changed since this rate change was prepared." });
        expect(notify).not.toHaveBeenCalled();
    });
});
