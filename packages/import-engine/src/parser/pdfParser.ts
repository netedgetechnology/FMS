import { PDFParse } from "pdf-parse";
import type { CsvDocument } from "../types";

let workerConfigured = false;

function configurePdfWorker(): void {
    if (workerConfigured) {
        return;
    }

    PDFParse.setWorker(
        new URL(
            "/pdf.worker.mjs",
            window.location.origin,
        ).toString(),
    );

    workerConfigured = true;
}

type RawLine = {
    text: string;
};

type Transaction = {
    date: string;
    description: string;
    amount: string;
    type: string;
    reference: string;
    debit: string;
    credit: string;
    balance: string;
};

const DATE_PATTERNS = [
    /^\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4}$/,
    /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/,
    /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}$/,
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/,
];

const AMOUNT_RE =
    /^[-+]?(?:₹|\$|€|£)?\s*\d[\d,]*(?:\.\d{1,2})?$/;

const CR_DR_RE = /^(CR|DR)$/i;

function normalizeLines(text: string): RawLine[] {
    return text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\u00a0/g, " ")
        .split("\n")
        .map((text) => ({
            text: text.trim(),
        }))
        .filter((line) => line.text.length > 0);
}

function isDate(value: string): boolean {
    const cleaned = value
        .trim()
        .replace(/[.,]$/, "");

    return DATE_PATTERNS.some((pattern) =>
        pattern.test(cleaned),
    );
}

function isAmount(value: string): boolean {
    const cleaned = value
        .trim()
        .replace(/[()]/g, "")
        .replace(/,$/, "");

    return AMOUNT_RE.test(cleaned);
}

function cleanAmount(value: string): string {
    return value
        .replace(/[₹$€£]/g, "")
        .replace(/,/g, "")
        .replace(/[()]/g, "")
        .trim();
}

function tokenize(line: string): string[] {
    return line
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean);
}

function findDateIndex(tokens: string[]): number {
    for (let i = 0; i < tokens.length; i += 1) {
        if (isDate(tokens[i] ?? "")) {
            return i;
        }
    }

    return -1;
}

function findTransactionStarts(
    lines: RawLine[],
): number[] {
    const starts: number[] = [];

    for (let i = 0; i < lines.length; i += 1) {
        const tokens = tokenize(lines[i].text);
        const dateIndex = findDateIndex(tokens);

        if (dateIndex === 0) {
            starts.push(i);
            continue;
        }

        if (
            dateIndex === 1 &&
            /^\d+$/.test(tokens[0] ?? "")
        ) {
            starts.push(i);
        }
    }

    return starts;
}

function findFinancialTail(
    tokens: string[],
): {
    amountIndex: number;
    typeIndex: number;
    balanceIndex: number;
} | null {
    for (
        let i = tokens.length - 1;
        i >= 2;
        i -= 1
    ) {
        if (!isAmount(tokens[i] ?? "")) {
            continue;
        }

        if (
            CR_DR_RE.test(tokens[i - 1] ?? "")
        ) {
            const balanceIndex = i - 2;

            if (
                balanceIndex >= 0 &&
                isAmount(tokens[balanceIndex] ?? "")
            ) {
                return {
                    amountIndex: i,
                    typeIndex: i - 1,
                    balanceIndex,
                };
            }
        }
    }

    return null;
}

function extractReference(
    description: string,
): string {
    const patterns = [
        /\b(?:NEFT|RTGS|IMPS|UPI|ACH|ECS)\/[A-Za-z0-9./_-]+/i,
        /\b[A-Z]{2,}[/-]\d{6,}[A-Za-z0-9/-]*/i,
        /\b\d{10,}\b/,
    ];

    for (const pattern of patterns) {
        const match = description.match(pattern);

        if (match?.[0]) {
            return match[0];
        }
    }

    return "";
}

function parseTransaction(
    block: RawLine[],
): Transaction | null {
    const text = block
        .map((line) => line.text)
        .join(" ");

    const tokens = tokenize(text);

    const dateIndex = findDateIndex(tokens);

    if (dateIndex < 0) {
        return null;
    }

    const date = tokens[dateIndex] ?? "";

    const secondDate =
        isDate(tokens[dateIndex + 1] ?? "")
            ? tokens[dateIndex + 1]
            : "";

    const bodyStart =
        secondDate ? dateIndex + 2 : dateIndex + 1;

    const body = tokens.slice(bodyStart);

    const financial =
        findFinancialTail(body);

    if (!financial) {
        return null;
    }

    const amount =
        cleanAmount(
            body[financial.amountIndex] ?? "",
        );

    const type =
        (body[financial.typeIndex] ?? "")
            .toUpperCase();

    const balance =
        cleanAmount(
            body[financial.balanceIndex] ?? "",
        );

    const descriptionTokens =
        body.slice(
            0,
            financial.balanceIndex,
        );

    const description =
        descriptionTokens.join(" ").trim();

    const reference =
        extractReference(description);

    return {
        date,
        description,
        amount,
        type,
        reference,
        debit: type === "DR" ? amount : "",
        credit: type === "CR" ? amount : "",
        balance,
    };
}

function extractBankTransactions(
    lines: RawLine[],
): Transaction[] {
    const starts =
        findTransactionStarts(lines);

    if (starts.length === 0) {
        return [];
    }

    const transactions: Transaction[] = [];

    for (let i = 0; i < starts.length; i += 1) {
        const start = starts[i] ?? 0;
        const end =
            starts[i + 1] ?? lines.length;

        const block =
            lines.slice(start, end);

        const transaction =
            parseTransaction(block);

        if (transaction) {
            transactions.push(transaction);
        }
    }

    return transactions;
}

function buildBankDocument(
    transactions: Transaction[],
): CsvDocument {
    return {
        headers: [
            "Date",
            "Description",
            "Amount",
            "Type",
            "Reference",
            "Debit",
            "Credit",
            "Balance",
        ],
        rows: transactions.map(
            (transaction, index) => ({
                rowNumber: index + 1,
                values: [
                    transaction.date,
                    transaction.description,
                    transaction.amount,
                    transaction.type,
                    transaction.reference,
                    transaction.debit,
                    transaction.credit,
                    transaction.balance,
                ],
            }),
        ),
    };
}

function splitGenericLine(
    line: string,
): string[] {
    const tabParts =
        line.split(/\t+/)
            .map((value) => value.trim())
            .filter(Boolean);

    if (tabParts.length > 1) {
        return tabParts;
    }

    return line
        .split(/\s{2,}/)
        .map((value) => value.trim())
        .filter(Boolean);
}

function genericDocument(
    lines: RawLine[],
): CsvDocument {
    const rows = lines
        .map((line) =>
            splitGenericLine(line.text),
        )
        .filter((row) => row.length > 0);

    if (rows.length === 0) {
        return {
            headers: [],
            rows: [],
        };
    }

    const columnCount =
        Math.max(
            ...rows.map(
                (row) => row.length,
            ),
        );

    const headers = Array.from(
        { length: columnCount },
        (_, index) =>
            `Column ${index + 1}`,
    );

    return {
        headers,
        rows: rows.map(
            (values, index) => ({
                rowNumber: index + 1,
                values: [
                    ...values,
                    ...Array(
                        Math.max(
                            0,
                            columnCount -
                                values.length,
                        ),
                    ).fill(""),
                ],
            }),
        ),
    };
}

export async function parsePdf(
    content: ArrayBuffer,
): Promise<CsvDocument> {
    configurePdfWorker();

    const parser = new PDFParse({
        data: new Uint8Array(content),
        useWorkerFetch: false,
        isEvalSupported: false,
    });

    try {
        const result =
            await parser.getText();

        const lines =
            normalizeLines(result.text);

        const transactions =
            extractBankTransactions(lines);

        if (transactions.length > 0) {
            return buildBankDocument(
                transactions,
            );
        }

        return genericDocument(lines);
    } finally {
        await parser.destroy();
    }
}
