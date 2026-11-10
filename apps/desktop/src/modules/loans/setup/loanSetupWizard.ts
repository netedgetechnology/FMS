// ---------------------------------------------------------------------
// Add Loan wizard - steps, per-step validation, the schedule preview and
// the conversion of the draft into the request LoanService.create saves.
// Pure (no database, no React) so every rule is unit tested.
// ---------------------------------------------------------------------

import { computeLoanScheduleAndBalances, balancesFromSchedule, type LoanScheduleAndBalances } from "../services/EMIScheduleService";
import { normalizeLoanAccountNumber } from "../validation/loanSchema";
import { LoanKind } from "../types/LoanKind";
import { LoanPaymentStatus, type CreateLoanRequest, type LoanPaymentSchedule } from "../types";
import { drawingPowerOn, droplineScheduleIssues } from "./droplineSchedule";
import {
    disbursementNet,
    expenseAmounts,
    formatMoney,
    linkedTransactionRefusal,
    roundMoney,
    validateSetupDetails,
} from "./loanSetupAccounting";
import {
    dueInstalmentCount,
    entriesFromDraft,
    historicalInstalmentIssues,
    localToday,
    markHistoricalInstalments,
    paidInstalmentCount,
    type HistoricalInstalmentDetails,
} from "./historicalInstalments";
import type {
    InterestCalculationMethod,
    InterestMethod,
    LenderScheduleRow,
    LoanSetupDetails,
    LoanSetupDraft,
    SetupIssue,
} from "./loanSetupTypes";

export type SetupStep =
    | "basics"
    | "disbursement"
    | "expenses"
    | "repayment"
    | "schedule"
    | "overdraft"
    | "review";

export const SETUP_STEP_LABELS: Record<SetupStep, string> = {
    basics: "Loan Details",
    disbursement: "Disbursement",
    expenses: "Initial Expenses",
    repayment: "Repayment",
    schedule: "Schedule",
    overdraft: "Overdraft",
    review: "Review",
};

export function stepsFor(kind: LoanKind): SetupStep[] {
    return kind === LoanKind.OVERDRAFT
        ? ["basics", "overdraft", "expenses", "review"]
        : ["basics", "disbursement", "expenses", "repayment", "schedule", "review"];
}

export function newKey(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
}

export function emptyLoanSetupDraft(kind: LoanKind, currencyId = ""): LoanSetupDraft {
    return {
        loanKind: kind,
        name: "",
        lenderName: "",
        loanAccountNumber: "",
        loanCategory: kind === LoanKind.OVERDRAFT ? "Overdraft" : "",
        purpose: "",
        currencyId,
        sanctionedAmount: null,
        principalAmount: null,
        interestRate: null,
        rateType: "FIXED",
        interestMethod: "REDUCING_MONTHLY",
        sanctionDate: "",
        startDate: "",
        linkedAccountId: "",
        status: "ACTIVE",
        notes: "",
        disbursements: [],
        expenses: [],
        emiAmount: null,
        tenureMonths: null,
        firstEmiDate: "",
        paymentDay: null,
        gracePeriodMonths: null,
        balloonAmount: null,
        firstInstallmentAmount: null,
        historicalCount: 0,
        historical: [],
        scheduleMethod: "GENERATED",
        lenderSchedule: null,
        creditLimit: null,
        drawingPower: null,
        openingUsed: 0,
        openingUsedAsOf: "",
        odAccountIds: [],
        dropline: false,
        drawingPowerSchedule: [],
    };
}

/** A new disbursement row, pre-filled from the loan where it helps. */
export function newDisbursementDraft(draft: LoanSetupDraft) {
    return {
        key: newKey(),
        date: draft.disbursements.length === 0 ? draft.startDate : "",
        grossAmount:
            draft.disbursements.length === 0
                ? draft.sanctionedAmount ?? draft.principalAmount ?? null
                : null,
        deductionsAmount: 0,
        destinationAccountId: draft.linkedAccountId,
        reference: "",
        transaction: null,
    };
}

export function newExpenseDraft(draft: LoanSetupDraft) {
    const isOd = draft.loanKind === LoanKind.OVERDRAFT;

    return {
        key: newKey(),
        expenseType: "PROCESSING_FEE" as const,
        description: "",
        expenseDate: draft.disbursements[0]?.date || draft.startDate,
        baseAmount: null,
        gstRate: 18,
        gstAmount: null,
        settlement:
            !isOd && draft.disbursements.length > 0
                ? ("DEDUCTED_FROM_DISBURSEMENT" as const)
                : ("PAID_SEPARATELY" as const),
        disbursementKey: !isOd ? draft.disbursements[0]?.key ?? null : null,
        paymentMethod: "",
        paymentAccountId: isOd ? draft.odAccountIds[0] ?? "" : draft.linkedAccountId,
        transactionReference: "",
        transaction: null,
    };
}

export function interestColumns(method: InterestMethod): {
    interestType: "REDUCING" | "FLAT";
    interestCalculationMethod: InterestCalculationMethod;
} {
    switch (method) {
        case "FLAT":
            return { interestType: "FLAT", interestCalculationMethod: "MONTHLY_RATE" };
        case "REDUCING_ACTUAL_365":
            return { interestType: "REDUCING", interestCalculationMethod: "ACTUAL_365" };
        default:
            return { interestType: "REDUCING", interestCalculationMethod: "MONTHLY_RATE" };
    }
}

/** A Term Loan's principal: what was disbursed (gross), else as entered. */
export function termPrincipal(draft: LoanSetupDraft): number {
    if (draft.disbursements.length > 0) {
        return roundMoney(draft.disbursements.reduce((sum, d) => sum + Number(d.grossAmount ?? 0), 0));
    }

    return roundMoney(Number(draft.principalAmount ?? 0));
}

/** The suggested first EMI date: start + grace + 1 month (never stored unasked). */
export function suggestedFirstEmiDate(startDate: string, graceMonths: number | null): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        return "";
    }

    const [year, month, day] = startDate.split("-").map(Number);
    const target = new Date(Date.UTC(year!, month! - 1 + 1 + Math.max(0, graceMonths ?? 0), 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();

    return [
        target.getUTCFullYear(),
        String(target.getUTCMonth() + 1).padStart(2, "0"),
        String(Math.min(day!, lastDay)).padStart(2, "0"),
    ].join("-");
}

export function draftToDetails(draft: LoanSetupDraft): LoanSetupDetails {
    const isOd = draft.loanKind === LoanKind.OVERDRAFT;
    const { interestCalculationMethod } = interestColumns(draft.interestMethod);
    const disbursements = isOd
        ? []
        : draft.disbursements.map(d => {
              const gross = roundMoney(Number(d.grossAmount ?? 0));
              const deductions = roundMoney(Number(d.deductionsAmount ?? 0));

              return {
                  date: d.date,
                  grossAmount: gross,
                  deductionsAmount: deductions,
                  netAmount: disbursementNet(gross, deductions),
                  destinationAccountId: d.destinationAccountId || d.transaction?.accountId || null,
                  reference: d.reference.trim() || null,
                  transactionId: d.transaction?.id ?? null,
              };
          });

    const disbursementIndex = new Map(draft.disbursements.map((d, index) => [d.key, index]));

    return {
        loanPurpose: draft.purpose.trim() || null,
        rateType: draft.rateType,
        interestCalculationMethod: isOd ? null : interestCalculationMethod,
        sanctionDate: draft.sanctionDate || null,
        sanctionedAmount: isOd ? null : draft.sanctionedAmount,
        // With the lender's schedule, its first due date is authoritative.
        firstEmiDate: isOd
            ? null
            : draft.scheduleMethod === "LENDER_CSV" && draft.lenderSchedule?.rows[0]
              ? draft.lenderSchedule.rows[0].dueDate
              : draft.firstEmiDate || null,
        repaymentFrequency: isOd ? null : "MONTHLY",
        paymentDay: isOd ? null : draft.paymentDay,
        gracePeriodMonths: isOd ? null : draft.gracePeriodMonths,
        balloonAmount: isOd ? null : draft.balloonAmount && draft.balloonAmount > 0 ? draft.balloonAmount : null,
        scheduleSource: isOd ? null : draft.scheduleMethod,
        // A dropline's drawing power comes from its dated steps, never one figure.
        drawingPower: isOd && !draft.dropline ? draft.drawingPower : null,
        ...(isOd && draft.dropline
            ? { drawingPowerSchedule: draft.drawingPowerSchedule.map(step => ({ effectiveDate: step.effectiveDate, drawingPower: Number(step.drawingPower) })) }
            : {}),
        disbursements,
        expenses: draft.expenses.map(e => {
            const { base, gst, total } = expenseAmounts(e);

            return {
                expenseType: e.expenseType,
                description: e.description.trim() || null,
                expenseDate: e.expenseDate,
                baseAmount: base,
                gstRate: e.gstRate,
                gstAmount: gst,
                totalAmount: total,
                settlement: e.settlement,
                disbursementIndex:
                    e.settlement === "DEDUCTED_FROM_DISBURSEMENT" && e.disbursementKey
                        ? disbursementIndex.get(e.disbursementKey) ?? null
                        : null,
                paymentMethod: e.settlement === "PAID_SEPARATELY" ? e.paymentMethod || null : null,
                paymentAccountId:
                    e.settlement === "PAID_SEPARATELY"
                        ? e.paymentAccountId || e.transaction?.accountId || null
                        : null,
                transactionReference: e.transactionReference.trim() || null,
                transactionId: e.settlement === "PAID_SEPARATELY" ? e.transaction?.id ?? null : null,
            };
        }),
        lenderSchedule: !isOd && draft.scheduleMethod === "LENDER_CSV" ? draft.lenderSchedule?.rows ?? null : null,
        historicalInstalments: isOd ? [] : historicalDetails(draft),
    };
}

/** The instalment numbers the schedule will have, first first. */
function scheduleNumbers(draft: LoanSetupDraft): number[] {
    if (draft.scheduleMethod === "LENDER_CSV" && draft.lenderSchedule) {
        return draft.lenderSchedule.rows.map(row => row.installmentNumber);
    }

    return draft.historical.map((_, index) => index + 1);
}

/**
 * The resolved historical instalments, as LoanService.create receives them.
 * Unresolved ones are left out - validateStep blocks Save while any exist.
 */
function historicalDetails(draft: LoanSetupDraft): HistoricalInstalmentDetails[] {
    const numbers = scheduleNumbers(draft);
    const details: HistoricalInstalmentDetails[] = [];

    draft.historical.forEach((item, index) => {
        if (item.resolution === "SETTLED_BEFORE_FINWEA") {
            details.push({
                installmentNumber: numbers[index] ?? index + 1,
                resolution: "SETTLED_BEFORE_FINWEA",
                transactionId: null,
                transactionDate: null,
                transactionAmount: null,
                transactionAccountId: null,
                transactionSide: null,
            });
        } else if (item.resolution === "LINKED" && item.transaction) {
            details.push({
                installmentNumber: numbers[index] ?? index + 1,
                resolution: "LINKED",
                transactionId: item.transaction.id,
                transactionDate: item.transaction.date,
                transactionAmount: item.transaction.amount,
                transactionAccountId: item.transaction.accountId,
                transactionSide: item.transaction.side,
            });
        }
    });

    return details;
}

/** Bank transactions this draft already uses outside the historical instalments. */
export function setupLinkedTransactionIds(draft: LoanSetupDraft): string[] {
    return [
        ...draft.disbursements.map(d => d.transaction?.id),
        ...draft.expenses.map(e => (e.settlement === "PAID_SEPARATELY" ? e.transaction?.id : undefined)),
    ].filter((id): id is string => Boolean(id));
}

/**
 * The lender's rows as schedule rows - every figure exactly as given, every
 * instalment UPCOMING (historical ones are marked separately, one by one -
 * see historicalInstalments.ts).
 */
export function lenderRowsToSchedule(
    loanId: string,
    rows: readonly LenderScheduleRow[]
): LoanPaymentSchedule[] {
    return rows.map(row => ({
        id: newKey(),
        loanId,
        installmentNumber: row.installmentNumber,
        dueDate: row.dueDate,
        principalAmount: row.principal,
        interestAmount: row.interest,
        totalAmount: row.emi,
        outstandingPrincipal: row.closingPrincipal,
        openingPrincipal: row.openingPrincipal,
        status: LoanPaymentStatus.UPCOMING,
        paidDate: null,
        paidAmount: null,
        transactionId: null,
        settledBeforeFinwea: false,
    }));
}

export interface SchedulePreview extends LoanScheduleAndBalances {
    emiAmount: number;
    maturityDate: string | null;
    tenureMonths: number;
}

/** FinWea's own schedule from the entered terms (also the CSV comparison). */
export function generatedSchedulePreview(draft: LoanSetupDraft, loanId = "preview"): SchedulePreview {
    const { interestType, interestCalculationMethod } = interestColumns(draft.interestMethod);
    const result = computeLoanScheduleAndBalances({
        id: loanId,
        principalAmount: termPrincipal(draft),
        interestRate: Number(draft.interestRate ?? 0),
        interestType,
        tenureMonths: draft.tenureMonths,
        emiAmount: draft.emiAmount && draft.emiAmount > 0 ? draft.emiAmount : null,
        firstInstallmentAmount:
            draft.firstInstallmentAmount && draft.firstInstallmentAmount > 0 ? draft.firstInstallmentAmount : null,
        startDate: draft.startDate,
        status: draft.status,
        firstEmiDate: draft.firstEmiDate || null,
        paymentDay: draft.paymentDay,
        balloonAmount: draft.balloonAmount,
        interestCalculationMethod: interestType === "REDUCING" ? interestCalculationMethod : null,
    });
    const regular = result.schedule.find(row => row.principalAmount > 0) ?? result.schedule[0];

    return {
        ...result,
        emiAmount: draft.emiAmount && draft.emiAmount > 0 ? draft.emiAmount : regular?.totalAmount ?? 0,
        maturityDate: result.schedule[result.schedule.length - 1]?.dueDate ?? null,
        tenureMonths: result.schedule.length,
    };
}

/** The schedule as it will be saved, before any historical instalment is marked. */
export function unmarkedSchedulePreview(draft: LoanSetupDraft, loanId = "preview"): SchedulePreview {
    if (draft.scheduleMethod === "LENDER_CSV") {
        const rows = draft.lenderSchedule?.rows ?? [];

        if (rows.length === 0) {
            throw new Error("Import the lender's schedule first.");
        }

        const schedule = lenderRowsToSchedule(loanId, rows);
        const emis = rows.map(row => row.emi);
        const regularEmi = emis
            .slice()
            .sort((a, b) => emis.filter(v => v === b).length - emis.filter(v => v === a).length)[0]!;

        return {
            ...balancesFromSchedule(schedule, termPrincipal(draft), draft.status),
            emiAmount: regularEmi,
            maturityDate: rows[rows.length - 1]!.dueDate,
            tenureMonths: rows.length,
        };
    }

    return generatedSchedulePreview(draft, loanId);
}

/**
 * The schedule that will be saved: the lender's, or FinWea's, with the
 * resolved historical instalments marked PAID (linked or settled before
 * FinWea) and the opening balances read from them.
 */
export function schedulePreview(draft: LoanSetupDraft, loanId = "preview"): SchedulePreview {
    const base = unmarkedSchedulePreview(draft, loanId);
    const schedule = markHistoricalInstalments(base.schedule, entriesFromDraft(base.schedule, draft.historical));

    return {
        ...base,
        ...balancesFromSchedule(schedule, termPrincipal(draft), draft.status),
    };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Blocking problems for one step (an empty list lets the user continue). */
export function validateStep(draft: LoanSetupDraft, step: SetupStep, today: string = localToday()): SetupIssue[] {
    const issues: SetupIssue[] = [];
    const isOd = draft.loanKind === LoanKind.OVERDRAFT;
    const push = (field: string, message: string) => issues.push({ field, message });

    switch (step) {
        case "basics": {
            if (!draft.name.trim()) push("name", "Enter the loan name.");
            if (!isOd && !draft.loanCategory.trim()) push("loanCategory", "Enter the loan category (e.g. Home Loan, Business Loan).");
            if (!draft.currencyId) push("currencyId", "Choose the currency.");
            if (!ISO_DATE.test(draft.startDate)) push("startDate", "Enter the loan start date.");
            if (draft.sanctionDate && ISO_DATE.test(draft.startDate) && draft.sanctionDate > draft.startDate) {
                push("sanctionDate", "The sanction date cannot be after the start date.");
            }
            if (draft.interestRate === null || !(draft.interestRate >= 0)) {
                push("interestRate", "Enter the interest rate (0 or more).");
            } else if (draft.interestRate > 100) {
                push("interestRate", "The interest rate looks wrong - enter it as a yearly percentage.");
            }
            if (draft.sanctionedAmount !== null && !(draft.sanctionedAmount > 0)) {
                push("sanctionedAmount", "The sanctioned amount must be greater than 0.");
            }
            if (!isOd && !draft.linkedAccountId) {
                push("linkedAccountId", "Choose the bank account the EMIs are paid from.");
            }
            break;
        }

        case "disbursement": {
            if (draft.disbursements.length === 0 && !(Number(draft.principalAmount) > 0)) {
                push("principalAmount", "Add the disbursement, or enter the loan principal if you do not want to record it.");
            }
            draft.disbursements.forEach((d, index) => {
                const gross = Number(d.grossAmount ?? 0);
                const deductions = Number(d.deductionsAmount ?? 0);
                if (!d.destinationAccountId) {
                    push(`disbursements.${index}.destinationAccountId`, `Disbursement ${index + 1}: choose the bank account it was credited to.`);
                }
                if (d.transaction) {
                    const refusal = linkedTransactionRefusal(d.transaction, {
                        side: "IN",
                        accountId: d.destinationAccountId || null,
                        amount: disbursementNet(gross, deductions),
                        what: `disbursement ${index + 1}`,
                    });
                    if (refusal) push(`disbursements.${index}.transaction`, refusal);
                }
            });
            // Amount / date / sanction checks (deductions are checked with expenses).
            const details = draftToDetails(draft);
            for (const issue of validateSetupDetails(
                { disbursements: details.disbursements, expenses: details.expenses },
                { loanKind: draft.loanKind, sanctionedAmount: draft.sanctionedAmount, sanctionDate: draft.sanctionDate || null }
            )) {
                if (issue.field.startsWith("disbursements") && !issue.message.includes("deduct")) {
                    issues.push(issue);
                }
            }
            break;
        }

        case "expenses": {
            draft.expenses.forEach((e, index) => {
                const { total } = expenseAmounts(e);
                if (e.settlement === "PAID_SEPARATELY" && e.transaction) {
                    const refusal = linkedTransactionRefusal(e.transaction, {
                        side: "OUT",
                        accountId: e.paymentAccountId || null,
                        amount: total,
                        what: `expense ${index + 1}`,
                    });
                    if (refusal) push(`expenses.${index}.transaction`, refusal);
                }
            });
            const details = draftToDetails(draft);
            issues.push(
                ...validateSetupDetails(details, {
                    loanKind: draft.loanKind,
                    sanctionedAmount: draft.sanctionedAmount,
                    sanctionDate: draft.sanctionDate || null,
                })
            );
            break;
        }

        case "repayment": {
            if (draft.scheduleMethod === "GENERATED") {
                if (!draft.tenureMonths || !Number.isInteger(draft.tenureMonths) || draft.tenureMonths <= 0) {
                    push("tenureMonths", "Enter the tenure as a whole number of months.");
                }
            }
            if (!ISO_DATE.test(draft.firstEmiDate)) {
                push("firstEmiDate", "Enter the actual first EMI date from your sanction letter or schedule.");
            } else if (ISO_DATE.test(draft.startDate) && draft.firstEmiDate < draft.startDate) {
                push("firstEmiDate", "The first EMI date cannot be before the loan start date.");
            }
            if (draft.paymentDay !== null && (!Number.isInteger(draft.paymentDay) || draft.paymentDay < 1 || draft.paymentDay > 31)) {
                push("paymentDay", "The payment day must be between 1 and 31.");
            }
            if (draft.emiAmount !== null && draft.emiAmount < 0) push("emiAmount", "The EMI cannot be negative.");
            if (draft.balloonAmount !== null && draft.balloonAmount < 0) push("balloonAmount", "The balloon payment cannot be negative.");
            if (draft.balloonAmount && draft.balloonAmount >= termPrincipal(draft)) {
                push("balloonAmount", "The balloon payment must be less than the principal.");
            }
            if (draft.balloonAmount && draft.interestMethod === "FLAT") {
                push("balloonAmount", "A balloon payment is only supported for reducing-balance loans.");
            }
            break;
        }

        case "schedule": {
            try {
                const { schedule } = unmarkedSchedulePreview(draft);
                const due = dueInstalmentCount(schedule, today);

                if (!Number.isInteger(draft.historicalCount) || draft.historicalCount < 0) {
                    push("historical", "Instalments paid before FinWea must be 0 or more.");
                } else if (draft.historicalCount > due) {
                    push(
                        "historical",
                        due === 0
                            ? "No instalment is due yet, so none can be marked as paid."
                            : `Only ${due} instalment${due === 1 ? " is" : "s are"} due on or before today - a future instalment cannot be marked paid.`
                    );
                } else if (draft.historical.length !== draft.historicalCount) {
                    push("historical", "Resolve each historical instalment again (the count changed).");
                } else {
                    issues.push(
                        ...historicalInstalmentIssues(schedule, entriesFromDraft(schedule, draft.historical), {
                            today,
                            accountId: draft.linkedAccountId || null,
                            loanStartDate: draft.startDate,
                            otherLinkedIds: setupLinkedTransactionIds(draft),
                        })
                    );
                }
            } catch (error) {
                push("schedule", error instanceof Error ? error.message : String(error));
            }
            break;
        }

        case "overdraft": {
            if (!(Number(draft.creditLimit) > 0)) push("creditLimit", "Enter the sanctioned limit (greater than 0).");
            if (draft.dropline) {
                issues.push(...droplineScheduleIssues(draft.drawingPowerSchedule, draft.creditLimit));
            } else if (draft.drawingPower !== null) {
                if (!(draft.drawingPower >= 0)) push("drawingPower", "Drawing power cannot be negative.");
                else if (draft.creditLimit && draft.drawingPower > draft.creditLimit) {
                    push("drawingPower", "Drawing power cannot be more than the sanctioned limit.");
                }
            }
            if (draft.openingUsed === null || draft.openingUsed < 0) push("openingUsed", "The opening used amount cannot be negative.");
            if (!ISO_DATE.test(draft.openingUsedAsOf)) push("openingUsedAsOf", "Enter the date the opening used amount is as of.");
            if (draft.odAccountIds.length === 0) push("odAccountIds", "Choose at least one bank account this overdraft is linked to.");
            break;
        }

        case "review":
            for (const earlier of stepsFor(draft.loanKind).filter(s => s !== "review")) {
                issues.push(...validateStep(draft, earlier, today));
            }
            break;
    }

    return issues;
}

/** The request LoanService.create saves - loan, schedule terms and setup. */
export function draftToCreateRequest(draft: LoanSetupDraft): CreateLoanRequest {
    const setup = draftToDetails(draft);
    const isOd = draft.loanKind === LoanKind.OVERDRAFT;
    const common = {
        name: draft.name.trim(),
        loanAccountNumber: normalizeLoanAccountNumber(draft.loanAccountNumber),
        lenderInstitutionName: draft.lenderName.trim() || undefined,
        currencyId: draft.currencyId,
        interestRate: Number(draft.interestRate ?? 0),
        startDate: draft.startDate,
        status: draft.status,
        notes: draft.notes.trim() || undefined,
        setup,
    };

    if (isOd) {
        return {
            ...common,
            loanKind: LoanKind.OVERDRAFT,
            loanType: draft.loanCategory.trim() || "Overdraft",
            accountId: draft.odAccountIds[0] ?? null,
            linkedAccountIds: draft.odAccountIds,
            creditLimit: draft.creditLimit,
            openingUsed: draft.openingUsed ?? 0,
            openingUsedAsOf: draft.openingUsedAsOf,
            interestType: "REDUCING",
            principalAmount: 0,
            tenureMonths: null,
            emiAmount: null,
            firstInstallmentAmount: null,
            maturityDate: null,
            paidInstallments: 0,
            outstandingPrincipal: 0,
            outstandingInterest: 0,
        };
    }

    // A historical instalment is never dropped silently: every one counted
    // must be resolved (linked or "Settled before FinWea") before saving.
    if (
        draft.historical.length !== draft.historicalCount ||
        draft.historical.some(item => item.resolution === null || (item.resolution === "LINKED" && !item.transaction))
    ) {
        throw new Error(
            "Resolve each instalment paid before FinWea: link its bank debit, or mark it \"Settled before FinWea\"."
        );
    }

    const preview = schedulePreview(draft);
    const { interestType } = interestColumns(draft.interestMethod);

    return {
        ...common,
        loanKind: LoanKind.TERM_LOAN,
        loanType: draft.loanCategory.trim(),
        accountId: draft.linkedAccountId || null,
        interestType,
        principalAmount: termPrincipal(draft),
        tenureMonths: preview.tenureMonths,
        emiAmount: roundMoney(preview.emiAmount),
        firstInstallmentAmount:
            draft.scheduleMethod === "GENERATED" && draft.firstInstallmentAmount && draft.firstInstallmentAmount > 0
                ? draft.firstInstallmentAmount
                : null,
        maturityDate: preview.maturityDate,
        // Derived from the schedule, never typed in: the resolved historical
        // instalments (LoanService.create checks it again).
        paidInstallments: paidInstalmentCount(preview.schedule),
        outstandingPrincipal: preview.outstandingPrincipal,
        outstandingInterest: preview.outstandingInterest,
    };
}

/** The drawing power that applies today, for the wizard's previews. */
export function draftDrawingPower(draft: LoanSetupDraft, today: string = localToday()): number | null {
    if (!draft.dropline) return draft.drawingPower;

    return drawingPowerOn(
        draft.drawingPowerSchedule.filter(step => step.drawingPower !== null).map(step => ({ effectiveDate: step.effectiveDate, drawingPower: step.drawingPower! })),
        today
    );
}

/** "Rs 7,50,000.00" style, for summaries. */
export function money(value: number | null | undefined): string {
    return value === null || value === undefined ? "-" : formatMoney(value);
}
