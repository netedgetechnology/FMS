import { z } from "zod";

export const categorySchema = z.object({
    parentId:
        z.string()
            .trim()
            .optional(),

    name:
        z.string()
            .trim()
            .min(
                1,
                "Category name is required."
            ),

    categoryType:
        z.enum([
            "INCOME",
            "EXPENSE",
            "TRANSFER",
        ]),

    financeScope:
        z.enum([
            "PERSONAL",
            "BUSINESS",
        ]),

    businessEntityId:
        z.string()
            .trim()
            .optional(),

    description:
        z.string()
            .trim()
            .optional(),

    isActive:
        z.boolean()
            .default(true),
});

export type CategoryFormInput =
    z.input<typeof categorySchema>;

export type CategoryFormValues =
    z.output<typeof categorySchema>;
