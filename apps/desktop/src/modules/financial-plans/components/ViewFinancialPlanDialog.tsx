import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import type { Currency } from "@/modules/currencies/types";
import type { FinancialPlan } from "../types";
import {
    getFinancialPlanCategory,
    getFinancialPlanSubcategoryLabel,
} from "../constants";

export interface ViewFinancialPlanDialogProps {
    plan: FinancialPlan | null;
    currency?: Currency;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function formatDate(value: string | null) {
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

function formatAmount(
    amount: number | null,
    currency?: Currency
) {
    if (amount === null || amount === undefined) {
        return "—";
    }

    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: currency?.code || "INR",
        maximumFractionDigits: 2,
    }).format(Number(amount));
}

function formatStatus(status: FinancialPlan["status"]) {
    return (
        status.charAt(0) +
        status.slice(1).toLowerCase()
    );
}

function Detail({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                {label}
            </div>

            <div className="text-sm text-slate-800">
                {value || "—"}
            </div>
        </div>
    );
}

export function ViewFinancialPlanDialog({
    plan,
    currency,
    open,
    onOpenChange,
}: ViewFinancialPlanDialogProps) {
    if (!plan) {
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
                    w-[680px]
                    max-w-[calc(100vw-48px)]
                    rounded-[28px]
                    border border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="px-7 pb-5 pt-6">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Financial Plan Details
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        View financial plan information.
                    </DialogDescription>
                </DialogHeader>

                <div className="border-t border-slate-100 px-7 py-6">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                        <Detail
                            label="Plan Name"
                            value={plan.name}
                        />

                        <Detail
                            label="Plan Category"
                            value={
                                getFinancialPlanCategory(
                                    plan.planCategory ?? ""
                                )?.label ??
                                plan.planCategory ??
                                "—"
                            }
                        />

                        <Detail
                            label="Plan Type"
                            value={
                                getFinancialPlanSubcategoryLabel(
                                    plan.planCategory ?? "",
                                    plan.planSubcategory ??
                                        plan.planType
                                )
                            }
                        />

                        <Detail
                            label="Status"
                            value={formatStatus(
                                plan.status
                            )}
                        />

                        <Detail
                            label="Currency"
                            value={
                                currency
                                    ? `${currency.code} — ${currency.name}`
                                    : plan.currencyId
                            }
                        />

                        <Detail
                            label="Start Date"
                            value={formatDate(
                                plan.startDate
                            )}
                        />

                        <Detail
                            label="End Date"
                            value={formatDate(
                                plan.endDate
                            )}
                        />

                        <Detail
                            label="Target Amount"
                            value={formatAmount(
                                plan.targetAmount,
                                currency
                            )}
                        />

                        <Detail
                            label="Created"
                            value={
                                plan.createdAt || "—"
                            }
                        />

                        <div className="col-span-2 space-y-1">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                Notes
                            </div>

                            <div className="whitespace-pre-wrap text-sm text-slate-800">
                                {plan.notes || "—"}
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

