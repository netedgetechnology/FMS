import {
    signedTransactionAmount,
    useMoneyFormatter,
} from "@/core/formatting";
import { useEffect, useMemo, useState } from "react";
import { Calendar, Plus, Search, Trash2 } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/common";

import {
    Popover,
    PopoverContent,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from "@/components/ui/popover";

import { useAccounts } from "@/modules/accounts/hooks";
import { useCategories } from "@/modules/categories/hooks";

import {
    AddTransactionDialog,
    BulkDeleteTransactionsDialog,
    DeleteTransactionDialog,
    EditTransactionDialog,
    TransactionTable,
    ViewTransactionDialog,
} from "../components";

import { useTransactions } from "../hooks";
import type { Transaction } from "../types";

const ROWS_PER_PAGE_OPTIONS: Array<number | "All"> = [
    10,
    50,
    100,
    250,
    500,
    1000,
    "All",
];

const DEFAULT_ROWS_PER_PAGE: number | "All" = 50;

// Windowed page numbers (1 … current-1, current, current+1 … total) so the
// pager stays usable even with hundreds of pages.
function getPageNumbers(
    current: number,
    total: number
): Array<number | "..."> {
    if (total <= 7) {
        return Array.from(
            { length: total },
            (_, index) => index + 1
        );
    }

    const pages: Array<number | "..."> = [1];

    if (current > 3) {
        pages.push("...");
    }

    for (
        let page = Math.max(2, current - 1);
        page <= Math.min(total - 1, current + 1);
        page++
    ) {
        pages.push(page);
    }

    if (current < total - 2) {
        pages.push("...");
    }

    pages.push(total);

    return pages;
}

// Same currency formatting + forced sign as the Transactions list
// (TransactionTable) - used for the Total Debit/Total Credit figures below,
// which must always show their sign regardless of magnitude.
function formatSignedAmount(amount: number): string {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
        signDisplay: "exceptZero",
    }).format(Number(amount ?? 0));
}

export const ALL_MAPPING_NAMES = "All";

// Every Mapping Name (see ImportsPage's "Mapping Name" field) actually in
// use by an imported transaction - reuses the existing `sourceStatement`
// column (see ImportService.executeCandidates) rather than a new
// field/table. Manually added transactions leave sourceStatement null
// (AddTransactionDialog never sets it), so they never contribute a bogus
// option here.
export function computeAvailableMappingNames(
    transactions: Transaction[]
): string[] {
    const names = new Set<string>();

    transactions.forEach(transaction => {
        if (transaction.sourceStatement) {
            names.add(transaction.sourceStatement);
        }
    });

    return Array.from(names).sort((a, b) =>
        a.localeCompare(b)
    );
}

export interface DateRangeFilter {
    start: string;
    end: string;
}

export interface TransactionListFilter {
    search: string;
    mappingName: string;
    dateRange?: DateRangeFilter | null;
}

// Combines the Mapping Name filter, the applied date range, and the
// existing free-text search - all three apply together (AND). "All"
// applies no mapping restriction (see ALL_MAPPING_NAMES), and no applied
// date range (null/undefined) applies no date restriction at all -
// matching the pre-existing, unfiltered behavior.
export function filterTransactionsForList(
    transactions: Transaction[],
    filter: TransactionListFilter,
    accountMap: Map<string, string>,
    categoryMap: Map<string, string>
): Transaction[] {
    const query = filter.search.trim().toLowerCase();

    return transactions.filter(transaction => {
        if (
            filter.mappingName !== ALL_MAPPING_NAMES &&
            transaction.sourceStatement !== filter.mappingName
        ) {
            return false;
        }

        if (
            filter.dateRange &&
            (transaction.transactionDate <
                filter.dateRange.start ||
                transaction.transactionDate >
                    filter.dateRange.end)
        ) {
            return false;
        }

        if (!query) {
            return true;
        }

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
}

export interface FilteredTransactionTotals {
    totalDebit: number;
    totalCredit: number;
    balance: number;
}

// Totals for the current Mapping Name + search result (pass the already-
// filtered list) - never just the current page. Mirrors the existing
// totalIncome/totalExpense convention: transfers contribute to neither.
export function computeFilteredTotals(
    transactions: Transaction[]
): FilteredTransactionTotals {
    const totalDebit = transactions
        .filter(
            transaction => transaction.type === "expense"
        )
        .reduce(
            (total, transaction) =>
                total + Number(transaction.amount || 0),
            0
        );

    const totalCredit = transactions
        .filter(
            transaction => transaction.type === "income"
        )
        .reduce(
            (total, transaction) =>
                total + Number(transaction.amount || 0),
            0
        );

    return {
        totalDebit,
        totalCredit,
        balance: totalCredit - totalDebit,
    };
}

// Slices an already-filtered list to one page - "All" returns everything.
export function paginateTransactions(
    transactions: Transaction[],
    page: number,
    rowsPerPage: number | "All"
): Transaction[] {
    if (rowsPerPage === "All") {
        return transactions;
    }

    const startIndex = (page - 1) * rowsPerPage;

    return transactions.slice(
        startIndex,
        startIndex + rowsPerPage
    );
}

export default function TransactionsPage() {
    const formatAmount = useMoneyFormatter();
    const {
        transactions,
        loading,
        error,
        refresh,
    } = useTransactions();

    const { accounts } = useAccounts();
    const { categories } = useCategories();

    const [search, setSearch] = useState("");
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    const [mappingNameFilter, setMappingNameFilter] =
        useState<string>(ALL_MAPPING_NAMES);

    // The committed/applied date range filter (null = no range applied,
    // i.e. existing unfiltered-by-date behavior). draftStartDate/
    // draftEndDate hold the popover's in-progress edits, which only
    // become the applied range once "Apply" is clicked.
    const [appliedDateRange, setAppliedDateRange] =
        useState<DateRangeFilter | null>(null);

    const [isDateRangeOpen, setIsDateRangeOpen] = useState(false);
    const [draftStartDate, setDraftStartDate] = useState("");
    const [draftEndDate, setDraftEndDate] = useState("");

    // Opening the popover seeds the draft from whatever is currently
    // applied; closing it any other way than "Apply" (Cancel, outside
    // click, Escape) resets the draft back to that same applied range -
    // discarding any uncommitted edits either way.
    function handleDateRangeOpenChange(open: boolean) {
        setDraftStartDate(appliedDateRange?.start ?? "");
        setDraftEndDate(appliedDateRange?.end ?? "");
        setIsDateRangeOpen(open);
    }

    function handleApplyDateRange() {
        if (!draftStartDate || !draftEndDate) {
            return;
        }

        setAppliedDateRange({
            start: draftStartDate,
            end: draftEndDate,
        });
        setIsDateRangeOpen(false);
    }

    function handleClearDateRange() {
        setAppliedDateRange(null);
        setDraftStartDate("");
        setDraftEndDate("");
        setIsDateRangeOpen(false);
    }

    const [selectedIds, setSelectedIds] = useState<Set<string>>(
        new Set()
    );

    const [rowsPerPage, setRowsPerPage] =
        useState<number | "All">(DEFAULT_ROWS_PER_PAGE);

    const [currentPage, setCurrentPage] = useState(1);

    const [viewingTransaction, setViewingTransaction] =
        useState<import("../types").Transaction | null>(null);

    const [editingTransaction, setEditingTransaction] =
        useState<import("../types").Transaction | null>(null);

    const [deletingTransaction, setDeletingTransaction] =
        useState<import("../types").Transaction | null>(null);

    const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);

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

    const availableMappingNames = useMemo(
        () => computeAvailableMappingNames(transactions),
        [transactions]
    );

    // A previously-selected Mapping Name that no longer has any matching
    // transactions (e.g. its only import was deleted) falls back to "All"
    // rather than silently filtering to zero rows forever.
    useEffect(() => {
        if (
            mappingNameFilter !== ALL_MAPPING_NAMES &&
            !availableMappingNames.includes(mappingNameFilter)
        ) {
            setMappingNameFilter(ALL_MAPPING_NAMES);
        }
    }, [availableMappingNames, mappingNameFilter]);

    const filteredTransactions = useMemo(
        () =>
            filterTransactionsForList(
                transactions,
                {
                    search,
                    mappingName: mappingNameFilter,
                    dateRange: appliedDateRange,
                },
                accountMap,
                categoryMap
            ),
        [
            transactions,
            search,
            mappingNameFilter,
            appliedDateRange,
            accountMap,
            categoryMap,
        ]
    );

    // Any change to search/filters invalidates the current page position.
    useEffect(() => {
        setCurrentPage(1);
    }, [search, rowsPerPage, mappingNameFilter, appliedDateRange]);

    const totalCount = filteredTransactions.length;

    const totalPages =
        rowsPerPage === "All"
            ? 1
            : Math.max(1, Math.ceil(totalCount / rowsPerPage));

    const safePage = Math.min(currentPage, totalPages);

    const startIndex =
        rowsPerPage === "All" ? 0 : (safePage - 1) * rowsPerPage;

    const paginatedTransactions = paginateTransactions(
        filteredTransactions,
        safePage,
        rowsPerPage
    );

    const firstEntry = totalCount === 0 ? 0 : startIndex + 1;

    const lastEntry =
        rowsPerPage === "All"
            ? totalCount
            : Math.min(startIndex + rowsPerPage, totalCount);

    const allSelected =
        paginatedTransactions.length > 0 &&
        paginatedTransactions.every(transaction =>
            selectedIds.has(transaction.id)
        );

    const someSelected =
        !allSelected &&
        paginatedTransactions.some(transaction =>
            selectedIds.has(transaction.id)
        );

    function toggleRowSelected(id: string) {
        setSelectedIds(previous => {
            const next = new Set(previous);

            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }

            return next;
        });
    }

    function toggleAllSelected() {
        setSelectedIds(previous => {
            const next = new Set(previous);

            if (allSelected) {
                paginatedTransactions.forEach(transaction =>
                    next.delete(transaction.id)
                );
            } else {
                paginatedTransactions.forEach(transaction =>
                    next.add(transaction.id)
                );
            }

            return next;
        });
    }

    const hasResults =
        !loading && !error && filteredTransactions.length > 0;

    const showPaginationControls =
        hasResults && rowsPerPage !== "All" && totalPages > 1;

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

    // Totals for the current Mapping Name + search result (not just the
    // current page - filteredTransactions already combines both).
    const filteredTotals = useMemo(
        () => computeFilteredTotals(filteredTransactions),
        [filteredTransactions]
    );

    const {
        totalDebit: filteredTotalDebit,
        totalCredit: filteredTotalCredit,
        balance: filteredBalance,
    } = filteredTotals;

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
                    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2.5">
                                <h2 className="text-[22px] font-bold text-slate-900">
                                    Transactions
                                </h2>

                                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                                    {totalCount.toLocaleString()}
                                </span>
                            </div>

                            <p className="mt-1 text-[15px] text-slate-500">
                                All financial transactions in one place.
                            </p>
                        </div>

                        <div className="flex flex-wrap items-start justify-end gap-3">
                            {isSearchOpen && (
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
                                        autoFocus
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
                            )}

                            <button
                                type="button"
                                onClick={() =>
                                    setIsSearchOpen(open => !open)
                                }
                                aria-label="Search transactions"
                                aria-expanded={isSearchOpen}
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition-all duration-200 hover:border-slate-300 hover:bg-white hover:text-slate-700"
                            >
                                <Search size={18} />
                            </button>

                            {showPaginationControls && (
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        disabled={safePage === 1}
                                        onClick={() =>
                                            setCurrentPage(
                                                Math.max(1, safePage - 1)
                                            )
                                        }
                                        className="flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        ‹
                                    </button>

                                    {getPageNumbers(
                                        safePage,
                                        totalPages
                                    ).map((page, index) =>
                                        page === "..." ? (
                                            <span
                                                key={`ellipsis-${index}`}
                                                className="flex h-8 min-w-8 items-center justify-center text-sm text-slate-400"
                                            >
                                                …
                                            </span>
                                        ) : (
                                            <button
                                                key={page}
                                                type="button"
                                                onClick={() =>
                                                    setCurrentPage(page)
                                                }
                                                className={`flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm font-medium transition ${
                                                    page === safePage
                                                        ? "border-slate-900 bg-slate-900 text-white"
                                                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                                }`}
                                            >
                                                {page}
                                            </button>
                                        )
                                    )}

                                    <button
                                        type="button"
                                        disabled={safePage === totalPages}
                                        onClick={() =>
                                            setCurrentPage(
                                                Math.min(
                                                    totalPages,
                                                    safePage + 1
                                                )
                                            )
                                        }
                                        className="flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        ›
                                    </button>
                                </div>
                            )}

                            {hasResults && (
                                <div className="flex flex-col items-end gap-1">
                                    <label
                                        htmlFor="transactions-rows-per-page"
                                        className="flex items-center gap-2 text-xs text-slate-500"
                                    >
                                        Rows per page

                                        <select
                                            id="transactions-rows-per-page"
                                            value={String(rowsPerPage)}
                                            onChange={event => {
                                                const value =
                                                    event.target.value;

                                                setRowsPerPage(
                                                    value === "All"
                                                        ? "All"
                                                        : Number(value)
                                                );
                                            }}
                                            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none transition focus:border-slate-400"
                                        >
                                            {ROWS_PER_PAGE_OPTIONS.map(
                                                option => (
                                                    <option
                                                        key={option}
                                                        value={String(
                                                            option
                                                        )}
                                                    >
                                                        {option}
                                                    </option>
                                                )
                                            )}
                                        </select>
                                    </label>

                                    <span className="text-xs text-slate-500">
                                        Showing {firstEntry}–{lastEntry} of{" "}
                                        {totalCount.toLocaleString()}
                                    </span>
                                </div>
                            )}
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
                        transactions.length > 0 && (
                            <div className="mb-4 flex flex-wrap items-stretch justify-between gap-3">
                                <div className="flex flex-wrap items-stretch gap-3">
                                {hasResults && (
                                    // Horizontally aligned with the checkbox column below:
                                    // same px-3 the table uses for its checkbox <th>/<td>
                                    // cells, plus the same 1px border the table's own
                                    // wrapper carries, so this box's icon lines up exactly
                                    // over the checkboxes instead of sitting ~8px right of
                                    // them.
                                    <button
                                        type="button"
                                        disabled={selectedIds.size === 0}
                                        onClick={() => setIsBulkDeleteOpen(true)}
                                        title={
                                            selectedIds.size === 0
                                                ? "Select transactions to delete"
                                                : `Delete ${selectedIds.size} selected transaction${
                                                      selectedIds.size === 1 ? "" : "s"
                                                  }`
                                        }
                                        aria-label="Delete selected transactions"
                                        className="inline-flex items-center justify-center rounded-xl border border-slate-100 bg-white px-3 py-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white disabled:hover:text-slate-300"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                )}

                                {appliedDateRange && (
                                    <>
                                        <div className="flex flex-col justify-center gap-1 rounded-xl border border-slate-100 bg-white px-4 py-2">
                                            <span className="text-[11px] font-medium text-slate-500">
                                                Total Debit
                                            </span>

                                            <span className="text-sm font-semibold text-red-600">
                                                {formatSignedAmount(
                                                    signedTransactionAmount(
                                                        filteredTotalDebit,
                                                        "expense"
                                                    )
                                                )}
                                            </span>
                                        </div>

                                        <div className="flex flex-col justify-center gap-1 rounded-xl border border-slate-100 bg-white px-4 py-2">
                                            <span className="text-[11px] font-medium text-slate-500">
                                                Total Credit
                                            </span>

                                            <span className="text-sm font-semibold text-emerald-600">
                                                {formatSignedAmount(
                                                    signedTransactionAmount(
                                                        filteredTotalCredit,
                                                        "income"
                                                    )
                                                )}
                                            </span>
                                        </div>

                                        <div className="flex flex-col justify-center gap-1 rounded-xl border border-slate-100 bg-white px-4 py-2">
                                            <span className="text-[11px] font-medium text-slate-500">
                                                Balance
                                            </span>

                                            <span className="text-sm font-semibold text-slate-900">
                                                {formatAmount(filteredBalance)}
                                            </span>
                                        </div>
                                    </>
                                )}
                                </div>

                                <div className="flex items-stretch gap-3">
                                <Popover
                                    open={isDateRangeOpen}
                                    onOpenChange={
                                        handleDateRangeOpenChange
                                    }
                                >
                                    <PopoverTrigger
                                        aria-label="Filter transactions by date range"
                                        title="Filter by date range"
                                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-colors ${
                                            appliedDateRange
                                                ? "border-slate-900 bg-slate-900 text-white"
                                                : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-700"
                                        }`}
                                    >
                                        <Calendar size={18} />
                                    </PopoverTrigger>

                                    <PopoverContent
                                        align="end"
                                        className="w-[320px] border border-slate-200 bg-white shadow-lg"
                                    >
                                        <PopoverHeader>
                                            <PopoverTitle>
                                                Select Date Range
                                            </PopoverTitle>
                                        </PopoverHeader>

                                        <div className="flex items-start gap-2">
                                            <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
                                                Start Date

                                                <input
                                                    type="date"
                                                    value={draftStartDate}
                                                    onChange={event =>
                                                        setDraftStartDate(
                                                            event.target
                                                                .value
                                                        )
                                                    }
                                                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                                                />
                                            </label>

                                            <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
                                                End Date

                                                <input
                                                    type="date"
                                                    value={draftEndDate}
                                                    onChange={event =>
                                                        setDraftEndDate(
                                                            event.target
                                                                .value
                                                        )
                                                    }
                                                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                                                />
                                            </label>
                                        </div>

                                        <div className="flex items-center justify-between gap-2 pt-1">
                                            <button
                                                type="button"
                                                onClick={
                                                    handleClearDateRange
                                                }
                                                className="text-xs font-medium text-slate-500 transition-colors hover:text-slate-700"
                                            >
                                                Clear
                                            </button>

                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handleDateRangeOpenChange(
                                                            false
                                                        )
                                                    }
                                                    className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                                                >
                                                    Cancel
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={
                                                        handleApplyDateRange
                                                    }
                                                    disabled={
                                                        !draftStartDate ||
                                                        !draftEndDate
                                                    }
                                                    className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                    Apply
                                                </button>
                                            </div>
                                        </div>
                                    </PopoverContent>
                                </Popover>

                                <label className="flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 shadow-sm">
                                    Mapping Name

                                    <select
                                        value={mappingNameFilter}
                                        onChange={event =>
                                            setMappingNameFilter(
                                                event.target.value
                                            )
                                        }
                                        aria-label="Filter transactions by Mapping Name"
                                        className="h-full rounded-lg border-none bg-transparent text-sm font-medium text-slate-800 outline-none"
                                    >
                                        <option value={ALL_MAPPING_NAMES}>
                                            All
                                        </option>

                                        {availableMappingNames.map(name => (
                                            <option key={name} value={name}>
                                                {name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                </div>
                            </div>
                        )}

                    {hasResults && (
                        <div className="overflow-hidden rounded-2xl border border-slate-100 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-slate-50">
                            <TransactionTable
                                transactions={paginatedTransactions}
                                accounts={accountMap}
                                categories={categoryMap}
                                selectedIds={selectedIds}
                                allSelected={allSelected}
                                someSelected={someSelected}
                                onToggleRow={toggleRowSelected}
                                onToggleAll={toggleAllSelected}
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

                <BulkDeleteTransactionsDialog
                    transactionIds={Array.from(selectedIds)}
                    open={isBulkDeleteOpen}
                    onOpenChange={setIsBulkDeleteOpen}
                    onSuccess={async () => {
                        setSelectedIds(new Set());
                        await refresh();
                    }}
                />

            </div>
        </div>
    );
}



















