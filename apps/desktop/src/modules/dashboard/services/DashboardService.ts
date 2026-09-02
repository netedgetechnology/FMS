import { formatDateValue } from "@/core/formatting";
import { DEFAULT_SETTINGS, SETTING_KEYS } from "@/modules/settings/constants";
import { AccountService } from "@/modules/accounts/services";
import { AccountType } from "@/modules/accounts/types";
import { TransactionService } from "@/modules/transactions/services";
import { LoanService } from "@/modules/loans/services";
import { LoanPaymentScheduleRepository } from "@/modules/loans/repositories/LoanPaymentScheduleRepository";
import { InstitutionService } from "@/modules/institutions/services/InstitutionService";
import { BudgetService } from "@/modules/budgets/services";
import { FinancialGoalService } from "@/modules/financial-goals/services";
import { InvestmentService } from "@/modules/investments/services";
import { CategoryService } from "@/modules/categories/services";

import type { DashboardSummary } from "../types";

export interface DashboardDateRange {
    /** Inclusive start date, formatted as YYYY-MM-DD. */
    start: string;
    /** Inclusive end date, formatted as YYYY-MM-DD. */
    end: string;
}

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
    transactionDate: string;
    type: string;
    amount: number;
};

type CategoryExpenseTransaction = CashFlowTransaction & {
    categoryId: string | null;
};

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
    range: DashboardDateRange
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

        const amount = Math.abs(toNumber(transaction.amount));

        if (transaction.type === "income") {
            entry.income += amount;
        }

        if (transaction.type === "expense") {
            entry.expense += amount;
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
    range: DashboardDateRange
): ExpenseBreakdownItem[] {
    const totals = new Map<string, number>();

    for (const transaction of transactions) {
        if (transaction.type !== "expense") {
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
                Math.abs(toNumber(transaction.amount))
        );
    }

    return Array.from(totals.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value }));
}

function getDaysUntil(date: string): number {
    const today = new Date();
    const target = new Date(`${date}T00:00:00`);

    today.setHours(0, 0, 0, 0);

    return Math.ceil(
        (target.getTime() - today.getTime()) /
            (1000 * 60 * 60 * 24)
    );
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

    private readonly goalService =
        new FinancialGoalService();

    private readonly investmentService =
        new InvestmentService();

    private readonly categoryService =
        new CategoryService();

    async getSummary(
        range: DashboardDateRange = rangeFromDays()
    ): Promise<DashboardSummary> {
        const [
            accounts,
            transactions,
            loans,
            budgets,
            goals,
            investments,
            categories,
            institutions,
        ] = await Promise.all([
            this.accountService.getAll(),
            this.transactionService.getAll(),
            this.loanService.getAll(),
            this.budgetService.getAll(),
            this.goalService.getAll(),
            this.investmentService.getAll(),
            this.categoryService.getAll(),
            this.institutionService.getAll(),
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

            const amount =
                Math.abs(
                    toNumber(transaction.amount)
                );

            if (transaction.type === "income") {
                income += amount;
            }

            if (transaction.type === "expense") {
                expenses += amount;
            }
        }

        const transactionsByAccount =
            new Map<string, number>();

        for (const transaction of transactions) {
            const amount =
                Math.abs(
                    toNumber(transaction.amount)
                );

            if (transaction.type === "income") {
                transactionsByAccount.set(
                    transaction.accountId,
                    (
                        transactionsByAccount.get(
                            transaction.accountId
                        ) ?? 0
                    ) + amount
                );
            }

            if (transaction.type === "expense") {
                transactionsByAccount.set(
                    transaction.accountId,
                    (
                        transactionsByAccount.get(
                            transaction.accountId
                        ) ?? 0
                    ) - amount
                );
            }
        }

        let cashBalance = 0;
        let netWorth = 0;

        const accountSummary =
            activeAccounts.map(account => {
                const balance =
                    toNumber(
                        account.openingBalance
                    ) +
                    (
                        transactionsByAccount.get(
                            account.id
                        ) ?? 0
                    );

                const isCreditCard =
                    account.type ===
                    AccountType.CREDIT_CARD;

                switch (account.type) {
                    case AccountType.CASH:
                    case AccountType.SAVINGS:
                    case AccountType.CURRENT:
                    case AccountType.WALLET:
                        cashBalance += balance;
                        netWorth += balance;
                        break;

                    case AccountType.CREDIT_CARD:
                        netWorth -= Math.abs(balance);
                        break;

                    case AccountType.INVESTMENT:
                        // Investment worth is added once from the investments
                        // domain below (totalInvestmentValue). The linked
                        // account carries no balance, so it must not be
                        // counted here or the value is double-counted.
                        break;

                    default:
                        break;
                }

                return {
                    id: account.id,
                    name: account.name,
                    type: String(account.type),
                    amount: balance,
                    isCreditCard,
                };
            });

        const loanLiability =
            loans.reduce(
                (total, loan) => {
                    if (
                        loan.status === "CLOSED"
                    ) {
                        return total;
                    }

                    return (
                        total +
                        Math.abs(
                            toNumber(
                                loan.outstandingPrincipal
                            )
                        ) +
                        Math.abs(
                            toNumber(
                                loan.outstandingInterest
                            )
                        )
                    );
                },
                0
            );

        netWorth -= loanLiability;

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
            }
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
            }
        );

        const expenseBreakdown = sortedCategories.map(
            (item) => ({
                name: item.name,
                value: item.value,
            })
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
         * Loan model does not currently contain an individual
         * repayment schedule, so use the loan maturity/start
         * information available to us. We do not invent EMI
         * records that do not exist in the database.
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

                const dueIn = Math.max(
                    0,
                    getDaysUntil(schedule.dueDate)
                );

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
         * BUDGET OVERVIEW
         * ---------------------------------------------------------
         */

        const today = new Date();

        const todayString =
            today.toISOString().slice(0, 10);

        const applicableBudgets =
            budgets.filter(
                budget => {
                    if (!budget.isActive) {
                        return false;
                    }

                    if (
                        budget.startDate >
                        todayString
                    ) {
                        return false;
                    }

                    if (
                        budget.endDate !== null &&
                        budget.endDate <
                            todayString
                    ) {
                        return false;
                    }

                    return true;
                }
            );

        const totalBudget =
            applicableBudgets.reduce(
                (sum, budget) =>
                    sum +
                    toNumber(
                        budget.amount
                    ),
                0
            );

        const budgetSpent =
            transactions.reduce(
                (total, transaction) => {
                    if (
                        transaction.type !==
                        "expense"
                    ) {
                        return total;
                    }

                    if (
                        transaction.transactionDate <
                            rangeStart ||
                        transaction.transactionDate >
                            rangeEnd
                    ) {
                        return total;
                    }

                    const matchesBudget =
                        applicableBudgets.some(
                            budget => {
                                if (
                                    budget.categoryId !==
                                        null &&
                                    budget.categoryId !==
                                        transaction.categoryId
                                ) {
                                    return false;
                                }

                                return true;
                            }
                        );

                    if (!matchesBudget) {
                        return total;
                    }

                    return (
                        total +
                        Math.abs(
                            toNumber(
                                transaction.amount
                            )
                        )
                    );
                },
                0
            );

        const budgetRemaining =
            Math.max(
                0,
                totalBudget -
                    budgetSpent
            );

        const budgetPercentage =
            totalBudget > 0
                ? Math.min(
                      100,
                      Math.round(
                          (
                              budgetSpent /
                              totalBudget
                          ) * 10000
                      ) / 100
                  )
                : 0;
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

        const totalInvestmentValue =
            activeInvestments.reduce(
                (sum, investment) =>
                    sum +
                    toNumber(
                        investment.currentValue
                    ),
                0
            );

        netWorth += totalInvestmentValue;

        const investmentByType =
            new Map<string, number>();

        for (const investment of activeInvestments) {
            investmentByType.set(
                investment.investmentType,
                (
                    investmentByType.get(
                        investment.investmentType
                    ) ?? 0
                ) +
                    toNumber(
                        investment.currentValue
                    )
            );
        }

        const investmentAllocation =
            Array.from(
                investmentByType.entries()
            )
                .sort(
                    (a, b) => b[1] - a[1]
                )
                .map(
                    ([name, amount]) => ({
                        name,
                        value:
                            totalInvestmentValue >
                            0
                                ? Math.round(
                                      (
                                          amount /
                                          totalInvestmentValue
                                      ) *
                                          10000
                                  ) / 100
                                : 0,
                        amount,
                    })
                );

        return {
            cashBalance,
            income,
            expenses,
            netWorth,
            savingsRate,

            cashFlow,

            expenseBreakdown,

            recentTransactions,

            accounts:
                accountSummary,

            topSpendingCategories,

            upcomingEMIs,

            budgetOverview: {
                totalBudget,
                spent: budgetSpent,
                remaining:
                    budgetRemaining,
                percentage:
                    budgetPercentage,
            },

            goalsProgress,

            investmentSummary: {
                totalValue:
                    totalInvestmentValue,
                monthlyChangePercentage: 0,
                allocation:
                    investmentAllocation,
            },
        };
    }

    /**
     * Cash Flow Overview series for its own period filter. Independent
     * of the main dashboard range; uses the same aggregation as
     * `getSummary`.
     */
    async getCashFlow(
        range: DashboardDateRange = rangeFromDays()
    ): Promise<CashFlowPoint[]> {
        const transactions =
            await this.transactionService.getAll();

        return computeCashFlowSeries(transactions, range);
    }

    /**
     * Expense Breakdown category totals for its own period filter.
     * Independent of the main dashboard range; uses the same
     * aggregation as `getSummary`.
     */
    async getExpenseBreakdown(
        range: DashboardDateRange = rangeFromDays()
    ): Promise<ExpenseBreakdownItem[]> {
        const [transactions, categories] = await Promise.all([
            this.transactionService.getAll(),
            this.categoryService.getAll(),
        ]);

        const categoryNames = new Map(
            categories
                .filter((category) => category.isActive)
                .map((category) => [category.id, category.name])
        );

        return computeExpensesByCategory(
            transactions,
            categoryNames,
            range
        );
    }
}

















