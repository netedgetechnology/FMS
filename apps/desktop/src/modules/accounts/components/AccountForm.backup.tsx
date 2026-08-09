import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import { FormField } from "@/components/forms";

import { useCurrencies } from "@/modules/currencies";
import { useInstitutions } from "@/modules/institutions";

import {
    accountSchema,
    AccountFormInput,
    AccountFormValues,
} from "../validation";

import {
    ACCOUNT_TYPE_OPTIONS,
} from "../constants";

export interface AccountFormProps {
    defaultValues?: Partial<AccountFormValues>;
    loading?: boolean;
    submitLabel?: string;
    onSubmit(values: AccountFormValues): void | Promise<void>;
}

export function AccountForm({
    defaultValues,
    loading = false,
    submitLabel = "Save",
    onSubmit,
}: AccountFormProps) {
    const { currencies } = useCurrencies();
    const { institutions } = useInstitutions();

    const {
        register,
        control,
        handleSubmit,
        formState: { errors },
    } = useForm<AccountFormInput, unknown, AccountFormValues>({
        resolver: zodResolver(accountSchema),
        defaultValues: {
            name: "",
            type: ACCOUNT_TYPE_OPTIONS[0].value,
            institutionName: "",
            currencyId: "",
            openingBalance: 0,
            accountNumber: "",
            description: "",
            isActive: true,
            ...defaultValues,
        },
    });

    return (
        <form
            className="space-y-4"
            onSubmit={handleSubmit(values => onSubmit(values))}
        >
            <FormField
                label="Account Name"
                htmlFor="name"
                required
                error={errors.name?.message}
            >
                <Input
                    id="name"
                    {...register("name")}
                />
            </FormField>

            <FormField
                label="Account Type"
                htmlFor="type"
                required
                error={errors.type?.message}
            >
                <Controller
                    control={control}
                    name="type"
                    render={({ field }) => (
                        <Select
                            value={field.value}
                            onValueChange={field.onChange}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>

                            <SelectContent>
                                {ACCOUNT_TYPE_OPTIONS.map(option => (
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
                            <SelectTrigger>
                                <SelectValue placeholder="Select currency" />
                            </SelectTrigger>

                            <SelectContent>
                                {currencies.map(currency => (
                                    <SelectItem
                                        key={currency.id}
                                        value={currency.id}
                                    >
                                        {currency.code} - {currency.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                />
            </FormField>

            <FormField
                label="Institution"
                htmlFor="institutionId"
                error={errors.institutionName?.message}
            >
                <Controller
                    control={control}
                    name="institutionName"
                    render={({ field }) => (
                        <Select
                            value={field.value ?? ""}
                            onValueChange={value =>
                                field.onChange(value === "" ? null : value)
                            }
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="None" />
                            </SelectTrigger>

                            <SelectContent>
                                <SelectItem value="">
                                    None
                                </SelectItem>

                                {institutions.map(institution => (
                                    <SelectItem
                                        key={institution.id}
                                        value={institution.id}
                                    >
                                        {institution.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                />
            </FormField>

            <FormField
                label="Opening Balance"
                htmlFor="openingBalance"
                error={errors.openingBalance?.message}
            >
                <Input
                    id="openingBalance"
                    type="number"
                    step="0.01"
                    {...register("openingBalance")}
                />
            </FormField>

            <FormField
                label="Account Number"
                htmlFor="accountNumber"
                error={errors.accountNumber?.message}
            >
                <Input
                    id="accountNumber"
                    {...register("accountNumber")}
                />
            </FormField>

            <FormField
                label="Description"
                htmlFor="description"
                error={errors.description?.message}
            >
                <Input
                    id="description"
                    {...register("description")}
                />
            </FormField>

            <div className="flex justify-end">
                <Button
                    type="submit"
                    disabled={loading}
                >
                    {submitLabel}
                </Button>
            </div>
        </form>
    );
}



