import { useEffect, useMemo } from "react";
import {
    useForm,
} from "react-hook-form";

import {
    zodResolver,
} from "@hookform/resolvers/zod";

import {
    budgetSchema,
    type BudgetFormValues,
} from "../validation";

import {
    useCategories,
} from "@/modules/categories/hooks";

import {
    useBusinessEntities,
} from "@/modules/business-entities/hooks";

import {
    useCurrencies,
} from "@/modules/currencies/hooks";

export interface BudgetFormProps {
    defaultValues?: Partial<BudgetFormValues>;
    loading?: boolean;
    submitLabel?: string;
    onSubmit: (
        values: BudgetFormValues
    ) => Promise<void> | void;
    onCancel?: () => void;
}

export function BudgetForm({
    defaultValues,
    loading = false,
    submitLabel = "Create Budget",
    onSubmit,
    onCancel,
}: BudgetFormProps) {
    const {
        categories,
        loading: categoriesLoading,
    } = useCategories();

    const {
        businessEntities,
        loading: businessEntitiesLoading,
    } = useBusinessEntities();

    const {
        currencies,
        loading: currenciesLoading,
    } = useCurrencies();

    const initialValues = useMemo<BudgetFormValues>(
        () => ({
            name: "",
            categoryId: "",
            businessEntityId: "",
            amount: 0,
            periodType: "MONTHLY",
            startDate:
                new Date()
                    .toISOString()
                    .slice(0, 10),
            endDate: "",
            currencyId: "",
            alertThreshold: 80,
            isActive: true,
            ...defaultValues,
        }),
        [defaultValues]
    );

    const form = useForm<BudgetFormValues>({
        resolver: zodResolver(budgetSchema),
        defaultValues: initialValues,
    });

    useEffect(() => {
        form.reset(initialValues);
    }, [form, initialValues]);
useEffect(() => {
        if (
            defaultValues?.categoryId &&
            categories.length > 0 &&
            categories.some(
                category =>
                    String(category.id) ===
                    String(defaultValues.categoryId)
            )
        ) {
            form.setValue(
                "categoryId",
                String(defaultValues.categoryId),
                {
                    shouldDirty: false,
                    shouldValidate: false,
                }
            );
        }

        if (
            defaultValues?.currencyId &&
            currencies.length > 0 &&
            currencies.some(
                currency =>
                    String(currency.id) ===
                    String(defaultValues.currencyId)
            )
        ) {
            form.setValue(
                "currencyId",
                String(defaultValues.currencyId),
                {
                    shouldDirty: false,
                    shouldValidate: false,
                }
            );
        }

        if (
            defaultValues?.businessEntityId &&
            businessEntities.length > 0 &&
            businessEntities.some(
                entity =>
                    String(entity.id) ===
                    String(
                        defaultValues.businessEntityId
                    )
            )
        ) {
            form.setValue(
                "businessEntityId",
                String(
                    defaultValues.businessEntityId
                ),
                {
                    shouldDirty: false,
                    shouldValidate: false,
                }
            );
        }
    }, [
        defaultValues,
        categories,
        currencies,
        businessEntities,
        form,
    ]);
    const periodType =
        form.watch("periodType");

    useEffect(() => {
        if (
            periodType !== "CUSTOM" &&
            form.getValues("endDate")
        ) {
            form.setValue(
                "endDate",
                "",
                {
                    shouldValidate: true,
                }
            );
        }
    }, [periodType, form]);

    useEffect(() => {
        if (
            !form.getValues("currencyId") &&
            currencies.length > 0
        ) {
            form.setValue(
                "currencyId",
                currencies[0].id,
                {
                    shouldValidate: true,
                }
            );
        }
    }, [currencies, form]);

    const relatedDataLoading =
        categoriesLoading ||
        businessEntitiesLoading ||
        currenciesLoading;

    return (
        <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
        >
            <div className="grid grid-cols-2 gap-5">

                <div className="col-span-2 space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        Budget Name
                    </label>

                    <input
                        {...form.register("name")}
                        placeholder="e.g. Monthly Household Expenses"
                        disabled={loading}
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-500 disabled:opacity-50"
                    />

                    {form.formState.errors.name && (
                        <p className="text-xs text-red-500">
                            {
                                form.formState.errors
                                    .name.message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        Category
                    </label>

                    <select
                        {...form.register("categoryId")}
                        disabled={
                            loading ||
                            categoriesLoading
                        }
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
                    >
                        <option value="">
                            All Categories
                        </option>

                        {categories.map(category => (
                            <option
                                key={category.id}
                                value={category.id}
                            >
                                {category.name}
                            </option>
                        ))}
                    </select>

                    {form.formState.errors.categoryId && (
                        <p className="text-xs text-red-500">
                            {
                                form.formState.errors
                                    .categoryId.message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        Business Entity
                    </label>

                    <select
                        {...form.register(
                            "businessEntityId"
                        )}
                        disabled={
                            loading ||
                            businessEntitiesLoading
                        }
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
                    >
                        <option value="">
                            Personal Finance
                        </option>

                        {businessEntities.map(
                            entity => (
                                <option
                                    key={entity.id}
                                    value={entity.id}
                                >
                                    {entity.name}
                                </option>
                            )
                        )}
                    </select>

                    {form.formState.errors.businessEntityId && (
                        <p className="text-xs text-red-500">
                            {
                                form.formState.errors
                                    .businessEntityId
                                    .message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        Budget Amount
                    </label>

                    <input
                        type="number"
                        min="0"
                        step="0.01"
                        {...form.register(
                            "amount",
                            {
                                setValueAs: value =>
                                    value === ""
                                        ? 0
                                        : Number(value),
                            }
                        )}
                        disabled={loading}
                        placeholder="0.00"
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
                    />

                    {form.formState.errors.amount && (
                        <p className="text-xs text-red-500">
                            {
                                form.formState.errors
                                    .amount.message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        Period
                    </label>

                    <select
                        {...form.register(
                            "periodType"
                        )}
                        disabled={loading}
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
                    >
                        <option value="MONTHLY">
                            Monthly
                        </option>
                        <option value="QUARTERLY">
                            Quarterly
                        </option>
                        <option value="YEARLY">
                            Yearly
                        </option>
                        <option value="CUSTOM">
                            Custom
                        </option>
                    </select>

                    {form.formState.errors.periodType && (
                        <p className="text-xs text-red-500">
                            {
                                form.formState.errors
                                    .periodType.message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        Start Date
                    </label>

                    <input
                        type="date"
                        {...form.register(
                            "startDate"
                        )}
                        disabled={loading}
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
                    />

                    {form.formState.errors.startDate && (
                        <p className="text-xs text-red-500">
                            {
                                form.formState.errors
                                    .startDate.message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        End Date
                        {periodType !== "CUSTOM" &&
                            " (Optional)"}
                    </label>

                    <input
                        type="date"
                        {...form.register(
                            "endDate"
                        )}
                        disabled={
                            loading ||
                            periodType !== "CUSTOM"
                        }
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
                    />

                    {form.formState.errors.endDate && (
                        <p className="text-xs text-red-500">
                            {
                                form.formState.errors
                                    .endDate.message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        Currency
                    </label>

                    <select
                        {...form.register(
                            "currencyId"
                        )}
                        disabled={
                            loading ||
                            currenciesLoading
                        }
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
                    >
                        <option value="">
                            Select currency
                        </option>

                        {currencies.map(currency => (
                            <option
                                key={currency.id}
                                value={currency.id}
                            >
                                {currency.code}
                                {currency.name
                                    ? ` - ${currency.name}`
                                    : ""}
                            </option>
                        ))}
                    </select>

                    {form.formState.errors.currencyId && (
                        <p className="text-xs text-red-500">
                            {
                                form.formState.errors
                                    .currencyId.message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        Alert Threshold
                    </label>

                    <div className="relative">
                        <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            {...form.register(
                                "alertThreshold",
                                {
                                    setValueAs:
                                        value =>
                                            value ===
                                            ""
                                                ? 80
                                                : Number(
                                                      value
                                                  ),
                                }
                            )}
                            disabled={loading}
                            className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 pr-9 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
                        />

                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                            %
                        </span>
                    </div>

                    {form.formState.errors.alertThreshold && (
                        <p className="text-xs text-red-500">
                            {
                                form.formState.errors
                                    .alertThreshold
                                    .message
                            }
                        </p>
                    )}

                    <p className="text-xs text-slate-500">
                        Alert when spending reaches this percentage of the budget.
                    </p>
                </div>

                <div className="flex items-center gap-3 pt-7">
                    <input
                        type="checkbox"
                        {...form.register(
                            "isActive"
                        )}
                        disabled={loading}
                        className="h-4 w-4 rounded border-slate-300"
                    />

                    <label className="text-sm font-medium text-slate-700">
                        Active Budget
                    </label>
                </div>
            </div>

            {relatedDataLoading && (
                <p className="text-xs text-slate-500">
                    Loading budget options...
                </p>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={loading}
                        className="h-9 rounded-lg border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                )}

                <button
                    type="submit"
                    disabled={
                        loading ||
                        relatedDataLoading
                    }
                    className="h-9 rounded-lg bg-slate-900 px-5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {loading
                        ? "Saving..."
                        : submitLabel}
                </button>
            </div>
        </form>
    );
}



