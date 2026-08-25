import { useEffect } from "react";
import {
    Controller,
    useForm,
} from "react-hook-form";
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

import type { Account } from "@/modules/accounts/types";

import {
    CreateReconciliationRequest,
} from "../types";

import {
    reconciliationSchema,
    ReconciliationFormInput,
    ReconciliationFormValues,
} from "../validation";

interface ReconciliationFormProps {
    accounts: Account[];
    onSubmit: (
        request: CreateReconciliationRequest
    ) => Promise<void>;
    onCancel: () => void;
    loading?: boolean;
    error?: string | null;
}

export function ReconciliationForm({
    accounts,
    onSubmit,
    onCancel,
    loading = false,
    error = null,
}: ReconciliationFormProps) {

    const {
        register,
        control,
        handleSubmit,
        setError,
        formState: {
            errors,
        },
    } = useForm<ReconciliationFormInput, unknown, ReconciliationFormValues>({
        resolver: zodResolver(reconciliationSchema),
        defaultValues: {
            accountId: "",
            statementDate:
                new Date()
                    .toISOString()
                    .slice(0, 10),
            statementBalance: "",
            notes: "",
        },
    });

    useEffect(() => {
        if (!error) {
            return;
        }

        setError("root", {
            message: error,
        });
    }, [error, setError]);

    const submit = async (
        values: ReconciliationFormValues
    ) => {
        await onSubmit({
            accountId:
                values.accountId,

            statementDate:
                values.statementDate,

            statementBalance:
                values.statementBalance,

            notes:
                values.notes?.trim() || null,
        });
    };

    const accountItems = accounts.map(account => ({
        value: account.id,
        label:
            account.institutionName ||
            account.name,
    }));

    return (
        <form
            onSubmit={handleSubmit(submit)}
            className="space-y-5"
        >

            <Controller
                control={control}
                name="accountId"
                render={({ field }) => (
                    <FormField
                        label="Account"
                        htmlFor="accountId"
                        error={errors.accountId?.message}
                    >
                        <Select
                            items={accountItems}
                            value={field.value}
                            onValueChange={
                                field.onChange
                            }
                            disabled={loading}
                        >
                            <SelectTrigger
                                id="accountId"
                            >
                                <SelectValue
                                    placeholder="Select account"
                                />
                            </SelectTrigger>

                            <SelectContent>
                                {accounts.map(
                                    account => (
                                        <SelectItem
                                            key={
                                                account.id
                                            }
                                            value={
                                                account.id
                                            }
                                        >
                                            <span className="flex min-w-0 flex-col">
                                                <span className="truncate font-medium text-slate-900">
                                                    {account.institutionName || account.name}
                                                </span>
                                                {account.institutionName &&
                                                    account.name !== account.institutionName && (
                                                        <span className="truncate text-xs text-slate-500">
                                                            {account.name}
                                                        </span>
                                                    )}
                                            </span>
                                        </SelectItem>
                                    )
                                )}
                            </SelectContent>
                        </Select>
                    </FormField>
                )}
            />

            <FormField
                label="Statement Date"
                htmlFor="statementDate"
                error={
                    errors.statementDate
                        ?.message
                }
            >
                <Input
                    id="statementDate"
                    type="date"
                    disabled={loading}
                    {...register(
                        "statementDate"
                    )}
                />
            </FormField>

            <FormField
                label="Statement Balance"
                htmlFor="statementBalance"
                error={
                    errors.statementBalance
                        ?.message
                }
            >
                <Input
                    id="statementBalance"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    disabled={loading}
                    {...register(
                        "statementBalance"
                    )}
                />
            </FormField>

            <FormField
                label="Notes"
                htmlFor="notes"
                error={
                    errors.notes?.message
                }
            >
                <Textarea
                    id="notes"
                    placeholder="Optional notes"
                    disabled={loading}
                    {...register("notes")}
                />
            </FormField>

            {errors.root?.message && (
                <p className="text-sm text-destructive">
                    {errors.root.message}
                </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={loading}
                    className="
                        rounded-xl
                        border
                        border-slate-200
                        bg-white
                        px-4
                        py-2
                        text-sm
                        font-medium
                        text-slate-700
                        transition
                        hover:bg-slate-50
                        disabled:cursor-not-allowed
                        disabled:opacity-50
                    "
                >
                    Cancel
                </button>

                <button
                    type="submit"
                    disabled={loading}
                    className="
                        rounded-xl
                        bg-slate-900
                        px-4
                        py-2
                        text-sm
                        font-medium
                        text-white
                        transition
                        hover:bg-slate-800
                        disabled:cursor-not-allowed
                        disabled:opacity-50
                    "
                >
                    {loading
                        ? "Creating..."
                        : "Create Reconciliation"}
                </button>
            </div>

        </form>
    );
}

