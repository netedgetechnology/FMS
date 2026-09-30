import {
    existsSync,
    readdirSync,
    readFileSync,
} from "node:fs";
import { join } from "node:path";

import { PDFParse } from "pdf-parse";
import { describe, expect, it } from "vitest";

import { processPdfText } from "../../pipeline";

// Opt-in check of REAL statement PDFs that must never be committed
// (personal financial data). Point FINWEA_PDF_CORPUS at a local folder:
//
//   FINWEA_PDF_CORPUS="C:/statements" npx vitest run realPdfCorpus
//
// Each <name>.pdf there is extracted with the same pdf-parse library the
// app uses and run through the production pipeline. It passes when every
// row validates and every row carrying a running balance reconciles with
// the previous one. An optional <name>.expected.json beside it can pin
// { "rows": n, "income": total, "expense": total } from the statement's
// own summary. Skipped entirely when the variable is unset.

const corpusDir =
    process.env.FINWEA_PDF_CORPUS ?? "";

const pdfFiles =
    corpusDir && existsSync(corpusDir)
        ? readdirSync(corpusDir)
              .filter((name) =>
                  name.toLowerCase().endsWith(".pdf"),
              )
              .sort()
        : [];

interface CorpusExpectation {
    rows?: number;
    income?: number;
    expense?: number;
}

async function extractText(
    path: string,
): Promise<string> {
    const parser = new PDFParse({
        data: new Uint8Array(readFileSync(path)),
    });

    try {
        return (await parser.getText()).text;
    } finally {
        await parser.destroy();
    }
}

function sum(values: number[]): number {
    return (
        Math.round(
            values.reduce(
                (total, value) =>
                    total + Math.round(value * 100),
                0,
            ),
        ) / 100
    );
}

describe.skipIf(pdfFiles.length === 0)(
    "real PDF statement corpus (FINWEA_PDF_CORPUS)",
    () => {
        it.each(pdfFiles)(
            "%s",
            async (name) => {
                const text = await extractText(
                    join(corpusDir, name),
                );

                const result = processPdfText(
                    text,
                    "BANK_PDF",
                );

                expect(
                    result.candidates.length,
                ).toBeGreaterThan(0);

                expect(
                    result.validation.errors,
                ).toEqual([]);

                expect(
                    result.balanceReconciliation
                        .mismatchedRowNumbers,
                ).toEqual([]);

                const expectationPath = join(
                    corpusDir,
                    name.replace(
                        /\.pdf$/i,
                        ".expected.json",
                    ),
                );

                if (existsSync(expectationPath)) {
                    const expected = JSON.parse(
                        readFileSync(
                            expectationPath,
                            "utf8",
                        ),
                    ) as CorpusExpectation;

                    const amountsOf = (
                        type: "income" | "expense",
                    ) =>
                        result.candidates
                            .filter(
                                (candidate) =>
                                    candidate.type ===
                                    type,
                            )
                            .map(
                                (candidate) =>
                                    candidate.amount ?? 0,
                            );

                    if (expected.rows !== undefined) {
                        expect(
                            result.candidates,
                        ).toHaveLength(expected.rows);
                    }

                    if (
                        expected.income !== undefined
                    ) {
                        expect(
                            sum(amountsOf("income")),
                        ).toBe(expected.income);
                    }

                    if (
                        expected.expense !== undefined
                    ) {
                        expect(
                            sum(amountsOf("expense")),
                        ).toBe(expected.expense);
                    }
                }
            },
            60_000,
        );
    },
);
