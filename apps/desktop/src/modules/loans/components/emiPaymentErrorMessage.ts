import { EmiPaymentSaveError } from "../repositories/emiPaymentAtomic";

/**
 * What the EMI Schedule dialog tells the user when recording or reversing
 * a payment fails. A business-rule refusal (a plain Error) keeps its own
 * clear message; a technical failure shows a friendly message while the
 * raw cause goes to the console for diagnostics - never silently hidden,
 * never shown as SQL/stack text.
 */
export function emiPaymentErrorMessage(
    error: unknown,
    fallback: string
): string {
    if (error instanceof EmiPaymentSaveError) {
        console.error(fallback, error.technicalDetail);

        return error.message;
    }

    console.error(fallback, error);

    return error instanceof Error && error.message
        ? error.message
        : fallback;
}
