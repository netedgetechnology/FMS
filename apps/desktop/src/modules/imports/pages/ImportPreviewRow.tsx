import { Fragment, memo, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Wand2 } from "lucide-react";

import type {
    NormalizedTransactionCandidate,
    TransactionChannel,
} from "@financeos/import-engine";

import { signedTransactionAmount } from "@/core/formatting";
import type { Category } from "@/modules/categories/types";

import {
    parseCorrectedAmount,
    type BalanceRowReview,
} from "./importBalanceReview";
import {
    UNCATEGORIZED_OPTION_LABEL,
    UNCATEGORIZED_OPTION_VALUE,
    withRowCategory,
    type ImportCategoryOption,
} from "./importCategoryOptions";

// ---------------------------------------------------------------------
// One row of the Import Preview table.
//
// Performance (see ImportsPage.perf.test.ts): the preview must stay
// responsive at 5,000+ rows. Each row's Category <select> alone holds
// every category option (~100+), so re-rendering all rows means
// hundreds of thousands of elements. Hence:
// - React.memo: a row re-renders only when one of ITS props changes.
//   Every prop is a primitive or a reference ImportsPage keeps stable
//   (unchanged candidate objects are reused, handlers never change
//   identity, option lists are per-direction and memoized).
// - The live, per-keystroke Payee/Notes text is local state here, so
//   typing re-renders only this row - never ImportsPage or any other
//   row. The committed value reaches ImportsPage only on blur (exactly
//   as before: see handlePayeeOverrideCommit / handleNotesOverrideCommit),
//   and the draft is dropped at that moment, so what's shown is always
//   either the text being typed or the committed/propagated value.
// ---------------------------------------------------------------------

// Transaction *channel* (UPI/IMPS/NEFT/RTGS/Cash/Cheque) - separate from
// DR/CR direction. Optional; "" clears it back to blank/undetected.
export const TRANSACTION_CHANNEL_OPTIONS: Array<{
    value: TransactionChannel | "";
    label: string;
}> = [
    { value: "", label: "—" },
    { value: "UPI", label: "UPI" },
    { value: "IMPS", label: "IMPS" },
    { value: "NEFT", label: "NEFT" },
    { value: "RTGS", label: "RTGS" },
    { value: "CASH", label: "Cash" },
    { value: "CHEQUE", label: "Cheque" },
    { value: "EMANDATE", label: "E-Mandate" },
    { value: "NET_BANKING", label: "Net Banking" },
    { value: "MOBILE_APP", label: "Mobile App" },
    { value: "CREDIT_CARD", label: "Credit Card" },
];

// One shared formatter: building an Intl.NumberFormat is expensive, and
// this runs once per row. Same options -> identical output.
const AMOUNT_FORMATTER = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
});

// INR amount with an explicit sign: income gets a leading "+" (via
// signedTransactionAmount + signDisplay), everything else unchanged.
export function formatAmount(amount: number): string {
    return AMOUNT_FORMATTER.format(Number(amount ?? 0));
}

// A running balance as printed (negative = overdrawn), no forced "+".
const BALANCE_FORMATTER = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

export function formatBalance(value: number): string {
    return BALANCE_FORMATTER.format(value);
}

const DIFFERENCE_FORMATTER = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
});

// The short, user-facing headline for a balance mismatch. Exact meaning
// of every figure: see BalanceMismatch in @financeos/import-engine.
export function balanceMismatchHeadline(
    review: BalanceRowReview
): string {
    const mismatch = review.current ?? review.detected;

    if (mismatch.kind === "direction") {
        const moved =
            mismatch.statementMovement < 0 ? "went down" : "went up";
        const shown =
            mismatch.type === "income" ? "Income" : "Expense";

        return `Direction does not match the statement: the balance ${moved}, but this row is ${shown}.`;
    }

    return `Amount does not match the statement: the balance moved by ${formatBalance(
        Math.abs(mismatch.statementMovement)
    )}, but this row's amount is ${formatBalance(mismatch.amount)}.`;
}

export interface ImportPreviewRowProps {
    candidate: NormalizedTransactionCandidate;
    /** Sequential display position (1, 2, 3, ...). */
    displayNumber: number;
    hasErrors: boolean;
    isDuplicate: boolean;
    /**
     * The row's category is a Transfer category (or its type is
     * "transfer"): it will be imported as a Transfer - neither income nor
     * expense - keeping its Debit/Credit side as the transfer's direction.
     */
    isTransfer: boolean;
    indicatorState: "green" | "blue" | "blank";
    indicatorClickable: boolean;
    hasMatchedLearnedRule: boolean;
    importing: boolean;
    /** The row's Credit/Debit direction's options (memoized per direction). */
    directionCategoryOptions: readonly ImportCategoryOption[];
    categories: readonly Category[];
    categoriesLoading: boolean;
    onToggleSelfLearning: (rowNumber: number) => void;
    onPayeeCommit: (rowNumber: number, value: string) => void;
    onTransactionTypeChange: (
        rowNumber: number,
        value: TransactionChannel | ""
    ) => void;
    onCategoryChange: (rowNumber: number, value: string) => void;
    onNotesCommit: (rowNumber: number, value: string) => void;
    onViewDescription: (description: string) => void;
    /**
     * PDF running-balance review - present ONLY for a row flagged as a
     * balance mismatch (undefined for every normal row, which therefore
     * renders exactly as before). See importBalanceReview.ts.
     */
    balanceReview?: BalanceRowReview;
    onBalanceDirectionChange?: (
        rowNumber: number,
        direction: "income" | "expense"
    ) => void;
    onBalanceAmountCommit?: (rowNumber: number, amount: number) => void;
    onBalanceSkipToggle?: (rowNumber: number) => void;
    /**
     * Keyword of the Custom Import Rule applied to this row, if any -
     * shows the Custom Rule icon beside the Payee.
     */
    customRuleKeyword?: string;
    /**
     * Why a matching Custom Import Rule's category was not applied to this
     * row (its category is locked to the other direction) - shown under
     * the Category select so the user picks one.
     */
    customRuleCategoryNotice?: string;
}

function ImportPreviewRowComponent({
    candidate,
    displayNumber,
    hasErrors,
    isDuplicate,
    isTransfer,
    indicatorState,
    indicatorClickable,
    hasMatchedLearnedRule,
    importing,
    directionCategoryOptions,
    categories,
    categoriesLoading,
    onToggleSelfLearning,
    onPayeeCommit,
    onTransactionTypeChange,
    onCategoryChange,
    onNotesCommit,
    onViewDescription,
    balanceReview,
    onBalanceDirectionChange,
    onBalanceAmountCommit,
    onBalanceSkipToggle,
    customRuleKeyword,
    customRuleCategoryNotice,
}: ImportPreviewRowProps) {
    // Live text while typing; null = show the committed value.
    const [payeeDraft, setPayeeDraft] = useState<string | null>(null);
    const [notesDraft, setNotesDraft] = useState<string | null>(null);
    const [amountDraft, setAmountDraft] = useState<string | null>(null);

    const skipped = balanceReview?.status === "skipped";

    const categoryOptions = useMemo(
        () =>
            withRowCategory(
                directionCategoryOptions,
                candidate.categoryId,
                categories,
                categoriesLoading
            ),
        [
            directionCategoryOptions,
            candidate.categoryId,
            categories,
            categoriesLoading,
        ]
    );

    const amountColorClass =
        candidate.amount == null || isTransfer
            ? "text-slate-800"
            : candidate.type === "income"
                ? "text-emerald-600"
                : candidate.type === "expense"
                    ? "text-red-600"
                    : "text-slate-800";

    const mainRow = (
        <tr
            className={
                skipped
                    ? "bg-slate-50 text-slate-400 opacity-60"
                    : hasErrors
                        ? "bg-red-50/50"
                        : isDuplicate
                            ? "bg-amber-50/50"
                            : "hover:bg-slate-50"
            }
        >
            <td className="px-2 py-4 text-center">
                <button
                    type="button"
                    onClick={() =>
                        indicatorClickable &&
                        onToggleSelfLearning(candidate.rowNumber)
                    }
                    disabled={importing || !indicatorClickable}
                    aria-pressed={
                        indicatorClickable
                            ? indicatorState !== "blank"
                            : undefined
                    }
                    aria-label={
                        !indicatorClickable
                            ? "No learned rule for this transaction"
                            : indicatorState === "blank"
                                ? "Learning disabled for this transaction on this import"
                                : hasMatchedLearnedRule
                                    ? customRuleKeyword
                                        ? "Custom import rule applied to this transaction"
                                        : "Existing learned rule applied to this transaction"
                                    : "New rule learned from your edits this import"
                    }
                    title={
                        !indicatorClickable
                            ? "No learned rule for this transaction"
                            : indicatorState === "blank"
                                ? "Learning disabled for this transaction on this import — click to re-enable"
                                : hasMatchedLearnedRule
                                    ? customRuleKeyword
                                        ? "Custom import rule applied to this transaction — click to disable for this import"
                                        : "Existing learned rule applied to this transaction — click to disable for this import"
                                    : "New rule learned from your edits this import — will be saved when you import. Click to disable."
                    }
                    className="inline-flex items-center justify-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {indicatorState === "green" ? (
                        <CheckCircle2
                            size={16}
                            className="text-emerald-600"
                        />
                    ) : indicatorState === "blue" ? (
                        <CheckCircle2
                            size={16}
                            className="text-blue-600"
                        />
                    ) : (
                        <span className="block h-4 w-4" />
                    )}
                </button>
            </td>

            <td className="px-4 py-4 text-sm font-medium text-slate-700">
                {
                    // Sequential display position (1, 2, 3, ...) in the
                    // preview - independent of candidate.rowNumber, which
                    // stays the original CSV physical row and continues to
                    // back errors, overrides, and duplicate/import tracking.
                    displayNumber
                }
            </td>

            <td className="px-4 py-4 text-sm text-slate-600">
                {candidate.transactionDate ?? "—"}
            </td>

            <td className="px-4 py-4 text-sm">
                {/* Payee input, then (when a custom rule applied) its icon as
                    the next sibling - outside the input, one small gap after
                    it. The input shrinks (min-w-0 flex-1) so the icon never
                    overlaps it, however narrow the cell. */}
                <div
                    data-testid="payee-field"
                    className="flex w-full max-w-[240px] items-center gap-1"
                >
                    <input
                        type="text"
                        value={payeeDraft ?? candidate.payee ?? ""}
                        onChange={event => setPayeeDraft(event.target.value)}
                        onBlur={event => {
                            onPayeeCommit(
                                candidate.rowNumber,
                                event.target.value
                            );
                            setPayeeDraft(null);
                        }}
                        placeholder="—"
                        disabled={importing}
                        title={candidate.payee || undefined}
                        className="block min-w-0 max-w-[220px] flex-1 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-slate-800 outline-none transition hover:border-slate-200 focus:border-slate-400 focus:bg-white disabled:bg-slate-50"
                    />
                    {customRuleKeyword && (
                        <span
                            role="img"
                            data-testid="custom-rule-icon"
                            aria-label="Custom import rule applied to this transaction"
                            title="Custom import rule applied to this transaction"
                            className="inline-flex shrink-0 items-center text-violet-600"
                        >
                            <Wand2 size={14} aria-hidden="true" />
                        </span>
                    )}
                </div>

                {candidate.description && (
                    <button
                        type="button"
                        onClick={() =>
                            candidate.description &&
                            onViewDescription(candidate.description)
                        }
                        className="mt-0.5 block max-w-[220px] truncate px-1.5 text-left text-[11px] text-slate-400 underline-offset-2 hover:underline"
                        title="Click to view full text"
                    >
                        {candidate.description}
                    </button>
                )}
            </td>

            <td className="px-4 py-4 text-sm">
                <select
                    value={candidate.transactionType ?? ""}
                    onChange={event =>
                        onTransactionTypeChange(
                            candidate.rowNumber,
                            event.target.value as TransactionChannel | ""
                        )
                    }
                    disabled={importing}
                    className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-slate-400 disabled:bg-slate-50"
                >
                    {TRANSACTION_CHANNEL_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </td>

            <td
                className={`px-4 py-4 text-right text-sm font-semibold ${amountColorClass}`}
            >
                {candidate.amount == null
                    ? "—"
                    : formatAmount(
                          signedTransactionAmount(
                              candidate.amount,
                              candidate.type
                          )
                      )}

                {balanceReview && !skipped && (
                    <div className="mt-1.5 flex items-center justify-end gap-1.5">
                        <select
                            value={candidate.type ?? ""}
                            onChange={event =>
                                onBalanceDirectionChange?.(
                                    candidate.rowNumber,
                                    event.target.value as
                                        | "income"
                                        | "expense"
                                )
                            }
                            disabled={importing}
                            aria-label="Income or Expense"
                            className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs font-medium text-slate-700 outline-none focus:border-slate-400 disabled:bg-slate-50"
                        >
                            <option value="income">Income</option>
                            <option value="expense">Expense</option>
                        </select>

                        <input
                            type="text"
                            inputMode="decimal"
                            value={
                                amountDraft ??
                                (candidate.amount ?? 0).toFixed(2)
                            }
                            onChange={event =>
                                setAmountDraft(event.target.value)
                            }
                            onBlur={event => {
                                const corrected = parseCorrectedAmount(
                                    event.target.value
                                );

                                if (corrected !== null) {
                                    onBalanceAmountCommit?.(
                                        candidate.rowNumber,
                                        corrected
                                    );
                                }

                                // An invalid entry is discarded, never
                                // coerced - the committed amount stays.
                                setAmountDraft(null);
                            }}
                            onKeyDown={event => {
                                if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                }
                            }}
                            disabled={importing}
                            aria-label="Corrected amount"
                            className="h-7 w-24 rounded-md border border-slate-200 bg-white px-1.5 text-right text-xs font-medium text-slate-700 outline-none focus:border-slate-400 disabled:bg-slate-50"
                        />
                    </div>
                )}

                {isTransfer && (
                    <div
                        className="mt-0.5 text-[11px] font-medium text-slate-500"
                        title="Imported as a Transfer: neither income nor expense. It still moves this account's balance in this direction."
                    >
                        Transfer
                        {candidate.type === "income"
                            ? " · In"
                            : candidate.type === "expense"
                                ? " · Out"
                                : ""}
                    </div>
                )}
            </td>

            <td className="px-4 py-4 text-sm">
                <select
                    value={
                        candidate.categoryId ?? UNCATEGORIZED_OPTION_VALUE
                    }
                    onChange={event =>
                        onCategoryChange(
                            candidate.rowNumber,
                            event.target.value
                        )
                    }
                    disabled={importing}
                    aria-label="Category"
                    className="h-8 w-40 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-slate-400 disabled:bg-slate-50"
                >
                    <option value={UNCATEGORIZED_OPTION_VALUE}>
                        {UNCATEGORIZED_OPTION_LABEL}
                    </option>

                    {categoryOptions.map(option => (
                        <option key={option.id} value={option.id}>
                            {option.name}
                        </option>
                    ))}
                </select>

                {customRuleCategoryNotice && (
                    <p
                        role="note"
                        data-testid="custom-rule-category-notice"
                        className="mt-1 w-40 text-[11px] leading-snug text-amber-700"
                    >
                        {customRuleCategoryNotice}
                    </p>
                )}
            </td>

            <td className="px-4 py-4 text-sm">
                <input
                    type="text"
                    value={notesDraft ?? candidate.notes ?? ""}
                    onChange={event => setNotesDraft(event.target.value)}
                    onBlur={event => {
                        onNotesCommit(
                            candidate.rowNumber,
                            event.target.value
                        );
                        setNotesDraft(null);
                    }}
                    placeholder="—"
                    disabled={importing}
                    className="h-8 w-36 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none transition focus:border-slate-400 disabled:bg-slate-50"
                />
            </td>
        </tr>
    );

    if (!balanceReview) {
        return mainRow;
    }

    return (
        <Fragment>
            {mainRow}
            <BalanceReviewLine
                review={balanceReview}
                rowNumber={candidate.rowNumber}
                importing={importing}
                onSkipToggle={onBalanceSkipToggle}
            />
        </Fragment>
    );
}

// The explanation line under a flagged row: what is wrong, the exact
// figures, and the one-click Skip / Include action.
function BalanceReviewLine({
    review,
    rowNumber,
    importing,
    onSkipToggle,
}: {
    review: BalanceRowReview;
    rowNumber: number;
    importing: boolean;
    onSkipToggle?: (rowNumber: number) => void;
}) {
    const mismatch = review.current ?? review.detected;

    const tone =
        review.status === "mismatch"
            ? "border-red-200 bg-red-50 text-red-800"
            : review.status === "corrected"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-slate-200 bg-slate-50 text-slate-600";

    const headline =
        review.status === "corrected"
            ? `Corrected - this row now matches the statement balance of ${formatBalance(
                  mismatch.statementBalance
              )}.`
            : review.status === "skipped"
                ? "Skipped - this row will not be imported."
                : balanceMismatchHeadline(review);

    const figures: Array<[string, string]> = [
        ["Previous balance", formatBalance(mismatch.previousBalance)],
        [
            mismatch.type === "income" ? "+ Income" : "- Expense",
            formatBalance(mismatch.amount),
        ],
        ["Expected balance", formatBalance(mismatch.expectedBalance)],
        ["Statement balance", formatBalance(mismatch.statementBalance)],
        ["Difference", DIFFERENCE_FORMATTER.format(mismatch.difference)],
    ];

    return (
        <tr data-balance-review={review.status}>
            <td colSpan={8} className="px-4 pb-3 pt-0">
                <div
                    role={review.status === "mismatch" ? "alert" : "status"}
                    className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border px-3 py-2 text-xs ${tone}`}
                >
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                        {review.status === "corrected" ? (
                            <CheckCircle2 size={14} />
                        ) : (
                            <AlertTriangle size={14} />
                        )}
                        {headline}
                    </span>

                    {review.status === "mismatch" &&
                        figures.map(([label, value]) => (
                            <span key={label} className="whitespace-nowrap">
                                {label}{" "}
                                <span className="font-semibold tabular-nums">
                                    {value}
                                </span>
                            </span>
                        ))}

                    {review.status !== "corrected" && (
                        <button
                            type="button"
                            onClick={() => onSkipToggle?.(rowNumber)}
                            disabled={importing}
                            className="ml-auto rounded-md border border-current px-2 py-0.5 font-semibold transition hover:bg-white/60 disabled:opacity-50"
                        >
                            {review.status === "skipped"
                                ? "Include row"
                                : "Skip row"}
                        </button>
                    )}
                </div>
            </td>
        </tr>
    );
}

export const ImportPreviewRow = memo(ImportPreviewRowComponent);
