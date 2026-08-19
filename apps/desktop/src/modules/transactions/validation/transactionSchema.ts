import { z } from "zod";

export const transactionSchema = z.object({
    accountId:
        z.string()
            .trim()
            .min(
                1,
                "Account is required."
            ),

    categoryId:
        z.string()
            .trim()
            .optional(),

    payee:
        z.string()
            .trim()
            .min(
                1,
                "Payee is required."
            ),

    type:
        z.enum([
            "income",
            "expense",
            "transfer",
        ]),

    amount:
        z.coerce
            .number()
            .finite()
            .positive(
                "Amount must be greater than zero."
            ),

    transactionDate:
        z.string()
            .trim()
            .min(
                1,
                "Transaction date is required."
            ),

    referenceNumber:
        z.string()
            .trim()
            .optional(),

    notes:
        z.string()
            .trim()
            .optional(),
});

export type TransactionFormInput =
    z.input<typeof transactionSchema>;

export type TransactionFormValues =
    z.output<typeof transactionSchema>;

