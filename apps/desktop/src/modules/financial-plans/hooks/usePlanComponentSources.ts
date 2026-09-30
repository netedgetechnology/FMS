import {
    useEffect,
    useMemo,
    useState,
} from "react";

import { AccountService } from "@/modules/accounts/services";
import { CategoryService } from "@/modules/categories/services";
import { InvestmentService } from "@/modules/investments/services";
import { LoanService } from "@/modules/loans/services";
import { TransactionService } from "@/modules/transactions/services";

import type { Account } from "@/modules/accounts/types";
import type { Category } from "@/modules/categories/types";
import type { Investment } from "@/modules/investments/types";
import type { Loan } from "@/modules/loans/types";
import type { Transaction } from "@/modules/transactions/types";

import {
    ACCOUNT_ASSET_TYPES,
    ACCOUNT_EXCLUDED_TYPES,
    ACCOUNT_LIABILITY_TYPES,
    deriveCategoryRole,
} from "../constants";
import type {
    PlanComponentRole,
    PlanComponentType,
} from "../types";

export interface PlanComponentSourceOption {
    id: string;
    name: string;
    /** Only set for account / investment / loan sources. */
    currencyId: string | null;
    detail?: string;
}

/**
 * Loads the candidate sources for a plan component. The picker filters
 * these to the ones actually valid for a chosen (type, role) + plan
 * currency - see `sourceOptionsFor`.
 */
export function usePlanComponentSources() {
    const [accounts, setAccounts] = useState<
        Account[]
    >([]);
    const [categories, setCategories] = useState<
        Category[]
    >([]);
    const [investments, setInvestments] = useState<
        Investment[]
    >([]);
    const [loans, setLoans] = useState<Loan[]>([]);
    const [transactions, setTransactions] = useState<
        Transaction[]
    >([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;

        async function load() {
            setLoading(true);

            try {
                const [
                    accountData,
                    categoryData,
                    investmentData,
                    loanData,
                    transactionData,
                ] = await Promise.all([
                    new AccountService().getAll(),
                    new CategoryService().getAll(),
                    new InvestmentService().getAll(),
                    new LoanService().getAll(),
                    new TransactionService().getAll(),
                ]);

                if (!active) {
                    return;
                }

                setAccounts(accountData);
                setCategories(categoryData);
                setInvestments(investmentData);
                setLoans(loanData);
                setTransactions(transactionData);
            } catch (err) {
                console.error(
                    "Failed to load component sources:",
                    err
                );
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        }

        void load();

        return () => {
            active = false;
        };
    }, []);

    return useMemo(
        () => ({
            accounts,
            categories,
            investments,
            loans,
            loading,
            sourceOptionsFor: (
                componentType: PlanComponentType,
                role: PlanComponentRole,
                planCurrencyId: string
            ): PlanComponentSourceOption[] =>
                sourceOptionsFor(
                    {
                        accounts,
                        categories,
                        investments,
                        loans,
                        transactions,
                    },
                    componentType,
                    role,
                    planCurrencyId
                ),
        }),
        [
            accounts,
            categories,
            investments,
            loans,
            transactions,
            loading,
        ]
    );
}

interface SourceData {
    accounts: Account[];
    categories: Category[];
    investments: Investment[];
    loans: Loan[];
    transactions: Transaction[];
}

export function sourceOptionsFor(
    data: SourceData,
    componentType: PlanComponentType,
    role: PlanComponentRole,
    planCurrencyId: string
): PlanComponentSourceOption[] {
    if (componentType === "ACCOUNT") {
        return data.accounts
            .filter(account => {
                if (
                    ACCOUNT_EXCLUDED_TYPES.includes(
                        account.type
                    )
                ) {
                    return false;
                }

                if (
                    account.currencyId !==
                    planCurrencyId
                ) {
                    return false;
                }

                if (role === "ASSET") {
                    return ACCOUNT_ASSET_TYPES.includes(
                        account.type
                    );
                }

                if (role === "LIABILITY") {
                    return ACCOUNT_LIABILITY_TYPES.includes(
                        account.type
                    );
                }

                // CONTRIBUTION: any non-excluded account.
                return true;
            })
            .map(account => ({
                id: account.id,
                name: account.name,
                currencyId: account.currencyId,
                detail: account.type,
            }));
    }

    if (componentType === "CATEGORY") {
        const wantedTransactionType =
            role === "CONTRIBUTION"
                ? "income"
                : role === "SPENDING"
                  ? "expense"
                  : null;

        const accountCurrencyById = new Map(
            data.accounts.map(account => [
                account.id,
                account.currencyId,
            ])
        );

        const hasMatchingTransaction = (
            categoryId: string
        ) =>
            wantedTransactionType !== null &&
            data.transactions.some(
                transaction =>
                    transaction.categoryId ===
                        categoryId &&
                    transaction.type ===
                        wantedTransactionType &&
                    accountCurrencyById.get(
                        transaction.accountId
                    ) === planCurrencyId
            );

        return data.categories
            .filter(category => {
                const expectedRole = deriveCategoryRole(
                    category.categoryType
                );

                if (expectedRole === null) {
                    return false; // TRANSFER - never linkable
                }

                // A category's own type is a suggestion, not
                // authoritative (categories are used across both income
                // and expense transactions) - one whose type doesn't
                // match is still eligible when it already has a real
                // transaction in this direction, in the plan currency.
                return (
                    expectedRole === role ||
                    hasMatchingTransaction(category.id)
                );
            })
            .map(category => ({
                id: category.id,
                name: category.name,
                currencyId: null,
                detail: category.categoryType,
            }));
    }

    if (componentType === "INVESTMENT") {
        return data.investments
            .filter(
                investment =>
                    investment.status === "ACTIVE" &&
                    investment.currencyId ===
                        planCurrencyId
            )
            .map(investment => ({
                id: investment.id,
                name: investment.name,
                currencyId: investment.currencyId,
                detail: investment.investmentType,
            }));
    }

    return data.loans
        .filter(
            loan =>
                loan.status === "ACTIVE" &&
                loan.currencyId === planCurrencyId
        )
        .map(loan => ({
            id: loan.id,
            name: loan.name,
            currencyId: loan.currencyId,
            detail: loan.loanType,
        }));
}
