// ---------------------------------------------------------------------
// Historical instalments of a loan that was already running when it was
// added to FinWea.
//
// There is no "N instalments already paid" count any more. Each historical
// instalment is resolved ONE BY ONE, by the user:
//   LINKED                - the EMI debit is an EXISTING bank transaction
//                           (exact amount, money out, on the loan's EMI
//                           account). A real loan_schedule_payments row is
//                           written for it, exactly as if it had been linked
//                           from the EMI schedule later.
//   SETTLED_BEFORE_FINWEA - the user declares it was paid before FinWea
//                           tracked the account. There is no transaction and
//                           no payment record; the instalment carries the
//                           settled_before_finwea flag (migration 052) so it
//                           is never mistaken for a real payment.
//
// Rules (also enforced in LoanService.create and src-tauri loan_create.rs):
//   - historical instalments are the FIRST instalments, in order;
//   - an instalment due after today can never be marked paid;
//   - one bank transaction backs at most one instalment (and nothing else);
//   - FinWea only SUGGESTS matching debits - nothing is linked until the
//     user confirms it.
// Pure: no database, no React.
// ---------------------------------------------------------------------

import { LoanPaymentStatus, type LoanPaymentSchedule } from "../types";
import { formatMoney, sameMoney } from "./loanSetupAccounting";
import type { LinkedTransactionSummary, SetupIssue } from "./loanSetupTypes";

export type HistoricalResolution = "LINKED" | "SETTLED_BEFORE_FINWEA";

export const HISTORICAL_RESOLUTION_LABELS: Record<HistoricalResolution, string> = {
    LINKED: "Linked bank debit",
    SETTLED_BEFORE_FINWEA: "Settled before FinWea",
};

/** How far (in days) from the due date a debit is still offered as a match. */
export const HISTORICAL_MATCH_WINDOW_DAYS = 10;

/** One historical instalment as the wizard edits it (index i = instalment i+1). */
export interface HistoricalInstalmentDraft {
    resolution: HistoricalResolution | null;
    transaction: LinkedTransactionSummary | null;
}

/** One resolved historical instalment, as LoanService.create receives it. */
export interface HistoricalInstalmentDetails {
    installmentNumber: number;
    resolution: HistoricalResolution;
    /** LINKED only. */
    transactionId: string | null;
    transactionDate: string | null;
    transactionAmount: number | null;
    transactionAccountId: string | null;
    transactionSide: "IN" | "OUT" | null;
}

/** What is checked about one historical instalment. */
export interface HistoricalEntry {
    installmentNumber: number;
    resolution: HistoricalResolution | null;
    transaction: Pick<LinkedTransactionSummary, "id" | "date" | "amount" | "accountId" | "side"> | null;
}

export interface HistoricalContext {
    /** Today, YYYY-MM-DD (local). */
    today: string;
    /** The loan's EMI debit account. */
    accountId: string | null;
    loanStartDate: string;
    /** Transactions already used elsewhere in this setup (disbursements, expenses). */
    otherLinkedIds?: readonly string[];
}

/** Today's local date, YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
    return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
    ].join("-");
}

function day(value: string): string {
    return value.slice(0, 10);
}

/** The instalments already due on or before `today` (only these can be historical). */
export function dueInstalmentCount(
    schedule: readonly Pick<LoanPaymentSchedule, "dueDate">[],
    today: string
): number {
    let count = 0;

    for (const row of schedule) {
        if (day(row.dueDate) > today) {
            break;
        }

        count++;
    }

    return count;
}

export function entriesFromDraft(
    schedule: readonly Pick<LoanPaymentSchedule, "installmentNumber">[],
    historical: readonly HistoricalInstalmentDraft[]
): HistoricalEntry[] {
    return historical.map((item, index) => ({
        installmentNumber: schedule[index]?.installmentNumber ?? index + 1,
        resolution: item.resolution,
        transaction: item.resolution === "LINKED" ? item.transaction : null,
    }));
}

export function entriesFromDetails(details: readonly HistoricalInstalmentDetails[]): HistoricalEntry[] {
    return details.map(item => ({
        installmentNumber: item.installmentNumber,
        resolution: item.resolution,
        transaction:
            item.transactionId === null
                ? null
                : {
                      id: item.transactionId,
                      date: item.transactionDate ?? "",
                      amount: Number(item.transactionAmount ?? 0),
                      accountId: item.transactionAccountId ?? "",
                      side: item.transactionSide,
                  },
    }));
}

/**
 * Everything wrong with the historical instalments against the (unmarked)
 * schedule. An empty list means they can be saved.
 */
export function historicalInstalmentIssues(
    schedule: readonly LoanPaymentSchedule[],
    entries: readonly HistoricalEntry[],
    context: HistoricalContext
): SetupIssue[] {
    const issues: SetupIssue[] = [];
    const push = (message: string) => issues.push({ field: "historical", message });
    const used = new Set(context.otherLinkedIds ?? []);

    if (entries.length > schedule.length) {
        push("More historical instalments are listed than the schedule has.");
        return issues;
    }

    entries.forEach((entry, index) => {
        const row = schedule[index]!;
        const label = `Instalment #${row.installmentNumber}`;

        if (entry.installmentNumber !== row.installmentNumber) {
            push("Historical instalments must be the first instalments of the schedule, in order.");
            return;
        }

        if (day(row.dueDate) > context.today) {
            push(`${label} is due on ${day(row.dueDate)}, after today - a future instalment cannot be marked paid.`);
            return;
        }

        if (entry.resolution === null) {
            push(`${label}: link its bank debit, or mark it "Settled before FinWea".`);
            return;
        }

        if (entry.resolution === "SETTLED_BEFORE_FINWEA") {
            if (entry.transaction) {
                push(`${label} is marked "Settled before FinWea", so it cannot also be linked to a bank transaction.`);
            }
            return;
        }

        const transaction = entry.transaction;

        if (!transaction) {
            push(`${label}: choose the bank debit to link, or mark it "Settled before FinWea".`);
            return;
        }

        if (!context.accountId) {
            push("Choose the bank account the EMIs are paid from before linking historical EMI debits.");
            return;
        }

        if (transaction.accountId !== context.accountId) {
            push(`The bank transaction linked to ${label.toLowerCase()} is not on the loan's EMI account.`);
        } else if (transaction.side !== "OUT") {
            push(`The bank transaction linked to ${label.toLowerCase()} is not money paid out.`);
        } else if (!sameMoney(transaction.amount, row.totalAmount)) {
            push(
                `The bank transaction linked to ${label.toLowerCase()} is for ${formatMoney(transaction.amount)}, not the instalment's ${formatMoney(row.totalAmount)} (amounts must match exactly).`
            );
        } else if (day(transaction.date) > context.today) {
            push(`The bank transaction linked to ${label.toLowerCase()} is dated after today.`);
        } else if (context.loanStartDate && day(transaction.date) < day(context.loanStartDate)) {
            push(`The bank transaction linked to ${label.toLowerCase()} is dated before the loan started.`);
        }

        if (used.has(transaction.id)) {
            push(`The bank transaction linked to ${label.toLowerCase()} is already used by another instalment or by this loan's setup.`);
        }

        used.add(transaction.id);
    });

    return issues;
}

/**
 * The schedule with the historical instalments marked PAID: a linked one
 * carries its bank transaction (paid on that transaction's date), a
 * settled one carries the "Settled before FinWea" flag and nothing else.
 * Stops at the first unresolved entry, so the PAID rows are always the
 * leading ones (the outstanding balance is read from the last of them).
 */
export function markHistoricalInstalments(
    schedule: readonly LoanPaymentSchedule[],
    entries: readonly HistoricalEntry[]
): LoanPaymentSchedule[] {
    const marked = schedule.map(row => ({ ...row, settledBeforeFinwea: false }));

    for (let index = 0; index < entries.length && index < marked.length; index++) {
        const entry = entries[index]!;
        const row = marked[index]!;

        if (entry.installmentNumber !== row.installmentNumber) {
            break;
        }

        if (entry.resolution === "SETTLED_BEFORE_FINWEA") {
            marked[index] = {
                ...row,
                status: LoanPaymentStatus.PAID,
                paidDate: row.dueDate,
                paidAmount: row.totalAmount,
                transactionId: null,
                settledBeforeFinwea: true,
            };
        } else if (entry.resolution === "LINKED" && entry.transaction) {
            marked[index] = {
                ...row,
                status: LoanPaymentStatus.PAID,
                paidDate: day(entry.transaction.date),
                paidAmount: row.totalAmount,
                transactionId: entry.transaction.id,
                settledBeforeFinwea: false,
            };
        } else {
            break;
        }
    }

    return marked;
}

export interface HistoricalSummary {
    linked: number;
    settledBeforeFinwea: number;
    unresolved: number;
}

export function historicalSummary(entries: readonly Pick<HistoricalEntry, "resolution" | "transaction">[]): HistoricalSummary {
    return {
        linked: entries.filter(e => e.resolution === "LINKED" && e.transaction).length,
        settledBeforeFinwea: entries.filter(e => e.resolution === "SETTLED_BEFORE_FINWEA").length,
        unresolved: entries.filter(e => e.resolution === null || (e.resolution === "LINKED" && !e.transaction)).length,
    };
}

/** Paid instalments, counted from the schedule itself (never typed in). */
export function paidInstalmentCount(schedule: readonly Pick<LoanPaymentSchedule, "status">[]): number {
    return schedule.filter(row => row.status === LoanPaymentStatus.PAID).length;
}

// ------------------------------------------------------------- matching

export interface HistoricalMatchContext {
    accountId: string;
    loanStartDate: string;
    today: string;
    loanAccountNumber?: string | null;
    lenderName?: string | null;
    /** Transactions already chosen elsewhere in this setup. */
    excludeIds?: readonly string[];
}

export interface HistoricalCandidate {
    transaction: LinkedTransactionSummary;
    installmentNumber: number;
    /** Transaction date minus due date, in days. */
    daysFromDue: number;
    narrationHasLoanNumber: boolean;
    narrationNamesLender: boolean;
    /** Plain-language reasons it is offered. */
    reasons: string[];
}

function daysBetween(from: string, to: string): number {
    const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
    const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));

    return Math.round((b - a) / 86_400_000);
}

function alnum(value: string | null | undefined): string {
    return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const GENERIC_LENDER_WORDS = new Set([
    "THE", "AND", "LTD", "LIMITED", "PVT", "PRIVATE", "CO", "COMPANY", "BANK", "FINANCE",
    "FINANCIAL", "FINSERV", "SERVICES", "CAPITAL", "HOUSING", "LOAN", "LOANS", "INDIA",
]);

function lenderWords(lenderName: string | null | undefined): string[] {
    return (lenderName ?? "")
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .filter(word => word.length >= 3 && !GENERIC_LENDER_WORDS.has(word));
}

function narrationHasLoanNumber(text: string, loanAccountNumber: string | null | undefined): boolean {
    const number = alnum(loanAccountNumber);

    if (number.length < 6) {
        return false;
    }

    const haystack = alnum(text);

    return haystack.includes(number) || (number.length >= 8 && haystack.includes(number.slice(-8)));
}

/**
 * Existing bank debits that COULD be each historical instalment's EMI:
 * on the loan's EMI account, money out, for exactly the instalment amount
 * (no tolerance), within HISTORICAL_MATCH_WINDOW_DAYS of the due date, not
 * before the loan started and not after today. Best first: the loan
 * account number in the narration, then the lender's name, then the
 * nearest date. These are suggestions only - nothing is linked here.
 */
export function matchHistoricalEmiDebits(
    instalments: readonly Pick<LoanPaymentSchedule, "installmentNumber" | "dueDate" | "totalAmount">[],
    transactions: readonly LinkedTransactionSummary[],
    context: HistoricalMatchContext
): Map<number, HistoricalCandidate[]> {
    const excluded = new Set(context.excludeIds ?? []);
    const words = lenderWords(context.lenderName);
    const result = new Map<number, HistoricalCandidate[]>();

    for (const instalment of instalments) {
        const candidates: HistoricalCandidate[] = [];

        for (const transaction of transactions) {
            const date = day(transaction.date);

            if (
                excluded.has(transaction.id) ||
                transaction.accountId !== context.accountId ||
                transaction.side !== "OUT" ||
                !sameMoney(transaction.amount, instalment.totalAmount) ||
                date > context.today ||
                (context.loanStartDate && date < day(context.loanStartDate))
            ) {
                continue;
            }

            const daysFromDue = daysBetween(day(instalment.dueDate), date);

            if (Math.abs(daysFromDue) > HISTORICAL_MATCH_WINDOW_DAYS) {
                continue;
            }

            const text = `${transaction.narration ?? ""} ${transaction.payee ?? ""}`;
            const hasNumber = narrationHasLoanNumber(text, context.loanAccountNumber);
            const upper = text.toUpperCase();
            const namesLender = words.length > 0 && words.some(word => upper.includes(word));
            const reasons = [
                "Same amount",
                daysFromDue === 0
                    ? "Paid on the due date"
                    : `${Math.abs(daysFromDue)} day${Math.abs(daysFromDue) === 1 ? "" : "s"} ${daysFromDue < 0 ? "before" : "after"} the due date`,
            ];

            if (hasNumber) reasons.push("Narration has the loan account number");
            if (namesLender) reasons.push("Narration names the lender");

            candidates.push({
                transaction,
                installmentNumber: instalment.installmentNumber,
                daysFromDue,
                narrationHasLoanNumber: hasNumber,
                narrationNamesLender: namesLender,
                reasons,
            });
        }

        candidates.sort(
            (a, b) =>
                Number(b.narrationHasLoanNumber) - Number(a.narrationHasLoanNumber) ||
                Number(b.narrationNamesLender) - Number(a.narrationNamesLender) ||
                Math.abs(a.daysFromDue) - Math.abs(b.daysFromDue) ||
                a.transaction.date.localeCompare(b.transaction.date)
        );

        result.set(instalment.installmentNumber, candidates);
    }

    return result;
}

/**
 * One suggested debit per instalment, never the same debit twice (earlier
 * instalments choose first). A suggestion is only shown - the user still
 * has to confirm it before anything is linked.
 */
export function suggestHistoricalLinks(
    matches: ReadonlyMap<number, readonly HistoricalCandidate[]>,
    alreadyChosen: readonly string[] = []
): Map<number, HistoricalCandidate> {
    const taken = new Set(alreadyChosen);
    const suggestions = new Map<number, HistoricalCandidate>();

    for (const installmentNumber of [...matches.keys()].sort((a, b) => a - b)) {
        const best = matches.get(installmentNumber)!.find(candidate => !taken.has(candidate.transaction.id));

        if (best) {
            suggestions.set(installmentNumber, best);
            taken.add(best.transaction.id);
        }
    }

    return suggestions;
}

/** The draft list resized to `count` entries (new ones unresolved). */
export function resizeHistorical(
    historical: readonly HistoricalInstalmentDraft[],
    count: number
): HistoricalInstalmentDraft[] {
    const size = Math.max(0, Math.floor(count || 0));
    const next = historical.slice(0, size);

    while (next.length < size) {
        next.push({ resolution: null, transaction: null });
    }

    return next;
}
