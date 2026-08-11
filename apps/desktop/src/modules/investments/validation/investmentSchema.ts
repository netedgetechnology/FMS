import { z } from "zod";

import { InvestmentStatus } from "../types";

export const investmentSchema = z.object({
    accountId: z.string().trim().optional(),

    name: z.string().trim().min(1, "Investment name is required."),

    investmentType: z
        .string()
        .trim()
        .min(1, "Investment type is required."),

    symbol: z.string().trim().optional(),

    isin: z.string().trim().optional(),

    currencyId: z
        .string()
        .trim()
        .min(1, "Currency is required."),

    brokerInstitutionId: z.string().trim().optional(),

    brokerInstitutionName: z.string().trim().optional(),

    quantity: z.coerce
        .number()
        .finite()
        .min(0, "Quantity cannot be negative."),

    averageCost: z.coerce
        .number()
        .finite()
        .min(0, "Average cost cannot be negative."),

    currentPrice: z.coerce
        .number()
        .finite()
        .min(0, "Current price cannot be negative."),

    currentValue: z.coerce
        .number()
        .finite()
        .min(0, "Current value cannot be negative."),

    purchaseDate: z.string().trim().optional(),

    status: z.nativeEnum(InvestmentStatus),

    notes: z.string().trim().optional(),
});

export type InvestmentFormInput =
    z.input<typeof investmentSchema>;

export type InvestmentFormValues =
    z.output<typeof investmentSchema>;
