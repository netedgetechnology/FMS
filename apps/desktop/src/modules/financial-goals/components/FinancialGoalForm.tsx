import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
    financialGoalSchema,
    type FinancialGoalFormValues,
} from "../validation";

import {
    FINANCIAL_GOAL_CATEGORIES,
    isGoalEligibleAccountType,
    isGoalEligibleCategoryType,
    isGoalEligibleLoanStatus,
    isGoalEligibleInvestmentStatus,
    roleForGoalMode,
} from "../constants";

import type {
    CreateFinancialGoalRequest,
    FinancialGoal,
    UpdateFinancialGoalRequest,
} from "../types";

import { useCurrencies } from "@/modules/currencies/hooks/useCurrencies";
import { useAccounts } from "@/modules/accounts/hooks";
import { useCategories } from "@/modules/categories/hooks";
import { useLoans } from "@/modules/loans/hooks";
import { useInvestments } from "@/modules/investments/hooks";

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

    const { accounts, loading: accountsLoading } =
        useAccounts();

    const {
        categories,
        loading: categoriesLoading,
    } = useCategories();

    const { loans, loading: loansLoading } =
        useLoans();

    const {
        investments,
        loading: investmentsLoading,
    } = useInvestments();

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
            goalMode:
                initialGoal?.goalMode ?? "MANUAL",
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
            accountIds: [],
            categoryIds: [],
            loanIds: [],
            investmentIds: [],
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
    const goalMode = watch("goalMode");
    const selectedCurrencyId = watch("currencyId");
    const selectedAccountIds =
        watch("accountIds") ?? [];
    const selectedCategoryIds =
        watch("categoryIds") ?? [];
    const selectedLoanIds =
        watch("loanIds") ?? [];
    const selectedInvestmentIds =
        watch("investmentIds") ?? [];

    const isCategoryMode =
        goalMode === "CATEGORY_CONTRIBUTION_LINKED";
    const isLoanMode =
        goalMode === "LOAN_PAYOFF_LINKED";
    const isInvestmentMode =
        goalMode === "INVESTMENT_LINKED";

    const selectedCategoryDefinition =
        FINANCIAL_GOAL_CATEGORIES.find(
            (category) => category.value === selectedCategory
        );

    const subcategories =
        selectedCategoryDefinition?.subcategories ?? [];

    const linkedRole = roleForGoalMode(goalMode);

    const eligibleAccounts = useMemo(
        () =>
            linkedRole
                ? accounts.filter(
                      (account) =>
                          isGoalEligibleAccountType(
                              account.type,
                              linkedRole
                          ) &&
                          account.isActive &&
                          account.currencyId ===
                              selectedCurrencyId
                  )
                : [],
        [accounts, selectedCurrencyId, linkedRole]
    );

    const eligibleIncomeCategories = useMemo(
        () =>
            isCategoryMode
                ? categories.filter(
                      (category) =>
                          isGoalEligibleCategoryType(
                              category.categoryType
                          ) && category.isActive
                  )
                : [],
        [categories, isCategoryMode]
    );

    const eligibleLoans = useMemo(
        () =>
            isLoanMode
                ? loans.filter(
                      (loan) =>
                          isGoalEligibleLoanStatus(
                              loan.status
                          ) &&
                          loan.currencyId ===
                              selectedCurrencyId
                  )
                : [],
        [loans, isLoanMode, selectedCurrencyId]
    );

    const eligibleInvestments = useMemo(
        () =>
            isInvestmentMode
                ? investments.filter(
                      (investment) =>
                          isGoalEligibleInvestmentStatus(
                              investment.status
                          ) &&
                          investment.currencyId ===
                              selectedCurrencyId
                  )
                : [],
        [
            investments,
            isInvestmentMode,
            selectedCurrencyId,
        ]
    );

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

    // Drop any selected account that's no longer eligible (currency
    // changed, or the account list refreshed).
    useEffect(() => {
        const eligibleIds = new Set(
            eligibleAccounts.map(
                (account) => account.id
            )
        );

        const filtered = selectedAccountIds.filter(
            (id) => eligibleIds.has(id)
        );

        if (
            filtered.length !==
            selectedAccountIds.length
        ) {
            setValue("accountIds", filtered, {
                shouldValidate: true,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eligibleAccounts]);

    // Drop any selected category that's no longer eligible (deactivated,
    // or the category list refreshed).
    useEffect(() => {
        const eligibleIds = new Set(
            eligibleIncomeCategories.map(
                (category) => category.id
            )
        );

        const filtered = selectedCategoryIds.filter(
            (id) => eligibleIds.has(id)
        );

        if (
            filtered.length !==
            selectedCategoryIds.length
        ) {
            setValue("categoryIds", filtered, {
                shouldValidate: true,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eligibleIncomeCategories]);

    // Drop any selected loan that's no longer eligible (currency
    // changed, status changed, or the loan list refreshed).
    useEffect(() => {
        const eligibleIds = new Set(
            eligibleLoans.map((loan) => loan.id)
        );

        const filtered = selectedLoanIds.filter((id) =>
            eligibleIds.has(id)
        );

        if (
            filtered.length !== selectedLoanIds.length
        ) {
            setValue("loanIds", filtered, {
                shouldValidate: true,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eligibleLoans]);

    // Drop any selected investment that's no longer eligible (currency
    // changed, status changed, or the investment list refreshed).
    useEffect(() => {
        const eligibleIds = new Set(
            eligibleInvestments.map(
                (investment) => investment.id
            )
        );

        const filtered = selectedInvestmentIds.filter(
            (id) => eligibleIds.has(id)
        );

        if (
            filtered.length !==
            selectedInvestmentIds.length
        ) {
            setValue("investmentIds", filtered, {
                shouldValidate: true,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eligibleInvestments]);

    useEffect(() => {
        reset(defaultValues);
    }, [defaultValues, reset]);

    function toggleAccount(accountId: string) {
        const next = selectedAccountIds.includes(
            accountId
        )
            ? selectedAccountIds.filter(
                  (id) => id !== accountId
              )
            : [...selectedAccountIds, accountId];

        setValue("accountIds", next, {
            shouldValidate: true,
        });
    }

    function toggleCategory(categoryId: string) {
        const next = selectedCategoryIds.includes(
            categoryId
        )
            ? selectedCategoryIds.filter(
                  (id) => id !== categoryId
              )
            : [...selectedCategoryIds, categoryId];

        setValue("categoryIds", next, {
            shouldValidate: true,
        });
    }

    function toggleLoan(loanId: string) {
        const next = selectedLoanIds.includes(loanId)
            ? selectedLoanIds.filter(
                  (id) => id !== loanId
              )
            : [...selectedLoanIds, loanId];

        setValue("loanIds", next, {
            shouldValidate: true,
        });
    }

    function toggleInvestment(investmentId: string) {
        const next = selectedInvestmentIds.includes(
            investmentId
        )
            ? selectedInvestmentIds.filter(
                  (id) => id !== investmentId
              )
            : [
                  ...selectedInvestmentIds,
                  investmentId,
              ];

        setValue("investmentIds", next, {
            shouldValidate: true,
        });
    }

    const submit = async (
        values: FinancialGoalFormValues
    ) => {
        const isAccountLinked =
            roleForGoalMode(values.goalMode) !== null;
        const isCategoryLinked =
            values.goalMode ===
            "CATEGORY_CONTRIBUTION_LINKED";
        const isLoanLinked =
            values.goalMode === "LOAN_PAYOFF_LINKED";
        const isInvestmentLinked =
            values.goalMode === "INVESTMENT_LINKED";

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
            accountIds: isAccountLinked
                ? values.accountIds
                : undefined,
            categoryIds: isCategoryLinked
                ? values.categoryIds
                : undefined,
            loanIds: isLoanLinked
                ? values.loanIds
                : undefined,
            investmentIds: isInvestmentLinked
                ? values.investmentIds
                : undefined,
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

                <div className="md:col-span-2">
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                        Goal Mode
                    </label>

                    <div className="flex gap-2">
                        <label
                            className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm transition ${
                                goalMode === "MANUAL"
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-slate-200 text-slate-600"
                            } ${isEdit ? "cursor-not-allowed opacity-60" : ""}`}
                        >
                            <input
                                type="radio"
                                value="MANUAL"
                                disabled={isEdit}
                                {...register("goalMode")}
                                className="sr-only"
                            />
                            Manual entry
                        </label>

                        <label
                            className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm transition ${
                                goalMode ===
                                "ACCOUNT_LINKED"
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-slate-200 text-slate-600"
                            } ${isEdit ? "cursor-not-allowed opacity-60" : ""}`}
                        >
                            <input
                                type="radio"
                                value="ACCOUNT_LINKED"
                                disabled={isEdit}
                                {...register("goalMode")}
                                className="sr-only"
                            />
                            Account-linked
                        </label>

                        <label
                            className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm transition ${
                                goalMode ===
                                "DEBT_PAYOFF_LINKED"
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-slate-200 text-slate-600"
                            } ${isEdit ? "cursor-not-allowed opacity-60" : ""}`}
                        >
                            <input
                                type="radio"
                                value="DEBT_PAYOFF_LINKED"
                                disabled={isEdit}
                                {...register("goalMode")}
                                className="sr-only"
                            />
                            Debt payoff
                        </label>

                        <label
                            className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm transition ${
                                goalMode ===
                                "CATEGORY_CONTRIBUTION_LINKED"
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-slate-200 text-slate-600"
                            } ${isEdit ? "cursor-not-allowed opacity-60" : ""}`}
                        >
                            <input
                                type="radio"
                                value="CATEGORY_CONTRIBUTION_LINKED"
                                disabled={isEdit}
                                {...register("goalMode")}
                                className="sr-only"
                            />
                            Category-linked
                        </label>

                        <label
                            className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm transition ${
                                goalMode ===
                                "LOAN_PAYOFF_LINKED"
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-slate-200 text-slate-600"
                            } ${isEdit ? "cursor-not-allowed opacity-60" : ""}`}
                        >
                            <input
                                type="radio"
                                value="LOAN_PAYOFF_LINKED"
                                disabled={isEdit}
                                {...register("goalMode")}
                                className="sr-only"
                            />
                            Loan payoff
                        </label>

                        <label
                            className={`flex flex-1 cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm transition ${
                                goalMode ===
                                "INVESTMENT_LINKED"
                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                    : "border-slate-200 text-slate-600"
                            } ${isEdit ? "cursor-not-allowed opacity-60" : ""}`}
                        >
                            <input
                                type="radio"
                                value="INVESTMENT_LINKED"
                                disabled={isEdit}
                                {...register("goalMode")}
                                className="sr-only"
                            />
                            Investment-linked
                        </label>
                    </div>

                    <p className="mt-1.5 text-xs text-slate-400">
                        {isEdit
                            ? "Goal mode can't be changed after creation."
                            : goalMode ===
                                "ACCOUNT_LINKED"
                              ? "Current amount and progress will be calculated automatically from the accounts you select below."
                              : goalMode ===
                                  "DEBT_PAYOFF_LINKED"
                                ? "Outstanding debt and payoff progress will be calculated automatically from the accounts you select below."
                                : goalMode ===
                                    "CATEGORY_CONTRIBUTION_LINKED"
                                  ? "Current amount will be calculated automatically from income transactions in the categories you select below."
                                  : goalMode ===
                                      "LOAN_PAYOFF_LINKED"
                                    ? "Outstanding debt and payoff progress will be calculated automatically from the loans you select below."
                                    : goalMode ===
                                        "INVESTMENT_LINKED"
                                      ? "Current amount will be calculated automatically from the current value of the investments you select below."
                                      : "You'll update the current amount yourself as things change."}
                    </p>
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

                {linkedRole ||
                isCategoryMode ||
                isLoanMode ||
                isInvestmentMode ? (
                    <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700">
                            Current Amount
                        </label>

                        <div className="flex h-11 w-full items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 text-sm text-slate-400">
                            {isCategoryMode
                                ? "Auto-calculated from linked categories"
                                : isLoanMode
                                  ? "Auto-calculated from linked loans"
                                  : isInvestmentMode
                                    ? "Auto-calculated from linked investments"
                                    : "Auto-calculated from linked accounts"}
                        </div>
                    </div>
                ) : (
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
                )}

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

                {linkedRole &&
                    !isEdit && (
                        <div className="md:col-span-2">
                            <label className="mb-2 block text-sm font-semibold text-slate-700">
                                Linked Accounts
                            </label>

                            {accountsLoading ? (
                                <p className="text-sm text-slate-400">
                                    Loading accounts...
                                </p>
                            ) : eligibleAccounts.length ===
                              0 ? (
                                <p className="text-sm text-slate-400">
                                    {linkedRole ===
                                    "LIABILITY"
                                        ? "No eligible credit card accounts in this currency."
                                        : "No eligible asset accounts in this currency. Only active cash, savings, current or wallet accounts can be linked."}
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
                                    {eligibleAccounts.map(
                                        (account) => (
                                            <label
                                                key={
                                                    account.id
                                                }
                                                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedAccountIds.includes(
                                                        account.id
                                                    )}
                                                    onChange={() =>
                                                        toggleAccount(
                                                            account.id
                                                        )
                                                    }
                                                    className="h-4 w-4 rounded border-slate-300"
                                                />
                                                {
                                                    account.name
                                                }
                                                <span className="text-xs text-slate-400">
                                                    (
                                                    {
                                                        account.type
                                                    }
                                                    )
                                                </span>
                                            </label>
                                        )
                                    )}
                                </div>
                            )}

                            {errors.accountIds && (
                                <p className="mt-1 text-xs text-red-500">
                                    {
                                        errors.accountIds
                                            .message
                                    }
                                </p>
                            )}
                        </div>
                    )}

                {linkedRole &&
                    isEdit && (
                        <div className="md:col-span-2">
                            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                                Linked accounts are
                                managed separately - use
                                "Manage Accounts" from the
                                goals table.
                            </p>
                        </div>
                    )}

                {isCategoryMode &&
                    !isEdit && (
                        <div className="md:col-span-2">
                            <label className="mb-2 block text-sm font-semibold text-slate-700">
                                Linked Categories
                            </label>

                            {categoriesLoading ? (
                                <p className="text-sm text-slate-400">
                                    Loading categories...
                                </p>
                            ) : eligibleIncomeCategories.length ===
                              0 ? (
                                <p className="text-sm text-slate-400">
                                    No active income
                                    categories available.
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
                                    {eligibleIncomeCategories.map(
                                        (category) => (
                                            <label
                                                key={
                                                    category.id
                                                }
                                                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedCategoryIds.includes(
                                                        category.id
                                                    )}
                                                    onChange={() =>
                                                        toggleCategory(
                                                            category.id
                                                        )
                                                    }
                                                    className="h-4 w-4 rounded border-slate-300"
                                                />
                                                {
                                                    category.name
                                                }
                                            </label>
                                        )
                                    )}
                                </div>
                            )}

                            {errors.categoryIds && (
                                <p className="mt-1 text-xs text-red-500">
                                    {
                                        errors.categoryIds
                                            .message
                                    }
                                </p>
                            )}
                        </div>
                    )}

                {isCategoryMode &&
                    isEdit && (
                        <div className="md:col-span-2">
                            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                                Linked categories are
                                managed separately - use
                                "Manage Categories" from
                                the goals table.
                            </p>
                        </div>
                    )}

                {isLoanMode &&
                    !isEdit && (
                        <div className="md:col-span-2">
                            <label className="mb-2 block text-sm font-semibold text-slate-700">
                                Linked Loans
                            </label>

                            {loansLoading ? (
                                <p className="text-sm text-slate-400">
                                    Loading loans...
                                </p>
                            ) : eligibleLoans.length ===
                              0 ? (
                                <p className="text-sm text-slate-400">
                                    No eligible active
                                    loans in this
                                    currency.
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
                                    {eligibleLoans.map(
                                        (loan) => (
                                            <label
                                                key={
                                                    loan.id
                                                }
                                                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedLoanIds.includes(
                                                        loan.id
                                                    )}
                                                    onChange={() =>
                                                        toggleLoan(
                                                            loan.id
                                                        )
                                                    }
                                                    className="h-4 w-4 rounded border-slate-300"
                                                />
                                                {
                                                    loan.name
                                                }
                                            </label>
                                        )
                                    )}
                                </div>
                            )}

                            {errors.loanIds && (
                                <p className="mt-1 text-xs text-red-500">
                                    {
                                        errors.loanIds
                                            .message
                                    }
                                </p>
                            )}
                        </div>
                    )}

                {isLoanMode &&
                    isEdit && (
                        <div className="md:col-span-2">
                            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                                Linked loans are managed
                                separately - use "Manage
                                Loans" from the goals
                                table.
                            </p>
                        </div>
                    )}

                {isInvestmentMode &&
                    !isEdit && (
                        <div className="md:col-span-2">
                            <label className="mb-2 block text-sm font-semibold text-slate-700">
                                Linked Investments
                            </label>

                            {investmentsLoading ? (
                                <p className="text-sm text-slate-400">
                                    Loading
                                    investments...
                                </p>
                            ) : eligibleInvestments.length ===
                              0 ? (
                                <p className="text-sm text-slate-400">
                                    No eligible active
                                    investments in this
                                    currency.
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
                                    {eligibleInvestments.map(
                                        (investment) => (
                                            <label
                                                key={
                                                    investment.id
                                                }
                                                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedInvestmentIds.includes(
                                                        investment.id
                                                    )}
                                                    onChange={() =>
                                                        toggleInvestment(
                                                            investment.id
                                                        )
                                                    }
                                                    className="h-4 w-4 rounded border-slate-300"
                                                />
                                                {
                                                    investment.name
                                                }
                                            </label>
                                        )
                                    )}
                                </div>
                            )}

                            {errors.investmentIds && (
                                <p className="mt-1 text-xs text-red-500">
                                    {
                                        errors
                                            .investmentIds
                                            .message
                                    }
                                </p>
                            )}
                        </div>
                    )}

                {isInvestmentMode &&
                    isEdit && (
                        <div className="md:col-span-2">
                            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                                Linked investments are
                                managed separately - use
                                "Manage Investments" from
                                the goals table.
                            </p>
                        </div>
                    )}

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


