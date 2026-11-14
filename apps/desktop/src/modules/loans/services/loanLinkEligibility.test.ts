import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loanLinkButtonState, showsLoanLinkIcon } from "@/modules/transactions/components/TransactionTable";

import {
    isLoanLinkCategoryName,
    isLoanLinkEligible,
    loanLinkCategoryIds,
    NOT_LOAN_CATEGORY_REASON,
} from "./loanLinkEligibility";

// The strict category gate for loan / OD linking: only the five loan
// categories make a transaction eligible - its account never does.

const CATEGORIES = [
    { id: "c-inst", name: "Loan Installment" },
    { id: "c-int", name: "Loan Interest" },
    { id: "c-rec", name: "Loan Interest Recovered" },
    { id: "c-prin", name: "Loan Principal Repayment" },
    { id: "c-draw", name: "Loan Principal Drawdown" },
    { id: "c-bank", name: "Bank Transfer" },
    { id: "c-tel", name: "Internet & Telecom" },
    { id: "c-office", name: "Office Expenses" },
    { id: "c-salary", name: "Salary" },
    { id: "c-self", name: "Self Transfer" },
];

const loanIds = loanLinkCategoryIds(CATEGORIES);

describe("loan-link category gate", () => {
    it.each([
        "Loan Installment",
        "Loan Interest",
        "Loan Interest Recovered",
        "Loan Principal Repayment",
        "Loan Principal Drawdown",
    ])(
        "%s -> eligible",
        name => expect(isLoanLinkCategoryName(name)).toBe(true)
    );

    it("matches the name regardless of case and spacing", () => {
        expect(isLoanLinkCategoryName("  loan   INSTALLMENT ")).toBe(true);
        expect(isLoanLinkCategoryName("LOAN  principal	drawdown  ")).toBe(true);
    });

    it.each(["Bank Transfer", "Internet & Telecom", "Office Expenses", "Salary", "Self Transfer", "Loan", "Loan Installments", "Personal Loan", "Loan Principal", "Loan Drawdown", "Principal Drawdown", "", null])(
        "%s -> NOT eligible",
        name => expect(isLoanLinkCategoryName(name)).toBe(false)
    );

    it("resolves exactly the five loan categories to ids, from the user's own categories", () => {
        expect([...loanIds].sort()).toEqual(["c-draw", "c-inst", "c-int", "c-prin", "c-rec"]);
    });

    it("resolves ids from whatever ids the user's categories have - none are hard-coded", () => {
        const ids = loanLinkCategoryIds([
            { id: "any-uuid-1", name: "loan principal drawdown" },
            { id: "any-uuid-2", name: "Bank Transfer" },
        ]);
        expect([...ids]).toEqual(["any-uuid-1"]);
    });

    it("the not-a-loan-category message names every loan category (incl. the renamed Loan Interest Charge)", () => {
        expect(NOT_LOAN_CATEGORY_REASON).toContain(
            "Loan Installment, Loan Interest, Loan Interest Charge, Loan Interest Recovered, Loan Principal Repayment or Loan Principal Drawdown"
        );
    });

    it("the renamed interest category (Loan Interest Charge) stays loan-link eligible", () => {
        expect(isLoanLinkCategoryName("Loan Interest Charge")).toBe(true);
        expect(isLoanLinkCategoryName("loan  interest charge")).toBe(true);
    });

    it("a transaction is eligible only by its category; no category is never eligible", () => {
        expect(isLoanLinkEligible({ categoryId: "c-inst" }, loanIds)).toBe(true);
        expect(isLoanLinkEligible({ categoryId: "c-draw" }, loanIds)).toBe(true);
        expect(isLoanLinkEligible({ categoryId: "c-bank" }, loanIds)).toBe(false);
        expect(isLoanLinkEligible({ categoryId: "c-tel" }, loanIds)).toBe(false);
        expect(isLoanLinkEligible({ categoryId: null }, loanIds)).toBe(false);
    });
});

describe("Transactions Landmark icon - category gate", () => {
    const OD_ACCOUNT = "acct-od";
    const row = (categoryId: string | null, type: "expense" | "income" | "transfer", accountId = "acct-term") => ({
        id: "t1", type, accountId, categoryId,
    });
    const sets = { loanLinkCategoryIds: loanIds, overdraftAccountIds: new Set([OD_ACCOUNT]), loanLinkedIds: new Set<string>() };

    it("1. Term Loan EMI debit in a loan category -> icon", () => {
        expect(showsLoanLinkIcon(row("c-inst", "expense"), sets)).toBe(true);
        expect(showsLoanLinkIcon(row("c-prin", "expense"), sets)).toBe(true);
    });

    it("1b. a Transfer Out in a loan category -> icon (it can be an EMI payment); a Transfer In or no direction off an OD account -> none", () => {
        const transfer = (direction: "IN" | "OUT" | null, accountId = "acct-term") => ({ ...row("c-prin", "transfer", accountId), transferDirection: direction });
        expect(showsLoanLinkIcon(transfer("OUT"), sets)).toBe(true);
        expect(showsLoanLinkIcon(transfer("IN"), sets)).toBe(false);
        expect(showsLoanLinkIcon(transfer(null), sets)).toBe(false);
        expect(showsLoanLinkIcon(row("c-prin", "income"), sets)).toBe(false);
        // On an OD account money in still shows it (a drawdown), as before.
        expect(showsLoanLinkIcon(transfer("IN", OD_ACCOUNT), sets)).toBe(true);
    });

    it("2. Term Loan account + Bank Transfer -> no icon", () => {
        expect(showsLoanLinkIcon(row("c-bank", "expense"), sets)).toBe(false);
        expect(showsLoanLinkIcon(row("c-bank", "transfer"), sets)).toBe(false);
    });

    it("3. OD account + a loan category, money in or out -> icon", () => {
        expect(showsLoanLinkIcon(row("c-int", "income", OD_ACCOUNT), sets)).toBe(true);
        expect(showsLoanLinkIcon(row("c-rec", "transfer", OD_ACCOUNT), sets)).toBe(true);
    });

    it("4/5. OD account + Bank Transfer, or TATA Play in Internet & Telecom -> no icon", () => {
        expect(showsLoanLinkIcon(row("c-bank", "transfer", OD_ACCOUNT), sets)).toBe(false);
        expect(showsLoanLinkIcon(row("c-tel", "expense", OD_ACCOUNT), sets)).toBe(false);
        expect(showsLoanLinkIcon(row(null, "expense", OD_ACCOUNT), sets)).toBe(false);
    });

    it("6/7. the icon follows the category: Loan Installment -> Internet & Telecom removes it, and back adds it", () => {
        expect(showsLoanLinkIcon(row("c-inst", "expense"), sets)).toBe(true);
        expect(showsLoanLinkIcon(row("c-tel", "expense"), sets)).toBe(false);
        expect(showsLoanLinkIcon(row("c-inst", "expense"), sets)).toBe(true);
    });

    it("OD drawdown: OD account + Loan Principal Drawdown, money in or out -> icon", () => {
        expect(showsLoanLinkIcon(row("c-draw", "income", OD_ACCOUNT), sets)).toBe(true);
        expect(showsLoanLinkIcon(row("c-draw", "transfer", OD_ACCOUNT), sets)).toBe(true);
    });

    it("a loan category on an ordinary income row (no OD account) -> no icon", () => {
        expect(showsLoanLinkIcon(row("c-rec", "income"), sets)).toBe(false);
    });

    it("an already-linked transaction keeps its (green) icon whatever its category, to see or unlink it", () => {
        expect(showsLoanLinkIcon(row("c-tel", "expense"), { ...sets, loanLinkedIds: new Set(["t1"]) })).toBe(true);
    });
});

describe("category change -> eligibility only, never a link", () => {
    const OD_ACCOUNT = "acct-od";
    const sets = { loanLinkCategoryIds: loanIds, overdraftAccountIds: new Set([OD_ACCOUNT]), loanLinkedIds: new Set<string>() };

    it("Bank Transfer -> Loan Principal Drawdown makes the row eligible, but it stays unlinked", () => {
        const before = { id: "t1", type: "transfer" as const, accountId: OD_ACCOUNT, categoryId: "c-bank" };
        const after = { ...before, categoryId: "c-draw" };

        expect(showsLoanLinkIcon(before, sets)).toBe(false);
        expect(showsLoanLinkIcon(after, sets)).toBe(true);

        // Eligible means the (grey) Link action is offered - not that a link exists.
        expect(sets.loanLinkedIds.size).toBe(0);
        expect(loanLinkButtonState(sets.loanLinkedIds.has(after.id), true).title).toBe("Link to Loan");
    });

    it("moving out of a loan category removes eligibility without touching the linked set", () => {
        const linked = new Set<string>();
        const row = { id: "t2", type: "expense" as const, accountId: "acct-term", categoryId: "c-draw" };

        expect(isLoanLinkEligible(row, loanIds)).toBe(true);
        expect(isLoanLinkEligible({ ...row, categoryId: "c-tel" }, loanIds)).toBe(false);
        expect(linked.size).toBe(0);
    });

    it("the category-change paths never call loan / OD link or import-matching code", () => {
        const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

        for (const source of [
            read("../../transactions/services/TransactionService.ts"),
            read("../../transactions/services/bulkCategoryChange.ts"),
        ]) {
            expect(source).not.toMatch(/loanLinkEligibility|LoanTransactionLinkService|LoanImportPaymentService|OverdraftService|loan_schedule_payments|overdraft_transaction_links|loan_payment_schedule/);
        }
    });
});
