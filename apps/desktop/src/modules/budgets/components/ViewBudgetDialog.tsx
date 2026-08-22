import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import type { Budget } from "../types";

export interface ViewBudgetDialogProps {
    budget: Budget | null;
    currencyCode?: string;
    categoryName?: string;
    businessEntityName?: string;
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
    amount: number,
    currencyCode?: string
) {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: currencyCode || "INR",
        maximumFractionDigits: 2,
    }).format(Number(amount));
}

function formatPeriod(
    periodType: Budget["periodType"]
) {
    switch (periodType) {
        case "MONTHLY":
            return "Monthly";
        case "QUARTERLY":
            return "Quarterly";
        case "YEARLY":
            return "Yearly";
        case "CUSTOM":
            return "Custom";
        default:
            return periodType;
    }
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

export function ViewBudgetDialog({
    budget,
    currencyCode,
    categoryName,
    businessEntityName,
    open,
    onOpenChange,
}: ViewBudgetDialogProps) {
    if (!budget) {
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
                        Budget Details
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        View budget information.
                    </DialogDescription>
                </DialogHeader>

                <div className="border-t border-slate-100 px-7 py-6">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                        <Detail
                            label="Budget Name"
                            value={budget.name}
                        />

                        <Detail
                            label="Status"
                            value={
                                budget.isActive
                                    ? "Active"
                                    : "Inactive"
                            }
                        />

                        <Detail
                            label="Category"
                            value={
                                categoryName ||
                                "All Categories"
                            }
                        />

                        <Detail
                            label="Business Entity"
                            value={
                                businessEntityName ||
                                "Personal Finance"
                            }
                        />

                        <Detail
                            label="Budget Amount"
                            value={formatAmount(
                                budget.amount,
                                currencyCode
                            )}
                        />

                        <Detail
                            label="Period"
                            value={formatPeriod(
                                budget.periodType
                            )}
                        />

                        <Detail
                            label="Currency"
                            value={
                                currencyCode ||
                                budget.currencyId
                            }
                        />

                        <Detail
                            label="Alert Threshold"
                            value={`${budget.alertThreshold}%`}
                        />

                        <Detail
                            label="Start Date"
                            value={formatDate(
                                budget.startDate
                            )}
                        />

                        <Detail
                            label="End Date"
                            value={formatDate(
                                budget.endDate
                            )}
                        />

                        <Detail
                            label="Created"
                            value={
                                budget.createdAt || "—"
                            }
                        />

                        <Detail
                            label="Updated"
                            value={
                                budget.updatedAt || "—"
                            }
                        />
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
