import { currentMonth, formatDateValue } from "@/core/formatting";
import { DEFAULT_SETTINGS, SETTING_KEYS } from "@/modules/settings/constants";
import { AccountService } from "@/modules/accounts/services";
import { AccountType, type Account } from "@/modules/accounts/types";
import { BANK_ACCOUNT_TYPE_OPTIONS } from "@/modules/accounts/constants/accountTypes";
import {
    computeAccountCurrentBalance,
    computeAccountTransactionDeltas,
    type AccountBalanceTransaction,
} from "@/modules/accounts/utils";
import { TransactionService } from "@/modules/transactions/services";
import {
    LoanService,
    isScheduleOverdue,
    scheduleDaysOverdue,
} from "@/modules/loans/services";
import { LoanPaymentScheduleRepository } from "@/modules/loans/repositories/LoanPaymentScheduleRepository";
import { LoanSchedulePaymentRepository } from "@/modules/loans/repositories/LoanSchedulePaymentRepository";
import type { Loan, LoanSchedulePayment } from "@/modules/loans/types";
import { EMIScheduleService } from "@/modules/loans/services/EMIScheduleService";
import { InstitutionService } from "@/modules/institutions/services/InstitutionService";
import {
    BudgetService,
    buildBudgetReportRows,
    calculateBudgetSpending,
    resolveBudgetCurrencyScopes,
    selectBudgetsForMonth,
} from "@/modules/budgets/services";
import type {
    BudgetLedgerEntry,
    CurrencyScopeOption,
} from "@/modules/budgets/services";
import type { Budget } from "@/modules/budgets/types";
import { CurrencyService } from "@/modules/currencies/services/CurrencyService";
import { FinancialGoalService } from "@/modules/financial-goals/services";
import {
    InvestmentPortfolioCalculator,
    InvestmentService,
    resolvePrimaryInvestmentCurrencyId,
} from "@/modules/investments/services";
import { InvestmentTransactionRepository } from "@/modules/investments/repositories";
import type {
    Investment,
    InvestmentTransaction,
} from "@/modules/investments/types";
import { CategoryService } from "@/modules/categories/services";
import {
    isTransferClassified,
    transferCategoryIdSet,
} from "@/core/accounting/transferClassification";

import type {
    DashboardBudgetOverview,
    DashboardSummary,
} from "../types";

export interface DashboardDateRange {
    /** Inclusive start date, formatted as YYYY-MM-DD. */
    start: string;
    /** Inclusive end date, formatted as YYYY-MM-DD. */
    end: string;
}

/**
 * Bank account types, reused from the same source of truth Accounts uses
 * for its own "Add Bank Accounts" flow (AccountsPage) - never
 * redefined/guessed here.
 */
const BANK_ACCOUNT_TYPES: ReadonlySet<AccountType> = new Set(
    BANK_ACCOUNT_TYPE_OPTIONS.map(option => option.value)
);

/**
 * Physical "Cash on Hand" account types. Mirrors AccountsPage's own
 * existing "Cash & Wallets" grouping (its Cash & Wallets summary tile and
 * Add Cash & Wallets flow both treat CASH and WALLET as one bucket,
 * separate from bank accounts) - not a new classification invented here.
 */
const CASH_ON_HAND_ACCOUNT_TYPES: ReadonlySet<AccountType> = new Set([
    AccountType.CASH,
    AccountType.WALLET,
]);

export const DEFAULT_DASHBOARD_RANGE_DAYS = 30;

/**
 * Upper guard for the custom range. High enough to be effectively
 * unlimited for personal-finance history, low enough to keep the
 * per-day cash-flow series from freezing the UI.
 */
export const MAX_DASHBOARD_RANGE_DAYS = 3650;

function toLocalISODate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

/**
 * Build a date range covering the last `days` calendar days, ending
 * today (inclusive). `days = 1` means "today only".
 */
export function rangeFromDays(
    days: number = DEFAULT_DASHBOARD_RANGE_DAYS
): DashboardDateRange {
    const safeDays =
        Number.isFinite(days) && days > 0
            ? Math.min(
                  Math.floor(days),
                  MAX_DASHBOARD_RANGE_DAYS
              )
            : DEFAULT_DASHBOARD_RANGE_DAYS;

    const end = new Date();
    end.setHours(0, 0, 0, 0);

    const start = new Date(end);
    start.setDate(start.getDate() - (safeDays - 1));

    return {
        start: toLocalISODate(start),
        end: toLocalISODate(end),
    };
}

/**
 * The main Dashboard range selector's current mode - either a rolling
 * "last N days" window (a preset button, or the "Custom (previous days)"
 * input - both existing, unchanged behaviors) or an explicit Custom Date
 * Range with its own start/end date. Kept separate from
 * {@link DashboardPeriod} below, which is an independent, per-card
 * period filter unrelated to this main selector.
 */
export type DashboardRangeSelection =
    | { mode: "days"; days: number }
    | { mode: "customRange"; start: string; end: string };

export const DEFAULT_DASHBOARD_RANGE_SELECTION: DashboardRangeSelection = {
    mode: "days",
    days: DEFAULT_DASHBOARD_RANGE_DAYS,
};

/**
 * Resolves a {@link DashboardRangeSelection} into the concrete inclusive
 * {@link DashboardDateRange} that `getSummary` (and every period-based
 * total/chart it feeds) actually filters by.
 *
 * A Custom Date Range's start/end are passed through completely
 * unchanged - they already are plain `YYYY-MM-DD` calendar dates from a
 * native `<input type="date">`, exactly like every other date already
 * stored and compared in this app (see `toLocalISODate` below). No `Date`
 * object is constructed here, so there is no timezone-driven off-by-one
 * day risk.
 */
export function resolveDashboardRangeSelection(
    selection: DashboardRangeSelection
): DashboardDateRange {
    if (selection.mode === "customRange") {
        return {
            start: selection.start,
            end: selection.end,
        };
    }

    return rangeFromDays(selection.days);
}

const ISO_CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a real calendar date in strict `YYYY-MM-DD` form -
 * rejects malformed input and anything that isn't a real day (e.g.
 * `2026-02-30`), by round-tripping through `Date`'s own field
 * normalization rather than trusting the string alone.
 */
function isValidIsoCalendarDate(value: string): boolean {
    if (!ISO_CALENDAR_DATE_PATTERN.test(value)) {
        return false;
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
    );
}

export interface CustomDateRangeValidation {
    valid: boolean;
    /** `null` when `valid` is `true`. */
    error: string | null;
}

/**
 * Validates a Custom Date Range before it is applied to the dashboard.
 * Both dates are required, must each be a real calendar date, and start
 * must not be later than end - a single day (start === end) is valid.
 * Plain string comparison is correct and timezone-safe here: `YYYY-MM-DD`
 * strings sort lexicographically in exactly calendar order.
 */
export function validateCustomDateRange(
    start: string,
    end: string
): CustomDateRangeValidation {
    if (!start || !end) {
        return {
            valid: false,
            error: "Start date and end date are both required.",
        };
    }

    if (
        !isValidIsoCalendarDate(start) ||
        !isValidIsoCalendarDate(end)
    ) {
        return {
            valid: false,
            error: "Enter valid dates.",
        };
    }

    if (start > end) {
        return {
            valid: false,
            error: "Start date cannot be later than end date.",
        };
    }

    return { valid: true, error: null };
}

function toNumber(value: unknown): number {
    const number = Number(value);

    return Number.isFinite(number) ? number : 0;
}

/*
 * ---------------------------------------------------------------------
 * PER-CARD PERIOD FILTERS (Cash Flow Overview / Expense Breakdown)
 *
 * These are independent of the MAIN dashboard range selector. They
 * reuse the same date-range primitives (`DashboardDateRange`,
 * `rangeFromDays`, `toLocalISODate`) and the same aggregation logic
 * used by `getSummary`, so calculations stay identical.
 * ---------------------------------------------------------------------
 */

export type DashboardPeriod =
    | "7d"
    | "30d"
    | "60d"
    | "90d"
    | "180d"
    | "365d"
    | "thisMonth"
    | "lastMonth"
    | "last3Months"
    | "last6Months"
    | "last12Months";

export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriod = "30d";

function startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/**
 * Resolve a card-level period selection into a concrete inclusive date
 * range. Day-based options reuse {@link rangeFromDays}; month-based
 * options snap to calendar-month boundaries and end today.
 */
export function resolveDashboardPeriod(
    period: DashboardPeriod
): DashboardDateRange {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    switch (period) {
        case "7d":
            return rangeFromDays(7);
        case "30d":
            return rangeFromDays(30);
        case "60d":
            return rangeFromDays(60);
        case "90d":
            return rangeFromDays(90);
        case "180d":
            return rangeFromDays(180);
        case "365d":
            return rangeFromDays(365);
        case "thisMonth":
            return {
                start: toLocalISODate(startOfMonth(now)),
                end: toLocalISODate(now),
            };
        case "lastMonth": {
            const lastMonth = new Date(
                now.getFullYear(),
                now.getMonth() - 1,
                1
            );

            return {
                start: toLocalISODate(startOfMonth(lastMonth)),
                end: toLocalISODate(endOfMonth(lastMonth)),
            };
        }
        case "last3Months":
            return {
                start: toLocalISODate(
                    new Date(now.getFullYear(), now.getMonth() - 2, 1)
                ),
                end: toLocalISODate(now),
            };
        case "last6Months":
            return {
                start: toLocalISODate(
                    new Date(now.getFullYear(), now.getMonth() - 5, 1)
                ),
                end: toLocalISODate(now),
            };
        case "last12Months":
            return {
                start: toLocalISODate(
                    new Date(now.getFullYear(), now.getMonth() - 11, 1)
                ),
                end: toLocalISODate(now),
            };
        default:
            return rangeFromDays(DEFAULT_DASHBOARD_RANGE_DAYS);
    }
}

export interface CashFlowPoint {
    day: string;
    income: number;
    expense: number;
}

export interface ExpenseBreakdownItem {
    name: string;
    value: number;
}

type CashFlowTransaction = {
    id: string;
    transactionDate: string;
    type: string;
    amount: number;
    // Used only to recognise a transfer by its TRANSFER-type category
    // (see isTransferClassified).
    categoryId?: string | null;
    subcategoryId?: string | null;
};

/**
 * The amount a transaction contributes to expense totals/charts. A loan
 * EMI payment (LoanPaymentService.processPayment) is a single `expense`
 * transaction for the full instalment; `emiInterestByTransactionId`
 * (EMIScheduleService.getInterestByTransactionId) maps it to its
 * interest portion only - the principal repayment reduces the loan
 * liability (see the loanLiability comment in getSummary) but is never
 * counted as spending here. Mirrors
 * modules/budgets/services/budgetTransaction.ts's classifyBudgetTransaction
 * exactly, so Dashboard and Budgets agree on every EMI transaction
 * instead of one counting the full amount and the other only the
 * interest (Loans Phase 2). Every other transaction counts at its full
 * absolute amount, unchanged.
 */
function resolveExpenseAmount(
    transaction: { id: string; amount: number },
    emiInterestByTransactionId?: ReadonlyMap<string, number>
): number {
    const emiInterest =
        emiInterestByTransactionId?.get(transaction.id);

    if (emiInterest !== undefined) {
        return Math.max(0, toNumber(emiInterest));
    }

    return Math.abs(toNumber(transaction.amount));
}

type CategoryExpenseTransaction = CashFlowTransaction & {
    categoryId: string | null;
};

type PayeeExpenseTransaction = CashFlowTransaction & {
    payee: string;
};

/** Top individual expense transactions shown, not top categories. */
export const MAX_EXPENSE_TRANSACTIONS = 10;

function rangeSpanDays(range: DashboardDateRange): number {
    const start = new Date(`${range.start}T00:00:00`).getTime();
    const end = new Date(`${range.end}T00:00:00`).getTime();

    return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Aggregate income / expense totals across a date range into a chart
 * series. Ranges up to ~13 weeks bucket by day (compact "3 Sep"
 * labels); longer ranges bucket by calendar month ("Sep 26") so the
 * chart stays readable instead of rendering hundreds of daily points.
 */
export function computeCashFlowSeries(
    transactions: readonly CashFlowTransaction[],
    range: DashboardDateRange,
    emiInterestByTransactionId?: ReadonlyMap<string, number>,
    transferCategoryIds?: ReadonlySet<string>
): CashFlowPoint[] {
    const byMonth = rangeSpanDays(range) > 92;

    const buckets = new Map<
        string,
        { income: number; expense: number }
    >();

    const start = new Date(`${range.start}T00:00:00`);
    const end = new Date(`${range.end}T00:00:00`);

    if (byMonth) {
        for (
            let cursor = new Date(
                start.getFullYear(),
                start.getMonth(),
                1
            );
            cursor <= end;
            cursor.setMonth(cursor.getMonth() + 1)
        ) {
            buckets.set(
                `${cursor.getFullYear()}-${String(
                    cursor.getMonth() + 1
                ).padStart(2, "0")}`,
                { income: 0, expense: 0 }
            );
        }
    } else {
        for (
            let cursor = new Date(start);
            cursor <= end;
            cursor.setDate(cursor.getDate() + 1)
        ) {
            buckets.set(toLocalISODate(cursor), {
                income: 0,
                expense: 0,
            });
        }
    }

    for (const transaction of transactions) {
        if (
            transaction.transactionDate < range.start ||
            transaction.transactionDate > range.end
        ) {
            continue;
        }

        const key = byMonth
            ? transaction.transactionDate.slice(0, 7)
            : transaction.transactionDate;

        const entry = buckets.get(key);

        if (!entry) {
            continue;
        }

        // Transfers are neither income nor expense.
        if (isTransferClassified(transaction, transferCategoryIds)) {
            continue;
        }

        if (transaction.type === "income") {
            entry.income += Math.abs(
                toNumber(transaction.amount)
            );
        }

        if (transaction.type === "expense") {
            entry.expense += resolveExpenseAmount(
                transaction,
                emiInterestByTransactionId
            );
        }
    }

    return Array.from(buckets.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, value]) => ({
            day: byMonth
                ? new Date(
                      `${key}-01T00:00:00`
                  ).toLocaleDateString("en-IN", {
                      month: "short",
                      year: "2-digit",
                  })
                : new Date(
                      `${key}T00:00:00`
                  ).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                  }),
            income: value.income,
            expense: value.expense,
        }));
}

/**
 * Total expense amount per category within a date range, sorted
 * descending. `null` category ids collapse into "Others".
 */
export function computeExpensesByCategory(
    transactions: readonly CategoryExpenseTransaction[],
    categoryNames: Map<string, string>,
    range: DashboardDateRange,
    emiInterestByTransactionId?: ReadonlyMap<string, number>,
    transferCategoryIds?: ReadonlySet<string>
): ExpenseBreakdownItem[] {
    const totals = new Map<string, number>();

    for (const transaction of transactions) {
        if (transaction.type !== "expense") {
            continue;
        }

        if (isTransferClassified(transaction, transferCategoryIds)) {
            continue;
        }

        if (
            transaction.transactionDate < range.start ||
            transaction.transactionDate > range.end
        ) {
            continue;
        }

        const categoryName = transaction.categoryId
            ? categoryNames.get(transaction.categoryId) ?? "Others"
            : "Others";

        totals.set(
            categoryName,
            (totals.get(categoryName) ?? 0) +
                resolveExpenseAmount(
                    transaction,
                    emiInterestByTransactionId
                )
        );
    }

    return Array.from(totals.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value }));
}

/**
 * The top individual expense transactions (not categories) within a
 * date range, by absolute amount descending. Each transaction is its
 * own entry - nothing is aggregated or collapsed into an "Others"
 * bucket, so fewer than MAX_EXPENSE_TRANSACTIONS are returned when
 * fewer exist. Used by the Expense Breakdown card; unrelated to
 * computeExpensesByCategory, which still powers Top Spending
 * Categories.
 */
export function computeTopExpenseTransactions(
    transactions: readonly PayeeExpenseTransaction[],
    range: DashboardDateRange,
    emiInterestByTransactionId?: ReadonlyMap<string, number>,
    transferCategoryIds?: ReadonlySet<string>
): ExpenseBreakdownItem[] {
    return transactions
        .filter((transaction) => transaction.type === "expense")
        .filter(
            (transaction) =>
                !isTransferClassified(transaction, transferCategoryIds)
        )
        .filter(
            (transaction) =>
                transaction.transactionDate >= range.start &&
                transaction.transactionDate <= range.end
        )
        .map((transaction) => ({
            name: transaction.payee || "Transaction",
            value: resolveExpenseAmount(
                transaction,
                emiInterestByTransactionId
            ),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, MAX_EXPENSE_TRANSACTIONS);
}

/*
 * ---------------------------------------------------------------------
 * BUDGET OVERVIEW (Phase 6 - Dashboard Integration)
 *
 * The dashboard's current-month budget-vs-actual, derived ENTIRELY from
 * the budgets module's calculateBudgetSpending() - the single source of
 * truth also used by BudgetsPage. Nothing about spending, remaining,
 * percentages or status is recomputed here.
 *
 * - Month boundaries: the current calendar month (Phase 1
 *   selectBudgetsForMonth / calculateBudgetSpending), NOT the dashboard's
 *   rolling range selector.
 * - Currency: a single scope, resolved exactly like BudgetsPage
 *   (resolveBudgetCurrencyScopes - default currency first). When budgets
 *   exist in more than one currency, only the primary scope is shown
 *   here and `hasOtherCurrencies` is set; the Budgets page shows them
 *   all. Amounts are never summed or converted across currencies.
 * ---------------------------------------------------------------------
 */

const EMPTY_BUDGET_OVERVIEW: DashboardBudgetOverview = {
    currencyId: null,
    currencyCode: null,
    hasOtherCurrencies: false,
    totalBudget: 0,
    actualSpending: 0,
    remaining: 0,
    percentageUsed: 0,
    overBudget: false,
    unbudgetedSpending: 0,
    uncategorizedSpending: 0,
    categories: [],
};

export function computeDashboardBudgetOverview(input: {
    budgets: readonly Budget[];
    transactions: readonly BudgetLedgerEntry[];
    currencies: readonly CurrencyScopeOption[];
    categoryNameById: ReadonlyMap<string, string>;
    /** Any date within the calendar month to report on. */
    month: Date;
    emiInterestByTransactionId?: ReadonlyMap<string, number>;
    creditCardAccountIds?: ReadonlySet<string>;
    transferCategoryIds?: ReadonlySet<string>;
}): DashboardBudgetOverview {
    const applicableBudgets = selectBudgetsForMonth(
        input.budgets,
        input.month
    );

    const scopeIds = resolveBudgetCurrencyScopes(
        applicableBudgets,
        input.currencies
    );

    const currencyId = scopeIds[0] ?? null;

    if (currencyId === null) {
        return EMPTY_BUDGET_OVERVIEW;
    }

    const summary = calculateBudgetSpending({
        budgets: input.budgets,
        transactions: input.transactions,
        month: input.month,
        currencyId,
        emiInterestByTransactionId:
            input.emiInterestByTransactionId,
        creditCardAccountIds:
            input.creditCardAccountIds,
        transferCategoryIds:
            input.transferCategoryIds,
    });

    const rows = buildBudgetReportRows(
        summary,
        input.categoryNameById
    );

    const currencyCode =
        input.currencies.find(
            currency => currency.id === currencyId
        )?.code ?? null;

    return {
        currencyId,
        currencyCode,
        hasOtherCurrencies: scopeIds.length > 1,
        totalBudget: summary.totalBudgetAmount,
        actualSpending: summary.budgetedActual,
        remaining: summary.totalRemaining,
        percentageUsed: summary.totalPercentageUsed,
        overBudget:
            summary.budgetedActual >
            summary.totalBudgetAmount,
        unbudgetedSpending:
            summary.unbudgetedSpending,
        uncategorizedSpending:
            summary.uncategorizedSpending,
        categories: rows.map(row => ({
            budgetId: row.budgetId,
            label: row.categoryLabel,
            isOverallBudget: row.isOverallBudget,
            budgetAmount: row.budgetAmount,
            actualAmount: row.actualAmount,
            remainingAmount: row.remainingAmount,
            percentageUsed: row.percentageUsed,
            overBudget: row.overBudget,
            statusKey: row.status.key,
            statusLabel: row.status.label,
        })),
    };
}

/*
 * ---------------------------------------------------------------------
 * INVESTMENT SUMMARY (Dashboard widget) - Phase 6
 *
 * The Investment Summary card's own totalValue/allocation, computed
 * over ONE resolved primary currency (default currency first, else
 * the alphabetically-first currency actually in use among the given
 * investments) - mirrors computeDashboardBudgetOverview's currency
 * handling above. Never sums currentValue across investments in
 * different currencies; when every investment shares one currency
 * (the common case) this includes all of them, unchanged from before.
 *
 * monthlyChangePercentage is always null: no price/value history is
 * stored anywhere in the investments domain (Investments Phase 5
 * review), so there is no accurate prior-period value to diff against
 * - a fabricated 0% would look like a real, calculated "no change"
 * rather than "not available."
 *
 * Deliberately excludes net worth's own investment total (still every
 * active investment, unscoped) - see the "Net worth keeps summing..."
 * comment at this function's call site in getSummary().
 * ---------------------------------------------------------------------
 */
export function computeDashboardInvestmentSummary(
    investments: readonly Pick<
        Investment,
        "currencyId" | "currentValue" | "investmentType"
    >[],
    currencies: readonly CurrencyScopeOption[]
): {
    totalValue: number;
    monthlyChangePercentage: number | null;
    allocation: {
        name: string;
        value: number;
        amount: number;
    }[];
    currencyCode: string | null;
    hasOtherCurrencies: boolean;
} {
    const primaryCurrencyId =
        resolvePrimaryInvestmentCurrencyId(
            investments,
            currencies
        );

    const scopedInvestments = investments.filter(
        investment =>
            investment.currencyId === primaryCurrencyId
    );

    const totalValue = scopedInvestments.reduce(
        (sum, investment) =>
            sum + toNumber(investment.currentValue),
        0
    );

    const byType = new Map<string, number>();

    for (const investment of scopedInvestments) {
        byType.set(
            investment.investmentType,
            (byType.get(investment.investmentType) ?? 0) +
                toNumber(investment.currentValue)
        );
    }

    const allocation = Array.from(byType.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, amount]) => ({
            name,
            value:
                totalValue > 0
                    ? Math.round(
                          (amount / totalValue) * 10000
                      ) / 100
                    : 0,
            amount,
        }));

    const currencyCode =
        currencies.find(
            currency => currency.id === primaryCurrencyId
        )?.code ?? null;

    const hasOtherCurrencies =
        new Set(
            investments.map(
                investment => investment.currencyId
            )
        ).size > 1;

    return {
        totalValue,
        monthlyChangePercentage: null,
        allocation,
        currencyCode,
        hasOtherCurrencies,
    };
}

function getDaysUntil(
    date: string,
    asOf: Date = new Date()
): number {
    const today = new Date(asOf);
    const target = new Date(`${date}T00:00:00`);

    today.setHours(0, 0, 0, 0);

    return Math.ceil(
        (target.getTime() - today.getTime()) /
            (1000 * 60 * 60 * 24)
    );
}

/**
 * A schedule row's due-date presentation for the Upcoming EMIs widget -
 * Loans Phase 5. Overdue is derived here, never persisted: dueIn keeps
 * its original "days until due" meaning for a row that isn't yet due
 * (never negative); for an overdue row, how late it is now lives in
 * daysOverdue instead of being silently clamped to 0 and read as "due
 * today". A PAID row is never overdue (isScheduleOverdue excludes it
 * unconditionally), regardless of dueDate.
 */
export function computeEmiDueInfo(
    schedule: { dueDate: string; status: string },
    asOf: Date = new Date()
): {
    dueIn: number;
    isOverdue: boolean;
    daysOverdue: number;
} {
    const overdue = isScheduleOverdue(schedule, asOf);

    return {
        dueIn: overdue
            ? 0
            : Math.max(
                  0,
                  getDaysUntil(schedule.dueDate, asOf)
              ),
        isOverdue: overdue,
        daysOverdue: overdue
            ? scheduleDaysOverdue(schedule, asOf)
            : 0,
    };
}

function getEMIType(
    loanType: string
): "home" | "car" | "card" | "other" {
    const value = loanType.toLowerCase();

    if (value.includes("home")) {
        return "home";
    }

    if (value.includes("car") || value.includes("auto")) {
        return "car";
    }

    if (value.includes("card")) {
        return "card";
    }

    return "other";
}

/*
 * ---------------------------------------------------------------------
 * BANK BALANCE / CASH ON HAND - Dashboard balance tile
 *
 * Replaces the old single "Cash Balance" figure with a split, purely
 * presentational breakdown of the same account types that used to feed
 * it - net worth's own total is unaffected (see `accountsNetWorth`
 * below): every account that used to add to net worth here still adds
 * the exact same amount to it, now via whichever of the two accumulators
 * it belongs to instead of one shared one.
 * ---------------------------------------------------------------------
 */

export interface AccountBalanceSummary {
    /** Sum of CURRENT + SAVINGS account balances - see BANK_ACCOUNT_TYPES. */
    bankBalance: number;
    /** Sum of CASH + WALLET account balances - see CASH_ON_HAND_ACCOUNT_TYPES. */
    cashOnHand: number;
    /**
     * Net worth's contribution from accounts alone (bank + cash balances
     * added, credit card debt subtracted; investment/loan accounts
     * contribute nothing here - see the comments below). `getSummary()`
     * adds loan liability and investment value on top of this
     * afterward, exactly as it always has.
     */
    accountsNetWorth: number;
    accounts: {
        id: string;
        name: string;
        type: string;
        amount: number;
        isCreditCard: boolean;
    }[];
}

type BalanceAccount = Pick<
    Account,
    "id" | "name" | "type" | "openingBalance"
>;

/**
 * Classifies each account's current balance (opening balance + its net
 * transaction activity) into Bank Balance, Cash on Hand, or neither,
 * and derives the accounts-only portion of net worth alongside it - the
 * single source of truth for both the Dashboard's Bank Balance / Cash On
 * Hand tile and (combined with loan liability and investment value) its
 * Net Worth figure.
 */
export function computeAccountBalances(
    accounts: readonly BalanceAccount[],
    transactionsByAccount: ReadonlyMap<string, number>
): AccountBalanceSummary {
    let bankBalance = 0;
    let cashOnHand = 0;
    let accountsNetWorth = 0;

    const accountSummary = accounts.map(account => {
        const balance = computeAccountCurrentBalance(
            account,
            transactionsByAccount
        );

        const isCreditCard =
            account.type === AccountType.CREDIT_CARD;

        if (BANK_ACCOUNT_TYPES.has(account.type)) {
            bankBalance += balance;
            accountsNetWorth += balance;
        } else if (CASH_ON_HAND_ACCOUNT_TYPES.has(account.type)) {
            cashOnHand += balance;
            accountsNetWorth += balance;
        } else if (isCreditCard) {
            accountsNetWorth -= Math.abs(balance);
        }
        // AccountType.INVESTMENT: investment worth is added once from the
        // investments domain (getSummary's totalInvestmentValue) - the
        // linked account carries no balance, so it must not be counted
        // here or the value would be double-counted.
        //
        // AccountType.LOAN: loan liability is subtracted once from the
        // loans domain (getSummary's loanLiability) - the linked
        // account's balance is a read-time projection of that same
        // liability, so it must not be counted here too.

        return {
            id: account.id,
            name: account.name,
            type: String(account.type),
            amount: balance,
            isCreditCard,
        };
    });

    return {
        bankBalance,
        cashOnHand,
        accountsNetWorth,
        accounts: accountSummary,
    };
}

/*
 * ---------------------------------------------------------------------
 * BALANCE / NET WORTH SNAPSHOT - current, or AS OF a past date
 *
 * The Dashboard's Bank Balance, Cash On Hand and Net Worth for a
 * selected period ending D. A period ending today (or later) keeps the
 * existing current figures exactly (asOf = null). A period ending in the
 * past is rebuilt from the existing models - no stored snapshots, no new
 * valuation rules:
 *
 * - Accounts: opening balance + every balance-moving transaction dated
 *   <= D (computeAccountTransactionDeltas / balanceSide - a transfer
 *   moves its account by its direction, and stays out of
 *   Income/Expense elsewhere).
 * - Loans: today's outstanding principal + interest, plus every recorded
 *   payment dated after D added back by its own stored allocation -
 *   exactly how LoanPaymentService.reversePayment restores a payment. A
 *   loan starting after D owes nothing yet.
 * - Investments: each holding's quantity replayed from its ledger up to
 *   D (InvestmentPortfolioCalculator), valued like currentValue
 *   (quantity x currentPrice). No price history is stored, so the
 *   current price is the only price the model has. A holding with no
 *   ledger counts its currentValue from its purchase (or creation)
 *   date.
 * ---------------------------------------------------------------------
 */

export type SnapshotTransaction = AccountBalanceTransaction & {
    transactionDate: string;
};

export type SnapshotLoan = Pick<
    Loan,
    | "id"
    | "status"
    | "startDate"
    | "outstandingPrincipal"
    | "outstandingInterest"
>;

export type SnapshotLoanPayment = Pick<
    LoanSchedulePayment,
    "loanId" | "paymentDate" | "principalAmount" | "interestAmount"
>;

export type SnapshotInvestment = Pick<
    Investment,
    | "id"
    | "status"
    | "currentValue"
    | "currentPrice"
    | "purchaseDate"
    | "createdAt"
>;

export interface BalanceSnapshot extends AccountBalanceSummary {
    loanLiability: number;
    investmentValue: number;
    netWorth: number;
}

/** Today's local calendar date, `YYYY-MM-DD`. */
export function todayIsoDate(now: Date = new Date()): string {
    return toLocalISODate(now);
}

/**
 * The as-of date for a Dashboard range's balance figures: its end date
 * when that is in the past, else null (= the current figures, unchanged).
 */
export function resolveBalanceAsOf(
    range: DashboardDateRange,
    today: string = todayIsoDate()
): string | null {
    return range.end < today ? range.end : null;
}

const SHORT_MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * "As of DD Mon YYYY" for a historical balance snapshot (e.g.
 * "As of 31 Aug 2026"); null for the current figures. Built from the
 * `YYYY-MM-DD` parts directly - no Date/timezone conversion.
 */
export function formatBalanceAsOfLabel(
    asOf: string | null
): string | null {
    if (!asOf) {
        return null;
    }

    const [year, month, day] = asOf.split("-");

    return `As of ${day} ${SHORT_MONTH_NAMES[Number(month) - 1]} ${year}`;
}

/** Loan liability now (asOf null - unchanged formula) or as of a date. */
export function computeLoanLiability(
    loans: readonly SnapshotLoan[],
    payments: readonly SnapshotLoanPayment[],
    asOf: string | null
): number {
    if (asOf === null) {
        return loans.reduce(
            (total, loan) =>
                loan.status === "CLOSED"
                    ? total
                    : total +
                      Math.abs(toNumber(loan.outstandingPrincipal)) +
                      Math.abs(toNumber(loan.outstandingInterest)),
            0
        );
    }

    const paidAfter = new Map<string, number>();

    for (const payment of payments) {
        if (payment.paymentDate > asOf) {
            paidAfter.set(
                payment.loanId,
                (paidAfter.get(payment.loanId) ?? 0) +
                    toNumber(payment.principalAmount) +
                    toNumber(payment.interestAmount)
            );
        }
    }

    return loans.reduce((total, loan) => {
        if (loan.startDate > asOf) {
            return total;
        }

        // A CLOSED loan owes nothing today (it can only be closed once
        // fully paid - see LoanService); what it owed at D is exactly
        // the payments made after D.
        const outstandingNow =
            loan.status === "CLOSED"
                ? 0
                : Math.abs(toNumber(loan.outstandingPrincipal)) +
                  Math.abs(toNumber(loan.outstandingInterest));

        return total + outstandingNow + (paidAfter.get(loan.id) ?? 0);
    }, 0);
}

/**
 * Investment value for net worth now (asOf null - unchanged: every
 * non-CLOSED investment's currentValue) or as of a date.
 */
export function computeInvestmentValue(
    investments: readonly SnapshotInvestment[],
    investmentTransactions: readonly InvestmentTransaction[],
    asOf: string | null
): number {
    const active = investments.filter(
        investment => investment.status !== "CLOSED"
    );

    if (asOf === null) {
        return active.reduce(
            (sum, investment) => sum + toNumber(investment.currentValue),
            0
        );
    }

    const ledgerByInvestment = new Map<string, InvestmentTransaction[]>();

    for (const transaction of investmentTransactions) {
        const ledger = ledgerByInvestment.get(transaction.investmentId);

        if (ledger) {
            ledger.push(transaction);
        } else {
            ledgerByInvestment.set(transaction.investmentId, [transaction]);
        }
    }

    const calculator = new InvestmentPortfolioCalculator();

    return active.reduce((sum, investment) => {
        const ledger = ledgerByInvestment.get(investment.id);

        if (!ledger || ledger.length === 0) {
            const heldFrom =
                investment.purchaseDate ?? investment.createdAt.slice(0, 10);

            return heldFrom <= asOf
                ? sum + toNumber(investment.currentValue)
                : sum;
        }

        const { quantity } = calculator.calculate(
            ledger.filter(transaction => transaction.transactionDate <= asOf)
        );

        return sum + quantity * toNumber(investment.currentPrice);
    }, 0);
}

/**
 * Bank Balance, Cash On Hand and Net Worth - current (asOf null, exactly
 * the existing figures) or as of a past date. `accounts` are the active
 * accounts, as before.
 */
export function computeBalanceSnapshot(input: {
    accounts: readonly BalanceAccount[];
    transactions: readonly SnapshotTransaction[];
    loans: readonly SnapshotLoan[];
    loanPayments: readonly SnapshotLoanPayment[];
    investments: readonly SnapshotInvestment[];
    investmentTransactions: readonly InvestmentTransaction[];
    asOf: string | null;
}): BalanceSnapshot {
    const { asOf } = input;

    const transactionsByAccount = computeAccountTransactionDeltas(
        asOf === null
            ? input.transactions
            : input.transactions.filter(
                  transaction => transaction.transactionDate <= asOf
              )
    );

    const balances = computeAccountBalances(
        input.accounts,
        transactionsByAccount
    );

    const loanLiability = computeLoanLiability(
        input.loans,
        input.loanPayments,
        asOf
    );

    const investmentValue = computeInvestmentValue(
        input.investments,
        input.investmentTransactions,
        asOf
    );

    return {
        ...balances,
        loanLiability,
        investmentValue,
        // Same order of operations as before: accounts - loans + investments.
        netWorth: balances.accountsNetWorth - loanLiability + investmentValue,
    };
}

export class DashboardService {
    private readonly accountService =
        new AccountService();

    private readonly transactionService =
        new TransactionService();

    private readonly loanService =
        new LoanService();

    private readonly loanPaymentScheduleRepository =
        new LoanPaymentScheduleRepository();

    private readonly institutionService =
        new InstitutionService();

    private readonly budgetService =
        new BudgetService();

    private readonly currencyService =
        new CurrencyService();

    private readonly emiScheduleService =
        new EMIScheduleService();

    private readonly goalService =
        new FinancialGoalService();

    private readonly investmentService =
        new InvestmentService();

    private readonly categoryService =
        new CategoryService();

    private readonly loanSchedulePaymentRepository =
        new LoanSchedulePaymentRepository();

    private readonly investmentTransactionRepository =
        new InvestmentTransactionRepository();

    async getSummary(
        range: DashboardDateRange = rangeFromDays()
    ): Promise<DashboardSummary> {
        // A period ending in the past shows Bank Balance / Cash On Hand /
        // Net Worth AS OF its end date; otherwise the current figures,
        // unchanged (see computeBalanceSnapshot).
        const balanceAsOf = resolveBalanceAsOf(range);

        const [
            accounts,
            transactions,
            loans,
            budgets,
            goals,
            investments,
            categories,
            institutions,
            currencies,
            emiInterestByTransactionId,
            loanPayments,
            investmentTransactions,
        ] = await Promise.all([
            this.accountService.getAll(),
            this.transactionService.getAll(),
            this.loanService.getAll(),
            this.budgetService.getAll(),
            this.goalService.getAll(),
            this.investmentService.getAll(),
            this.categoryService.getAll(),
            this.institutionService.getAll(),
            this.currencyService.getAll(),
            this.emiScheduleService.getInterestByTransactionId(),
            // Only a historical snapshot needs these - one query each,
            // never one per loan / investment.
            balanceAsOf
                ? this.loanSchedulePaymentRepository.getAll()
                : Promise.resolve([]),
            balanceAsOf
                ? this.investmentTransactionRepository.getAll()
                : Promise.resolve([]),
        ]);

        const rangeStart = range.start;
        const rangeEnd = range.end;

        const activeAccounts =
            accounts.filter(
                account => account.isActive
            );

        const activeCategories =
            categories.filter(
                category => category.isActive
            );

        // TRANSFER-type categories (active or not): a transaction in one
        // is a transfer - excluded from every income/expense total below,
        // never from account balances.
        const transferCategoryIds =
            transferCategoryIdSet(categories);

        const categoryMap =
            new Map(
                activeCategories.map(
                    category => [
                        category.id,
                        category.name,
                    ]
                )
            );

        /*
         * ---------------------------------------------------------
         * SUMMARY
         * ---------------------------------------------------------
         */

        let income = 0;
        let expenses = 0;

        for (const transaction of transactions) {
            if (
                transaction.transactionDate <
                    rangeStart ||
                transaction.transactionDate >
                    rangeEnd
            ) {
                continue;
            }

            if (
                transaction.status !==
                "CLEARED"
            ) {
                continue;
            }

            // Transfers are neither income nor expense.
            if (
                isTransferClassified(
                    transaction,
                    transferCategoryIds
                )
            ) {
                continue;
            }

            if (transaction.type === "income") {
                income += Math.abs(
                    toNumber(transaction.amount)
                );
            }

            // A loan EMI payment's principal portion reduces the loan
            // liability (see loanLiability below), not spending - only
            // the interest portion counts here, matching Budgets'
            // classifyBudgetTransaction exactly (Loans Phase 2).
            if (transaction.type === "expense") {
                expenses += resolveExpenseAmount(
                    transaction,
                    emiInterestByTransactionId
                );
            }
        }

        // Accounts - loans + investments (see computeBalanceSnapshot). The
        // current snapshot also feeds the Accounts Summary card, which
        // always shows today's balances.
        const snapshotInput = {
            accounts: activeAccounts,
            transactions,
            loans,
            loanPayments,
            investments,
            investmentTransactions,
        };

        const currentSnapshot = computeBalanceSnapshot({
            ...snapshotInput,
            asOf: null,
        });

        const { bankBalance, cashOnHand, netWorth } =
            balanceAsOf === null
                ? currentSnapshot
                : computeBalanceSnapshot({
                      ...snapshotInput,
                      asOf: balanceAsOf,
                  });

        const accountSummary = currentSnapshot.accounts;

        const savingsRate =
            income > 0
                ? (
                      (income - expenses) /
                      income
                  ) * 100
                : 0;

        /*
         * ---------------------------------------------------------
         * CASH FLOW
         * ---------------------------------------------------------
         */

        const cashFlow = computeCashFlowSeries(
            transactions,
            {
                start: rangeStart,
                end: rangeEnd,
            },
            emiInterestByTransactionId,
            transferCategoryIds
        );

        /*
         * ---------------------------------------------------------
         * EXPENSE BREAKDOWN + TOP CATEGORIES
         * ---------------------------------------------------------
         */

        const sortedCategories = computeExpensesByCategory(
            transactions,
            categoryMap,
            {
                start: rangeStart,
                end: rangeEnd,
            },
            emiInterestByTransactionId,
            transferCategoryIds
        );

        const expenseBreakdown = computeTopExpenseTransactions(
            transactions,
            {
                start: rangeStart,
                end: rangeEnd,
            },
            emiInterestByTransactionId,
            transferCategoryIds
        );

        const topSpendingCategories = sortedCategories
            .slice(0, 5)
            .map((item) => ({
                name: item.name,
                amount: item.value,
                percentage:
                    expenses > 0
                        ? Math.round(
                              (item.value / expenses) * 100
                          )
                        : 0,
            }));

        /*
         * ---------------------------------------------------------
         * RECENT TRANSACTIONS
         * ---------------------------------------------------------
         */

        const recentTransactions =
            transactions
                .filter(
                    transaction =>
                        transaction.type ===
                            "income" ||
                        transaction.type ===
                            "expense"
                )
                .sort(
                    (a, b) =>
                        b.transactionDate.localeCompare(
                            a.transactionDate
                        )
                )
                .slice(0, 5)
                .map(transaction => ({
                    id: transaction.id,
                    title:
                        transaction.payee ||
                        "Transaction",
                    category:
                        transaction.categoryId
                            ? (
                                  categoryMap.get(
                                      transaction.categoryId
                                  ) ??
                                  "Uncategorized"
                              )
                            : "Uncategorized",
                    amount: Math.abs(
                        toNumber(
                            transaction.amount
                        )
                    ),
                    type: (transaction.type === "income" ? "income" : "expense") as "income" | "expense",
                    date: formatDateValue(
                        transaction.transactionDate,
                        String(DEFAULT_SETTINGS[SETTING_KEYS.DATE_FORMAT])
                    ),
                }));

        /*
         * ---------------------------------------------------------
         * UPCOMING EMIs
         * ---------------------------------------------------------
         *
         * Read directly from each active loan's real
         * loan_payment_schedule rows (UPCOMING/PARTIAL) - never
         * derived from maturity/start dates and never invented.
         */

        const institutionNames = new Map(
            institutions.map(institution => [
                institution.id,
                institution.name,
            ])
        );

        const activeLoans = loans.filter(
            loan => loan.status === "ACTIVE"
        );

        const loanSchedules = (
            await Promise.all(
                activeLoans.map(loan =>
                    this.loanPaymentScheduleRepository.getAllByLoanId(
                        loan.id
                    )
                )
            )
        ).flat();

        const upcomingEMIs = loanSchedules
            .filter(
                schedule =>
                    schedule.status === "UPCOMING" ||
                    schedule.status === "PARTIAL"
            )
            .map(schedule => {
                const loan = activeLoans.find(
                    item => item.id === schedule.loanId
                );

                if (!loan) {
                    return null;
                }

                const {
                    dueIn,
                    isOverdue,
                    daysOverdue,
                } = computeEmiDueInfo(schedule);

                const progress =
                    loan.principalAmount > 0
                        ? Math.min(
                              100,
                              Math.max(
                                  0,
                                  (
                                      1 -
                                      schedule.outstandingPrincipal /
                                          loan.principalAmount
                                  ) * 100
                              )
                          )
                        : 0;

                return {
                    id: schedule.id,
                    title: loan.name,
                    lender:
                        institutionNames.get(
                            loan.lenderInstitutionId ?? ""
                        ) ?? "Lender",
                    amount: Math.max(
                        0,
                        toNumber(schedule.totalAmount) -
                            toNumber(schedule.paidAmount)
                    ),
                    dueDate: formatDateValue(
                        schedule.dueDate,
                        String(DEFAULT_SETTINGS[SETTING_KEYS.DATE_FORMAT])
                    ),
                    dueIn,
                    isOverdue,
                    daysOverdue,
                    progress,
                    type: getEMIType(
                        loan.loanType
                    ),
                };
            })
            .filter(
                (
                    emi
                ): emi is NonNullable<typeof emi> =>
                    emi !== null
            )
            .sort(
                (a, b) =>
                    a.dueIn - b.dueIn
            )
            .slice(0, 5);
        /*
         * ---------------------------------------------------------
         * BUDGET OVERVIEW - current calendar month, engine-backed.
         * Uses calculateBudgetSpending() (same source of truth as
         * BudgetsPage), NOT the dashboard's rolling `range`. See
         * computeDashboardBudgetOverview above.
         * ---------------------------------------------------------
         */

        const budgetCategoryNameById = new Map(
            categories.map(category => [
                category.id,
                category.name,
            ])
        );

        const creditCardAccountIds = new Set(
            accounts
                .filter(
                    account =>
                        account.type ===
                        AccountType.CREDIT_CARD
                )
                .map(account => account.id)
        );

        const budgetOverview =
            computeDashboardBudgetOverview({
                budgets,
                transactions,
                currencies,
                categoryNameById:
                    budgetCategoryNameById,
                month: currentMonth(),
                emiInterestByTransactionId,
                creditCardAccountIds,
                transferCategoryIds,
            });
        /*
         * ---------------------------------------------------------
         * GOALS
         * ---------------------------------------------------------
         */

        const goalsProgress =
            goals
                .filter(
                    goal =>
                        goal.status ===
                        "ACTIVE"
                )
                .sort(
                    (a, b) =>
                        a.priority -
                        b.priority
                )
                .slice(0, 5)
                .map(goal => ({
                    id: goal.id,
                    name: goal.name,
                    current:
                        Math.max(
                            0,
                            toNumber(
                                goal.currentAmount
                            )
                        ),
                    target:
                        Math.max(
                            0,
                            toNumber(
                                goal.targetAmount
                            )
                        ),
                    percentage:
                        toNumber(
                            goal.targetAmount
                        ) > 0
                            ? Math.min(
                                  100,
                                  Math.max(
                                      0,
                                      (
                                          toNumber(
                                              goal.currentAmount
                                          ) /
                                          toNumber(
                                              goal.targetAmount
                                          )
                                      ) *
                                          100
                                  )
                              )
                            : 0,
                }));

        /*
         * ---------------------------------------------------------
         * INVESTMENTS
         * ---------------------------------------------------------
         */

        const activeInvestments =
            investments.filter(
                investment =>
                    investment.status !==
                    "CLOSED"
            );

        // Net worth (computeBalanceSnapshot above) keeps summing every
        // active investment's value regardless of currency, unchanged -
        // net worth already mixes currencies across every account type
        // app-wide (Investments Phase 5 review), and scoping only the
        // investments slice of it would just make it inconsistently
        // under-count rather than actually fix that broader,
        // pre-existing behavior.
        //
        // The Investment Summary widget's own totalValue/allocation
        // are a different story: summing currentValue across
        // investments in different currencies there would produce a
        // number with no real meaning (e.g. INR + USD) - scoped to a
        // single primary currency below, mirroring the Budgets
        // module's resolveBudgetCurrencyScopes pattern.
        const investmentSummary =
            computeDashboardInvestmentSummary(
                activeInvestments,
                currencies
            );

        return {
            bankBalance,
            cashOnHand,
            income,
            expenses,
            netWorth,
            balanceAsOf,
            savingsRate,

            cashFlow,

            expenseBreakdown,

            recentTransactions,

            accounts:
                accountSummary,

            topSpendingCategories,

            upcomingEMIs,

            budgetOverview,

            goalsProgress,

            investmentSummary,
        };
    }

    /**
     * Cash Flow Overview series for its own period filter. Independent
     * of the main dashboard range; uses the same aggregation as
     * `getSummary` - including the same loan-EMI interest-only
     * treatment (Loans Phase 2), so this view never disagrees with the
     * main dashboard range's cash flow for the same underlying data.
     */
    async getCashFlow(
        range: DashboardDateRange = rangeFromDays()
    ): Promise<CashFlowPoint[]> {
        const [transactions, emiInterestByTransactionId] =
            await Promise.all([
                this.transactionService.getAll(),
                this.emiScheduleService.getInterestByTransactionId(),
            ]);

        return computeCashFlowSeries(
            transactions,
            range,
            emiInterestByTransactionId
        );
    }

    /**
     * Expense Breakdown for its own period filter: the top individual
     * expense transactions (not categories), by absolute amount
     * descending. Independent of the main dashboard range; uses the
     * same aggregation - including the same loan-EMI interest-only
     * treatment (Loans Phase 2) - as `getSummary`.
     */
    async getExpenseBreakdown(
        range: DashboardDateRange = rangeFromDays()
    ): Promise<ExpenseBreakdownItem[]> {
        const [transactions, emiInterestByTransactionId] =
            await Promise.all([
                this.transactionService.getAll(),
                this.emiScheduleService.getInterestByTransactionId(),
            ]);

        return computeTopExpenseTransactions(
            transactions,
            range,
            emiInterestByTransactionId
        );
    }
}

















