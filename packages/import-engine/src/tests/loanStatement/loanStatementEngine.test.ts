import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
    analyseLoanStatement,
    buildExtension,
    documentFromItems,
    documentFromLayoutText,
    readStatementPdf,
    type FacilityExtraction,
    type LenderProfile,
    type LoanStatementAnalysis,
    type RawTextItem,
} from "../../loanStatement";

// Every statement below is invented and printed in a different layout, on
// purpose: none of them may need any lender-specific code. Expected values
// are written by hand from the statement text, never copied from output.

function analyse(text: string, profiles?: LenderProfile[]): LoanStatementAnalysis {
    return analyseLoanStatement(documentFromLayoutText(text), { profiles });
}

function only(text: string): FacilityExtraction {
    const analysis = analyse(text);
    expect(analysis.status).toBe("OK");
    expect(analysis.facilities).toHaveLength(1);

    return analysis.facilities[0]!;
}

const value = (facility: FacilityExtraction, id: keyof FacilityExtraction["fields"]) => facility.fields[id]?.value ?? null;

const TERM = `
Northwind Bank Limited
Term Loan Statement

Borrower Name : Asha Rao
Loan Account No : LN-44120
Sanctioned Amount : Rs. 10,00,000.00
Date of Sanction : 10-Jan-2025
Rate of Interest : 12.00% p.a.
Interest Type : Floating
Tenure : 3 Years
EMI Amount : Rs. 33,214.00
First EMI Date : 05-Mar-2025
Repayment Frequency : Monthly
Principal Outstanding : 9,50,000.00

Disbursal Date     Gross Amount    Net Amount    Deductions
12/02/2025         10,00,000.00    9,82,300.00   17,700.00

Charge Type            Amount
Processing Fee         15,000.00
GST                    2,700.00

Inst No   Due Date     Opening       Principal    Interest    EMI        Closing
1         05/03/2025   1000000.00    23214.00     10000.00    33214.00   976786.00
2         05/04/2025   976786.00     23446.14     9767.86     33214.00   953339.86
3         05/05/2025   953339.86     23680.60     9533.40     33214.00   929659.26

Date         Particulars              Debit        Credit       Balance
05/03/2025   EMI received NACH                     33,214.00    966,786.00
05/04/2025   EMI received NACH                     33,214.00    933,572.00
05/05/2025   EMI received NACH                     33,214.00    900,358.00
`;

const OVERDRAFT = `
Fabrikam Finance Ltd
Overdraft Account Statement

OD Account Number      900112233
Sanctioned Limit       25,00,000.00     Drawing Power        20,00,000.00
Available Limit        12,00,000.00     Utilised Amount      8,00,000.00
Rate of Interest       11.25            Limit Expiry Date    31/03/2027

Date        Narration                       Withdrawal    Deposit      Balance
01/04/2026  Opening Balance                                            5,00,000.00 Dr
03/04/2026  Drawdown to current account     4,00,000.00                9,00,000.00 Dr
10/04/2026  Repayment RTGS                                3,00,000.00  6,00,000.00 Dr
18/04/2026  Drawdown to current account     2,00,000.00                8,00,000.00 Dr
30/04/2026  Interest charged April          7,123.00                   8,07,123.00 Dr
30/04/2026  Interest recovered                            7,123.00     8,00,000.00 Dr
`;

const DROPLINE = `
Contoso Capital
Dropline Overdraft Facility - Statement

Facility Number: DOD-7781
Original Sanctioned Limit: 1,00,00,000
Current Drawing Power: 90,00,000
Utilised Balance: 40,00,000
Maturity Date: 31-Dec-2030

Reduction Date   Reduced Drawing Limit
01-Jan-2026      95,00,000
01-Apr-2026      90,00,000
01-Jul-2026      85,00,000
01-Oct-2026      80,00,000

Date        Details                 Debit       Credit      Balance
02-Apr-2026 Drawdown                5,00,000                45,00,000
08-Apr-2026 Repayment NEFT                      5,00,000    40,00,000
`;

const CASH_CREDIT = `
Woodgrove Co-operative Bank
Cash Credit Account

CC Account No. 55001
CC Limit         75,00,000.00
Drawing Power    60,00,000.00
Stock Value      80,00,000.00
Book Debts       20,00,000.00
Margin           25
Last Stock Statement Date   30/06/2026
Drawing power is based on the stock statement and book debts submitted monthly.
Drawing power revised to Rs 60,00,000 w.e.f. 01/07/2026

Date         Particulars        Dr            Cr            Balance
01/07/2026   Opening Balance                                30,00,000.00 Dr
05/07/2026   Supplier payment   2,00,000.00                 32,00,000.00 Dr
09/07/2026   Sales collection                 1,50,000.00   30,50,000.00 Dr
`;

const DEMAND = `
Tailspin Bank Limited
Working Capital Demand Loan

Loan Account Number   DL/2026/19
Loan Amount           50,00,000
Rate of Interest      9.75
Repayable on demand.
Principal Outstanding 50,00,000
`;

const UNFAMILIAR_REVOLVING = `
ACCOUNT SNAPSHOT
Facility ID      A-19
Limit            30,00,000
Undrawn          10,00,000

Date          Particulars               Debit        Credit       Balance
01/02/2026    Drawal - payment run      5,00,000                  15,00,000
06/02/2026    Payment received                       2,00,000     13,00,000
11/02/2026    Drawal - payment run      4,00,000                  17,00,000
19/02/2026    Payment received                       3,00,000     14,00,000
25/02/2026    Drawal - payment run      6,00,000                  20,00,000
`;

describe("each facility type, each in its own invented layout", () => {
    it("term loan: identifiers, terms, disbursement, charges, schedule, history", () => {
        const facility = only(TERM);

        expect(facility.classification.detected).toBe("TERM_LOAN");
        expect(facility.classification.confidence).toBe("HIGH");
        expect(facility.classification.confirmationRequired).toBe(false);
        expect(value(facility, "lenderName")).toBe("Northwind Bank Limited");
        expect(value(facility, "loanAccountNumber")).toBe("LN-44120");
        expect(value(facility, "sanctionedAmount")).toBe(1000000);
        expect(value(facility, "sanctionDate")).toBe("2025-01-10");
        expect(value(facility, "interestRate")).toBe(12);
        expect(value(facility, "tenureMonths")).toBe(36);
        expect(value(facility, "emiAmount")).toBe(33214);
        expect(value(facility, "firstInstalmentDate")).toBe("2025-03-05");
        expect(value(facility, "outstandingPrincipal")).toBe(950000);

        expect(facility.disbursements).toEqual([expect.objectContaining({ date: "2025-02-12", gross: 1000000, net: 982300, deductions: 17700 })]);
        expect(facility.charges.map(c => [c.category, c.amount])).toEqual([["PROCESSING_FEE", 15000], ["GST", 2700]]);

        expect(facility.schedule).toHaveLength(3);
        expect(facility.schedule[1]).toMatchObject({ installmentNumber: 2, dueDate: "2025-04-05", principal: 23446.14, interest: 9767.86, emi: 33214, closingPrincipal: 953339.86 });
        expect(facility.extension).toMatchObject({ type: "TERM_LOAN" });
    });

    it("overdraft: limit, drawing power, utilised, and a stated opening balance", () => {
        const facility = only(OVERDRAFT);

        expect(facility.classification.detected).toBe("OVERDRAFT");
        expect(value(facility, "sanctionedAmount")).toBe(2500000);
        expect(value(facility, "drawingPower")).toBe(2000000);
        expect(value(facility, "availableAmount")).toBe(1200000);
        expect(value(facility, "currentUtilised")).toBe(800000);
        expect(value(facility, "maturityDate")).toBe("2027-03-31");
        expect(value(facility, "openingUtilised")).toBe(500000);
        expect(facility.fields.openingUtilised?.provenance).toBe("SOURCE");
        expect(facility.ledgerCheck).toMatchObject({ mismatches: 0, closing: 800000 });
        expect(facility.ledgerSummary).toMatchObject({ drawdownCount: 2, drawdownTotal: 600000, repaymentCount: 1, repaymentTotal: 300000, interestChargedTotal: 7123, interestPaidTotal: 7123 });
        expect(facility.extension).toMatchObject({ type: "OVERDRAFT" });
        // The limit is never a principal, and there is no EMI to invent.
        expect(facility.fields.emiAmount?.value ?? null).toBeNull();
        expect(facility.schedule).toEqual([]);
    });

    it("dropline overdraft: reduction schedule, frequency, never plain OD", () => {
        const facility = only(DROPLINE);

        expect(facility.classification.detected).toBe("DROPLINE_OVERDRAFT");
        expect(value(facility, "sanctionedAmount")).toBe(10000000);
        expect(value(facility, "drawingPower")).toBe(9000000);
        expect(value(facility, "currentUtilised")).toBe(4000000);
        expect(value(facility, "reductionFrequency")).toBe("Quarterly");
        expect(facility.fields.reductionFrequency?.provenance).toBe("CALCULATED");
        expect(value(facility, "initialDrawingPower")).toBe(9500000);

        expect(facility.extension.type).toBe("DROPLINE_OVERDRAFT");
        if (facility.extension.type === "DROPLINE_OVERDRAFT") {
            expect(facility.extension.reductionSchedule.map(c => [c.effectiveDate, c.amount])).toEqual([
                ["2026-01-01", 9500000],
                ["2026-04-01", 9000000],
                ["2026-07-01", 8500000],
                ["2026-10-01", 8000000],
            ]);
        }
    });

    it("cash credit: drawing power basis and revisions", () => {
        const facility = only(CASH_CREDIT);

        expect(facility.classification.detected).toBe("CASH_CREDIT");
        expect(value(facility, "sanctionedAmount")).toBe(7500000);
        expect(value(facility, "drawingPower")).toBe(6000000);
        expect(value(facility, "stockValue")).toBe(8000000);
        expect(value(facility, "bookDebts")).toBe(2000000);
        expect(value(facility, "stockStatementDate")).toBe("2026-06-30");
        expect(facility.drawingPowerReferences.length).toBeGreaterThan(0);
        expect(facility.limitChanges).toEqual([expect.objectContaining({ subject: "DRAWING_POWER", amount: 6000000, effectiveDate: "2026-07-01", nature: "REVISION" })]);
        expect(facility.ledgerCheck).toMatchObject({ mismatches: 0, closing: 3050000 });
    });

    it("demand loan: named by wording, nothing forced into a schedule", () => {
        const facility = only(DEMAND);

        expect(facility.classification.detected).toBe("DEMAND_LOAN");
        expect(value(facility, "outstandingPrincipal")).toBe(5000000);
        expect(value(facility, "interestRate")).toBe(9.75);
        expect(facility.schedule).toEqual([]);
        expect(facility.extension.type).toBe("DEMAND_LOAN");
    });
});

describe("unfamiliar layouts", () => {
    it("recognises a revolving facility from structure when it is never named, and asks", () => {
        const facility = only(UNFAMILIAR_REVOLVING);

        expect(facility.classification.detected).toBe("OVERDRAFT");
        expect(facility.classification.confirmationRequired).toBe(true);
        expect(facility.classification.confidence).not.toBe("HIGH");
        expect(value(facility, "sanctionedAmount")).toBe(3000000);
        expect(facility.ledgerSummary.drawdownCount).toBe(3);
        expect(facility.ledgerCheck?.mismatches).toBe(0);
    });

    it("does not call a revolving facility a term loan for its interest and repayments", () => {
        expect(only(UNFAMILIAR_REVOLVING).classification.scores.TERM_LOAN).toBe(0);
    });

    it("reads labels above their values", () => {
        const facility = only(`
Term Loan Advice

Loan Account Number    Loan Amount     Rate of Interest    Tenure
7788-11                6,00,000        10.50               24
`);

        expect(value(facility, "loanAccountNumber")).toBe("7788-11");
        expect(value(facility, "sanctionedAmount")).toBe(600000);
        expect(value(facility, "interestRate")).toBe(10.5);
        expect(value(facility, "tenureMonths")).toBe(24);
    });

    it("reads month-first dates when the document proves that order", () => {
        const facility = only(`
Overdraft Statement
OD Account Number 123456
Sanctioned Limit 500000
Limit Expiry Date 01/31/2027
Sanction Date 03/04/2026
`);

        expect(value(facility, "maturityDate")).toBe("2027-01-31");
        expect(value(facility, "sanctionDate")).toBe("2026-03-04");
    });

    it("follows a bank-side ledger whose balance goes more negative as money is drawn", () => {
        const facility = only(`
Overdraft Statement
OD Account Number 123456
Sanctioned Limit 500000

Date         Narration       Debit        Credit       Balance
01/05/2026   Drawdown        1,00,000.00               -1,00,000.00
02/05/2026   Drawdown        50,000.00                 -1,50,000.00
03/05/2026   Repayment                    25,000.00    -1,25,000.00
`);

        expect(facility.ledgerCheck).toMatchObject({ mismatches: 0, closing: 125000 });
        expect(value(facility, "currentUtilised")).toBe(125000);
        expect(facility.ledgerSummary.drawdownCount).toBe(2);
    });
});

describe("incomplete and conflicting statements", () => {
    it("keeps missing facts missing and does not force a type", () => {
        const facility = only(`
Customer Name   Priya N
Loan Account Number   A1001
`);

        expect(facility.classification.detected).toBe("OTHER_UNKNOWN");
        expect(facility.classification.confirmationRequired).toBe(true);
        expect(facility.missing).toContain("sanctionedAmount");
        expect(facility.fields.interestRate?.value ?? null).toBeNull();
        expect(facility.fields.sanctionedAmount?.value ?? null).toBeNull();
    });

    it("never reads an interest rate or amount out of a sentence", () => {
        const facility = only(`
Overdraft Statement
OD Account Number 123456
We also offer term loans at 9.99% interest for amounts up to 50,00,000. Ask your branch for details of our range.
`);

        expect(facility.fields.interestRate?.value ?? null).toBeNull();
        expect(facility.classification.scores.TERM_LOAN).toBe(0);
    });

    it("reports different values for a field across pages instead of picking one", () => {
        const facility = only(`
Term Loan Statement
Loan Account Number   A1001
Sanctioned Amount     5,00,000
\fTerm Loan Statement
Loan Account Number   A1001
Sanctioned Amount     5,50,000
`);
        const field = facility.fields.sanctionedAmount!;

        expect(field.status).toBe("CONFLICT");
        expect(field.value).toBeNull();
        expect(field.alternatives.map(a => [a.value, a.sources[0]!.page])).toEqual([[500000, 1], [550000, 2]]);
        expect(facility.conflicts.some(c => c.fieldId === "sanctionedAmount")).toBe(true);
    });

    it("flags a summary that disagrees with the ledger", () => {
        const facility = only(`
Overdraft Statement
OD Account Number 123456
Total Outstanding 9,99,999.00

Date         Narration       Debit        Credit       Balance
01/05/2026   Drawdown        1,00,000.00               1,00,000.00
`);

        expect(facility.conflicts.some(c => c.fieldId === "totalOutstanding")).toBe(true);
    });

    it("flags a term loan whose outstanding principal is not disbursed less principal repaid, and keeps every figure", () => {
        const facility = only(`
Term Loan Statement
Loan Account No : LN-50001
EMI Amount : 20,000.00
Amount Disbursed : 5,00,000.00
Principal Repaid : 60,000.00
Principal Outstanding : 4,50,000.00
`);

        const finding = facility.conflicts.find(c => c.message.startsWith("The outstanding principal does not equal"));
        expect(finding?.values.map(v => v.value)).toEqual([450000, 440000]);
        expect(value(facility, "outstandingPrincipal")).toBe(450000);
        expect(value(facility, "principalRepaidTotal")).toBe(60000);
        expect(facility.fields.outstandingPrincipal?.status).toBe("FOUND");
    });

    it("flags net disbursed plus deductions that does not make the gross", () => {
        const facility = only(`
Term Loan Statement
Loan Account No : LN-50002
EMI Amount : 20,000.00

Disbursal Date     Gross Amount    Net Amount    Deductions
12/02/2025         5,00,000.00     4,90,000.00   9,000.00
`);

        const finding = facility.conflicts.find(c => c.fieldId === "netDisbursed");
        expect(finding?.values.map(v => v.value)).toEqual([500000, 499000]);
        expect(value(facility, "grossDisbursed")).toBe(500000);
    });

    it("raises no arithmetic finding when the term figures agree", () => {
        const facility = only(TERM);
        expect(facility.conflicts.filter(c => c.fieldId === "netDisbursed" || c.message.startsWith("The outstanding principal does not equal"))).toEqual([]);
    });

    it("flags a row that breaks the running balance and withholds calculated figures", () => {
        const facility = only(`
Overdraft Statement
OD Account Number 123456

Date         Narration       Debit        Credit       Balance
01/05/2026   Drawdown        1,00,000.00               1,00,000.00
02/05/2026   Drawdown        50,000.00                 1,70,000.00
03/05/2026   Drawdown        10,000.00                 1,80,000.00
`);

        expect(facility.ledgerCheck?.mismatches).toBe(1);
        expect(facility.transactions.map(t => t.chainStatus)).toEqual(["NOT_CHECKED", "MISMATCH", "OK"]);
        expect(facility.fields.currentUtilised?.value ?? null).toBeNull();
        expect(facility.extractionConfidence).toBe("LOW");
    });

    it("names conflicting wording rather than settling it silently", () => {
        const facility = only(`
Term Loan Statement
Overdraft Account Summary
Loan Account Number   A1001
`);

        expect(facility.classification.confirmationRequired).toBe(true);
        expect(facility.classification.conflictingEvidence.length).toBeGreaterThan(0);
    });

    it("says so when a PDF has no text", () => {
        const analysis = analyseLoanStatement(documentFromItems([[], []]));

        expect(analysis.status).toBe("NO_TEXT_LAYER");
        expect(analysis.facilities).toEqual([]);
    });
});

describe("multiple facilities in one PDF", () => {
    const COMBINED = `
Northwind Bank Limited
Customer Name   Asha Rao

Term Loan Details
Loan Account Number   TL-1
Sanctioned Amount     5,00,000
EMI Amount            12,000
Rate of Interest      11

Overdraft Details
OD Account Number     OD-2
Sanctioned Limit      2,00,000
Drawing Power         1,50,000
Rate of Interest      13

Date         Narration       Debit        Credit       Balance
01/05/2026   Drawdown        50,000.00                 50,000.00
`;

    it("separates them, classifies each, and shares only who and by whom", () => {
        const analysis = analyse(COMBINED);

        expect(analysis.facilities).toHaveLength(2);

        const [term, od] = analysis.facilities;

        expect(term!.classification.detected).toBe("TERM_LOAN");
        expect(value(term!, "loanAccountNumber")).toBe("TL-1");
        expect(value(term!, "interestRate")).toBe(11);
        expect(term!.transactions).toEqual([]);

        expect(od!.classification.detected).toBe("OVERDRAFT");
        expect(value(od!, "loanAccountNumber")).toBe("OD-2");
        expect(value(od!, "drawingPower")).toBe(150000);
        expect(value(od!, "interestRate")).toBe(13);
        expect(od!.transactions).toHaveLength(1);
        expect(value(od!, "customerName")).toBe("Asha Rao");
    });

    it("treats a second account number with nothing of its own as a conflict", () => {
        const facility = only(`
Term Loan Statement
Loan Account Number   A1001
Sanctioned Amount     5,00,000
EMI Amount            10,000

Loan Account Number   A1002
`);

        expect(facility.fields.loanAccountNumber?.status).toBe("CONFLICT");
    });
});

describe("corrections and adapters", () => {
    it("rebuilds the type-specific view when the customer corrects the type", () => {
        const facility = only(OVERDRAFT);

        expect(buildExtension(facility, "CASH_CREDIT").type).toBe("CASH_CREDIT");
        expect(buildExtension(facility, "TERM_LOAN").type).toBe("TERM_LOAN");
    });

    it("runs generically with no profile, and an adapter only adds to it", () => {
        const text = `
Overdraft Statement
OD Account Number 123456
Sanctn Ceil Amt 700000
`;
        const profile: LenderProfile = {
            id: "acme",
            appliesTo: document => document.lines.some(line => line.cells.some(cell => cell.text.includes("Sanctn"))),
            labelAliases: { sanctionedAmount: [/^sanctn ceil amt$/] },
        };

        expect(analyse(text).facilities[0]!.fields.sanctionedAmount?.value ?? null).toBeNull();
        expect(analyse(text).profileId).toBeNull();

        const adapted = analyse(text, [profile]);

        expect(adapted.profileId).toBe("acme");
        expect(adapted.facilities[0]!.fields.sanctionedAmount?.value).toBe(700000);
    });
});

// ------------------------------------------------------- reference layout
//
// A revolving statement's layout - token positions, wrapped labels and a
// row split across a page break - carrying synthetic data only: an invented
// customer and accounts, and an invented ledger that reconciles row by row
// (drawn - repaid = outstanding; every interest debit is serviced; available
// = current limit - outstanding). One fixture among many - passing it says
// nothing about other lenders.

const here = dirname(fileURLToPath(import.meta.url));

type FixtureToken = [number, number, number, number, string];

function referenceFacility(adjust?: (tokens: FixtureToken[][]) => void): FacilityExtraction {
    const tokens = JSON.parse(readFileSync(join(here, "fixtures/revolving-reference.tokens.json"), "utf8")) as FixtureToken[][];
    adjust?.(tokens);
    const pages: RawTextItem[][] = tokens.map(page => page.map(([x, y, width, height, text]) => ({ x, y, width, height, text })));
    const analysis = analyseLoanStatement(documentFromItems(pages));

    expect(analysis.facilities).toHaveLength(1);

    return analysis.facilities[0]!;
}

describe("reference layout: multi-line labels and bare integer amounts", () => {
    it("reads the wrapped summary", () => {
        const facility = referenceFacility();

        expect(value(facility, "customerName")).toBe("EXAMPLE TRADERS");
        expect(value(facility, "lenderName")).toBe("Example Capital Limited");
        expect(value(facility, "sanctionedAmount")).toBe(36000000);
        expect(value(facility, "currentLimit")).toBe(33600000);
        expect(value(facility, "sanctionDate")).toBe("2026-01-31");
        expect(value(facility, "maturityDate")).toBe("2041-01-26");
        expect(value(facility, "tenureMonths")).toBe(180);
        expect(value(facility, "interestRate")).toBe(10.5);
        expect(value(facility, "currentInterestRate")).toBe(10.5);
        expect(value(facility, "outstandingPrincipal")).toBe(22145000);
        expect(facility.fields.outstandingPrincipal?.confidence).toBe("MEDIUM");
        expect(value(facility, "totalOutstanding")).toBe(22145000);
        expect(value(facility, "availableAmount")).toBe(11455000);
        expect(value(facility, "accruedInterest")).toBe(0);
        expect(value(facility, "loanAccountNumber")).not.toBe(value(facility, "linkedAccountNumber"));
    });

    it("does not take the tail of an unknown label for a known one", () => {
        // "Online Account Number" must not become a second loan account number.
        expect(referenceFacility().fields.loanAccountNumber?.status).toBe("FOUND");
    });

    it("reads every row, including the one split across a page break", () => {
        const facility = referenceFacility();

        expect(facility.transactions).toHaveLength(48);
        expect(facility.ledgerCheck).toMatchObject({ checkedRows: 46, mismatches: 0, opening: 0, closing: 22145000 });
        expect(facility.transactions.find(t => t.date === "2026-09-02")).toMatchObject({ amount: 135000, balance: 20235000, chainStatus: "OK" });
        expect(facility.ledgerSummary).toMatchObject({ drawdownCount: 37, repaymentCount: 3, interestChargedTotal: 324535, interestPaidTotal: 324535 });
    });

    it("treats a receipt equal to that day's interest debit as servicing the interest, and says it inferred that", () => {
        const receipt = referenceFacility().transactions.find(t => t.date === "2026-07-05" && t.side === "CREDIT")!;

        expect(receipt).toMatchObject({ kind: "INTEREST_PAYMENT", kindProvenance: "CALCULATED" });
    });

    it("is a revolving facility, and a linked term-loan number has no say in that", () => {
        const { classification } = referenceFacility();

        expect(classification.detected).toBe("OVERDRAFT");
        expect(classification.confidence).toBe("MEDIUM");
        expect(classification.scores.TERM_LOAN).toBe(0);
        expect([...classification.evidence, ...classification.conflictingEvidence].some(e => /linked/i.test(e.description + e.raw))).toBe(false);
    });

    it("asks whether it is a Dropline rather than deciding from a lowered limit alone", () => {
        const { classification } = referenceFacility();

        expect(classification.confirmationRequired).toBe(true);
        expect(classification.reasonForConfirmation).toMatch(/Dropline/);
        expect(classification.conflictingEvidence.some(e => e.supports.includes("DROPLINE_OVERDRAFT"))).toBe(true);
    });

    it("accepts an available amount that reconciles, and reports one that does not", () => {
        expect(referenceFacility().conflicts.some(c => c.fieldId === "availableAmount")).toBe(false);

        // The same statement with its printed Available Amount off by 5,00,000.
        const misprinted = referenceFacility(tokens => {
            const available = tokens[0]!.find(token => token[4] === "11455000")!;
            available[4] = "11955000";
        });

        expect(value(misprinted, "availableAmount")).toBe(11955000);
        expect(misprinted.conflicts.some(c => c.fieldId === "availableAmount")).toBe(true);
    });
});

// A real term-loan statement's token positions with its identity scrubbed
// (names, addresses, account and reference numbers) and every amount
// replaced by a synthetic loan that agrees with itself: 7,50,000 at 10.5%
// for 185 months, EMI 8,199, charges with 18% GST, ledger balances to 0.
function termReference(): FacilityExtraction {
    const tokens = JSON.parse(readFileSync(join(here, "fixtures/term-reference.tokens.json"), "utf8")) as Array<Array<[number, number, number, number, string]>>;
    const analysis = analyseLoanStatement(documentFromItems(tokens.map(page => page.map(([x, y, width, height, text]) => ({ x, y, width, height, text })))));

    expect(analysis.facilities).toHaveLength(1);

    return analysis.facilities[0]!;
}

describe("reference layout: term loan with an instalment ledger", () => {
    it("is a Term Loan, from the document's own words and structure", () => {
        const { classification } = termReference();

        expect(classification.detected).toBe("TERM_LOAN");
        expect(classification.confidence).toBe("HIGH");
        expect(classification.confirmationRequired).toBe(false);
        expect(classification.evidence.some(e => /non-revolving/i.test(e.description + (e.raw ?? "")))).toBe(true);
    });

    it("reads identifiers, including the account from the statement's title", () => {
        const facility = termReference();

        expect(value(facility, "lenderName")).toBe("EXAMPLE FINANCE LIMITED");
        expect(value(facility, "customerName")).toBe("Example Traders");
        expect(value(facility, "loanAccountNumber")).toBe("XLOAN0000000000000001");
        expect(value(facility, "agreementNumber")).toBe("10000001");
        expect(value(facility, "accountStatus")).toBe("Active");
        expect(facility.conflicts).toEqual([]);
    });

    it("does not take the repayment bank account for the loan account", () => {
        expect(termReference().fields.loanAccountNumber?.status).toBe("FOUND");
    });

    it("reads the terms from column headings wrapped over several lines", () => {
        const facility = termReference();

        expect(value(facility, "sanctionDate")).toBe("2026-01-30");
        expect(value(facility, "sanctionedAmount")).toBe(750000);
        expect(value(facility, "grossDisbursed")).toBe(750000);
        expect(value(facility, "disbursementDate")).toBe("2026-01-31");
        expect(value(facility, "emiAmount")).toBe(8199);
        expect(value(facility, "firstInstalmentDate")).toBe("2026-03-05");
        expect(value(facility, "tenureMonths")).toBe(185);
        expect(value(facility, "maturityDate")).toBe("2041-07-05");
        expect(value(facility, "repaymentFrequency")).toBe("Monthly");
    });

    it("reads floating interest, the benchmark and the dated rate change", () => {
        const facility = termReference();

        expect(value(facility, "interestTypeText")).toBe("Floating");
        expect(value(facility, "interestRate")).toBe(10.5);
        expect(value(facility, "currentInterestRate")).toBe(10.75);
        expect(value(facility, "benchmarkRateText")).toBe("11.75 / (1)");
        expect(facility.rateHistory).toEqual([expect.objectContaining({ effectiveDate: "2026-11-01", rate: 10.75, previousRate: 10.5 })]);
    });

    it("itemises the deductions and finds what was actually paid out", () => {
        const facility = termReference();

        expect(facility.charges.map(c => c.amount)).toEqual([7500, 1350, 2500, 450, 5000, 900, 100, 18, 20000]);
        expect(facility.charges.filter(c => c.category === "GST").map(c => c.amount)).toEqual([1350, 450, 900, 18]);
        expect(value(facility, "totalDeductions")).toBe(37818);
        expect(value(facility, "netDisbursed")).toBe(712182);
        expect(facility.disbursements).toEqual([expect.objectContaining({ date: "2026-01-31", gross: 750000, net: 712182, deductions: 37818 })]);
    });

    it("reads the nine payments, their references and the ledger's balance", () => {
        const facility = termReference();
        const receipts = facility.transactions.filter(t => t.kind === "REPAYMENT");

        expect(receipts).toHaveLength(9);
        expect(receipts.every(r => r.amount === 8199)).toBe(true);
        expect(receipts[8]).toMatchObject({ date: "2026-11-05", reference: "AUTXX0000000001/9" });
        expect(facility.ledgerCheck).toMatchObject({ mismatches: 0, checkedRows: 28 });
    });

    it("reports aggregate principal and interest without inventing an instalment split", () => {
        const facility = termReference();

        expect(value(facility, "principalRepaidTotal")).toBe(15093);
        expect(value(facility, "interestPaidTotal")).toBe(58698);
        expect(value(facility, "instalmentsPaid")).toBe(9);
        expect(value(facility, "instalmentsPaidAmount")).toBe(73791);
        expect(facility.transactions.every(t => t.principal === null && t.interest === null)).toBe(true);
        expect(facility.schedule).toEqual([]);
    });

    it("reads balances and confirms them against each other", () => {
        const facility = termReference();

        expect(value(facility, "outstandingPrincipal")).toBe(734907);
        expect(value(facility, "accruedInterest")).toBe(860);
        expect(value(facility, "totalOutstanding")).toBe(735767);
        expect(facility.fields.outstandingPrincipal?.verification).toBe("CROSS_CHECKED");
        expect(facility.fields.totalOutstanding?.verification).toBe("CROSS_CHECKED");
        expect(facility.fields.principalRepaidTotal?.verification).toBe("CROSS_CHECKED");
    });

    it("never reports an instalment ledger's billed dues as the loan balance", () => {
        expect(termReference().fields.currentUtilised?.value ?? null).toBeNull();
    });

    it("keeps a source page on every value", () => {
        for (const field of Object.values(termReference().fields)) {
            if (field?.status === "FOUND") expect(field.sources[0]?.page, field.id).toBeGreaterThan(0);
        }
    });
});

describe("other ledger behaviour", () => {
    it("keeps reversed and bounced receipts out of repayments", () => {
        const facility = only(`
Term Loan Statement
Loan Account Number A1001
EMI Amount 10,000

Date         Particulars              Debit        Credit       Balance
05/03/2026   EMI received NACH                     10,000.00    90,000.00
06/03/2026   Receipt reversal         10,000.00                 100,000.00
05/04/2026   Cheque bounced           10,000.00                 110,000.00
06/04/2026   Bounce charges           500.00                    110,500.00
`);

        expect(facility.transactions.map(t => t.kind)).toEqual(["REPAYMENT", "REVERSAL", "BOUNCED", "OTHER_CHARGE"]);
        expect(facility.ledgerSummary).toMatchObject({ repaymentCount: 1, reversalCount: 1, bouncedCount: 1 });
    });

    it("reads a dated rate revision in words", () => {
        const facility = only(`
Term Loan Statement
Loan Account Number A1001
ROI revised to 9.25% w.e.f. 01/04/2026
`);

        expect(facility.rateHistory).toEqual([expect.objectContaining({ rate: 9.25, effectiveDate: "2026-04-01", previousRate: null })]);
    });

    it("reads amounts in other currencies", () => {
        const facility = only(`
Term Loan Statement
Loan Account Number A1001
Currency: USD
Loan Amount: $125,000.00
`);

        expect(value(facility, "sanctionedAmount")).toBe(125000);
        expect(value(facility, "currencyCode")).toBe("USD");
    });
});

describe("the same document gives the same answer", () => {
    it("is deterministic, with no state between runs", () => {
        const first = JSON.stringify(analyse(TERM));
        analyse(OVERDRAFT);

        expect(JSON.stringify(analyse(TERM))).toBe(first);
    });

    it("takes nothing but the document", () => {
        expect(analyseLoanStatement.length).toBeLessThanOrEqual(2);
    });
});

const pdfFixture = (name: string) => new Uint8Array(Buffer.from(readFileSync(join(here, "fixtures", name), "utf8"), "base64"));

describe("PDF reader, using pdf.js's public API", () => {
    it("reads a plain PDF", async () => {
        const read = await readStatementPdf(pdfFixture("text.pdf.b64.txt"));
        if (read.status !== "OK") throw new Error(read.status);

        expect(analyseLoanStatement(read.document).facilities[0]!.classification.detected).toBe("OVERDRAFT");
    });

    it("asks for a password, rejects a wrong one, opens with the right one", async () => {
        expect((await readStatementPdf(pdfFixture("encrypted.pdf.b64.txt"))).status).toBe("PASSWORD_REQUIRED");
        expect((await readStatementPdf(pdfFixture("encrypted.pdf.b64.txt"), "wrong")).status).toBe("PASSWORD_INCORRECT");

        const read = await readStatementPdf(pdfFixture("encrypted.pdf.b64.txt"), "secret123");
        if (read.status !== "OK") throw new Error(read.status);

        expect(analyseLoanStatement(read.document).facilities[0]!.fields.loanAccountNumber?.value).toBe("123456");
    });

    it("says a scanned PDF could not be read, rather than returning nothing quietly", async () => {
        const read = await readStatementPdf(pdfFixture("scanned.pdf.b64.txt"));
        if (read.status !== "OK") throw new Error(read.status);

        const analysis = analyseLoanStatement(read.document);

        expect(analysis.status).toBe("SCANNED");
        expect(analysis.facilities).toEqual([]);
        expect(analysis.imageOnlyPages).toEqual([1]);
        expect(analysis.warnings[0]).toMatch(/scanned/);
    });

    it("warns about scanned pages inside an otherwise readable PDF", () => {
        const document = { ...documentFromLayoutText("Overdraft Statement\nOD Account Number 123456\nSanctioned Limit 500000"), imageOnlyPages: [2] };
        const analysis = analyseLoanStatement(document);

        expect(analysis.status).toBe("OK");
        expect(analysis.warnings[0]).toMatch(/Page\(s\) 2/);
    });
});

describe("real PDF reader (only where the file exists locally)", () => {
    const pdf = join(here, "../../../../../TATACapitalStatement.pdf");

    it.skipIf(!existsSync(pdf))("agrees with the anonymised fixture's structure", async () => {
        const read = await readStatementPdf(new Uint8Array(readFileSync(pdf)));
        if (read.status !== "OK") throw new Error(read.status);

        const facility = analyseLoanStatement(read.document).facilities[0]!;

        // No figure or identifier from the real statement is written here:
        // the checks are its structure and its own internal agreement.
        expect(facility.transactions).toHaveLength(48);
        expect(facility.ledgerCheck).toMatchObject({ mismatches: 0 });
        expect(facility.ledgerCheck.closing).toBe(value(facility, "totalOutstanding"));
        expect(facility.classification.detected).toBe("OVERDRAFT");
        // A numeric account number keeps its leading zero, as text.
        expect(value(facility, "loanAccountNumber")).toMatch(/^0\d{9}$/);
    }, 60000);
});

describe("the Term Loan statement itself (opt-in: FINWEA_TERM_REFERENCE_PDF, never committed)", () => {
    const pdf = process.env.FINWEA_TERM_REFERENCE_PDF ?? "";

    it.skipIf(!pdf || !existsSync(pdf))("matches the printed figures", async () => {
        const read = await readStatementPdf(new Uint8Array(readFileSync(pdf)));
        if (read.status !== "OK") throw new Error(read.status);

        const facility = analyseLoanStatement(read.document).facilities[0]!;

        // No figure or identifier from the real statement is written here:
        // each printed value is checked against the statement's own others.
        expect(facility.classification).toMatchObject({ detected: "TERM_LOAN", confidence: "HIGH" });

        const account = String(value(facility, "loanAccountNumber"));
        const agreement = String(value(facility, "agreementNumber"));
        expect(account).toMatch(/^[A-Z]{5}\d{16}$/);
        expect(agreement).toMatch(/^\d{8}$/);
        expect(account.endsWith(agreement)).toBe(true);

        const money = (id: keyof FacilityExtraction["fields"]) => {
            const amount = value(facility, id);
            expect(typeof amount, id).toBe("number");
            expect(amount as number, id).toBeGreaterThan(0);
            return amount as number;
        };
        expect(money("outstandingPrincipal") + money("accruedInterest")).toBe(money("totalOutstanding"));
        expect(money("grossDisbursed") - money("totalDeductions")).toBe(money("netDisbursed"));
        expect(facility.charges.reduce((sum, charge) => sum + charge.amount, 0)).toBe(money("totalDeductions"));
        expect(facility.fields.totalOutstanding?.verification).toBe("CROSS_CHECKED");
    }, 60000);
});

describe("separation from persistence", () => {
    const folder = join(here, "../../loanStatement");

    it("the engine imports only its own files, the money reader and pdf.js", () => {
        for (const name of readdirSync(folder)) {
            const source = readFileSync(join(folder, name), "utf8");
            const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map(match => match[1]!);

            for (const target of imports) {
                expect(`${name}: ${target}`).toMatch(/: (\.\/|\.\.\/normalizer\/moneyNormalizer$|pdfjs-dist\/)/);
            }
            expect(source, name).not.toMatch(/fetch\(|XMLHttpRequest|localStorage|\binvoke\(/);
        }
    });

    it("the engine has no lender in it", () => {
        for (const name of readdirSync(folder)) {
            const source = readFileSync(join(folder, name), "utf8").toLowerCase();

            expect(source, name).not.toMatch(/\btata\b|\bhdfc\b|\bicici\b|\baxis\b|\bsbi\b|\bbajaj\b/);
        }
    });
});
