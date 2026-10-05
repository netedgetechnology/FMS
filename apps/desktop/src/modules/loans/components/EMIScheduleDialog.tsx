import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { EMIScheduleService } from "../services/EMIScheduleService";
import { LoanPaymentService } from "../services/LoanPaymentService";
import { isScheduleOverdue } from "../services/loanScheduleOverdue";
import { emiPaymentErrorMessage } from "./emiPaymentErrorMessage";
import {
    emiDialogLayout,
    measureNaturalTableWidth,
} from "./emiScheduleLayout";
import type { PaymentMethod } from "@/modules/transactions/types";
import { usePaymentTypes } from "@/modules/payment-types";
import { useMoneyFormatter, useDateFormatter } from "@/core/formatting";
import type {
    Loan,
    LoanPaymentSchedule,
    LoanSchedulePayment,
} from "../types";

export interface EMIScheduleDialogProps {
    loan: Loan | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void | Promise<void>;
}




// How much of this instalment is still unpaid - the maximum a new
// payment against it can be for (LoanPaymentService.processPayment
// enforces the same cap server-side). paidAmount is the running total
// across every payment already recorded against the row (Loans Phase
// 4 correction), so this is correct whether the row has never been
// paid, is PARTIAL, or (defensively) already PAID.
// Rounded to paise, like LoanPaymentService's roundMoney: a raw float
// difference (151167.39 - 68943 = 82224.39000000001) otherwise shows up in
// the pre-filled amount and can wrongly fail the "cannot exceed the
// remaining amount" check for a correctly typed figure.
export function remainingAmount(
    item: Pick<LoanPaymentSchedule, "totalAmount" | "paidAmount">
): number {
    const remaining = Math.max(
        0,
        item.totalAmount - (item.paidAmount ?? 0)
    );

    return Math.round((remaining + Number.EPSILON) * 100) / 100;
}

// Overdue is never a persisted status (Loans Phase 5 - derived, not
// stored) - it is layered on top of the real UPCOMING/PARTIAL status
// here, so a row can correctly read "Partial · Overdue" rather than
// losing the partial-payment fact the moment it's also late. A PAID
// row is never overdue (isScheduleOverdue already excludes it).
function formatStatus(
    status: LoanPaymentSchedule["status"],
    overdue: boolean
) {
    switch (status) {
        case "PAID":
            return "Paid";
        case "PARTIAL":
            return overdue ? "Partial · Overdue" : "Partial";
        case "UPCOMING":
            return overdue ? "Overdue" : "Upcoming";
        default:
            return status;
    }
}

function StatusBadge({
    status,
    overdue,
}: {
    status: LoanPaymentSchedule["status"];
    overdue: boolean;
}) {
    const className =
        status === "PAID"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : overdue
              ? "border-red-200 bg-red-50 text-red-700"
              : status === "PARTIAL"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-slate-200 bg-slate-50 text-slate-600";

    return (
        <span
            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}
        >
            {formatStatus(status, overdue)}
        </span>
    );
}

export function EMIScheduleDialog({
    loan,
    open,
    onOpenChange,
    onSuccess,
}: EMIScheduleDialogProps) {
    const formatDate = useDateFormatter();
    const formatMoney = useMoneyFormatter();
    const [schedule, setSchedule] = useState<LoanPaymentSchedule[]>([]);
    const [loading, setLoading] = useState(false);

    // Blocks a second submission before React has re-rendered the
    // disabled button (a fast double-click).
    const paymentInFlight = useRef(false);

    const [payingScheduleId, setPayingScheduleId] =
        useState<string | null>(null);

    const [paymentMethod, setPaymentMethod] =
        useState<PaymentMethod | null>(null);

    // A new EMI payment: only active master-list Payment Types.
    const { activeOptions: activePaymentTypes } = usePaymentTypes();

    const [paymentReference, setPaymentReference] =
        useState("");

    const [paymentNotes, setPaymentNotes] =
        useState("");

    const [selectedSchedule, setSelectedSchedule] =
        useState<LoanPaymentSchedule | null>(null);

    const [paymentDate, setPaymentDate] = useState(
        () => new Date().toISOString().slice(0, 10)
    );

    // Defaults to the full scheduled instalment - editable down to any
    // amount greater than zero (Loans Phase 4: partial payment of one
    // instalment). Never above the scheduled amount - that would be an
    // extra principal payment, a different, not-yet-supported feature.
    const [paymentAmount, setPaymentAmount] =
        useState("");

    // Reversal (Loans Phase 6) - a separate panel from the payment
    // form above, listing the actual loan_schedule_payments rows for
    // one schedule row so a specific payment can be picked, rather
    // than assuming the schedule's own cached transactionId is the
    // only (or the right) one to reverse.
    const [viewingPaymentsFor, setViewingPaymentsFor] =
        useState<LoanPaymentSchedule | null>(null);

    const [payments, setPayments] = useState<
        LoanSchedulePayment[]
    >([]);

    const [paymentsLoading, setPaymentsLoading] =
        useState(false);

    const [confirmingPayment, setConfirmingPayment] =
        useState<LoanSchedulePayment | null>(null);

    const [reversingPaymentId, setReversingPaymentId] =
        useState<string | null>(null);

    useEffect(() => {
        if (!open || !loan) {
            return;
        }

        let cancelled = false;
        const loanId = loan.id;

        async function loadSchedule() {
            try {
                setLoading(true);

                const service = new EMIScheduleService();
                const result = await service.getSchedule(loanId);

                if (!cancelled) {
                    setSchedule(result);
                }
            } catch (error) {
                console.error(
                    "Failed to load EMI schedule:",
                    error
                );

                if (!cancelled) {
                    setSchedule([]);

                    toast.error(
                        error instanceof Error
                            ? error.message
                            : "Failed to load EMI schedule."
                    );
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        void loadSchedule();

        return () => {
            cancelled = true;
        };
    }, [open, loan]);

    async function refreshSchedule() {
        if (!loan) {
            return;
        }

        const service = new EMIScheduleService();
        const result = await service.getSchedule(loan.id);
        setSchedule(result);
    }

    async function loadPayments(scheduleId: string) {
        const service = new EMIScheduleService();

        try {
            setPaymentsLoading(true);

            const result =
                await service.getPaymentsForSchedule(
                    scheduleId
                );

            setPayments(result);
        } catch (error) {
            console.error(
                "Failed to load payments for this instalment:",
                error
            );

            setPayments([]);

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to load payments for this instalment."
            );
        } finally {
            setPaymentsLoading(false);
        }
    }

    function openPaymentsPanel(item: LoanPaymentSchedule) {
        // Only a row that already has at least one recorded payment
        // can have anything to reverse.
        if (item.status === "UPCOMING") {
            return;
        }

        setViewingPaymentsFor(item);
        void loadPayments(item.id);
    }

    function closePaymentsPanel() {
        if (reversingPaymentId) {
            return;
        }

        setViewingPaymentsFor(null);
        setPayments([]);
    }

    async function handleReversePayment(
        payment: LoanSchedulePayment
    ) {
        try {
            setReversingPaymentId(payment.id);

            const service = new LoanPaymentService();

            try {
                await service.reversePayment(payment.id);
            } catch (error) {
                toast.error(
                    emiPaymentErrorMessage(
                        error,
                        "Failed to reverse payment."
                    )
                );
                return;
            }

            setConfirmingPayment(null);

            toast.success(
                "Payment reversed successfully."
            );

            // The reversal is saved; a failed refresh must not be
            // reported as a failed reversal.
            try {
                await refreshSchedule();

                if (viewingPaymentsFor) {
                    await loadPayments(
                        viewingPaymentsFor.id
                    );
                }

                await onSuccess?.();
            } catch (error) {
                console.error(
                    "Payment reversed, but refreshing the schedule failed:",
                    error
                );
                toast.warning(
                    "The payment was reversed, but the schedule could not be refreshed. Close and reopen it to see the latest state."
                );
            }
        } finally {
            setReversingPaymentId(null);
        }
    }

    function openPaymentForm(item: LoanPaymentSchedule) {
        if (item.status === "PAID") {
            return;
        }

        setSelectedSchedule(item);
        setPaymentMethod(null);
        setPaymentReference("");
        setPaymentNotes("");
        setPaymentDate(item.dueDate);
        setPaymentAmount(
            String(remainingAmount(item))
        );
    }

    function closePaymentForm() {
        if (payingScheduleId) {
            return;
        }

        setSelectedSchedule(null);
        setPaymentMethod(null);
        setPaymentReference("");
        setPaymentNotes("");
        setPaymentAmount("");
    }

    async function handlePayEMI(item: LoanPaymentSchedule) {
        if (!loan) {
            return;
        }

        if (item.status === "PAID") {
            return;
        }

        if (!paymentMethod) {
            toast.error("Please select a payment method.");
            return;
        }

        if (!paymentDate) {
            toast.error("Please select a payment date.");
            return;
        }

        const amount = Number(paymentAmount);

        if (!Number.isFinite(amount) || amount <= 0) {
            toast.error(
                "Please enter a payment amount greater than zero."
            );
            return;
        }

        const remaining = remainingAmount(item);

        if (amount > remaining) {
            toast.error(
                `Payment amount cannot exceed the remaining scheduled amount of ${formatMoney(
                    remaining
                )} for this instalment. Paying more than what remains isn't supported yet.`
            );
            return;
        }

        if (paymentInFlight.current) {
            return;
        }

        paymentInFlight.current = true;

        try {
            setPayingScheduleId(item.id);

            const service = new LoanPaymentService();

            try {
                await service.processPayment({
                    loanId: loan.id,
                    scheduleId: item.id,
                    paymentDate,
                    amount,
                    paymentMethod,
                    referenceNumber:
                        paymentReference.trim() || null,
                    notes:
                        paymentNotes.trim() || null,
                });
            } catch (error) {
                toast.error(
                    emiPaymentErrorMessage(
                        error,
                        "Failed to process EMI payment."
                    )
                );
                return;
            }

            setPaymentReference("");
            setPaymentNotes("");
            setPaymentMethod(null);
            setSelectedSchedule(null);
            setPaymentDate(
                new Date().toISOString().slice(0, 10)
            );
            setPaymentAmount("");

            toast.success(
                "EMI payment recorded successfully."
            );

            // The payment is saved; a failed refresh must never be
            // reported as a failed payment (that invites a duplicate).
            try {
                await refreshSchedule();
                await onSuccess?.();
            } catch (error) {
                console.error(
                    "EMI payment recorded, but refreshing the schedule failed:",
                    error
                );
                toast.warning(
                    "The payment was recorded, but the schedule could not be refreshed. Close and reopen it to see the latest state."
                );
            }
        } finally {
            paymentInFlight.current = false;
            setPayingScheduleId(null);
        }
    }

    // Dialog width follows the schedule table's natural width (see
    // emiScheduleLayout.ts): every column visible, no horizontal scroll.
    const scheduleTableRef = useRef<HTMLTableElement | null>(null);
    const scrollAreaRef = useRef<HTMLDivElement | null>(null);
    const [compactTable, setCompactTable] = useState(false);
    const [dialogWidth, setDialogWidth] = useState<number | null>(null);
    // The table's natural width at normal density, so a compact table can
    // return to normal density when the window grows again.
    const normalTableWidth = useRef<number | null>(null);

    useLayoutEffect(() => {
        if (!open) {
            return;
        }

        function fitToTable() {
            const table = scheduleTableRef.current;

            if (!table) {
                return;
            }

            const natural = measureNaturalTableWidth(table);
            // The list's vertical scrollbar (when it has one) takes width
            // from the content area - measured, not assumed.
            const scrollArea = scrollAreaRef.current;
            const scrollbar = scrollArea
                ? scrollArea.offsetWidth - scrollArea.clientWidth
                : 0;

            if (!compactTable) {
                normalTableWidth.current = natural;
            }

            const layout = emiDialogLayout(
                natural,
                window.innerWidth,
                scrollbar
            );

            if (!compactTable && !layout.fits) {
                setCompactTable(true);
                return;
            }

            if (
                compactTable &&
                normalTableWidth.current !== null &&
                emiDialogLayout(
                    normalTableWidth.current,
                    window.innerWidth,
                    scrollbar
                ).fits
            ) {
                setCompactTable(false);
                return;
            }

            setDialogWidth(layout.width);
        }

        fitToTable();
        window.addEventListener("resize", fitToTable);

        return () => {
            window.removeEventListener("resize", fitToTable);
        };
    }, [open, loading, schedule, compactTable]);

    const cellPadding = compactTable ? "px-2.5 py-2.5" : "px-4 py-3";
    const cellText = compactTable ? "text-[13px]" : "text-sm";

    const summary = useMemo(() => {
        return {
            total: schedule.length,

            paid: schedule.filter(
                item => item.status === "PAID"
            ).length,

            // A PARTIAL row still needs a further payment to
            // complete it - grouped with Upcoming rather than
            // invisible between the Paid/Overdue counts. Overdue
            // (derived, never persisted - Loans Phase 5) is split out
            // from Upcoming rather than double-counted in both, so
            // Paid + Upcoming + Overdue always adds up to Total.
            upcoming: schedule.filter(
                item =>
                    (item.status === "UPCOMING" ||
                        item.status === "PARTIAL") &&
                    !isScheduleOverdue(item)
            ).length,

            overdue: schedule.filter(item =>
                isScheduleOverdue(item)
            ).length,

            totalAmount: schedule
                .filter(item => item.status !== "PAID")
                .reduce(
                    (total, item) =>
                        total + Number(item.totalAmount ?? 0),
                    0
                ),
        };
    }, [schedule]);

    if (!loan) {
        return null;
    }

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
        >
            <DialogContent
                showCloseButton
                style={
                    dialogWidth === null
                        ? undefined
                        : { width: dialogWidth }
                }
                className="
                    flex
                    w-[min(1100px,calc(100vw-48px))]
                    max-w-[calc(100vw-48px)]
                    max-h-[calc(100vh-32px)]
                    flex-col
                    gap-0
                    overflow-hidden
                    rounded-[28px]
                    border border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="shrink-0 px-7 pb-4 pt-5">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        EMI Schedule
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        {loan.name} — payment schedule and outstanding balance.
                    </DialogDescription>
                </DialogHeader>

                <div
                    ref={scrollAreaRef}
                    className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden border-t border-slate-100 px-7 py-5"
                >
                    {loading ? (
                        <div className="flex min-h-[240px] items-center justify-center">
                            <p className="text-sm text-slate-500">
                                Loading EMI schedule...
                            </p>
                        </div>
                    ) : schedule.length === 0 ? (
                        <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50">
                            <div className="text-center">
                                <p className="text-sm font-medium text-slate-700">
                                    No EMI schedule found
                                </p>

                                <p className="mt-1 text-xs text-slate-500">
                                    This loan does not have a generated EMI schedule.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                        Total EMIs
                                    </div>

                                    <div className="mt-1 text-lg font-semibold text-slate-900">
                                        {summary.total}
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                        Paid
                                    </div>

                                    <div className="mt-1 text-lg font-semibold text-emerald-700">
                                        {summary.paid}
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                        Upcoming
                                    </div>

                                    <div className="mt-1 text-lg font-semibold text-slate-900">
                                        {summary.upcoming}
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                        Overdue
                                    </div>

                                    <div className="mt-1 text-lg font-semibold text-red-600">
                                        {summary.overdue}
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                        Scheduled Amount
                                    </div>

                                    <div className="mt-1 text-lg font-semibold text-slate-900">
                                        {formatMoney(summary.totalAmount)}
                                    </div>
                                </div>
                            </div>

                            {selectedSchedule && (
                                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <h3 className="text-sm font-semibold text-slate-900">
                                                Record EMI Payment
                                            </h3>

                                            <p className="mt-1 text-xs text-slate-500">
                                                Installment{" "}
                                                {selectedSchedule.installmentNumber}
                                                {" · "}
                                                {formatMoney(
                                                    selectedSchedule.totalAmount
                                                )}
                                            </p>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={closePaymentForm}
                                            disabled={Boolean(payingScheduleId)}
                                            className="text-sm font-medium text-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            Cancel
                                        </button>
                                    </div>

                                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                                        <label className="block">
                                            <span className="mb-1.5 block text-xs font-medium text-slate-600">
                                                Amount
                                            </span>

                                            <input
                                                type="number"
                                                min="0.01"
                                                step="0.01"
                                                max={remainingAmount(
                                                    selectedSchedule
                                                )}
                                                value={
                                                    paymentAmount
                                                }
                                                onChange={event =>
                                                    setPaymentAmount(
                                                        event.target.value
                                                    )
                                                }
                                                disabled={Boolean(
                                                    payingScheduleId
                                                )}
                                                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-400"
                                            />

                                            <span className="mt-1 block text-[11px] text-slate-400">
                                                {selectedSchedule.status ===
                                                "PARTIAL"
                                                    ? `${formatMoney(
                                                          remainingAmount(
                                                              selectedSchedule
                                                          )
                                                      )} remaining on this instalment - paying less than that records another partial payment.`
                                                    : `Up to ${formatMoney(
                                                          remainingAmount(
                                                              selectedSchedule
                                                          )
                                                      )} - paying less records a partial payment.`}
                                            </span>
                                        </label>

                                        <label className="block">
                                            <span className="mb-1.5 block text-xs font-medium text-slate-600">
                                                Payment Date
                                            </span>

                                            <input
                                                type="date"
                                                value={paymentDate}
                                                onChange={event =>
                                                    setPaymentDate(
                                                        event.target.value
                                                    )
                                                }
                                                disabled={Boolean(
                                                    payingScheduleId
                                                )}
                                                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-400"
                                            />
                                        </label>

                                        <label className="block">
                                            <span className="mb-1.5 block text-xs font-medium text-slate-600">
                                                Payment Method
                                            </span>

                                            <select
                                                value={
                                                    paymentMethod ?? ""
                                                }
                                                onChange={event =>
                                                    setPaymentMethod(
                                                        event.target.value
                                                            ? event.target.value
                                                            : null
                                                    )
                                                }
                                                disabled={Boolean(
                                                    payingScheduleId
                                                )}
                                                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-400"
                                            >
                                                <option value="">
                                                    Select payment method
                                                </option>

                                                {activePaymentTypes.map(option => (
                                                    <option
                                                        key={option.value}
                                                        value={option.value}
                                                    >
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>

                                        <label className="block">
                                            <span className="mb-1.5 block text-xs font-medium text-slate-600">
                                                Reference Number
                                            </span>

                                            <input
                                                type="text"
                                                value={paymentReference}
                                                onChange={event =>
                                                    setPaymentReference(
                                                        event.target.value
                                                    )
                                                }
                                                placeholder="Optional"
                                                disabled={Boolean(
                                                    payingScheduleId
                                                )}
                                                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-400"
                                            />
                                        </label>

                                        <label className="block">
                                            <span className="mb-1.5 block text-xs font-medium text-slate-600">
                                                Notes
                                            </span>

                                            <input
                                                type="text"
                                                value={paymentNotes}
                                                onChange={event =>
                                                    setPaymentNotes(
                                                        event.target.value
                                                    )
                                                }
                                                placeholder="Optional"
                                                disabled={Boolean(
                                                    payingScheduleId
                                                )}
                                                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-400"
                                            />
                                        </label>
                                    </div>

                                    <div className="mt-4 flex justify-end">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                void handlePayEMI(
                                                    selectedSchedule
                                                )
                                            }
                                            disabled={
                                                Boolean(
                                                    payingScheduleId
                                                ) ||
                                                !paymentMethod ||
                                                !paymentDate ||
                                                !(
                                                    Number(
                                                        paymentAmount
                                                    ) > 0
                                                ) ||
                                                Number(
                                                    paymentAmount
                                                ) >
                                                    remainingAmount(
                                                        selectedSchedule
                                                    )
                                            }
                                            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {payingScheduleId ===
                                            selectedSchedule.id
                                                ? "Recording..."
                                                : `Record Payment of ${formatMoney(
                                                      Number(
                                                          paymentAmount
                                                      ) || 0
                                                  )}`}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {viewingPaymentsFor && (
                                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <h3 className="text-sm font-semibold text-slate-900">
                                                Payments —
                                                Installment{" "}
                                                {
                                                    viewingPaymentsFor.installmentNumber
                                                }
                                            </h3>

                                            <p className="mt-1 text-xs text-slate-500">
                                                Reversing a
                                                payment
                                                soft-deletes
                                                its linked
                                                bank
                                                transaction
                                                and restores
                                                the loan's
                                                outstanding
                                                balance by
                                                that
                                                payment's own
                                                amount.
                                            </p>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={
                                                closePaymentsPanel
                                            }
                                            disabled={Boolean(
                                                reversingPaymentId
                                            )}
                                            className="text-sm font-medium text-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            Close
                                        </button>
                                    </div>

                                    <div className="mt-4">
                                        {paymentsLoading ? (
                                            <p className="text-sm text-slate-500">
                                                Loading
                                                payments...
                                            </p>
                                        ) : payments.length ===
                                          0 ? (
                                            <p className="text-sm text-slate-500">
                                                No payments
                                                found for
                                                this
                                                instalment.
                                            </p>
                                        ) : (
                                            <div className="rounded-xl border border-slate-200 bg-white">
                                                <table className="w-full border-collapse">
                                                    <thead className="bg-slate-50">
                                                        <tr>
                                                            <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                                                                Payment
                                                                Date
                                                            </th>

                                                            <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                                                                Principal
                                                            </th>

                                                            <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                                                                Interest
                                                            </th>

                                                            <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                                                                Amount
                                                            </th>

                                                            <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                                                Action
                                                            </th>
                                                        </tr>
                                                    </thead>

                                                    <tbody className="divide-y divide-slate-100">
                                                        {payments.map(
                                                            item => (
                                                                <tr
                                                                    key={
                                                                        item.id
                                                                    }
                                                                >
                                                                    <td className="px-4 py-2 text-sm text-slate-600">
                                                                        {formatDate(
                                                                            item.paymentDate
                                                                        )}
                                                                    </td>

                                                                    <td className="px-4 py-2 text-right text-sm text-slate-600">
                                                                        {formatMoney(
                                                                            item.principalAmount
                                                                        )}
                                                                    </td>

                                                                    <td className="px-4 py-2 text-right text-sm text-slate-600">
                                                                        {formatMoney(
                                                                            item.interestAmount
                                                                        )}
                                                                    </td>

                                                                    <td className="px-4 py-2 text-right text-sm font-medium text-slate-800">
                                                                        {formatMoney(
                                                                            item.amount
                                                                        )}
                                                                    </td>

                                                                    <td className="px-4 py-2 text-right">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                setConfirmingPayment(
                                                                                    item
                                                                                )
                                                                            }
                                                                            disabled={Boolean(
                                                                                reversingPaymentId
                                                                            )}
                                                                            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                                        >
                                                                            Reverse
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            )
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="mt-5 rounded-2xl border border-slate-100">
                                <table
                                    ref={scheduleTableRef}
                                    className="w-full border-collapse"
                                >
                                    <thead className="bg-slate-50">
                                        <tr>
                                            <th className={`${cellPadding} whitespace-nowrap text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500`}>
                                                #
                                            </th>

                                            <th className={`${cellPadding} whitespace-nowrap text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500`}>
                                                Due Date
                                            </th>

                                            <th className={`${cellPadding} whitespace-nowrap text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500`}>
                                                Principal
                                            </th>

                                            <th className={`${cellPadding} whitespace-nowrap text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500`}>
                                                Interest
                                            </th>

                                            <th className={`${cellPadding} whitespace-nowrap text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500`}>
                                                EMI
                                            </th>

                                            <th className={`${cellPadding} whitespace-nowrap text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500`}>
                                                Outstanding
                                            </th>

                                            <th className={`${cellPadding} whitespace-nowrap text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500`}>
                                                Status
                                            </th>

                                            <th className={`${cellPadding} whitespace-nowrap text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500`}>
                                                Paid Date
                                            </th>

                                            <th className={`${cellPadding} whitespace-nowrap text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500`}>
                                                Paid Amount
                                            </th>

                                            <th className={`${cellPadding} whitespace-nowrap text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500`}>
                                                Action
                                            </th>
                                        </tr>
                                    </thead>

                                    <tbody className="divide-y divide-slate-100">
                                        {schedule.map(item => (
                                            <tr
                                                key={item.id}
                                                className="transition-colors hover:bg-slate-50/70"
                                            >
                                                <td className={`${cellPadding} whitespace-nowrap ${cellText} font-medium text-slate-800`}>
                                                    {item.installmentNumber}
                                                </td>

                                                <td className={`${cellPadding} whitespace-nowrap ${cellText} text-slate-600`}>
                                                    {formatDate(item.dueDate)}
                                                </td>

                                                <td className={`${cellPadding} whitespace-nowrap text-right ${cellText} text-slate-600`}>
                                                    {formatMoney(
                                                        item.principalAmount
                                                    )}
                                                </td>

                                                <td className={`${cellPadding} whitespace-nowrap text-right ${cellText} text-slate-600`}>
                                                    {formatMoney(
                                                        item.interestAmount
                                                    )}
                                                </td>

                                                <td className={`${cellPadding} whitespace-nowrap text-right ${cellText} font-medium text-slate-800`}>
                                                    {formatMoney(
                                                        item.totalAmount
                                                    )}
                                                </td>

                                                <td className={`${cellPadding} whitespace-nowrap text-right ${cellText} text-slate-600`}>
                                                    {formatMoney(
                                                        item.outstandingPrincipal
                                                    )}
                                                </td>

                                                <td className={`${cellPadding} whitespace-nowrap`}>
                                                    <StatusBadge
                                                        status={item.status}
                                                        overdue={isScheduleOverdue(
                                                            item
                                                        )}
                                                    />
                                                </td>

                                                <td className={`${cellPadding} whitespace-nowrap ${cellText} text-slate-600`}>
                                                    {formatDate(
                                                        item.paidDate
                                                    )}
                                                </td>

                                                <td className={`${cellPadding} whitespace-nowrap text-right ${cellText} text-slate-600`}>
                                                    {item.paidAmount === null
                                                        ? "—"
                                                        : formatMoney(
                                                              item.paidAmount
                                                          )}
                                                </td>

                                                <td className={`${cellPadding} whitespace-nowrap text-right`}>
                                                    <div className="flex flex-nowrap items-center justify-end gap-1.5">
                                                        {item.status ===
                                                        "PAID" ? (
                                                            <span className="text-xs font-medium text-slate-400">
                                                                Paid
                                                            </span>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    openPaymentForm(
                                                                        item
                                                                    )
                                                                }
                                                                disabled={
                                                                    Boolean(
                                                                        payingScheduleId
                                                                    )
                                                                }
                                                                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                            >
                                                                {item.status ===
                                                                "PARTIAL"
                                                                    ? "Complete Payment"
                                                                    : "Pay EMI"}
                                                            </button>
                                                        )}

                                                        {item.status !==
                                                            "UPCOMING" && (
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    openPaymentsPanel(
                                                                        item
                                                                    )
                                                                }
                                                                title="View and reverse payments"
                                                                aria-label="View and reverse payments"
                                                                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                                                            >
                                                                Payments
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            </DialogContent>

            <AlertDialog
                open={confirmingPayment !== null}
                onOpenChange={nextOpen => {
                    if (!nextOpen && !reversingPaymentId) {
                        setConfirmingPayment(null);
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Reverse this payment?
                        </AlertDialogTitle>

                        <AlertDialogDescription>
                            {confirmingPayment && (
                                <>
                                    This will reverse the{" "}
                                    <span className="font-medium text-slate-700">
                                        {formatMoney(
                                            confirmingPayment.amount
                                        )}
                                    </span>{" "}
                                    payment made on{" "}
                                    <span className="font-medium text-slate-700">
                                        {formatDate(
                                            confirmingPayment.paymentDate
                                        )}
                                    </span>{" "}
                                    and delete its linked
                                    bank transaction. The
                                    loan's outstanding
                                    balance will be restored
                                    by this payment's own
                                    amount. This can&apos;t
                                    be undone from here.
                                </>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <AlertDialogFooter>
                        <AlertDialogCancel
                            disabled={Boolean(
                                reversingPaymentId
                            )}
                        >
                            Cancel
                        </AlertDialogCancel>

                        <AlertDialogAction
                            type="button"
                            disabled={Boolean(
                                reversingPaymentId
                            )}
                            onClick={() => {
                                if (confirmingPayment) {
                                    void handleReversePayment(
                                        confirmingPayment
                                    );
                                }
                            }}
                            className="bg-red-600 text-white hover:bg-red-700"
                        >
                            {reversingPaymentId
                                ? "Reversing..."
                                : "Reverse Payment"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Dialog>
    );
}


