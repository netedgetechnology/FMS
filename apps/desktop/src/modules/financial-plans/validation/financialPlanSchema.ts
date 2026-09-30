import { z } from "zod";

import {
    FINANCIAL_PLAN_STATUSES,
    PLAN_PERIOD_TYPES,
    PLAN_TYPES,
    planTypeRequiresTarget,
} from "../constants";
import { isValidIsoDate } from "../services/financialPlanValidation";

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

        // Chained on the field itself (not deferred to superRefine)
        // deliberately: a zod object aborts before superRefine runs as
        // soon as ANY sibling field fails (e.g. an invalid enum), which
        // would otherwise silently drop the start-date error whenever
        // another field is also invalid. Field-level checks always run.
        startDate: z
            .string()
            .min(1, "Start date is required.")
            .refine(
                isValidIsoDate,
                "Start date must be a valid date."
            ),

        endDate: z
            .string()
            .optional()
            .or(z.literal(""))
            .refine(
                value => !value || isValidIsoDate(value),
                "End date must be a valid date."
            ),

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

        status: z.enum(FINANCIAL_PLAN_STATUSES),
    })
    .superRefine((values, context) => {
        const endDate = (
            values.endDate ?? ""
        ).trim();

        // Both individual formats are already field-checked above; only
        // compare them once both are actually valid ISO dates, otherwise
        // this would pile a confusing second issue onto an already
        // malformed field.
        if (
            endDate &&
            isValidIsoDate(endDate) &&
            isValidIsoDate(values.startDate) &&
            endDate < values.startDate
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
            !endDate
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
