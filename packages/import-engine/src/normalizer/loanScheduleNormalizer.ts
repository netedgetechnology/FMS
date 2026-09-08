import type {
    CsvDocument,
    NormalizedLoanScheduleCandidate,
    LoanScheduleColumnMapping,
} from "../types";

function parseNumber(value: string | undefined): number | null {
    if (value === undefined || value === null) {
        return null;
    }

    const cleaned = value
        .trim()
        .replace(/,/g, "")
        .replace(/[₹$€£]/g, "")
        .replace(/\s/g, "")
        .replace(/^\((.*)\)$/, "-$1");

    if (!cleaned) {
        return null;
    }

    const parsed = Number(cleaned);

    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: string | undefined): string | null {
    if (!value?.trim()) {
        return null;
    }

    const input = value.trim();

    // ISO date
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        const date = new Date(`${input}T00:00:00Z`);

        return Number.isNaN(date.getTime())
            ? null
            : input;
    }

    // DD/MM/YYYY or DD-MM-YYYY
    const dmy = input.match(
        /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/
    );

    if (dmy) {
        const day = Number(dmy[1]);
        const month = Number(dmy[2]);
        const year = Number(dmy[3]);

        const date = new Date(
            Date.UTC(year, month - 1, day)
        );

        if (
            date.getUTCFullYear() !== year ||
            date.getUTCMonth() !== month - 1 ||
            date.getUTCDate() !== day
        ) {
            return null;
        }

        return `${year.toString().padStart(4, "0")}-${month
            .toString()
            .padStart(2, "0")}-${day
            .toString()
            .padStart(2, "0")}`;
    }

    // DD/MM/YY or DD-MM-YY
    const shortDmy = input.match(
        /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2})$/
    );

    if (shortDmy) {
        const day = Number(shortDmy[1]);
        const month = Number(shortDmy[2]);
        const shortYear = Number(shortDmy[3]);
        const year = shortYear >= 50
            ? 1900 + shortYear
            : 2000 + shortYear;

        const date = new Date(
            Date.UTC(year, month - 1, day)
        );

        if (
            date.getUTCFullYear() !== year ||
            date.getUTCMonth() !== month - 1 ||
            date.getUTCDate() !== day
        ) {
            return null;
        }

        return `${year.toString().padStart(4, "0")}-${month
            .toString()
            .padStart(2, "0")}-${day
            .toString()
            .padStart(2, "0")}`;
    }

    const parsed = new Date(input);

    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed.toISOString().slice(0, 10);
}

function getValue(
    rowValues: string[],
    headers: string[],
    header: string | undefined
): string {
    if (!header) {
        return "";
    }

    const index = headers.indexOf(header);

    return index >= 0
        ? (rowValues[index] ?? "").trim()
        : "";
}

function rawDataForRow(
    rowValues: string[],
    headers: string[]
): Record<string, string> {
    const rawData: Record<string, string> = {};

    headers.forEach((header, index) => {
        rawData[header] = rowValues[index] ?? "";
    });

    return rawData;
}

export function normalizeLoanScheduleRows(
    document: CsvDocument,
    mapping: LoanScheduleColumnMapping
): NormalizedLoanScheduleCandidate[] {
    return document.rows.map(row => {
        const installmentValue = getValue(
            row.values,
            document.headers,
            mapping.installmentNumber
        );

        const dueDateValue = getValue(
            row.values,
            document.headers,
            mapping.dueDate
        );

        const paymentDateValue = getValue(
            row.values,
            document.headers,
            mapping.paymentDate
        );

        const emiValue = getValue(
            row.values,
            document.headers,
            mapping.emi
        );

        const principalValue = getValue(
            row.values,
            document.headers,
            mapping.principal
        );

        const interestValue = getValue(
            row.values,
            document.headers,
            mapping.interest
        );

        const outstandingPrincipalValue = getValue(
            row.values,
            document.headers,
            mapping.outstandingPrincipal
        );

        const outstandingBalanceValue = getValue(
            row.values,
            document.headers,
            mapping.outstandingBalance
        );

        const loanNumberValue = getValue(
            row.values,
            document.headers,
            mapping.loanNumber
        );

        const descriptionValue = getValue(
            row.values,
            document.headers,
            mapping.description
        );

        const referenceValue = getValue(
            row.values,
            document.headers,
            mapping.referenceNumber
        );

        return {
            rowNumber: row.rowNumber,

            installmentNumber:
                parseNumber(installmentValue),

            dueDate:
                normalizeDate(dueDateValue),

            paymentDate:
                normalizeDate(paymentDateValue),

            emi:
                parseNumber(emiValue),

            principal:
                parseNumber(principalValue),

            interest:
                parseNumber(interestValue),

            outstandingPrincipal:
                parseNumber(
                    outstandingPrincipalValue ||
                    outstandingBalanceValue
                ),

            loanNumber:
                loanNumberValue || null,

            description:
                descriptionValue,

            referenceNumber:
                referenceValue || null,

            rawData:
                rawDataForRow(
                    row.values,
                    document.headers
                ),
        };
    });
}
