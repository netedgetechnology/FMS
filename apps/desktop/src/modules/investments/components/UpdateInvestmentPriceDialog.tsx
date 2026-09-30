import { useState } from "react";
import type { ReactElement } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms";
import { useDateFormatter } from "@/core/formatting";

import { Tag } from "lucide-react";

import {
    InvestmentService,
    getInvestmentPriceFreshness,
} from "../services";
import type { Investment } from "../types";

import {
    updateInvestmentPriceSchema,
    type UpdateInvestmentPriceFormInput,
    type UpdateInvestmentPriceFormValues,
} from "../validation";

export interface UpdateInvestmentPriceDialogProps {
    investment: Investment;
    onSuccess?: () => Promise<void> | void;
    trigger?: ReactElement;
}

function formatAmount(value: number): string {
    return new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4,
    }).format(value);
}

/**
 * Small, focused workflow for the single most frequent Investments
 * interaction - updating just the manually-entered current price.
 * Deliberately does not reuse InvestmentForm: that form exposes ~12
 * fields across 4 sections, which is disproportionate for this one
 * value. Delegates entirely to InvestmentService.update() with every
 * other field passed through unchanged, so ledger authority, the
 * currency-change guard and the priceUpdatedAt bump-only-on-change
 * rule all apply exactly as they do from the full Edit form - no
 * business logic is duplicated here.
 */
export function UpdateInvestmentPriceDialog({
    investment,
    onSuccess,
    trigger,
}: UpdateInvestmentPriceDialogProps) {
    const service = new InvestmentService();
    const formatDate = useDateFormatter();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [submitError, setSubmitError] =
        useState<string | null>(null);

    const {
        register,
        handleSubmit,
        watch,
        formState: { errors },
    } = useForm<
        UpdateInvestmentPriceFormInput,
        unknown,
        UpdateInvestmentPriceFormValues
    >({
        resolver: zodResolver(
            updateInvestmentPriceSchema
        ),
        defaultValues: {
            currentPrice: investment.currentPrice,
        },
    });

    const newPrice = watch("currentPrice");
    const resultingValue =
        typeof newPrice === "number" &&
        Number.isFinite(newPrice)
            ? investment.quantity * newPrice
            : investment.currentValue;

    const freshness = getInvestmentPriceFreshness(
        investment.priceUpdatedAt
    );
    const formattedUpdatedDate = investment.priceUpdatedAt
        ? formatDate(investment.priceUpdatedAt)
        : "";

    async function handleFormSubmit(
        values: UpdateInvestmentPriceFormValues
    ) {
        try {
            setLoading(true);
            setSubmitError(null);

            await service.update({
                id: investment.id,
                businessEntityId:
                    investment.businessEntityId ?? "",
                name: investment.name,
                investmentType: investment.investmentType,
                investmentSubtype:
                    investment.investmentSubtype,
                symbol: investment.symbol,
                isin: investment.isin,
                currencyId: investment.currencyId,
                brokerInstitutionId:
                    investment.brokerInstitutionId,
                brokerInstitutionName: "",
                quantity: investment.quantity,
                averageCost: investment.averageCost,
                currentPrice: values.currentPrice,
                currentValue:
                    investment.quantity *
                    values.currentPrice,
                purchaseDate: investment.purchaseDate,
                status: investment.status,
                notes: investment.notes,
            });

            await onSuccess?.();

            toast.success("Price updated successfully.");

            setOpen(false);
        } catch (error) {
            console.error(
                "Failed to update investment price:",
                error
            );

            const message =
                error instanceof Error
                    ? error.message
                    : "Failed to update price. Please try again.";

            setSubmitError(message);

            toast.error(message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!loading) {
                    setOpen(nextOpen);
                }
            }}
        >
            <DialogTrigger
                render={
                    trigger ?? (
                        <button
    type="button"
    title="Update price"
    aria-label="Update price"
    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
>
    <Tag className="h-3.5 w-3.5" />
</button>
                    )
                }
            >
                {trigger ? null : "Update Price"}
            </DialogTrigger>

            <DialogContent
                showCloseButton
                className="
                    flex
                    w-[440px]
                    max-w-[calc(100vw-48px)]
                    max-h-[calc(100vh-48px)]
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
                        Update Price
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        {investment.name}
                    </DialogDescription>
                </DialogHeader>

                <form
                    onSubmit={handleSubmit(
                        handleFormSubmit
                    )}
                    className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-5"
                >
                    {submitError && (
                        <div
                            role="alert"
                            className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2"
                        >
                            <p className="text-xs leading-4 text-red-600">
                                {submitError}
                            </p>
                        </div>
                    )}

                    <div className="space-y-4">
                        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                            <p className="text-xs text-slate-500">
                                Current price
                            </p>

                            <p className="text-sm font-medium text-slate-900">
                                {formatAmount(
                                    investment.currentPrice
                                )}
                            </p>

                            <p
                                className={
                                    freshness === "stale"
                                        ? "mt-0.5 text-[11px] font-medium text-amber-600"
                                        : "mt-0.5 text-[11px] text-slate-400"
                                }
                            >
                                {freshness === "unknown" ||
                                !formattedUpdatedDate
                                    ? "Price update date unknown"
                                    : freshness === "stale"
                                      ? `Stale since ${formattedUpdatedDate}`
                                      : `Updated ${formattedUpdatedDate}`}
                            </p>
                        </div>

                        <FormField
                            label="New Price"
                            htmlFor="currentPrice"
                            error={
                                errors.currentPrice
                                    ?.message
                            }
                        >
                            <Input
                                id="currentPrice"
                                type="number"
                                min="0"
                                step="any"
                                autoFocus
                                {...register(
                                    "currentPrice"
                                )}
                            />

                            <p className="text-xs text-slate-400">
                                Entered manually - this
                                does not fetch a live
                                market price. Use the
                                value you want recorded.
                            </p>
                        </FormField>

                        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                            <p className="text-xs text-slate-500">
                                Resulting current value
                                (Quantity × New Price)
                            </p>

                            <p className="text-sm font-medium text-slate-900">
                                {formatAmount(
                                    resultingValue
                                )}
                            </p>
                        </div>
                    </div>

                    <div className="mt-5 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                        <button
                            type="button"
                            disabled={loading}
                            onClick={() =>
                                setOpen(false)
                            }
                            className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            Cancel
                        </button>

                        <button
                            type="submit"
                            disabled={loading}
                            className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {loading
                                ? "Saving..."
                                : "Update Price"}
                        </button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
