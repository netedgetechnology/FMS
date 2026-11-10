import { z } from "zod";

/** Longest Loan Account Number accepted. */
export const LOAN_ACCOUNT_NUMBER_MAX_LENGTH = 64;

/** Optional Loan Account Number - shared by the Term Loan and Overdraft forms. */
export const loanAccountNumberSchema = z
    .string()
    .trim()
    .max(
        LOAN_ACCOUNT_NUMBER_MAX_LENGTH,
        `Loan account number can't be longer than ${LOAN_ACCOUNT_NUMBER_MAX_LENGTH} characters.`
    )
    .optional();

/**
 * The value stored for a Loan Account Number: trimmed text, or null when
 * blank. Never converted to a number, so "0099000123" stays as typed.
 */
export function normalizeLoanAccountNumber(
    value: string | null | undefined
): string | null {
    const trimmed = (value ?? "").trim();

    return trimmed.length > 0 ? trimmed : null;
}

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

    // Free text: letters, digits, hyphens, slashes ... as the lender
    // prints it. Kept as a string so leading zeros are never lost.
    loanAccountNumber: loanAccountNumberSchema,

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

    // Optional broken-period (pre-EMI) interest charged as instalment 1,
    // before the regular EMIs. Empty/0 = the first EMI is the regular EMI.
    firstInstallmentAmount: z.coerce
        .number()
        .finite()
        .min(0, "First instalment cannot be negative.")
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
