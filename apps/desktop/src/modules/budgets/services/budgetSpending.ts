import {
    endOfMonth,
    startOfMonth,
    toISODateString,
} from "@/core/formatting";

import type { Budget } from "../types";

import { selectBudgetsForMonth } from "./budgetPeriod";
import {
    classifyBudgetTransaction,
} from "./budgetTransaction";
import type {
    BudgetSpendingContext,
} from "./budgetTransaction";

// ---------------------------------------------------------------------
// Phase 2 - Budget Spending Engine
//
// ONE reusable, pure layer that derives actual spending for a single
// calendar month from the transaction ledger. Both BudgetsPage (Phase 3)
// and DashboardService (Phase 6) will call this instead of hand-rolling
// their own aggregation.
//
// Guarantees:
//  - Nothing is stored. Budget amounts come from `budgets`; "actual" is
//    always recomputed from `transactions`.
//  - Month applicability reuses the Phase 1 rule (selectBudgetsForMonth
//    / budgetAppliesToMonth).
//  - Whether a row is "actual spending", and for how much, is decided
//    per-row by classifyBudgetTransaction (Phase 5 - Transaction
//    Correctness). The engine only adds up what that classifier
//    includes and scopes it to the selected month. See budgetTransaction.ts
//    for the full count / exclude rules (income, transfers, credit-card
//    payments, investment transactions, loan principal vs interest) and
//    the documented model limitations.
//  - Category-specific budgets receive only their own category's spend.
//  - A null-category ("overall") budget does NOT pull other categories'
//    spend into anything except its own line (this is the non-buggy
//    replacement for the current Dashboard "null category matches
//    everything" behavior).
//  - remaining / percentage are NEVER clamped: ₹12k against ₹10k is
//    -₹2k remaining, 120%, overBudget = true.
//
// Still out of scope (a later phase): PENDING/CLEARED status filtering.
// ---------------------------------------------------------------------

function toNumber(value: unknown): number {
    const number = Number(value);

    return Number.isFinite(number) ? number : 0;
}

/**
 * The minimal ledger shape the engine reads. `TransactionService.getAll()`
 * results satisfy this and already exclude soft-deleted rows; the
 * optional `deletedAt` is a defensive guard for any caller that passes
 * rows straight from a repository.
 */
export interface BudgetLedgerEntry {
    /**
     * Transaction id. Optional so hand-built callers / tests need not
     * supply one; used only to look the row up in a Phase 5 context map
     * (e.g. loan EMI interest).
     */
    id?: string;
    type: string;
    amount: number;
    transactionDate: string;
    categoryId: string | null;
    deletedAt?: string | null;
    /**
     * The account the row is booked on. Optional for hand-built callers;
     * used only to tell a purchase booked ON a credit card apart from a
     * payment made TOWARDS one (Phase 5).
     */
    accountId?: string;
    /**
     * The credit card an expense was paid with / directed at. Populated
     * by the transaction form's "Card Reference" picker with a
     * CREDIT_CARD account id (see TransactionForm, paymentMethod ===
     * "CARD"). Used only for the credit-card-payment rule (Phase 5).
     */
    cardReference?: string | null;
}

export type BudgetThresholdState =
    | "ok"
    | "approaching"
    | "over";

export interface BudgetSpendingLine {
    budgetId: string;
    budgetName: string;
    /** null for an "overall" budget not tied to a category. */
    categoryId: string | null;
    budgetAmount: number;
    actualAmount: number;
    /** budgetAmount - actualAmount. NOT clamped; may be negative. */
    remainingAmount: number;
    /**
     * actualAmount / budgetAmount * 100. NOT clamped; may exceed 100.
     * 0 only when budgetAmount is not > 0 - a divide-by-zero guard. A
     * zero budget amount is valid (only negatives are rejected), so this
     * case is real, not defensive.
     */
    percentageUsed: number;
    /** actualAmount strictly greater than budgetAmount. */
    overBudget: boolean;
    /** Echoed from the budget - the % at which it wants an alert. */
    alertThreshold: number;
    thresholdState: BudgetThresholdState;
}

export interface BudgetSpendingSummary {
    /** Inclusive YYYY-MM-DD bounds of the reported calendar month. */
    monthStart: string;
    monthEnd: string;
    /** The currency every amount in this summary is denominated in. */
    currencyId: string;

    /**
     * One line per applicable, active budget in `currencyId`. Lines for
     * category-specific budgets carry that category's spend; lines for
     * null-category ("overall") budgets carry total in-month expense and
     * are deliberately excluded from the category-scoped totals below.
     */
    lines: BudgetSpendingLine[];

    // --- category-budget-scoped totals ---
    /** Sum of the amounts of the category-specific applicable budgets. */
    totalBudgetAmount: number;
    /** In-month expense that landed in a budgeted category (distinct). */
    budgetedActual: number;
    /** totalBudgetAmount - budgetedActual. NOT clamped. */
    totalRemaining: number;
    /** budgetedActual / totalBudgetAmount * 100. NOT clamped. */
    totalPercentageUsed: number;

    // --- ledger totals, independent of any budget ---
    /** Every in-month expense in `currencyId`, at face value. */
    totalExpense: number;
    /**
     * Expense that is not covered by any category-specific budget -
     * remains visible even when there are no budgets at all. Includes
     * uncategorized spending.
     */
    unbudgetedSpending: number;
    /** In-month expense whose transaction has no category. */
    uncategorizedSpending: number;
}

export interface CalculateBudgetSpendingInput {
    budgets: readonly Budget[];
    transactions: readonly BudgetLedgerEntry[];
    /** Any date within the calendar month to report on. */
    month: Date;
    /**
     * Report currency. Only budgets denominated in this currency are
     * included - budgets in other currencies are left out entirely
     * rather than summed across currencies (FinanceOS has no
     * exchange-rate model). Expense amounts are taken at face value,
     * consistent with the rest of the app, which performs no currency
     * conversion; callers that support multi-currency accounts should
     * pre-filter `transactions` to this currency.
     */
    currencyId: string;
    /**
     * transaction id -> interest portion of a loan EMI payment (Phase 5).
     * When supplied, a transaction that is a recorded EMI payment counts
     * only its interest amount as budget expense - the principal
     * repayment never does. Omit it (the default) and EMI payments are
     * treated as ordinary expenses at face value, i.e. exactly the
     * Phase 2-4 behaviour.
     */
    emiInterestByTransactionId?: ReadonlyMap<string, number>;
    /**
     * Ids of every CREDIT_CARD-type account (Phase 5). Lets the
     * classifier drop a bank -> credit-card bill payment (an expense
     * whose cardReference points at one of these accounts) without
     * touching purchases booked on the card itself. Omit it and no
     * expense is treated as a card payment.
     */
    creditCardAccountIds?: ReadonlySet<string>;
}

export function calculateBudgetSpending(
    input: CalculateBudgetSpendingInput
): BudgetSpendingSummary {
    const {
        budgets,
        transactions,
        month,
        currencyId,
        emiInterestByTransactionId,
        creditCardAccountIds,
    } = input;

    const classificationContext: BudgetSpendingContext = {
        emiInterestByTransactionId,
        creditCardAccountIds,
    };

    const monthStart = toISODateString(
        startOfMonth(month)
    );

    const monthEnd = toISODateString(
        endOfMonth(month)
    );

    // Phase 1 month applicability, then this engine's own currency +
    // active scoping (an inactive budget has no meaningful vs-actual).
    const applicableBudgets = selectBudgetsForMonth(
        budgets,
        month
    ).filter(
        budget =>
            budget.isActive &&
            budget.currencyId === currencyId
    );

    // --- aggregate the ledger for the selected month ---
    const spendingByCategory = new Map<string, number>();
    let uncategorizedSpending = 0;
    let totalExpense = 0;

    for (const entry of transactions) {
        // Phase 5: one place decides whether this row is spending and
        // for how much (income / transfers / credit-card payments /
        // investment rows excluded; loan EMI counted at its interest
        // portion only).
        const classification = classifyBudgetTransaction(
            entry,
            classificationContext
        );

        if (!classification.include) {
            continue;
        }

        // Inclusive month window; anything outside is a different
        // budget period.
        if (
            entry.transactionDate < monthStart ||
            entry.transactionDate > monthEnd
        ) {
            continue;
        }

        const amount = classification.amount;

        totalExpense += amount;

        if (entry.categoryId === null) {
            uncategorizedSpending += amount;
            continue;
        }

        spendingByCategory.set(
            entry.categoryId,
            (spendingByCategory.get(
                entry.categoryId
            ) ?? 0) + amount
        );
    }

    // --- per-budget lines ---
    const lines: BudgetSpendingLine[] =
        applicableBudgets.map(budget => {
            const budgetAmount = toNumber(
                budget.amount
            );

            const actualAmount =
                budget.categoryId === null
                    ? totalExpense
                    : spendingByCategory.get(
                          budget.categoryId
                      ) ?? 0;

            return buildLine(
                budget,
                budgetAmount,
                actualAmount
            );
        });

    // --- category-budget-scoped totals ---
    // Distinct budgeted categories only, so two budgets for the same
    // category never count that category's spend twice.
    const budgetedCategoryIds = new Set<string>();

    for (const budget of applicableBudgets) {
        if (budget.categoryId !== null) {
            budgetedCategoryIds.add(
                budget.categoryId
            );
        }
    }

    let budgetedActual = 0;

    for (const categoryId of budgetedCategoryIds) {
        budgetedActual +=
            spendingByCategory.get(categoryId) ?? 0;
    }

    const totalBudgetAmount = applicableBudgets
        .filter(budget => budget.categoryId !== null)
        .reduce(
            (sum, budget) =>
                sum + toNumber(budget.amount),
            0
        );

    const totalRemaining =
        totalBudgetAmount - budgetedActual;

    const totalPercentageUsed =
        totalBudgetAmount > 0
            ? (budgetedActual / totalBudgetAmount) *
              100
            : 0;

    const unbudgetedSpending =
        totalExpense - budgetedActual;

    return {
        monthStart,
        monthEnd,
        currencyId,
        lines,
        totalBudgetAmount,
        budgetedActual,
        totalRemaining,
        totalPercentageUsed,
        totalExpense,
        unbudgetedSpending,
        uncategorizedSpending,
    };
}

function buildLine(
    budget: Budget,
    budgetAmount: number,
    actualAmount: number
): BudgetSpendingLine {
    const remainingAmount =
        budgetAmount - actualAmount;

    const percentageUsed =
        budgetAmount > 0
            ? (actualAmount / budgetAmount) * 100
            : 0;

    const overBudget =
        actualAmount > budgetAmount;

    const alertThreshold = toNumber(
        budget.alertThreshold
    );

    const thresholdState: BudgetThresholdState =
        overBudget
            ? "over"
            : actualAmount > 0 &&
                percentageUsed >= alertThreshold
                ? "approaching"
                : "ok";

    return {
        budgetId: budget.id,
        budgetName: budget.name,
        categoryId: budget.categoryId,
        budgetAmount,
        actualAmount,
        remainingAmount,
        percentageUsed,
        overBudget,
        alertThreshold,
        thresholdState,
    };
}
