// Reading one printed value. Each reader returns null for anything it cannot
// read with certainty - a blank is always better than a guess.

import { parseMoney } from "../normalizer/moneyNormalizer";

const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export interface DateContext {
    /** dd/mm (true) or mm/dd (false) for an ambiguous numeric date. */
    dayFirst: boolean;
}

export const DEFAULT_DATE_CONTEXT: DateContext = { dayFirst: true };

function iso(year: number, month: number, day: number): string | null {
    const fullYear = year < 100 ? 2000 + year : year;
    const probe = new Date(Date.UTC(fullYear, month - 1, day));

    if (
        fullYear < 1950 ||
        fullYear > 2100 ||
        probe.getUTCMonth() !== month - 1 ||
        probe.getUTCDate() !== day
    ) {
        return null;
    }

    return `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Some PDFs space out the separators ("2026 -04 -05").
const SEP = String.raw`\s*[-/.]\s*`;
const YMD = new RegExp(String.raw`^(\d{4})${SEP}(\d{1,2})${SEP}(\d{1,2})`);
const NUMERIC = new RegExp(String.raw`^(\d{1,2})${SEP}(\d{1,2})${SEP}(\d{4}|\d{2})(?!\d)`);
const DAY_MON_YEAR = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+([A-Za-z]{3,9})[\s\-/.,]+(\d{4}|\d{2})(?!\d)/;
const MON_DAY_YEAR = /^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?!\d)/;

export interface ParsedDate {
    iso: string;
    /** Text after the date, if the cell carries more. */
    rest: string;
}

export function parseDatePrefix(text: string, context: DateContext = DEFAULT_DATE_CONTEXT): ParsedDate | null {
    const value = text.trim();
    let result: string | null = null;
    let matched: RegExpExecArray | null;

    if ((matched = YMD.exec(value))) {
        result = iso(Number(matched[1]), Number(matched[2]), Number(matched[3]));
    } else if ((matched = NUMERIC.exec(value))) {
        const [first, second, year] = [Number(matched[1]), Number(matched[2]), Number(matched[3])];
        const dayFirst = first > 12 ? true : second > 12 ? false : context.dayFirst;
        result = dayFirst ? iso(year, second, first) : iso(year, first, second);
    } else if ((matched = DAY_MON_YEAR.exec(value))) {
        const month = MONTHS[matched[2]!.slice(0, 3).toLowerCase()];
        result = month ? iso(Number(matched[3]), month, Number(matched[1])) : null;
    } else if ((matched = MON_DAY_YEAR.exec(value))) {
        const month = MONTHS[matched[1]!.slice(0, 3).toLowerCase()];
        result = month ? iso(Number(matched[3]), month, Number(matched[2])) : null;
    }

    return result && matched ? { iso: result, rest: value.slice(matched[0].length).trim() } : null;
}

export function parseDateValue(text: string, context: DateContext = DEFAULT_DATE_CONTEXT): string | null {
    const parsed = parseDatePrefix(text, context);

    return parsed && parsed.rest === "" ? parsed.iso : null;
}

/** dd/mm or mm/dd for the whole document, from any date that can only be one. */
export function inferDateContext(texts: readonly string[]): DateContext {
    const anywhere = new RegExp(String.raw`(?<![\d/.-])(\d{1,2})${SEP}(\d{1,2})${SEP}(?:\d{4}|\d{2})(?!\d)`, "g");

    for (const text of texts) {
        for (const matched of text.matchAll(anywhere)) {
            if (Number(matched[1]) > 12) return { dayFirst: true };
            if (Number(matched[2]) > 12) return { dayFirst: false };
        }
    }

    return DEFAULT_DATE_CONTEXT;
}

const SCALE = /^(.*?\d)\s*(crores?|cr\.?|lakhs?|lacs?)$/i;

export interface MoneyReading {
    amount: number;
    negative: boolean;
    marker: "DR" | "CR" | null;
}

export function readMoney(text: string): MoneyReading | null {
    const value = text.trim();

    if (!/\d/.test(value)) return null;

    // "1.5 Cr" means crore; "1,50,000.00 Cr" is a credit marker.
    const scaled = SCALE.exec(value);
    if (scaled && !/\.\d{2}$/.test(scaled[1]!.replace(/,/g, "")) && !/,/.test(scaled[1]!)) {
        const base = parseMoney(scaled[1]!);
        if (base.kind === "value" && base.magnitude !== null) {
            const factor = /^c/i.test(scaled[2]!) ? 10000000 : 100000;
            return { amount: Math.round(base.magnitude * factor * 100) / 100, negative: base.negative, marker: null };
        }
    }

    const parsed = parseMoney(value);

    return parsed.kind === "value" && parsed.magnitude !== null
        ? { amount: parsed.magnitude, negative: parsed.negative, marker: parsed.marker }
        : null;
}

export function parseRate(text: string): number | null {
    const matched = /^(\d{1,2}(?:\.\d{1,4})?)\s*%?\s*(?:p\.?\s*a\.?|per\s+annum|pa)?$/i.exec(text.trim());
    const rate = matched ? Number(matched[1]) : Number.NaN;

    return Number.isFinite(rate) && rate >= 0 && rate <= 60 ? rate : null;
}

export function parseMonths(text: string, label = ""): number | null {
    const value = text.trim().toLowerCase();
    const matched = /^(\d{1,3})\s*(months?|mths?|m|years?|yrs?|y)?$/.exec(value);

    if (!matched) return null;

    const quantity = Number(matched[1]);
    const inYears = matched[2] ? /^y/.test(matched[2]) : /\byears?\b|\byrs?\b/i.test(label);
    const months = inYears ? quantity * 12 : quantity;

    return months > 0 && months <= 600 ? months : null;
}

export function parseCount(text: string): number | null {
    const value = text.trim();

    // "9 / 73,791.00": a count printed with its amount.
    const matched = /^(\d{1,4})(?:\s*\/.*)?$/.exec(value);

    return matched ? Number(matched[1]) : null;
}

export function parseIdentifier(text: string): string | null {
    const value = text.trim();

    // Spaces only between digit groups: "Information as on 09-Nov" is prose.
    return /^[A-Za-z0-9][\w\-/]{2,40}(?: [0-9\-/]+)*$/.test(value) && /\d/.test(value) ? value : null;
}

export function parseText(text: string): string | null {
    const value = text.trim().replace(/\s+/g, " ");

    return /[A-Za-z]/.test(value) && value.length <= 120 && !value.endsWith(":") ? value : null;
}

export function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

/** Printed as-is ("11.75 / (1)") when the parts' meaning is lender-specific. */
export function parseRaw(text: string): string | null {
    const value = text.trim().replace(/\s+/g, " ");

    return /\d/.test(value) && value.length <= 40 ? value : null;
}
