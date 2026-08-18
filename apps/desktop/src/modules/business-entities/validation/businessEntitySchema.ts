import { z } from "zod";

export const businessEntitySchema = z.object({

    name:
        z.string()
            .trim()
            .min(
                1,
                "Business entity name is required."
            ),

    legalName:
        z.string()
            .trim()
            .optional(),

    taxIdentifier:
        z.string()
            .trim()
            .optional(),

    currencyId:
        z.string()
            .trim()
            .min(
                1,
                "Currency is required."
            ),

    description:
        z.string()
            .trim()
            .optional(),

    isActive:
        z.boolean()
            .default(true),
});

export type BusinessEntityFormInput =
    z.input<typeof businessEntitySchema>;

export type BusinessEntityFormValues =
    z.output<typeof businessEntitySchema>;
