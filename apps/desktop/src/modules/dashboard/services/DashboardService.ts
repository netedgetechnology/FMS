import { AccountService } from "@/modules/accounts/services";
import { AccountType } from "@/modules/accounts/types";
import { TransactionService } from "@/modules/transactions/services";

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

function toNumber(value: unknown): number {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : 0;
}

export class DashboardService {
    private readonly accountService =
        new AccountService();

    private readonly transactionService =
        new TransactionService();

    async getSummary(): Promise<DashboardSummary> {
        const [
            accounts,
            transactions,
        ] = await Promise.all([
            this.accountService.getAll(),
            this.transactionService.getAll(),
        ]);

        const activeAccounts =
            accounts.filter(
                account => account.isActive
            );

        const currentMonthStart =
            startOfCurrentMonth();

        let income = 0;
        let expenses = 0;

        for (const transaction of transactions) {
            if (
                transaction.transactionDate <
                currentMonthStart
            ) {
                continue;
            }

            const amount =
                Math.abs(
                    toNumber(transaction.amount)
                );

            if (
                transaction.type === "income"
            ) {
                income += amount;
            }

            if (
                transaction.type === "expense"
            ) {
                expenses += amount;
            }
        }

        let cashBalance = 0;
        let netWorth = 0;

        const transactionsByAccount =
            new Map<
                string,
                number
            >();

        for (const transaction of transactions) {
            const amount =
                Math.abs(
                    toNumber(transaction.amount)
                );

            if (
                transaction.type === "income"
            ) {
                transactionsByAccount.set(
                    transaction.accountId,
                    (
                        transactionsByAccount.get(
                            transaction.accountId
                        ) ?? 0
                    ) + amount
                );
            }

            if (
                transaction.type === "expense"
            ) {
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

        for (const account of activeAccounts) {
            const balance =
                toNumber(
                    account.openingBalance
                ) +
                (
                    transactionsByAccount.get(
                        account.id
                    ) ?? 0
                );

            switch (account.type) {
                case AccountType.CASH:
                case AccountType.SAVINGS:
                case AccountType.CURRENT:
                case AccountType.WALLET:
                    cashBalance += balance;
                    netWorth += balance;
                    break;

                case AccountType.CREDIT_CARD:
                case AccountType.LOAN:
                    netWorth -= Math.abs(
                        balance
                    );
                    break;

                case AccountType.INVESTMENT:
                    netWorth += balance;
                    break;

                default:
                    break;
            }
        }

        const savingsRate =
            income > 0
                ? (
                      (
                          income -
                          expenses
                      ) /
                      income
                  ) *
                  100
                : 0;

        return {
            cashBalance,
            income,
            expenses,
            netWorth,
            savingsRate,
        };
    }
}
