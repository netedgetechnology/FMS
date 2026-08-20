import { z } from "zod";

export const financialGoalSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Goal name is required."),

    goalCategory: z
        .string()
        .min(1, "Goal category is required."),

    goalSubcategory: z
        .string()
        .min(1, "Goal subcategory is required."),

    targetAmount: z
        .number()
        .positive("Target amount must be greater than zero."),

    currentAmount: z
        .number()
        .nonnegative("Current amount cannot be negative."),

    currencyId: z
        .string()
        .min(1, "Currency is required."),

    targetDate: z
        .string()
        .optional()
        .or(z.literal("")),

    priority: z
        .number()
        .int("Priority must be a whole number.")
        .min(0, "Priority cannot be negative.")
        .max(10, "Priority cannot be greater than 10."),

    status: z.enum([
        "ACTIVE",
        "COMPLETED",
        "PAUSED",
        "CANCELLED",
    ]),

    notes: z
        .string()
        .optional(),
});

export type FinancialGoalFormValues =
    z.infer<typeof financialGoalSchema>;

