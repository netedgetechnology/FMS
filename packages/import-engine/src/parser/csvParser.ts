import type {
    CsvDocument,
    CsvRow,
} from "../types";

function parseCsvLine(
    line: string
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
            character === "," &&
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

function splitCsvLines(
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

export function parseCsv(
    content: string
): CsvDocument {
    const lines =
        splitCsvLines(content);

    if (lines.length === 0) {
        return {
            headers: [],
            rows: [],
        };
    }

    const headers =
        parseCsvLine(lines[0]).map(
            header => header.trim()
        );

    const rows: CsvRow[] = [];

    for (
        let index = 1;
        index < lines.length;
        index += 1
    ) {
        const line = lines[index];

        if (!line.trim()) {
            continue;
        }

        rows.push({
            rowNumber: index + 1,
            values: parseCsvLine(line),
        });
    }

    return {
        headers,
        rows,
    };
}
