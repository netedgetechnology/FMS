import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import {
    processPdfText,
    type NormalizedTransactionCandidate,
} from "@financeos/import-engine";

import {
    applyPreviewOverrides,
    createEmptyPreviewOverrides,
    resolveImportBlockingError,
    reuseUnchangedCandidates,
    type PreviewOverrides,
} from "./ImportsPage";
import {
    EMPTY_BALANCE_REVIEW,
    applyBalanceAmount,
    applyBalanceDirection,
    combinePreviewErrors,
    countReadyRows,
    detectBalanceMismatches,
    parseCorrectedAmount,
    reviewBalanceCorrections,
    toggleBalanceSkip,
    type BalanceReview,
} from "./importBalanceReview";
import {
    ImportPreviewRow,
    balanceMismatchHeadline,
    type ImportPreviewRowProps,
} from "./ImportPreviewRow";

// ---------------------------------------------------------------------
// PDF running-balance mismatches in the Import Preview.
//
// Runs the page's real derivation in the order ImportsPage uses it:
//   detectBalanceMismatches(previewed rows)
//   -> applyPreviewOverrides(previewed rows, overrides)
//   -> reviewBalanceCorrections(detected, corrected rows, skipped)
//   -> combinePreviewErrors / countReadyRows / resolveImportBlockingError
// ---------------------------------------------------------------------

function row(
    rowNumber: number,
    type: NormalizedTransactionCandidate["type"],
    amount: number | null,
    balance: number | null,
    date = `2026-01-${String(rowNumber).padStart(2, "0")}`
): NormalizedTransactionCandidate {
    return {
        rowNumber,
        transactionDate: date,
        payee: `Payee ${rowNumber}`,
        description: `Payee ${rowNumber}`,
        amount,
        type,
        referenceNumber: null,
        externalTransactionId: null,
        transactionType: null,
        balance,
        branch: null,
        counterparty: null,
        notes: null,
        rawData: {},
    };
}

// What the page derives for a given preview + overrides.
function derive(
    previewed: NormalizedTransactionCandidate[],
    overrides: PreviewOverrides = createEmptyPreviewOverrides(),
    validationErrors: { rowNumber: number; field?: string; message: string }[] = [],
    previous: BalanceReview | null = null
) {
    const detected = detectBalanceMismatches(previewed);
    const candidates = applyPreviewOverrides(previewed, overrides);
    const review = reviewBalanceCorrections(
        detected,
        candidates,
        overrides.skipped,
        previous
    );
    const errors = combinePreviewErrors(
        validationErrors,
        overrides.skipped,
        review.errors
    );
    const errorRowNumbers = new Set(errors.map(error => error.rowNumber));
    const readyRows = countReadyRows(
        candidates,
        errorRowNumbers,
        new Map(),
        overrides.skipped
    );

    return {
        candidates,
        review,
        errors,
        readyRows,
        blocking: resolveImportBlockingError({
            hasAccount: true,
            hasFile: true,
            hasPreview: true,
            errorRows: errorRowNumbers.size,
            readyRows,
            balanceMismatchRows: review.unresolvedRowNumbers.size,
        }),
    };
}

describe("matching running balance", () => {
    it("shows nothing, changes nothing and does not block", () => {
        const previewed = [
            row(1, "income", 100, 100),
            row(2, "expense", 40, 60),
            row(3, "income", 15.5, 75.5),
        ];

        const result = derive(previewed);

        expect(result.review).toBe(EMPTY_BALANCE_REVIEW);
        expect(result.errors).toEqual([]);
        expect(result.readyRows).toBe(3);
        expect(result.blocking).toBeNull();
        // Normal rows are passed through untouched (same objects).
        result.candidates.forEach((candidate, index) =>
            expect(candidate).toBe(previewed[index])
        );
    });
});

describe("amount mismatch", () => {
    const previewed = [
        row(1, "income", 100, 100),
        // Balance fell by 40, but the row says 4.
        row(2, "expense", 4, 60),
        row(3, "income", 10, 70),
    ];

    it("flags the row with the figures, blocks the import, and changes nothing", () => {
        const result = derive(previewed);
        const review = result.review.rows.get(2)!;

        expect(review.status).toBe("mismatch");
        expect(review.current).toMatchObject({
            previousBalance: 100,
            expectedBalance: 96,
            statementBalance: 60,
            difference: -36,
            statementMovement: -40,
            kind: "amount",
        });
        expect(result.errors).toEqual([
            {
                rowNumber: 2,
                field: "balance",
                message:
                    "Balance mismatch: previous balance 100.00 - Expense 4.00 = expected 96.00, but the statement shows 60.00 (difference -36.00). The balance moved by 40.00, not by this row's amount - check the amount, or skip the row.",
            },
        ]);
        expect(result.readyRows).toBe(2);
        expect(result.blocking).toBe(
            "1 row does not match the statement's running balance. Correct the amount or Income/Expense of each highlighted row, or skip it, before importing."
        );
        // Not silently corrected.
        expect(result.candidates[1]).toBe(previewed[1]);
        expect(result.candidates[1]!.amount).toBe(4);
    });

    it("a correct amount resolves it; a wrong correction keeps it blocked", () => {
        const wrong = derive(
            previewed,
            applyBalanceAmount(
                createEmptyPreviewOverrides(),
                previewed,
                2,
                41
            )
        );

        expect(wrong.review.rows.get(2)!.status).toBe("mismatch");
        expect(wrong.blocking).not.toBeNull();

        const fixed = derive(
            previewed,
            applyBalanceAmount(
                createEmptyPreviewOverrides(),
                previewed,
                2,
                40
            )
        );

        expect(fixed.review.rows.get(2)!.status).toBe("corrected");
        expect(fixed.review.rows.get(2)!.current).toBeNull();
        expect(fixed.errors).toEqual([]);
        expect(fixed.readyRows).toBe(3);
        expect(fixed.blocking).toBeNull();
        expect(fixed.candidates[1]).toMatchObject({
            amount: 40,
            type: "expense",
        });
    });
});

describe("direction mismatch", () => {
    const previewed = [
        row(1, "income", 100, 100),
        // Balance fell by 40, but the row says Income.
        row(2, "income", 40, 60),
    ];

    it("explains the direction problem without guessing the fix", () => {
        const result = derive(previewed);
        const review = result.review.rows.get(2)!;

        expect(review.current!.kind).toBe("direction");
        expect(balanceMismatchHeadline(review)).toBe(
            "Direction does not match the statement: the balance went down, but this row is Income."
        );
        // Still Income until the user changes it.
        expect(result.candidates[1]!.type).toBe("income");
        expect(result.blocking).not.toBeNull();
    });

    it("choosing Expense resolves it; choosing Income again removes the correction", () => {
        const corrected = applyBalanceDirection(
            createEmptyPreviewOverrides(),
            previewed,
            2,
            "expense"
        );

        const fixed = derive(previewed, corrected);

        expect(fixed.review.rows.get(2)!.status).toBe("corrected");
        expect(fixed.candidates[1]!.type).toBe("expense");
        expect(fixed.blocking).toBeNull();

        const reverted = applyBalanceDirection(
            corrected,
            previewed,
            2,
            "income"
        );

        expect(reverted.direction.size).toBe(0);
        expect(
            derive(previewed, reverted).review.rows.get(2)!.status
        ).toBe("mismatch");
    });
});

describe("multiple mismatches", () => {
    const previewed = [
        row(1, "income", 1000, 1000),
        row(2, "income", 200, 800), // direction
        row(3, "expense", 50, 750), // fine
        row(4, "expense", 10, 700), // amount (moved by 50)
        row(5, "income", 300, 1000), // fine
    ];

    it("reports each row independently", () => {
        const result = derive(previewed);

        expect([...result.review.unresolvedRowNumbers]).toEqual([2, 4]);
        expect(result.errors.map(error => error.rowNumber)).toEqual([
            2, 4,
        ]);
        expect(result.readyRows).toBe(3);
        expect(result.blocking).toBe(
            "2 rows do not match the statement's running balance. Correct the amount or Income/Expense of each highlighted row, or skip it, before importing."
        );
    });

    it("resolving one (correct) and one (skip) unblocks - and a skipped row never breaks its neighbour's check", () => {
        let overrides = applyBalanceDirection(
            createEmptyPreviewOverrides(),
            previewed,
            2,
            "expense"
        );
        overrides = toggleBalanceSkip(overrides, 4);

        const result = derive(previewed, overrides);

        expect(result.review.counts).toEqual({
            mismatch: 0,
            corrected: 1,
            skipped: 1,
        });
        // Row 5 is still checked against row 4's printed balance.
        expect(result.review.rows.has(5)).toBe(false);
        expect(result.errors).toEqual([]);
        expect(result.readyRows).toBe(4);
        expect(result.blocking).toBeNull();
    });

    it("a skipped row's other validation errors no longer block either", () => {
        const overrides = toggleBalanceSkip(
            toggleBalanceSkip(createEmptyPreviewOverrides(), 2),
            4
        );

        const result = derive(previewed, overrides, [
            { rowNumber: 4, field: "payee", message: "Payee required." },
        ]);

        expect(result.errors).toEqual([]);
        expect(result.blocking).toBeNull();

        // Include it again: blocked again.
        const included = derive(
            previewed,
            toggleBalanceSkip(overrides, 4)
        );
        expect(included.review.rows.get(4)!.status).toBe("mismatch");
        expect(included.blocking).not.toBeNull();
    });

    it("keeps each unchanged row's review object (memoized rows don't re-render)", () => {
        const first = derive(previewed);
        const again = derive(
            previewed,
            createEmptyPreviewOverrides(),
            [],
            first.review
        );

        expect(again.review.rows.get(2)).toBe(first.review.rows.get(2));
        expect(again.review.rows.get(4)).toBe(first.review.rows.get(4));

        const oneFixed = derive(
            previewed,
            applyBalanceDirection(
                createEmptyPreviewOverrides(),
                previewed,
                2,
                "expense"
            ),
            [],
            first.review
        );

        expect(oneFixed.review.rows.get(2)).not.toBe(
            first.review.rows.get(2)
        );
        expect(oneFixed.review.rows.get(4)).toBe(
            first.review.rows.get(4)
        );
    });
});

describe("B/F (brought forward) rows", () => {
    it("are an opening balance, not a transaction - no mismatch, nothing to skip", () => {
        const T = " \t";
        const result = processPdfText(
            [
                ["TXN DATE", "VALUE DATE", "DESCRIPTION", "REFERENCE", "DEBITS", "CREDITS", "BALANCE"].join(T),
                ["01-APR-2025", "01-APR-2025", "B/F ...", "50,000.00", "0.00", "-50,000.00"].join(T),
                ["02-APR-2025", "02-APR-2025", "SUPPLIER PAYMENT", "111600000001", "1,000.00", "0.00", "-51,000.00"].join(T),
                ["05-APR-2025", "05-APR-2025", "CHEQUE DEPOSIT", "000000400001", "0.00", "20,000.00", "-31,000.00"].join(T),
            ].join("\n"),
            "BANK_PDF"
        );

        expect(
            result.candidates.map(candidate => candidate.description)
        ).toEqual(["SUPPLIER PAYMENT", "CHEQUE DEPOSIT"]);
        expect(detectBalanceMismatches(result.candidates).size).toBe(0);
        expect(result.validation.errors).toEqual([]);
    });
});

describe("ambiguous unsigned amount", () => {
    it("is never guessed and never reported as a balance mismatch - it keeps its own type error", () => {
        const previewed = [
            row(1, "income", 100, 100),
            row(2, null, 40, 60),
            row(3, "expense", 10, 50),
        ];

        const result = derive(previewed, createEmptyPreviewOverrides(), [
            {
                rowNumber: 2,
                field: "type",
                message: "Transaction type could not be determined.",
            },
        ]);

        expect(result.review).toBe(EMPTY_BALANCE_REVIEW);
        expect(result.candidates[1]!.type).toBeNull();
        expect(result.errors).toEqual([
            {
                rowNumber: 2,
                field: "type",
                message: "Transaction type could not be determined.",
            },
        ]);
        // A non-balance error keeps the generic message.
        expect(result.blocking).toBe(
            "The statement contains validation errors. Correct the file before importing."
        );
    });
});

describe("normal PDF import with zero mismatches", () => {
    it("end to end from statement text: no review, no extra errors, all rows ready", () => {
        const result = processPdfText(
            [
                "Date Value Date Cheque No/Reference No Description Withdrawals Deposits Running Balance",
                "15 Feb 2026 15 Feb 2026 YES0N6046000000007 NEFT Cr-ACME CLIENT LTD",
                "12,345.67 12,345.67",
                "12 Feb 2026 12 Feb 2026 YBS6005000000003 UPI/merchant@bank",
                "2,499.50 0.00",
                "10 Feb 2026 10 Feb 2026 YBS6005000000002 UPI/shop@bank",
                "3,000.00 2,499.50",
                "Opening Balance: 5,499.50",
            ].join("\n"),
            "BANK_PDF"
        );

        expect(result.candidates).toHaveLength(3);

        const derived = derive(
            result.candidates,
            createEmptyPreviewOverrides(),
            result.validation.errors
        );

        expect(derived.review).toBe(EMPTY_BALANCE_REVIEW);
        expect(derived.errors).toEqual([]);
        expect(derived.readyRows).toBe(3);
        expect(derived.blocking).toBeNull();
    });
});

describe("parseCorrectedAmount", () => {
    it.each([
        ["40", 40],
        ["1,234.50", 1234.5],
        ["₹ 99.999", 100],
    ])("accepts %s", (raw, expected) => {
        expect(parseCorrectedAmount(raw)).toBe(expected);
    });

    it.each(["", "0", "-5", "abc", "1.2.3", "0.001"])(
        "rejects %s rather than coercing it",
        raw => {
            expect(parseCorrectedAmount(raw)).toBeNull();
        }
    );
});

describe("Import Preview row rendering", () => {
    function props(
        candidate: NormalizedTransactionCandidate,
        extra: Partial<ImportPreviewRowProps> = {}
    ): ImportPreviewRowProps {
        const noop = () => {};

        return {
            candidate,
            displayNumber: 1,
            hasErrors: false,
            isDuplicate: false,
            isTransfer: false,
            indicatorState: "blank",
            indicatorClickable: false,
            hasMatchedLearnedRule: false,
            importing: false,
            directionCategoryOptions: [],
            categories: [],
            categoriesLoading: false,
            onToggleSelfLearning: noop,
            onPayeeCommit: noop,
            onTransactionTypeChange: noop,
            onCategoryChange: noop,
            onNotesCommit: noop,
            onViewDescription: noop,
            ...extra,
        };
    }

    const render = (p: ImportPreviewRowProps) =>
        renderToStaticMarkup(
            createElement(
                "table",
                null,
                createElement(
                    "tbody",
                    null,
                    createElement(ImportPreviewRow, p)
                )
            )
        );

    const previewed = [row(1, "income", 100, 100), row(2, "expense", 4, 60)];
    const review = derive(previewed).review.rows.get(2)!;

    it("a normal row renders exactly one row with no correction controls", () => {
        const html = render(props(previewed[0]!));

        expect(html.match(/<tr/g)).toHaveLength(1);
        expect(html).not.toContain("data-balance-review");
        expect(html).not.toContain("Corrected amount");
    });

    it("a mismatched row shows the warning, every figure, the correction controls and Skip", () => {
        const html = render(
            props(previewed[1]!, { hasErrors: true, balanceReview: review })
        );

        expect(html).toContain('data-balance-review="mismatch"');
        expect(html).toContain("role=\"alert\"");
        expect(html).toContain(
            "Amount does not match the statement"
        );
        for (const label of [
            "Previous balance",
            "Expected balance",
            "Statement balance",
            "Difference",
        ]) {
            expect(html).toContain(label);
        }
        expect(html).toContain("₹96.00");
        expect(html).toContain("₹60.00");
        expect(html).toContain("-₹36.00");
        expect(html).toContain('aria-label="Income or Expense"');
        expect(html).toContain('aria-label="Corrected amount"');
        expect(html).toContain("Skip row");
    });

    it("a skipped row says it will not be imported and offers Include", () => {
        const skipped = derive(
            previewed,
            toggleBalanceSkip(createEmptyPreviewOverrides(), 2)
        ).review.rows.get(2)!;

        const html = render(
            props(previewed[1]!, { balanceReview: skipped })
        );

        expect(html).toContain("Skipped - this row will not be imported.");
        expect(html).toContain("Include row");
        expect(html).not.toContain('aria-label="Corrected amount"');
    });
});

describe("performance at scale", () => {
    it("reviews 5,000 rows with a few mismatches quickly, and a normal-row edit keeps review objects", () => {
        const previewed: NormalizedTransactionCandidate[] = [];
        let balance = 0;

        for (let i = 1; i <= 5000; i += 1) {
            const income = i % 3 === 0;
            const amount = income ? 250 : 40;
            balance += income ? amount : -amount;
            previewed.push(
                row(
                    i,
                    // Every 1,000th row has the wrong direction.
                    i % 1000 === 0 ? (income ? "expense" : "income") : income ? "income" : "expense",
                    amount,
                    balance,
                    "2026-01-01"
                )
            );
        }

        const started = performance.now();
        const first = derive(previewed);
        const elapsed = performance.now() - started;

        expect([...first.review.unresolvedRowNumbers]).toEqual([
            1000, 2000, 3000, 4000, 5000,
        ]);
        expect(elapsed).toBeLessThan(500);

        // An unrelated edit (a Payee override on a normal row) keeps every
        // flagged row's review object, and every other candidate object.
        const payeeEdit: PreviewOverrides = {
            ...createEmptyPreviewOverrides(),
            payee: new Map([[7, "Renamed"]]),
        };
        const candidates = reuseUnchangedCandidates(
            applyPreviewOverrides(previewed, payeeEdit),
            first.candidates
        );
        const after = reviewBalanceCorrections(
            detectBalanceMismatches(previewed),
            candidates,
            payeeEdit.skipped,
            first.review
        );

        for (const rowNumber of first.review.rows.keys()) {
            expect(after.rows.get(rowNumber)).toBe(
                first.review.rows.get(rowNumber)
            );
        }
    });
});
