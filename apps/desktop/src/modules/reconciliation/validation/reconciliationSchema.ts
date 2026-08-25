import { z } from "zod";

export const reconciliationSchema = z.object({
    accountId: z
        .string()
        .trim()
        .min(1, "Account is required."),

    statementDate: z
        .string()
        .trim()
        .min(1, "Statement date is required."),

    statementBalance: z.coerce
        .number()
        .finite("Statement balance must be a valid number."),

    notes: z
        .string()
        .trim()
        .optional(),
});

export type ReconciliationFormInput =
    z.input<typeof reconciliationSchema>;

export type ReconciliationFormValues =
    z.output<typeof reconciliationSchema>;
