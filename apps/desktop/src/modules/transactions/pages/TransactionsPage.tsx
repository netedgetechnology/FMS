import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/common";

import { useAccounts } from "@/modules/accounts/hooks";
import { useCategories } from "@/modules/categories/hooks";

import {
    AddTransactionDialog,
    DeleteTransactionDialog,
    EditTransactionDialog,
    TransactionTable,
    ViewTransactionDialog,
} from "../components";

import { useTransactions } from "../hooks";


export default function TransactionsPage() {
    const {
        transactions,
        loading,
        error,
        refresh,
    } = useTransactions();

    const { accounts } = useAccounts();
    const { categories } = useCategories();

    const [search, setSearch] = useState("");

    const [viewingTransaction, setViewingTransaction] =
        useState<import("../types").Transaction | null>(null);

    const [editingTransaction, setEditingTransaction] =
        useState<import("../types").Transaction | null>(null);

    const [deletingTransaction, setDeletingTransaction] =
        useState<import("../types").Transaction | null>(null);

    const accountMap = useMemo(
        () =>
            new Map(
                accounts.map(account => [
                    account.id,
                    account.name,
                ])
            ),
        [accounts]
    );

    const categoryMap = useMemo(
        () =>
            new Map(
                categories.map(category => [
                    category.id,
                    category.name,
                ])
            ),
        [categories]
    );

    const filteredTransactions = useMemo(() => {
        const query = search.trim().toLowerCase();

        if (!query) {
            return transactions;
        }

        return transactions.filter(transaction => {
            const accountName =
                accountMap.get(transaction.accountId) || "";

            const categoryName = transaction.categoryId
                ? categoryMap.get(transaction.categoryId) || ""
                : "";

            return [
                transaction.payee,
                transaction.referenceNumber,
                transaction.notes,
                transaction.type,
                accountName,
                categoryName,
                transaction.transactionDate,
            ]
                .filter(Boolean)
                .some(value =>
                    String(value)
                        .toLowerCase()
                        .includes(query)
                );
        });
    }, [
        transactions,
        search,
        accountMap,
        categoryMap,
    ]);

    const totalIncome = useMemo(
        () =>
            transactions
                .filter(
                    transaction =>
                        transaction.type === "income"
                )
                .reduce(
                    (total, transaction) =>
                        total +
                        Number(transaction.amount || 0),
                    0
                ),
        [transactions]
    );

    const totalExpense = useMemo(
        () =>
            transactions
                .filter(
                    transaction =>
                        transaction.type === "expense"
                )
                .reduce(
                    (total, transaction) =>
                        total +
                        Number(transaction.amount || 0),
                    0
                ),
        [transactions]
    );

    const netAmount = totalIncome - totalExpense;

    const formatAmount = (amount: number) =>
        new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 2,
        }).format(amount);

    return (
        <div className="min-h-full bg-slate-50">
            <div className="w-full space-y-6">
                <PageHeader
                    title="Transactions"
                    subtitle="Record and manage your income, expenses and transfers."
                    actions={
                        <AddTransactionDialog
                            onSuccess={refresh}
                            trigger={
                                <button
                                    type="button"
                                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800"
                                >
                                    <Plus size={16} />
                                    Add Transaction
                                </button>
                            }
                        />
                    }
                />

                <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
                    <div className="rounded-3xl bg-white px-5 py-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
                        <div className="text-caption font-medium text-slate-500">
                            Total Income
                        </div>

                        <div className="mt-3 text-card-value leading-none tracking-[-0.02em] text-[#0F172A]">
                            {formatAmount(totalIncome)}
                        </div>
                    </div>

                    <div className="rounded-3xl bg-white px-5 py-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
                        <div className="text-caption font-medium text-slate-500">
                            Total Expenses
                        </div>

                        <div className="mt-3 text-card-value leading-none tracking-[-0.02em] text-[#0F172A]">
                            {formatAmount(totalExpense)}
                        </div>
                    </div>

                    <div className="rounded-3xl bg-white px-5 py-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
                        <div className="text-caption font-medium text-slate-500">
                            Net
                        </div>

                        <div className="mt-3 text-card-value leading-none tracking-[-0.02em] text-[#0F172A]">
                            {formatAmount(netAmount)}
                        </div>
                    </div>
                </section>

                <section className="rounded-[28px] border border-slate-100 bg-white p-7 shadow-sm">
                    <div className="mb-6 flex items-start justify-between">
                        <div>
                            <h2 className="text-[22px] font-bold text-slate-900">
                                Transactions
                            </h2>

                            <p className="mt-1 text-[15px] text-slate-500">
                                All financial transactions in one place.
                            </p>
                        </div>

                        <div
                            className="
                                flex
                                h-11
                                w-[315px]
                                items-center
                                rounded-2xl
                                border
                                border-slate-200
                                bg-slate-50
                                px-4
                                transition-all
                                duration-200
                                focus-within:border-slate-300
                                focus-within:bg-white
                                focus-within:shadow-sm
                            "
                        >
                            <input
                                type="search"
                                value={search}
                                onChange={event =>
                                    setSearch(event.target.value)
                                }
                                placeholder="Search transactions..."
                                className="
                                    w-full
                                    bg-transparent
                                    text-sm
                                    text-slate-700
                                    outline-none
                                    placeholder:text-slate-400
                                "
                            />
                        </div>
                    </div>

                    {loading && (
                        <div className="flex min-h-[240px] items-center justify-center">
                            <p className="text-sm text-slate-400">
                                Loading transactions...
                            </p>
                        </div>
                    )}

                    {!loading && error && (
                        <div className="flex min-h-[240px] items-center justify-center">
                            <p className="text-sm text-red-500">
                                {error}
                            </p>
                        </div>
                    )}

                    {!loading &&
                        !error &&
                        transactions.length === 0 && (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12">
                                <EmptyState
                                    title="No transactions yet"
                                    description="Add your first income, expense or transfer to start tracking your finances."
                                />
                            </div>
                        )}

                    {!loading &&
                        !error &&
                        transactions.length > 0 &&
                        filteredTransactions.length === 0 && (
                            <div className="flex min-h-[180px] items-center justify-center">
                                <p className="text-sm text-slate-400">
                                    No transactions match your search.
                                </p>
                            </div>
                        )}

                    {!loading &&
                        !error &&
                        filteredTransactions.length > 0 && (
                            <div className="overflow-hidden rounded-2xl border border-slate-100 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-slate-50">
                                <TransactionTable
                                    transactions={filteredTransactions}
                                    accounts={accountMap}
                                    categories={categoryMap}
                                    onView={setViewingTransaction}
                                    onEdit={setEditingTransaction}
                                    onDelete={setDeletingTransaction}
                                />
                            </div>
                        )}
                </section>
                <ViewTransactionDialog
                    transaction={viewingTransaction}
                    accountName={
                        viewingTransaction
                            ? accountMap.get(
                                  viewingTransaction.accountId
                              )
                            : undefined
                    }
                    categoryName={
                        viewingTransaction?.categoryId
                            ? categoryMap.get(
                                  viewingTransaction.categoryId
                              )
                            : undefined
                    }
                    open={viewingTransaction !== null}
                    onOpenChange={open => {
                        if (!open) {
                            setViewingTransaction(null);
                        }
                    }}
                />

                <EditTransactionDialog
                    transaction={editingTransaction}
                    open={editingTransaction !== null}
                    onOpenChange={open => {
                        if (!open) {
                            setEditingTransaction(null);
                        }
                    }}
                    onSuccess={refresh}
                />

                <DeleteTransactionDialog
                    transaction={deletingTransaction}
                    open={deletingTransaction !== null}
                    onOpenChange={open => {
                        if (!open) {
                            setDeletingTransaction(null);
                        }
                    }}
                    onSuccess={refresh}
                />


            </div>
        </div>
    );
}











