import { z } from "zod";
import { AccountType } from "../types";

export const accountSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Account name is required."),

    type: z.enum(AccountType),

    institutionName: z
        .string()
        .trim()
        .optional(),

    currencyId: z
        .string()
        .trim()
        .min(1, "Currency is required."),

    openingBalance: z.coerce.number().finite(),

    accountNumber: z.string().trim().optional(),

    branchName: z.string().trim().optional(),

    ifscCode: z.string().trim().optional(),

    swiftCode: z.string().trim().optional(),

    iban: z.string().trim().optional(),

    cardNetwork: z
        .enum(["VISA", "MASTERCARD", "AMEX", "RUPAY", "OTHER"])
        .optional(),

    creditLimit: z.coerce.number().finite().min(0).optional(),

    statementDay: z.coerce.number().int().min(1).max(31).optional(),

    paymentDueDay: z.coerce.number().int().min(1).max(31).optional(),

    loanType: z.string().trim().optional(),

    principalAmount: z.coerce.number().finite().min(0).optional(),

    interestRate: z.coerce.number().finite().min(0).optional(),

    interestType: z
        .enum(["REDUCING", "FLAT"])
        .optional(),

    tenureMonths: z.coerce.number().int().min(1).optional(),

    emiAmount: z.coerce.number().finite().min(0).optional(),

    startDate: z.string().trim().optional(),

    maturityDate: z.string().trim().optional(),

    outstandingPrincipal: z.coerce.number().finite().min(0).optional(),

    outstandingInterest: z.coerce.number().finite().min(0).optional(),

    loanStatus: z
        .enum(["ACTIVE", "CLOSED", "ON_HOLD", "DEFAULTED"])
        .optional(),

    description: z.string().trim().optional(),

    isActive: z.boolean(),
});

export type AccountFormInput = z.input<typeof accountSchema>;

export type AccountFormValues = z.output<typeof accountSchema>;


