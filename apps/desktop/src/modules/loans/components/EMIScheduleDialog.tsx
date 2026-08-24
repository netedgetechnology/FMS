import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { EMIScheduleService } from "../services/EMIScheduleService";
import { LoanPaymentService } from "../services/LoanPaymentService";
import type { PaymentMethod } from "@/modules/transactions/types";
import type { Loan, LoanPaymentSchedule } from "../types";

export interface EMIScheduleDialogProps {
    loan: Loan | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void | Promise<void>;
}

function formatAmount(value: number | null | undefined) {
    return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(Number(value ?? 0));
}

function formatDate(value: string | null | undefined) {
    if (!value) {
        return "—";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    }).format(date);
}

function formatStatus(status: LoanPaymentSchedule["status"]) {
    switch (status) {
        case "PAID":
            return "Paid";
        case "PARTIAL":
            return "Partial";
        case "OVERDUE":
            return "Overdue";
        case "UPCOMING":
            return "Upcoming";
        default:
            return status;
    }
}

function StatusBadge({
    status,
}: {
    status: LoanPaymentSchedule["status"];
}) {
    const classes = {
        PAID: "border-emerald-200 bg-emerald-50 text-emerald-700",
        PARTIAL: "border-amber-200 bg-amber-50 text-amber-700",
        OVERDUE: "border-red-200 bg-red-50 text-red-700",
        UPCOMING: "border-slate-200 bg-slate-50 text-slate-600",
    };

    return (
        <span
            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                classes[status]
            }`}
        >
            {formatStatus(status)}
        </span>
    );
}

export function EMIScheduleDialog({
    loan,
    open,
    onOpenChange,
    onSuccess,
}: EMIScheduleDialogProps) {
    const [schedule, setSchedule] = useState<LoanPaymentSchedule[]>([]);
    const [loading, setLoading] = useState(false);

    const [payingScheduleId, setPayingScheduleId] =
        useState<string | null>(null);

    const [paymentMethod, setPaymentMethod] =
        useState<PaymentMethod | null>(null);

    const [paymentReference, setPaymentReference] =
        useState("");

    const [paymentNotes, setPaymentNotes] =
        useState("");

    const [selectedSchedule, setSelectedSchedule] =
        useState<LoanPaymentSchedule | null>(null);

    const [paymentDate, setPaymentDate] = useState(
        () => new Date().toISOString().slice(0, 10)
    );

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

    function openPaymentForm(item: LoanPaymentSchedule) {
        if (item.status === "PAID") {
            return;
        }

        setSelectedSchedule(item);
        setPaymentMethod(null);
        setPaymentReference("");
        setPaymentNotes("");
        setPaymentDate(item.dueDate);
    }

    function closePaymentForm() {
        if (payingScheduleId) {
            return;
        }

        setSelectedSchedule(null);
        setPaymentMethod(null);
        setPaymentReference("");
        setPaymentNotes("");
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

        try {
            setPayingScheduleId(item.id);

            const service = new LoanPaymentService();

            await service.processPayment({
                loanId: loan.id,
                scheduleId: item.id,
                paymentDate,
                paymentMethod,
                referenceNumber:
                    paymentReference.trim() || null,
                notes:
                    paymentNotes.trim() || null,
            });

            await refreshSchedule();
            await onSuccess?.();

            setPaymentReference("");
            setPaymentNotes("");
            setPaymentMethod(null);
            setSelectedSchedule(null);
            setPaymentDate(
                new Date().toISOString().slice(0, 10)
            );

            toast.success(
                "EMI payment recorded successfully."
            );
        } catch (error) {
            console.error(
                "Failed to process EMI payment:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to process EMI payment."
            );
        } finally {
            setPayingScheduleId(null);
        }
    }

    const summary = useMemo(() => {
        return {
            total: schedule.length,

            paid: schedule.filter(
                item => item.status === "PAID"
            ).length,

            upcoming: schedule.filter(
                item => item.status === "UPCOMING"
            ).length,

            overdue: schedule.filter(
                item => item.status === "OVERDUE"
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
                className="
                    flex
                    w-[1100px]
                    max-w-[calc(100vw-32px)]
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

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-5">
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
                                        {formatAmount(summary.totalAmount)}
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
                                                {formatAmount(
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
                                                            ? event.target
                                                                  .value as PaymentMethod
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

                                                <option value="CASH">
                                                    Cash
                                                </option>

                                                <option value="CARD">
                                                    Credit Card
                                                </option>

                                                <option value="DEBIT_CARD">
                                                    Debit Card
                                                </option>

                                                <option value="UPI">
                                                    UPI
                                                </option>

                                                <option value="BANK_TRANSFER">
                                                    Bank Transfer
                                                </option>

                                                <option value="DIRECT_DEBIT">
                                                    Direct Debit
                                                </option>

                                                <option value="OTHER">
                                                    Other
                                                </option>
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
                                                !paymentDate
                                            }
                                            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {payingScheduleId ===
                                            selectedSchedule.id
                                                ? "Recording..."
                                                : `Record Payment of ${formatAmount(
                                                      selectedSchedule.totalAmount
                                                  )}`}
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-100">
                                <table className="w-full min-w-[1000px] border-collapse">
                                    <thead className="bg-slate-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                                                #
                                            </th>

                                            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                                                Due Date
                                            </th>

                                            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                                                Principal
                                            </th>

                                            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                                                Interest
                                            </th>

                                            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                                                EMI
                                            </th>

                                            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                                                Outstanding
                                            </th>

                                            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                                                Status
                                            </th>

                                            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                                                Paid Date
                                            </th>

                                            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                                                Paid Amount
                                            </th>

                                            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
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
                                                <td className="px-4 py-3 text-sm font-medium text-slate-800">
                                                    {item.installmentNumber}
                                                </td>

                                                <td className="px-4 py-3 text-sm text-slate-600">
                                                    {formatDate(item.dueDate)}
                                                </td>

                                                <td className="px-4 py-3 text-right text-sm text-slate-600">
                                                    {formatAmount(
                                                        item.principalAmount
                                                    )}
                                                </td>

                                                <td className="px-4 py-3 text-right text-sm text-slate-600">
                                                    {formatAmount(
                                                        item.interestAmount
                                                    )}
                                                </td>

                                                <td className="px-4 py-3 text-right text-sm font-medium text-slate-800">
                                                    {formatAmount(
                                                        item.totalAmount
                                                    )}
                                                </td>

                                                <td className="px-4 py-3 text-right text-sm text-slate-600">
                                                    {formatAmount(
                                                        item.outstandingPrincipal
                                                    )}
                                                </td>

                                                <td className="px-4 py-3">
                                                    <StatusBadge
                                                        status={item.status}
                                                    />
                                                </td>

                                                <td className="px-4 py-3 text-sm text-slate-600">
                                                    {formatDate(
                                                        item.paidDate
                                                    )}
                                                </td>

                                                <td className="px-4 py-3 text-right text-sm text-slate-600">
                                                    {item.paidAmount === null
                                                        ? "—"
                                                        : formatAmount(
                                                              item.paidAmount
                                                          )}
                                                </td>

                                                <td className="px-4 py-3 text-right">
                                                    {item.status === "PAID" ? (
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
                                                            Pay EMI
                                                        </button>
                                                    )}
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
        </Dialog>
    );
}
