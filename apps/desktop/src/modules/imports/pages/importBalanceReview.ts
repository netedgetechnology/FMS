import {
    balanceMismatchErrors,
    reconcileBalanceChain,
    type BalanceMismatch,
    type ImportValidationError,
    type NormalizedTransactionCandidate,
} from "@financeos/import-engine";

import type { PreviewOverrides } from "./ImportsPage";

// ---------------------------------------------------------------------
// PDF running-balance review for the Import Preview.
//
// A PDF statement prints a running balance on (almost) every row. The
// import engine's reconcileBalanceChain checks each row against it:
//   previous row's balance ± this row's amount  must equal  this row's
//   printed balance.
// A row where it does not is a "balance mismatch" (see BalanceMismatch in
// @financeos/import-engine for the exact meaning of every figure).
//
// Rules implemented here:
// - Mismatches are detected on the rows exactly as previewed. Nothing is
//   ever changed automatically - no amount or Income/Expense is guessed.
// - A mismatched row blocks the Import until the user resolves it by
//   either
//     * correcting its amount and/or Income/Expense so that it reconciles
//       (re-checked live against the same printed balances), or
//     * skipping it, so it is left out of this import.
// - Each row's check depends only on its own amount/direction and the
//   two printed balances, so correcting or skipping one row never changes
//   another row's result. Skipped rows stay in the chain (their printed
//   balance is still the next row's "previous balance").
// - Only rows flagged at preview time can carry a correction, so normal
//   rows are never touched.
// ---------------------------------------------------------------------

export type BalanceRowStatus =
    | "mismatch"
    | "corrected"
    | "skipped";

export interface BalanceRowReview {
    status: BalanceRowStatus;
    // The mismatch as detected on the previewed row - kept so a corrected
    // or skipped row can still show what was wrong.
    detected: BalanceMismatch;
    // The mismatch on the row as it now stands (after corrections); null
    // once it reconciles.
    current: BalanceMismatch | null;
}

export interface BalanceReview {
    rows: ReadonlyMap<number, BalanceRowReview>;
    // Flagged rows still blocking the Import (not corrected, not skipped).
    unresolvedRowNumbers: ReadonlySet<number>;
    // One validation error per unresolved row (field "balance").
    errors: ImportValidationError[];
    counts: {
        mismatch: number;
        corrected: number;
        skipped: number;
    };
}

export const NO_BALANCE_MISMATCHES: ReadonlyMap<number, BalanceMismatch> =
    new Map();

export const EMPTY_BALANCE_REVIEW: BalanceReview = {
    rows: new Map(),
    unresolvedRowNumbers: new Set(),
    errors: [],
    counts: { mismatch: 0, corrected: 0, skipped: 0 },
};

// Mismatches on the previewed (uncorrected) rows, keyed by rowNumber.
export function detectBalanceMismatches(
    candidates: readonly NormalizedTransactionCandidate[]
): ReadonlyMap<number, BalanceMismatch> {
    const { mismatches } = reconcileBalanceChain(candidates);

    if (mismatches.length === 0) {
        return NO_BALANCE_MISMATCHES;
    }

    return new Map(
        mismatches.map(mismatch => [mismatch.rowNumber, mismatch])
    );
}

function sameMismatch(
    a: BalanceMismatch | null,
    b: BalanceMismatch | null
): boolean {
    if (a === b) {
        return true;
    }

    if (!a || !b) {
        return false;
    }

    return (
        a.amount === b.amount &&
        a.type === b.type &&
        a.difference === b.difference &&
        a.kind === b.kind
    );
}

// Re-checks the flagged rows against the current (possibly corrected)
// candidates. `candidates` is the FULL preview list, skipped rows
// included. `previous` lets unchanged rows keep their review object, so
// memoized preview rows don't re-render.
export function reviewBalanceCorrections(
    detected: ReadonlyMap<number, BalanceMismatch>,
    candidates: readonly NormalizedTransactionCandidate[],
    skippedRowNumbers: ReadonlySet<number>,
    previous: BalanceReview | null = null
): BalanceReview {
    if (detected.size === 0) {
        return EMPTY_BALANCE_REVIEW;
    }

    const { mismatches } = reconcileBalanceChain(candidates);

    const currentByRow = new Map(
        mismatches.map(mismatch => [mismatch.rowNumber, mismatch])
    );

    const rows = new Map<number, BalanceRowReview>();
    const unresolvedRowNumbers = new Set<number>();
    const unresolved: BalanceMismatch[] = [];
    const counts = { mismatch: 0, corrected: 0, skipped: 0 };

    for (const [rowNumber, detectedMismatch] of detected) {
        const current = currentByRow.get(rowNumber) ?? null;

        const status: BalanceRowStatus = skippedRowNumbers.has(
            rowNumber
        )
            ? "skipped"
            : current
                ? "mismatch"
                : "corrected";

        counts[status] += 1;

        if (status === "mismatch" && current) {
            unresolvedRowNumbers.add(rowNumber);
            unresolved.push(current);
        }

        const prior = previous?.rows.get(rowNumber);

        rows.set(
            rowNumber,
            prior &&
                prior.status === status &&
                sameMismatch(prior.detected, detectedMismatch) &&
                sameMismatch(prior.current, current)
                ? prior
                : { status, detected: detectedMismatch, current }
        );
    }

    return {
        rows,
        unresolvedRowNumbers,
        errors: balanceMismatchErrors(unresolved),
        counts,
    };
}

// The Import Preview's error list: the preview's own validation errors
// (minus rows the user skipped - they won't be imported) plus one balance
// error per unresolved mismatch, in row order.
export function combinePreviewErrors(
    validationErrors: readonly ImportValidationError[],
    skippedRowNumbers: ReadonlySet<number>,
    balanceErrors: readonly ImportValidationError[]
): ImportValidationError[] {
    const kept =
        skippedRowNumbers.size === 0
            ? validationErrors
            : validationErrors.filter(
                  error => !skippedRowNumbers.has(error.rowNumber)
              );

    if (balanceErrors.length === 0) {
        return kept as ImportValidationError[];
    }

    return [...kept, ...balanceErrors].sort(
        (a, b) => a.rowNumber - b.rowNumber
    );
}

// Rows counted as Ready: not skipped, no error, not a duplicate.
export function countReadyRows(
    candidates: readonly NormalizedTransactionCandidate[],
    errorRowNumbers: ReadonlySet<number>,
    duplicateRowNumbers: { has(rowNumber: number): boolean },
    skippedRowNumbers: ReadonlySet<number>
): number {
    let ready = 0;

    for (const candidate of candidates) {
        if (
            !skippedRowNumbers.has(candidate.rowNumber) &&
            !errorRowNumbers.has(candidate.rowNumber) &&
            !duplicateRowNumbers.has(candidate.rowNumber)
        ) {
            ready += 1;
        }
    }

    return ready;
}

// Parses a user-typed corrected amount. Only a finite, positive number
// (commas allowed, at most 2 decimals kept) is accepted; anything else is
// rejected (null) rather than coerced.
export function parseCorrectedAmount(raw: string): number | null {
    const cleaned = raw.replace(/[,\s₹]/g, "");

    if (!/^\d+(?:\.\d+)?$/.test(cleaned)) {
        return null;
    }

    const value = Math.round(Number(cleaned) * 100) / 100;

    return Number.isFinite(value) && value > 0 ? value : null;
}

// ---------------------------------------------------------------------
// Resolution actions. Each touches exactly one row - a balance
// correction is never propagated to "matching" rows, since every row's
// mismatch is its own arithmetic fact. Setting a value back to what the
// row showed at preview time removes the correction entirely.
// ---------------------------------------------------------------------

function previewedRow(
    previewed: readonly NormalizedTransactionCandidate[],
    rowNumber: number
): NormalizedTransactionCandidate | undefined {
    return previewed.find(
        candidate => candidate.rowNumber === rowNumber
    );
}

export function applyBalanceDirection(
    overrides: PreviewOverrides,
    previewed: readonly NormalizedTransactionCandidate[],
    rowNumber: number,
    direction: "income" | "expense"
): PreviewOverrides {
    const next = new Map(overrides.direction);

    if (previewedRow(previewed, rowNumber)?.type === direction) {
        next.delete(rowNumber);
    } else {
        next.set(rowNumber, direction);
    }

    return { ...overrides, direction: next };
}

export function applyBalanceAmount(
    overrides: PreviewOverrides,
    previewed: readonly NormalizedTransactionCandidate[],
    rowNumber: number,
    amount: number
): PreviewOverrides {
    const next = new Map(overrides.amount);

    if (previewedRow(previewed, rowNumber)?.amount === amount) {
        next.delete(rowNumber);
    } else {
        next.set(rowNumber, amount);
    }

    return { ...overrides, amount: next };
}

export function toggleBalanceSkip(
    overrides: PreviewOverrides,
    rowNumber: number
): PreviewOverrides {
    const next = new Set(overrides.skipped);

    if (next.has(rowNumber)) {
        next.delete(rowNumber);
    } else {
        next.add(rowNumber);
    }

    return { ...overrides, skipped: next };
}
