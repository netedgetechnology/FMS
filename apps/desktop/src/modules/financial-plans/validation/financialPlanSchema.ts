import { z } from "zod";

import {
    PLAN_PERIOD_TYPES,
    PLAN_TYPES,
    planTypeRequiresTarget,
} from "../constants";

export const financialPlanSchema = z
    .object({
        name: z
            .string()
            .trim()
            .min(1, "Plan name is required.")
            .max(120, "Plan name is too long."),

        planType: z.enum(PLAN_TYPES),

        planCategory: z
            .string()
            .min(1, "Plan category is required."),

        planSubcategory: z
            .string()
            .min(1, "Plan focus is required."),

        periodType: z.enum(PLAN_PERIOD_TYPES),

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

        goalId: z
            .string()
            .optional()
            .or(z.literal(""))
            .nullable(),

        notes: z.string().optional(),

        status: z.enum([
            "ACTIVE",
            "COMPLETED",
            "ARCHIVED",
        ]),
    })
    .superRefine((values, context) => {
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

        if (
            values.periodType === "ONE_TIME" &&
            !values.endDate
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["endDate"],
                message:
                    "A one-time plan needs an end date.",
            });
        }

        if (
            planTypeRequiresTarget(values.planType) &&
            (values.targetAmount === null ||
                values.targetAmount === undefined)
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["targetAmount"],
                message:
                    values.planType === "CASHFLOW_TARGET"
                        ? "A cash-flow plan needs a per-period target amount."
                        : "An expense plan needs a target amount.",
            });
        }
    });

export type FinancialPlanFormValues =
    z.infer<typeof financialPlanSchema>;
