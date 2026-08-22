import { z } from "zod";

export const budgetSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Budget name is required."),

    categoryId: z
        .string()
        .optional()
        .or(z.literal("")),

    businessEntityId: z
        .string()
        .optional()
        .or(z.literal("")),

    amount: z
        .number()
        .positive("Budget amount must be greater than zero."),

    periodType: z.enum([
        "MONTHLY",
        "QUARTERLY",
        "YEARLY",
        "CUSTOM",
    ]),

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

    alertThreshold: z
        .number()
        .min(0, "Alert threshold cannot be negative.")
        .max(100, "Alert threshold cannot exceed 100%."),

    isActive: z.boolean(),
}).superRefine((values, context) => {
    if (
        values.periodType === "CUSTOM" &&
        !values.endDate
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endDate"],
            message:
                "End date is required for a custom budget period.",
        });
    }

    if (
        values.endDate &&
        values.startDate &&
        values.endDate < values.startDate
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endDate"],
            message:
                "End date cannot be before the start date.",
        });
    }
});

export type BudgetFormValues =
    z.infer<typeof budgetSchema>;
