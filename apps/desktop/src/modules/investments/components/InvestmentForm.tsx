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
import { useDisplaySettings } from "@/core/formatting/useDisplaySettings";

import {
    investmentSchema,
    InvestmentFormInput,
    InvestmentFormValues,
} from "../validation";

import { InvestmentStatus } from "../types";

const INVESTMENT_TYPES = [
    "Stocks",
    "Mutual Funds",
    "Fixed Deposits",
    "Bonds",
    "PPF",
    "EPF",
    "NPS",
    "Gold",
    "Real Estate",
    "REIT",
    "International Investments",
    "Cryptocurrency",
];

const GOLD_INVESTMENT_TYPE = "Gold";

const GOLD_SUBTYPES = [
    "Physical Gold",
    "Digital Gold",
    "Gold ETF",
    "Sovereign Gold Bond",
];

export interface InvestmentFormProps {
    defaultValues?: Partial<InvestmentFormValues>;
    loading?: boolean;
    submitLabel?: string;
    onCancel?(): void;
    onSubmit(values: InvestmentFormValues): void | Promise<void>;
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

export function InvestmentForm({
    defaultValues,
    loading = false,
    submitLabel = "Save",
    onCancel,
    onSubmit,
}: InvestmentFormProps) {
    const { currencies } = useCurrencies();
    const { defaultCurrency } = useDisplaySettings();

    const {
        register,
        control,
        handleSubmit,
        watch,
        formState: { errors },
    } = useForm<
        InvestmentFormInput,
        unknown,
        InvestmentFormValues
    >({
        resolver: zodResolver(investmentSchema),

        defaultValues: {
            accountId: "",
            name: "",
            investmentType: "",
            investmentSubtype: "",
            symbol: "",
            isin: "",
            currencyId: currencies.find(
                (currency) => currency.code === defaultCurrency,
            )?.id ?? "",
            brokerInstitutionId: "",
            brokerInstitutionName: "",
            quantity: 0,
            averageCost: 0,
            currentPrice: 0,
            currentValue: 0,
            purchaseDate: "",
            status: InvestmentStatus.ACTIVE,
            notes: "",
            ...defaultValues,
        },
    });

    const investmentType = watch("investmentType");
    const isGold = investmentType === GOLD_INVESTMENT_TYPE;

    return (
        <form
            onSubmit={handleSubmit((values) =>
                onSubmit({
                    ...values,
                    investmentSubtype: isGold
                        ? values.investmentSubtype
                        : "",
                })
            )}
            className="space-y-6"
        >
            <Section title="Investment Details">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField
                        label="Investment Name"
                        htmlFor="name"
                        error={errors.name?.message}
                    >
                        <Input
                            id="name"
                            placeholder="e.g. HDFC Flexi Cap Fund"
                            {...register("name")}
                        />
                    </FormField>

                    <FormField
                        label="Investment Type"
                        htmlFor="investmentType"
                        error={errors.investmentType?.message}
                    >
                        <Controller
                            name="investmentType"
                            control={control}
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onValueChange={field.onChange}
                                >
                                    <SelectTrigger id="investmentType">
                                        <SelectValue placeholder="Select investment type" />
                                    </SelectTrigger>

                                    <SelectContent>
                                        {INVESTMENT_TYPES.map((type) => (
                                            <SelectItem
                                                key={type}
                                                value={type}
                                            >
                                                {type}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>

                    {isGold && (
                        <FormField
                            label="Gold Type"
                            htmlFor="investmentSubtype"
                            error={errors.investmentSubtype?.message}
                        >
                            <Controller
                                name="investmentSubtype"
                                control={control}
                                render={({ field }) => (
                                    <Select
                                        value={field.value ?? ""}
                                        onValueChange={field.onChange}
                                    >
                                        <SelectTrigger id="investmentSubtype">
                                            <SelectValue placeholder="Select gold type" />
                                        </SelectTrigger>

                                        <SelectContent>
                                            {GOLD_SUBTYPES.map((subtype) => (
                                                <SelectItem
                                                    key={subtype}
                                                    value={subtype}
                                                >
                                                    {subtype}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                        </FormField>
                    )}

                    <FormField
                        label="Symbol"
                        htmlFor="symbol"
                        error={errors.symbol?.message}
                    >
                        <Input
                            id="symbol"
                            placeholder="e.g. RELIANCE"
                            {...register("symbol")}
                        />
                    </FormField>

                    <FormField
                        label="ISIN"
                        htmlFor="isin"
                        error={errors.isin?.message}
                    >
                        <Input
                            id="isin"
                            placeholder="e.g. INE002A01018"
                            {...register("isin")}
                        />
                    </FormField>

                    <FormField
                        label="Broker / Institution"
                        htmlFor="brokerInstitutionName"
                        error={
                            errors.brokerInstitutionName?.message
                        }
                    >
                        <Input
                            id="brokerInstitutionName"
                            placeholder="e.g. Zerodha"
                            {...register(
                                "brokerInstitutionName"
                            )}
                        />
                    </FormField>

                    <FormField
                        label="Currency"
                        htmlFor="currencyId"
                        error={errors.currencyId?.message}
                    >
                        <Controller
                            name="currencyId"
                            control={control}
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onValueChange={field.onChange}
                                >
                                    <SelectTrigger id="currencyId">
                                        <SelectValue placeholder="Select currency" />
                                    </SelectTrigger>

                                    <SelectContent>
                                        {currencies.map((currency) => (
                                            <SelectItem
                                                key={currency.id}
                                                value={currency.id}
                                            >
                                                {currency.code}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>
                </div>
            </Section>

            <Section title="Holding Details">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField
                        label="Quantity"
                        htmlFor="quantity"
                        error={errors.quantity?.message}
                    >
                        <Input
                            id="quantity"
                            type="number"
                            min="0"
                            step="any"
                            {...register("quantity")}
                        />
                    </FormField>

                    <FormField
                        label="Average Cost"
                        htmlFor="averageCost"
                        error={errors.averageCost?.message}
                    >
                        <Input
                            id="averageCost"
                            type="number"
                            min="0"
                            step="any"
                            {...register("averageCost")}
                        />
                    </FormField>

                    <FormField
                        label="Current Price"
                        htmlFor="currentPrice"
                        error={errors.currentPrice?.message}
                    >
                        <Input
                            id="currentPrice"
                            type="number"
                            min="0"
                            step="any"
                            {...register("currentPrice")}
                        />
                    </FormField>

                    <FormField
                        label="Current Value"
                        htmlFor="currentValue"
                        error={errors.currentValue?.message}
                    >
                        <Input
                            id="currentValue"
                            type="number"
                            min="0"
                            step="any"
                            {...register("currentValue")}
                        />
                    </FormField>
                </div>
            </Section>

            <Section title="Dates & Status">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField
                        label="Purchase Date"
                        htmlFor="purchaseDate"
                        error={errors.purchaseDate?.message}
                    >
                        <Input
                            id="purchaseDate"
                            type="date"
                            {...register("purchaseDate")}
                        />
                    </FormField>

                    <FormField
                        label="Status"
                        htmlFor="status"
                        error={errors.status?.message}
                    >
                        <Controller
                            name="status"
                            control={control}
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onValueChange={field.onChange}
                                >
                                    <SelectTrigger id="status">
                                        <SelectValue />
                                    </SelectTrigger>

                                    <SelectContent>
                                        <SelectItem value={InvestmentStatus.ACTIVE}>
                                            Active
                                        </SelectItem>

                                        <SelectItem value={InvestmentStatus.ON_HOLD}>
                                            On Hold
                                        </SelectItem>

                                        <SelectItem value={InvestmentStatus.CLOSED}>
                                            Closed
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                        />
                    </FormField>
                </div>
            </Section>

            <Section title="Notes">
                <FormField
                    label="Notes"
                    htmlFor="notes"
                    error={errors.notes?.message}
                >
                    <Textarea
                        id="notes"
                        rows={3}
                        placeholder="Optional notes about this investment..."
                        {...register("notes")}
                    />
                </FormField>
            </Section>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
                {onCancel && (
                    <button
                        type="button"
                        disabled={loading}
                        onClick={onCancel}
                        className="h-9 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Cancel
                    </button>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="h-9 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {loading ? "Saving..." : submitLabel}
                </button>
            </div>
        </form>
    );
}







