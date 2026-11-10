import { useDateFormatter } from "@/core/formatting";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, List, Pencil, RefreshCw, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/common";

import {
    AddLoanDialog,
    DeleteLoanDialog,
    EditLoanDialog,
    EMIScheduleDialog,
    ViewLoanDialog,
} from "../components";
import {
    LoanDashboardService,
    LoanService,
} from "../services";
import {
    InitialLoadTracker,
    reportBackgroundRefreshFailure,
} from "@/core/async/InitialLoadTracker";
import { LatestRequestGuard } from "@/core/async/LatestRequestGuard";
import { AccountService } from "@/modules/accounts/services";

import { OverdraftService } from "../services/OverdraftService";
import type { OverdraftPosition } from "../services/overdraftPosition";
import { Loan, isOverdraft } from "../types";
import {
    OVERDRAFT_COLUMNS,
    TERM_LOAN_COLUMNS,
    buildOverdraftRow,
    loanRowActions,
    splitLoansBySection,
    type OverdraftRowModel,
} from "./loansPageSections";

export default function LoansPage() {
    const formatDate = useDateFormatter();
    const [loans, setLoans] = useState<Loan[]>([]);
    const [loading, setLoading] = useState(true);
    const [scheduleLoan, setScheduleLoan] = useState<Loan | null>(null);
    const [viewLoan, setViewLoan] = useState<Loan | null>(null);
    const [editLoan, setEditLoan] = useState<Loan | null>(null);
    // Each Overdraft's position, derived fresh on every load.
    const [overdraftPositions, setOverdraftPositions] = useState<
        ReadonlyMap<string, OverdraftPosition>
    >(new Map());
    // Account id -> name, for an Overdraft's Linked Accounts.
    const [accountNames, setAccountNames] = useState<
        ReadonlyMap<string, string>
    >(new Map());
    const [dashboardSummary, setDashboardSummary] =
        useState<{
            totalOutstandingInterest: number;
            totalRemainingEmi: number;
            overdueCount: number;
            overdueAmount: number;
            nextEmi: {
                dueDate: string;
                totalAmount: number;
            } | null;
        } | null>(null);

    // Only the first load replaces the tables with "Loading..."; a refresh
    // after add / edit / delete keeps them on screen (InitialLoadTracker)
    // and only spins the refresh icon. A stale load never wins.
    const [refreshing, setRefreshing] = useState(false);
    const loadTracker = useRef(new InitialLoadTracker());
    const requestGuard = useRef(new LatestRequestGuard());

    const loadLoans = useCallback(async () => {
        const requestId = requestGuard.current.start();

        try {
            if (loadTracker.current.showsLoading()) {
                setLoading(true);
            }
            setRefreshing(true);

            const service = new LoanService();
            const result = await service.getAll();

            const overdraftService = new OverdraftService();
            const positions = new Map<string, OverdraftPosition>();

            for (const loan of result.filter(isOverdraft)) {
                positions.set(loan.id, await overdraftService.getPosition(loan));
            }

            let names: ReadonlyMap<string, string> | null = null;

            if (positions.size > 0) {
                try {
                    const accounts = await new AccountService().getAll();

                    names = new Map(accounts.map(account => [account.id, account.name]));
                } catch (error) {
                    // The OD rows still show; unresolved accounts show their id.
                    console.error("Failed to load overdraft accounts:", error);
                }
            }

            const dashboardService =
                new LoanDashboardService();

            const dashboardResult =
                await dashboardService.getSummary(result);

            if (requestGuard.current.isStale(requestId)) {
                return;
            }

            // All together, so rows, OD positions and the summary cards
            // never disagree for a moment.
            setLoans(result);
            setOverdraftPositions(positions);
            if (names) {
                setAccountNames(names);
            }
            setDashboardSummary(dashboardResult);
            loadTracker.current.markLoaded();
        } catch (error) {
            if (requestGuard.current.isStale(requestId)) {
                return;
            }

            if (loadTracker.current.hasLoaded) {
                reportBackgroundRefreshFailure("loans", error);
            } else {
                console.error("Failed to load loans:", error);
            }
        } finally {
            if (!requestGuard.current.isStale(requestId)) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, []);

    useEffect(() => {
        void loadLoans();
    }, [loadLoans]);

    const summary = useMemo(() => {
        const activeLoans = loans.filter(
            loan => loan.status === "ACTIVE"
        );

        return {
            totalLoans: loans.length,
            activeLoans: activeLoans.length,
            principal: loans.reduce(
                (total, loan) => total + loan.principalAmount,
                0
            ),
            outstanding: loans.reduce(
                (total, loan) =>
                    total + loan.outstandingPrincipal,
                0
            ),
        };
    }, [loans]);

    const { termLoans, overdrafts } = useMemo(
        () => splitLoansBySection(loans),
        [loans]
    );

    return (
        <div className="min-h-full bg-slate-50">
            <div className="w-full space-y-6">
                <PageHeader
                    title="Loans"
                    subtitle="Manage your loans, EMI schedules and outstanding balances."
                    actions={
                        <AddLoanDialog onSuccess={loadLoans} />
                    }
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <SummaryCard
                        label="Total Loans"
                        value={summary.totalLoans.toString()}
                    />

                    <SummaryCard
                        label="Active Loans"
                        value={summary.activeLoans.toString()}
                    />

                    <SummaryCard
                        label="Total Principal"
                        value={formatAmount(summary.principal)}
                    />

                    <SummaryCard
                        label="Outstanding Principal"
                        value={formatAmount(summary.outstanding)}
                    />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <SummaryCard
                        label="Outstanding Interest"
                        value={formatAmount(
                            dashboardSummary?.totalOutstandingInterest ?? 0
                        )}
                    />

                    <SummaryCard
                        label="Remaining EMI"
                        value={formatAmount(
                            dashboardSummary?.totalRemainingEmi ?? 0
                        )}
                    />

                    <SummaryCard
                        label="Overdue EMI"
                        value={
                            dashboardSummary
                                ? `${dashboardSummary.overdueCount} • ${formatAmount(
                                      dashboardSummary.overdueAmount
                                  )}`
                                : "0 • 0.00"
                        }
                    />

                    <SummaryCard
                        label="Next EMI"
                        value={
                            dashboardSummary?.nextEmi
                                ? `${formatAmount(
                                      dashboardSummary.nextEmi.totalAmount
                                  )} • ${formatDate(
                                      dashboardSummary.nextEmi.dueDate
                                  )}`
                                : "—"
                        }
                    />
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                        <div>
                            <h2 className="text-sm font-semibold text-slate-900">
                                Term Loans
                            </h2>

                            <p className="mt-0.5 text-xs text-slate-500">
                                Your active and historical loans
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() => void loadLoans()}
                            disabled={refreshing}
                            title="Refresh loans"
                            aria-label="Refresh loans"
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <RefreshCw
                                className={`h-3.5 w-3.5 ${
                                    refreshing ? "animate-spin" : ""
                                }`}
                            />
                        </button>
                    </div>

                    {loading ? (
                        <div className="px-6 py-12 text-center text-sm text-slate-500">
                            Loading loans...
                        </div>
                    ) : termLoans.length === 0 ? (
                        <div className="px-6 py-14 text-center">
                            <div className="text-sm font-medium text-slate-900">
                                No term loans yet
                            </div>

                            <p className="mt-1 text-sm text-slate-500">
                                Add your first loan to start tracking
                                principal, EMI and outstanding balance.
                            </p>

                            <div className="mt-5">
                                <AddLoanDialog
                                    onSuccess={loadLoans}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[900px]">
                                <thead>
                                    <tr className="border-b border-slate-100 bg-slate-50/70">
                                        {TERM_LOAN_COLUMNS.map((column, index) => (
                                            <th
                                                key={column}
                                                className={`${
                                                    index === 0 ? "px-6" : "px-4"
                                                } py-3 text-xs font-semibold text-slate-500 ${
                                                    TERM_LOAN_RIGHT_ALIGNED.has(column)
                                                        ? "text-right"
                                                        : "text-left"
                                                }`}
                                            >
                                                {column}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>

                                <tbody>
                                    {termLoans.map(loan => (
                                        <tr
                                            key={loan.id}
                                            className="border-b border-slate-100 last:border-b-0"
                                        >
                                            <LoanNameCell
                                                loan={loan}
                                                formatDate={formatDate}
                                            />

                                            <td className="px-4 py-4 text-sm text-slate-700">
                                                {loan.loanType}
                                            </td>

                                            <td className="px-4 py-4 text-right text-sm font-medium text-slate-900">
                                                {formatAmount(
                                                    loan.principalAmount
                                                )}
                                            </td>

                                            <td className="px-4 py-4 text-right text-sm font-medium text-slate-900">
                                                {formatAmount(
                                                    loan.outstandingPrincipal
                                                )}
                                            </td>

                                            <td className="px-4 py-4 text-right text-sm text-slate-700">
                                                {loan.interestRate.toFixed(2)}%
                                            </td>

                                            <td className="px-4 py-4 text-right text-sm text-slate-700">
                                                {loan.emiAmount == null
                                                    ? "—"
                                                    : formatAmount(
                                                          loan.emiAmount
                                                      )}
                                            </td>

                                            <td className="px-4 py-4">
                                                <StatusBadge
                                                    status={loan.status}
                                                />
                                            </td>

                                            <LoanActionsCell
                                                loan={loan}
                                                onView={setViewLoan}
                                                onEdit={setEditLoan}
                                                onSchedule={setScheduleLoan}
                                                onDeleted={loadLoans}
                                            />
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-100 px-6 py-4">
                        <h2 className="text-sm font-semibold text-slate-900">
                            Over Draft
                        </h2>

                        <p className="mt-0.5 text-xs text-slate-500">
                            Revolving overdraft limits and how much is used
                        </p>
                    </div>

                    {loading ? (
                        <div className="px-6 py-12 text-center text-sm text-slate-500">
                            Loading overdrafts...
                        </div>
                    ) : overdrafts.length === 0 ? (
                        <div className="px-6 py-14 text-center">
                            <div className="text-sm font-medium text-slate-900">
                                No overdrafts yet
                            </div>

                            <p className="mt-1 text-sm text-slate-500">
                                Add a loan with Loan Type Overdraft to track
                                its limit, used and available amounts.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[900px]">
                                <thead>
                                    <tr className="border-b border-slate-100 bg-slate-50/70">
                                        {OVERDRAFT_COLUMNS.map((column, index) => (
                                            <th
                                                key={column}
                                                className={`${
                                                    index === 0 ? "px-6" : "px-4"
                                                } py-3 text-xs font-semibold text-slate-500 ${
                                                    OVERDRAFT_RIGHT_ALIGNED.has(column)
                                                        ? "text-right"
                                                        : "text-left"
                                                }`}
                                            >
                                                {column}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>

                                <tbody>
                                    {overdrafts.map(loan => (
                                        <OverdraftRow
                                            key={loan.id}
                                            loan={loan}
                                            row={buildOverdraftRow(
                                                loan,
                                                overdraftPositions.get(loan.id) ?? null,
                                                accountNames
                                            )}
                                            formatDate={formatDate}
                                            onView={setViewLoan}
                                            onEdit={setEditLoan}
                                            onDeleted={loadLoans}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <ViewLoanDialog
                    loan={viewLoan}
                    open={viewLoan !== null}
                    onOpenChange={open => {
                        if (!open) {
                            setViewLoan(null);
                        }
                    }}
                />

                <EditLoanDialog
                    loan={editLoan}
                    open={editLoan !== null}
                    onSuccess={loadLoans}
                    onOpenChange={open => {
                        if (!open) {
                            setEditLoan(null);
                        }
                    }}
                />

                <EMIScheduleDialog
                    loan={scheduleLoan}
                    open={scheduleLoan !== null}
                    onSuccess={loadLoans}
                    onOpenChange={open => {
                        if (!open) {
                            setScheduleLoan(null);
                        }
                    }}
                />
            </div>
        </div>
    );
}

function SummaryCard({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="text-xs font-medium text-slate-500">
                {label}
            </div>

            <div className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
                {value}
            </div>
        </div>
    );
}

function StatusBadge({
    status,
}: {
    status: Loan["status"];
}) {
    const label = status
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, character => character.toUpperCase());

    return (
        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
            {label}
        </span>
    );
}

const TERM_LOAN_RIGHT_ALIGNED = new Set<string>([
    "Principal",
    "Outstanding",
    "Interest",
    "EMI",
    "Actions",
]);

const OVERDRAFT_RIGHT_ALIGNED = new Set<string>([
    "OD Limit",
    "Used",
    "Available",
    "Interest Rate",
    "Actions",
]);

function LoanNameCell({
    loan,
    formatDate,
}: {
    loan: Loan;
    formatDate: (value: string) => string;
}) {
    return (
        <td className="px-6 py-4">
            <div className="text-sm font-semibold text-slate-900">
                {loan.name}
            </div>

            <div className="mt-0.5 text-xs text-slate-500">
                Started {formatDate(loan.startDate)}
            </div>
        </td>
    );
}

/** View, Edit, EMI Schedule (Term Loans only) and Delete. */
function LoanActionsCell({
    loan,
    onView,
    onEdit,
    onSchedule,
    onDeleted,
}: {
    loan: Loan;
    onView: (loan: Loan) => void;
    onEdit: (loan: Loan) => void;
    onSchedule?: (loan: Loan) => void;
    onDeleted: () => void | Promise<void>;
}) {
    const actions = loanRowActions(loan);

    return (
        <td className="px-4 py-4 text-right">
            <div className="flex items-center justify-end gap-1">
                <button
                    type="button"
                    onClick={() => onView(loan)}
                    title="View loan"
                    aria-label={`View ${loan.name}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                >
                    <Eye size={15} />
                </button>

                <button
                    type="button"
                    onClick={() => onEdit(loan)}
                    title="Edit loan"
                    aria-label={`Edit ${loan.name}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                >
                    <Pencil size={15} />
                </button>

                {actions.includes("EMI_SCHEDULE") && onSchedule && (
                    <button
                        type="button"
                        onClick={() => onSchedule(loan)}
                        title="View EMI schedule"
                        aria-label={`View EMI schedule for ${loan.name}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                    >
                        <List size={15} />
                    </button>
                )}

                <DeleteLoanDialog
                    loan={loan}
                    onSuccess={onDeleted}
                    trigger={
                        <button
                            type="button"
                            title="Delete loan"
                            aria-label={`Delete ${loan.name}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        >
                            <Trash2 size={15} />
                        </button>
                    }
                />
            </div>
        </td>
    );
}

/**
 * One Over Draft row. Every figure is the derived OverdraftPosition shown
 * as-is: a negative Used stays negative (in red) and Needs Review keeps
 * its warning, with the reasons on hover, so data problems stay visible.
 */
function OverdraftRow({
    loan,
    row,
    formatDate,
    onView,
    onEdit,
    onDeleted,
}: {
    loan: Loan;
    row: OverdraftRowModel;
    formatDate: (value: string) => string;
    onView: (loan: Loan) => void;
    onEdit: (loan: Loan) => void;
    onDeleted: () => void | Promise<void>;
}) {
    return (
        <tr className="border-b border-slate-100 last:border-b-0">
            <LoanNameCell loan={loan} formatDate={formatDate} />

            <td className="px-4 py-4 text-right text-sm font-medium text-slate-900">
                {row.limit === null ? "—" : formatAmount(row.limit)}
            </td>

            <td
                className={`px-4 py-4 text-right text-sm font-medium ${
                    row.used !== null && row.used < 0
                        ? "text-red-600"
                        : "text-slate-900"
                }`}
            >
                {row.used === null ? "—" : formatAmount(row.used)}
            </td>

            <td className="px-4 py-4 text-right text-sm text-slate-700">
                {row.available === null ? "—" : formatAmount(row.available)}
            </td>

            <td className="px-4 py-4 text-right text-sm text-slate-700">
                {row.interestRate.toFixed(2)}%
            </td>

            <td className="px-4 py-4 text-sm text-slate-700">
                {row.linkedAccounts.length === 0 ? (
                    "—"
                ) : (
                    <ul className="space-y-0.5">
                        {row.linkedAccounts.map(name => (
                            <li key={name}>{name}</li>
                        ))}
                    </ul>
                )}
            </td>

            <td className="px-4 py-4">
                <StatusBadge status={row.loanStatus} />
                {row.usageStatusLabel && (
                    <div
                        className={`mt-1 text-[11px] font-medium ${
                            row.usageWarning ? "text-red-600" : "text-slate-500"
                        }`}
                        title={
                            row.reviewReasons.length > 0
                                ? row.reviewReasons.join("\n")
                                : undefined
                        }
                    >
                        {row.usageStatusLabel}
                    </div>
                )}
            </td>

            <LoanActionsCell
                loan={loan}
                onView={onView}
                onEdit={onEdit}
                onDeleted={onDeleted}
            />
        </tr>
    );
}

function formatAmount(value: number) {
    return new Intl.NumberFormat("en-IN", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
    }).format(value);
}



