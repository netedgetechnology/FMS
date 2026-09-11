import { z } from "zod";

import { isLinkedGoalMode } from "../constants/goalAccountLinking";

export const financialGoalSchema = z
    .object({
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

        goalMode: z.enum([
            "MANUAL",
            "ACCOUNT_LINKED",
            "DEBT_PAYOFF_LINKED",
            "CATEGORY_CONTRIBUTION_LINKED",
            "LOAN_PAYOFF_LINKED",
            "INVESTMENT_LINKED",
        ]),

        targetAmount: z
            .number()
            .positive(
                "Target amount must be greater than zero."
            ),

        currentAmount: z
            .number()
            .nonnegative(
                "Current amount cannot be negative."
            ),

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
            .max(
                10,
                "Priority cannot be greater than 10."
            ),

        status: z.enum([
            "ACTIVE",
            "COMPLETED",
            "PAUSED",
            "CANCELLED",
        ]),

        notes: z
            .string()
            .optional(),

        /** ACCOUNT_LINKED / DEBT_PAYOFF_LINKED only: accounts selected on creation. */
        accountIds: z
            .array(z.string())
            .optional(),

        /** CATEGORY_CONTRIBUTION_LINKED only: income categories selected on creation. */
        categoryIds: z
            .array(z.string())
            .optional(),

        /** LOAN_PAYOFF_LINKED only: loans selected on creation. */
        loanIds: z
            .array(z.string())
            .optional(),

        /** INVESTMENT_LINKED only: investments selected on creation. */
        investmentIds: z
            .array(z.string())
            .optional(),
    })
    .superRefine((values, ctx) => {
        if (
            values.goalMode ===
            "CATEGORY_CONTRIBUTION_LINKED"
        ) {
            if (
                (values.categoryIds?.length ?? 0) === 0
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["categoryIds"],
                    message:
                        "Select at least one category to link.",
                });
            }
            return;
        }

        if (values.goalMode === "LOAN_PAYOFF_LINKED") {
            if ((values.loanIds?.length ?? 0) === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["loanIds"],
                    message:
                        "Select at least one loan to link.",
                });
            }
            return;
        }

        if (values.goalMode === "INVESTMENT_LINKED") {
            if (
                (values.investmentIds?.length ?? 0) ===
                0
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["investmentIds"],
                    message:
                        "Select at least one investment to link.",
                });
            }
            return;
        }

        if (
            isLinkedGoalMode(values.goalMode) &&
            (values.accountIds?.length ?? 0) === 0
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["accountIds"],
                message:
                    "Select at least one account to link.",
            });
        }
    });

export type FinancialGoalFormValues =
    z.infer<typeof financialGoalSchema>;

