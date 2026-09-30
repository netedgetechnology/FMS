import { useMoneyFormatter } from "@/core/formatting";
import { Eye, Pencil, Trash2 } from "lucide-react";

import { Account } from "../types";

interface AccountTableProps {
    accounts: Account[];
    /**
     * Each account's current balance (opening balance + every
     * income/expense transaction posted against it since - see
     * modules/accounts/utils/accountBalance.ts), keyed by account id.
     * Optional and falls back to the account's raw, un-recalculated
     * openingBalance so this table still renders something sensible
     * before the caller's transactions have finished loading.
     */
    balances?: ReadonlyMap<string, number>;
    onView: (account: Account) => void;
    onEdit: (account: Account) => void;
    onDelete: (account: Account) => void;
    /**
     * True for a LOAN-type account Delete Loan preserved because it
     * still had a live transaction on it - see
     * services/unlinkedLoanAccount.ts. Optional so callers that never
     * pass it (none exist today besides AccountsPage) keep every
     * account showing its ordinary Active/Inactive status.
     */
    isUnlinkedLoanAccount?: (account: Account) => boolean;
}

function formatType(type: string): string {
    return type
        .toLowerCase()
        .replace("_", " ")
        .replace(/\b\w/g, char => char.toUpperCase());
}



export function AccountTable({
    accounts,
    balances,
    onView,
    onEdit,
    onDelete,
    isUnlinkedLoanAccount,
}: AccountTableProps) {
    const formatMoney = useMoneyFormatter();
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
                            Current Balance
                        </th>

                        <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Status
                        </th>

                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            {/* Width matches the row action group (3 × w-8 buttons + 2 × gap-1)
                               so the centered label sits directly above the middle Edit button. */}
                            <span className="ml-auto block w-[104px] text-center">
                                Actions
                            </span>
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
                                {account.type === "CASH" || account.type === "WALLET"
                                    ? "—"
                                    : account.institutionName || "—"}
                            </td>

                            <td className="px-4 py-3 text-sm text-slate-500">
                                {account.currencyId}
                            </td>

                            <td className="px-4 py-3 text-right text-sm font-medium text-slate-800">
                                {account.type === "INVESTMENT"
                                    ? "—"
                                    : formatMoney(
                                          balances?.get(account.id) ??
                                              Number(account.openingBalance ?? 0),
                                          account.currencyId
                                      )}
                            </td>

                            <td className="px-4 py-3 text-center">
                                {isUnlinkedLoanAccount?.(
                                    account
                                ) ? (
                                    <span
                                        title="The loan this account belonged to was deleted. This account was kept because it still has transactions on it - manage or delete it here directly."
                                        className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700"
                                    >
                                        Unlinked Loan Account
                                    </span>
                                ) : (
                                    <span
                                        className={
                                            account.isActive
                                                ? "inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                                                : "inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500"
                                        }
                                    >
                                        {account.isActive ? "Active" : "Inactive"}
                                    </span>
                                )}
                            </td>

                            <td className="px-4 py-3">
                                <div className="ml-auto flex w-[104px] items-center justify-end gap-1">
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




