import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
    financialGoalSchema,
    type FinancialGoalFormValues,
} from "../validation";

import {
    FINANCIAL_GOAL_CATEGORIES,
} from "../constants";

import type {
    CreateFinancialGoalRequest,
    FinancialGoal,
    UpdateFinancialGoalRequest,
} from "../types";

import { useCurrencies } from "@/modules/currencies/hooks/useCurrencies";

interface FinancialGoalFormProps {
    initialGoal?: FinancialGoal | null;
    onSubmit: (
        values:
            | CreateFinancialGoalRequest
            | UpdateFinancialGoalRequest
    ) => Promise<void>;
    onCancel: () => void;
    submitting?: boolean;
}

export function FinancialGoalForm({
    initialGoal,
    onSubmit,
    onCancel,
    submitting = false,
}: FinancialGoalFormProps) {
    const isEdit = Boolean(initialGoal);

    const {
        currencies,
        loading: currenciesLoading,
    } = useCurrencies();

    const defaultValues = useMemo<FinancialGoalFormValues>(
        () => ({
            name: initialGoal?.name ?? "",
            goalCategory:
                initialGoal?.goalCategory ??
                FINANCIAL_GOAL_CATEGORIES[0]?.value ??
                "",
            goalSubcategory:
                initialGoal?.goalSubcategory ??
                FINANCIAL_GOAL_CATEGORIES[0]?.subcategories[0]?.value ??
                "",
            targetAmount: initialGoal?.targetAmount ?? 0,
            currentAmount: initialGoal?.currentAmount ?? 0,
            currencyId:
                initialGoal?.currencyId ??
                currencies.find((currency) => currency.isDefault)?.id ??
                currencies[0]?.id ??
                "",
            targetDate: initialGoal?.targetDate ?? "",
            priority: initialGoal?.priority ?? 0,
            status: initialGoal?.status ?? "ACTIVE",
            notes: initialGoal?.notes ?? "",
        }),
        [initialGoal, currencies]
    );

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        reset,
        formState: { errors },
    } = useForm<FinancialGoalFormValues>({
        resolver: zodResolver(financialGoalSchema),
        defaultValues,
    });

    const selectedCategory = watch("goalCategory");
    const selectedSubcategory = watch("goalSubcategory");

    const selectedCategoryDefinition =
        FINANCIAL_GOAL_CATEGORIES.find(
            (category) => category.value === selectedCategory
        );

    const subcategories =
        selectedCategoryDefinition?.subcategories ?? [];

    useEffect(() => {
        const exists = subcategories.some(
            (subcategory) =>
                subcategory.value === selectedSubcategory
        );

        if (!exists) {
            setValue(
                "goalSubcategory",
                subcategories[0]?.value ?? "",
                {
                    shouldValidate: true,
                }
            );
        }
    }, [
        selectedCategory,
        selectedSubcategory,
        subcategories,
        setValue,
    ]);

    useEffect(() => {
        reset(defaultValues);
    }, [defaultValues, reset]);

    const submit = async (
        values: FinancialGoalFormValues
    ) => {
        if (initialGoal) {
            await onSubmit({
                id: initialGoal.id,
                ...values,
                goalType: values.goalSubcategory,
                targetDate: values.targetDate || null,
                notes: values.notes?.trim() || undefined,
            });
            return;
        }

        await onSubmit({
            ...values,
            goalType: values.goalSubcategory,
            targetDate: values.targetDate || null,
            notes: values.notes?.trim() || undefined,
        });
    };

    return (
        <form
            onSubmit={handleSubmit(submit)}
            className="space-y-6"
        >
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">

                <div className="md:col-span-2">
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Goal Name
                    </label>

                    <input
                        {...register("name")}
                        placeholder="e.g. Emergency Fund"
                        className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />

                    {errors.name && (
                        <p className="mt-1 text-xs text-red-500">
                            {errors.name.message}
                        </p>
                    )}
                </div>

                <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Category
                    </label>

                    <select
                        {...register("goalCategory")}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    >
                        {FINANCIAL_GOAL_CATEGORIES.map(
                            (category) => (
                                <option
                                    key={category.value}
                                    value={category.value}
                                >
                                    {category.label}
                                </option>
                            )
                        )}
                    </select>

                    {errors.goalCategory && (
                        <p className="mt-1 text-xs text-red-500">
                            {errors.goalCategory.message}
                        </p>
                    )}
                </div>

                <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Subcategory
                    </label>

                    <select
                        {...register("goalSubcategory")}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    >
                        {subcategories.map(
                            (subcategory) => (
                                <option
                                    key={subcategory.value}
                                    value={subcategory.value}
                                >
                                    {subcategory.label}
                                </option>
                            )
                        )}
                    </select>

                    {errors.goalSubcategory && (
                        <p className="mt-1 text-xs text-red-500">
                            {errors.goalSubcategory.message}
                        </p>
                    )}
                </div>

                <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Currency
                    </label>

                    <select
                        {...register("currencyId")}
                        disabled={currenciesLoading}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
                    >
                        <option value="">
                            Select currency
                        </option>

                        {currencies.map((currency) => (
                            <option
                                key={currency.id}
                                value={currency.id}
                            >
                                {currency.code} - {currency.name}
                            </option>
                        ))}
                    </select>

                    {errors.currencyId && (
                        <p className="mt-1 text-xs text-red-500">
                            {errors.currencyId.message}
                        </p>
                    )}
                </div>

                <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Target Amount
                    </label>

                    <input
                        type="number"
                        min="0"
                        step="0.01"
                        {...register("targetAmount", {
                            valueAsNumber: true,
                        })}
                        className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />

                    {errors.targetAmount && (
                        <p className="mt-1 text-xs text-red-500">
                            {errors.targetAmount.message}
                        </p>
                    )}
                </div>

                <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Current Amount
                    </label>

                    <input
                        type="number"
                        min="0"
                        step="0.01"
                        {...register("currentAmount", {
                            valueAsNumber: true,
                        })}
                        className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />

                    {errors.currentAmount && (
                        <p className="mt-1 text-xs text-red-500">
                            {errors.currentAmount.message}
                        </p>
                    )}
                </div>

                <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Target Date
                    </label>

                    <input
                        type="date"
                        {...register("targetDate")}
                        className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />

                    {errors.targetDate && (
                        <p className="mt-1 text-xs text-red-500">
                            {errors.targetDate.message}
                        </p>
                    )}
                </div>

                <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Priority
                    </label>

                    <input
                        type="number"
                        min="0"
                        max="10"
                        step="1"
                        {...register("priority", {
                            valueAsNumber: true,
                        })}
                        className="h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />

                    {errors.priority && (
                        <p className="mt-1 text-xs text-red-500">
                            {errors.priority.message}
                        </p>
                    )}
                </div>

                <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Status
                    </label>

                    <select
                        {...register("status")}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    >
                        <option value="ACTIVE">
                            Active
                        </option>
                        <option value="COMPLETED">
                            Completed
                        </option>
                        <option value="PAUSED">
                            Paused
                        </option>
                        <option value="CANCELLED">
                            Cancelled
                        </option>
                    </select>
                </div>

                <div className="md:col-span-2">
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Notes
                    </label>

                    <textarea
                        {...register("notes")}
                        rows={4}
                        placeholder="Optional notes about this goal..."
                        className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />

                    {errors.notes && (
                        <p className="mt-1 text-xs text-red-500">
                            {errors.notes.message}
                        </p>
                    )}
                </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-5">
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={submitting}
                    className="h-10 rounded-xl border border-slate-200 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                    Cancel
                </button>

                <button
                    type="submit"
                    disabled={submitting || currenciesLoading}
                    className="h-10 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {submitting
                        ? "Saving..."
                        : isEdit
                            ? "Save Changes"
                            : "Create Goal"}
                </button>
            </div>
        </form>
    );
}


