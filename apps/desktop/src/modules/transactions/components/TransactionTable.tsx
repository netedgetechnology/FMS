import { Eye, Pencil, Trash2 } from "lucide-react";

import { Transaction } from "../types";

interface TransactionTableProps {
    transactions: Transaction[];
    accounts: Map<string, string>;
    categories: Map<string, string>;
    onView: (transaction: Transaction) => void;
    onEdit: (transaction: Transaction) => void;
    onDelete: (transaction: Transaction) => void;
}

function formatType(type: string): string {
    return type
        .toLowerCase()
        .replace("_", " ")
        .replace(/\b\w/g, char => char.toUpperCase());
}

function formatDate(value: string): string {
    if (!value) {
        return "—";
    }

    const date = new Date(`${value}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    }).format(date);
}

function formatAmount(amount: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
    }).format(Number(amount ?? 0));
}

export function TransactionTable({
    transactions,
    accounts,
    categories,
    onView,
    onEdit,
    onDelete,
}: TransactionTableProps) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left">
                <thead>
                    <tr className="border-b border-slate-100">
                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Date
                        </th>

                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Payee
                        </th>

                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Account
                        </th>

                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Category
                        </th>

                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Type
                        </th>

                        <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Amount
                        </th>

                        <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Actions
                        </th>
                    </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                    {transactions.map(transaction => (
                        <tr
                            key={transaction.id}
                            className="transition-colors hover:bg-slate-50/70"
                        >
                            <td className="px-4 py-3 text-sm text-slate-600">
                                {formatDate(transaction.transactionDate)}
                            </td>

                            <td className="px-4 py-3">
                                <div className="text-sm font-medium text-slate-800">
                                    {transaction.payee || "—"}
                                </div>

                                {transaction.referenceNumber && (
                                    <div className="mt-0.5 text-[11px] text-slate-400">
                                        {transaction.referenceNumber}
                                    </div>
                                )}
                            </td>

                            <td className="px-4 py-3 text-sm text-slate-600">
                                {accounts.get(transaction.accountId) ||
                                    transaction.accountId}
                            </td>

                            <td className="px-4 py-3 text-sm text-slate-600">
                                {transaction.categoryId
                                    ? categories.get(transaction.categoryId) ||
                                      transaction.categoryId
                                    : "None"}
                            </td>

                            <td className="px-4 py-3 text-sm text-slate-600">
                                {formatType(transaction.type)}
                            </td>

                            <td className="px-4 py-3 text-right text-sm font-medium text-slate-800">
                                {formatAmount(transaction.amount)}
                            </td>

                            <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-1">
                                    <button
                                        type="button"
                                        onClick={() => onView(transaction)}
                                        title="View transaction"
                                        aria-label={`View ${transaction.payee}`}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                                    >
                                        <Eye size={15} />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => onEdit(transaction)}
                                        title="Edit transaction"
                                        aria-label={`Edit ${transaction.payee}`}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                                    >
                                        <Pencil size={15} />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => onDelete(transaction)}
                                        title="Delete transaction"
                                        aria-label={`Delete ${transaction.payee}`}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                                    >
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
