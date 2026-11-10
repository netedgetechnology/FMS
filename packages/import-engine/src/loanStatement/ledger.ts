// Turns table rows into ledger entries, a repayment schedule and revision
// histories. A running balance, where printed, is the check on the reading:
// a row that does not chain is flagged, never adjusted.

import type { StatementTable } from "./tables";
import type {
    ChargeRow,
    DisbursementRow,
    LedgerCheck,
    LedgerEntry,
    LedgerSummary,
    LimitChange,
    RateChange,
    ScheduleRow,
} from "./types";
import { chargeCategory, NARRATION_RULES } from "./vocabulary";
import { parseDateValue, parseRate, readMoney, roundMoney, type DateContext } from "./values";

const EPSILON = 0.01;

interface RawRow {
    entry: LedgerEntry;
    /** Balance as printed, DR positive, CR negative, unmarked as printed. */
    signedBalance: number | null;
    delta: number | null;
}

function amountOf(text: string | undefined): number | null {
    const reading = text === undefined ? null : readMoney(text);

    return reading && reading.amount > 0 ? reading.amount : null;
}

function plain(text: string | undefined): number | null {
    return text === undefined ? null : readMoney(text)?.amount ?? null;
}

function narrationKind(description: string): (typeof NARRATION_RULES)[number]["kind"] | null {
    return NARRATION_RULES.find(rule => rule.pattern.test(description))?.kind ?? null;
}

function rawRows(table: StatementTable): RawRow[] {
    return table.rows.flatMap((row): RawRow[] => {
        const description = row.cells.description ?? "";
        const debit = amountOf(row.cells.debit);
        const credit = amountOf(row.cells.credit);
        const single = row.cells.amount ? readMoney(row.cells.amount) : null;
        const balanceReading = row.cells.balance ? readMoney(row.cells.balance) : null;
        const markerText = (row.cells.marker ?? "").trim().toUpperCase();
        const balanceMarker = balanceReading?.marker ?? (/^D/.test(markerText) ? "DR" : /^C/.test(markerText) ? "CR" : null);
        const signedBalance = balanceReading
            ? (balanceMarker === "CR" || (balanceMarker === null && balanceReading.negative) ? -1 : 1) * balanceReading.amount
            : null;

        if (narrationKind(description) === "OPENING" && debit === null && credit === null && single === null) {
            return [{
                entry: entry(row, description, 0, null, "OPENING_BALANCE"),
                signedBalance,
                delta: 0,
            }];
        }

        let amount: number | null = null;
        let side: LedgerEntry["side"] = null;

        if (debit !== null && credit === null) {
            amount = debit;
            side = "DEBIT";
        } else if (credit !== null && debit === null) {
            amount = credit;
            side = "CREDIT";
        } else if (single && single.amount > 0) {
            amount = single.amount;
            side = single.marker === "DR" ? "DEBIT" : single.marker === "CR" ? "CREDIT" : single.negative ? "DEBIT" : null;
        }

        if (amount === null) return [];

        return [{
            entry: entry(row, description, amount, side, "UNCLASSIFIED"),
            signedBalance,
            delta: side === null ? null : side === "DEBIT" ? amount : -amount,
        }];
    });
}

function entry(
    row: StatementTable["rows"][number],
    description: string,
    amount: number,
    side: LedgerEntry["side"],
    kind: LedgerEntry["kind"]
): LedgerEntry {
    return {
        date: row.date,
        description: description.trim(),
        reference: row.cells.reference?.trim() || referenceIn(description),
        amount,
        side,
        effect: "UNKNOWN",
        kind,
        isDeduction: false,
        kindProvenance: "SOURCE",
        allocationNote: null,
        principal: plain(row.cells.principal),
        interest: plain(row.cells.interest),
        balance: null,
        page: row.page,
        chainStatus: "NOT_CHECKED",
    };
}

/** A payment reference inside the narration, when it carries one. */
function referenceIn(description: string): string | null {
    const coded = /\b[A-Z]{2,}[A-Z0-9]*\d[A-Z0-9]*(?:\/\d+)?\b/.exec(description);
    if (coded && coded[0].length >= 8) return coded[0];

    return /\b(?:cheque|chq)\s*(?:no\.?)?\s*(\d{4,})\b/i.exec(description)?.[1] ?? /\b\d{9,}\b/.exec(description)?.[0] ?? null;
}

function chainScore(rows: readonly RawRow[], direction: 1 | -1): { checked: number; mismatches: number } {
    let running: number | null = null;
    let checked = 0;
    let mismatches = 0;

    for (const row of rows) {
        if (running !== null && row.delta !== null) {
            running += direction * row.delta;
            if (row.signedBalance !== null) {
                checked += 1;
                if (Math.abs(row.signedBalance - running) > EPSILON) mismatches += 1;
            }
        }
        if (row.signedBalance !== null) running = row.signedBalance;
    }

    return { checked, mismatches };
}

export interface LedgerResult {
    entries: LedgerEntry[];
    check: LedgerCheck;
    summary: LedgerSummary;
}

export const EMPTY_SUMMARY: LedgerSummary = {
    drawdownCount: 0,
    drawdownTotal: 0,
    repaymentCount: 0,
    repaymentTotal: 0,
    interestChargedTotal: 0,
    interestPaidTotal: 0,
    otherChargesTotal: 0,
    reversalCount: 0,
    bouncedCount: 0,
    unclassifiedCount: 0,
};

export function buildLedger(tables: readonly StatementTable[]): LedgerResult | null {
    const rows = tables.filter(table => table.kind === "LEDGER").flatMap(rawRows);

    if (rows.length === 0) return null;

    const up = chainScore(rows, 1);
    const down = chainScore(rows, -1);
    const usable = up.checked > 0 || down.checked > 0;
    const direction: 1 | -1 | null = !usable
        ? null
        : up.mismatches <= down.mismatches
          ? 1
          : -1;

    // Which way the printed balance relates to what is owed:
    //   raises: debit lifts the balance, so the balance is the dues.
    //   lowers, negative balances: a bank-side view; dues = -balance.
    //   lowers, positive balances: the printing is reversed; credit lifts dues.
    const negatives = rows.filter(row => row.signedBalance !== null && row.signedBalance < 0).length;
    const positives = rows.filter(row => row.signedBalance !== null && row.signedBalance > 0).length;
    const bankSide = direction === -1 && negatives > positives;
    const creditRaises = direction === -1 && !bankSide;
    const owedSign = bankSide ? -1 : 1;
    const raisingSide = creditRaises ? "CREDIT" : "DEBIT";

    let running: number | null = null;
    let opening: number | null = null;
    let openingProvenance: LedgerCheck["openingProvenance"] = null;
    let openingDate: string | null = null;
    let closing: number | null = null;
    let checked = 0;
    let mismatches = 0;

    const entries = rows.map((row, index) => {
        const result = { ...row.entry };
        const printedDues = row.signedBalance === null ? null : owedSign * row.signedBalance;
        const change =
            result.side === null ? null : (result.side === raisingSide ? 1 : -1) * result.amount;

        if (result.kind === "OPENING_BALANCE") {
            if (index === 0 && printedDues !== null) {
                opening = printedDues;
                openingProvenance = "SOURCE";
                openingDate = result.date;
            }
        } else if (index === 0 && printedDues !== null && change !== null) {
            opening = roundMoney(printedDues - change);
            openingProvenance = "CALCULATED";
            openingDate = dayBefore(result.date);
        }

        if (running !== null && change !== null) {
            running = roundMoney(running + change);
            if (printedDues !== null) {
                checked += 1;
                const matches = Math.abs(printedDues - running) <= EPSILON;
                if (!matches) mismatches += 1;
                result.chainStatus = matches ? "OK" : "MISMATCH";
            }
        }

        if (printedDues !== null) running = printedDues;
        result.balance = printedDues;
        result.effect = change === null || result.kind === "OPENING_BALANCE" ? "UNKNOWN" : change > 0 ? "INCREASES_DUES" : "DECREASES_DUES";

        if (result.kind !== "OPENING_BALANCE") classify(result);

        return result;
    });

    closing = running;
    pairInterestServicing(entries);
    markBookingSections(entries);

    return {
        entries,
        check: {
            checkedRows: checked,
            mismatches,
            opening,
            openingProvenance,
            openingDate,
            closing,
            convention: direction === null ? "UNDETERMINED" : creditRaises ? "CREDIT_RAISES_DUES" : "DEBIT_RAISES_DUES",
        },
        summary: summarise(entries),
    };
}

function dayBefore(date: string): string {
    const parsed = new Date(`${date}T00:00:00Z`);
    parsed.setUTCDate(parsed.getUTCDate() - 1);

    return parsed.toISOString().slice(0, 10);
}

const GROSS_DISBURSAL = /amount financed|loan amount|disbursal amount|amount disbursed|disbursed/i;

function classify(entry: LedgerEntry): void {
    const narration = narrationKind(entry.description);
    const lowers = entry.effect === "DECREASES_DUES";

    if (narration === "CHARGE" && !lowers) entry.kind = "OTHER_CHARGE";
    else if (narration === "INTEREST" && !lowers) entry.kind = "INTEREST_CHARGE";
    else if (narration === "INSTALMENT" && !lowers) entry.kind = "INSTALMENT_DEMAND";
    else if (narration === "REVERSAL") entry.kind = "REVERSAL";
    else if (narration === "BOUNCED") entry.kind = "BOUNCED";
    // Some lenders credit the whole loan to the account, then debit what is
    // withheld and paid out, so a disbursement can sit on either side.
    else if (narration === "DRAWDOWN" && (!lowers || (GROSS_DISBURSAL.test(entry.description) && !/(?:rcvd|received|adjust\w*)/i.test(entry.description)))) entry.kind = "DRAWDOWN";
    else if (lowers && (narration === "REPAYMENT" || narration === "INSTALMENT")) entry.kind = "REPAYMENT";
    else if (lowers && narration === "INTEREST") entry.kind = "INTEREST_PAYMENT";
    else entry.kind = "UNCLASSIFIED";
}

/**
 * After a disbursement credited in full: debits that are fees were withheld
 * from it, and the debit that clears the account is what was actually paid
 * out. Only the document's own rows and balance decide this.
 */
function markBookingSections(entries: LedgerEntry[]): void {
    // Charges debited one by one, then cleared by a single credit "adjusted
    // from disbursement": the charges are those that add up to that credit.
    entries.forEach((adjustment, index) => {
        if (adjustment.side !== "CREDIT" || !/adjust\w*\s+from\s+disburs/i.test(adjustment.description)) return;

        let remaining = adjustment.amount;
        const charges: LedgerEntry[] = [];
        for (let back = index - 1; back >= 0 && remaining > EPSILON; back -= 1) {
            const entry = entries[back]!;
            if (entry.side !== "DEBIT" || entry.kind !== "OTHER_CHARGE") break;
            charges.push(entry);
            remaining = roundMoney(remaining - entry.amount);
        }

        if (Math.abs(remaining) <= EPSILON) charges.forEach(entry => { entry.isDeduction = true; });
    });

    entries.forEach((gross, index) => {
        if (gross.kind !== "DRAWDOWN" || gross.side !== "CREDIT") return;

        for (let next = index + 1; next < entries.length; next += 1) {
            const entry = entries[next]!;
            if (entry.side !== "DEBIT") break;

            if (entry.kind === "OTHER_CHARGE") {
                entry.isDeduction = true;
            } else if (entry.balance !== null && Math.abs(entry.balance) <= EPSILON) {
                entry.kind = "DISBURSEMENT_PAYOUT";
                break;
            } else {
                break;
            }
        }
    });
}

export interface LedgerBooking {
    date: string;
    gross: number;
    net: number | null;
    deductions: number;
    payoutDate: string | null;
    reference: string | null;
    page: number;
}

export function bookingsFrom(entries: readonly LedgerEntry[]): LedgerBooking[] {
    const bookings: LedgerBooking[] = [];

    entries.forEach((gross, index) => {
        if (gross.kind !== "DRAWDOWN" || gross.side !== "CREDIT") return;

        let deductions = 0;
        let payout: LedgerEntry | null = null;
        for (const entry of entries.slice(index + 1)) {
            if (entry.isDeduction) deductions += entry.amount;
            else if (entry.kind === "DISBURSEMENT_PAYOUT") {
                payout = entry;
                break;
            } else break;
        }

        bookings.push({
            date: gross.date,
            gross: gross.amount,
            net: payout?.amount ?? null,
            deductions: roundMoney(deductions),
            payoutDate: payout?.date ?? null,
            reference: payout?.reference ?? null,
            page: gross.page,
        });
    });

    return bookings;
}

export interface SummaryTotals {
    principalRepaid: { amount: number; label: string; page: number } | null;
    interestPaid: { amount: number; label: string; page: number } | null;
}

/** Whole-of-loan totals from a "Particulars / Debits / Credits" summary. Never split by instalment. */
export function buildSummaryTotals(tables: readonly StatementTable[]): SummaryTotals {
    const rows = tables.filter(table => table.kind === "SUMMARY").flatMap(table => table.rows);
    const pick = (pattern: RegExp, exclude?: RegExp): SummaryTotals["principalRepaid"] => {
        for (const row of rows) {
            const label = (row.cells.description ?? "").trim();
            const credit = amountOf(row.cells.credit);

            if (credit !== null && pattern.test(label) && !exclude?.test(label)) {
                return { amount: credit, label, page: row.page };
            }
        }

        return null;
    };

    return {
        principalRepaid: pick(/\bprincipal\b/i, /prepaid|penal|late/i),
        interestPaid: pick(/\binterest\b/i, /prepaid|upfront|penal|late|pemi/i),
    };
}

/** A receipt equal to an interest debit on the same day only services that interest. */
function pairInterestServicing(entries: LedgerEntry[]): void {
    const claimed = new Set<LedgerEntry>();

    for (const receipt of entries) {
        if (receipt.kind !== "REPAYMENT") continue;

        const charge = entries.find(
            other =>
                other.kind === "INTEREST_CHARGE" &&
                !claimed.has(other) &&
                other.date === receipt.date &&
                Math.abs(other.amount - receipt.amount) <= EPSILON
        );

        if (charge) {
            claimed.add(charge);
            receipt.kind = "INTEREST_PAYMENT";
            receipt.kindProvenance = "CALCULATED";
            receipt.allocationNote = `Equals the interest debited on ${receipt.date}.`;
        }
    }
}

function summarise(entries: readonly LedgerEntry[]): LedgerSummary {
    const total = (kind: LedgerEntry["kind"]) =>
        roundMoney(entries.filter(e => e.kind === kind).reduce((sum, e) => sum + e.amount, 0));
    const count = (kind: LedgerEntry["kind"]) => entries.filter(e => e.kind === kind).length;

    return {
        drawdownCount: count("DRAWDOWN"),
        drawdownTotal: total("DRAWDOWN"),
        repaymentCount: count("REPAYMENT"),
        repaymentTotal: total("REPAYMENT"),
        interestChargedTotal: total("INTEREST_CHARGE"),
        interestPaidTotal: total("INTEREST_PAYMENT"),
        otherChargesTotal: total("OTHER_CHARGE"),
        reversalCount: count("REVERSAL"),
        bouncedCount: count("BOUNCED"),
        unclassifiedCount: count("UNCLASSIFIED"),
    };
}

export function buildSchedule(tables: readonly StatementTable[]): { rows: ScheduleRow[]; problems: string[] } {
    const problems: string[] = [];
    const rows: ScheduleRow[] = tables
        .filter(table => table.kind === "SCHEDULE")
        .flatMap(table => table.rows)
        .map((row, index) => {
            const number = row.cells.instalmentNo ? Number(row.cells.instalmentNo.replace(/\D/g, "")) : Number.NaN;

            return {
                installmentNumber: Number.isInteger(number) && number > 0 ? number : index + 1,
                dueDate: row.date,
                openingPrincipal: plain(row.cells.opening),
                principal: plain(row.cells.principal),
                interest: plain(row.cells.interest),
                emi: plain(row.cells.emi),
                closingPrincipal: plain(row.cells.closing ?? row.cells.balance),
                page: row.page,
            };
        });

    let unsplit = 0;
    rows.forEach(row => {
        if (row.principal === null || row.interest === null) unsplit += 1;
    });
    if (unsplit > 0) problems.push(`${unsplit} schedule row(s) do not print both principal and interest.`);

    return { rows, problems };
}

export function buildDisbursements(tables: readonly StatementTable[]): DisbursementRow[] {
    return tables
        .filter(table => table.kind === "DISBURSEMENTS")
        .flatMap(table => table.rows)
        .map(row => {
            const gross = plain(row.cells.gross);
            const net = plain(row.cells.net);
            const printedDeductions = plain(row.cells.deductions);

            return {
                date: row.date || null,
                gross,
                net,
                deductions: printedDeductions ?? (gross !== null && net !== null ? roundMoney(gross - net) : null),
                reference: row.cells.reference?.trim() || null,
                provenance: "SOURCE" as const,
                page: row.page,
            };
        });
}

export function buildCharges(tables: readonly StatementTable[]): ChargeRow[] {
    return tables
        .filter(table => table.kind === "CHARGES")
        .flatMap(table => table.rows)
        .flatMap((row): ChargeRow[] => {
            const amount = amountOf(row.cells.amount ?? row.cells.debit);
            const name = (row.cells.chargeName ?? row.cells.description ?? "").trim();

            return amount !== null && name
                ? [{ name, date: row.date || null, amount, category: chargeCategory(name), page: row.page }]
                : [];
        });
}

export function buildLimitSchedule(tables: readonly StatementTable[]): LimitChange[] {
    return tables
        .filter(table => table.kind === "LIMITS")
        .flatMap(table => table.rows)
        .flatMap((row): LimitChange[] => {
            const drawingPower = plain(row.cells.drawingPower);
            const limit = plain(row.cells.limit);
            const amount = drawingPower ?? limit;

            return amount === null
                ? []
                : [{
                      effectiveDate: row.date || null,
                      amount,
                      subject: drawingPower !== null ? "DRAWING_POWER" : "LIMIT",
                      nature: "SCHEDULED",
                      page: row.page,
                      raw: Object.values(row.cells).join(" "),
                  }];
        });
}

export function buildRateTable(tables: readonly StatementTable[]): RateChange[] {
    return tables
        .filter(table => table.kind === "RATES")
        .flatMap(table => table.rows)
        .flatMap((row): RateChange[] => {
            const rate = row.cells.rate ? parseRate(row.cells.rate) : null;

            return rate === null
                ? []
                : [{ effectiveDate: row.date || null, rate, previousRate: null, page: row.page, raw: Object.values(row.cells).join(" ") }];
        });
}

const WEF = String.raw`(?:w\.?\s*e\.?\s*f\.?|with effect from|effective(?: from)?|from)`;
const DATE_TEXT = String.raw`(\d[\w\s\-/.,]{5,18}\d)`;
const RATE_REVISION = new RegExp(String.raw`\b(?:rate|roi|interest)\b.*?\b(?:revised|changed|reset|increased|reduced)\b.*?(\d{1,2}(?:\.\d{1,4})?)\s*%.*?${WEF}\s*:?\s*${DATE_TEXT}`, "i");
const RATE_FROM_TO = /\b(?:rate|roi|interest)\b.*?\bfrom\s+(\d{1,2}(?:\.\d{1,4})?)\s*%\s*to\s+(\d{1,2}(?:\.\d{1,4})?)\s*%/i;
const DATE_IN_TEXT = /\b\d{1,2}[-/ ][A-Za-z]{3,9}[-/ ]\d{2,4}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;
const LIMIT_REVISION = new RegExp(String.raw`\b(limit|drawing power|dp)\b.*?\b(?:revised|changed|reduced|enhanced|increased|decreased)\b.*?(?:to|at)\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)\s*.*?${WEF}\s*:?\s*${DATE_TEXT}`, "i");

export function revisionsFromText(
    lines: ReadonlyArray<{ page: number; text: string }>,
    dates: DateContext
): { rates: RateChange[]; limits: LimitChange[] } {
    const rates: RateChange[] = [];
    const limits: LimitChange[] = [];

    for (const { page, text } of lines) {
        const fromTo = RATE_FROM_TO.exec(text);
        if (fromTo) {
            const previous = parseRate(fromTo[1]!);
            const next = parseRate(fromTo[2]!);
            // The narration's own row; the last date before it is the effective one.
            const printedDates = text.slice(0, fromTo.index + fromTo[0].length).match(DATE_IN_TEXT) ?? [];
            const dateText = printedDates[printedDates.length - 1];

            if (next !== null) {
                rates.push({ effectiveDate: dateText ? parseDateValue(dateText, dates) : null, rate: next, previousRate: previous, page, raw: text });
            }
            continue;
        }

        const rate = RATE_REVISION.exec(text);
        if (rate) {
            const value = parseRate(rate[1]!);
            if (value !== null) rates.push({ effectiveDate: parseDateValue(rate[2]!, dates), rate: value, previousRate: null, page, raw: text });
            continue;
        }

        const limit = LIMIT_REVISION.exec(text);
        if (limit) {
            const amount = readMoney(limit[2]!)?.amount;
            if (amount !== undefined) {
                limits.push({
                    effectiveDate: parseDateValue(limit[3]!, dates),
                    amount,
                    subject: /limit/i.test(limit[1]!) ? "LIMIT" : "DRAWING_POWER",
                    nature: "REVISION",
                    page,
                    raw: text,
                });
            }
        }
    }

    return { rates, limits };
}
