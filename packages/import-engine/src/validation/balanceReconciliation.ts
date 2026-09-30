import type {
    ImportValidationError,
    NormalizedTransactionCandidate,
} from "../types";

// One row whose amount + direction does not agree with the statement's
// own running balance. All money values are in the statement's currency,
// rounded to 2 decimals.
//
// Exact meaning (this is what the Import Preview shows the user):
//   previousBalance  - the running balance printed on the chronologically
//                      previous row (previousRowNumber).
//   expectedBalance  - previousBalance + amount (income) or
//                      previousBalance - amount (expense): the balance
//                      this row SHOULD print if its amount and direction
//                      were read correctly.
//   statementBalance - the running balance actually printed on this row.
//   difference       - statementBalance - expectedBalance. Never 0 here.
//   statementMovement - statementBalance - previousBalance: how much the
//                      statement says the balance actually moved.
//   kind "direction" - the opposite direction would reconcile exactly
//                      (|movement| equals the amount, sign disagrees), so
//                      Income/Expense is the likely problem.
//   kind "amount"    - the balance moved by a different amount than this
//                      row's amount (a misread amount, a merged/missing
//                      row, or an inconsistent statement).
// It is evidence for the user to act on - never applied automatically.
export interface BalanceMismatch {
    rowNumber: number;
    previousRowNumber: number;
    previousBalance: number;
    amount: number;
    type: "income" | "expense";
    expectedBalance: number;
    statementBalance: number;
    difference: number;
    statementMovement: number;
    kind: "direction" | "amount";
}

export interface BalanceReconciliationResult {
    // Rows whose amount + direction could be checked against the
    // previous row's running balance.
    checkedRows: number;
    // Rows where previous balance ± amount does not equal this row's
    // printed balance. Empty when every checked row agrees.
    mismatchedRowNumbers: number[];
    // Full detail for each mismatched row, in rowNumber order.
    mismatches: BalanceMismatch[];
    order: "ascending" | "descending";
}

function toCents(value: number): number {
    return Math.round(value * 100);
}

function fromCents(cents: number): number {
    return cents / 100;
}

// Uses the statement's own arithmetic as ground truth: for consecutive
// (chronological) rows that both print a running balance,
// balance[n] must equal balance[n-1] + amount (income) or - amount
// (expense). Needs no knowledge of the source layout, so it verifies any
// importer's output. Each row's check depends only on its own
// amount/direction and the two printed balances, so correcting one row
// never changes another row's result. Transfers and rows with no
// direction (ambiguous) carry no sign and are skipped - never guessed; a
// row without a balance breaks the chain rather than producing a false
// mismatch. Linear time.
export function reconcileBalanceChain(
    candidates: readonly NormalizedTransactionCandidate[],
): BalanceReconciliationResult {
    let first = "";
    let last = "";

    for (const candidate of candidates) {
        if (candidate.transactionDate !== null) {
            first ||= candidate.transactionDate;
            last = candidate.transactionDate;
        }
    }

    const order =
        first > last ? "descending" : "ascending";

    const count = candidates.length;

    let previous: {
        rowNumber: number;
        cents: number;
    } | null = null;

    let checkedRows = 0;
    const mismatches: BalanceMismatch[] = [];

    for (let step = 0; step < count; step += 1) {
        const candidate =
            candidates[
                order === "descending"
                    ? count - 1 - step
                    : step
            ];

        if (!candidate || candidate.balance === null) {
            previous = null;
            continue;
        }

        const statementCents = toCents(
            candidate.balance,
        );

        if (
            previous !== null &&
            candidate.amount !== null &&
            (candidate.type === "income" ||
                candidate.type === "expense")
        ) {
            const amountCents = toCents(
                candidate.amount,
            );

            const signedCents =
                candidate.type === "income"
                    ? amountCents
                    : -amountCents;

            const expectedCents: number =
                previous.cents + signedCents;

            checkedRows += 1;

            if (expectedCents !== statementCents) {
                const movementCents: number =
                    statementCents - previous.cents;

                mismatches.push({
                    rowNumber: candidate.rowNumber,
                    previousRowNumber:
                        previous.rowNumber,
                    previousBalance: fromCents(
                        previous.cents,
                    ),
                    amount: candidate.amount,
                    type: candidate.type,
                    expectedBalance:
                        fromCents(expectedCents),
                    statementBalance:
                        fromCents(statementCents),
                    difference: fromCents(
                        statementCents -
                            expectedCents,
                    ),
                    statementMovement:
                        fromCents(movementCents),
                    kind:
                        movementCents === -signedCents
                            ? "direction"
                            : "amount",
                });
            }
        }

        previous = {
            rowNumber: candidate.rowNumber,
            cents: statementCents,
        };
    }

    mismatches.sort(
        (a, b) => a.rowNumber - b.rowNumber,
    );

    return {
        checkedRows,
        mismatchedRowNumbers: mismatches.map(
            (mismatch) => mismatch.rowNumber,
        ),
        mismatches,
        order,
    };
}

function formatAmount(value: number): string {
    return value.toFixed(2);
}

// The one user-facing sentence for a mismatch, shared by the Import
// Preview and the import service so they can never disagree.
export function describeBalanceMismatch(
    mismatch: BalanceMismatch,
): string {
    const direction =
        mismatch.type === "income"
            ? "Income"
            : "Expense";

    const base =
        `Balance mismatch: previous balance ${formatAmount(mismatch.previousBalance)} ` +
        `${mismatch.type === "income" ? "+" : "-"} ${direction} ${formatAmount(mismatch.amount)} ` +
        `= expected ${formatAmount(mismatch.expectedBalance)}, ` +
        `but the statement shows ${formatAmount(mismatch.statementBalance)} ` +
        `(difference ${mismatch.difference > 0 ? "+" : ""}${formatAmount(mismatch.difference)}).`;

    if (mismatch.kind === "direction") {
        return (
            `${base} The balance moved the opposite way - ` +
            "check whether this row is Income or Expense."
        );
    }

    return (
        `${base} The balance moved by ${formatAmount(Math.abs(mismatch.statementMovement))}, ` +
        "not by this row's amount - check the amount, or skip the row."
    );
}

export function balanceMismatchErrors(
    mismatches: readonly BalanceMismatch[],
): ImportValidationError[] {
    return mismatches.map((mismatch) => ({
        rowNumber: mismatch.rowNumber,
        field: "balance",
        message: describeBalanceMismatch(mismatch),
    }));
}
