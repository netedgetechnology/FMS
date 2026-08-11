import { Eye, Pencil, Trash2 } from "lucide-react";

import { Account } from "../types";

interface AccountTableProps {
    accounts: Account[];
    onView: (account: Account) => void;
    onEdit: (account: Account) => void;
    onDelete: (account: Account) => void;
}

function formatType(type: string): string {
    return type
        .toLowerCase()
        .replace("_", " ")
        .replace(/\b\w/g, char => char.toUpperCase());
}

function formatCurrency(amount: number, currency: string): string {
    try {
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency,
            maximumFractionDigits: 2,
        }).format(amount);
    } catch {
        return `${currency} ${amount.toFixed(2)}`;
    }
}

export function AccountTable({
    accounts,
    onView,
    onEdit,
    onDelete,
}: AccountTableProps) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left">
                <thead>
                    <tr className="border-b border-slate-100">
                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Account
                        </th>

                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Type
                        </th>

                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Institution
                        </th>

                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Currency
                        </th>

                        <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Balance
                        </th>

                        <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Status
                        </th>

                        <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Actions
                        </th>
                    </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                    {accounts.map(account => (
                        <tr
                            key={account.id}
                            className="transition-colors hover:bg-slate-50/70"
                        >
                            <td className="px-4 py-3">
                                <div className="text-sm font-medium text-slate-800">
                                    {account.name}
                                </div>

                                {account.accountNumber && (
                                    <div className="mt-0.5 text-[11px] text-slate-400">
                                        {account.accountNumber}
                                    </div>
                                )}
                            </td>

                            <td className="px-4 py-3 text-sm text-slate-600">
                                {formatType(account.type)}
                            </td>

                            <td className="px-4 py-3 text-sm text-slate-600">
                                {account.institutionName || "�"}
                            </td>

                            <td className="px-4 py-3 text-sm text-slate-500">
                                {account.currencyId}
                            </td>

                            <td className="px-4 py-3 text-right text-sm font-medium text-slate-800">
                                {formatCurrency(
                                    Number(account.openingBalance ?? 0),
                                    account.currencyId
                                )}
                            </td>

                            <td className="px-4 py-3 text-center">
                                <span
                                    className={
                                        account.isActive
                                            ? "inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                                            : "inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500"
                                    }
                                >
                                    {account.isActive ? "Active" : "Inactive"}
                                </span>
                            </td>

                            <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-1">
                                    <button
                                        type="button"
                                        onClick={() => onView(account)}
                                        title="View account"
                                        aria-label={`View ${account.name}`}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                                    >
                                        <Eye size={15} />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => onEdit(account)}
                                        title="Edit account"
                                        aria-label={`Edit ${account.name}`}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                                    >
                                        <Pencil size={15} />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => onDelete(account)}
                                        title="Delete account"
                                        aria-label={`Delete ${account.name}`}
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


