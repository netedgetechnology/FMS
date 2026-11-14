// ---------------------------------------------------------------------
// Customer review of an analysed statement - what the engine found, what
// the customer changed, and which existing Add Loan workflow it may feed.
// Pure: no database, no React. Nothing here creates anything.
// ---------------------------------------------------------------------

import {
    FACILITY_TYPE_LABELS,
    FIELDS_BY_TYPE,
    FIELD_LABELS,
    buildExtension,
    type ChargeRow,
    type ConflictItem,
    type DisbursementRow,
    type ExtractedField,
    type FacilityExtension,
    type FacilityExtraction,
    type FacilityType,
    type FieldAlternative,
    type FieldId,
    type FieldKind,
    type FieldValue,
    type Provenance,
    type SourceRef,
} from "@financeos/import-engine";

import { DROPLINE_OVERDRAFT_ENABLED } from "../setup/droplineSchedule";
import { LoanKind } from "../types";
import { rateReviewFromFacility, setOriginalRate, updateRateProposal, type ProposalChange, type StatementRateReview } from "./statementRateProposals";

export type StatementRoute =
    | { kind: "WIZARD"; loanKind: LoanKind; loanCategory: string; limitations: string[]; dropline: boolean }
    | { kind: "UNSUPPORTED"; reason: string; minimumExtension: string[] };

/**
 * Which existing workflow can safely hold a confirmed type. A type FinWea's
 * model cannot represent is reported, never saved as something else.
 */
export function routeForType(type: FacilityType, droplineEnabled: boolean = DROPLINE_OVERDRAFT_ENABLED): StatementRoute {
    switch (type) {
        case "TERM_LOAN":
            return { kind: "WIZARD", loanKind: LoanKind.TERM_LOAN, loanCategory: "", limitations: [], dropline: false };
        case "OVERDRAFT":
            return { kind: "WIZARD", loanKind: LoanKind.OVERDRAFT, loanCategory: "Overdraft", limitations: [], dropline: false };
        case "CASH_CREDIT":
            return {
                kind: "WIZARD",
                loanKind: LoanKind.OVERDRAFT,
                loanCategory: "Cash Credit",
                dropline: false,
                limitations: [
                    "Cash Credit uses the revolving (Overdraft) workflow, labelled Cash Credit. Limit, drawing power, used and available amounts work the same way, and drawing more than the drawing power is flagged Over Drawing Power.",
                    "FinWea stores only the current drawing power: revise it in Edit Loan when the lender does. Earlier drawing-power figures and stock / book-debt values are kept in the loan's Notes, not as data.",
                ],
            };
        case "DROPLINE_OVERDRAFT":
            if (droplineEnabled) {
                return {
                    kind: "WIZARD",
                    loanKind: LoanKind.OVERDRAFT,
                    loanCategory: "Dropline Overdraft",
                    dropline: true,
                    limitations: [],
                };
            }

            return {
                kind: "UNSUPPORTED",
                reason: "A Dropline Overdraft's drawing power falls on a schedule, and saving that schedule needs a database update that has not been applied yet. Saving it as an ordinary Overdraft would overstate the available amount.",
                minimumExtension: ["Approve and apply database update 053 (a drawing-power schedule table). The setup and date-based available-limit calculation are built and waiting for it."],
            };
        case "DEMAND_LOAN":
            return {
                kind: "UNSUPPORTED",
                reason: "A Demand Loan is repayable on demand with no instalments. FinWea's Term Loan requires an EMI schedule, and its Overdraft a revolving limit.",
                minimumExtension: [
                    "A Demand Loan loan type. loans.loan_kind only allows Term Loan or Overdraft (a database CHECK rule), and SQLite can only widen that rule by rebuilding the whole loans table - a larger database update than any applied so far, needing its own approval.",
                    "A no-schedule, non-revolving workflow: one disbursement, interest serviced separately, repayments that reduce the outstanding and are never re-drawable, and an optional repayment-on-demand or due date - none of the existing Term Loan or Overdraft rules fit.",
                ],
            };
        case "OTHER_UNKNOWN":
            return {
                kind: "UNSUPPORTED",
                reason: "The facility type is not known, so no setup workflow can be chosen for it. Choose the correct type above if you know it.",
                minimumExtension: [],
            };
    }
}

export interface ReviewField {
    id: FieldId;
    kind: FieldKind;
    label: string;
    value: FieldValue | null;
    status: ExtractedField["status"];
    provenance: Provenance | null;
    confidence: ExtractedField["confidence"];
    verification: ExtractedField["verification"];
    sources: SourceRef[];
    alternatives: FieldAlternative[];
    note: string | null;
}

export interface ReviewDisbursement extends Omit<DisbursementRow, "provenance" | "page"> {
    key: string;
    provenance: Provenance;
}

export interface ReviewCharge extends Omit<ChargeRow, "page"> {
    key: string;
    provenance: Provenance;
}

export interface StatementReviewState {
    fileName: string;
    facility: FacilityExtraction;
    /** null until the customer chooses, when the engine asks them to. */
    selectedType: FacilityType | null;
    fields: Record<FieldId, ReviewField>;
    disbursements: ReviewDisbursement[];
    charges: ReviewCharge[];
    /** The statement's rate changes, as proposed history entries (Stage 4). */
    rates: StatementRateReview;
    confirmed: boolean;
    droplineEnabled: boolean;
}

function reviewField(id: FieldId, field: ExtractedField | undefined): ReviewField {
    return {
        id,
        kind: field?.kind ?? "text",
        label: FIELD_LABELS[id],
        value: field?.value ?? null,
        status: field?.status ?? "NOT_IN_DOCUMENT",
        provenance: field?.provenance ?? null,
        confidence: field?.confidence ?? null,
        verification: field?.verification ?? null,
        sources: field?.sources ?? [],
        alternatives: field?.alternatives ?? [],
        note: field?.note ?? null,
    };
}

export function createReviewState(
    facility: FacilityExtraction,
    fileName: string,
    droplineEnabled: boolean = DROPLINE_OVERDRAFT_ENABLED
): StatementReviewState {
    const fields = Object.fromEntries(
        (Object.keys(FIELD_LABELS) as FieldId[]).map(id => {
            const field = facility.fields[id] ?? Object.values(facility.groups).find(group => group[id])?.[id];

            return [id, reviewField(id, field)];
        })
    ) as Record<FieldId, ReviewField>;

    return {
        fileName,
        facility,
        selectedType: facility.classification.confirmationRequired ? null : facility.classification.detected,
        fields,
        disbursements: facility.disbursements.map((row, index) => ({ ...row, key: `d-${index}` })),
        charges: facility.charges.map((row, index) => ({ ...row, key: `c-${index}`, provenance: "SOURCE" })),
        rates: rateReviewFromFacility(facility, typeof fields.interestTypeText.value === "string" ? fields.interestTypeText.value : null),
        confirmed: false,
        droplineEnabled,
    };
}

export function selectType(state: StatementReviewState, type: FacilityType): StatementReviewState {
    return { ...state, selectedType: type, confirmed: false };
}

export function editField(state: StatementReviewState, id: FieldId, value: FieldValue | null): StatementReviewState {
    const blank = value === null || value === "";
    const field: ReviewField = { ...state.fields[id], value: blank ? null : value, status: blank ? "NOT_IN_DOCUMENT" : "FOUND", provenance: blank ? null : "MANUAL", verification: null, confidence: null, note: null };

    return { ...state, confirmed: false, fields: { ...state.fields, [id]: field } };
}

export function chooseAlternative(state: StatementReviewState, id: FieldId, alternative: FieldAlternative): StatementReviewState {
    const field: ReviewField = { ...state.fields[id], value: alternative.value, status: "FOUND", provenance: "SOURCE", sources: alternative.sources };

    return { ...state, confirmed: false, fields: { ...state.fields, [id]: field } };
}

export function updateDisbursement(state: StatementReviewState, key: string, change: Partial<ReviewDisbursement>): StatementReviewState {
    return {
        ...state,
        confirmed: false,
        disbursements: state.disbursements.map(row => (row.key === key ? { ...row, ...change, provenance: "MANUAL" } : row)),
    };
}

export function removeDisbursement(state: StatementReviewState, key: string): StatementReviewState {
    return { ...state, confirmed: false, disbursements: state.disbursements.filter(row => row.key !== key) };
}

export function updateCharge(state: StatementReviewState, key: string, change: Partial<ReviewCharge>): StatementReviewState {
    return {
        ...state,
        confirmed: false,
        charges: state.charges.map(row => (row.key === key ? { ...row, ...change, provenance: "MANUAL" } : row)),
    };
}

export function removeCharge(state: StatementReviewState, key: string): StatementReviewState {
    return { ...state, confirmed: false, charges: state.charges.filter(row => row.key !== key) };
}

/** Corrects one proposed rate change (its date, rate, type, or leaving it out). */
export function editRateProposal(state: StatementReviewState, key: string, change: ProposalChange): StatementReviewState {
    return { ...state, confirmed: false, rates: updateRateProposal(state.rates, key, change) };
}

/** Sets the rate from the loan's start date, when the statement does not print it. */
export function editOriginalRate(state: StatementReviewState, rate: number | null): StatementReviewState {
    return { ...state, confirmed: false, rates: setOriginalRate(state.rates, rate) };
}

export function setConfirmed(state: StatementReviewState, confirmed: boolean): StatementReviewState {
    return { ...state, confirmed };
}

export interface ReviewSection {
    title: string;
    fieldIds: FieldId[];
}

const SECTION_TITLES: Array<{ title: string; ids: FieldId[] }> = [
    { title: "Lender and facility", ids: ["lenderName", "customerName", "loanAccountNumber", "agreementNumber", "linkedAccountNumber", "productName", "schemeName", "branchName", "accountStatus", "currencyCode", "statementFrom", "statementTo"] },
    { title: "Financial terms", ids: ["sanctionedAmount", "sanctionDate", "startDate", "maturityDate", "tenureMonths"] },
    { title: "Limits and drawing power", ids: ["currentLimit", "initialDrawingPower", "drawingPower", "availableAmount", "reductionFrequency"] },
    { title: "Interest", ids: ["interestRate", "currentInterestRate", "interestTypeText", "benchmarkName", "benchmarkRateText"] },
    { title: "Repayment", ids: ["emiAmount", "repaymentFrequency", "firstInstalmentDate", "instalmentsPaid", "instalmentsPaidAmount", "instalmentsRemaining", "principalRepaidTotal", "interestPaidTotal"] },
    { title: "Disbursement", ids: ["grossDisbursed", "netDisbursed", "disbursementDate", "totalDeductions"] },
    { title: "Outstanding balances", ids: ["openingUtilised", "openingUtilisedDate", "currentUtilised", "outstandingPrincipal", "accruedInterest", "chargesDue", "penalInterest", "totalOutstanding", "principalOverdue", "overdueAmount"] },
    { title: "Stock and drawing-power basis", ids: ["stockValue", "bookDebts", "marginPercent", "stockStatementDate"] },
];

/** A section shows the fields this type needs and any field the document itself states. */
export function reviewSections(state: StatementReviewState): ReviewSection[] {
    const needed = new Set<FieldId>(FIELDS_BY_TYPE[state.selectedType ?? state.facility.classification.detected]);

    return SECTION_TITLES.map(section => ({
        title: section.title,
        fieldIds: section.ids.filter(id => needed.has(id) || state.fields[id].provenance === "SOURCE" || state.fields[id].provenance === "MANUAL" || state.fields[id].status === "CONFLICT"),
    })).filter(section => section.fieldIds.length > 0);
}

export function selectedExtension(state: StatementReviewState): FacilityExtension | null {
    return state.selectedType ? buildExtension(state.facility, state.selectedType) : null;
}

export function typeLabel(type: FacilityType): string {
    return FACILITY_TYPE_LABELS[type];
}

/** Calculated cross-checks and other statement-level findings to surface. */
export function reconciliationFindings(state: StatementReviewState): ConflictItem[] {
    return state.facility.conflicts.filter(item => item.fieldId === null || state.facility.fields[item.fieldId]?.status !== "CONFLICT");
}

/** Facts the confirmed type normally has that the statement does not give. */
export function missingForSelection(state: StatementReviewState): string[] {
    const type = state.selectedType ?? state.facility.classification.detected;

    return FIELDS_BY_TYPE[type].filter(id => state.fields[id].status === "NOT_IN_DOCUMENT").map(id => state.fields[id].label);
}

/** Why the customer cannot continue yet; an empty list means they can. */
export function reviewBlockers(state: StatementReviewState): string[] {
    const blockers: string[] = [];

    if (state.selectedType === null) {
        blockers.push("Confirm the loan type: the statement alone is not enough to be sure of it.");
        return blockers;
    }

    const route = routeForType(state.selectedType, state.droplineEnabled);
    if (route.kind === "UNSUPPORTED") {
        blockers.push(`${typeLabel(state.selectedType)} cannot be set up in FinWea yet, so nothing can be created from this statement under that type.`);
        return blockers;
    }

    for (const section of reviewSections(state)) {
        for (const id of section.fieldIds) {
            if (state.fields[id].status === "CONFLICT") {
                blockers.push(`${state.fields[id].label}: the document states different values - choose one.`);
            }
        }
    }

    if (!state.confirmed) blockers.push("Tick the confirmation once you have checked the details.");

    return blockers;
}
