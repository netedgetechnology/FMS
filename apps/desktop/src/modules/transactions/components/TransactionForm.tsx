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

import { useAccounts } from "@/modules/accounts/hooks";
import { useCategories } from "@/modules/categories";

import {
    TransactionFormInput,
    TransactionFormValues,
    transactionSchema,
} from "../validation";

export interface TransactionFormProps {
    defaultValues?: Partial<TransactionFormValues>;
    loading?: boolean;
    submitLabel?: string;
    onCancel?(): void;
    onSubmit(values: TransactionFormValues): void | Promise<void>;
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

export function TransactionForm({
    defaultValues,
    loading = false,
    submitLabel = "Save",
    onCancel,
    onSubmit,
}: TransactionFormProps) {
    const { accounts } = useAccounts();
    const { categories } = useCategories();

    const {
        register,
        control,
        handleSubmit,
        watch,
        formState: { errors },
    } = useForm<TransactionFormInput, unknown, TransactionFormValues>({
        resolver: zodResolver(transactionSchema),
        defaultValues: {
            accountId: "",
            categoryId: "",
            subcategoryId: "",
            payee: "",
            type: "expense",
            amount: 0,
            transactionDate: new Date()
                .toISOString()
                .slice(0, 10),
            referenceNumber: "",
            notes: "",
            tags: "",
            status: "CLEARED",
            paymentMethod: null,
            upiReference: "",
            bankTransactionReference: "",
            cardReference: "",
            ...defaultValues,
        },
    });

    const activeAccounts = accounts.filter(
        account => account.isActive
    );

    const activeCategories = categories.filter(
        category => category.isActive
    );

    const paymentMethod = watch("paymentMethod");

    return (
        <form
            className="space-y-5"
            onSubmit={handleSubmit(values => onSubmit(values))}
        >
            <Section title="Transaction Details">
                <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                    <FormField
                        label="Account"
                        htmlFor="accountId"
                        required
                        error={errors.accountId?.message}
                    >
                        <Controller
                            control={control}
                            name="accountId"
                            render={({ field }) => {
                                const selectedAccount =
                                    activeAccounts.find(
                                        account =>
                                            account.id === field.value
                                    );

                                return (
                                    <Select
                                        value={field.value}
                                        onValueChange={field.onChange}
                                    >
                                        <SelectTrigger id="accountId">
                                            <SelectValue placeholder="Select Account">
                                                {selectedAccount?.name}
                                            </SelectValue>
                                        </SelectTrigger>

                                        <SelectContent>
                                            {activeAccounts.map(account => (
                                                <SelectItem
                                                    key={account.id}
                                                    value={account.id}
                                                >
                                                    {account.name}
                                                    {account.institutionName
                                                        ? ` - ${account.institutionName}`
                                                        : ""}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                );
                            }}
                        />
                    </FormField>

                    <FormField
                        label="Transaction Type"
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
                                    <SelectTrigger id="type">
                                        <SelectValue placeholder="Select Type" />
                                    </SelectTrigger>

                                    <SelectContent>
                                        <SelectItem value="income">
                                            Income
                                        </SelectItem>
                                        <SelectItem value="expense">
                                            Expense
                                        </SelectItem>
                                        <SelectItem value="transfer">
                                            Transfer
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>

                    <FormField
                        label="Category"
                        htmlFor="categoryId"
                        error={errors.categoryId?.message}
                    >
                        <Controller
                            control={control}
                            name="categoryId"
                            render={({ field }) => {
                                const selectedCategory =
                                    activeCategories.find(
                                        category =>
                                            category.id === field.value
                                    );

                                return (
                                    <Select
                                        value={field.value || "__none"}
                                        onValueChange={value =>
                                            field.onChange(
                                                value === "__none"
                                                    ? ""
                                                    : value
                                            )
                                        }
                                    >
                                        <SelectTrigger id="categoryId">
                                            <SelectValue placeholder="None">
                                                {selectedCategory?.name}
                                            </SelectValue>
                                        </SelectTrigger>

                                        <SelectContent>
                                            <SelectItem value="__none">
                                                None
                                            </SelectItem>

                                            {activeCategories.map(category => (
                                                <SelectItem
                                                    key={category.id}
                                                    value={category.id}
                                                >
                                                    {category.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                );
                            }}
                        />
                    </FormField>

                    <FormField
                        label="Subcategory"
                        htmlFor="subcategoryId"
                        error={errors.subcategoryId?.message}
                    >
                        <Input
                            id="subcategoryId"
                            placeholder="Optional subcategory"
                            {...register("subcategoryId")}
                        />
                    </FormField>

                    <FormField
                        label="Transaction Date"
                        htmlFor="transactionDate"
                        required
                        error={errors.transactionDate?.message}
                    >
                        <Input
                            id="transactionDate"
                            type="date"
                            {...register("transactionDate")}
                        />
                    </FormField>

                    <FormField
                        label="Payee / Merchant"
                        htmlFor="payee"
                        required
                        error={errors.payee?.message}
                    >
                        <Input
                            id="payee"
                            placeholder="e.g. Grocery Store"
                            {...register("payee")}
                        />
                    </FormField>

                    <FormField
                        label="Amount"
                        htmlFor="amount"
                        required
                        error={errors.amount?.message}
                    >
                        <Input
                            id="amount"
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            {...register("amount", {
                                valueAsNumber: true,
                            })}
                        />
                    </FormField>

                    <FormField
                        label="Status"
                        htmlFor="status"
                        required
                        error={errors.status?.message}
                    >
                        <Controller
                            control={control}
                            name="status"
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onValueChange={field.onChange}
                                >
                                    <SelectTrigger id="status">
                                        <SelectValue />
                                    </SelectTrigger>

                                    <SelectContent>
                                        <SelectItem value="CLEARED">
                                            Cleared
                                        </SelectItem>

                                        <SelectItem value="PENDING">
                                            Pending
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>
                </div>
            </Section>

            <Section title="Classification & Payment">
                <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                    <FormField
                        label="Tags"
                        htmlFor="tags"
                        error={errors.tags?.message}
                    >
                        <Input
                            id="tags"
                            placeholder="e.g. monthly, business"
                            {...register("tags")}
                        />
                    </FormField>

                    <FormField
                        label="Payment Method"
                        htmlFor="paymentMethod"
                        error={errors.paymentMethod?.message}
                    >
                        <Controller
                            control={control}
                            name="paymentMethod"
                            render={({ field }) => (
                                <Select
                                    value={field.value ?? "__none"}
                                    onValueChange={value =>
                                        field.onChange(
                                            value === "__none"
                                                ? null
                                                : value
                                        )
                                    }
                                >
                                    <SelectTrigger id="paymentMethod">
                                        <SelectValue placeholder="None">
                                            {field.value === "CARD"
                                                ? "Credit Card"
                                                : field.value === "DEBIT_CARD"
                                                    ? "Debit Card"
                                                    : field.value === "BANK_TRANSFER"
                                                        ? "Bank Transfer"
                                                        : field.value === "DIRECT_DEBIT"
                                                            ? "Direct Debit"
                                                            : field.value === "CASH"
                                                                ? "Cash"
                                                                : field.value === "UPI"
                                                                    ? "UPI"
                                                                    : field.value === "OTHER"
                                                                        ? "Other"
                                                                        : "None"}
                                        </SelectValue>
                                    </SelectTrigger>

                                    <SelectContent>
                                        <SelectItem value="__none">
                                            None
                                        </SelectItem>

                                        <SelectItem value="CASH">
                                            Cash
                                        </SelectItem>

                                        <SelectItem value="CARD">
                                            Credit Card
                                        </SelectItem>

                                        <SelectItem value="DEBIT_CARD">
                                            Debit Card
                                        </SelectItem>

                                        <SelectItem value="UPI">
                                            UPI
                                        </SelectItem>

                                        <SelectItem value="BANK_TRANSFER">
                                            Bank Transfer
                                        </SelectItem>

                                        <SelectItem value="DIRECT_DEBIT">
                                            Direct Debit
                                        </SelectItem>

                                        <SelectItem value="OTHER">
                                            Other
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>

                    {paymentMethod === "UPI" && (
                        <FormField
                            label="UPI Reference"
                            htmlFor="upiReference"
                            error={errors.upiReference?.message}
                        >
                            <Input
                                id="upiReference"
                                placeholder="Optional UPI reference"
                                {...register("upiReference")}
                            />
                        </FormField>
                    )}

                    {paymentMethod === "BANK_TRANSFER" && (
                        <FormField
                            label="Bank Transaction Reference"
                            htmlFor="bankTransactionReference"
                            error={errors.bankTransactionReference?.message}
                        >
                            <Input
                                id="bankTransactionReference"
                                placeholder="Optional bank reference"
                                {...register("bankTransactionReference")}
                            />
                        </FormField>
                    )}

                    {(paymentMethod === "CARD" || paymentMethod === "DEBIT_CARD") && (
                        <FormField
                            label="Card Reference"
                            htmlFor="cardReference"
                            error={errors.cardReference?.message}
                        >
                            <Input
                                id="cardReference"
                                placeholder="Optional card reference"
                                {...register("cardReference")}
                            />
                        </FormField>
                    )}
                </div>
            </Section>

            <Section title="Additional Information">
                <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                    <FormField
                        label="Reference Number"
                        htmlFor="referenceNumber"
                        error={errors.referenceNumber?.message}
                    >
                        <Input
                            id="referenceNumber"
                            placeholder="Optional reference"
                            {...register("referenceNumber")}
                        />
                    </FormField>

                    <FormField
                        label="Notes"
                        htmlFor="notes"
                        error={errors.notes?.message}
                    >
                        <Textarea
                            id="notes"
                            rows={2}
                            placeholder="Optional notes"
                            {...register("notes")}
                        />
                    </FormField>
                </div>
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


