import type {
    NormalizedTransactionCandidate,
    ImportValidationResult,
} from "../types";

export function validateCandidates(
    candidates: NormalizedTransactionCandidate[]
): ImportValidationResult {
    const errors = [];

    for (const candidate of candidates) {
        if (
            !candidate.transactionDate
        ) {
            errors.push({
                rowNumber: candidate.rowNumber,
                field: "transactionDate",
                message:
                    "Transaction date is required.",
            });
        }

        if (
            !candidate.payee &&
            !candidate.description
        ) {
            errors.push({
                rowNumber: candidate.rowNumber,
                field: "payee",
                message:
                    "Payee or description is required.",
            });
        }

        if (
            candidate.amount === null ||
            candidate.amount <= 0
        ) {
            errors.push({
                rowNumber: candidate.rowNumber,
                field: "amount",
                message:
                    "A valid positive amount is required.",
            });
        }

        if (!candidate.type) {
            errors.push({
                rowNumber: candidate.rowNumber,
                field: "type",
                message:
                    "Transaction type could not be determined.",
            });
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}
