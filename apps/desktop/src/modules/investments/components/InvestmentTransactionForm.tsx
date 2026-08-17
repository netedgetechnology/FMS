import {
    useEffect,
    useRef,
    useState,
} from "react";
import {
    Controller,
    useForm,
    useWatch,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import { FormField } from "@/components/forms";

import {
    investmentTransactionSchema,
    InvestmentTransactionFormInput,
    InvestmentTransactionFormValues,
} from "../validation";

import {
    InvestmentTransactionType,
} from "../types";

export interface InvestmentTransactionFormProps {
    defaultValues?: Partial<InvestmentTransactionFormValues>;
    loading?: boolean;
    submitLabel?: string;
    onCancel?(): void;
    onSubmit(
        values: InvestmentTransactionFormValues
    ): void | Promise<void>;
}

const TRANSACTION_TYPE_OPTIONS = [
    {
        value: InvestmentTransactionType.BUY,
        label: "Buy",
    },
    {
        value: InvestmentTransactionType.SELL,
        label: "Sell",
    },
    {
        value: InvestmentTransactionType.DIVIDEND,
        label: "Dividend",
    },
    {
        value: InvestmentTransactionType.INTEREST,
        label: "Interest",
    },
    {
        value: InvestmentTransactionType.BONUS,
        label: "Bonus",
    },
];

function Section({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section className="space-y-2.5">
            <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-slate-900">
                    {title}
                </h3>

                <div className="h-px flex-1 bg-slate-100" />
            </div>

            {children}
        </section>
    );
}

function isTradeTransaction(
    type: InvestmentTransactionType
): boolean {
    return (
        type === InvestmentTransactionType.BUY ||
        type === InvestmentTransactionType.SELL
    );
}

export function InvestmentTransactionForm({
    defaultValues,
    loading = false,
    submitLabel = "Save Transaction",
    onCancel,
    onSubmit,
}: InvestmentTransactionFormProps) {
    const [submitError, setSubmitError] =
        useState<string | null>(null);

    const {
        register,
        control,
        handleSubmit,
        setValue,
        formState: { errors },
    } = useForm<
        InvestmentTransactionFormInput,
        unknown,
        InvestmentTransactionFormValues
    >({
        resolver: zodResolver(
            investmentTransactionSchema
        ),

        defaultValues: {
            transactionType:
                InvestmentTransactionType.BUY,

            transactionDate:
                new Date()
                    .toISOString()
                    .slice(0, 10),

            quantity: 0,
            price: 0,
            amount: 0,
            fees: 0,
            taxes: 0,
            referenceNumber: "",
            notes: "",

            ...defaultValues,
        },
    });

    const transactionType = useWatch({
        control,
        name: "transactionType",
    });

    const quantity = useWatch({
        control,
        name: "quantity",
    });

    const price = useWatch({
        control,
        name: "price",
    });

    const isTrade =
        isTradeTransaction(transactionType);

    const previousTransactionTypeRef =
        useRef(transactionType);

    useEffect(() => {
        const previousType =
            previousTransactionTypeRef.current;

        if (previousType === transactionType) {
            return;
        }

        if (
            transactionType ===
            InvestmentTransactionType.BONUS
        ) {
            setValue("price", 0, {
                shouldValidate: true,
            });

            setValue("amount", 0, {
                shouldValidate: true,
            });
        } else if (
            transactionType ===
                InvestmentTransactionType.DIVIDEND ||
            transactionType ===
                InvestmentTransactionType.INTEREST
        ) {
            setValue("quantity", 0, {
                shouldValidate: true,
            });

            setValue("price", 0, {
                shouldValidate: true,
            });
        }

        previousTransactionTypeRef.current =
            transactionType;
    }, [
        transactionType,
        setValue,
    ]);

    useEffect(() => {
        if (!isTrade) {
            return;
        }

        const numericQuantity =
            Number(quantity ?? 0);

        const numericPrice =
            Number(price ?? 0);

        const calculatedAmount =
            Number.isFinite(numericQuantity) &&
            Number.isFinite(numericPrice)
                ? numericQuantity * numericPrice
                : 0;

        setValue(
            "amount",
            calculatedAmount,
            {
                shouldValidate: true,
                shouldDirty: true,
            }
        );
    }, [
        isTrade,
        quantity,
        price,
        setValue,
    ]);

    return (
        <form
            onSubmit={handleSubmit(async (values) => {
                setSubmitError(null);

                try {
                    await onSubmit(values);
                } catch (error) {
                    setSubmitError(
                        error instanceof Error
                            ? error.message
                            : "Failed to save transaction."
                    );
                }
            })}
            className="space-y-6"
        >
            {submitError && (
                <div
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600"
                >
                    {submitError}
                </div>
            )}

            <Section title="Transaction Details">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                        label="Transaction Type"
                        htmlFor="transactionType"
                        error={
                            errors.transactionType?.message
                        }
                    >
                        <Controller
                            name="transactionType"
                            control={control}
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onValueChange={field.onChange}
                                >
                                    <SelectTrigger
                                        id="transactionType"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>

                                    <SelectContent>
                                        {TRANSACTION_TYPE_OPTIONS.map(
                                            (option) => (
                                                <SelectItem
                                                    key={
                                                        option.value
                                                    }
                                                    value={
                                                        option.value
                                                    }
                                                >
                                                    {
                                                        option.label
                                                    }
                                                </SelectItem>
                                            )
                                        )}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>

                    <FormField
                        label="Transaction Date"
                        htmlFor="transactionDate"
                        error={
                            errors.transactionDate?.message
                        }
                    >
                        <Input
                            id="transactionDate"
                            type="date"
                            {...register(
                                "transactionDate"
                            )}
                        />
                    </FormField>
                </div>
            </Section>

            <Section title="Trade Details">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                        label="Quantity"
                        htmlFor="quantity"
                        error={
                            errors.quantity?.message
                        }
                    >
                        <Input
                            id="quantity"
                            type="number"
                            min="0"
                            step="any"
                            {...register("quantity")}
                        />
                    </FormField>

                    <FormField
                        label="Price"
                        htmlFor="price"
                        error={
                            errors.price?.message
                        }
                    >
                        <Input
                            id="price"
                            type="number"
                            min="0"
                            step="any"
                            {...register("price")}
                        />
                    </FormField>

                    <FormField
                        label={
                            isTrade
                                ? "Amount (Quantity × Price)"
                                : "Amount"
                        }
                        htmlFor="amount"
                        error={
                            errors.amount?.message
                        }
                    >
                        <Input
                            id="amount"
                            type="number"
                            min="0"
                            step="any"
                            readOnly={isTrade}
                            className={
                                isTrade
                                    ? "bg-slate-50 text-slate-700"
                                    : undefined
                            }
                            {...register("amount")}
                        />

                        {isTrade && (
                            <p className="mt-1 text-xs text-slate-400">
                                Automatically calculated from quantity × price.
                            </p>
                        )}
                    </FormField>

                    <FormField
                        label="Fees"
                        htmlFor="fees"
                        error={
                            errors.fees?.message
                        }
                    >
                        <Input
                            id="fees"
                            type="number"
                            min="0"
                            step="any"
                            {...register("fees")}
                        />
                    </FormField>

                    <FormField
                        label="Taxes"
                        htmlFor="taxes"
                        error={
                            errors.taxes?.message
                        }
                    >
                        <Input
                            id="taxes"
                            type="number"
                            min="0"
                            step="any"
                            {...register("taxes")}
                        />
                    </FormField>
                </div>
            </Section>

            <Section title="Additional Information">
                <div className="space-y-4">
                    <FormField
                        label="Reference Number"
                        htmlFor="referenceNumber"
                        error={
                            errors.referenceNumber?.message
                        }
                    >
                        <Input
                            id="referenceNumber"
                            placeholder="Optional transaction reference"
                            {...register(
                                "referenceNumber"
                            )}
                        />
                    </FormField>

                    <FormField
                        label="Notes"
                        htmlFor="notes"
                        error={
                            errors.notes?.message
                        }
                    >
                        <Textarea
                            id="notes"
                            rows={3}
                            placeholder="Optional notes"
                            {...register("notes")}
                        />
                    </FormField>
                </div>
            </Section>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                {onCancel && (
                    <button
                        type="button"
                        disabled={loading}
                        onClick={onCancel}
                        className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        Cancel
                    </button>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {loading
                        ? "Saving..."
                        : submitLabel}
                </button>
            </div>
        </form>
    );
}







