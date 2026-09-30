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

    subcategoryId:
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

    // The original transaction narration/description - stored as
    // `originalNarration`, the same field imported transactions populate
    // from their source statement (see ImportService). Independent from
    // Payee and Notes.
    description:
        z.string()
            .trim()
            .optional(),

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

    tags:
        z.string()
            .trim()
            .optional(),

    status:
        z.enum([
            "PENDING",
            "CLEARED",
        ]),

    paymentMethod:
        z.enum([
            "CASH",
            "CARD",
            "DEBIT_CARD",
            "UPI",
            "BANK_TRANSFER",
            "DIRECT_DEBIT",
            "OTHER",
        ])
            .nullable()
            .optional(),

    upiReference:
        z.string()
            .trim()
            .optional(),

    bankTransactionReference:
        z.string()
            .trim()
            .optional(),

    cardReference:
        z.string()
            .trim()
            .optional(),

    // Never entered by the user: derived by TransactionForm from the
    // transaction's Debit/Credit (Expense -> OUT, Income -> IN) when its
    // Type becomes Transfer. null for Income/Expense, or for a legacy
    // transfer saved before directions were recorded.
    transferDirection:
        z.enum([
            "OUT",
            "IN",
        ])
            .nullable()
            .optional(),
});

export type TransactionFormInput =
    z.input<typeof transactionSchema>;

export type TransactionFormValues =
    z.output<typeof transactionSchema>;

