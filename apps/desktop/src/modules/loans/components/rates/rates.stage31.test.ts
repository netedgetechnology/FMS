import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { prepareRateChange, type RateChangeContext, type RateChangeInput } from "../../services/InterestRateChangeService";
import { LoanKind, type Loan } from "../../types";
import type { InterestRateHistoryEntry } from "../../types/InterestRateHistory";
import { InterestRateHistoryView } from "./InterestRateHistoryView";
import { RateChangeForm, emptyRateChangeInput } from "./RecordRateChangeDialog";
import { RateChangeReview } from "./RateChangeReview";

// Stage 3.1 screens, rendered to static markup (vitest runs in "node").
// Synthetic loan only. Its stored rate (9%) is deliberately stale.

const LOAN = {
    id: "loan-syn",
    name: "Synthetic Facility",
    loanKind: LoanKind.OVERDRAFT,
    loanType: "Cash Credit",
    principalAmount: 0,
    interestRate: 9,
    interestType: "REDUCING",
    rateType: "FLOATING",
    startDate: "2026-01-10",
    status: "ACTIVE",
} as unknown as Loan;

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

const context = (change: Partial<RateChangeContext> = {}): RateChangeContext => ({ available: true, loan: LOAN, schedule: [], linkedScheduleIds: [], history: [], ...change });

describe("history view: the current rate comes from the history, upcoming ones are listed", () => {
    const history = [entry("e0", "2026-01-10", 12, { source: "INITIAL" }), entry("e1", "2026-03-01", 13), entry("e2", "2026-09-01", 14)];
    const render = (today: string) => renderToStaticMarkup(createElement(InterestRateHistoryView, { loan: LOAN, available: true, history, today }));

    it("before an upcoming date: today's rate (not the stale stored 9%), with the upcoming one", () => {
        const html = render("2026-06-15");
        expect(html).toContain('data-current-basis="HISTORY"');
        expect(html).toMatch(/Current interest rate.*?13%/s);
        expect(html).not.toMatch(/Current interest rate<\/div><div[^>]*>9%/);
        expect(html).toContain('data-upcoming="1"');
        expect(html).toContain("Not in force until its date");
    });

    it("on the upcoming date it becomes current and is no longer upcoming", () => {
        const html = render("2026-09-01");
        expect(html).toMatch(/Current interest rate.*?14%/s);
        expect(html).not.toContain("data-upcoming=");
    });
});

describe("record form: the baseline of a loan with no history is stated, never hidden", () => {
    it("says the stored rate is recorded as the original rate from the start date", () => {
        const ctx = context();
        const html = renderToStaticMarkup(createElement(RateChangeForm, { context: ctx, input: emptyRateChangeInput(ctx), issues: [], onChange: vi.fn() }));
        expect(html).toContain('data-baseline="loan-terms"');
        expect(html).toContain("its recorded rate (9%) is saved as its original rate from its start date");
        expect(html).not.toContain("rate-change-reason");
    });

    it("a change from the start date asks for a reason and hides the source (it is the original rate)", () => {
        const ctx = context();
        const input: RateChangeInput = { ...emptyRateChangeInput(ctx), rate: 11, effectiveFrom: "2026-01-10" };
        const html = renderToStaticMarkup(createElement(RateChangeForm, { context: ctx, input, issues: [], onChange: vi.fn() }));
        expect(html).toContain("rate-change-reason");
        expect(html).not.toContain("rate-change-source");
        expect(html).toContain("replaces that recorded rate");
    });

    it("no baseline note once the loan has history", () => {
        const ctx = context({ history: [entry("e0", "2026-01-10", 12, { source: "INITIAL" })] });
        const html = renderToStaticMarkup(createElement(RateChangeForm, { context: ctx, input: emptyRateChangeInput(ctx), issues: [], onChange: vi.fn() }));
        expect(html).not.toContain("data-baseline");
    });
});

describe("review: what the save records first", () => {
    it("shows the original rate recorded in the same save, and when it is then replaced", () => {
        const ctx = context();
        const input: RateChangeInput = { ...emptyRateChangeInput(ctx), rate: 11, effectiveFrom: "2026-01-10", correctionReason: "Sanction letter" };
        const result = prepareRateChange(ctx, input, { newId: (() => { let n = 0; return () => `id-${++n}`; })(), now: "2026-06-01T00:00:00Z" });
        if (result.status !== "READY") throw new Error("expected READY");
        const html = renderToStaticMarkup(
            createElement(RateChangeReview, {
                input,
                mode: result.mode,
                proposal: result.proposal,
                warnings: result.warnings,
                oldRate: result.oldRate,
                baseline: { rate: result.request.initialEntry!.rate, effectiveFrom: result.request.initialEntry!.effectiveFrom, replaced: result.request.supersedes?.id === result.request.initialEntry!.id },
            })
        );
        expect(html).toContain('data-review-baseline="true"');
        expect(html).toContain("Recorded first, in the same save: 9%");
        expect(html).toContain("marked corrected and replaced");
    });
});
