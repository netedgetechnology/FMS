// Finds "label -> value" facts wherever a layout puts them: beside the label
// in one cell, in the next cell, beside a label wrapped over several lines,
// or under a row of labels. Purely geometric - no page number or lender.

import type { FieldDefinition } from "./vocabulary";
import { FIELD_DEFINITIONS } from "./vocabulary";
import type { FieldKind, FieldValue } from "./types";
import { cellRight, normaliseLabel, type StatementCell, type StatementLine } from "./layout";
import {
    parseCount,
    parseDateValue,
    parseIdentifier,
    parseDatePrefix,
    parseMonths,
    parseRate,
    parseRaw,
    parseText,
    readMoney,
    type DateContext,
} from "./values";

export interface FieldCandidate {
    definition: FieldDefinition;
    value: FieldValue;
    page: number;
    order: number;
    label: string;
    raw: string;
    /** Matched only through its heading ("Principal" under "Outstanding"). */
    viaHeading: boolean;
    /** A bare "Account Number": yields to any label that says whose account. */
    weak?: boolean;
}

const WEAK_ACCOUNT_LABEL = /^(account number|account no|a c no|ac no|a c number)$/;
const MAX_LABEL_LINES = 6;
const MAX_INLINE_LABEL_WORDS = 7;
const COLUMN_TOLERANCE = 3;
const STACK_GAP_FACTOR = 2.6;

function parseKind(kind: FieldKind, text: string, label: string, dates: DateContext): FieldValue | null {
    switch (kind) {
        case "money":
            return readMoney(text)?.amount ?? null;
        case "date":
            return parseDateValue(text, dates);
        case "rate":
            return parseRate(text);
        case "months":
            return parseMonths(text, label);
        case "count":
            return parseCount(text);
        case "identifier":
            return parseIdentifier(text);
        case "text":
            return parseText(text);
        case "raw":
            return parseRaw(text);
    }
}

function definitionFor(
    normalised: string,
    definitions: readonly FieldDefinition[]
): FieldDefinition | null {
    // "Balance Principal (Rs.)": a trailing currency says nothing about the field.
    const bare = normalised.replace(/ (rs|inr|usd|eur|gbp)$/, "");

    return definitions.find(d => d.patterns.some(p => p.test(normalised) || p.test(bare))) ?? null;
}

function looksLikeLabel(text: string, definitions: readonly FieldDefinition[]): boolean {
    return definitionFor(normaliseLabel(text), definitions) !== null;
}

function clusterColumns(cells: readonly StatementCell[]): StatementCell[][] {
    const clusters: StatementCell[][] = [];

    for (const cell of [...cells].sort((a, b) => a.x - b.x)) {
        const cluster = clusters.find(c => Math.abs(c[0]!.x - cell.x) <= COLUMN_TOLERANCE);
        if (cluster) cluster.push(cell);
        else clusters.push([cell]);
    }

    clusters.forEach(cluster => cluster.sort((a, b) => a.order - b.order));

    return clusters;
}

function stacked(upper: StatementCell, lower: StatementCell): boolean {
    return upper.y - lower.y <= Math.max(upper.height, lower.height) * STACK_GAP_FACTOR;
}

function inlineCandidate(
    cell: StatementCell,
    definitions: readonly FieldDefinition[],
    dates: DateContext
): FieldCandidate | null {
    const colon = cell.text.indexOf(":");
    const splits: Array<[string, string, boolean]> = [];

    if (colon > 0) splits.push([cell.text.slice(0, colon), cell.text.slice(colon + 1), true]);

    const words = cell.text.split(/\s+/);
    if (words.length <= 12) {
        for (let count = Math.min(MAX_INLINE_LABEL_WORDS, words.length - 1); count >= 1; count -= 1) {
            splits.push([words.slice(0, count).join(" "), words.slice(count).join(" "), false]);
        }
    }

    for (const [label, rest, hasColon] of splits) {
        const definition = definitionFor(normaliseLabel(label), definitions);
        if (!definition || rest.trim() === "") continue;
        // Without a colon, words after a label are as likely to be a sentence.
        if (definition.kind === "text" && !hasColon) continue;

        const value = parseKind(definition.kind, rest, label, dates);
        if (value === null) continue;
        if ((definition.kind === "text" || definition.kind === "identifier") && looksLikeLabel(rest, definitions)) continue;

        return { definition, value, page: cell.page, order: cell.order, label: label.trim(), raw: rest.trim(), viaHeading: false };
    }

    return null;
}

/** A one-line label whose words arrived as separate cells, then its value. */
function splitLabelCandidates(
    line: StatementLine,
    definitions: readonly FieldDefinition[],
    dates: DateContext,
    used: Set<StatementCell>
): FieldCandidate[] {
    const found: FieldCandidate[] = [];
    const { cells } = line;
    let start = 0;

    while (start < cells.length - 2) {
        let matchedEnd: number | null = null;

        for (let end = Math.min(start + MAX_INLINE_LABEL_WORDS - 1, cells.length - 2); end > start; end -= 1) {
            const run = cells.slice(start, end + 1);
            const contiguous = run.every((cell, index) => index === 0 || cell.x - cellRight(run[index - 1]!) <= cell.height);
            const definition = contiguous ? definitionFor(normaliseLabel(run.map(cell => cell.text).join(" ")), definitions) : null;
            const valueCell = cells[end + 1]!;
            const value = definition ? parseKind(definition.kind, valueCell.text, run.map(cell => cell.text).join(" "), dates) : null;

            if (definition && value !== null && !run.some(cell => used.has(cell)) && !looksLikeLabel(valueCell.text, definitions)) {
                found.push({ definition, value, page: line.page, order: line.order, label: run.map(cell => cell.text).join(" "), raw: valueCell.text, viaHeading: false });
                run.forEach(cell => used.add(cell));
                matchedEnd = end + 1;
                break;
            }
        }

        start = matchedEnd === null ? start + 1 : matchedEnd + 1;
    }

    return found;
}

function looksLikeGridValue(text: string, dates: DateContext): boolean {
    return /^[\d₹$€£-]|^\(\d/.test(text.trim()) || parseDatePrefix(text, dates) !== null;
}

/**
 * Column headings over one row of values, the headings wrapped over several
 * lines and centred (so they share no left edge with their values).
 */
function gridCandidates(
    lines: readonly StatementLine[],
    definitions: readonly FieldDefinition[],
    dates: DateContext,
    used: ReadonlySet<StatementCell>
): FieldCandidate[] {
    const found: FieldCandidate[] = [];

    lines.forEach((line, index) => {
        if (line.cells.length < 3) return;
        if (line.cells.filter(cell => looksLikeGridValue(cell.text, dates)).length / line.cells.length < 0.6) return;

        const headers: StatementLine[] = [];
        let below = line;
        for (let up = index - 1; up >= Math.max(0, index - 4); up -= 1) {
            const candidate = lines[up]!;
            if (
                candidate.page !== line.page ||
                candidate.y - below.y > line.cells[0]!.height * STACK_GAP_FACTOR ||
                candidate.cells.some(cell => looksLikeGridValue(cell.text, dates))
            ) {
                break;
            }
            headers.unshift(candidate);
            below = candidate;
        }
        if (headers.length === 0) return;

        for (const cell of line.cells) {
            if (used.has(cell)) continue;

            const centre = cell.x + cell.width / 2;
            const parts = headers.map(header =>
                header.cells
                    .filter(h => h.x < cellRight(cell) + 6 && cellRight(h) > cell.x - 6)
                    .sort((a, b) => Math.abs(a.x + a.width / 2 - centre) - Math.abs(b.x + b.width / 2 - centre))[0]?.text
            );

            // Lines above may belong to something else: longest heading first.
            let label = "";
            let definition: FieldDefinition | null = null;
            for (let start = 0; start < parts.length && !definition; start += 1) {
                label = parts.slice(start).filter(Boolean).join(" ");
                definition = definitionFor(normaliseLabel(label), definitions);
            }
            if (!definition || definition.kind === "text") continue;

            const value = parseKind(definition.kind, cell.text, label, dates);
            if (value === null) continue;

            found.push({ definition, value, page: line.page, order: line.order, label, raw: cell.text, viaHeading: false });

            // "9 / 73,791.00": the count and the amount it came to.
            const amountPart = /^\d+\s*\/\s*([\d,.]+)$/.exec(cell.text.trim());
            const amountDefinition = definition.id === "instalmentsPaid" ? definitions.find(d => d.id === "instalmentsPaidAmount") : undefined;
            if (amountPart && amountDefinition) {
                const amount = parseKind("money", amountPart[1]!, label, dates);
                if (amount !== null) found.push({ definition: amountDefinition, value: amount, page: line.page, order: line.order, label, raw: cell.text, viaHeading: false });
            }
        }
    });

    return found;
}

const STATEMENT_TITLE_ACCOUNT = /\bstatement\s+(?:for|of)\s+(?:loan\s+)?(?:account\s+)?(?:no\.?\s*|number\s*)?:?\s*([A-Za-z0-9][\w\-/]*\d[\w\-/]{3,})/i;
const RATE_NATURE = /^\(?\s*(floating|fixed|variable)\s*\)?$/i;

/** The account named in the statement's own title, and a bare rate-type tag. */
function titleCandidates(
    lines: readonly StatementLine[],
    definitions: readonly FieldDefinition[],
    dates: DateContext
): FieldCandidate[] {
    const found: FieldCandidate[] = [];
    const account = definitions.find(d => d.id === "loanAccountNumber")!;
    const interestType = definitions.find(d => d.id === "interestTypeText")!;

    for (const line of lines) {
        for (const cell of line.cells) {
            const title = STATEMENT_TITLE_ACCOUNT.exec(cell.text);
            if (title && parseKind("identifier", title[1]!, "", dates) !== null) {
                found.push({ definition: account, value: title[1]!, page: line.page, order: line.order, label: "Statement title", raw: cell.text, viaHeading: false });
            }

            const nature = RATE_NATURE.exec(cell.text);
            if (nature) {
                found.push({ definition: interestType, value: nature[1]!, page: line.page, order: line.order, label: "Rate of interest (type)", raw: cell.text, viaHeading: false });
            }
        }
    }

    return found;
}

interface LabelMatch {
    definition: FieldDefinition;
    viaHeading: boolean;
}

function matchLabelStack(
    stack: readonly StatementCell[],
    column: readonly StatementCell[],
    startIndex: number,
    definitions: readonly FieldDefinition[]
): LabelMatch | null {
    const normalised = normaliseLabel(stack.map(cell => cell.text).join(" "));
    const direct = definitionFor(normalised, definitions);

    if (direct) return { definition: direct, viaHeading: false };

    for (const definition of definitions) {
        if (!definition.bareUnderHeading) continue;
        const [bare, heading] = definition.bareUnderHeading as [RegExp, RegExp];
        if (!bare.test(normalised)) continue;

        for (let index = startIndex - 1; index >= Math.max(0, startIndex - 8); index -= 1) {
            if (heading.test(column[index]!.text)) return { definition, viaHeading: true };
        }
    }

    return null;
}

function valueBeside(
    stack: readonly StatementCell[],
    pageCells: readonly StatementCell[],
    definitions: readonly FieldDefinition[]
): StatementCell | null {
    const right = Math.max(...stack.map(cellRight));
    const tolerance = Math.max(stack[0]!.height * 0.5, 4);
    const top = stack[0]!.y + tolerance;
    const bottom = stack[stack.length - 1]!.y - tolerance;
    const beside = pageCells
        .filter(cell => cell.x >= right - 1 && cell.y <= top && cell.y >= bottom && !stack.includes(cell))
        .sort((a, b) => a.x - b.x)[0];

    return beside && !looksLikeLabel(beside.text, definitions) ? beside : null;
}

function valueBelow(label: StatementCell, line: StatementLine, nextLine: StatementLine | undefined): StatementCell | null {
    if (!nextLine || nextLine.page !== line.page || line.y - nextLine.y > label.height * STACK_GAP_FACTOR) return null;

    return nextLine.cells.find(cell => cell.x < cellRight(label) && cellRight(cell) > label.x) ?? null;
}

export function extractCandidates(
    lines: readonly StatementLine[],
    definitions: readonly FieldDefinition[] = FIELD_DEFINITIONS,
    dates: DateContext
): FieldCandidate[] {
    const candidates: FieldCandidate[] = [];
    const inlineCells = new Set<StatementCell>();

    for (const line of lines) {
        for (const cell of line.cells) {
            const found = inlineCandidate(cell, definitions, dates);
            if (found) {
                candidates.push(found);
                inlineCells.add(cell);
            }
        }
    }

    for (const line of lines) {
        candidates.push(...splitLabelCandidates(line, definitions, dates, inlineCells));
    }

    candidates.push(...gridCandidates(lines, definitions, dates, inlineCells));
    candidates.push(...titleCandidates(lines, definitions, dates));

    const pages = [...new Set(lines.map(line => line.page))];

    for (const page of pages) {
        const pageLines = lines.filter(line => line.page === page);
        const pageCells = pageLines.flatMap(line => line.cells);

        for (const column of clusterColumns(pageCells.filter(cell => !inlineCells.has(cell)))) {
            let index = 0;
            let previousWasLabel = false;

            while (index < column.length) {
                const accepted = matchAt(column, index, previousWasLabel, pageCells, pageLines, definitions, dates);

                if (accepted) {
                    candidates.push(accepted.candidate);
                    index += accepted.span;
                    previousWasLabel = true;
                } else {
                    index += 1;
                    previousWasLabel = false;
                }
            }
        }
    }

    return candidates.sort((a, b) => a.order - b.order);
}

function matchAt(
    column: readonly StatementCell[],
    index: number,
    previousWasLabel: boolean,
    pageCells: readonly StatementCell[],
    pageLines: readonly StatementLine[],
    definitions: readonly FieldDefinition[],
    dates: DateContext
): { candidate: FieldCandidate; span: number } | null {
    // "Online / Account / Number": the tail of a longer, unknown label is
    // not the label "Account Number".
    const above = column[index - 1];
    if (above && !previousWasLabel && stacked(above, column[index]!) && !/\s/.test(above.text) && /^[A-Za-z]+$/.test(above.text)) {
        return null;
    }

    let maxSpan = 1;
    while (
        maxSpan < MAX_LABEL_LINES &&
        index + maxSpan < column.length &&
        stacked(column[index + maxSpan - 1]!, column[index + maxSpan]!)
    ) {
        maxSpan += 1;
    }

    for (let span = maxSpan; span >= 1; span -= 1) {
        const stack = column.slice(index, index + span);
        const match = matchLabelStack(stack, column, index, definitions);
        if (!match) continue;

        const labelText = stack.map(cell => cell.text).join(" ");
        const { definition } = match;
        let valueCell = valueBeside(stack, pageCells, definitions);
        let value = valueCell ? parseKind(definition.kind, valueCell.text, labelText, dates) : null;

        if (value === null && span === 1) {
            const line = pageLines.find(l => l.cells.includes(stack[0]!));
            const nextLine = line ? pageLines[pageLines.indexOf(line) + 1] : undefined;
            const siblingLabels = line?.cells.filter(cell => looksLikeLabel(cell.text, definitions)).length ?? 0;

            if (line && siblingLabels >= 2) {
                valueCell = valueBelow(stack[0]!, line, nextLine);
                value = valueCell && !looksLikeLabel(valueCell.text, definitions)
                    ? parseKind(definition.kind, valueCell.text, labelText, dates)
                    : null;
            }
        }

        // A row of column headings is not a label and its value.
        const valueLine = valueCell ? pageLines.find(l => l.cells.includes(valueCell!)) : undefined;
        if (
            value !== null &&
            (definition.kind === "text" || definition.kind === "identifier") &&
            !labelText.trim().endsWith(":") &&
            valueLine &&
            valueLine.cells.length >= 3 &&
            valueLine.cells.every(cell => !/\d/.test(cell.text))
        ) {
            value = null;
        }

        if (value !== null && valueCell) {
            return {
                span,
                candidate: {
                    definition,
                    value,
                    page: stack[0]!.page,
                    order: stack[0]!.order,
                    label: labelText,
                    raw: valueCell.text,
                    viaHeading: match.viaHeading,
                    weak: definition.id === "loanAccountNumber" && WEAK_ACCOUNT_LABEL.test(normaliseLabel(labelText)),
                },
            };
        }
    }

    return null;
}
