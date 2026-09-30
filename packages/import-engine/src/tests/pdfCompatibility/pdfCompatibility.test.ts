import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { CsvImportType } from "../../normalizer/csvNormalizer";
import { processPdfText } from "../../pipeline";

// Data-driven PDF layout compatibility suite. Every
// fixtures/<id>.txt (statement text exactly as pdf-parse emits it) paired
// with fixtures/<id>.expected.json (hand-computed canonical rows) runs
// through the full production pipeline from extraction onward -
// structural parsing -> column mapping -> canonical normalization ->
// validation -> balance reconciliation. Adding a new layout never means
// touching this file or importer code; see README.md.

interface ExpectedRow {
    date: string;
    type: "income" | "expense" | "transfer" | null;
    amount: number;
    balance: number | null;
    reference?: string | null;
    description?: string;
}

interface CompatibilityCase {
    source: string;
    importType: CsvImportType;
    features: string[];
    expect: {
        validationErrors: number;
        balanceReconciliation: {
            checkedRows: number;
            mismatches: number;
        };
        rows: ExpectedRow[];
    };
}

const fixturesDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures",
);

const caseIds = readdirSync(fixturesDir)
    .filter((name) =>
        name.endsWith(".expected.json"),
    )
    .map((name) =>
        name.slice(0, -".expected.json".length),
    )
    .sort();

function loadCase(id: string): {
    text: string;
    spec: CompatibilityCase;
} {
    return {
        text: readFileSync(
            join(fixturesDir, `${id}.txt`),
            "utf8",
        ),
        spec: JSON.parse(
            readFileSync(
                join(
                    fixturesDir,
                    `${id}.expected.json`,
                ),
                "utf8",
            ),
        ) as CompatibilityCase,
    };
}

describe("PDF layout compatibility corpus", () => {
    it("has fixtures to run", () => {
        expect(caseIds.length).toBeGreaterThan(0);
    });

    describe.each(caseIds)("%s", (id) => {
        const { text, spec } = loadCase(id);

        const result = processPdfText(
            text,
            spec.importType,
        );

        it("is recognised as a structured statement", () => {
            expect(result.document.headers).toContain(
                "Balance",
            );
        });

        it("produces exactly the expected canonical rows", () => {
            expect(
                result.candidates.map((candidate) => ({
                    date: candidate.transactionDate,
                    type: candidate.type,
                    amount: candidate.amount,
                    balance: candidate.balance,
                })),
            ).toEqual(
                spec.expect.rows.map((row) => ({
                    date: row.date,
                    type: row.type,
                    amount: row.amount,
                    balance: row.balance,
                })),
            );
        });

        it("keeps every amount positive", () => {
            for (const candidate of result.candidates) {
                expect(candidate.amount).not.toBeNull();
                expect(
                    candidate.amount ?? 0,
                ).toBeGreaterThan(0);
            }
        });

        it("extracts the expected references and descriptions", () => {
            spec.expect.rows.forEach((row, index) => {
                const candidate =
                    result.candidates[index];

                if (row.reference !== undefined) {
                    expect(
                        candidate?.referenceNumber,
                    ).toBe(row.reference);
                }

                if (row.description !== undefined) {
                    expect(
                        candidate?.description,
                    ).toBe(row.description);
                }

                expect(
                    candidate?.payee,
                ).toBeTruthy();
            });
        });

        it("has the expected validation outcome", () => {
            expect(
                result.validation.errors,
            ).toHaveLength(
                spec.expect.validationErrors,
            );
        });

        it("reconciles against the statement's own running balance", () => {
            expect({
                checkedRows:
                    result.balanceReconciliation
                        .checkedRows,
                mismatches:
                    result.balanceReconciliation
                        .mismatchedRowNumbers.length,
            }).toEqual(
                spec.expect.balanceReconciliation,
            );
        });
    });
});
