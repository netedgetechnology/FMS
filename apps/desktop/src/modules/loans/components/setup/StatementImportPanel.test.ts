import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { analyseLoanStatement, documentFromItems, documentFromLayoutText } from "@financeos/import-engine";

import { createReviewState, editField, selectType, setConfirmed, type StatementReviewState } from "../../statementImport/statementReview";
import { ReviewView } from "./StatementImportPanel";

// No DOM test setup exists (vitest environment: "node"), so the review is
// rendered to static markup; its rules are in statementReview.test.ts.

function stateFrom(text: string, droplineEnabled?: boolean): StatementReviewState {
    return createReviewState(analyseLoanStatement(documentFromLayoutText(text)).facilities[0]!, "statement.pdf", droplineEnabled);
}

function render(state: StatementReviewState): string {
    return renderToStaticMarkup(createElement(ReviewView, { state, setState: vi.fn(), onContinue: vi.fn(), onBack: vi.fn() }));
}

const DROPLINE = `
Dropline Overdraft Facility
Facility Number: DOD-7781
Original Sanctioned Limit: 1,00,00,000
Current Drawing Power: 90,00,000
`;

const OVERDRAFT_WITH_RATE_CHANGE = `
Overdraft Account Statement
OD Account Number      900112233
Sanctioned Limit       25,00,000.00
Drawing Power          20,00,000.00
Rate of interest revised to 11.75% w.e.f. 01/07/2026

Date        Narration            Withdrawal    Deposit      Balance
03/04/2026  Drawdown             4,00,000.00                9,00,000.00 Dr
`;

describe("statement review screen", () => {
    it("shows the detected type, the reasons, and the unsupported notice while migration 053 is off", () => {
        const html = render(selectType(stateFrom(DROPLINE, false), "DROPLINE_OVERDRAFT"));

        expect(html).toContain("Dropline Overdraft (DOD)");
        expect(html).toContain("Why");
        expect(html).toContain("is not supported in FinWea yet");
        expect(html).toContain("database update 053");
        expect(html).not.toContain("I have checked the loan type");
    });

    it("shows where values came from and what the statement omits", () => {
        let state = selectType(stateFrom(OVERDRAFT_WITH_RATE_CHANGE), "OVERDRAFT");
        state = editField(state, "interestRate", 11.75);

        const html = render(setConfirmed(state, true));

        expect(html).toContain("From statement");
        expect(html).toContain("Calculated");
        expect(html).toContain("Entered by you");
        expect(html).toContain("Not in document");
        expect(html).toContain("Interest rate history");
        expect(html).toContain("11.75%");
        expect(html).toContain("never saved as transactions");
    });

    it("disables Continue while the type is unconfirmed", () => {
        const html = render(stateFrom(`
Limit 500000
Facility ID A1
`));

        expect(html).toContain("Confirm the loan type");
        expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\s*Continue to Add Loan/);
    });
});

describe("a Term Loan is completed and saved on Statement Review itself", () => {
    // The synthetic reference term loan - no real statement is read.
    function termState(): StatementReviewState {
        const path = join(__dirname, "../../../../../../../packages/import-engine/src/tests/loanStatement/fixtures/term-reference.tokens.json");
        const tokens = JSON.parse(readFileSync(path, "utf8")) as Array<Array<[number, number, number, number, string]>>;
        const facility = analyseLoanStatement(documentFromItems(tokens.map(page => page.map(([x, y, width, height, text]) => ({ x, y, width, height, text }))))).facilities[0]!;
        return createReviewState(facility, "term.pdf");
    }

    const renderDirect = (state: StatementReviewState) =>
        renderToStaticMarkup(createElement(ReviewView, { state, setState: vi.fn(), onContinue: vi.fn(), onBack: vi.fn(), onSaveTermLoan: vi.fn() }));

    it("ends in Confirm and Add Loan, never the Add Loan wizard", () => {
        const html = renderDirect(termState());

        expect(html).not.toContain("Continue to Add Loan");
        expect(html).not.toContain("Use them to fill the Add Loan form");
        expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\s*Confirm and Add Loan/);
    });

    it("adds only what the statement cannot give, then the schedule, past instalments and Statement Check", () => {
        const html = renderDirect(termState());

        expect(html).toContain("Needed by FinWea");
        expect(html).toContain("Not in the lender statement");
        for (const label of ["Loan Name", "EMI Debit Bank Account", "Credited To Account", "Bank credit (optional)"]) expect(html).toContain(label);
        // Statement figures are not asked for twice (the wizard's own inputs are absent).
        expect(html).not.toContain('id="setup-rate"');
        expect(html).not.toContain('id="setup-first-emi"');
        expect(html).toContain("Import lender schedule (CSV)");
        expect(html).toContain("Instalments Paid Before FinWea");
        expect(html).toContain("Statement Check");
        expect(html).toContain("I have checked these details against my sanction letter and statements");
    });

    it("offers the optional Additional Loan Details collapsed, and each charge's settlement", () => {
        const html = renderDirect(termState());

        expect(html).toMatch(/<details(?![^>]*\bopen\b)[^>]*>\s*<summary/);
        expect(html).toContain("Additional Loan Details");
        expect(html).toContain("Optional. Not in the lender statement");
        for (const label of ["Loan Purpose", "Payment Day of Month", "Grace Period (months)", "Balloon / Final Payment", "Broken-period First Instalment"]) expect(html).toContain(label);
        expect(html).toContain("How each charge was paid");
        expect(html).toContain("Paid How");
    });

    it("does not repeat the terms summary or the schedule table on the final review", () => {
        const html = renderDirect(termState());

        expect(html).not.toContain("Projected outstanding");
        expect(html).not.toContain("Unnamed");
        // The schedule appears once, in the Repayment Schedule section.
        expect(html.match(/>Repayment Schedule</g)).toHaveLength(1);
        expect(html).toContain("Statement Check");
        expect(html).toContain("Accounting Entries");
        expect(html).toContain("as of 09/11/2026");
        expect(html).not.toContain("as of 2026-11-09");
    });

    it("an Overdraft review still continues to the Add Loan wizard", () => {
        const html = renderDirect(selectType(termState(), "OVERDRAFT"));

        expect(html).toContain("Continue to Add Loan");
        expect(html).not.toContain("Confirm and Add Loan");
    });
});
