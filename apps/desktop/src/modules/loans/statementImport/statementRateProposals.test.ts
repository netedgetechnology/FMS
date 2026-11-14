import { describe, expect, it, vi } from "vitest";

// Any database or Tauri call on these paths would land here.
const tauriInvoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriInvoke }));

import { analyseLoanStatement, documentFromLayoutText, type FacilityExtraction, type RateChange } from "@financeos/import-engine";

import { LoanKind } from "../types";
import {
    chronological,
    confirmProposalDate,
    confirmedStatementRates,
    followUpProgress,
    overdraftStatementRateHistory,
    rateReviewFromFacility,
    rateReviewIssues,
    rateTypeFromInterestText,
    setOriginalRate,
    termRateChangeInputs,
    updateRateProposal,
    type RateLoanContext,
    type StatementRateReview,
} from "./statementRateProposals";
import { createReviewState, editOriginalRate, editRateProposal, selectType, setConfirmed } from "./statementReview";
import { reviewToDraft } from "./statementToDraft";

// ---------------------------------------------------------------------
// Interest Rate History, Stage 4: a statement's rate changes as proposed
// history entries. Synthetic statements and rows only.
// ---------------------------------------------------------------------

const change = (effectiveDate: string | null, rate: number, previousRate: number | null = null, extra: Partial<RateChange> = {}): RateChange => ({
    effectiveDate,
    rate,
    previousRate,
    page: 2,
    raw: `${effectiveDate ?? ""} Interest rate changed to ${rate}%`,
    origin: "TEXT",
    datesInText: effectiveDate ? [effectiveDate] : [],
    ...extra,
});

const review = (...rateHistory: RateChange[]) => rateReviewFromFacility({ rateHistory }, "Floating (MCLR)");

const OD_CONTEXT = (loanRate: number, today = "2026-11-12"): RateLoanContext => ({ loanKind: LoanKind.OVERDRAFT, startDate: "2026-04-01", loanRate, today });
const TERM_CONTEXT = (loanRate: number): RateLoanContext => ({ loanKind: LoanKind.TERM_LOAN, startDate: "2025-01-10", loanRate, today: "2026-11-12" });

const messages = (issues: { message: string }[]) => issues.map(issue => issue.message).join(" | ");

describe("every extracted change is a proposal, with its evidence", () => {
    it("keeps page, line, how it was read and every date; the original rate only from a printed previous rate", () => {
        const rates = review(change("2026-09-01", 12, 11.75), change("2026-06-01", 11.75, 11.25));

        expect(rates.proposals.map(p => [p.key, p.effectiveDate, p.rate, p.evidence.page, p.evidence.origin])).toEqual([
            ["r-0", "2026-09-01", 12, 2, "TEXT"],
            ["r-1", "2026-06-01", 11.75, 2, "TEXT"],
        ]);
        expect(rates.originalRate).toBe(11.25);
        expect(rates.originalRateFrom).toBe("STATEMENT");
        // Applied in date order, whatever order they were printed in.
        expect(chronological(rates).map(p => p.effectiveDate)).toEqual(["2026-06-01", "2026-09-01"]);
    });

    it("the rate type defaults to the statement's general interest type, labelled as such", () => {
        expect(rateTypeFromInterestText("Floating (MCLR)")).toBe("FLOATING");
        expect(rateTypeFromInterestText("Fixed")).toBe("FIXED");
        expect(rateTypeFromInterestText("")).toBeNull();
        const rates = review(change("2026-06-01", 11.75, 11.25));
        expect(rates.proposals[0]).toMatchObject({ rateType: "FLOATING", rateTypeFromStatement: true });
        expect(rateReviewFromFacility({ rateHistory: [change("2026-06-01", 11.75, 11.25)] }, null).proposals[0]).toMatchObject({ rateType: null, rateTypeFromStatement: false });
    });

    it("an exact duplicate line is left out automatically - recorded once, with a visible note", () => {
        const rates = review(change("2026-06-01", 11.75, 11.25), change("2026-06-01", 11.75, null, { origin: "TABLE", page: 3 }));

        expect(rates.proposals[1]).toMatchObject({ included: false, duplicateOf: "r-0" });
        const { blocking, warnings } = rateReviewIssues(rates);
        expect(blocking).toEqual([]);
        expect(messages(warnings)).toContain("printed again (page 2); it is left out so it is recorded once");
    });
});

describe("missing, ambiguous and conflicting dates stay unresolved - never invented", () => {
    it("no date: blocks until the customer enters one", () => {
        let rates = review(change(null, 11.5, 11));
        expect(rates.proposals[0]!.effectiveDate).toBe("");
        expect(messages(rateReviewIssues(rates).blocking)).toContain("gives no effective date");
        expect(() => confirmedStatementRates(rates, OD_CONTEXT(11.5), "s.pdf")).toThrow(/no effective date/);

        rates = updateRateProposal(rates, "r-0", { effectiveDate: "2026-06-01" });
        expect(rateReviewIssues(rates, OD_CONTEXT(11.5)).blocking).toEqual([]);
    });

    it("several dates on the line: the engine's pick is kept but unresolved until confirmed", () => {
        let rates = review(change("2026-10-05", 11, 10.75, { datesInText: ["2026-10-05", "2026-09-20"] }));
        expect(rates.proposals[0]).toMatchObject({ effectiveDate: "2026-10-05", dateConfirmed: false });
        expect(messages(rateReviewIssues(rates).blocking)).toContain("prints more than one date (05/10/2026, 20/09/2026)");

        rates = confirmProposalDate(rates, "r-0", "2026-09-20");
        expect(rates.proposals[0]).toMatchObject({ effectiveDate: "2026-09-20", dateConfirmed: true, edited: true });
        expect(rateReviewIssues(rates).blocking).toEqual([]);
    });

    it("two different rates on one date: both are flagged until one is corrected or left out", () => {
        let rates = review(change("2026-06-01", 11.75, 11.25), change("2026-06-01", 12, 11.25));
        const blocking = rateReviewIssues(rates).blocking;
        expect(blocking.filter(issue => issue.message.includes("Conflicting rates are dated 01/06/2026 (11.75% and 12%)")).map(issue => issue.key)).toEqual(["r-0", "r-1"]);

        rates = updateRateProposal(rates, "r-1", { included: false });
        expect(rateReviewIssues(rates).blocking).toEqual([]);
    });

    it("re-including a left-out duplicate is a conflict to resolve, not a silent double", () => {
        let rates = review(change("2026-06-01", 11.75, 11.25), change("2026-06-01", 11.75));
        rates = updateRateProposal(rates, "r-1", { included: true });
        expect(rates.proposals[1]!.duplicateOf).toBeNull();
        expect(messages(rateReviewIssues(rates).blocking)).toContain("listed twice on 01/06/2026");
    });

    it("no printed previous rate: the original rate is unresolved until entered", () => {
        let rates = review(change("2026-06-01", 11.75));
        expect(rates.originalRate).toBeNull();
        expect(rateReviewIssues(rates).blocking).toEqual([expect.objectContaining({ key: "original", message: expect.stringContaining("not stated") })]);

        rates = setOriginalRate(rates, 11.25);
        expect(rates.originalRateFrom).toBe("MANUAL");
        // A later correction never overwrites the customer's original rate.
        rates = updateRateProposal(rates, "r-0", { rate: 11.8 });
        expect(rates.originalRate).toBe(11.25);
        expect(rateReviewIssues(rates).blocking).toEqual([]);
    });
});

describe("validation against the timeline and the loan", () => {
    const rates = review(change("2026-06-01", 11.75, 11.25), change("2026-09-01", 12, 11.75), change("2027-01-01", 12.5, 12));

    it("a change on or before the start date is refused (that rate is the original rate)", () => {
        const early = updateRateProposal(rates, "r-0", { effectiveDate: "2026-04-01" });
        expect(messages(rateReviewIssues(early, OD_CONTEXT(12)).blocking)).toContain("on or before the loan's start date (01/04/2026)");
    });

    it("a rate equal to the one before it is no change", () => {
        const same = updateRateProposal(rates, "r-1", { rate: 11.75 });
        expect(messages(rateReviewIssues(same).blocking)).toContain("11.75% is already the rate before 01/09/2026");
    });

    it("a printed previous rate that disagrees with the timeline is a warning to check", () => {
        const corrected = updateRateProposal(rates, "r-0", { rate: 11.8 });
        expect(messages(rateReviewIssues(corrected).warnings)).toContain("statement says the rate before this change was 11.75%, but the rates above give 11.8%");
    });

    it("OD: the loan's rate must be the rate in force today - an upcoming change is not", () => {
        expect(rateReviewIssues(rates, OD_CONTEXT(12)).blocking).toEqual([]);
        expect(messages(rateReviewIssues(rates, OD_CONTEXT(12.5)).blocking)).toContain("rate in force today (12/11/2026) at 12%, but the loan's interest rate is 12.5%");
    });

    it("Term Loan: the loan's rate is what its schedule starts from, so it must be the original rate", () => {
        const term = rateReviewFromFacility({ rateHistory: [change("2026-04-10", 10.25, 9.5)] }, null);
        expect(rateReviewIssues(term, TERM_CONTEXT(9.5)).blocking).toEqual([]);
        expect(messages(rateReviewIssues(term, TERM_CONTEXT(10.25)).blocking)).toContain("is the rate its schedule starts from, but the original rate here is 9.5%");
    });

    it("left-out proposals are never checked or saved", () => {
        const bad = updateRateProposal(updateRateProposal(rates, "r-2", { rate: 500 }), "r-2", { included: false });
        expect(rateReviewIssues(bad, OD_CONTEXT(12)).blocking).toEqual([]);
        expect(confirmedStatementRates(bad, OD_CONTEXT(12), "s.pdf").changes.map(c => c.effectiveFrom)).toEqual(["2026-06-01", "2026-09-01"]);
    });
});

describe("what is saved", () => {
    const rates = review(change("2026-09-01", 12, 11.75), change("2026-06-01", 11.75, 11.25));

    it("the confirmed history is in date order, with the statement's evidence as reference and notes", () => {
        const confirmed = confirmedStatementRates(updateRateProposal(rates, "r-0", { rateType: "FIXED" }), OD_CONTEXT(12), "synthetic.pdf");

        expect(confirmed.originalRate).toBe(11.25);
        expect(confirmed.changes.map(c => [c.effectiveFrom, c.rate, c.rateType, c.reference])).toEqual([
            ["2026-06-01", 11.75, "FLOATING", "synthetic.pdf, page 2"],
            ["2026-09-01", 12, "FIXED", "synthetic.pdf, page 2"],
        ]);
        expect(confirmed.changes[0]!.notes).toBe('From the lender statement: "2026-06-01 Interest rate changed to 11.75%"');
        expect(confirmed.changes[1]!.notes).toMatch(/^From the lender statement \(corrected on review\)/);
    });

    it("OD / CC / DOD: the create request's history (original rate + changes)", () => {
        expect(overdraftStatementRateHistory(confirmedStatementRates(rates, OD_CONTEXT(12), "s.pdf"))).toEqual({
            originalRate: 11.25,
            changes: [
                expect.objectContaining({ effectiveFrom: "2026-06-01", rate: 11.75 }),
                expect.objectContaining({ effectiveFrom: "2026-09-01", rate: 12 }),
            ],
        });
    });

    it("Term Loan: each change is prefilled for the reviewed workflow - source statement, no recalculation chosen", () => {
        const term = rateReviewFromFacility({ rateHistory: [change("2026-04-10", 10.25, 9.5), change("2026-08-10", 10.5, 10.25)] }, "Floating");
        const inputs = termRateChangeInputs(confirmedStatementRates(term, TERM_CONTEXT(9.5), "s.pdf"));

        expect(inputs.map(item => item.input)).toEqual([
            expect.objectContaining({ rate: 10.25, effectiveFrom: "2026-04-10", source: "STATEMENT_IMPORT", option: null, rateType: "FLOATING" }),
            expect.objectContaining({ rate: 10.5, effectiveFrom: "2026-08-10", source: "STATEMENT_IMPORT", option: null }),
        ]);
    });

    it("the Term follow-up records strictly in date order: only the earliest pending change is next", () => {
        const confirmed = confirmedStatementRates(rateReviewFromFacility({ rateHistory: [change("2026-04-10", 10.25, 9.5), change("2026-08-10", 10.5, 10.25)] }, null), TERM_CONTEXT(9.5), "s.pdf");

        expect(followUpProgress(confirmed.changes, {})).toMatchObject({ next: { effectiveFrom: "2026-04-10" }, pending: 2 });
        expect(followUpProgress(confirmed.changes, { "r-0": "RECORDED" })).toMatchObject({ next: { effectiveFrom: "2026-08-10" }, pending: 1, recorded: 1 });
        expect(followUpProgress(confirmed.changes, { "r-0": "RECORDED", "r-1": "SKIPPED" })).toMatchObject({ next: null, pending: 0, skipped: 1 });
    });
});

// =====================================================================
// The pipeline from a synthetic PDF's text to the create request
// =====================================================================

function facilityFrom(text: string): FacilityExtraction {
    const analysis = analyseLoanStatement(documentFromLayoutText(text));
    expect(analysis.status).toBe("OK");
    return analysis.facilities[0]!;
}

const OD_WITH_RATES = `
Overdraft Account Statement
OD Account Number      SYN-OD-4401
Sanctioned Limit       25,00,000.00
Drawing Power          20,00,000.00
Rate of Interest       11.25
Interest Type          Floating
Date of Sanction       01/04/2026

01/09/2026 Interest rate changed from 11.75% to 12.00%
01/06/2026 Interest rate changed from 11.25% to 11.75%

Date        Narration            Withdrawal    Deposit      Balance
03/04/2026  Drawdown             4,00,000.00                9,00,000.00 Dr
10/04/2026  Repayment RTGS                     3,00,000.00  6,00,000.00 Dr
`;

const OD_NO_RATES = `
Overdraft Account Statement
OD Account Number      SYN-OD-4402
Sanctioned Limit       25,00,000.00
Drawing Power          20,00,000.00
Rate of Interest       11.25
Date of Sanction       01/04/2026

Date        Narration            Withdrawal    Deposit      Balance
03/04/2026  Drawdown             4,00,000.00                9,00,000.00 Dr
`;

describe("statement -> review -> draft: rate changes are carried as proposals only", () => {
    it("an OD statement's changes are reviewed, corrected and carried to the wizard, in date order", () => {
        // The customer confirms the type, as on the review.
        let state = selectType(createReviewState(facilityFrom(OD_WITH_RATES), "synthetic-od.pdf"), "OVERDRAFT");
        expect(state.rates.proposals).toHaveLength(2);
        expect(state.rates.originalRate).toBe(11.25);

        state = setConfirmed(state, true);
        state = editRateProposal(state, "r-0", { rateType: "FIXED" });
        expect(state.confirmed).toBe(false);
        state = editOriginalRate(setConfirmed(state, true), 11.25);
        expect(state.confirmed).toBe(false);

        const result = reviewToDraft(setConfirmed(state, true));
        expect(result.draft.interestRate).toBe(12);
        expect(result.rateHistory).toBe(state.rates);

        const confirmed = confirmedStatementRates(result.rateHistory as StatementRateReview, OD_CONTEXT(result.draft.interestRate!), "synthetic-od.pdf");
        expect(confirmed.changes.map(c => [c.effectiveFrom, c.rate, c.rateType])).toEqual([
            ["2026-06-01", 11.75, "FLOATING"],
            ["2026-09-01", 12, "FIXED"],
        ]);
        expect(tauriInvoke).not.toHaveBeenCalled();
    });

    it("a Term Loan statement's note says how its rate changes are handled - no longer that the schedule uses one rate", () => {
        const term = `
Synthetic Bank Limited
Term Loan Statement
Loan Account No : SYN-TL-7701
Sanctioned Amount : 6,00,000.00
Rate of Interest : 9.50% p.a.
EMI Amount : 9,806.39
First EMI Date : 10-Feb-2025
Tenure : 84 Months

10/04/2026 Interest rate changed from 9.50% to 10.25%

Disbursal Date     Gross Amount    Net Amount
10/01/2025         6,00,000.00     6,00,000.00
`;
        const state = selectType(createReviewState(facilityFrom(term), "synthetic-term.pdf"), "TERM_LOAN");
        const { notes, draft, rateHistory } = reviewToDraft(setConfirmed(state, true));
        const note = notes.find(text => text.startsWith("The rate changed from 9.5% to 10.25%"));

        expect(draft.interestRate).toBe(9.5);
        expect(rateHistory?.proposals).toHaveLength(1);
        expect(note).toContain("The loan is set up at the original 9.5% from its start date, so FinWea's schedule starts from that rate.");
        expect(note).toContain("each is recorded after the loan is created, with its revised schedule for you to confirm");
        expect(note).not.toContain("uses one rate");
    });

    it("a statement without rate changes is unchanged: no proposals, nothing carried", () => {
        const state = selectType(createReviewState(facilityFrom(OD_NO_RATES), "synthetic-od.pdf"), "OVERDRAFT");
        expect(state.rates).toEqual({ proposals: [], originalRate: null, originalRateFrom: null });
        expect(rateReviewIssues(state.rates)).toEqual({ blocking: [], warnings: [] });

        const result = reviewToDraft(setConfirmed(state, true));
        expect(result.rateHistory).toBeNull();
    });
});
