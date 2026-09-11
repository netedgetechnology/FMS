import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
    financialPlanSchema,
    type FinancialPlanFormValues,
} from "../validation";

import {
    FINANCIAL_PLAN_CATEGORIES,
    getFinancialPlanCategory,
    PLAN_PERIOD_TYPES,
    PLAN_PERIOD_TYPE_LABELS,
    PLAN_TYPES,
    PLAN_TYPE_DESCRIPTIONS,
    PLAN_TYPE_LABELS,
    isPerPeriodTarget,
    planTypeRequiresTarget,
} from "../constants";

import { findComponentsIncompatibleWithPlanType } from "../services";
import { getPlanComponentComboLabel } from "../constants";

import type {
    FinancialPlanComponent,
    PlanType,
} from "../types";

import { useFinancialGoals } from "@/modules/financial-goals/hooks";
import type { Currency } from "@/modules/currencies/types";

export interface FinancialPlanFormProps {
    currencies: Currency[];
    defaultValues?: Partial<FinancialPlanFormValues>;
    loading?: boolean;
    submitLabel?: string;
    /**
     * The editing plan's non-deleted components. Used only to warn (not
     * block) before a plan_type change that Phase 4 would reject. Omit
     * for the Add flow.
     */
    existingComponents?: readonly FinancialPlanComponent[];
    onSubmit: (
        values: FinancialPlanFormValues
    ) => Promise<void> | void;
    onCancel?: () => void;
}

const FIELD_CLASS =
    "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50";

const LABEL_CLASS =
    "text-sm font-medium text-slate-700";

const ERROR_CLASS = "text-xs text-red-500";

export function FinancialPlanForm({
    currencies,
    defaultValues,
    loading = false,
    submitLabel = "Create Plan",
    existingComponents,
    onSubmit,
    onCancel,
}: FinancialPlanFormProps) {
    const { goals } = useFinancialGoals();

    const form = useForm<FinancialPlanFormValues>({
        resolver: zodResolver(financialPlanSchema),
        defaultValues: {
            name: "",
            planType: "ACCUMULATION",
            planCategory: "CORE_PERSONAL_FINANCE",
            planSubcategory: "SAVINGS",
            periodType: "MONTHLY",
            startDate: new Date()
                .toISOString()
                .slice(0, 10),
            endDate: "",
            currencyId: currencies[0]?.id ?? "",
            targetAmount: null,
            goalId: "",
            notes: "",
            status: "ACTIVE",
            ...defaultValues,
        },
    });

    const selectedCategory = form.watch("planCategory");
    const selectedPlanType = form.watch("planType");
    const selectedPeriodType = form.watch("periodType");
    const selectedCurrencyId = form.watch("currencyId");

    // Phase 6: warn (never block) when the chosen plan type would orphan
    // an existing component - the service still hard-blocks on submit.
    const incompatibleComponents =
        existingComponents && existingComponents.length > 0
            ? findComponentsIncompatibleWithPlanType(
                  selectedPlanType as PlanType,
                  existingComponents
              )
            : [];

    const subcategories =
        getFinancialPlanCategory(selectedCategory)
            ?.subcategories ?? [];

    // Keep the focus (subcategory) valid for the selected category.
    useEffect(() => {
        const current = form.getValues("planSubcategory");

        if (
            !subcategories.some(
                sub => sub.value === current
            )
        ) {
            form.setValue(
                "planSubcategory",
                subcategories[0]?.value ?? "",
                {
                    shouldValidate: true,
                    shouldDirty: true,
                }
            );
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCategory]);

    // Only non-deleted goals in the plan's currency can be linked.
    const linkableGoals = goals.filter(
        goal =>
            goal.currencyId === selectedCurrencyId
    );

    // Drop a stale goal link when it no longer matches the currency.
    useEffect(() => {
        const current = form.getValues("goalId");

        if (
            current &&
            !linkableGoals.some(
                goal => goal.id === current
            )
        ) {
            form.setValue("goalId", "", {
                shouldValidate: true,
                shouldDirty: true,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCurrencyId, goals]);

    const targetRequired = planTypeRequiresTarget(
        selectedPlanType as PlanType
    );

    const targetLabel = isPerPeriodTarget(
        selectedPlanType as PlanType
    )
        ? `Per-Period Target${
              targetRequired ? " *" : ""
          }`
        : `Target Amount${
              targetRequired ? " *" : ""
          }`;

    return (
        <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
        >
            <div className="grid grid-cols-2 gap-5">
                <div className="col-span-2 space-y-2">
                    <label className={LABEL_CLASS}>
                        Plan Name
                    </label>

                    <input
                        {...form.register("name")}
                        placeholder="e.g. 2027 Financial Plan"
                        disabled={loading}
                        className={FIELD_CLASS}
                    />

                    {form.formState.errors.name && (
                        <p className={ERROR_CLASS}>
                            {
                                form.formState.errors
                                    .name.message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className={LABEL_CLASS}>
                        Plan Type
                    </label>

                    <select
                        {...form.register("planType")}
                        disabled={loading}
                        className={FIELD_CLASS}
                    >
                        {PLAN_TYPES.map(planType => (
                            <option
                                key={planType}
                                value={planType}
                            >
                                {
                                    PLAN_TYPE_LABELS[
                                        planType
                                    ]
                                }
                            </option>
                        ))}
                    </select>

                    <p className="text-xs text-slate-400">
                        {
                            PLAN_TYPE_DESCRIPTIONS[
                                selectedPlanType as PlanType
                            ]
                        }
                    </p>

                    {incompatibleComponents.length >
                        0 && (
                        <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-700">
                            {incompatibleComponents.length}{" "}
                            existing component
                            {incompatibleComponents.length ===
                            1
                                ? " is"
                                : "s are"}{" "}
                            not valid for a{" "}
                            {
                                PLAN_TYPE_LABELS[
                                    selectedPlanType as PlanType
                                ]
                            }{" "}
                            plan:{" "}
                            {incompatibleComponents
                                .map(
                                    component =>
                                        component.label?.trim() ||
                                        getPlanComponentComboLabel(
                                            component.componentType,
                                            component.role
                                        )
                                )
                                .join(", ")}
                            . Remove or delete{" "}
                            {incompatibleComponents.length ===
                            1
                                ? "it"
                                : "them"}{" "}
                            first — saving will be
                            blocked otherwise.
                        </p>
                    )}

                    {form.formState.errors.planType && (
                        <p className={ERROR_CLASS}>
                            {
                                form.formState.errors
                                    .planType.message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className={LABEL_CLASS}>
                        Review Period
                    </label>

                    <select
                        {...form.register(
                            "periodType"
                        )}
                        disabled={loading}
                        className={FIELD_CLASS}
                    >
                        {PLAN_PERIOD_TYPES.map(
                            periodType => (
                                <option
                                    key={periodType}
                                    value={periodType}
                                >
                                    {
                                        PLAN_PERIOD_TYPE_LABELS[
                                            periodType
                                        ]
                                    }
                                </option>
                            )
                        )}
                    </select>

                    {selectedPeriodType ===
                        "ONE_TIME" && (
                        <p className="text-xs text-slate-400">
                            A one-time plan needs an end
                            date.
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className={LABEL_CLASS}>
                        Category
                    </label>

                    <select
                        {...form.register(
                            "planCategory"
                        )}
                        disabled={loading}
                        className={FIELD_CLASS}
                    >
                        {FINANCIAL_PLAN_CATEGORIES.map(
                            category => (
                                <option
                                    key={
                                        category.value
                                    }
                                    value={
                                        category.value
                                    }
                                >
                                    {category.label}
                                </option>
                            )
                        )}
                    </select>

                    {form.formState.errors
                        .planCategory && (
                        <p className={ERROR_CLASS}>
                            {
                                form.formState.errors
                                    .planCategory
                                    .message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className={LABEL_CLASS}>
                        Focus
                    </label>

                    <select
                        {...form.register(
                            "planSubcategory"
                        )}
                        disabled={
                            loading ||
                            subcategories.length === 0
                        }
                        className={FIELD_CLASS}
                    >
                        {subcategories.map(sub => (
                            <option
                                key={sub.value}
                                value={sub.value}
                            >
                                {sub.label}
                            </option>
                        ))}
                    </select>

                    {form.formState.errors
                        .planSubcategory && (
                        <p className={ERROR_CLASS}>
                            {
                                form.formState.errors
                                    .planSubcategory
                                    .message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className={LABEL_CLASS}>
                        Status
                    </label>

                    <select
                        {...form.register("status")}
                        disabled={loading}
                        className={FIELD_CLASS}
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
                    <label className={LABEL_CLASS}>
                        Currency
                    </label>

                    <select
                        {...form.register(
                            "currencyId"
                        )}
                        disabled={loading}
                        className={FIELD_CLASS}
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

                    {form.formState.errors
                        .currencyId && (
                        <p className={ERROR_CLASS}>
                            {
                                form.formState.errors
                                    .currencyId.message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className={LABEL_CLASS}>
                        Start Date
                    </label>

                    <input
                        type="date"
                        {...form.register("startDate")}
                        disabled={loading}
                        className={FIELD_CLASS}
                    />

                    {form.formState.errors
                        .startDate && (
                        <p className={ERROR_CLASS}>
                            {
                                form.formState.errors
                                    .startDate.message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className={LABEL_CLASS}>
                        End Date
                        {selectedPeriodType ===
                        "ONE_TIME"
                            ? " *"
                            : ""}
                    </label>

                    <input
                        type="date"
                        {...form.register("endDate")}
                        disabled={loading}
                        className={FIELD_CLASS}
                    />

                    {form.formState.errors.endDate && (
                        <p className={ERROR_CLASS}>
                            {
                                form.formState.errors
                                    .endDate.message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className={LABEL_CLASS}>
                        {targetLabel}
                    </label>

                    <input
                        type="number"
                        min="0"
                        step="0.01"
                        {...form.register(
                            "targetAmount",
                            {
                                setValueAs: value =>
                                    value === "" ||
                                    value === null
                                        ? null
                                        : Number(value),
                            }
                        )}
                        disabled={loading}
                        placeholder={
                            targetRequired
                                ? "Required"
                                : "Optional"
                        }
                        className={FIELD_CLASS}
                    />

                    {form.formState.errors
                        .targetAmount && (
                        <p className={ERROR_CLASS}>
                            {
                                form.formState.errors
                                    .targetAmount
                                    .message
                            }
                        </p>
                    )}
                </div>

                <div className="space-y-2">
                    <label className={LABEL_CLASS}>
                        Linked Goal
                    </label>

                    <select
                        {...form.register("goalId")}
                        disabled={loading}
                        className={FIELD_CLASS}
                    >
                        <option value="">
                            None
                        </option>

                        {linkableGoals.map(goal => (
                            <option
                                key={goal.id}
                                value={goal.id}
                            >
                                {goal.name}
                            </option>
                        ))}
                    </select>

                    <p className="text-xs text-slate-400">
                        Optional. Only goals in the
                        plan&apos;s currency can be
                        linked.
                    </p>

                    {form.formState.errors.goalId && (
                        <p className={ERROR_CLASS}>
                            {
                                form.formState.errors
                                    .goalId.message
                            }
                        </p>
                    )}
                </div>

                <div className="col-span-2 space-y-2">
                    <label className={LABEL_CLASS}>
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
