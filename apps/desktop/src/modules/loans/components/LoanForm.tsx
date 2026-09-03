import { useEffect, useState } from "react";
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
import { AccountService } from "@/modules/accounts/services";
import { AccountType, type Account } from "@/modules/accounts/types";

import {
    loanSchema,
    LoanFormInput,
    LoanFormValues,
} from "../validation";

export interface LoanFormProps {
    defaultValues?: Partial<LoanFormValues>;
    loading?: boolean;
    submitLabel?: string;
    editMode?: boolean;
    onCancel?(): void;
    onSubmit(values: LoanFormValues): void | Promise<void>;
}

// The "Linked Account" here is the EMI/payment source account. Loan accounts
// (the loan's own liability row) and investment accounts are never a valid
// payment source, so they are excluded from the picker.
const NON_PAYMENT_ACCOUNT_TYPES: ReadonlySet<AccountType> = new Set([
    AccountType.LOAN,
    AccountType.INVESTMENT,
]);

function formatAccountType(type: string): string {
    return type
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, character => character.toUpperCase());
}

// Last 4 digits of the account number, masked. Never exposes the full
// number; omitted entirely when there is no account number.
function maskedAccountTail(account: Account): string {
    const tail = (account.accountNumber ?? "")
        .replace(/\D/g, "")
        .slice(-4);

    return tail ? `****${tail}` : "";
}

function accountOptionLabel(account: Account): string {
    return [
        account.name,
        account.institutionName,
        formatAccountType(account.type),
        maskedAccountTail(account),
    ]
        .filter(Boolean)
        .join(" — ");
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

export function LoanForm({
    defaultValues,
    loading = false,
    submitLabel = "Save Loan",
    editMode = false,
    onCancel,
    onSubmit,
}: LoanFormProps) {
    const { currencies } = useCurrencies();

    const [accounts, setAccounts] = useState<Account[]>([]);

    const {
        register,
        control,
        handleSubmit,
        reset,
        formState: { errors },
    } = useForm<LoanFormInput, unknown, LoanFormValues>({
        resolver: zodResolver(loanSchema),

        defaultValues: {
            name: "",
            loanType: "",
            lenderInstitutionName: "",
            accountId: "",
            currencyId: "",
            principalAmount: 0,
            interestRate: 0,
            interestType: "REDUCING",
            tenureMonths: undefined,
            emiAmount: undefined,
            startDate: "",
            maturityDate: "",
            outstandingPrincipal: 0,
            outstandingInterest: 0,
            status: "ACTIVE",
            notes: "",
            ...defaultValues,
        },
    });

    useEffect(() => {
        let mounted = true;

        async function loadAccounts() {
            try {
                const service = new AccountService();
                const result = await service.getAll();

                if (mounted) {
                    setAccounts(result);
                }
            } catch (error) {
                console.error(
                    "Failed to load accounts for loan form:",
                    error
                );
            }
        }

        void loadAccounts();

        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        if (!defaultValues) {
            return;
        }

        reset({
            name: defaultValues.name ?? "",
            loanType: defaultValues.loanType ?? "",
            lenderInstitutionName:
                defaultValues.lenderInstitutionName ?? "",
            accountId: defaultValues.accountId ?? "",
            currencyId: defaultValues.currencyId ?? "",
            principalAmount:
                defaultValues.principalAmount ?? 0,
            interestRate:
                defaultValues.interestRate ?? 0,
            interestType:
                defaultValues.interestType ?? "REDUCING",
            tenureMonths:
                defaultValues.tenureMonths ?? undefined,
            emiAmount:
                defaultValues.emiAmount ?? undefined,
            startDate:
                defaultValues.startDate ?? "",
            maturityDate:
                defaultValues.maturityDate ?? "",
            outstandingPrincipal:
                defaultValues.outstandingPrincipal ?? 0,
            outstandingInterest:
                defaultValues.outstandingInterest ?? 0,
            status:
                defaultValues.status ?? "ACTIVE",
            notes:
                defaultValues.notes ?? "",
        });
    }, [defaultValues, reset]);

    return (
        <form
            onSubmit={handleSubmit(
                values => onSubmit(values),
                validationErrors => {
                    console.error(
                        "Loan form validation failed:",
                        validationErrors
                    );
                }
            )}
            className="space-y-4"
        >
            <Section title="Basic Information">
                <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
                    <FormField
                        label="Loan Name"
                        htmlFor="loan-name"
                        required
                        error={errors.name?.message}
                    >
                        <Input
                            id="loan-name"
                            placeholder="e.g. HDFC Home Loan"
                            {...register("name")}
                        />
                    </FormField>

                    <FormField
                        label="Loan Type"
                        htmlFor="loan-type"
                        required
                        error={errors.loanType?.message}
                    >
                        <Input
                            id="loan-type"
                            placeholder="e.g. Home Loan"
                            {...register("loanType")}
                        />
                    </FormField>

                    <FormField
                        label="Lender"
                        htmlFor="lender-institution"
                        error={
                            errors.lenderInstitutionName?.message
                        }
                    >
                        <Input
                            id="lender-institution"
                            placeholder="e.g. HDFC Bank"
                            {...register("lenderInstitutionName")}
                        />
                    </FormField>

                    <FormField
                        label="Currency"
                        htmlFor="loan-currency"
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
                                    <SelectTrigger id="loan-currency">
                                        <SelectValue placeholder="Select currency" />
                                    </SelectTrigger>

                                    <SelectContent>
                                        {currencies.map(currency => (
                                            <SelectItem
                                                key={currency.id}
                                                value={currency.id}
                                            >
                                                {currency.code} -{" "}
                                                {currency.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>

                    {/* Full width: the option labels (Name — Institution —
                       Type — ****LAST4) need the room to stay readable. */}
                    <FormField
                        className="col-span-2"
                        label="Linked Account"
                        htmlFor="loan-account"
                        error={errors.accountId?.message}
                    >
                        <Controller
                            control={control}
                            name="accountId"
                            render={({ field }) => {
                                const paymentAccounts = accounts.filter(
                                    account =>
                                        !NON_PAYMENT_ACCOUNT_TYPES.has(
                                            account.type
                                        ) ||
                                        // keep an already-linked account
                                        // visible even if its type would
                                        // otherwise be excluded
                                        account.id === field.value
                                );

                                const selectedAccount = accounts.find(
                                    account => account.id === field.value
                                );

                                return (
                                    <Select
                                        value={field.value || ""}
                                        onValueChange={field.onChange}
                                    >
                                        <SelectTrigger id="loan-account">
                                            <SelectValue placeholder="Select account">
                                                {selectedAccount
                                                    ? accountOptionLabel(
                                                          selectedAccount
                                                      )
                                                    : null}
                                            </SelectValue>
                                        </SelectTrigger>

                                        <SelectContent>
                                            {paymentAccounts.map(account => (
                                                <SelectItem
                                                    key={account.id}
                                                    value={account.id}
                                                >
                                                    {accountOptionLabel(
                                                        account
                                                    )}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                );
                            }}
                        />
                    </FormField>
                </div>
            </Section>

            <Section title="Loan Terms">
                <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
                    <FormField
                        label="Principal Amount"
                        htmlFor="principal-amount"
                        required
                        error={errors.principalAmount?.message}
                    >
                        <Input
                            id="principal-amount"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            {...register("principalAmount", {
                                valueAsNumber: true,
                            })}
                        />
                    </FormField>

                    <FormField
                        label="Interest Rate"
                        htmlFor="interest-rate"
                        required
                        error={errors.interestRate?.message}
                    >
                        <Input
                            id="interest-rate"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="e.g. 8.50"
                            {...register("interestRate", {
                                valueAsNumber: true,
                            })}
                        />
                    </FormField>

                    <FormField
                        label="Interest Type"
                        htmlFor="interest-type"
                        required
                        error={errors.interestType?.message}
                    >
                        <Controller
                            control={control}
                            name="interestType"
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onValueChange={field.onChange}
                                >
                                    <SelectTrigger id="interest-type">
                                        <SelectValue placeholder="Select interest type" />
                                    </SelectTrigger>

                                    <SelectContent>
                                        <SelectItem value="REDUCING">
                                            Reducing Balance
                                        </SelectItem>

                                        <SelectItem value="FLAT">
                                            Flat Rate
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>

                    <FormField
                        label="Tenure"
                        htmlFor="tenure-months"
                        error={errors.tenureMonths?.message}
                    >
                        <Input
                            id="tenure-months"
                            type="number"
                            min="1"
                            placeholder="Months"
                            {...register("tenureMonths", {
                                valueAsNumber: true,
                            })}
                        />
                    </FormField>

                    <FormField
                        label="EMI Amount"
                        htmlFor="emi-amount"
                        error={errors.emiAmount?.message}
                    >
                        <Input
                            id="emi-amount"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            {...register("emiAmount", {
                                valueAsNumber: true,
                            })}
                        />
                    </FormField>

                    <FormField
                        label="Start Date"
                        htmlFor="start-date"
                        required
                        error={errors.startDate?.message}
                    >
                        <Input
                            id="start-date"
                            type="date"
                            {...register("startDate")}
                        />
                    </FormField>

                    <FormField
                        label="Maturity Date"
                        htmlFor="maturity-date"
                        error={errors.maturityDate?.message}
                    >
                        <Input
                            id="maturity-date"
                            type="date"
                            {...register("maturityDate")}
                        />
                    </FormField>
                </div>
            </Section>

            {!editMode && (
                <Section title="Outstanding Balance">
                    <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
                    <FormField
                        label="Outstanding Principal"
                        htmlFor="outstanding-principal"
                        required
                        error={
                            errors.outstandingPrincipal?.message
                        }
                    >
                        <Input
                            id="outstanding-principal"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            {...register(
                                "outstandingPrincipal",
                                {
                                    valueAsNumber: true,
                                }
                            )}
                        />
                    </FormField>

                    <FormField
                        label="Outstanding Interest"
                        htmlFor="outstanding-interest"
                        required
                        error={
                            errors.outstandingInterest?.message
                        }
                    >
                        <Input
                            id="outstanding-interest"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            {...register(
                                "outstandingInterest",
                                {
                                    valueAsNumber: true,
                                }
                            )}
                        />
                    </FormField>

                    <FormField
                        label="Loan Status"
                        htmlFor="loan-status"
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
                                    <SelectTrigger id="loan-status">
                                        <SelectValue placeholder="Select status" />
                                    </SelectTrigger>

                                    <SelectContent>
                                        <SelectItem value="ACTIVE">
                                            Active
                                        </SelectItem>

                                        <SelectItem value="CLOSED">
                                            Closed
                                        </SelectItem>

                                        <SelectItem value="ON_HOLD">
                                            On Hold
                                        </SelectItem>

                                        <SelectItem value="DEFAULTED">
                                            Defaulted
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>
                    </div>
                </Section>
            )}

            <Section title="Notes">
                <FormField
                    label="Notes"
                    htmlFor="loan-notes"
                    error={errors.notes?.message}
                >
                    <Textarea
                        id="loan-notes"
                        placeholder="Optional notes about this loan"
                        rows={3}
                        {...register("notes")}
                    />
                </FormField>
            </Section>

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                {onCancel && (
                    <button
                        type="button"
                        disabled={loading}
                        onClick={onCancel}
                        className="h-10 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {loading ? "Saving..." : submitLabel}
                </button>
            </div>
        </form>
    );
}
