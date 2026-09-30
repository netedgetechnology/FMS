import { z } from "zod";

/**
 * The focused Update Price dialog only ever collects one field - the
 * new currentPrice. Deliberately not a subset of investmentSchema (no
 * shared object to import from), but the rule itself must stay
 * identical: same bounds, same message, as investmentSchema's own
 * currentPrice field.
 */
export const updateInvestmentPriceSchema = z.object({
    currentPrice: z.coerce
        .number()
        .finite()
        .min(0, "Current price cannot be negative."),
});

export type UpdateInvestmentPriceFormInput =
    z.input<typeof updateInvestmentPriceSchema>;

export type UpdateInvestmentPriceFormValues =
    z.output<typeof updateInvestmentPriceSchema>;
