import { balanceSide } from "@/core/accounting/transferClassification";
import {
    signedTransactionAmount,
    useDateFormatter,
} from "@/core/formatting";
import { Eye, Landmark, Pencil, Trash2 } from "lucide-react";

import { isLoanLinkEligible } from "@/modules/loans/services/loanLinkEligibility";

import { Checkbox } from "@/components/ui/checkbox";

import { Transaction } from "../types";

interface TransactionTableProps {
    transactions: Transaction[];
    accounts: Map<string, string>;
    categories: Map<string, string>;
    selectedIds: Set<string>;
    allSelected: boolean;
    someSelected: boolean;
    onToggleRow: (id: string) => void;
    onToggleAll: () => void;
    onView: (transaction: Transaction) => void;
    onEdit: (transaction: Transaction) => void;
    onDelete: (transaction: Transaction) => void;
    /**
     * The Link to Loan EMI action on an outgoing transaction (shown only
     * when given) - for a transaction already linked it is called too, to
     * show what it is linked to.
     */
    onLinkToLoan?: (transaction: Transaction) => void;
    /** Ids of the transactions that are a loan EMI payment or an Overdraft movement. */
    loanLinkedIds?: ReadonlySet<string>;
    /**
     * Accounts an Overdraft is linked to - there money in (a drawdown) can
     * be linked too, and the action is the generic Link to Loan.
     */
    overdraftAccountIds?: ReadonlySet<string>;
    /**
     * Ids of the loan-link categories (see loans/services/
     * loanLinkEligibility.ts) - only a transaction in one of them can be
     * linked to a loan, whatever its account.
     */
    loanLinkCategoryIds?: ReadonlySet<string>;
}

/**
 * Whether the row shows the Landmark (Link to Loan) icon: always for a
 * transaction that is already linked (to see it, or unlink it); otherwise
 * only for one in a loan-link category that could be linked - an outgoing
 * EMI payment, or a movement on an Overdraft's account. The account alone
 * never makes a transaction eligible.
 */
export function showsLoanLinkIcon(
    transaction: Pick<Transaction, "id" | "type" | "accountId" | "categoryId" | "transferDirection">,
    sets: {
        loanLinkedIds?: ReadonlySet<string>;
        overdraftAccountIds?: ReadonlySet<string>;
        loanLinkCategoryIds?: ReadonlySet<string>;
    }
): boolean {
    if (sets.loanLinkedIds?.has(transaction.id)) {
        return true;
    }

    return (
        isLoanLinkEligible(transaction, sets.loanLinkCategoryIds ?? new Set()) &&
        // Money out (an Expense or a Transfer Out) can be an EMI payment.
        (balanceSide(transaction) === "expense" ||
            (sets.overdraftAccountIds?.has(transaction.accountId) ?? false))
    );
}

/**
 * The Link to Loan button for a linked / unlinked transaction. Same
 * button, same icon, same size and place - only the icon colour and the
 * tooltip say whether it is linked. One universal action for every loan
 * type (Link Transaction to Loan); `generic` is kept for its callers.
 */
export function loanLinkButtonState(
    linked: boolean,
    // On an Overdraft's account the action covers EMIs and OD movements.
    generic = false
): {
    title: string;
    className: string;
} {
    void generic;
    const target = "Loan";

    return {
        title: linked ? `Linked to ${target}` : `Link to ${target}`,
        className: linked
            ? "inline-flex h-8 w-8 items-center justify-center rounded-lg text-emerald-600 transition-colors hover:bg-slate-100 hover:text-emerald-700"
            : "inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800",
    };
}

function formatType(type: string): string {
    return type
        .toLowerCase()
        .replace("_", " ")
        .replace(/\b\w/g, char => char.toUpperCase());
}

const STATUS_LABELS: Record<Transaction["status"], string> = {
    PENDING: "Pending",
    CLEARED: "Cleared",
};

export function getStatusLabel(status: Transaction["status"]): string {
    return STATUS_LABELS[status] ?? status;
}

function statusBadgeClasses(status: Transaction["status"]): string {
    return status === "CLEARED"
        ? "inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
        : "inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700";
}


function formatAmount(amount: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
        signDisplay: "exceptZero",
    }).format(Number(amount ?? 0));
}

export function TransactionTable({
    transactions,
    accounts,
    categories,
    selectedIds,
    allSelected,
    someSelected,
    onToggleRow,
    onToggleAll,
    onView,
    onEdit,
    onDelete,
    onLinkToLoan,
    loanLinkedIds,
    overdraftAccountIds,
    loanLinkCategoryIds,
}: TransactionTableProps) {
    const formatDate = useDateFormatter();
    return (
        <div className="w-full">
            <table className="w-full table-fixed text-left">
                <colgroup>
                    <col className="w-[5%]" />
                    <col className="w-[8%]" />
                    <col className="w-[20%]" />
                    <col className="w-[12%]" />
                    <col className="w-[12%]" />
                    <col className="w-[8%]" />
                    <col className="w-[8%]" />
                    <col className="w-[12%]" />
                    <col className="w-[15%]" />
                </colgroup>

                <thead>
                    <tr className="border-b border-slate-100">
                        <th className="px-3 py-2.5">
                            <Checkbox
                                checked={allSelected}
                                indeterminate={someSelected}
                                onCheckedChange={() => onToggleAll()}
                                aria-label="Select all transactions"
                                className="border border-slate-400 bg-white"
                            />
                        </th>

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

                        <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                            Status
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
                            <td className="px-3 py-3">
                                <Checkbox
                                    checked={selectedIds.has(transaction.id)}
                                    onCheckedChange={() =>
                                        onToggleRow(transaction.id)
                                    }
                                    aria-label={`Select ${transaction.payee || "transaction"}`}
                                    className="border border-slate-400 bg-white"
                                />
                            </td>

                            <td className="px-4 py-3 text-sm whitespace-nowrap text-slate-600">
                                {formatDate(transaction.transactionDate)}
                            </td>

                            <td className="px-4 py-3 overflow-hidden">
                                <div
                                    className="truncate text-sm font-medium text-slate-800"
                                    title={transaction.payee || undefined}
                                >
                                    {transaction.payee || "—"}
                                </div>

                                {transaction.originalNarration && (
                                    <div
                                        className="mt-0.5 truncate text-[11px] text-slate-400"
                                        title={transaction.originalNarration}
                                    >
                                        {transaction.originalNarration}
                                    </div>
                                )}
                            </td>

                            <td className="px-4 py-3 overflow-hidden text-sm text-slate-600">
                                <div
                                    className="truncate"
                                    title={
                                        accounts.get(transaction.accountId) ||
                                        transaction.accountId
                                    }
                                >
                                    {accounts.get(transaction.accountId) ||
                                        transaction.accountId}
                                </div>
                            </td>

                            <td className="px-4 py-3 overflow-hidden text-sm text-slate-600">
                                <div
                                    className="truncate"
                                    title={
                                        transaction.categoryId
                                            ? categories.get(
                                                  transaction.categoryId
                                              ) || transaction.categoryId
                                            : "None"
                                    }
                                >
                                    {transaction.categoryId
                                        ? categories.get(
                                              transaction.categoryId
                                          ) || transaction.categoryId
                                        : "None"}
                                </div>
                            </td>

                            <td className="px-4 py-3 text-sm whitespace-nowrap text-slate-600">
                                {formatType(transaction.type)}
                                {transaction.type === "transfer" &&
                                    transaction.transferDirection && (
                                        <span className="text-slate-400">
                                            {transaction.transferDirection === "OUT"
                                                ? " · Out"
                                                : " · In"}
                                        </span>
                                    )}
                            </td>

                            <td className="px-4 py-3 whitespace-nowrap">
                                <span
                                    className={statusBadgeClasses(
                                        transaction.status
                                    )}
                                >
                                    {getStatusLabel(transaction.status)}
                                </span>
                            </td>

                            <td className="px-4 py-3 text-right text-sm font-medium whitespace-nowrap text-slate-800">
                                {formatAmount(
                                    // A transfer is signed by its
                                    // direction (Out -, In +).
                                    signedTransactionAmount(
                                        transaction.amount,
                                        balanceSide(transaction) ??
                                            transaction.type
                                    )
                                )}
                            </td>

                            <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                                    <button
                                        type="button"
                                        onClick={() => onView(transaction)}
                                        title="View transaction"
                                        aria-label={`View ${transaction.payee}`}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                                    >
                                        <Eye size={15} />
                                    </button>

                                    {onLinkToLoan &&
                                        showsLoanLinkIcon(transaction, {
                                            loanLinkedIds,
                                            overdraftAccountIds,
                                            loanLinkCategoryIds,
                                        }) && (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    onLinkToLoan(transaction)
                                                }
                                                title={
                                                    loanLinkButtonState(
                                                        loanLinkedIds?.has(
                                                            transaction.id
                                                        ) ?? false,
                                                        overdraftAccountIds?.has(
                                                            transaction.accountId
                                                        ) ?? false
                                                    ).title
                                                }
                                                aria-label={
                                                    loanLinkedIds?.has(
                                                        transaction.id
                                                    )
                                                        ? `${transaction.payee} is linked to a loan${overdraftAccountIds?.has(transaction.accountId) ? "" : " EMI"}`
                                                        : `Link ${transaction.payee} to a loan${overdraftAccountIds?.has(transaction.accountId) ? "" : " EMI"}`
                                                }
                                                className={
                                                    loanLinkButtonState(
                                                        loanLinkedIds?.has(
                                                            transaction.id
                                                        ) ?? false
                                                    ).className
                                                }
                                            >
                                                <Landmark size={15} />
                                            </button>
                                        )}

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


