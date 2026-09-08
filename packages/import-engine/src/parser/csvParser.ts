import type {
    CsvDocument,
    CsvRow,
} from "../types";

import {
    detectDelimiterAndHeader,
    splitDelimitedLine,
} from "./tableDetector";

export function stripBom(content: string): string {
    return content.charCodeAt(0) === 0xfeff
        ? content.slice(1)
        : content;
}

export function splitCsvLines(
    content: string
): string[] {
    const lines: string[] = [];
    let current = "";
    let quoted = false;

    for (
        let index = 0;
        index < content.length;
        index += 1
    ) {
        const character = content[index];

        if (character === '"') {
            if (
                quoted &&
                content[index + 1] === '"'
            ) {
                current += '""';
                index += 1;
                continue;
            }

            quoted = !quoted;
            current += character;
            continue;
        }

        if (
            (character === "\n" ||
                character === "\r") &&
            !quoted
        ) {
            if (current.trim().length > 0) {
                lines.push(current);
            }

            current = "";

            if (
                character === "\r" &&
                content[index + 1] === "\n"
            ) {
                index += 1;
            }

            continue;
        }

        current += character;
    }

    if (current.trim().length > 0) {
        lines.push(current);
    }

    return lines;
}

// Reconciles a data row's field count against the header's, tolerating the
// common real-world messiness of unquoted delimiters inside a trailing
// value (e.g. an address column containing a comma). Extra trailing
// fields are folded back into the last column instead of being dropped or
// left misaligned; missing trailing fields are padded with "".
function reconcileFieldCount(
    values: string[],
    headerCount: number,
    delimiter: string
): string[] {
    if (
        headerCount === 0 ||
        values.length === headerCount
    ) {
        return values;
    }

    if (values.length > headerCount) {
        const head = values.slice(
            0,
            headerCount - 1
        );

        const overflow = values
            .slice(headerCount - 1)
            .join(delimiter);

        return [...head, overflow];
    }

    return [
        ...values,
        ...Array(
            headerCount - values.length
        ).fill(""),
    ];
}

export function parseCsv(
    content: string
): CsvDocument {
    const lines = splitCsvLines(
        stripBom(content)
    );

    if (lines.length === 0) {
        return {
            headers: [],
            rows: [],
        };
    }

    const { delimiter, headerIndex, bodyLength } =
        detectDelimiterAndHeader(lines);

    const headerLine = lines[headerIndex];

    const headers = splitDelimitedLine(
        headerLine,
        delimiter
    ).map(header => header.trim());

    const rows: CsvRow[] = [];

    // Bound the transaction body to the contiguous, structurally-consistent
    // run right after the header (bodyLength) so trailing non-tabular
    // content - footers, disclaimers, legends - is never treated as
    // transaction rows. A malformed row *inside* that run still has the
    // right shape (same field count), so it stays in and is reported as a
    // validation error downstream, rather than being silently dropped.
    // `bodyLength` is null only when no reliable structure was found at
    // all, in which case every line through EOF is kept (prior behavior).
    const bodyEndIndex =
        bodyLength === null
            ? lines.length
            : Math.min(
                  lines.length,
                  headerIndex + 1 + bodyLength
              );

    for (
        let index = headerIndex + 1;
        index < bodyEndIndex;
        index += 1
    ) {
        const line = lines[index];

        if (!line.trim()) {
            continue;
        }

        const values = reconcileFieldCount(
            splitDelimitedLine(
                line,
                delimiter
            ),
            headers.length,
            delimiter
        );

        rows.push({
            rowNumber: index + 1,
            values,
        });
    }

    return {
        headers,
        rows,
    };
}
