import type {
    NormalizedLoanScheduleCandidate,
    ImportValidationResult,
    ImportValidationError,
} from "../types";

export function validateLoanScheduleCandidates(
    candidates: NormalizedLoanScheduleCandidate[]
): ImportValidationResult {
    const errors: ImportValidationError[] = [];

    for (const candidate of candidates) {
        if (
            candidate.dueDate === null &&
            candidate.paymentDate === null
        ) {
            errors.push({
                rowNumber: candidate.rowNumber,
                field: "dueDate",
                message:
                    "A valid due date or payment date is required.",
            });
        }

        if (candidate.emi === null) {
            errors.push({
                rowNumber: candidate.rowNumber,
                field: "emi",
                message:
                    "A valid EMI amount is required.",
            });
        }

        if (candidate.principal === null) {
            errors.push({
                rowNumber: candidate.rowNumber,
                field: "principal",
                message:
                    "A valid principal amount is required.",
            });
        }

        if (candidate.interest === null) {
            errors.push({
                rowNumber: candidate.rowNumber,
                field: "interest",
                message:
                    "A valid interest amount is required.",
            });
        }

        if (candidate.outstandingPrincipal === null) {
            errors.push({
                rowNumber: candidate.rowNumber,
                field: "outstandingBalance",
                message:
                    "A valid outstanding balance is required.",
            });
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}
