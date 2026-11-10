import { z } from "zod";

import { LoanKind, type CreateLoanRequest } from "../types";
import { loanAccountNumberSchema, normalizeLoanAccountNumber } from "./loanSchema";

/** The Add / Edit Overdraft form - only the fields an OD has. */
export const overdraftSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Overdraft name is required."),

    lenderInstitutionName: z
        .string()
        .trim()
        .optional(),

    loanAccountNumber: loanAccountNumberSchema,

    // OD movements are recognised on these accounts only - one or more.
    accountIds: z
        .array(z.string().trim().min(1))
        .min(1, "Choose at least one bank account this overdraft is linked to."),

    currencyId: z
        .string()
        .trim()
        .min(1, "Currency is required."),

    creditLimit: z.coerce
        .number()
        .finite()
        .positive("The OD limit must be greater than 0."),

    openingUsed: z.coerce
        .number()
        .finite()
        .min(0, "The opening used amount cannot be negative."),

    // Optional (migration 051): caps the available amount below the limit.
    // Blank = not recorded, the limit applies.
    drawingPower: z
        .number()
        .finite()
        .min(0, "Drawing power cannot be negative.")
        .nullable()
        .optional(),

    openingUsedAsOf: z
        .string()
        .trim()
        .min(1, "Enter the date the used amount is as of."),

    startDate: z
        .string()
        .trim()
        .min(1, "Start date is required."),

    interestRate: z.coerce
        .number()
        .finite()
        .min(0, "Interest rate cannot be negative.")
        .catch(0),

    status: z.enum(["ACTIVE", "CLOSED", "ON_HOLD", "DEFAULTED"]),

    notes: z
        .string()
        .trim()
        .optional(),
});

export type OverdraftFormInput = z.input<typeof overdraftSchema>;

/**
 * Blank drawing power input -> null (not recorded); never NaN. react-hook-
 * form also passes back the saved value as it is - a number, or null when
 * none is recorded - so those are kept, not treated as text.
 */
export function drawingPowerValue(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;

    return value.trim() === "" ? null : Number(value);
}
export type OverdraftFormValues = z.output<typeof overdraftSchema>;

/**
 * The loan request for an Overdraft. The Term Loan fields get fixed
 * values (LoanService also enforces them): there is no principal, tenure,
 * EMI or schedule, and nothing is stored as outstanding - the used amount
 * is always derived.
 */
export function overdraftRequestFromValues(
    values: OverdraftFormValues
): CreateLoanRequest {
    return {
        loanKind: LoanKind.OVERDRAFT,
        loanType: "Overdraft",
        name: values.name,
        loanAccountNumber: normalizeLoanAccountNumber(values.loanAccountNumber),
        lenderInstitutionName: values.lenderInstitutionName || undefined,
        // The first account, for code that reads one; the OD uses them all.
        accountId: values.accountIds[0] ?? null,
        linkedAccountIds: values.accountIds,
        currencyId: values.currencyId,
        creditLimit: values.creditLimit,
        openingUsed: values.openingUsed,
        openingUsedAsOf: values.openingUsedAsOf,
        drawingPower: values.drawingPower ?? null,
        startDate: values.startDate,
        interestRate: values.interestRate,
        interestType: "REDUCING",
        principalAmount: 0,
        tenureMonths: null,
        emiAmount: null,
        firstInstallmentAmount: null,
        maturityDate: null,
        paidInstallments: 0,
        outstandingPrincipal: 0,
        outstandingInterest: 0,
        status: values.status,
        notes: values.notes || undefined,
    };
}

/**
 * What "Opening Used As Of" should be after the Start Date changes: it
 * follows the Start Date until the user sets it themselves. A date the
 * user entered, or one already saved on the OD, is never overwritten.
 */
export function openingUsedAsOfAfterStartDate(state: {
    startDate: string;
    openingUsedAsOf: string;
    /** The user changed the as-of field, or it holds a saved date. */
    keepAsOf: boolean;
}): string {
    return state.keepAsOf ? state.openingUsedAsOf : state.startDate;
}
