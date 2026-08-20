import { z } from "zod";

export const financialPlanSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Plan name is required."),

    planCategory: z
        .string()
        .min(1, "Plan category is required."),

    planSubcategory: z
        .string()
        .min(1, "Plan subcategory is required."),

    planType: z
        .string()
        .trim()
        .min(1, "Plan type is required."),

    startDate: z
        .string()
        .min(1, "Start date is required."),

    endDate: z
        .string()
        .optional()
        .or(z.literal("")),

    currencyId: z
        .string()
        .min(1, "Currency is required."),

    targetAmount: z
        .number()
        .nonnegative("Target amount cannot be negative.")
        .nullable()
        .optional(),

    notes: z
        .string()
        .optional(),

    status: z.enum([
        "ACTIVE",
        "COMPLETED",
        "ARCHIVED",
    ]),
});

export type FinancialPlanFormValues =
    z.infer<typeof financialPlanSchema>;
