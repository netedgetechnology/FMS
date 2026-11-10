import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import { analyseLoanStatement, documentFromLayoutText } from "@financeos/import-engine";

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
