import { describe, expect, it } from "vitest";

import { analyseLoanStatement, documentFromLayoutText, type FacilityExtraction } from "../../loanStatement";

// Interest Rate History, Stage 4: the evidence each extracted rate change
// carries for the customer's review (how it was read, and every date on its
// line). Every statement here is invented; no real lender's layout.

function only(text: string): FacilityExtraction {
    const analysis = analyseLoanStatement(documentFromLayoutText(text));
    expect(analysis.status).toBe("OK");
    expect(analysis.facilities).toHaveLength(1);
    return analysis.facilities[0]!;
}

describe("extracted rate changes carry their evidence", () => {
    it("several narrated changes, printed out of date order, each with its line, page and dates", () => {
        const facility = only(`
Synthetic Bank Limited
Term Loan Statement
Loan Account Number SYN-RATE-01
Rate of Interest : 10.50% p.a.

01/11/2026 Interest rate changed from 10.75% to 11.00%
01/04/2026 Interest rate changed from 10.50% to 10.75%
`);

        expect(facility.rateHistory).toEqual([
            expect.objectContaining({ effectiveDate: "2026-11-01", rate: 11, previousRate: 10.75, origin: "TEXT", datesInText: ["2026-11-01"], page: 1 }),
            expect.objectContaining({ effectiveDate: "2026-04-01", rate: 10.75, previousRate: 10.5, origin: "TEXT", datesInText: ["2026-04-01"], page: 1 }),
        ]);
        expect(facility.rateHistory[0]!.raw).toContain("changed from 10.75% to 11.00%");
    });

    it("a line with two dates keeps both, so the review can show the date is ambiguous", () => {
        const facility = only(`
Term Loan Statement
Loan Account Number SYN-RATE-02
05/10/2026 Interest rate changed from 10.75% to 11.00% as per notice dated 20/09/2026
`);

        expect(facility.rateHistory).toEqual([expect.objectContaining({ effectiveDate: "2026-10-05", rate: 11, datesInText: ["2026-10-05", "2026-09-20"] })]);
    });

    it("a change with no date stays undated (never guessed)", () => {
        const facility = only(`
Term Loan Statement
Loan Account Number SYN-RATE-03
Interest rate changed from 11.00% to 11.50%
`);

        expect(facility.rateHistory).toEqual([expect.objectContaining({ effectiveDate: null, rate: 11.5, previousRate: 11, datesInText: [] })]);
    });

    it("a revision in words with no previous rate", () => {
        const facility = only(`
Term Loan Statement
Loan Account Number SYN-RATE-04
ROI revised to 9.25% w.e.f. 01/04/2026
`);

        expect(facility.rateHistory).toEqual([expect.objectContaining({ effectiveDate: "2026-04-01", rate: 9.25, previousRate: null, origin: "TEXT", datesInText: ["2026-04-01"] })]);
    });

    it("rows of a rate table are marked as table rows, with their own date only", () => {
        const facility = only(`
Overdraft Statement
Account Number SYN-RATE-06

Effective Date     Revised ROI
01/03/2026         11.50
01/07/2026         12.00
`);

        expect(facility.rateHistory).toEqual([
            expect.objectContaining({ effectiveDate: "2026-03-01", rate: 11.5, previousRate: null, origin: "TABLE", datesInText: ["2026-03-01"] }),
            expect.objectContaining({ effectiveDate: "2026-07-01", rate: 12, previousRate: null, origin: "TABLE", datesInText: ["2026-07-01"] }),
        ]);
    });

    it("a statement with no rate change has none", () => {
        const facility = only(`
Term Loan Statement
Loan Account Number SYN-RATE-05
Rate of Interest : 9.00% p.a.
EMI Amount : 10,000.00
`);

        expect(facility.rateHistory).toEqual([]);
    });
});
