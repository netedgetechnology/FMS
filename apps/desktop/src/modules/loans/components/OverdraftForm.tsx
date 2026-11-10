import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Checkbox } from "@/components/ui/checkbox";
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
import { useDisplaySettings } from "@/core/formatting/useDisplaySettings";
import { AccountService } from "@/modules/accounts/services";
import type { Account } from "@/modules/accounts/types";

import { computeOverdraftPosition } from "../services/overdraftPosition";
import {
    drawingPowerOn,
    droplineScheduleIssues,
    stepDraftsFrom,
    stepsFromDrafts,
    type DrawingPowerStep,
    type DrawingPowerStepDraft,
} from "../setup/droplineSchedule";
import { localToday } from "../setup/historicalInstalments";
import {
    drawingPowerValue,
    openingUsedAsOfAfterStartDate,
    overdraftSchema,
    type OverdraftFormInput,
    type OverdraftFormValues,
} from "../validation";
import { accountOptionLabel, NON_PAYMENT_ACCOUNT_TYPES } from "./LoanForm";

// ---------------------------------------------------------------------
// Add / Edit Overdraft - only what an OD has: no EMI, tenure, first
// instalment or schedule. The used amount after today is never typed in:
// it follows from the transactions linked to the OD.
// ---------------------------------------------------------------------

export interface OverdraftFormProps {
    defaultValues?: Partial<OverdraftFormValues>;
    /**
     * A Dropline Overdraft's saved steps (migration 053). When given, they
     * replace the single Drawing Power field and are saved as a whole.
     */
    drawingPowerSchedule?: readonly DrawingPowerStep[] | null;
    /** What the facility was saved as (Overdraft, Cash Credit...). */
    facilityLabel?: string;
    loading?: boolean;
    submitLabel?: string;
    onCancel?(): void;
    onSubmit(
        values: OverdraftFormValues,
        extras?: { drawingPowerSchedule?: DrawingPowerStep[] }
    ): void | Promise<void>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="space-y-2.5">
            <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>
                <div className="h-px flex-1 bg-slate-100" />
            </div>
            {children}
        </section>
    );
}

function formatAmount(value: number): string {
    return new Intl.NumberFormat("en-IN", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
    }).format(value);
}

export function OverdraftForm({
    defaultValues,
    drawingPowerSchedule = null,
    facilityLabel = "Overdraft",
    loading = false,
    submitLabel = "Save Overdraft",
    onCancel,
    onSubmit,
}: OverdraftFormProps) {
    const { currencies } = useCurrencies();
    const { defaultCurrency } = useDisplaySettings();
    const [accounts, setAccounts] = useState<Account[]>([]);

    // A Dropline edits its dated steps instead of one drawing power.
    const dropline = (drawingPowerSchedule?.length ?? 0) > 0;
    const [steps, setSteps] = useState<DrawingPowerStepDraft[]>(() => stepDraftsFrom(drawingPowerSchedule ?? []));
    const [stepIssues, setStepIssues] = useState<{ field: string; message: string }[]>([]);

    useEffect(() => {
        setSteps(stepDraftsFrom(drawingPowerSchedule ?? []));
        setStepIssues([]);
    }, [drawingPowerSchedule]);

    const changeStep = (key: string, change: Partial<DrawingPowerStepDraft>) => {
        setSteps(current => current.map(step => (step.key === key ? { ...step, ...change } : step)));
        setStepIssues([]);
    };
    const stepIssue = (field: string) => stepIssues.find(issue => issue.field === field)?.message;

    const fallbackCurrencyId = useMemo(
        () => currencies.find(currency => currency.code === defaultCurrency)?.id ?? "",
        [currencies, defaultCurrency]
    );

    const {
        register,
        control,
        handleSubmit,
        reset,
        watch,
        setValue,
        getValues,
        formState: { errors, dirtyFields },
    } = useForm<OverdraftFormInput, unknown, OverdraftFormValues>({
        resolver: zodResolver(overdraftSchema),
        defaultValues: {
            name: "",
            lenderInstitutionName: "",
            loanAccountNumber: "",
            accountIds: [],
            currencyId: fallbackCurrencyId,
            creditLimit: 0,
            openingUsed: 0,
            drawingPower: null,
            openingUsedAsOf: "", // follows the Start Date until the user sets it
            startDate: "",
            interestRate: 0,
            status: "ACTIVE",
            notes: "",
            ...defaultValues,
        },
    });

    useEffect(() => {
        if (defaultValues) {
            reset({
                name: "",
                lenderInstitutionName: "",
                loanAccountNumber: "",
                accountIds: [],
                currencyId: fallbackCurrencyId,
                creditLimit: 0,
                openingUsed: 0,
                drawingPower: null,
                openingUsedAsOf: "", // follows the Start Date until the user sets it
                startDate: "",
                interestRate: 0,
                status: "ACTIVE",
                notes: "",
                ...defaultValues,
            });
        }
    }, [defaultValues, reset, fallbackCurrencyId]);

    useEffect(() => {
        let mounted = true;

        new AccountService()
            .getAll()
            .then(result => {
                if (mounted) {
                    setAccounts(result);
                }
            })
            .catch(error => console.error("Failed to load accounts for overdraft form:", error));

        return () => {
            mounted = false;
        };
    }, []);

    const currencyId = watch("currencyId");

    useEffect(() => {
        if (!defaultValues?.currencyId && !currencyId && fallbackCurrencyId) {
            setValue("currencyId", fallbackCurrencyId);
        }
    }, [defaultValues?.currencyId, currencyId, fallbackCurrencyId, setValue]);

    // Opening Used As Of defaults to the Start Date. Once the user enters
    // their own date - or the OD already has a saved one - it is kept.
    const startDate = watch("startDate");
    const hasSavedAsOf = Boolean(defaultValues?.openingUsedAsOf);
    const asOfEdited = Boolean(dirtyFields.openingUsedAsOf);

    useEffect(() => {
        const current = getValues("openingUsedAsOf") ?? "";
        const next = openingUsedAsOfAfterStartDate({
            startDate: startDate ?? "",
            openingUsedAsOf: current,
            keepAsOf: hasSavedAsOf || asOfEdited,
        });

        if (next !== current) {
            setValue("openingUsedAsOf", next);
        }
    }, [startDate, hasSavedAsOf, asOfEdited, getValues, setValue]);

    // The opening position, exactly as the OD will show it once saved.
    const creditLimit = Number(watch("creditLimit"));
    const openingUsed = Number(watch("openingUsed"));
    const singleDrawingPower = watch("drawingPower");
    const drawingPower = dropline
        ? drawingPowerOn(
              steps
                  .filter(step => step.drawingPower !== null && step.effectiveDate)
                  .map(step => ({ effectiveDate: step.effectiveDate, drawingPower: step.drawingPower! })),
              localToday()
          )
        : singleDrawingPower;
    const preview =
        creditLimit > 0 && openingUsed >= 0
            ? computeOverdraftPosition(
                  creditLimit,
                  {
                      used: openingUsed,
                      totalDrawdowns: 0,
                      totalRepayments: 0,
                      totalInterestCharges: 0,
                      invalidLinks: 0,
                  },
                  typeof drawingPower === "number" ? drawingPower : null
              )
            : null;

    return (
        <form
            onSubmit={handleSubmit(
                values => {
                    if (!dropline) return onSubmit(values);

                    const issues = droplineScheduleIssues(steps, values.creditLimit);
                    setStepIssues(issues);
                    if (issues.length > 0) return;

                    return onSubmit({ ...values, drawingPower: null }, { drawingPowerSchedule: stepsFromDrafts(steps) });
                },
                validationErrors => console.error("Overdraft form validation failed:", validationErrors)
            )}
            className="space-y-4"
        >
            <Section title="Basic Information">
                <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
                    <FormField label={facilityLabel === "Overdraft" ? "Overdraft Name" : "Facility Name"} htmlFor="od-name" required error={errors.name?.message}>
                        <Input id="od-name" placeholder="e.g. HDFC Overdraft" {...register("name")} />
                    </FormField>

                    <FormField label="Lender" htmlFor="od-lender" error={errors.lenderInstitutionName?.message}>
                        <Input id="od-lender" placeholder="e.g. HDFC Bank" {...register("lenderInstitutionName")} />
                    </FormField>

                    <FormField label="Loan Account Number" htmlFor="od-account-number" error={errors.loanAccountNumber?.message}>
                        <Input
                            id="od-account-number"
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="Enter loan account number"
                            {...register("loanAccountNumber")}
                        />
                    </FormField>

                    <FormField label="Currency" htmlFor="od-currency" required error={errors.currencyId?.message}>
                        <Controller
                            control={control}
                            name="currencyId"
                            render={({ field }) => (
                                <Select value={field.value} onValueChange={field.onChange}>
                                    <SelectTrigger id="od-currency">
                                        <SelectValue placeholder="Select currency" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {currencies.map(currency => (
                                            <SelectItem key={currency.id} value={currency.id}>
                                                {currency.code} - {currency.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>

                    <FormField label="Status" htmlFor="od-status" required error={errors.status?.message}>
                        <Controller
                            control={control}
                            name="status"
                            render={({ field }) => (
                                <Select value={field.value} onValueChange={field.onChange}>
                                    <SelectTrigger id="od-status">
                                        <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ACTIVE">Active</SelectItem>
                                        <SelectItem value="CLOSED">Closed</SelectItem>
                                        <SelectItem value="ON_HOLD">On Hold</SelectItem>
                                        <SelectItem value="DEFAULTED">Defaulted</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>

                    <FormField
                        className="col-span-2"
                        label="Linked Bank Accounts"
                        htmlFor="od-accounts"
                        required
                        error={errors.accountIds?.message}
                    >
                        <Controller
                            control={control}
                            name="accountIds"
                            render={({ field }) => {
                                const selected = field.value ?? [];
                                const options = accounts.filter(
                                    account =>
                                        !NON_PAYMENT_ACCOUNT_TYPES.has(account.type) ||
                                        selected.includes(account.id)
                                );
                                const toggle = (id: string, checked: boolean) =>
                                    field.onChange(
                                        checked
                                            ? [...selected.filter(item => item !== id), id]
                                            : selected.filter(item => item !== id)
                                    );

                                return (
                                    <div
                                        id="od-accounts"
                                        className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 px-3 py-2"
                                    >
                                        {options.map(account => (
                                            <label
                                                key={account.id}
                                                className="flex cursor-pointer items-center gap-2 py-1 text-sm text-slate-700"
                                            >
                                                <Checkbox
                                                    checked={selected.includes(account.id)}
                                                    onCheckedChange={checked =>
                                                        toggle(account.id, checked === true)
                                                    }
                                                />
                                                {accountOptionLabel(account)}
                                            </label>
                                        ))}
                                    </div>
                                );
                            }}
                        />
                        <p className="mt-1 text-xs text-slate-500">
                            The accounts that receive the OD money and pay it back. All of them count towards this one overdraft.
                        </p>
                    </FormField>
                </div>
            </Section>

            <Section title={facilityLabel}>
                <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
                    <FormField label={facilityLabel === "Overdraft" ? "OD Limit" : "Sanctioned Limit"} htmlFor="od-limit" required error={errors.creditLimit?.message}>
                        <Input
                            id="od-limit"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            {...register("creditLimit", { valueAsNumber: true })}
                        />
                    </FormField>

                    <FormField label="Interest Rate (optional)" htmlFor="od-rate" error={errors.interestRate?.message}>
                        <Input
                            id="od-rate"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="e.g. 10.50"
                            {...register("interestRate", { valueAsNumber: true })}
                        />
                    </FormField>

                    {!dropline && (
                    <FormField label="Drawing Power (optional)" htmlFor="od-drawing-power" error={errors.drawingPower?.message}>
                        <Input
                            id="od-drawing-power"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Same as limit"
                            {...register("drawingPower", { setValueAs: drawingPowerValue })}
                        />
                        <p className="mt-1 text-xs text-slate-500">
                            When the lender allows less than the full limit. Available = drawing power − used.
                        </p>
                    </FormField>
                    )}

                    <FormField label="Opening Used Amount" htmlFor="od-opening-used" required error={errors.openingUsed?.message}>
                        <Input
                            id="od-opening-used"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            {...register("openingUsed", { valueAsNumber: true })}
                        />
                    </FormField>

                    <FormField label="Opening Used As Of" htmlFor="od-opening-date" required error={errors.openingUsedAsOf?.message}>
                        <Input id="od-opening-date" type="date" {...register("openingUsedAsOf")} />
                        <p className="mt-1 text-xs text-slate-500">
                            Only transactions after this date change the used amount.
                        </p>
                    </FormField>

                    <FormField label="Start Date" htmlFor="od-start-date" required error={errors.startDate?.message}>
                        <Input id="od-start-date" type="date" {...register("startDate")} />
                    </FormField>
                </div>

                {dropline && (
                    <div data-testid="od-dropline-steps" className="space-y-2 rounded-xl border border-slate-200 px-3 py-2.5">
                        <p className="text-sm font-medium text-slate-800">Drawing power steps</p>
                        <p className="text-xs text-slate-500">
                            Each step applies from its date until the next one. Before the first step the limit applies. Saved together with the rest of this form.
                        </p>
                        {steps.map((step, index) => (
                            <div key={step.key} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                                <FormField label={`Step ${index + 1} from`} htmlFor={`od-dp-date-${step.key}`} error={stepIssue(`drawingPowerSchedule.${index}`)}>
                                    <Input
                                        id={`od-dp-date-${step.key}`}
                                        type="date"
                                        value={step.effectiveDate}
                                        onChange={event => changeStep(step.key, { effectiveDate: event.target.value })}
                                    />
                                </FormField>
                                <FormField label="Drawing Power" htmlFor={`od-dp-amount-${step.key}`}>
                                    <Input
                                        id={`od-dp-amount-${step.key}`}
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={step.drawingPower ?? ""}
                                        onChange={event => changeStep(step.key, { drawingPower: drawingPowerValue(event.target.value) })}
                                    />
                                </FormField>
                                <button
                                    type="button"
                                    className="h-9 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-700 hover:bg-red-50"
                                    onClick={() => {
                                        setSteps(current => current.filter(item => item.key !== step.key));
                                        setStepIssues([]);
                                    }}
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            onClick={() => {
                                setSteps(current => [...current, { key: `new-${crypto.randomUUID()}`, effectiveDate: "", drawingPower: null }]);
                                setStepIssues([]);
                            }}
                        >
                            Add step
                        </button>
                        {stepIssue("drawingPowerSchedule") && <p className="text-xs text-red-600">{stepIssue("drawingPowerSchedule")}</p>}
                    </div>
                )}

                {preview && (
                    <div
                        data-testid="od-opening-preview"
                        className="grid grid-cols-3 gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm"
                    >
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Used</div>
                            <div className="font-semibold text-slate-900">{formatAmount(preview.used)}</div>
                        </div>
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Available</div>
                            <div className="font-semibold text-slate-900">{formatAmount(preview.available)}</div>
                        </div>
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Utilization</div>
                            <div className="font-semibold text-slate-900">{preview.utilizationPercent?.toFixed(2)}%</div>
                        </div>
                    </div>
                )}
            </Section>

            <Section title="Notes">
                <FormField label="Notes" htmlFor="od-notes" error={errors.notes?.message}>
                    <Textarea id="od-notes" placeholder="Optional notes about this overdraft" rows={3} {...register("notes")} />
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
