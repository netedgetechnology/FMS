import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { analyseLoanStatement, documentFromItems } from "@financeos/import-engine";

import { LoanKind } from "../types";
import type { LinkedTransactionSummary } from "../setup/loanSetupTypes";
import {
    applyCompletionChange,
    emptyStatementCompletion,
    savesDirectly,
    setChargeCompletion,
    setDisbursementCompletion,
    statementLoanDraft,
    statementSaveIssues,
    type StatementCompletion,
} from "./statementLoanSetup";
import { createReviewState, editField, removeCharge, removeDisbursement, selectType, updateDisbursement, type StatementReviewState } from "./statementReview";
import { STATED_DISBURSEMENT_KEY } from "./statementToDraft";

// The synthetic reference term loan (no real statement is read):
// 7,50,000 gross, 37,818 withheld, EMI 8,199, first EMI 05/03/2026.
function review(): StatementReviewState {
    const path = join(__dirname, "../../../../../../packages/import-engine/src/tests/loanStatement/fixtures/term-reference.tokens.json");
    const tokens = JSON.parse(readFileSync(path, "utf8")) as Array<Array<[number, number, number, number, string]>>;
    const facility = analyseLoanStatement(documentFromItems(tokens.map(page => page.map(([x, y, width, height, text]) => ({ x, y, width, height, text }))))).facilities[0]!;
    return createReviewState(facility, "term.pdf");
}

const completed = (change: Partial<StatementCompletion> = {}): StatementCompletion => ({
    ...emptyStatementCompletion(),
    name: "Synthetic LAP",
    currencyId: "INR",
    linkedAccountId: "bank",
    disbursements: { "d-0": { destinationAccountId: "bank", transaction: null } },
    ...change,
});

function ready(state: StatementReviewState, completion: StatementCompletion) {
    const loan = statementLoanDraft(state, completion);
    if (loan.status !== "READY") throw new Error(loan.blockers.join("; "));
    return loan;
}

describe("Term Loan saved straight from Statement Review", () => {
    it("is the route for a Term Loan only; an Overdraft keeps the Add Loan wizard", () => {
        const state = review();
        expect(savesDirectly(state)).toBe(true);
        expect(savesDirectly(selectType(state, "OVERDRAFT"))).toBe(false);
        expect(savesDirectly(selectType(state, "DEMAND_LOAN"))).toBe(false);
    });

    it("builds the loan from the review without a second confirmation tick, keeping every statement figure", () => {
        const { draft, result } = ready(review(), completed());

        expect(draft).toMatchObject({
            loanKind: LoanKind.TERM_LOAN,
            name: "Synthetic LAP",
            lenderName: "EXAMPLE FINANCE LIMITED",
            loanAccountNumber: "XLOAN0000000000000001",
            loanCategory: "LAP",
            principalAmount: 750_000,
            emiAmount: 8_199,
            tenureMonths: 185,
            firstEmiDate: "2026-03-05",
            startDate: "2026-01-31",
            linkedAccountId: "bank",
            scheduleMethod: "GENERATED",
            historicalCount: 0,
        });
        expect(draft.disbursements).toHaveLength(1);
        expect(draft.disbursements[0]).toMatchObject({ grossAmount: 750_000, deductionsAmount: 37_818, destinationAccountId: "bank", transaction: null });
        expect(draft.expenses.reduce((sum, e) => sum + Number(e.baseAmount) + Number(e.gstAmount), 0)).toBeCloseTo(37_818, 2);
        expect(result.statementFacts).toMatchObject({ outstandingPrincipal: 734_907, instalmentsPaid: 9 });
    });

    it("never marks an instalment paid or splits a payment on its own", () => {
        const { draft } = ready(review(), completed());
        expect(draft.historicalCount).toBe(0);
        expect(draft.historical).toEqual([]);
    });

    it("asks only for what the statement cannot give, and passes once that is filled", () => {
        const empty = ready(review(), { ...emptyStatementCompletion(), currencyId: "INR" }).draft;
        const fields = statementSaveIssues(empty, [], "2026-11-10").map(issue => issue.field);

        expect(fields).toEqual(expect.arrayContaining(["name", "linkedAccountId", "disbursements.0.destinationAccountId"]));
        // Nothing the statement gave is asked for again.
        for (const field of ["interestRate", "startDate", "tenureMonths", "firstEmiDate", "loanCategory", "principalAmount"]) {
            expect(fields).not.toContain(field);
        }

        expect(statementSaveIssues(ready(review(), completed()).draft, [], "2026-11-10")).toEqual([]);
    });

    it("a correction on the review flows into the loan; the customer's completion is kept", () => {
        const corrected = editField(review(), "emiAmount", 8_200);
        const { draft } = ready(corrected, completed());

        expect(draft.emiAmount).toBe(8_200);
        expect(draft.name).toBe("Synthetic LAP");
    });

    it("the reused setup components can change only the completion, never a statement figure", () => {
        const before = completed();
        const after = applyCompletionChange(before, {
            emiAmount: 1,
            principalAmount: 1,
            firstEmiDate: "2030-01-01",
            loanAccountNumber: "OTHER",
            scheduleMethod: "LENDER_CSV",
            historicalCount: 2,
        });

        expect(after).toEqual({ ...before, scheduleMethod: "LENDER_CSV", historicalCount: 2 });
        const { draft } = ready(review(), after);
        expect(draft).toMatchObject({ emiAmount: 8_199, principalAmount: 750_000, firstEmiDate: "2026-03-05", loanAccountNumber: "XLOAN0000000000000001", scheduleMethod: "LENDER_CSV" });
    });

    it("refuses the same lender account number already on a live loan", () => {
        const { draft } = ready(review(), completed());
        const issues = statementSaveIssues(draft, [{ name: "Existing", loanAccountNumber: " xloan0000000000000001 " }], "2026-11-10");

        expect(issues[0]).toMatchObject({ field: "loanAccountNumber" });
        expect(issues[0]!.message).toMatch(/already exists \("Existing"\)/);
    });

    it("is blocked, with the reason, while the review has an unsupported type", () => {
        const loan = statementLoanDraft(selectType(review(), "DEMAND_LOAN"), completed());

        expect(loan.status).toBe("BLOCKED");
        expect(loan.status === "BLOCKED" && loan.blockers[0]).toMatch(/cannot be set up in FinWea yet/);
    });
});

const TODAY = "2026-11-10";

/** A synthetic bank transaction, as the link picker returns it. */
function txn(id: string, amount: number, side: "IN" | "OUT", accountId = "bank", date = "2026-02-11"): LinkedTransactionSummary {
    return { id, date, amount, accountId, accountName: "Synthetic Bank", side, payee: `Payee ${id}`, narration: null, categoryName: null, categoryType: null };
}

/** The reference review with a second, synthetic tranche d-1 of 1,00,000 (no deductions). */
function twoTranches(): StatementReviewState {
    const state = review();
    const first = state.disbursements[0]!;
    return { ...state, disbursements: [first, { ...first, key: "d-1", date: "2026-03-15", gross: 100_000, deductions: 0, reference: "SYN-2" }] };
}

const linkedBoth = (): StatementCompletion =>
    setDisbursementCompletion(
        setDisbursementCompletion(completed(), "d-0", { destinationAccountId: "bank", transaction: txn("credit-a", 712_182, "IN") }),
        "d-1",
        { destinationAccountId: "bank", transaction: txn("credit-b", 100_000, "IN", "bank", "2026-03-15") }
    );

const links = (state: StatementReviewState, completion: StatementCompletion) =>
    ready(state, completion).draft.disbursements.map(row => [row.key, row.transaction?.id ?? null]);

describe("disbursement links follow their own row, never a position", () => {
    it("each row is keyed by the review's stable key", () => {
        expect(links(twoTranches(), linkedBoth())).toEqual([
            ["d-0", "credit-a"],
            ["d-1", "credit-b"],
        ]);
    });

    it("removing a row never moves its link onto the next row (the old position bug)", () => {
        // Linked by position, d-1 would have inherited credit-a here.
        expect(links(removeDisbursement(twoTranches(), "d-0"), linkedBoth())).toEqual([["d-1", "credit-b"]]);
        expect(links(removeDisbursement(twoTranches(), "d-1"), linkedBoth())).toEqual([["d-0", "credit-a"]]);
    });

    it("reordering rows keeps every link with its own row", () => {
        const state = twoTranches();
        const reordered = { ...state, disbursements: [...state.disbursements].reverse() };

        expect(links(reordered, linkedBoth())).toEqual([
            ["d-1", "credit-b"],
            ["d-0", "credit-a"],
        ]);
    });

    it("a row added afterwards starts unlinked and takes no other row's link", () => {
        const state = twoTranches();
        const added = { ...state, disbursements: [...state.disbursements, { ...state.disbursements[1]!, key: "d-2", gross: 50_000 }] };
        const draft = ready(added, linkedBoth()).draft;

        expect(draft.disbursements.map(row => [row.key, row.transaction?.id ?? null, row.destinationAccountId])).toEqual([
            ["d-0", "credit-a", "bank"],
            ["d-1", "credit-b", "bank"],
            ["d-2", null, ""],
        ]);
    });

    it("with every table row removed, the stated disbursement inherits no link", () => {
        const draft = ready(removeDisbursement(review(), "d-0"), linkedBoth()).draft;

        expect(draft.disbursements).toHaveLength(1);
        expect(draft.disbursements[0]).toMatchObject({ key: STATED_DISBURSEMENT_KEY, transaction: null, destinationAccountId: "" });
    });

    it("a link changed through the reused components is stored by key too", () => {
        const draft = ready(twoTranches(), linkedBoth()).draft;
        const changed = applyCompletionChange(linkedBoth(), {
            disbursements: [{ ...draft.disbursements[1]!, transaction: null }],
        });

        expect(links(twoTranches(), changed)).toEqual([
            ["d-0", "credit-a"],
            ["d-1", null],
        ]);
    });
});

describe("a charge paid separately is linked to its existing bank debit", () => {
    // The IHO charge (20,000) is the 9th; paying it separately leaves 17,818
    // withheld, so the review's deductions are corrected to match.
    const IHO = "c-8";
    const separately = (transaction: LinkedTransactionSummary | null, paymentAccountId = "bank") =>
        setChargeCompletion(completed(), IHO, { settlement: "PAID_SEPARATELY", paymentAccountId, transaction });
    const corrected = () => updateDisbursement(review(), "d-0", { deductions: 17_818 });
    const iho = (state: StatementReviewState, completion: StatementCompletion) => ready(state, completion).draft.expenses.find(e => e.key === IHO)!;

    it("charges keep their stable keys and the statement's settlement until changed", () => {
        const { draft } = ready(review(), completed());
        expect(draft.expenses.map(e => e.key)).toEqual(["c-0", "c-1", "c-2", "c-3", "c-4", "c-5", "c-6", "c-7", "c-8"]);
        expect(draft.expenses.every(e => e.settlement === "DEDUCTED_FROM_DISBURSEMENT" && e.disbursementKey === "d-0")).toBe(true);
    });

    it("stores the account and the existing debit, and no longer deducts it", () => {
        expect(iho(corrected(), separately(txn("debit-iho", 20_000, "OUT", "bank", "2026-01-31")))).toMatchObject({
            settlement: "PAID_SEPARATELY",
            disbursementKey: null,
            paymentAccountId: "bank",
            transaction: { id: "debit-iho" },
        });
        expect(statementSaveIssues(ready(corrected(), separately(txn("debit-iho", 20_000, "OUT", "bank", "2026-01-31"))).draft, [], TODAY)).toEqual([]);
    });

    it("refuses a debit on another account, money received, or a different amount - to the paisa", () => {
        for (const wrong of [txn("w1", 20_000, "OUT", "other-bank", "2026-01-31"), txn("w2", 20_000, "IN", "bank", "2026-01-31"), txn("w3", 19_999.99, "OUT", "bank", "2026-01-31")]) {
            const issues = statementSaveIssues(ready(corrected(), separately(wrong)).draft, [], TODAY);
            expect(issues.map(issue => issue.field), wrong.id).toContain("expenses.8.transaction");
        }
    });

    it("refuses the same bank transaction for a charge and a disbursement", () => {
        const shared = txn("shared", 20_000, "OUT", "bank", "2026-01-31");
        const completion = setDisbursementCompletion(separately(shared), "d-0", { destinationAccountId: "bank", transaction: shared });
        const issues = statementSaveIssues(ready(corrected(), completion).draft, [], TODAY);

        expect(issues.length).toBeGreaterThan(0);
    });

    it("a charge's link stays with that charge when another charge is removed", () => {
        const state = removeCharge(corrected(), "c-0");
        expect(iho(state, separately(txn("debit-iho", 20_000, "OUT", "bank", "2026-01-31"))).transaction?.id).toBe("debit-iho");
        expect(ready(state, separately(null)).draft.expenses.map(e => e.key)).not.toContain("c-0");
    });

    it("switching back to deducted drops the link and deducts it from the first disbursement again", () => {
        const back = setChargeCompletion(separately(txn("debit-iho", 20_000, "OUT")), IHO, { settlement: "DEDUCTED_FROM_DISBURSEMENT", paymentAccountId: "", transaction: null });

        expect(iho(review(), back)).toMatchObject({ settlement: "DEDUCTED_FROM_DISBURSEMENT", disbursementKey: "d-0", transaction: null, paymentAccountId: "" });
    });
});

describe("Additional Loan Details", () => {
    it("are optional: leaving them blank adds no issue", () => {
        const { draft } = ready(review(), completed());

        expect(draft).toMatchObject({ purpose: "", paymentDay: null, gracePeriodMonths: null, balloonAmount: null, firstInstallmentAmount: null });
        expect(statementSaveIssues(draft, [], TODAY)).toEqual([]);
    });

    it("are stored as entered and never change a statement figure", () => {
        const { draft } = ready(review(), { ...completed(), purpose: "Synthetic purpose", paymentDay: 5, gracePeriodMonths: 1, balloonAmount: 10_000, firstInstallmentAmount: 2_500 });

        expect(draft).toMatchObject({ purpose: "Synthetic purpose", paymentDay: 5, gracePeriodMonths: 1, balloonAmount: 10_000, firstInstallmentAmount: 2_500 });
        expect(draft).toMatchObject({ principalAmount: 750_000, emiAmount: 8_199, tenureMonths: 185, firstEmiDate: "2026-03-05", interestRate: 10.5 });
    });

    it("are taken from the reused components' changes too, but nothing else is", () => {
        const after = applyCompletionChange(completed(), { purpose: "Via component", paymentDay: 7, emiAmount: 1 });
        expect(after).toMatchObject({ purpose: "Via component", paymentDay: 7 });
        expect(ready(review(), after).draft.emiAmount).toBe(8_199);
    });

    it("only an impossible value is refused", () => {
        expect(statementSaveIssues(ready(review(), { ...completed(), paymentDay: 40 }).draft, [], TODAY).map(i => i.field)).toContain("paymentDay");
        expect(statementSaveIssues(ready(review(), { ...completed(), balloonAmount: 750_000 }).draft, [], TODAY).map(i => i.field)).toContain("balloonAmount");
    });
});
