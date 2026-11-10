// The part of an extraction that only makes sense for one facility type.
// Rebuilt from the common facts, so the customer correcting the type simply
// asks for a different view of the same document.

import type {
    FacilityBase,
    FacilityExtension,
    FacilityType,
    FieldId,
    LedgerEntry,
} from "./types";

const COMMON: FieldId[] = ["lenderName", "loanAccountNumber", "interestRate"];

/** What each type needs. Used to report what the document did not state. */
export const FIELDS_BY_TYPE: Record<FacilityType, FieldId[]> = {
    TERM_LOAN: [
        ...COMMON, "sanctionedAmount", "grossDisbursed", "netDisbursed", "disbursementDate",
        "interestTypeText", "emiAmount", "repaymentFrequency", "tenureMonths", "maturityDate",
        "firstInstalmentDate", "outstandingPrincipal", "accruedInterest", "principalRepaidTotal", "interestPaidTotal",
    ],
    OVERDRAFT: [
        ...COMMON, "sanctionedAmount", "currentLimit", "drawingPower",
        "openingUtilised", "openingUtilisedDate", "currentUtilised", "availableAmount",
    ],
    DROPLINE_OVERDRAFT: [
        ...COMMON, "sanctionedAmount", "initialDrawingPower", "drawingPower", "reductionFrequency",
        "currentUtilised", "maturityDate",
    ],
    CASH_CREDIT: [
        ...COMMON, "sanctionedAmount", "drawingPower", "currentUtilised", "availableAmount",
        "stockValue", "bookDebts", "stockStatementDate",
    ],
    DEMAND_LOAN: [...COMMON, "sanctionedAmount", "outstandingPrincipal", "accruedInterest", "maturityDate"],
    OTHER_UNKNOWN: [...COMMON, "sanctionedAmount", "totalOutstanding"],
};

function entries(base: FacilityBase, ...kinds: LedgerEntry["kind"][]): LedgerEntry[] {
    return base.transactions.filter(entry => kinds.includes(entry.kind));
}

export function buildExtension(base: FacilityBase, type: FacilityType): FacilityExtension {
    const revolving = {
        drawdowns: entries(base, "DRAWDOWN"),
        principalRepayments: entries(base, "REPAYMENT"),
        interestEntries: entries(base, "INTEREST_CHARGE", "INTEREST_PAYMENT"),
        chargeEntries: entries(base, "OTHER_CHARGE"),
        limitChanges: base.limitChanges,
    };

    switch (type) {
        case "TERM_LOAN":
            return { type, schedule: base.schedule, historicalRepayments: entries(base, "REPAYMENT", "INTEREST_PAYMENT") };
        case "OVERDRAFT":
            return { type, ...revolving };
        case "DROPLINE_OVERDRAFT":
            return { type, ...revolving, reductionSchedule: base.limitChanges.filter(change => change.nature === "SCHEDULED") };
        case "CASH_CREDIT":
            return { type, ...revolving, drawingPowerReferences: base.drawingPowerReferences };
        case "DEMAND_LOAN":
            return { type, repayments: entries(base, "REPAYMENT"), interestEntries: entries(base, "INTEREST_CHARGE", "INTEREST_PAYMENT") };
        case "OTHER_UNKNOWN":
            return { type };
    }
}

export function missingFor(base: FacilityBase, type: FacilityType): FieldId[] {
    return FIELDS_BY_TYPE[type].filter(id => base.fields[id]?.status !== "FOUND" && base.fields[id]?.status !== "CONFLICT");
}
