import { useEffect } from "react";
import {
    useForm,
} from "react-hook-form";

import {
    zodResolver,
} from "@hookform/resolvers/zod";

import {
    financialPlanSchema,
    type FinancialPlanFormValues,
} from "../validation";

import {
    FINANCIAL_PLAN_CATEGORIES,
    getFinancialPlanCategory,
} from "../constants";

import type { Currency } from "@/modules/currencies/types";

export interface FinancialPlanFormProps {
    currencies: Currency[];
    defaultValues?: Partial<FinancialPlanFormValues>;
    loading?: boolean;
    submitLabel?: string;
    onSubmit: (
        values: FinancialPlanFormValues
    ) => Promise<void> | void;
    onCancel?: () => void;
}

export function FinancialPlanForm({
    currencies,
    defaultValues,
    loading = false,
    submitLabel = "Create Plan",
    onSubmit,
    onCancel,
}: FinancialPlanFormProps) {
    const form = useForm<FinancialPlanFormValues>({
        resolver: zodResolver(financialPlanSchema),
        defaultValues: {
            name: "",
            planCategory: "CORE_PERSONAL_FINANCE",
            planSubcategory: "SAVINGS",
            planType: "SAVINGS",
            startDate:
                new Date()
                    .toISOString()
                    .slice(0, 10),
            endDate: "",
            currencyId:
                currencies[0]?.id ?? "",
            targetAmount: null,
            notes: "",
            status: "ACTIVE",
            ...defaultValues,
        },
    });

    const selectedCategory = form.watch("planCategory");

    const categoryDefinition =
        getFinancialPlanCategory(selectedCategory);

    const subcategories =
        categoryDefinition?.subcategories ?? [];

    useEffect(() => {
        const currentSubcategory =
            form.getValues("planSubcategory");

        const valid = subcategories.some(
            subcategory =>
                subcategory.value === currentSubcategory
        );

        if (!valid) {
            const first =
                subcategories[0]?.value ?? "";

            form.setValue(
                "planSubcategory",
                first,
                {
                    shouldValidate: true,
                    shouldDirty: true,
                }
            );

            form.setValue(
                "planType",
                first,
                {
                    shouldValidate: true,
                    shouldDirty: true,
                }
            );
        }
    }, [selectedCategory]);

    function handleCategoryChange(
        event: React.ChangeEvent<HTMLSelectElement>
    ) {
        const categoryValue = event.target.value;

        form.setValue(
            "planCategory",
            categoryValue,
            {
                shouldValidate: true,
                shouldDirty: true,
            }
        );

        const category =
            getFinancialPlanCategory(categoryValue);

        const firstSubcategory =
            category?.subcategories[0]?.value ?? "";

        form.setValue(
            "planSubcategory",
            firstSubcategory,
            {
                shouldValidate: true,
                shouldDirty: true,
            }
        );

        form.setValue(
            "planType",
            firstSubcategory,
            {
                shouldValidate: true,
                shouldDirty: true,
            }
        );
    }

    function handleSubcategoryChange(
        event: React.ChangeEvent<HTMLSelectElement>
    ) {
        const value = event.target.value;

        form.setValue(
            "planSubcategory",
            value,
            {
                shouldValidate: true,
                shouldDirty: true,
            }
        );

        form.setValue(
            "planType",
            value,
            {
                shouldValidate: true,
                shouldDirty: true,
            }
        );
    }

    return (
        <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
        >
            <div className="grid grid-cols-2 gap-5">

                <div className="col-span-2 space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        Plan Name
                    </label>

                    <input
                        {...form.register("name")}
                        placeholder="e.g. 2027 Financial Plan"
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
                        Plan Category
                    </label>

                    <select
                        value={selectedCategory}
                        onChange={handleCategoryChange}
                        disabled={loading}
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
                    >
                        {FINANCIAL_PLAN_CATEGORIES.map(
                            category => (
                                <option
                                    key={category.value}
                                    value={category.value}
                                >
                                    {category.label}
                                </option>
                            )
                        )}
                    </select>

                    {form.formState.errors.planCategory && (
                        <p className="text-xs text-red-500">
                            {
                                form.formState.errors
                                    .planCategory.message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        Plan Type
                    </label>

                    <select
                        value={
                            form.watch(
                                "planSubcategory"
                            )
                        }
                        onChange={handleSubcategoryChange}
                        disabled={
                            loading ||
                            subcategories.length === 0
                        }
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
                    >
                        {subcategories.map(
                            subcategory => (
                                <option
                                    key={
                                        subcategory.value
                                    }
                                    value={
                                        subcategory.value
                                    }
                                >
                                    {subcategory.label}
                                </option>
                            )
                        )}
                    </select>

                    {form.formState.errors.planSubcategory && (
                        <p className="text-xs text-red-500">
                            {
                                form.formState.errors
                                    .planSubcategory
                                    .message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        Status
                    </label>

                    <select
                        {...form.register("status")}
                        disabled={loading}
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
                    >
                        <option value="ACTIVE">
                            Active
                        </option>
                        <option value="COMPLETED">
                            Completed
                        </option>
                        <option value="ARCHIVED">
                            Archived
                        </option>
                    </select>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        Start Date
                    </label>

                    <input
                        type="date"
                        {...form.register("startDate")}
                        disabled={loading}
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
                    />
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        End Date
                    </label>

                    <input
                        type="date"
                        {...form.register("endDate")}
                        disabled={loading}
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
                    />
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        Currency
                    </label>

                    <select
                        {...form.register("currencyId")}
                        disabled={loading}
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
                                    ? ` — ${currency.name}`
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
                        Target Amount
                    </label>

                    <input
                        type="number"
                        min="0"
                        step="0.01"
                        {...form.register(
                            "targetAmount",
                            {
                                setValueAs: value =>
                                    value === ""
                                        ? null
                                        : Number(value),
                            }
                        )}
                        disabled={loading}
                        placeholder="Optional"
                        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
                    />
                </div>

                <div className="col-span-2 space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                        Notes
                    </label>

                    <textarea
                        {...form.register("notes")}
                        rows={3}
                        disabled={loading}
                        placeholder="Optional notes"
                        className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-500 disabled:opacity-50"
                    />
                </div>
            </div>

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
                    disabled={loading}
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
