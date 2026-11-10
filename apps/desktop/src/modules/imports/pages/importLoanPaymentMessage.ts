import type { LoanImportPaymentSummary } from "@/modules/loans/services/LoanImportPaymentService";
import { OVERDRAFT_ENTRY_KIND_LABELS } from "@/modules/loans/types/LoanKind";

/**
 * The sentence appended to the import result message about loan EMI
 * payments (see LoanImportPaymentService) - "" when the import had none.
 */
export function describeLoanImportPayments(
    summary: LoanImportPaymentSummary | undefined
): string {
    if (!summary) {
        return "";
    }

    const parts: string[] = [];
    const applied = summary.applied.length;

    if (applied > 0) {
        parts.push(
            `${applied} loan EMI payment${applied === 1 ? " was" : "s were"} applied automatically (${summary.applied
                .map(
                    payment =>
                        `${payment.loanName} instalment ${payment.installmentNumber}${
                            payment.installmentStatus === "PAID" ? "" : ", partial"
                        }`
                )
                .join("; ")}).`
        );
    }

    const linked = summary.overdraftApplied ?? [];

    if (linked.length > 0) {
        parts.push(
            `${linked.length} overdraft transaction${linked.length === 1 ? " was" : "s were"} linked automatically (${linked
                .map(entry => `${entry.loanName} ${OVERDRAFT_ENTRY_KIND_LABELS[entry.entryKind].toLowerCase()}`)
                .join("; ")}).`
        );
    }

    const review = summary.needsReview.length;

    if (review > 0) {
        // Each one, with its reason and a Link to Loan EMI action, is
        // listed under the message (ImportLoanPaymentReview).
        parts.push(
            `${review} loan payment${review === 1 ? " needs" : "s need"} your attention.`
        );
    }

    return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}
