import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
    analyseLoanStatement,
    documentFromItems,
    documentFromLayoutText,
    type FacilityExtraction,
} from "@financeos/import-engine";

import { draftToCreateRequest, draftToDetails, emptyLoanSetupDraft, validateStep } from "../setup/loanSetupWizard";
import type { LoanSetupDraft } from "../setup/loanSetupTypes";
import { LoanKind } from "../types";
import {
    chooseAlternative,
    createReviewState,
    editField,
    reconciliationFindings,
    reviewBlockers,
    routeForType,
    selectType,
    setConfirmed,
    type StatementReviewState,
} from "./statementReview";
import { reviewToDraft } from "./statementToDraft";

// Any database or Tauri call anywhere on this path would land here.
const tauriInvoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriInvoke }));

function facilityFrom(text: string): FacilityExtraction {
    const analysis = analyseLoanStatement(documentFromLayoutText(text));

    expect(analysis.status).toBe("OK");

    return analysis.facilities[0]!;
}

function reviewOf(text: string): StatementReviewState {
    return createReviewState(facilityFrom(text), "statement.pdf");
}

const OD = `
Overdraft Account Statement
OD Account Number      900112233
Sanctioned Limit       25,00,000.00
Drawing Power          20,00,000.00
Rate of Interest       11.25
Date of Sanction       01/04/2026

Date        Narration            Withdrawal    Deposit      Balance
03/04/2026  Drawdown             4,00,000.00                9,00,000.00 Dr
10/04/2026  Repayment RTGS                     3,00,000.00  6,00,000.00 Dr
`;

const TERM = `
Northwind Bank Limited
Term Loan Statement
Loan Account No : LN-44120
Sanctioned Amount : 90,000.00
Rate of Interest : 12
EMI Amount : 30,600.00
First EMI Date : 05-Mar-2025
Product : Business Loan

Disbursal Date     Gross Amount    Net Amount
12/02/2025         90,000.00       88,200.00

Charge Type            Amount
Processing Fee         1,800.00

Inst No   Due Date     Principal    Interest    EMI        Closing
1         05/03/2025   29700.00     900.00      30600.00   60300.00
2         05/04/2025   30000.00     603.00      30603.00   30300.00
3         05/05/2025   30300.00     303.00      30603.00   0.00

Date         Particulars           Debit      Credit      Balance
05/03/2025   EMI received NACH                30,600.00   60,300.00
`;

const DOD = `
Dropline Overdraft Facility
Facility Number: DOD-7781
Original Sanctioned Limit: 1,00,00,000
Current Drawing Power: 90,00,000
`;

const CC = `
Cash Credit Account
CC Account No. 55001
CC Limit         75,00,000.00
Drawing Power    60,00,000.00
Drawing power is based on the stock statement and book debts submitted monthly.
`;

const DEMAND = `
Working Capital Demand Loan
Loan Account Number   DL/2026/19
Loan Amount           50,00,000
Repayable on demand.
`;

const CONFLICTING = `
Term Loan Statement
Loan Account Number   A1001
Sanctioned Amount     5,00,000
\fTerm Loan Statement
Sanctioned Amount     5,50,000
`;

describe("routing a confirmed type to an existing workflow", () => {
    it("opens the matching workflow for Term Loan and Overdraft", () => {
        expect(routeForType("TERM_LOAN")).toMatchObject({ kind: "WIZARD", loanKind: LoanKind.TERM_LOAN });
        expect(routeForType("OVERDRAFT")).toMatchObject({ kind: "WIZARD", loanKind: LoanKind.OVERDRAFT });
    });

    it("uses the revolving workflow for Cash Credit, labelled and with its limits stated", () => {
        const route = routeForType("CASH_CREDIT");

        expect(route).toMatchObject({ kind: "WIZARD", loanKind: LoanKind.OVERDRAFT, loanCategory: "Cash Credit" });
        expect(route.kind === "WIZARD" && route.limitations.length).toBeGreaterThan(0);
    });

    it.each(["DROPLINE_OVERDRAFT", "DEMAND_LOAN", "OTHER_UNKNOWN"] as const)("does not open any workflow for %s while migration 053 is off", type => {
        expect(routeForType(type, false).kind).toBe("UNSUPPORTED");
    });

    it("opens the Overdraft workflow as a Dropline once its database update is applied", () => {
        expect(routeForType("DROPLINE_OVERDRAFT", true)).toMatchObject({ kind: "WIZARD", loanKind: LoanKind.OVERDRAFT, loanCategory: "Dropline Overdraft", dropline: true });
    });

    it("states the minimum extension for the facilities FinWea cannot hold", () => {
        const dropline = routeForType("DROPLINE_OVERDRAFT", false);

        expect(dropline.kind === "UNSUPPORTED" && dropline.minimumExtension.join(" ")).toMatch(/database update 053/);
        expect(routeForType("DEMAND_LOAN").kind).toBe("UNSUPPORTED");
    });
});

describe("the customer's confirmation", () => {
    it("requires an active choice when the evidence is not conclusive", () => {
        const state = reviewOf(`
Sanctioned Amount 500000
Loan Account Number A1
`);

        expect(state.selectedType).toBeNull();
        expect(reviewBlockers(state)[0]).toMatch(/Confirm the loan type/);
        expect(() => reviewToDraft(state)).toThrow(/Confirm the loan type/);
    });

    it("allows correcting a detected type, and the corrected type decides the workflow", () => {
        const state = setConfirmed(selectType(reviewOf(CC), "OVERDRAFT"), true);
        const { draft } = reviewToDraft(state);

        expect(draft.loanKind).toBe(LoanKind.OVERDRAFT);
        expect(draft.loanCategory).toBe("Overdraft");
    });

    it("stops a Dropline Overdraft and never produces a draft for it while migration 053 is off", () => {
        const state = setConfirmed(createReviewState(facilityFrom(DOD), "statement.pdf", false), true);

        expect(state.facility.classification.detected).toBe("DROPLINE_OVERDRAFT");

        const chosen = setConfirmed(selectType(state, "DROPLINE_OVERDRAFT"), true);

        expect(reviewBlockers(chosen)[0]).toMatch(/cannot be set up/);
        expect(() => reviewToDraft(chosen)).toThrow();
    });

    it("stops a Demand Loan the same way", () => {
        const state = setConfirmed(selectType(reviewOf(DEMAND), "DEMAND_LOAN"), true);

        expect(() => reviewToDraft(state)).toThrow();
    });

    it("needs the final tick, and any later edit takes it back", () => {
        let state = selectType(reviewOf(OD), "OVERDRAFT");

        expect(reviewBlockers(state).join()).toMatch(/Tick the confirmation/);

        state = setConfirmed(state, true);
        expect(reviewBlockers(state)).toEqual([]);

        state = editField(state, "interestRate", 12);
        expect(state.confirmed).toBe(false);
    });

    it("blocks on conflicting values until the customer chooses one", () => {
        let state = setConfirmed(selectType(reviewOf(CONFLICTING), "TERM_LOAN"), true);

        expect(reviewBlockers(state).join()).toMatch(/different values/);

        state = chooseAlternative(state, "sanctionedAmount", state.fields.sanctionedAmount.alternatives[1]!);
        expect(state.fields.sanctionedAmount).toMatchObject({ value: 550000, status: "FOUND", provenance: "SOURCE" });
        expect(reconciliationFindings(state).some(item => item.fieldId === "sanctionedAmount")).toBe(false);
        expect(reviewBlockers(setConfirmed(state, true))).toEqual([]);
    });
});

describe("where each value came from", () => {
    it("distinguishes statement, calculated and customer-entered values", () => {
        let state = reviewOf(OD);

        expect(state.fields.drawingPower.provenance).toBe("SOURCE");
        expect(state.fields.currentUtilised.provenance).toBe("CALCULATED");
        expect(state.fields.maturityDate).toMatchObject({ provenance: null, status: "NOT_IN_DOCUMENT" });

        state = editField(state, "maturityDate", "2027-03-31");
        expect(state.fields.maturityDate).toMatchObject({ provenance: "MANUAL", status: "FOUND", value: "2027-03-31" });

        state = editField(state, "drawingPower", null);
        expect(state.fields.drawingPower).toMatchObject({ value: null, status: "NOT_IN_DOCUMENT" });
    });
});

describe("filling the Add Loan wizard", () => {
    it("fills an Overdraft draft without treating the limit as principal or inventing an EMI", () => {
        const { draft, notes } = reviewToDraft(setConfirmed(selectType(reviewOf(OD), "OVERDRAFT"), true));

        expect(draft).toMatchObject({
            loanKind: LoanKind.OVERDRAFT,
            loanAccountNumber: "900112233",
            creditLimit: 2500000,
            drawingPower: 2000000,
            interestRate: 11.25,
            startDate: "2026-04-01",
            openingUsed: 500000,
            openingUsedAsOf: "2026-04-02",
        });
        expect(draft.principalAmount).toBeNull();
        expect(draft.emiAmount).toBeNull();
        expect(draft.tenureMonths).toBeNull();
        expect(notes.join(" ")).toMatch(/Opening used was calculated/);
    });

    it("leaves opening used blank when the statement cannot give it, so the wizard asks", () => {
        const { draft } = reviewToDraft(setConfirmed(selectType(reviewOf(`
Overdraft Statement
OD Account Number 1234
Sanctioned Limit 500000
`), "OVERDRAFT"), true));

        expect(draft.openingUsed).toBeNull();
        expect(validateStep({ ...draft, odAccountIds: ["a"], openingUsedAsOf: "2026-01-01" } as LoanSetupDraft, "overdraft").map(i => i.field)).toContain("openingUsed");
    });

    it("fills a Term Loan draft: disbursement and deducted charges", () => {
        const { draft, notes } = reviewToDraft(setConfirmed(selectType(reviewOf(TERM), "TERM_LOAN"), true));

        expect(draft).toMatchObject({
            loanKind: LoanKind.TERM_LOAN,
            lenderName: "Northwind Bank Limited",
            loanCategory: "Business Loan",
            sanctionedAmount: 90000,
            interestRate: 12,
            startDate: "2025-02-12",
            emiAmount: 30600,
            firstEmiDate: "2025-03-05",
        });
        expect(draft.disbursements).toEqual([expect.objectContaining({ date: "2025-02-12", grossAmount: 90000, deductionsAmount: 1800, destinationAccountId: "", transaction: null })]);
        expect(draft.expenses).toEqual([expect.objectContaining({ expenseType: "PROCESSING_FEE", baseAmount: 1800, settlement: "DEDUCTED_FROM_DISBURSEMENT", transaction: null })]);
        // Existing rule: past payments are resolved one by one, never assumed.
        expect(draft.historicalCount).toBe(0);
        expect(notes.join(" ")).toMatch(/None are marked paid automatically/);
    });

    it("keeps a schedule printed in a PDF apart from the official CSV import", () => {
        const { draft, notes } = reviewToDraft(setConfirmed(selectType(reviewOf(TERM), "TERM_LOAN"), true));

        expect(draft.scheduleMethod).toBe("GENERATED");
        expect(draft.lenderSchedule).toBeNull();
        expect(notes.join(" ")).toMatch(/shown for checking only/);
    });

    it("hands the draft to the wizard's own validation, which still blocks what is missing", () => {
        const { draft } = reviewToDraft(setConfirmed(selectType(reviewOf(TERM), "TERM_LOAN"), true));
        const issues = validateStep(draft as LoanSetupDraft, "basics").map(i => i.field);

        // Not in any statement: the customer must give these in the wizard.
        expect(issues).toContain("name");
        expect(issues).toContain("linkedAccountId");
        expect(issues).toContain("currencyId");
        expect(issues).not.toContain("interestRate");
    });

    it("never carries a bank transaction link or creates a payment", () => {
        const { draft } = reviewToDraft(setConfirmed(selectType(reviewOf(TERM), "TERM_LOAN"), true));

        expect(draft.disbursements?.every(row => row.transaction === null)).toBe(true);
        expect(draft.expenses?.every(row => row.transaction === null)).toBe(true);
        expect(draft.historical).toEqual([]);
    });

    it("records Cash Credit's drawing-power references in the Notes", () => {
        const { draft, notes } = reviewToDraft(setConfirmed(selectType(reviewOf(CC), "CASH_CREDIT"), true));

        expect(draft.loanCategory).toBe("Cash Credit");
        expect(draft.notes).toMatch(/stock statement/);
        expect(notes.join(" ")).toMatch(/current drawing power/);
    });
});

function referenceDocument(name: string): FacilityExtraction {
    const path = join(__dirname, "../../../../../../packages/import-engine/src/tests/loanStatement/fixtures", name);
    const tokens = JSON.parse(readFileSync(path, "utf8")) as Array<Array<[number, number, number, number, string]>>;
    const analysis = analyseLoanStatement(documentFromItems(tokens.map(page => page.map(([x, y, width, height, text]) => ({ x, y, width, height, text })))));

    return analysis.facilities[0]!;
}

describe("the Term Loan reference, into the existing wizard", () => {
    const review = () => setConfirmed(createReviewState(referenceDocument("term-reference.tokens.json"), "term.pdf"), true);

    function completed() {
        const { draft } = reviewToDraft(review());

        return {
            ...emptyLoanSetupDraft(LoanKind.TERM_LOAN),
            ...draft,
            name: "Reference loan",
            currencyId: "inr",
            linkedAccountId: "bank",
            disbursements: draft.disbursements!.map(row => ({ ...row, destinationAccountId: "bank" })),
        } as LoanSetupDraft;
    }

    it("does not need the customer to confirm the type, but needs their confirmation of the details", () => {
        const state = createReviewState(referenceDocument("term-reference.tokens.json"), "term.pdf");

        expect(state.selectedType).toBe("TERM_LOAN");
        expect(reviewBlockers(state).join()).toMatch(/Tick the confirmation/);
    });

    it("passes the wizard's own validation once the customer adds what no statement holds", () => {
        const draft = completed();

        for (const step of ["basics", "disbursement", "expenses", "repayment", "schedule"] as const) {
            expect(validateStep(draft, step, "2026-11-10"), step).toEqual([]);
        }
    });

    it("counts deducted charges once: gross liability, net payout, no separate payment", () => {
        const details = draftToDetails(completed());

        expect(details.disbursements).toEqual([expect.objectContaining({ grossAmount: 750000, deductionsAmount: 37818, netAmount: 712182, transactionId: null })]);
        expect(details.expenses.reduce((sum, row) => sum + row.totalAmount, 0)).toBe(37818);
        expect(details.expenses.every(row => row.settlement === "DEDUCTED_FROM_DISBURSEMENT" && row.transactionId === null)).toBe(true);
    });

    it("marks nothing paid, even though the statement counts nine instalments paid", () => {
        const request = draftToCreateRequest(completed());

        expect(request.paidInstallments).toBe(0);
        expect(request.setup?.historicalInstalments).toEqual([]);
        expect(request.principalAmount).toBe(750000);
    });

    it("fills the original rate and says the revision is not represented", () => {
        const { draft, notes } = reviewToDraft(review());

        expect(draft.interestRate).toBe(10.5);
        expect(draft.rateType).toBe("FLOATING");
        expect(notes.join(" ")).toMatch(/10\.5% to 10\.75%/);
    });

    it("preselects the currency the statement states", () => {
        expect(reviewToDraft(review()).currencyCode).toBe("INR");
    });
});

describe("the OD reference, into the existing wizard", () => {
    const facility = () => referenceDocument("revolving-reference.tokens.json");

    it("asks the customer to confirm before any workflow opens", () => {
        const state = createReviewState(facility(), "od.pdf");

        expect(state.selectedType).toBeNull();
        expect(() => reviewToDraft(setConfirmed(state, true))).toThrow(/Confirm the loan type/);
    });

    it("fills the OD workflow once confirmed: limit, operative limit, opening", () => {
        const { draft } = reviewToDraft(setConfirmed(selectType(createReviewState(facility(), "od.pdf"), "OVERDRAFT"), true));

        expect(draft).toMatchObject({ loanKind: LoanKind.OVERDRAFT, creditLimit: 36000000, drawingPower: 33600000, openingUsed: 0, openingUsedAsOf: "2026-04-04", dropline: false });
        expect(draft.principalAmount).toBeNull();
        expect(draft.emiAmount).toBeNull();
    });
});

describe("customer corrections", () => {
    it("survive changing the loan type", () => {
        let state = editField(reviewOf(OD), "interestRate", 14);
        state = selectType(state, "CASH_CREDIT");
        state = selectType(state, "OVERDRAFT");

        expect(state.fields.interestRate).toMatchObject({ value: 14, provenance: "MANUAL" });
        expect(reviewToDraft(setConfirmed(state, true)).draft.interestRate).toBe(14);
    });

    it("win over the statement in the draft", () => {
        const state = setConfirmed(editField(selectType(reviewOf(OD), "OVERDRAFT"), "sanctionedAmount", 999), true);

        expect(reviewToDraft(state).draft.creditLimit).toBe(999);
    });

    it("cancelling produces nothing: no draft exists until reviewToDraft is called", () => {
        const state = reviewOf(OD);

        expect(state.confirmed).toBe(false);
        expect(() => reviewToDraft(state)).toThrow();
    });
});

describe("Dropline Overdraft, once its update is applied", () => {
    const enabled = (text: string) => setConfirmed(selectType(createReviewState(facilityFrom(text), "dod.pdf", true), "DROPLINE_OVERDRAFT"), true);
    const WITH_SCHEDULE = `
Dropline Overdraft Facility
Facility Number: DOD-7781
Original Sanctioned Limit: 1,00,00,000

Reduction Date   Reduced Drawing Limit
01-Jan-2026      95,00,000
01-Apr-2026      90,00,000
`;

    it("carries the printed reduction steps to the wizard and no single drawing power", () => {
        const { draft } = reviewToDraft(enabled(WITH_SCHEDULE));

        expect(draft.loanCategory).toBe("Dropline Overdraft");
        expect(draft.dropline).toBe(true);
        expect(draft.drawingPower).toBeNull();
        expect(draft.drawingPowerSchedule?.map(step => [step.effectiveDate, step.drawingPower])).toEqual([["2026-01-01", 9500000], ["2026-04-01", 9000000]]);
    });

    it("says so when the statement prints no steps", () => {
        expect(reviewToDraft(enabled(DOD)).notes.join(" ")).toMatch(/prints no reduction schedule/);
    });
});

describe("independence from the customer's database", () => {
    it.each(["statementReview.ts", "statementToDraft.ts", "../components/setup/StatementImportPanel.tsx"])("%s imports nothing that can read saved data", name => {
        const source = readFileSync(join(__dirname, name), "utf8");
        const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map(match => match[1]!);

        for (const target of imports) {
            expect(target).not.toMatch(/repositories|\/services|hooks|modules\/(accounts|transactions|currencies)|@tauri-apps|core\/database/);
        }
    });

    it("the whole path from document to draft makes no database or Tauri call", () => {
        tauriInvoke.mockClear();
        reviewToDraft(setConfirmed(createReviewState(referenceDocument("term-reference.tokens.json"), "t.pdf"), true));
        reviewOf(OD);

        expect(tauriInvoke).not.toHaveBeenCalled();
    });

    it("gives an identical result whatever the database would have returned", () => {
        const run = (saved: unknown[]) => {
            tauriInvoke.mockReset();
            tauriInvoke.mockResolvedValue(saved);

            return JSON.stringify(reviewToDraft(setConfirmed(createReviewState(referenceDocument("term-reference.tokens.json"), "t.pdf"), true)).notes) +
                JSON.stringify(referenceDocument("term-reference.tokens.json").classification);
        };

        expect(run([])).toBe(run([{ id: "existing-loan", loan_account_number: "XLOAN0000000000000001", loan_kind: "OVERDRAFT", principal_amount: 1 }]));
    });
});

describe("separation from persistence", () => {
    it.each(["statementReview.ts", "statementToDraft.ts"])("%s touches no service, repository or database", name => {
        const source = readFileSync(join(__dirname, name), "utf8");

        expect(source).not.toMatch(/Repository|LoanService|@tauri-apps|\binvoke\(|plugin-sql/);
    });

    it("the review panel saves nothing itself", () => {
        const source = readFileSync(join(__dirname, "../components/setup/StatementImportPanel.tsx"), "utf8");

        expect(source).not.toMatch(/Repository|LoanService|@tauri-apps|\binvoke\(|plugin-sql/);
    });
});
