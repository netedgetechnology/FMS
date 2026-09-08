// Generic delimiter + header-row detection for messy real-world exports.
//
// Bank/CSV exports frequently prepend account metadata (name, address,
// statement period, ...) before the actual transaction table, and use
// commas, semicolons, or tabs as the field separator. This module never
// assumes the header is line 1 - instead it looks for the delimiter and
// line that best explains a long, consistently-wide run of following rows
// (the transaction table), regardless of bank/source.

const CANDIDATE_DELIMITERS = [
    ",",
    ";",
    "\t",
    "|",
] as const;

export type CsvDelimiter = (typeof CANDIDATE_DELIMITERS)[number];

// A transaction table needs at least this many fields to be considered a
// plausible header row (filters out single-value metadata lines).
const MIN_HEADER_FIELDS = 2;

// Delimiter-agnostic result of scanning already-split rows for the real
// header - shared by CSV (after splitting each line by its detected
// delimiter) and Excel (whose rows from a spreadsheet are already
// naturally split into per-cell fields, no delimiter involved at all).
export interface HeaderRowDetectionResult {
    headerIndex: number;
    // Number of consecutive rows right after the header that stay
    // structurally consistent with it (the transaction body). `null`
    // means "unbounded" - no reliable tabular structure was found, so
    // callers should fall back to reading through EOF (prior behavior).
    bodyLength: number | null;
}

export interface TableDetectionResult
    extends HeaderRowDetectionResult {
    delimiter: CsvDelimiter;
}

export function splitDelimitedLine(
    line: string,
    delimiter: string
): string[] {
    const values: string[] = [];
    let current = "";
    let quoted = false;

    for (
        let index = 0;
        index < line.length;
        index += 1
    ) {
        const character = line[index];

        if (character === '"') {
            if (
                quoted &&
                line[index + 1] === '"'
            ) {
                current += '"';
                index += 1;
                continue;
            }

            quoted = !quoted;
            continue;
        }

        if (
            character === delimiter &&
            !quoted
        ) {
            values.push(current.trim());
            current = "";
            continue;
        }

        current += character;
    }

    values.push(current.trim());

    return values;
}

// A field that is (once punctuation/currency symbols are stripped)
// nothing but digits - i.e. it looks like an amount, balance, or a piece
// of a date, never a column label.
function isNumericLikeField(field: string): boolean {
    const stripped = field
        .trim()
        .replace(/[,.\-/:\s()₹$€£]/g, "");

    return (
        stripped.length > 0 &&
        /^\d+$/.test(stripped)
    );
}

// A data row almost always has a date and/or an amount in it; a header
// row almost never has a purely-numeric field. This alone is usually
// enough to rule out both data rows AND incidental metadata lines (e.g.
// an address containing a house/door number) as header candidates.
function looksLikeDataRow(
    fields: string[]
): boolean {
    return fields.some(isNumericLikeField);
}

// Scans already-split rows (each row = an array of field strings, in
// original order) for the row that best explains the longest,
// structurally consistent run of tabular data immediately following it
// - i.e. the real header, regardless of how many metadata/preamble rows
// (account name, address, statement period, ...) precede it. Delimiter-
// agnostic and source-agnostic: it never reads `lines` as text, only the
// already-split `rows` - so it's equally usable by a CSV/TSV file (after
// splitting each line by its detected delimiter, see
// findBestHeaderForDelimiter below) and by a spreadsheet's rows (already
// naturally split into per-cell fields by the spreadsheet format itself
// - see excelParser.ts's parseExcel, which calls this directly).
export function findHeaderRow(
    rows: string[][]
): HeaderRowDetectionResult | null {
    const counts = rows.map(
        fields => fields.length
    );

    let best: {
        headerIndex: number;
        runLength: number;
    } | null = null;

    for (
        let index = 0;
        index < rows.length;
        index += 1
    ) {
        const fieldCount = counts[index];

        if (
            fieldCount < MIN_HEADER_FIELDS ||
            looksLikeDataRow(
                rows[index]
            )
        ) {
            continue;
        }

        // Tolerate one missing trailing field in the rows that follow
        // (e.g. an optional Reference column left blank/omitted), while
        // still requiring a genuinely tabular run - not just any row
        // that happens to share the field count.
        const minRunFieldCount = Math.max(
            MIN_HEADER_FIELDS,
            fieldCount - 1
        );

        let run = 0;

        for (
            let next = index + 1;
            next < rows.length;
            next += 1
        ) {
            if (
                counts[next] <
                minRunFieldCount
            ) {
                break;
            }

            run += 1;
        }

        if (
            !best ||
            run > best.runLength
        ) {
            best = {
                headerIndex: index,
                runLength: run,
            };
        }
    }

    if (!best) {
        return null;
    }

    return {
        headerIndex: best.headerIndex,
        bodyLength: best.runLength,
    };
}

function findBestHeaderForDelimiter(
    lines: string[],
    delimiter: CsvDelimiter
): HeaderRowDetectionResult | null {
    const splitLines = lines.map(line =>
        splitDelimitedLine(line, delimiter)
    );

    return findHeaderRow(splitLines);
}

// Picks the delimiter and header row that together explain the longest
// consistent run of tabular data anywhere in the file. Falls back to
// comma-delimited, line 0, unbounded body when nothing tabular is found
// (e.g. a single data line with no repeated structure), matching prior
// behavior.
export function detectDelimiterAndHeader(
    lines: string[]
): TableDetectionResult {
    let best: TableDetectionResult | null = null;

    for (const delimiter of CANDIDATE_DELIMITERS) {
        const candidate =
            findBestHeaderForDelimiter(
                lines,
                delimiter
            );

        if (!candidate) {
            continue;
        }

        if (
            !best ||
            (candidate.bodyLength ?? 0) >
                (best.bodyLength ?? 0)
        ) {
            best = {
                delimiter,
                headerIndex:
                    candidate.headerIndex,
                bodyLength:
                    candidate.bodyLength,
            };
        }
    }

    if (!best) {
        return {
            delimiter: ",",
            headerIndex: 0,
            bodyLength: null,
        };
    }

    return best;
}
