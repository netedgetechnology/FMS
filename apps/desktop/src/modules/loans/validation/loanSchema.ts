import { z } from "zod";

export const loanSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Loan name is required."),

    loanType: z
        .string()
        .trim()
        .min(1, "Loan type is required."),

    lenderInstitutionName: z
        .string()
        .trim()
        .optional(),

    accountId: z
        .string()
        .trim()
        .optional(),

    currencyId: z
        .string()
        .trim()
        .min(1, "Currency is required."),

    principalAmount: z.coerce
        .number()
        .finite()
        .positive("Principal amount must be greater than 0.")
        .min(0, "Principal amount cannot be negative."),

    interestRate: z.coerce
        .number()
        .finite()
        .min(0, "Interest rate cannot be negative."),

    interestType: z.enum(["REDUCING", "FLAT"]),

    tenureMonths: z.coerce
        .number()
        .int()
        .min(1, "Tenure must be at least 1 month.")
        .optional(),

    emiAmount: z.coerce
        .number()
        .finite()
        .min(0, "EMI amount cannot be negative.")
        .optional(),

    paidInstallments: z.coerce
        .number()
        .int()
        .min(0, "Paid installments cannot be negative.")
        .catch(0),

    startDate: z
        .string()
        .trim()
        .min(1, "Start date is required."),

    maturityDate: z
        .string()
        .trim()
        .optional(),

    outstandingPrincipal: z.coerce
        .number()
        .finite()
        .min(0, "Outstanding principal cannot be negative."),

    outstandingInterest: z.coerce
        .number()
        .finite()
        .min(0, "Outstanding interest cannot be negative."),

    status: z.enum([
        "ACTIVE",
        "CLOSED",
        "ON_HOLD",
        "DEFAULTED",
    ]),

    notes: z
        .string()
        .trim()
        .optional(),
});

export type LoanFormInput = z.input<typeof loanSchema>;
export type LoanFormValues = z.output<typeof loanSchema>;
