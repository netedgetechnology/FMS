import { describe, expect, it, vi } from "vitest";

// Any database or Tauri call on these paths would land here.
const tauriInvoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriInvoke }));

import type { RateChange } from "@financeos/import-engine";

import { LoanKind } from "../types";
import {
    confirmedStatementRates,
    overdraftStatementRateHistoryFor,
    rateReviewFromFacility,
    rateReviewIssues,
    unrecordedChangeText,
    unrecordedChanges,
    unrecordedNotice,
    updateRateProposal,
    type RateLoanContext,
} from "./statementRateProposals";

// ---------------------------------------------------------------------
// Pre-activation audit (docs/loans/interest-rate-history-pre-activation-
// audit.md), findings M1 and H1. Synthetic statements only.
// ---------------------------------------------------------------------

const change = (effectiveDate: string | null, rate: number, previousRate: number | null = null): RateChange => ({
    effectiveDate,
    rate,
    previousRate,
    page: 2,
    raw: `${effectiveDate ?? ""} Interest rate changed to ${rate}%`,
    origin: "TEXT",
    datesInText: effectiveDate ? [effectiveDate] : [],
});

const OD = (loanRate: number): RateLoanContext => ({ loanKind: LoanKind.OVERDRAFT, startDate: "2026-04-01", loanRate, today: "2026-11-12" });
const TERM = (loanRate: number): RateLoanContext => ({ loanKind: LoanKind.TERM_LOAN, startDate: "2025-01-10", loanRate, today: "2026-11-12" });

const twoChanges = () => rateReviewFromFacility({ rateHistory: [change("2026-06-01", 11.75, 11.25), change("2026-09-01", 12, 11.75)] }, "Floating (MCLR)");
const allLeftOut = () => {
    let rates = twoChanges();
    for (const key of ["r-0", "r-1"]) rates = updateRateProposal(rates, key, { included: false });
    return rates;
};

describe("M1: an OD statement with every rate change left out can be saved", () => {
    it("sends no statement history at all - nothing is invented - so the loan is created as a typed-in one", () => {
        expect(overdraftStatementRateHistoryFor(allLeftOut(), OD(12), "synthetic-od.pdf")).toBeNull();
    });

    it("has no blocking issue, whatever the loan's own rate (the statement's original rate no longer applies)", () => {
        expect(rateReviewIssues(allLeftOut(), OD(12)).blocking).toEqual([]);
        expect(rateReviewIssues(allLeftOut(), OD(9.99)).blocking).toEqual([]);
    });

    it("still ignores an unresolved proposal once it is left out", () => {
        let rates = rateReviewFromFacility({ rateHistory: [change(null, 12)] }, null);
        expect(rateReviewIssues(rates, OD(12)).blocking).not.toEqual([]);
        rates = updateRateProposal(rates, "r-0", { included: false });
        expect(overdraftStatementRateHistoryFor(rates, OD(12), "s.pdf")).toBeNull();
    });

    it("with at least one change included, sends the confirmed history exactly as before", () => {
        const rates = updateRateProposal(twoChanges(), "r-0", { included: false });
        const history = overdraftStatementRateHistoryFor(rates, OD(12), "synthetic-od.pdf");
        expect(history).not.toBeNull();
        expect(history!.changes.map(item => [item.effectiveFrom, item.rate])).toEqual([["2026-09-01", 12]]);
        // The earliest INCLUDED change's printed previous rate (Stage 4 rule).
        expect(history!.originalRate).toBe(11.75);
    });

    it("keeps every existing validation: an included change that conflicts with the loan's rate still refuses", () => {
        expect(() => overdraftStatementRateHistoryFor(twoChanges(), OD(11), "s.pdf")).toThrow();
    });
});

describe("H1: Term follow-up changes are never dropped silently", () => {
    const confirmed = confirmedStatementRates(rateReviewFromFacility({ rateHistory: [change("2026-04-10", 10.25, 9.5), change("2026-08-10", 10.5, 10.25)] }, null), TERM(9.5), "synthetic-term.pdf");
    const [first, second] = confirmed.changes as [(typeof confirmed.changes)[0], (typeof confirmed.changes)[0]];

    it("lists every change that is pending or left out, in date order; recorded ones are not listed", () => {
        expect(unrecordedChanges(confirmed.changes, {}).map(item => item.key)).toEqual([first.key, second.key]);
        expect(unrecordedChanges(confirmed.changes, { [first.key]: "RECORDED" }).map(item => item.key)).toEqual([second.key]);
        expect(unrecordedChanges(confirmed.changes, { [first.key]: "SKIPPED" }).map(item => item.key)).toEqual([first.key, second.key]);
        expect(unrecordedChanges(confirmed.changes, { [first.key]: "RECORDED", [second.key]: "RECORDED" })).toEqual([]);
    });

    it("the notice names each unrecorded change and where to record it later; none when everything was recorded", () => {
        const notice = unrecordedNotice("SYN Home Loan", confirmed.changes);
        expect(notice).toContain("2 rate change(s) from the statement were NOT recorded for SYN Home Loan");
        expect(notice).toContain("10.25% from 10/04/2026; 10.5% from 10/08/2026");
        expect(notice).toContain("not saved anywhere");
        expect(notice).toContain("Record rate change");
        expect(unrecordedNotice("SYN Home Loan", [])).toBeNull();
        expect(unrecordedChangeText(first)).toBe("10.25% from 10/04/2026");
    });
});
