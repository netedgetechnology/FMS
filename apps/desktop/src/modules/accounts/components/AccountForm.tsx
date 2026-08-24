import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
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
    accountSchema,
    AccountFormInput,
    AccountFormValues,
} from "../validation";

import { ACCOUNT_TYPE_OPTIONS } from "../constants";
import { AccountType } from "../types";

export interface AccountFormProps {
    defaultValues?: Partial<AccountFormValues>;
    loading?: boolean;
    submitLabel?: string;
    onCancel?(): void;
    onSubmit(values: AccountFormValues): void | Promise<void>;
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

export function AccountForm({
    defaultValues,
    loading = false,
    submitLabel = "Save",
    onCancel,
    onSubmit,
}: AccountFormProps) {
    const { currencies } = useCurrencies();

    const {
        register,
        control,
        handleSubmit,
        watch,
    reset,
    formState: { errors },
    } = useForm<AccountFormInput, unknown, AccountFormValues>({
        resolver: zodResolver(accountSchema),
        defaultValues: {
            name: "",
            type: undefined,
            institutionName: "",
            currencyId: "",
            openingBalance: 0,
            accountNumber: "",
            branchName: "",
            ifscCode: "",
            swiftCode: "",
            iban: "",
        cardNetwork: "VISA",
        creditLimit: 0,
        statementDay: undefined,
        paymentDueDay: undefined,
            description: "",
            isActive: true,
            ...defaultValues,
        },
    });
    const accountType = watch("type");
    const isBankAccount =
        accountType === AccountType.SAVINGS ||
        accountType === AccountType.CURRENT;

    const isCashOrWallet =
        accountType === AccountType.CASH ||
        accountType === AccountType.WALLET;

    const isCreditCard =
        accountType === AccountType.CREDIT_CARD;

    useEffect(() => {
        if (defaultValues) {
            reset({
                name: defaultValues.name ?? "",
                type: defaultValues.type,
                institutionName: defaultValues.institutionName ?? "",
                currencyId: defaultValues.currencyId ?? "",
                openingBalance: defaultValues.openingBalance ?? 0,
                accountNumber: defaultValues.accountNumber ?? "",
                branchName: defaultValues.branchName ?? "",
                ifscCode: defaultValues.ifscCode ?? "",
                swiftCode: defaultValues.swiftCode ?? "",
                iban: defaultValues.iban ?? "",
            cardNetwork: defaultValues.cardNetwork ?? "VISA",
            creditLimit: defaultValues.creditLimit ?? 0,
            statementDay: defaultValues.statementDay ?? undefined,
            paymentDueDay: defaultValues.paymentDueDay ?? undefined,

                description: defaultValues.description ?? "",
                isActive: defaultValues.isActive ?? true,
            });
        }
    }, [defaultValues, reset]);

    return (
        <form
        onSubmit={handleSubmit(
            values => {
                console.log("Account form submitted:", values);
                onSubmit(values);
            },
            validationErrors => {
                console.error(
                    "Account form validation failed:",
                    validationErrors
                );
            }
        )}
        className="space-y-2.5"
        >
            <Section title="Basic Information">
                <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">

                    <FormField
                        label="Account Name"
                        htmlFor="name"
                        required
                        error={errors.name?.message}
                    >
                        <Input
                            id="name"
                            placeholder="e.g. HDFC Savings"
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
                            render={({ field }) => {
                                const selected = ACCOUNT_TYPE_OPTIONS.find(
                                    option => option.value === field.value
                                );

                                return (
                                    <Select
                                        value={field.value}
                                        onValueChange={field.onChange}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select Account Type">
                                                {selected?.label}
                                            </SelectValue>
                                        </SelectTrigger>

                                        <SelectContent>
                                            <SelectItem
                                                value="__placeholder"
                                                disabled
                                            >
                                                Select Account Type
                                            </SelectItem>

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
                                );
                            }}
                        />
                    </FormField>

                    {!isCashOrWallet && (
                        <FormField
                            label="Bank"
                            htmlFor="institutionName"
                            error={errors.institutionName?.message}
                        >
                            <Input
                                id="institutionName"
                                placeholder="e.g. HDFC Bank"
                                {...register("institutionName")}
                            />
                        </FormField>
                    )}
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
                                        <SelectValue placeholder="Select Currency" />
                                    </SelectTrigger>

                                    <SelectContent>
                                        <SelectItem
                                            value="__placeholder"
                                            disabled
                                        >
                                            Select Currency
                                        </SelectItem>

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
                </div>
            </Section>

            {isBankAccount && (
                <Section title="Banking Details">
                    <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">

                    <FormField
                        label="Account Number"
                        htmlFor="accountNumber"
                        error={errors.accountNumber?.message}
                    >
                        <Input
                            id="accountNumber"
                            placeholder="Account number"
                            {...register("accountNumber")}
                        />
                    </FormField>

                    <FormField
                        label="Branch"
                        htmlFor="branchName"
                        error={errors.branchName?.message}
                    >
                        <Input
                            id="branchName"
                            placeholder="Branch name"
                            {...register("branchName")}
                        />
                    </FormField>

                    <FormField
                        label="IFSC"
                        htmlFor="ifscCode"
                        error={errors.ifscCode?.message}
                    >
                        <Input
                            id="ifscCode"
                            placeholder="IFSC code"
                            {...register("ifscCode")}
                        />
                    </FormField>

                    <FormField
                        label="SWIFT"
                        htmlFor="swiftCode"
                        error={errors.swiftCode?.message}
                    >
                        <Input
                            id="swiftCode"
                            placeholder="SWIFT / BIC"
                            {...register("swiftCode")}
                        />
                    </FormField>

                    <FormField
                        label="IBAN"
                        htmlFor="iban"
                        error={errors.iban?.message}
                    >
                        <Input
                            id="iban"
                            placeholder="IBAN"
                            {...register("iban")}
                        />
                    </FormField>

                </div>
            </Section>
        )}
    {isCreditCard && (
        <Section title="Card Details">
            <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">

                <FormField
                    label="Card Number"
                    htmlFor="accountNumber"
                    error={errors.accountNumber?.message}
                >
                    <Input
                        id="accountNumber"
                        placeholder="Card number"
                        {...register("accountNumber")}
                    />
                </FormField>

                <FormField
                    label="Card Network"
                    htmlFor="cardNetwork"
                    error={errors.cardNetwork?.message}
                >
                    <Controller
                        control={control}
                        name="cardNetwork"
                        render={({ field }) => (
                            <Select
                                value={field.value}
                                onValueChange={field.onChange}
                            >
                                <SelectTrigger id="cardNetwork">
                                    <SelectValue placeholder="Select card network" />
                                </SelectTrigger>

                                <SelectContent>
                                    <SelectItem value="VISA">
                                        Visa
                                    </SelectItem>
                                    <SelectItem value="MASTERCARD">
                                        Mastercard
                                    </SelectItem>
                                    <SelectItem value="AMEX">
                                        American Express
                                    </SelectItem>
                                    <SelectItem value="RUPAY">
                                        RuPay
                                    </SelectItem>
                                    <SelectItem value="OTHER">
                                        Other
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    />
                </FormField>

                <FormField
                    label="Credit Limit"
                    htmlFor="creditLimit"
                    error={errors.creditLimit?.message}
                >
                    <Input
                        id="creditLimit"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        {...register("creditLimit", {
                            valueAsNumber: true,
                        })}
                    />
                </FormField>

                <FormField
                    label="Statement Date"
                    htmlFor="statementDay"
                    error={errors.statementDay?.message}
                >
                    <Input
                        id="statementDay"
                        type="number"
                        min="1"
                        max="31"
                        placeholder="Day of month (1-31)"
                        {...register("statementDay", {
                            valueAsNumber: true,
                        })}
                    />
                </FormField>

                <FormField
                    label="Payment Due Date"
                    htmlFor="paymentDueDay"
                    error={errors.paymentDueDay?.message}
                >
                    <Input
                        id="paymentDueDay"
                        type="number"
                        min="1"
                        max="31"
                        placeholder="Day of month (1-31)"
                        {...register("paymentDueDay", {
                            valueAsNumber: true,
                        })}
                    />
                </FormField>

            </div>
        </Section>
    )}
<Section title="Financial">
                <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">

                    <FormField
                        label="Opening Balance"
                        htmlFor="openingBalance"
                        error={errors.openingBalance?.message}
                    >
                        <Input
                            id="openingBalance"
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            {...register("openingBalance", {
                                valueAsNumber: true,
                            })}
                        />
                    </FormField>

                    <FormField
                        label="Account Status"
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
                                            name="account-status"
                                            checked={field.value === true || field.value === undefined}
                                            onChange={() => field.onChange(true)}
                                            className="h-4 w-4 accent-slate-900"
                                        />
                                        Active
                                    </label>

                                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                                        <input
                                            type="radio"
                                            name="account-status"
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
                </div>
            </Section>

            <Section title="Additional">
                <FormField
                    label="Description"
                    htmlFor="description"
                    error={errors.description?.message}
                >
                    <Textarea
                        id="description"
                        rows={2}
                        placeholder="Optional notes about this account"
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
                        className="h-9 rounded-lg border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:border-slate-400 disabled:opacity-50"
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




