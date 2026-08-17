import { z } from "zod";

import { InvestmentTransactionType } from "../types";

export const investmentTransactionSchema =
    z
        .object({
            transactionType: z.nativeEnum(
                InvestmentTransactionType
            ),

            transactionDate: z
                .string()
                .trim()
                .min(
                    1,
                    "Transaction date is required."
                ),

            quantity: z.coerce
                .number()
                .finite()
                .min(
                    0,
                    "Quantity cannot be negative."
                ),

            price: z.coerce
                .number()
                .finite()
                .min(
                    0,
                    "Price cannot be negative."
                ),

            amount: z.coerce
                .number()
                .finite()
                .min(
                    0,
                    "Amount cannot be negative."
                ),

            fees: z.coerce
                .number()
                .finite()
                .min(
                    0,
                    "Fees cannot be negative."
                ),

            taxes: z.coerce
                .number()
                .finite()
                .min(
                    0,
                    "Taxes cannot be negative."
                ),

            referenceNumber: z
                .string()
                .trim()
                .optional(),

            notes: z
                .string()
                .trim()
                .optional(),
        })
        .superRefine(
            (values, context) => {
                switch (values.transactionType) {
                    case InvestmentTransactionType.BUY:
                    case InvestmentTransactionType.SELL: {
                        if (
                            values.quantity <= 0
                        ) {
                            context.addIssue({
                                code: z.ZodIssueCode.custom,
                                path: ["quantity"],
                                message:
                                    "Quantity must be greater than zero.",
                            });
                        }

                        break;
                    }

                    case InvestmentTransactionType.OPENING_BALANCE: {
                        if (
                            values.quantity <= 0
                        ) {
                            context.addIssue({
                                code: z.ZodIssueCode.custom,
                                path: ["quantity"],
                                message:
                                    "Opening balance quantity must be greater than zero.",
                            });
                        }

                        break;
                    }
                    case InvestmentTransactionType.BONUS: {
                        if (
                            values.quantity <= 0
                        ) {
                            context.addIssue({
                                code: z.ZodIssueCode.custom,
                                path: ["quantity"],
                                message:
                                    "Bonus quantity must be greater than zero.",
                            });
                        }

                        if (
                            values.price !== 0
                        ) {
                            context.addIssue({
                                code: z.ZodIssueCode.custom,
                                path: ["price"],
                                message:
                                    "Bonus price must be zero.",
                            });
                        }

                        if (
                            values.amount !== 0
                        ) {
                            context.addIssue({
                                code: z.ZodIssueCode.custom,
                                path: ["amount"],
                                message:
                                    "Bonus amount must be zero.",
                            });
                        }

                        break;
                    }

                    case InvestmentTransactionType.DIVIDEND:
                    case InvestmentTransactionType.INTEREST: {
                        if (
                            values.quantity !== 0
                        ) {
                            context.addIssue({
                                code: z.ZodIssueCode.custom,
                                path: ["quantity"],
                                message:
                                    "Quantity must be zero for this transaction type.",
                            });
                        }

                        if (
                            values.price !== 0
                        ) {
                            context.addIssue({
                                code: z.ZodIssueCode.custom,
                                path: ["price"],
                                message:
                                    "Price must be zero for this transaction type.",
                            });
                        }

                        if (
                            values.amount <= 0
                        ) {
                            context.addIssue({
                                code: z.ZodIssueCode.custom,
                                path: ["amount"],
                                message:
                                    "Amount must be greater than zero.",
                            });
                        }

                        break;
                    }

                    case InvestmentTransactionType.SPLIT: {
                        context.addIssue({
                            code: z.ZodIssueCode.custom,
                            path: ["transactionType"],
                            message:
                                "Split transactions are not available yet.",
                        });

                        break;
                    }

                    case InvestmentTransactionType.OTHER: {
                        context.addIssue({
                            code: z.ZodIssueCode.custom,
                            path: ["transactionType"],
                            message:
                                "Other transactions are not available yet.",
                        });

                        break;
                    }

                    default: {
                        const exhaustiveCheck: never =
                            values.transactionType;

                        return exhaustiveCheck;
                    }
                }
            }
        );

export type InvestmentTransactionFormInput =
    z.input<
        typeof investmentTransactionSchema
    >;

export type InvestmentTransactionFormValues =
    z.output<
        typeof investmentTransactionSchema
    >;

