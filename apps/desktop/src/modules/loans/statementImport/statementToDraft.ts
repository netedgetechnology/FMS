// Turns a CONFIRMED statement review into the Add Loan wizard's draft - the
// only link between extraction and loan setup. The wizard's own validation,
// linking rules and atomic save then apply exactly as for typed-in data.
// A value the statement does not give stays blank for the customer to fill.

import { emptyLoanSetupDraft, newKey } from "../setup/loanSetupWizard";
import type { DroplineExtension } from "@financeos/import-engine";

import type {
    DisbursementDraft,
    InitialExpenseDraft,
    LoanSetupDraft,
} from "../setup/loanSetupTypes";
import { LoanKind } from "../types";

import {
    reviewBlockers,
    routeForType,
    selectedExtension,
    type StatementReviewState,
} from "./statementReview";
import { statementFactsFromReview, type StatementFacts } from "./statementReconciliation";
import { hasRateProposals, type StatementRateReview } from "./statementRateProposals";

export interface StatementDraftResult {
    draft: Partial<LoanSetupDraft> & { loanKind: LoanKind };
    /** ISO currency the statement states, for the wizard to preselect. */
    currencyCode: string | null;
    /** What the customer should know about how the draft was filled. */
    notes: string[];
    /** Term Loan: the statement's position, compared on Review with the loan to be saved. */
    statementFacts: StatementFacts | null;
    /**
     * The statement's rate changes as reviewed (Stage 4): proposed history
     * entries, saved only once confirmed - null when it prints none.
     */
    rateHistory: StatementRateReview | null;
}

function money(state: StatementReviewState, id: Parameters<typeof field>[1]): number | null {
    const value = field(state, id);
    return typeof value === "number" ? value : null;
}

function text(state: StatementReviewState, id: Parameters<typeof field>[1]): string {
    const value = field(state, id);
    return typeof value === "string" ? value : "";
}

function field(state: StatementReviewState, id: keyof StatementReviewState["fields"]) {
    return state.fields[id].status === "FOUND" ? state.fields[id].value : null;
}

function statusFrom(value: string): LoanSetupDraft["status"] {
    if (/clos/i.test(value)) return "CLOSED";
    if (/default|npa/i.test(value)) return "DEFAULTED";
    return "ACTIVE";
}

/** The one disbursement built from the statement's stated totals (no table rows). */
export const STATED_DISBURSEMENT_KEY = "stated-disbursement";

function termDraft(state: StatementReviewState, notes: string[]): Partial<LoanSetupDraft> {
    const extension = selectedExtension(state);
    const printedSchedule = extension?.type === "TERM_LOAN" ? extension.schedule : [];
    const gross = money(state, "grossDisbursed");
    const net = money(state, "netDisbursed");

    // Every row keeps the review's own stable key (never its position), so a
    // bank-transaction link made against a row stays with that row when
    // other rows are removed, added or reordered.
    const rows: DisbursementDraft[] = state.disbursements.map(row => ({
        key: row.key,
        date: row.date ?? "",
        grossAmount: row.gross,
        deductionsAmount: row.deductions ?? null,
        destinationAccountId: "",
        reference: row.reference ?? "",
        transaction: null,
    }));

    if (rows.length === 0 && gross !== null) {
        rows.push({
            key: STATED_DISBURSEMENT_KEY,
            date: text(state, "disbursementDate"),
            grossAmount: gross,
            deductionsAmount: net !== null ? Math.round((gross - net) * 100) / 100 : money(state, "totalDeductions"),
            destinationAccountId: "",
            reference: "",
            transaction: null,
        });
    }

    if (rows.length === 0) {
        for (const [index, entry] of state.facility.transactions.filter(row => row.kind === "DRAWDOWN").entries()) {
            rows.push({
                // The ledger is read-only on review, so its order is fixed.
                key: `ledger-drawdown-${index}`,
                date: entry.date,
                grossAmount: entry.amount,
                deductionsAmount: null,
                destinationAccountId: "",
                reference: entry.reference ?? "",
                transaction: null,
            });
        }
        if (rows.length > 0) notes.push("Disbursements were taken from the statement's ledger rows; it does not state deductions for them.");
    }

    // The ledger gives one total withheld across tranches: it goes on the
    // first, and the wizard's rule (deductions = deducted expenses) checks it.
    const totalWithheld = money(state, "totalDeductions");
    if (rows.length > 0 && totalWithheld !== null && totalWithheld > 0 && rows.every(row => !row.deductionsAmount)) {
        rows[0]!.deductionsAmount = totalWithheld;
        if (rows.length > 1) notes.push("The statement gives one total for deductions, so it was placed on the first disbursement. Move it if the lender withheld it differently.");
    }

    const firstDisbursement = rows[0] ?? null;
    const deducted = rows.reduce((sum, row) => sum + Number(row.deductionsAmount ?? 0), 0) > 0;
    const startDate = text(state, "startDate") || firstDisbursement?.date || text(state, "disbursementDate");

    const expenses: InitialExpenseDraft[] = state.charges.map(charge => ({
        key: charge.key,
        expenseType: charge.category,
        description: charge.name,
        expenseDate: charge.date ?? firstDisbursement?.date ?? startDate,
        baseAmount: charge.amount,
        gstRate: null,
        gstAmount: 0,
        settlement: deducted && firstDisbursement ? "DEDUCTED_FROM_DISBURSEMENT" : "PAID_SEPARATELY",
        disbursementKey: deducted && firstDisbursement ? firstDisbursement.key : null,
        paymentMethod: "",
        paymentAccountId: "",
        transactionReference: "",
        transaction: null,
    }));

    const interestType = text(state, "interestTypeText");

    if (printedSchedule.length > 0) {
        notes.push(`The statement prints a schedule of ${printedSchedule.length} instalments. It is shown for checking only; import the lender's official CSV under Repayment Schedule to use a lender schedule.`);
    }

    const current = money(state, "currentInterestRate");
    const original = money(state, "interestRate");
    if (current !== null && original !== null && current !== original) {
        notes.push(
            `The rate changed from ${original}% to ${current}%. The loan is set up at the original ${original}% from its start date, so FinWea's schedule starts from that rate. ` +
                "The statement's rate changes are listed under Interest rate history: where rate history is available, each is recorded after the loan is created, with its revised schedule for you to confirm. Otherwise check the schedule, or import the lender's."
        );
    }

    const agreement = field(state, "agreementNumber");

    const paid = state.facility.transactions.filter(entry => entry.kind === "REPAYMENT" || entry.kind === "INTEREST_PAYMENT").length;
    if (paid > 0) {
        notes.push(`The statement lists ${paid} past repayment(s). None are marked paid automatically - resolve each instalment under Instalments Paid Before FinWea (link its bank debit or mark it settled before FinWea).`);
    }

    const frequency = text(state, "repaymentFrequency");
    if (frequency && !/month/i.test(frequency)) {
        notes.push(`The statement gives a ${frequency} repayment frequency. FinWea's Term Loan schedule is monthly only - check the schedule carefully.`);
    }

    return {
        principalAmount: gross ?? null,
        sanctionedAmount: money(state, "sanctionedAmount"),
        interestRate: money(state, "interestRate") ?? money(state, "currentInterestRate"),
        loanCategory: text(state, "productName"),
        startDate,
        disbursements: rows,
        expenses,
        emiAmount: money(state, "emiAmount"),
        tenureMonths: money(state, "tenureMonths"),
        firstEmiDate: text(state, "firstInstalmentDate"),
        ...(agreement !== null ? { notes: `Lender agreement number: ${agreement}` } : {}),
        ...(/flat/i.test(interestType) ? { interestMethod: "FLAT" as const } : {}),
    };
}

function revolvingDraft(state: StatementReviewState, loanCategory: string, dropline: boolean, notes: string[]): Partial<LoanSetupDraft> {
    const limit = money(state, "sanctionedAmount");
    const statedDp = money(state, "drawingPower");
    const currentLimit = money(state, "currentLimit");
    const drawingPower = dropline ? null : statedDp ?? currentLimit;
    const printedSteps = dropline && selectedExtension(state)?.type === "DROPLINE_OVERDRAFT" ? (selectedExtension(state) as DroplineExtension).reductionSchedule : [];

    if (dropline && printedSteps.length === 0) {
        notes.push("The statement prints no reduction schedule. Enter the drawing-power steps on the Overdraft step.");
    }

    if (!dropline && statedDp === null && currentLimit !== null) {
        notes.push("The statement's current limit was used as the drawing power, because it states no drawing power of its own.");
    }

    const openingUsed = money(state, "openingUtilised");
    const openingAsOf = text(state, "openingUtilisedDate");
    if (state.fields.openingUtilised.provenance === "CALCULATED") {
        notes.push(`Opening used was calculated from the first statement row, as of ${openingAsOf}. Check it before saving.`);
    }

    const startDate = text(state, "startDate") || text(state, "sanctionDate");
    if (!text(state, "startDate") && startDate) notes.push("The sanction date was used as the start date, because the statement states no start date.");

    const extension = selectedExtension(state);
    const references =
        extension?.type === "CASH_CREDIT"
            ? [
                  ...extension.drawingPowerReferences.map(reference => reference.raw),
                  ...extension.limitChanges.map(change => change.raw),
              ]
            : [];

    return {
        loanCategory,
        creditLimit: limit,
        drawingPower,
        openingUsed,
        openingUsedAsOf: openingAsOf,
        dropline,
        drawingPowerSchedule: printedSteps.map(step => ({ key: newKey(), effectiveDate: step.effectiveDate ?? "", drawingPower: step.amount })),
        interestRate: money(state, "currentInterestRate") ?? money(state, "interestRate"),
        startDate,
        ...(references.length > 0 ? { notes: `From the lender statement:\n${references.join("\n")}` } : {}),
    };
}

/** Refuses anything the customer has not confirmed or FinWea cannot represent. */
export function reviewToDraft(state: StatementReviewState): StatementDraftResult {
    const blockers = reviewBlockers(state);
    if (blockers.length > 0 || state.selectedType === null) {
        throw new Error(blockers[0] ?? "Confirm the loan type first.");
    }

    const route = routeForType(state.selectedType, state.droplineEnabled);
    if (route.kind !== "WIZARD") throw new Error(route.reason);

    const notes = [...route.limitations];
    const specific = route.loanKind === LoanKind.OVERDRAFT ? revolvingDraft(state, route.loanCategory, route.dropline, notes) : termDraft(state, notes);
    const interestType = text(state, "interestTypeText");
    const accountNumber = field(state, "loanAccountNumber");

    return {
        notes,
        statementFacts: route.loanKind === LoanKind.TERM_LOAN ? statementFactsFromReview(state) : null,
        rateHistory: hasRateProposals(state.rates) ? state.rates : null,
        currencyCode: /\b[A-Z]{3}\b/.exec(text(state, "currencyCode"))?.[0] ?? null,
        draft: {
            ...emptyLoanSetupDraft(route.loanKind),
            name: "",
            lenderName: text(state, "lenderName"),
            loanAccountNumber: typeof accountNumber === "string" ? accountNumber : "",
            sanctionDate: text(state, "sanctionDate"),
            status: statusFrom(text(state, "accountStatus")),
            ...(/float|variable|mclr|rllr|plr|repo/i.test(interestType) ? { rateType: "FLOATING" as const } : {}),
            ...specific,
            loanKind: route.loanKind,
        },
    };
}
