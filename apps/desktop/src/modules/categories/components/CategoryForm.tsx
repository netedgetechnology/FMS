import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
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

import { useBusinessEntities } from "@/modules/business-entities";
import { useAccounts } from "@/modules/accounts/hooks";

import {
    CATEGORY_MAPPING_TYPE_OPTIONS,
    CATEGORY_TYPE_OPTIONS,
    MAPPING_TARGET_TYPE_OPTIONS,
    resolveOptionLabel,
} from "../constants";

import {
    CategoryFormInput,
    CategoryFormValues,
    categorySchema,
} from "../validation";

import {
    Category,
    CategoryContextMapping,
    CategoryMappingType,
    FinanceScope,
} from "../types";

import {
    addMappingRow as addMappingRowToList,
    CategoryMappingRowInput,
    EMPTY_CATEGORY_MAPPINGS,
    financeScopeCovers,
    financeScopeIncludes,
    mappingsToRows,
    removeMappingRow as removeMappingRowFromList,
    updateMappingRow as updateMappingRowInList,
    usedTargetIds as usedTargetIdsInList,
} from "../utils";

export type { CategoryMappingRowInput } from "../utils";

export interface CategoryFormProps {
    categories?: Category[];
    mappings?: readonly CategoryContextMapping[];
    /**
     * The category's stored scope - read-only here (scopes are managed
     * only from the Scopes screen). New categories are Personal.
     */
    financeScope?: FinanceScope;
    defaultValues?: Partial<CategoryFormValues>;
    loading?: boolean;
    submitLabel?: string;
    onCancel?(): void;
    onSubmit(
        values: CategoryFormValues,
        mappings: CategoryMappingRowInput[]
    ): void | Promise<void>;
}

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

export function CategoryForm({
    categories = [],
    mappings = EMPTY_CATEGORY_MAPPINGS,
    financeScope = "PERSONAL",
    defaultValues,
    loading = false,
    submitLabel = "Save",
    onCancel,
    onSubmit,
}: CategoryFormProps) {
    const { businessEntities } = useBusinessEntities();
    const { accounts } = useAccounts();

    const [mappingRows, setMappingRows] = useState<CategoryMappingRowInput[]>(
        () => mappingsToRows(mappings)
    );

    useEffect(() => {
        setMappingRows(mappingsToRows(mappings));
    }, [mappings]);

    function addMappingRow() {
        setMappingRows(rows => addMappingRowToList(rows));
    }

    function removeMappingRow(key: string) {
        setMappingRows(rows => removeMappingRowFromList(rows, key));
    }

    function updateMappingRow(
        key: string,
        patch: Partial<CategoryMappingRowInput>
    ) {
        setMappingRows(rows => updateMappingRowInList(rows, key, patch));
    }

    function usedTargetIds(
        targetType: "account" | "businessEntity",
        excludeKey: string
    ): Set<string> {
        return usedTargetIdsInList(mappingRows, targetType, excludeKey);
    }

    const {
        register,
        control,
        handleSubmit,
        watch,
        reset,
        formState: { errors },
    } = useForm<CategoryFormInput, unknown, CategoryFormValues>({
        resolver: zodResolver(categorySchema),
        defaultValues: {
            parentId: "",
            name: "",
            categoryType: "EXPENSE",
            businessEntityId: "",
            description: "",
            isActive: true,
            ...defaultValues,
        },
    });

    const categoryType = watch("categoryType");

    useEffect(() => {
        if (defaultValues) {
            reset({
                parentId: defaultValues.parentId ?? "",
                name: defaultValues.name ?? "",
                categoryType: defaultValues.categoryType ?? "EXPENSE",
                businessEntityId: defaultValues.businessEntityId ?? "",
                description: defaultValues.description ?? "",
                isActive: defaultValues.isActive ?? true,
            });
        }
    }, [defaultValues, reset]);

    // A parent must be available in every scope this category is in
    // (for single-scope categories: the same scope, as before).
    const compatibleParents = categories.filter(category =>
        category.categoryType === categoryType &&
        financeScopeCovers(category.financeScope, financeScope) &&
        category.isActive
    );

    return (
        <form
            className="space-y-5"
            onSubmit={handleSubmit(values =>
                onSubmit(values, mappingRows)
            )}
        >
            <Section title="Basic Information">
                <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                    <FormField
                        label="Category Name"
                        htmlFor="name"
                        required
                        error={errors.name?.message}
                    >
                        <Input
                            id="name"
                            placeholder="e.g. Groceries"
                            {...register("name")}
                        />
                    </FormField>

                    <FormField
                        label="Category Type"
                        htmlFor="categoryType"
                        required
                        error={errors.categoryType?.message}
                    >
                        <Controller
                            control={control}
                            name="categoryType"
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onValueChange={field.onChange}
                                >
                                    <SelectTrigger id="categoryType">
                                        <SelectValue placeholder="Select type" />
                                    </SelectTrigger>

                                    <SelectContent>
                                        {CATEGORY_TYPE_OPTIONS.map(option => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>

                    <FormField
                        label="Parent Category"
                        htmlFor="parentId"
                        error={errors.parentId?.message}
                    >
                        <Controller
                            control={control}
                            name="parentId"
                            render={({ field }) => (
                                <Select
                                    value={field.value || "__none"}
                                    onValueChange={value =>
                                        field.onChange(
                                            value === "__none" ? "" : value
                                        )
                                    }
                                >
                                    <SelectTrigger id="parentId">
                                        <SelectValue placeholder="None">
                                            {/*
                                                Base UI's Select.Value falls back to
                                                stringifying the raw selected VALUE
                                                (e.g. our "__none" sentinel) whenever
                                                these children evaluate to null/undefined
                                                - it does NOT fall back to a SelectItem's
                                                `label` prop (that's only used for
                                                keyboard type-ahead matching) or to the
                                                `placeholder` prop above (that only
                                                applies when nothing is selected at all,
                                                which is never true here since `value` is
                                                always bound to "__none" or a real id).
                                                This must therefore always resolve to a
                                                real string - "None" whenever nothing/the
                                                sentinel is selected - never `undefined`.
                                            */}
                                            {field.value &&
                                            field.value !== "__none"
                                                ? (compatibleParents.find(
                                                      category =>
                                                          category.id === field.value
                                                  )?.name ?? "None")
                                                : "None"}
                                        </SelectValue>
                                    </SelectTrigger>

                                    <SelectContent>
                                        <SelectItem value="__none" label="None">
                                            None
                                        </SelectItem>

                                        {compatibleParents.map(category => (
                                            <SelectItem
                                                key={category.id}
                                                value={category.id}
                                                label={category.name}
                                            >
                                                {category.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>
                </div>
            </Section>

            {financeScopeIncludes(financeScope, "BUSINESS") && (
                <Section title="Business">
                    <FormField
                        label="Business Entity"
                        htmlFor="businessEntityId"
                        error={errors.businessEntityId?.message}
                    >
                        <Controller
                            control={control}
                            name="businessEntityId"
                            render={({ field }) => (
                                <Select
                                    value={field.value || "__none"}
                                    onValueChange={value =>
                                        field.onChange(
                                            value === "__none" ? "" : value
                                        )
                                    }
                                >
                                    <SelectTrigger id="businessEntityId">
                                        <SelectValue placeholder="None">
                                            {/* See the Parent Category SelectValue above for
                                                why this must always resolve to a real string
                                                and never null/undefined. */}
                                            {field.value &&
                                            field.value !== "__none"
                                                ? (businessEntities.find(
                                                      entity =>
                                                          entity.id === field.value
                                                  )?.name ?? "None")
                                                : "None"}
                                        </SelectValue>
                                    </SelectTrigger>

                                    <SelectContent>
                                        <SelectItem value="__none" label="None">
                                            None
                                        </SelectItem>

                                        {businessEntities
                                            .filter(entity => entity.isActive)
                                            .map(entity => (
                                                <SelectItem
                                                    key={entity.id}
                                                    value={entity.id}
                                                    label={entity.name}
                                                >
                                                    {entity.name}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>
                </Section>
            )}

            <Section title="Context Mappings">
                <p className="text-xs leading-5 text-slate-500">
                    Override this category's Income/Expense type for a
                    specific account or business entity - e.g. "Salary" can
                    be an Expense against a business entity but Income
                    against a personal account. Without a mapping, the
                    Category Type above is used as the default.
                </p>

                <div className="space-y-2.5">
                    {mappingRows.map(row => {
                        const excludedIds = usedTargetIds(
                            row.targetType,
                            row.key
                        );

                        const targetOptions =
                            row.targetType === "account"
                                ? accounts.filter(
                                      account =>
                                          account.isActive &&
                                          !excludedIds.has(account.id)
                                  )
                                : businessEntities.filter(
                                      entity =>
                                          entity.isActive &&
                                          !excludedIds.has(entity.id)
                                  );

                        const selectedTargetName =
                            row.targetType === "account"
                                ? accounts.find(
                                      account => account.id === row.targetId
                                  )?.name
                                : businessEntities.find(
                                      entity => entity.id === row.targetId
                                  )?.name;

                        return (
                            <div
                                key={row.key}
                                className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2.5 rounded-lg border border-slate-100 p-2.5"
                            >
                                <FormField
                                    label="Applies To"
                                    htmlFor={`mapping-target-type-${row.key}`}
                                >
                                    <Select
                                        value={row.targetType}
                                        onValueChange={value =>
                                            updateMappingRow(row.key, {
                                                targetType:
                                                    value as CategoryMappingRowInput["targetType"],
                                            })
                                        }
                                    >
                                        <SelectTrigger
                                            id={`mapping-target-type-${row.key}`}
                                        >
                                            <SelectValue>
                                                {resolveOptionLabel(
                                                    MAPPING_TARGET_TYPE_OPTIONS,
                                                    row.targetType
                                                )}
                                            </SelectValue>
                                        </SelectTrigger>

                                        <SelectContent>
                                            {MAPPING_TARGET_TYPE_OPTIONS.map(
                                                option => (
                                                    <SelectItem
                                                        key={option.value}
                                                        value={option.value}
                                                        label={option.label}
                                                    >
                                                        {option.label}
                                                    </SelectItem>
                                                )
                                            )}
                                        </SelectContent>
                                    </Select>
                                </FormField>

                                <FormField
                                    label={resolveOptionLabel(
                                        MAPPING_TARGET_TYPE_OPTIONS,
                                        row.targetType
                                    )}
                                    htmlFor={`mapping-target-${row.key}`}
                                >
                                    <Select
                                        value={row.targetId || "__none"}
                                        onValueChange={value =>
                                            updateMappingRow(row.key, {
                                                targetId:
                                                    !value ||
                                                    value === "__none"
                                                        ? ""
                                                        : value,
                                            })
                                        }
                                    >
                                        <SelectTrigger
                                            id={`mapping-target-${row.key}`}
                                        >
                                            <SelectValue placeholder="None">
                                                {selectedTargetName ?? "None"}
                                            </SelectValue>
                                        </SelectTrigger>

                                        <SelectContent>
                                            <SelectItem
                                                value="__none"
                                                label="None"
                                            >
                                                None
                                            </SelectItem>

                                            {targetOptions.map(option => (
                                                <SelectItem
                                                    key={option.id}
                                                    value={option.id}
                                                    label={option.name}
                                                >
                                                    {option.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </FormField>

                                <FormField
                                    label="Type"
                                    htmlFor={`mapping-type-${row.key}`}
                                >
                                    <Select
                                        value={row.categoryType}
                                        onValueChange={value =>
                                            updateMappingRow(row.key, {
                                                categoryType:
                                                    value as CategoryMappingType,
                                            })
                                        }
                                    >
                                        <SelectTrigger
                                            id={`mapping-type-${row.key}`}
                                        >
                                            <SelectValue>
                                                {resolveOptionLabel(
                                                    CATEGORY_MAPPING_TYPE_OPTIONS,
                                                    row.categoryType
                                                )}
                                            </SelectValue>
                                        </SelectTrigger>

                                        <SelectContent>
                                            {CATEGORY_MAPPING_TYPE_OPTIONS.map(
                                                option => (
                                                    <SelectItem
                                                        key={option.value}
                                                        value={option.value}
                                                        label={option.label}
                                                    >
                                                        {option.label}
                                                    </SelectItem>
                                                )
                                            )}
                                        </SelectContent>
                                    </Select>
                                </FormField>

                                <button
                                    type="button"
                                    onClick={() => removeMappingRow(row.key)}
                                    className="h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                                >
                                    Remove
                                </button>
                            </div>
                        );
                    })}
                </div>

                <button
                    type="button"
                    onClick={addMappingRow}
                    className="h-9 rounded-lg border border-dashed border-slate-300 px-4 text-sm font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50"
                >
                    + Add Mapping
                </button>
            </Section>

            <Section title="Additional Information">
                <FormField
                    label="Description"
                    htmlFor="description"
                    error={errors.description?.message}
                >
                    <Textarea
                        id="description"
                        rows={3}
                        placeholder="Optional notes about this category"
                        {...register("description")}
                    />
                </FormField>

                <FormField label="Status" htmlFor="isActive">
                    <Controller
                        control={control}
                        name="isActive"
                        render={({ field }) => (
                            <div className="flex h-9 items-center gap-6">
                                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                                    <input
                                        type="radio"
                                        name="category-status"
                                        checked={field.value === true}
                                        onChange={() => field.onChange(true)}
                                        className="h-4 w-4 accent-slate-900"
                                    />
                                    Active
                                </label>

                                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                                    <input
                                        type="radio"
                                        name="category-status"
                                        checked={field.value === false}
                                        onChange={() => field.onChange(false)}
                                        className="h-4 w-4 accent-slate-900"
                                    />
                                    Inactive
                                </label>
                            </div>
                        )}
                    />
                </FormField>
            </Section>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={loading}
                        className="h-9 rounded-lg border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="h-9 cursor-pointer rounded-lg bg-slate-900 px-5 text-sm font-medium text-white shadow-sm transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {loading ? "Saving..." : submitLabel}
                </button>
            </div>
        </form>
    );
}




