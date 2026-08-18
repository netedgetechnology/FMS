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
import { useCurrencies } from "@/modules/currencies";

import {
    businessEntitySchema,
    BusinessEntityFormInput,
    BusinessEntityFormValues,
} from "../validation";

export interface BusinessEntityFormProps {
    defaultValues?: Partial<BusinessEntityFormValues>;
    loading?: boolean;
    submitLabel?: string;
    onCancel?(): void;
    onSubmit(
        values: BusinessEntityFormValues
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

export function BusinessEntityForm({
    defaultValues,
    loading = false,
    submitLabel = "Save",
    onCancel,
    onSubmit,
}: BusinessEntityFormProps) {
    const { currencies } = useCurrencies();

    const {
        register,
        control,
        handleSubmit,

        formState: { errors },
    } = useForm<
        BusinessEntityFormInput,
        unknown,
        BusinessEntityFormValues
    >({
        resolver: zodResolver(
            businessEntitySchema
        ),

        defaultValues: {
            name: "",
            legalName: "",
            taxIdentifier: "",
            currencyId: "",
            description: "",
            isActive: true,
            ...defaultValues,
        },
    });

    return (
        <form
            onSubmit={handleSubmit(
                values => {
                    console.log(
                        "Business entity form submitted:",
                        values
                    );

                    onSubmit(values);
                },
                validationErrors => {
                    console.error(
                        "Business entity form validation failed:",
                        validationErrors
                    );
                }
            )}
            className="space-y-2.5"
        >
            <Section title="Basic Information">
                <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
                    <FormField
                        label="Entity Name"
                        htmlFor="name"
                        required
                        error={errors.name?.message}
                    >
                        <Input
                            id="name"
                            placeholder="e.g. ABC Private Limited"
                            {...register("name")}
                        />
                    </FormField>

                    <FormField
                        label="Legal Name"
                        htmlFor="legalName"
                        error={errors.legalName?.message}
                    >
                        <Input
                            id="legalName"
                            placeholder="Registered legal name"
                            {...register("legalName")}
                        />
                    </FormField>

                    <FormField
                        label="Tax Identifier"
                        htmlFor="taxIdentifier"
                        error={errors.taxIdentifier?.message}
                    >
                        <Input
                            id="taxIdentifier"
                            placeholder="e.g. GSTIN / Tax ID"
                            {...register("taxIdentifier")}
                        />
                    </FormField>

                    <FormField
                        label="Currency"
                        htmlFor="currencyId"
                        required
                        error={errors.currencyId?.message}
                    >
                        <Controller
                            control={control}
                            name="currencyId"
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onValueChange={field.onChange}
                                >
                                    <SelectTrigger id="currencyId">
                                        <SelectValue placeholder="Select Currency" />
                                    </SelectTrigger>

                                    <SelectContent>
                                        <SelectItem
                                            value="__placeholder"
                                            disabled
                                        >
                                            Select Currency
                                        </SelectItem>

                                        {currencies.map(
                                            currency => (
                                                <SelectItem
                                                    key={currency.id}
                                                    value={currency.id}
                                                >
                                                    {currency.code} -{" "}
                                                    {currency.name}
                                                </SelectItem>
                                            )
                                        )}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>
                </div>
            </Section>

            <Section title="Status">
                <FormField
                    label="Entity Status"
                    htmlFor="isActive"
                >
                    <Controller
                        control={control}
                        name="isActive"
                        render={({ field }) => (
                            <div className="flex h-9 items-center gap-6">
                                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                                    <input
                                        type="radio"
                                        name="business-entity-status"
                                        checked={
                                            field.value === true ||
                                            field.value === undefined
                                        }
                                        onChange={() =>
                                            field.onChange(true)
                                        }
                                        className="h-4 w-4 accent-slate-900"
                                    />

                                    Active
                                </label>

                                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                                    <input
                                        type="radio"
                                        name="business-entity-status"
                                        checked={
                                            field.value === false
                                        }
                                        onChange={() =>
                                            field.onChange(false)
                                        }
                                        className="h-4 w-4 accent-slate-900"
                                    />

                                    Inactive
                                </label>
                            </div>
                        )}
                    />
                </FormField>
            </Section>

            <Section title="Additional">
                <FormField
                    label="Description"
                    htmlFor="description"
                    error={errors.description?.message}
                >
                    <Textarea
                        id="description"
                        rows={3}
                        placeholder="Optional notes about this business entity"
                        {...register("description")}
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
                    {loading
                        ? "Saving..."
                        : submitLabel}
                </button>
            </div>
        </form>
    );
}

