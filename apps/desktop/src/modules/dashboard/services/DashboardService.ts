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

function startOfCurrentMonth(): string {
    const now = new Date();

    return new Date(
        now.getFullYear(),
        now.getMonth(),
        1
    )
        .toISOString()
        .slice(0, 10);
}

function endOfCurrentMonth(): string {
    const now = new Date();

    return new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0
    )
        .toISOString()
        .slice(0, 10);
}

function toNumber(value: unknown): number {
    const number = Number(value);

    return Number.isFinite(number) ? number : 0;
}

function formatDate(date: string): string {
    const parsed = new Date(`${date}T00:00:00`);

    return parsed.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
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

function getCategoryColor(index: number): string {
    const colors = [
        "#2F66E8",
        "#22C55E",
        "#F59E0B",
        "#8B5CF6",
        "#EF4444",
        "#60A5FA",
        "#EC4899",
        "#14B8A6",
    ];

    return colors[index % colors.length];
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

    async getSummary(): Promise<DashboardSummary> {
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

        const currentMonthStart =
            startOfCurrentMonth();

        const currentMonthEnd =
            endOfCurrentMonth();

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
                    currentMonthStart ||
                transaction.transactionDate >
                    currentMonthEnd
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
                        netWorth += balance;
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

        const cashFlowMap =
            new Map<
                string,
                {
                    income: number;
                    expense: number;
                }
            >();

        const cashFlowToday =
            new Date();

        cashFlowToday.setHours(
            0,
            0,
            0,
            0
        );

        for (
            let day = 1;
            day <=
            new Date(
                cashFlowToday.getFullYear(),
                cashFlowToday.getMonth() + 1,
                0
            ).getDate();
            day++
        ) {
            const date =
                new Date(
                    cashFlowToday.getFullYear(),
                    cashFlowToday.getMonth(),
                    day
                );

            if (date > cashFlowToday) {
                break;
            }

            const key =
                date
                    .toISOString()
                    .slice(0, 10);

            cashFlowMap.set(key, {
                income: 0,
                expense: 0,
            });
        }

        for (const transaction of transactions) {
            if (
                transaction.transactionDate <
                    currentMonthStart ||
                transaction.transactionDate >
                    currentMonthEnd
            ) {
                continue;
            }

            const entry =
                cashFlowMap.get(
                    transaction.transactionDate
                );

            if (!entry) {
                continue;
            }

            const amount =
                Math.abs(
                    toNumber(
                        transaction.amount
                    )
                );

            if (
                transaction.type ===
                "income"
            ) {
                entry.income += amount;
            }

            if (
                transaction.type ===
                "expense"
            ) {
                entry.expense += amount;
            }
        }
        const cashFlow =
            Array.from(
                cashFlowMap.entries()
            ).map(([date, value]) => ({
                day: new Date(
                    `${date}T00:00:00`
                ).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                }),
                income: value.income,
                expense: value.expense,
            }));

        /*
         * ---------------------------------------------------------
         * EXPENSE BREAKDOWN + TOP CATEGORIES
         * ---------------------------------------------------------
         */

        const expensesByCategory =
            new Map<string, number>();

        for (const transaction of transactions) {
            if (
                transaction.type !== "expense"
            ) {
                continue;
            }

            if (
                transaction.transactionDate <
                    currentMonthStart ||
                transaction.transactionDate >
                    currentMonthEnd
            ) {
                continue;
            }

            const categoryName =
                transaction.categoryId
                    ? (
                          categoryMap.get(
                              transaction.categoryId
                          ) ?? "Others"
                      )
                    : "Others";

            expensesByCategory.set(
                categoryName,
                (
                    expensesByCategory.get(
                        categoryName
                    ) ?? 0
                ) +
                    Math.abs(
                        toNumber(transaction.amount)
                    )
            );
        }

        const sortedCategories =
            Array.from(
                expensesByCategory.entries()
            )
                .sort(
                    (a, b) => b[1] - a[1]
                );

        const expenseBreakdown =
            sortedCategories.map(
                ([name, value], index) => ({
                    name,
                    value,
                    color:
                        getCategoryColor(index),
                })
            );

        const topSpendingCategories =
            sortedCategories
                .slice(0, 5)
                .map(([name, amount]) => ({
                    name,
                    amount,
                    percentage:
                        expenses > 0
                            ? Math.round(
                                  (amount /
                                      expenses) *
                                      100
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
                    date: formatDate(
                        transaction.transactionDate
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
                    dueDate: formatDate(
                        schedule.dueDate
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
                            currentMonthStart ||
                        transaction.transactionDate >
                            currentMonthEnd
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
}













