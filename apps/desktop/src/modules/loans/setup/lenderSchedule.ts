// ---------------------------------------------------------------------
// Import of the lender's OFFICIAL repayment schedule - CSV only.
//
// Parsing and column detection reuse @financeos/import-engine
// (parseCsv / detectLoanScheduleColumns / normalizeLoanScheduleRows);
// this module adds the checks that make a schedule trustworthy enough to
// be authoritative: dates, numbering, opening/closing continuity, EMI =
// principal + interest, totals and the final balance.
//
// When a file passes, its figures are stored EXACTLY as the lender gave
// them - FinWea never replaces a lender value with a calculated one. Any
// difference from FinWea's own estimate is shown and explained, never
// "fixed". Amounts are compared to the paisa with no tolerance.
// ---------------------------------------------------------------------

import {
    detectLoanScheduleColumns,
    normalizeLoanScheduleRows,
    parseCsv,
    type CsvDocument,
    type LoanScheduleColumnMapping,
    type NormalizedLoanScheduleCandidate,
} from "@financeos/import-engine";

import type { LoanPaymentSchedule } from "../types";
import { formatMoney, roundMoney, sameMoney } from "./loanSetupAccounting";
import type { LenderScheduleRow, SetupIssue } from "./loanSetupTypes";

/** The columns a lender schedule can map, in the order the UI shows them. */
export const LENDER_SCHEDULE_FIELDS = [
    { field: "installmentNumber", label: "Instalment No.", required: false },
    { field: "dueDate", label: "Due Date", required: true },
    { field: "openingPrincipal", label: "Opening Principal", required: false },
    { field: "principal", label: "Principal", required: true },
    { field: "interest", label: "Interest", required: true },
    { field: "emi", label: "EMI", required: true },
    { field: "outstandingPrincipal", label: "Closing Principal", required: true },
] as const;

export type LenderScheduleField = (typeof LENDER_SCHEDULE_FIELDS)[number]["field"];

export type LenderScheduleMapping = Partial<Record<LenderScheduleField, string>>;

export interface ParsedLenderCsv {
    document: CsvDocument;
    /** What was detected from the headers - the user can change it. */
    mapping: LenderScheduleMapping;
}

/** Reads the CSV and detects its columns. Never throws on bad content. */
export function parseLenderScheduleCsv(content: string): ParsedLenderCsv {
    const document = parseCsv(content);
    const detected = detectLoanScheduleColumns(document).mapping;

    return {
        document,
        mapping: {
            installmentNumber: detected.installmentNumber,
            dueDate: detected.dueDate ?? detected.paymentDate,
            openingPrincipal: detected.openingPrincipal,
            principal: detected.principal,
            interest: detected.interest,
            emi: detected.emi,
            outstandingPrincipal: detected.outstandingPrincipal ?? detected.outstandingBalance,
        },
    };
}

function toEngineMapping(mapping: LenderScheduleMapping): LoanScheduleColumnMapping {
    return {
        installmentNumber: mapping.installmentNumber,
        dueDate: mapping.dueDate,
        openingPrincipal: mapping.openingPrincipal,
        principal: mapping.principal,
        interest: mapping.interest,
        emi: mapping.emi,
        outstandingPrincipal: mapping.outstandingPrincipal,
    };
}

export interface LenderScheduleSummary {
    instalments: number;
    totalPrincipal: number;
    totalInterest: number;
    totalEmi: number;
    /** The EMI most rows carry (the regular EMI). */
    regularEmi: number;
    firstDueDate: string;
    lastDueDate: string;
    openingPrincipal: number;
    finalClosingPrincipal: number;
}

export interface LenderScheduleValidation {
    /** Only when there are no errors: the schedule to store, as given. */
    rows: LenderScheduleRow[] | null;
    errors: SetupIssue[];
    warnings: SetupIssue[];
    summary: LenderScheduleSummary | null;
}

function isBlankRow(candidate: NormalizedLoanScheduleCandidate): boolean {
    return Object.values(candidate.rawData).every(value => !String(value ?? "").trim());
}

function isTotalsRow(candidate: NormalizedLoanScheduleCandidate): boolean {
    return (
        candidate.dueDate === null &&
        Object.values(candidate.rawData).some(value => /^\s*(grand\s+)?total/i.test(String(value ?? "")))
    );
}

/** The most frequent value (ties: the earliest seen). */
function mostCommon(values: number[]): number {
    const counts = new Map<number, number>();
    let best = values[0] ?? 0;

    for (const value of values) {
        const count = (counts.get(value) ?? 0) + 1;
        counts.set(value, count);
        if (count > (counts.get(best) ?? 0)) {
            best = value;
        }
    }

    return best;
}

/**
 * Validates a lender schedule against the loan's principal. `mapping`
 * names the CSV column for each field (see parseLenderScheduleCsv).
 */
export function validateLenderSchedule(
    document: CsvDocument,
    mapping: LenderScheduleMapping,
    context: { principalAmount: number | null; startDate: string | null }
): LenderScheduleValidation {
    const errors: SetupIssue[] = [];
    const warnings: SetupIssue[] = [];

    for (const definition of LENDER_SCHEDULE_FIELDS) {
        if (definition.required && !mapping[definition.field]) {
            errors.push({
                field: `mapping.${definition.field}`,
                message: `Choose the column that holds "${definition.label}".`,
            });
        }
    }

    if (errors.length > 0) {
        return { rows: null, errors, warnings, summary: null };
    }

    const candidates = normalizeLoanScheduleRows(document, toEngineMapping(mapping)).filter(candidate => {
        if (isBlankRow(candidate)) return false;
        if (isTotalsRow(candidate)) {
            warnings.push({ field: `row.${candidate.rowNumber}`, message: `Row ${candidate.rowNumber} looks like a totals row and was left out.` });
            return false;
        }
        return true;
    });

    if (candidates.length === 0) {
        errors.push({ field: "rows", message: "The file has no schedule rows." });
        return { rows: null, errors, warnings, summary: null };
    }

    if (!mapping.installmentNumber) {
        warnings.push({ field: "mapping.installmentNumber", message: "The file has no instalment number column, so instalments are numbered in file order." });
    }

    const rows: LenderScheduleRow[] = [];
    const seenNumbers = new Map<number, number>();

    candidates.forEach((candidate, index) => {
        const at = `Row ${candidate.rowNumber}`;
        const field = `row.${candidate.rowNumber}`;
        const number = mapping.installmentNumber ? candidate.installmentNumber : index + 1;

        if (number === null || !Number.isInteger(number) || number <= 0) {
            errors.push({ field, message: `${at}: the instalment number is missing or not a whole number.` });
        } else if (seenNumbers.has(number)) {
            errors.push({ field, message: `${at}: instalment ${number} appears twice (also row ${seenNumbers.get(number)}).` });
        } else {
            seenNumbers.set(number, candidate.rowNumber);
        }

        if (!candidate.dueDate) {
            errors.push({ field, message: `${at}: the due date is missing or not a valid date.` });
        }

        const amounts: Array<[string, number | null | undefined]> = [
            ["principal", candidate.principal],
            ["interest", candidate.interest],
            ["EMI", candidate.emi],
            ["closing principal", candidate.outstandingPrincipal],
        ];

        if (mapping.openingPrincipal) {
            amounts.push(["opening principal", candidate.openingPrincipal]);
        }

        for (const [name, value] of amounts) {
            if (value === null || value === undefined || !Number.isFinite(value)) {
                errors.push({ field, message: `${at}: the ${name} is missing or not a number.` });
            } else if (value < 0) {
                errors.push({ field, message: `${at}: the ${name} cannot be negative.` });
            }
        }

        rows.push({
            installmentNumber: number ?? index + 1,
            dueDate: candidate.dueDate ?? "",
            openingPrincipal: roundMoney(Number(candidate.openingPrincipal ?? NaN)),
            principal: roundMoney(Number(candidate.principal ?? 0)),
            interest: roundMoney(Number(candidate.interest ?? 0)),
            emi: roundMoney(Number(candidate.emi ?? 0)),
            closingPrincipal: roundMoney(Number(candidate.outstandingPrincipal ?? 0)),
        });
    });

    if (errors.length > 0) {
        return { rows: null, errors, warnings, summary: null };
    }

    const checked = checkLenderScheduleRows(rows, context);

    return {
        rows: checked.rows,
        errors: [...errors, ...checked.errors],
        warnings: [...warnings, ...checked.warnings],
        summary: checked.summary,
    };
}

/**
 * The schedule-level checks on parsed rows: numbering, dates, opening /
 * closing continuity, EMI = principal + interest, totals, final balance.
 * Also run by LoanService on save, so a schedule is never stored unchecked.
 * Rows without a lender opening (NaN) take the previous closing.
 */
export function checkLenderScheduleRows(
    input: readonly LenderScheduleRow[],
    context: { principalAmount: number | null; startDate: string | null }
): LenderScheduleValidation {
    const errors: SetupIssue[] = [];
    const warnings: SetupIssue[] = [];
    const rows = input.map(row => ({ ...row }));

    if (rows.length === 0) {
        errors.push({ field: "rows", message: "The schedule has no instalments." });
        return { rows: null, errors, warnings, summary: null };
    }

    rows.sort((a, b) => a.installmentNumber - b.installmentNumber);

    // With no principal to check against and no opening column, the
    // schedule's own principal total is its opening.
    const principalRepaid = roundMoney(rows.reduce((sum, row) => sum + row.principal, 0));

    rows.forEach((row, index) => {
        const at = `Instalment ${row.installmentNumber}`;
        const field = `instalment.${row.installmentNumber}`;

        if (index > 0 && row.installmentNumber !== rows[index - 1]!.installmentNumber + 1) {
            errors.push({ field, message: `${at}: instalment ${rows[index - 1]!.installmentNumber + 1} is missing.` });
        }

        if (index > 0 && row.dueDate <= rows[index - 1]!.dueDate) {
            errors.push({ field, message: `${at}: its due date ${row.dueDate} is not after the previous instalment's (${rows[index - 1]!.dueDate}).` });
        }

        if (index === 0 && context.startDate && row.dueDate < context.startDate) {
            errors.push({ field, message: `${at}: its due date ${row.dueDate} is before the loan start date ${context.startDate}.` });
        }

        // The lender's opening, or - with no opening column - the previous closing.
        const expectedOpening =
            index === 0
                ? context.principalAmount ??
                  (Number.isNaN(row.openingPrincipal) ? principalRepaid : row.openingPrincipal)
                : rows[index - 1]!.closingPrincipal;

        if (Number.isNaN(row.openingPrincipal)) {
            row.openingPrincipal = roundMoney(Number(expectedOpening ?? 0));
        } else if (expectedOpening !== null && expectedOpening !== undefined && !sameMoney(row.openingPrincipal, expectedOpening)) {
            errors.push({
                field,
                message:
                    index === 0
                        ? `${at}: the schedule opens at ${formatMoney(row.openingPrincipal)}, but the loan principal is ${formatMoney(expectedOpening)}.`
                        : `${at}: opens at ${formatMoney(row.openingPrincipal)}, but instalment ${rows[index - 1]!.installmentNumber} closed at ${formatMoney(expectedOpening)}.`,
            });
        }

        if (!sameMoney(roundMoney(row.principal + row.interest), row.emi)) {
            errors.push({
                field,
                message: `${at}: principal ${formatMoney(row.principal)} + interest ${formatMoney(row.interest)} = ${formatMoney(roundMoney(row.principal + row.interest))}, not the EMI ${formatMoney(row.emi)}.`,
            });
        }

        const expectedClosing = roundMoney(row.openingPrincipal - row.principal);

        if (!sameMoney(expectedClosing, row.closingPrincipal)) {
            errors.push({
                field,
                message: `${at}: opening ${formatMoney(row.openingPrincipal)} - principal ${formatMoney(row.principal)} = ${formatMoney(expectedClosing)}, but the closing principal is ${formatMoney(row.closingPrincipal)}.`,
            });
        }
    });

    const totalPrincipal = roundMoney(rows.reduce((sum, row) => sum + row.principal, 0));
    const totalInterest = roundMoney(rows.reduce((sum, row) => sum + row.interest, 0));
    const totalEmi = roundMoney(rows.reduce((sum, row) => sum + row.emi, 0));
    const last = rows[rows.length - 1]!;

    if (context.principalAmount !== null && !sameMoney(totalPrincipal, context.principalAmount)) {
        errors.push({
            field: "totals",
            message: `The principal repaid across the schedule totals ${formatMoney(totalPrincipal)}, but the loan principal is ${formatMoney(context.principalAmount)}.`,
        });
    }

    if (!sameMoney(last.closingPrincipal, 0)) {
        errors.push({
            field: "totals",
            message: `The schedule ends with ${formatMoney(last.closingPrincipal)} still outstanding - an official schedule ends at 0. Check the file is complete.`,
        });
    }

    const regularEmi = mostCommon(rows.map(row => row.emi));
    const irregular = rows.filter(
        (row, index) => index !== 0 && index !== rows.length - 1 && !sameMoney(row.emi, regularEmi)
    );

    if (irregular.length > 0) {
        warnings.push({
            field: "emi",
            message: `${irregular.length} instalment${irregular.length === 1 ? "" : "s"} (${irregular
                .slice(0, 5)
                .map(row => `#${row.installmentNumber}`)
                .join(", ")}${irregular.length > 5 ? ", ..." : ""}) differ from the regular EMI of ${formatMoney(regularEmi)}. They are kept exactly as the lender gives them.`,
        });
    }

    if (errors.length > 0) {
        return { rows: null, errors, warnings, summary: null };
    }

    return {
        rows,
        errors,
        warnings,
        summary: {
            instalments: rows.length,
            totalPrincipal,
            totalInterest,
            totalEmi,
            regularEmi,
            firstDueDate: rows[0]!.dueDate,
            lastDueDate: last.dueDate,
            openingPrincipal: rows[0]!.openingPrincipal,
            finalClosingPrincipal: last.closingPrincipal,
        },
    };
}

export interface ScheduleComparison {
    /** True when FinWea's estimate reproduces the lender schedule exactly. */
    identical: boolean;
    lenderEmi: number;
    estimateEmi: number;
    lenderInstalments: number;
    estimateInstalments: number;
    lenderTotalInterest: number;
    estimateTotalInterest: number;
    /** Plain-language explanation of every difference found. */
    explanations: string[];
}

/**
 * Compares the lender's schedule with the one FinWea would generate from
 * the same terms. Informational only: the lender schedule is what is saved.
 */
export function compareWithEstimate(
    lender: readonly LenderScheduleRow[],
    estimate: readonly LoanPaymentSchedule[]
): ScheduleComparison {
    const lenderEmi = mostCommon(lender.map(row => row.emi));
    const estimateEmi = mostCommon(estimate.map(row => row.totalAmount));
    const lenderTotalInterest = roundMoney(lender.reduce((sum, row) => sum + row.interest, 0));
    const estimateTotalInterest = roundMoney(estimate.reduce((sum, row) => sum + row.interestAmount, 0));
    const explanations: string[] = [];

    if (lender.length !== estimate.length) {
        explanations.push(
            `The lender schedule has ${lender.length} instalments; the entered terms give ${estimate.length}. Check the tenure (or a balloon / pre-EMI instalment in the lender's schedule).`
        );
    }

    if (!sameMoney(lenderEmi, estimateEmi)) {
        explanations.push(
            `The lender's regular EMI is ${formatMoney(lenderEmi)}; the entered rate and tenure give ${formatMoney(estimateEmi)} (difference ${formatMoney(roundMoney(lenderEmi - estimateEmi))}). Lenders often round the EMI, or use a slightly different rate or tenure.`
        );
    }

    const comparable = Math.min(lender.length, estimate.length);
    const interestDiffs: number[] = [];
    const dateDiffs: number[] = [];

    for (let index = 0; index < comparable; index++) {
        if (!sameMoney(lender[index]!.interest, estimate[index]!.interestAmount)) {
            interestDiffs.push(index);
        }
        if (lender[index]!.dueDate !== estimate[index]!.dueDate) {
            dateDiffs.push(index);
        }
    }

    if (dateDiffs.length > 0) {
        const first = dateDiffs[0]!;
        explanations.push(
            `Due dates differ from instalment ${lender[first]!.installmentNumber} (lender ${lender[first]!.dueDate}, estimate ${estimate[first]!.dueDate}). Check the first EMI date and payment day.`
        );
    }

    if (interestDiffs.length > 0) {
        if (interestDiffs.length === 1 && interestDiffs[0] === 0) {
            explanations.push(
                `Only the first instalment's interest differs (lender ${formatMoney(lender[0]!.interest)}, estimate ${formatMoney(estimate[0]!.interestAmount)}) - usually broken-period interest from the disbursement date to the first EMI.`
            );
        } else {
            explanations.push(
                `Interest differs on ${interestDiffs.length} of ${comparable} instalments (total interest: lender ${formatMoney(lenderTotalInterest)}, estimate ${formatMoney(estimateTotalInterest)}). This usually means a different rate, EMI rounding, or day-count method (actual days / 365 instead of rate ÷ 12).`
            );
        }
    }

    return {
        identical: explanations.length === 0,
        lenderEmi,
        estimateEmi,
        lenderInstalments: lender.length,
        estimateInstalments: estimate.length,
        lenderTotalInterest,
        estimateTotalInterest,
        explanations,
    };
}
