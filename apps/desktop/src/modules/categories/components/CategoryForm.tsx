import { useEffect } from "react";
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

import {
    CATEGORY_TYPE_OPTIONS,
    FINANCE_SCOPE_OPTIONS,
} from "../constants";

import {
    CategoryFormInput,
    CategoryFormValues,
    categorySchema,
} from "../validation";

import { Category } from "../types";

export interface CategoryFormProps {
    categories?: Category[];
    defaultValues?: Partial<CategoryFormValues>;
    loading?: boolean;
    submitLabel?: string;
    onCancel?(): void;
    onSubmit(values: CategoryFormValues): void | Promise<void>;
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
    defaultValues,
    loading = false,
    submitLabel = "Save",
    onCancel,
    onSubmit,
}: CategoryFormProps) {
    const { businessEntities } = useBusinessEntities();

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
            financeScope: "PERSONAL",
            businessEntityId: "",
            description: "",
            isActive: true,
            ...defaultValues,
        },
    });

    const categoryType = watch("categoryType");
    const financeScope = watch("financeScope");

    useEffect(() => {
        if (defaultValues) {
            reset({
                parentId: defaultValues.parentId ?? "",
                name: defaultValues.name ?? "",
                categoryType: defaultValues.categoryType ?? "EXPENSE",
                financeScope: defaultValues.financeScope ?? "PERSONAL",
                businessEntityId: defaultValues.businessEntityId ?? "",
                description: defaultValues.description ?? "",
                isActive: defaultValues.isActive ?? true,
            });
        }
    }, [defaultValues, reset]);

    const compatibleParents = categories.filter(category =>
        category.categoryType === categoryType &&
        category.financeScope === financeScope &&
        category.isActive
    );

    return (
        <form
            className="space-y-5"
            onSubmit={handleSubmit(values => onSubmit(values))}
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
                        label="Finance Scope"
                        htmlFor="financeScope"
                        required
                        error={errors.financeScope?.message}
                    >
                        <Controller
                            control={control}
                            name="financeScope"
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onValueChange={field.onChange}
                                >
                                    <SelectTrigger id="financeScope">
                                        <SelectValue placeholder="Select scope" />
                                    </SelectTrigger>

                                    <SelectContent>
                                        {FINANCE_SCOPE_OPTIONS.map(option => (
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
                                            {field.value === "__none"
                                                ? "None"
                                                : field.value
                                                  ? compatibleParents.find(
                                                        category =>
                                                            category.id === field.value
                                                    )?.name
                                                  : undefined}
                                        </SelectValue>
                                    </SelectTrigger>

                                    <SelectContent>
                                        <SelectItem value="__none">
                                            No parent
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

            {financeScope === "BUSINESS" && (
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
                                        <SelectValue placeholder="Select business entity">
                                            {field.value
                                                ? businessEntities.find(
                                                      entity =>
                                                          entity.id === field.value
                                                  )?.name
                                                : undefined}
                                        </SelectValue>
                                    </SelectTrigger>

                                    <SelectContent>
                                        <SelectItem value="__none">
                                            No business entity
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




