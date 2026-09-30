import {
    endOfMonth,
    startOfMonth,
    toISODateString,
} from "@/core/formatting";

import type { Budget } from "../types";

import {
    monthRangeBounds,
    selectBudgetsForMonth,
    selectBudgetsForMonthRange,
    yearMonthRange,
    type BudgetMonthRange,
    type BudgetViewMode,
} from "./budgetPeriod";
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
     * For type "transfer": "OUT" / "IN". Never used for spending (a
     * transfer is never spending); read only by account-balance
     * calculations sharing this shape (e.g. Financial Plans).
     */
    transferDirection?: string | null;
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
    /**
     * Inclusive YYYY-MM-DD bounds of the reported calendar month. Both
     * "" for an All Budgets summary (calculateAllBudgetsSpending).
     */
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
    /**
     * Ids of every TRANSFER-type category: expenses in these are
     * transfers, never budget spending. Omit it and only
     * `type === "transfer"` rows are treated as transfers.
     */
    transferCategoryIds?: ReadonlySet<string>;
}

export function calculateBudgetSpending(
    input: CalculateBudgetSpendingInput
): BudgetSpendingSummary {
    const { budgets, month, currencyId } = input;

    const monthWindow: BudgetDateWindow = {
        start: toISODateString(startOfMonth(month)),
        end: toISODateString(endOfMonth(month)),
    };

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

    // Month view: the ledger and every budget line share the one
    // calendar-month window.
    const summary = summarizeBudgetSpending(
        input,
        applicableBudgets,
        transactionDate =>
            isWithinWindow(transactionDate, monthWindow),
        () => monthWindow
    );

    return {
        monthStart: monthWindow.start,
        monthEnd: monthWindow.end as string,
        ...summary,
    };
}

export type CalculateAllBudgetsSpendingInput = Omit<
    CalculateBudgetSpendingInput,
    "month"
>;

/**
 * "All Budgets" view: every active budget in `currencyId`, whatever
 * month / date range it covers - no calendar-month applicability
 * filter. Reuses exactly the same classification and aggregation as
 * calculateBudgetSpending; only the date windows differ:
 *
 *  - Each budget line's actual is the spending inside THAT budget's
 *    own [startDate, endDate] range (open-ended when endDate is
 *    null/blank), so a budget is only ever measured against its own
 *    period.
 *  - The ledger totals (totalExpense / unbudgeted / uncategorized)
 *    cover spending that falls inside at least one included budget's
 *    range - i.e. the periods the budgets in this view cover.
 *
 * When every included budget covers the same single calendar month
 * this yields exactly the month engine's numbers. `monthStart` /
 * `monthEnd` are "" - this summary is not bound to one calendar month.
 */
export function calculateAllBudgetsSpending(
    input: CalculateAllBudgetsSpendingInput
): BudgetSpendingSummary {
    const { budgets, currencyId } = input;

    const applicableBudgets = budgets.filter(
        budget =>
            budget.isActive &&
            budget.currencyId === currencyId
    );

    const windows = applicableBudgets.map(
        budgetDateWindow
    );

    const summary = summarizeBudgetSpending(
        input,
        applicableBudgets,
        transactionDate =>
            windows.some(window =>
                isWithinWindow(transactionDate, window)
            ),
        budgetDateWindow
    );

    return {
        monthStart: "",
        monthEnd: "",
        ...summary,
    };
}

export interface CalculateMonthRangeBudgetSpendingInput
    extends Omit<CalculateBudgetSpendingInput, "month"> {
    /** Inclusive month span (any dates within the first / last month). */
    range: BudgetMonthRange;
}

/**
 * "Year" / "Range" views: the active budgets in `currencyId` that apply
 * to a span of whole calendar months (budgetAppliesToMonthRange). Same
 * classification and aggregation as the other views; only the date
 * windows differ:
 *
 *  - The ledger totals cover the whole span, first day of the first
 *    month to last day of the last month - the multi-month analogue of
 *    the month view, which covers the whole month.
 *  - Each budget line is measured over the calendar months it applies
 *    to within the span (from the first day of its start month to the
 *    last day of its end month, clipped to the span) - i.e. the union of
 *    the month-view windows it would get month by month. A budget that
 *    applies to a single month therefore shows exactly its month-view
 *    actual, and a one-month span equals the month view.
 *
 * `monthStart` / `monthEnd` carry the span's bounds.
 */
export function calculateMonthRangeBudgetSpending(
    input: CalculateMonthRangeBudgetSpendingInput
): BudgetSpendingSummary {
    const { budgets, range, currencyId } = input;

    const { start: spanStart, end: spanEnd } =
        monthRangeBounds(range);

    const spanWindow: BudgetDateWindow = {
        start: spanStart,
        end: spanEnd,
    };

    const applicableBudgets = selectBudgetsForMonthRange(
        budgets,
        range
    ).filter(
        budget =>
            budget.isActive &&
            budget.currencyId === currencyId
    );

    const lineWindow = (budget: Budget): BudgetDateWindow => {
        const { start, end } = budgetDateWindow(budget);

        const monthAlignedStart = toISODateString(
            startOfMonth(parseISODate(start))
        );
        const monthAlignedEnd =
            end === null
                ? null
                : toISODateString(
                      endOfMonth(parseISODate(end))
                  );

        return {
            start:
                monthAlignedStart > spanStart
                    ? monthAlignedStart
                    : spanStart,
            end:
                monthAlignedEnd !== null &&
                monthAlignedEnd < spanEnd
                    ? monthAlignedEnd
                    : spanEnd,
        };
    };

    const summary = summarizeBudgetSpending(
        input,
        applicableBudgets,
        transactionDate =>
            isWithinWindow(transactionDate, spanWindow),
        lineWindow
    );

    return {
        monthStart: spanStart,
        monthEnd: spanEnd,
        ...summary,
    };
}

/**
 * "Year" view: the January - December span of `month`'s year (see
 * calculateMonthRangeBudgetSpending).
 */
export function calculateYearBudgetSpending(
    input: CalculateBudgetSpendingInput
): BudgetSpendingSummary {
    const { month, ...rest } = input;

    return calculateMonthRangeBudgetSpending({
        ...rest,
        range: yearMonthRange(month.getFullYear()),
    });
}

// YYYY-MM-DD -> local-midnight Date (the same local-time convention as
// the month helpers).
function parseISODate(value: string): Date {
    const [year, month, day] = value
        .slice(0, 10)
        .split("-")
        .map(Number);

    return new Date(year, month - 1, day);
}

export interface CalculateBudgetSpendingForViewInput
    extends CalculateBudgetSpendingInput {
    viewMode: BudgetViewMode;
    /**
     * The selected month span - used only in "range" view, where it
     * falls back to the single `month` when omitted.
     */
    range?: BudgetMonthRange | null;
}

// The Budgets page's single entry point: All Budgets, the selected year
// (`month`'s year), the selected month, or the selected month range.
// `month` is ignored in "all" and "range" view.
export function calculateBudgetSpendingForView(
    input: CalculateBudgetSpendingForViewInput
): BudgetSpendingSummary {
    const { viewMode, range, ...rest } = input;

    switch (viewMode) {
        case "all":
            return calculateAllBudgetsSpending(rest);
        case "year":
            return calculateYearBudgetSpending(rest);
        case "month":
            return calculateBudgetSpending(rest);
        case "range":
            return calculateMonthRangeBudgetSpending({
                ...rest,
                range: range ?? {
                    start: rest.month,
                    end: rest.month,
                },
            });
    }
}

/** Inclusive YYYY-MM-DD bounds; `end` null means open-ended. */
interface BudgetDateWindow {
    start: string;
    end: string | null;
}

function budgetDateWindow(
    budget: Pick<Budget, "startDate" | "endDate">
): BudgetDateWindow {
    return {
        start: budget.startDate,
        // Blank endDate is open-ended, same as budgetAppliesToMonth.
        end: budget.endDate || null,
    };
}

function isWithinWindow(
    date: string,
    window: BudgetDateWindow
): boolean {
    return (
        date >= window.start &&
        (window.end === null || date <= window.end)
    );
}

interface CountedExpense {
    transactionDate: string;
    amount: number;
}

// The shared aggregation behind both views. `inLedgerScope` decides
// which counted expenses feed the ledger totals; `lineWindow` gives the
// date range a budget's own line (and its share of budgetedActual) is
// measured over.
function summarizeBudgetSpending(
    input: Pick<
        CalculateBudgetSpendingInput,
        | "transactions"
        | "currencyId"
        | "emiInterestByTransactionId"
        | "creditCardAccountIds"
        | "transferCategoryIds"
    >,
    applicableBudgets: readonly Budget[],
    inLedgerScope: (transactionDate: string) => boolean,
    lineWindow: (budget: Budget) => BudgetDateWindow
): Omit<BudgetSpendingSummary, "monthStart" | "monthEnd"> {
    const {
        transactions,
        currencyId,
        emiInterestByTransactionId,
        creditCardAccountIds,
        transferCategoryIds,
    } = input;

    const classificationContext: BudgetSpendingContext = {
        emiInterestByTransactionId,
        creditCardAccountIds,
        transferCategoryIds,
    };

    // --- aggregate the ledger for the selected scope ---
    const expenses: CountedExpense[] = [];
    const expensesByCategory = new Map<
        string,
        CountedExpense[]
    >();
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

        // Inclusive scope window; anything outside is a different
        // budget period.
        if (!inLedgerScope(entry.transactionDate)) {
            continue;
        }

        const expense: CountedExpense = {
            transactionDate: entry.transactionDate,
            amount: classification.amount,
        };

        expenses.push(expense);
        totalExpense += expense.amount;

        if (entry.categoryId === null) {
            uncategorizedSpending += expense.amount;
            continue;
        }

        const categoryExpenses =
            expensesByCategory.get(entry.categoryId);

        if (categoryExpenses) {
            categoryExpenses.push(expense);
        } else {
            expensesByCategory.set(entry.categoryId, [
                expense,
            ]);
        }
    }

    const isCoveredBy = (
        expense: CountedExpense,
        windows: readonly BudgetDateWindow[]
    ): boolean =>
        windows.some(window =>
            isWithinWindow(
                expense.transactionDate,
                window
            )
        );

    const sumCovered = (
        rows: readonly CountedExpense[],
        windows: readonly BudgetDateWindow[]
    ): number =>
        rows.reduce(
            (sum, row) =>
                isCoveredBy(row, windows)
                    ? sum + row.amount
                    : sum,
            0
        );

    // --- per-budget lines ---
    const lines: BudgetSpendingLine[] =
        applicableBudgets.map(budget => {
            const budgetAmount = toNumber(
                budget.amount
            );

            const actualAmount = sumCovered(
                budget.categoryId === null
                    ? expenses
                    : expensesByCategory.get(
                          budget.categoryId
                      ) ?? [],
                [lineWindow(budget)]
            );

            return buildLine(
                budget,
                budgetAmount,
                actualAmount
            );
        });

    // --- category-budget-scoped totals ---
    // Each expense counts at most once, even when two budgets for the
    // same category cover its date, so a category's spend is never
    // counted twice.
    const windowsByBudgetedCategory = new Map<
        string,
        BudgetDateWindow[]
    >();

    for (const budget of applicableBudgets) {
        if (budget.categoryId !== null) {
            windowsByBudgetedCategory.set(
                budget.categoryId,
                [
                    ...(windowsByBudgetedCategory.get(
                        budget.categoryId
                    ) ?? []),
                    lineWindow(budget),
                ]
            );
        }
    }

    let budgetedActual = 0;

    for (const [
        categoryId,
        windows,
    ] of windowsByBudgetedCategory) {
        budgetedActual += sumCovered(
            expensesByCategory.get(categoryId) ?? [],
            windows
        );
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
