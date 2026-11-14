import { describe, expect, it } from "vitest";

import { loanLinkButtonState } from "@/modules/transactions/components/TransactionTable";

import { buildOverdraftViewModel } from "../components/ViewLoanDialog";
import { LoanKind, OverdraftEntryKind, type Loan } from "../types";
import { openingUsedAsOfAfterStartDate, overdraftRequestFromValues, overdraftSchema } from "../validation";
import { decideOverdraftForTransaction, type OverdraftMatchState, type OverdraftMatchTransaction } from "./overdraftImportMatching";
import { computeOverdraftPosition } from "./overdraftPosition";
import { overdraftKindsFor, overdraftLinkRefusal } from "./overdraftRules";

// The pure parts of Overdraft: the calculator, the import decision, the
// link rules, the form mapping and the View model. The end-to-end
// behaviour against a real database is in OverdraftService.test.ts.

const totals = (used: number, extra: Partial<{ totalDrawdowns: number; totalRepayments: number; totalInterestCharges: number; invalidLinks: number }> = {}) => ({
    used, totalDrawdowns: 0, totalRepayments: 0, totalInterestCharges: 0, invalidLinks: 0, ...extra,
});

function od(overrides: Partial<Loan> = {}): Loan {
    return {
        id: "od-1", accountId: "bank", loanAccountId: "acct-od-1", lenderInstitutionId: null,
        loanType: "Overdraft", loanKind: LoanKind.OVERDRAFT, creditLimit: 5_000_000, openingUsed: 2_000_000,
        openingUsedAsOf: "2026-06-30", linkedAccountIds: ["bank"], name: "ABC Overdraft", principalAmount: 0, interestRate: 10,
        interestType: "REDUCING", tenureMonths: null, emiAmount: null, startDate: "2025-04-01", maturityDate: null,
        outstandingPrincipal: 2_000_000, outstandingInterest: 0, paidInstallments: 0, currencyId: "cur-inr",
        status: "ACTIVE", createdAt: "", updatedAt: "", ...overrides,
    };
}

describe("computeOverdraftPosition", () => {
    it("derives Available, Utilization and Status from the limit and Used only", () => {
        expect(computeOverdraftPosition(5_000_000, totals(2_000_000))).toMatchObject({
            limit: 5_000_000, used: 2_000_000, available: 3_000_000, overLimitBy: 0, utilizationPercent: 40, status: "PARTLY_USED",
        });
    });

    it.each([
        [0, "NOT_USED", 5_000_000, 0],
        [0.001, "NOT_USED", 5_000_000, 0],
        [5_000_000, "FULLY_USED", 0, 0],
        [5_000_000.004, "FULLY_USED", 0, 0],
        [5_250_000, "OVER_LIMIT", 0, 250_000],
    ] as const)("used %d -> %s", (used, status, available, overLimitBy) => {
        expect(computeOverdraftPosition(5_000_000, totals(used))).toMatchObject({ status, available, overLimitBy });
    });

    it("Needs Review: invalid links, repayments above usage, or no limit", () => {
        expect(computeOverdraftPosition(5_000_000, totals(1_000, { invalidLinks: 2 })).status).toBe("NEEDS_REVIEW");
        expect(computeOverdraftPosition(5_000_000, totals(-1)).status).toBe("NEEDS_REVIEW");
        expect(computeOverdraftPosition(0, totals(0))).toMatchObject({ status: "NEEDS_REVIEW", utilizationPercent: null });
    });

    it("carries the totals through, with Interest / Charges separate", () => {
        expect(computeOverdraftPosition(100, totals(10, { totalDrawdowns: 30, totalRepayments: 20, totalInterestCharges: 5 })))
            .toMatchObject({ totalDrawdowns: 30, totalRepayments: 20, totalInterestCharges: 5, used: 10 });
    });
});

describe("overdraft link rules", () => {
    const t = (type: string, extra: Record<string, unknown> = {}) => ({
        accountId: "bank", type, amount: 100, transactionDate: "2026-07-05", ...extra,
    });

    it("money in is a drawdown; money out a repayment or an interest / charge", () => {
        expect(overdraftKindsFor(t("income"))).toEqual([OverdraftEntryKind.DRAWDOWN]);
        expect(overdraftKindsFor(t("transfer", { transferDirection: "IN" }))).toEqual([OverdraftEntryKind.DRAWDOWN]);
        expect(overdraftKindsFor(t("expense"))).toEqual([OverdraftEntryKind.REPAYMENT, OverdraftEntryKind.INTEREST_CHARGE]);
        expect(overdraftKindsFor(t("transfer", { transferDirection: null }))).toEqual([]);
    });

    it("refuses another account, a zero amount, a closed OD, a Term Loan and a date in the opening amount", () => {
        expect(overdraftLinkRefusal(t("income"), od())).toBeNull();
        expect(overdraftLinkRefusal(t("income", { accountId: "other" }), od())).toContain("linked bank account");
        expect(overdraftLinkRefusal(t("income", { amount: 0 }), od())).toContain("above zero");
        expect(overdraftLinkRefusal(t("income"), od({ status: "CLOSED" }))).toContain("closed");
        expect(overdraftLinkRefusal(t("income"), od({ loanKind: LoanKind.TERM_LOAN }))).toContain("not an overdraft");
        expect(overdraftLinkRefusal(t("income", { transactionDate: "2026-06-30" }), od())).toContain("opening used");
    });
});

describe("decideOverdraftForTransaction", () => {
    const narration = "ACH DR ABC FINANCE OD REPAY 000111";
    const txn = (overrides: Partial<OverdraftMatchTransaction> = {}): OverdraftMatchTransaction => ({
        id: "new", accountId: "bank", type: "expense", amount: 150_000, transactionDate: "2026-08-05",
        payee: "", originalNarration: "ACH DR ABC FINANCE OD REPAY 000333", ...overrides,
    });
    const state = (loan: Loan, links: Array<{ kind: OverdraftEntryKind; source?: "MANUAL" | "IMPORT"; transaction?: Partial<OverdraftMatchTransaction> }>): OverdraftMatchState => ({
        loan, lenderName: "ABC Finance",
        links: links.map((link, index) => ({
            id: `l${index}`, loanId: loan.id, transactionId: `t${index}`, entryKind: link.kind, linkSource: link.source ?? "MANUAL", createdAt: "",
            transaction: { id: `t${index}`, accountId: "bank", type: "expense", amount: 200_000, transactionDate: "2026-07-05", payee: "", originalNarration: narration, ...link.transaction },
        })),
    });

    it("applies the kind the user taught, for any amount", () => {
        expect(decideOverdraftForTransaction(txn({ amount: 1 }), [state(od(), [{ kind: OverdraftEntryKind.REPAYMENT }])]))
            .toEqual({ kind: "apply", loanId: "od-1", entryKind: OverdraftEntryKind.REPAYMENT });
    });

    it("never applies on a name alone, nor on an automatic match", () => {
        expect(decideOverdraftForTransaction(txn(), [state(od(), [])]).kind).toBe("review");
        expect(decideOverdraftForTransaction(txn(), [state(od(), [{ kind: OverdraftEntryKind.REPAYMENT, source: "IMPORT" }])]).kind).toBe("review");
        expect(decideOverdraftForTransaction(txn({ originalNarration: "UPI SWIGGY" }), [state(od(), [])])).toEqual({ kind: "none" });
    });

    it("multiple ODs, or a pattern taught as two kinds: review", () => {
        const two = [state(od(), [{ kind: OverdraftEntryKind.REPAYMENT }]), state(od({ id: "od-2", name: "Other OD" }), [{ kind: OverdraftEntryKind.REPAYMENT }])];
        expect(decideOverdraftForTransaction(txn(), two)).toMatchObject({ kind: "review", loanIds: ["od-1", "od-2"] });
        expect(decideOverdraftForTransaction(txn(), [state(od(), [{ kind: OverdraftEntryKind.REPAYMENT }, { kind: OverdraftEntryKind.INTEREST_CHARGE }])]).kind).toBe("review");
    });

    it("wrong direction, another account, a closed OD or a transfer: not an OD movement", () => {
        const taught = [{ kind: OverdraftEntryKind.REPAYMENT }];
        expect(decideOverdraftForTransaction(txn({ type: "income" }), [state(od(), taught)]).kind).not.toBe("apply");
        expect(decideOverdraftForTransaction(txn({ accountId: "other" }), [state(od(), taught)])).toEqual({ kind: "none" });
        expect(decideOverdraftForTransaction(txn(), [state(od({ status: "CLOSED" }), taught)])).toEqual({ kind: "none" });
        expect(decideOverdraftForTransaction(txn({ type: "transfer" }), [state(od(), taught)])).toEqual({ kind: "none" });
    });
});

describe("Add Overdraft form", () => {
    it("maps to an Overdraft request with no EMI terms and nothing stored as outstanding", () => {
        const values = overdraftSchema.parse({
            name: "ABC OD", accountIds: ["bank"], currencyId: "cur-inr", creditLimit: "5000000", openingUsed: "2000000",
            openingUsedAsOf: "2026-06-30", startDate: "2025-04-01", interestRate: "", status: "ACTIVE",
        });

        expect(overdraftRequestFromValues(values)).toMatchObject({
            loanKind: LoanKind.OVERDRAFT, creditLimit: 5_000_000, openingUsed: 2_000_000, openingUsedAsOf: "2026-06-30",
            principalAmount: 0, tenureMonths: null, emiAmount: null, firstInstallmentAmount: null,
            outstandingPrincipal: 0, outstandingInterest: 0, interestRate: 0,
        });
    });

    it("requires the limit, the linked bank account and the as-of date", () => {
        const result = overdraftSchema.safeParse({ name: "X", accountIds: [], currencyId: "c", creditLimit: 0, openingUsed: 0, openingUsedAsOf: "", startDate: "2025-01-01", status: "ACTIVE" });
        expect(result.success).toBe(false);
        expect(result.error!.issues.map(issue => issue.path[0]).sort()).toEqual(["accountIds", "creditLimit", "openingUsedAsOf"]);
    });
});

describe("OD details view", () => {
    it("shows Limit, Used and Available first, then the totals and status", () => {
        const model = buildOverdraftViewModel(od(), computeOverdraftPosition(5_000_000, totals(5_250_000, { totalDrawdowns: 3_250_000, totalRepayments: 0 })), {
            lenderName: "ABC Finance", linkedAccountNames: ["Operating"], currencyLabel: "INR",
            formatMoney: value => `₹${value}`, formatDate: value => value,
        });

        expect(model.headline).toEqual([
            { label: "OD Limit", value: "₹5000000" },
            { label: "Currently Used", value: "₹5250000" },
            { label: "Currently Available", value: "₹0" },
        ]);
        expect(model.usageStatusLabel).toBe("Over Limit");
        expect(model.overLimitNote).toBe("Over limit by ₹250000");
        expect(model.details.find(field => field.label === "Utilization")?.value).toBe("105.00%");
        expect(model.details.find(field => field.label === "Total Drawdowns")?.value).toBe("₹3250000");
    });
});

describe("Transactions link icon wording", () => {
    it("stays Link to Loan EMI without an OD, and is the generic Link to Loan on an OD's account", () => {
        expect(loanLinkButtonState(false).title).toBe("Link to Loan");
        expect(loanLinkButtonState(true).title).toBe("Linked to Loan");
        expect(loanLinkButtonState(false, true).title).toBe("Link to Loan");
        expect(loanLinkButtonState(true, true).title).toBe("Linked to Loan");
    });
});

describe("Opening Used As Of default", () => {
    it("follows the Start Date until the user sets it", () => {
        expect(openingUsedAsOfAfterStartDate({ startDate: "2026-01-31", openingUsedAsOf: "", keepAsOf: false })).toBe("2026-01-31");
        expect(openingUsedAsOfAfterStartDate({ startDate: "2026-02-15", openingUsedAsOf: "2026-01-31", keepAsOf: false })).toBe("2026-02-15");
    });

    it("keeps a date the user entered, or one already saved on the OD", () => {
        expect(openingUsedAsOfAfterStartDate({ startDate: "2026-01-31", openingUsedAsOf: "2026-06-30", keepAsOf: true })).toBe("2026-06-30");
    });

    it("maps several linked accounts into the request", () => {
        const values = overdraftSchema.parse({
            name: "X", accountIds: ["a", "b"], currencyId: "c", creditLimit: 1, openingUsed: 0,
            openingUsedAsOf: "2026-01-31", startDate: "2026-01-31", status: "ACTIVE",
        });
        expect(overdraftRequestFromValues(values)).toMatchObject({
            openingUsedAsOf: "2026-01-31", accountId: "a", linkedAccountIds: ["a", "b"],
        });
    });
});

describe("decideOverdraftForTransaction - several linked accounts", () => {
    const base = {
        accountId: "bank-b", type: "expense", amount: 1, transactionDate: "2026-08-05", payee: "",
        originalNarration: "ACH DR ABC FINANCE OD REPAY 000333",
    };
    const taughtOnA: OverdraftMatchState = {
        loan: od({ linkedAccountIds: ["bank", "bank-b"] }),
        lenderName: "ABC Finance",
        links: [{
            id: "l0", loanId: "od-1", transactionId: "t0", entryKind: OverdraftEntryKind.REPAYMENT, linkSource: "MANUAL", createdAt: "",
            transaction: { id: "t0", accountId: "bank", type: "expense", amount: 2, transactionDate: "2026-07-05", payee: "", originalNarration: "ACH DR ABC FINANCE OD REPAY 000111" },
        }],
    };

    it("a pattern taught on account A applies on linked account B", () => {
        expect(decideOverdraftForTransaction({ id: "n", ...base }, [taughtOnA]))
            .toEqual({ kind: "apply", loanId: "od-1", entryKind: OverdraftEntryKind.REPAYMENT });
    });

    it("but not on an account the OD is not linked to", () => {
        expect(decideOverdraftForTransaction({ id: "n", ...base, accountId: "bank-c" }, [taughtOnA])).toEqual({ kind: "none" });
    });
});
