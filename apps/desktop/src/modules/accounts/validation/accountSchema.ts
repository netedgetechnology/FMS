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

    description: z.string().trim().optional(),

    isActive: z.boolean(),
});

export type AccountFormInput = z.input<typeof accountSchema>;

export type AccountFormValues = z.output<typeof accountSchema>;
