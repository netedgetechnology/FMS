// Finds tables by what their header row says and reads each row under the
// columns the header defines. A table may run across pages without
// repeating its header. Nothing depends on where a table sits.

import { cellRight, normaliseLabel, type StatementCell, type StatementLine } from "./layout";
import { rolesOf, type ColumnRole } from "./vocabulary";
import { parseDatePrefix, type DateContext } from "./values";

export type TableKind = "LEDGER" | "SCHEDULE" | "LIMITS" | "RATES" | "DISBURSEMENTS" | "CHARGES" | "SUMMARY" | "GENERIC";

export interface TableColumn {
    role: ColumnRole | null;
    x: number;
    right: number;
}

export interface TableRow {
    page: number;
    order: number;
    date: string;
    cells: Partial<Record<ColumnRole, string>>;
}

export interface StatementTable {
    kind: TableKind;
    columns: TableColumn[];
    rows: TableRow[];
    headerOrder: number;
    lastOrder: number;
    /** Every line this table owns, so label scanning can skip them. */
    consumed: Set<StatementLine>;
}

const MONEY_ROLES: ColumnRole[] = ["debit", "credit", "amount", "balance"];

interface HeaderCell {
    x: number;
    right: number;
    role: ColumnRole | null;
}

function tableKind(roles: ReadonlySet<ColumnRole>): TableKind | null {
    const has = (role: ColumnRole) => roles.has(role);
    const dated = has("date") || has("dueDate");

    if (has("chargeName") && (has("amount") || has("debit"))) return "CHARGES";
    if (!dated && has("description") && has("debit") && has("credit")) return "SUMMARY";
    if (!dated) return null;
    if (has("principal") && has("interest") && !has("debit") && !has("credit") && !has("amount")) return "SCHEDULE";
    if ((has("debit") && has("credit")) || has("amount") || (has("balance") && (has("debit") || has("credit")))) return "LEDGER";
    if (has("gross") || has("net")) return "DISBURSEMENTS";
    if (has("limit") || has("drawingPower")) return "LIMITS";
    if (has("rate")) return "RATES";

    return null;
}

function headerFrom(cells: readonly { x: number; right: number; texts: string[] }[]): HeaderCell[] {
    return cells.map(cell => {
        const spaced = normaliseLabel(cell.texts.join(" "));
        const joined = normaliseLabel(cell.texts.join(""));

        return { x: cell.x, right: cell.right, role: rolesOf(spaced) ?? rolesOf(joined) };
    });
}

function isValueLike(text: string, dates: DateContext): boolean {
    return /^[\d(₹-]/.test(text.trim()) || parseDatePrefix(text, dates) !== null;
}

function headerAt(lines: readonly StatementLine[], index: number, dates: DateContext): { columns: HeaderCell[]; kind: TableKind; span: number } | null {
    const line = lines[index]!;
    if (line.cells.length < 2 || line.cells.some(cell => isValueLike(cell.text, dates))) return null;

    const single = line.cells.map(cell => ({ x: cell.x, right: cellRight(cell), texts: [cell.text] }));
    const next = lines[index + 1];
    const attempts: Array<{ cells: typeof single; span: number }> = [{ cells: single, span: 1 }];

    // A header row wrapped onto a second line.
    if (
        next &&
        next.page === line.page &&
        line.y - next.y <= Math.max(line.cells[0]!.height, 10) * 2.2 &&
        !next.cells.some(cell => isValueLike(cell.text, dates))
    ) {
        const merged = single.map(cell => ({ ...cell, texts: [...cell.texts] }));
        let allOverlap = true;

        for (const lower of next.cells) {
            const owner = merged.find(cell => lower.x < cell.right + 2 && cellRight(lower) > cell.x - 2);
            if (owner) {
                owner.texts.push(lower.text);
                owner.right = Math.max(owner.right, cellRight(lower));
            } else {
                allOverlap = false;
            }
        }

        if (allOverlap) attempts.unshift({ cells: merged, span: 2 });
    }

    for (const attempt of attempts) {
        const columns = headerFrom(attempt.cells);
        const roles = new Set(columns.map(column => column.role).filter((role): role is ColumnRole => role !== null));
        const kind = tableKind(roles);

        if (kind && roles.size >= 2) return { columns, kind, span: attempt.span };

        // Any other numbered list: not understood, but its cells must not be
        // mistaken for labels and values, and it ends the table before it.
        if (columns[0]!.role === "instalmentNo" && columns.length >= 3) return { columns, kind: "GENERIC", span: attempt.span };
    }

    return null;
}

function nearestColumn(cell: StatementCell, columns: readonly HeaderCell[]): HeaderCell {
    const centre = cell.x + cell.width / 2;

    return columns.reduce((best, column) => {
        const distance = (c: HeaderCell) =>
            Math.min(Math.abs(cell.x - c.x), Math.abs(cellRight(cell) - c.right), Math.abs(centre - (c.x + c.right) / 2));

        return distance(column) < distance(best) ? column : best;
    });
}

function anchorIn(line: StatementLine, dateColumn: HeaderCell, dates: DateContext): StatementCell | null {
    const first = line.cells.find(cell => cell.x <= dateColumn.right + 4 && cellRight(cell) >= dateColumn.x - 4);

    return first && parseDatePrefix(first.text, dates) ? first : null;
}

function median(values: readonly number[], fallback: number): number {
    if (values.length === 0) return fallback;
    const sorted = [...values].sort((a, b) => a - b);

    return sorted[Math.floor(sorted.length / 2)]!;
}

export function detectTables(lines: readonly StatementLine[], dates: DateContext): StatementTable[] {
    const tables: StatementTable[] = [];
    let index = 0;

    while (index < lines.length) {
        const header = headerAt(lines, index, dates);

        if (!header) {
            index += 1;
            continue;
        }

        const dateColumn = header.columns.find(column => column.role === "date" || column.role === "dueDate");
        const start = index + header.span;
        const anchors: Array<{ line: StatementLine; lineIndex: number }> = [];
        let cursor = start;

        while (cursor < lines.length && !headerAt(lines, cursor, dates)) {
            if (dateColumn && anchorIn(lines[cursor]!, dateColumn, dates)) {
                anchors.push({ line: lines[cursor]!, lineIndex: cursor });
            } else if (!dateColumn && (header.kind === "CHARGES" || header.kind === "SUMMARY")) {
                const hasAmount = lines[cursor]!.cells.some(cell => /\d/.test(cell.text));
                if (!hasAmount) break;
                anchors.push({ line: lines[cursor]!, lineIndex: cursor });
            }
            cursor += 1;
        }

        const consumed = new Set<StatementLine>();
        for (let offset = 0; offset < header.span; offset += 1) consumed.add(lines[index + offset]!);

        if (header.kind === "GENERIC") {
            let last = lines[index + header.span - 1]!;
            let bodyIndex = index + header.span;

            for (; bodyIndex < lines.length; bodyIndex += 1) {
                const line = lines[bodyIndex]!;
                const sectionBreak = line.page !== last.page || (last.y - line.y >= line.cells[0]!.height * 2 && line.cells.length === 1);
                if (sectionBreak || headerAt(lines, bodyIndex, dates)) break;
                consumed.add(line);
                last = line;
            }

            tables.push({ kind: "GENERIC", columns: [], rows: [], headerOrder: lines[index]!.order, lastOrder: last.order, consumed });
            index = bodyIndex;
            continue;
        }

        const kept = keepContiguous(anchors, lines[index]!);

        // A row whose narration ran over the page break, under a repeated header.
        const previousTable = tables[tables.length - 1];
        if (header.kind === "LEDGER" && previousTable?.kind === "LEDGER" && previousTable.rows.length > 0) {
            const lastRow = previousTable.rows[previousTable.rows.length - 1]!;
            const firstAnchorOrder = kept[0]?.line.order ?? Infinity;
            let last = lines[index + header.span - 1]!;

            for (let body = index + header.span; body < lines.length; body += 1) {
                const line = lines[body]!;
                if (line.order >= firstAnchorOrder || line.page !== last.page || last.y - line.y >= line.cells[0]!.height * 2.5) break;
                const roles = line.cells.map(cell => nearestColumn(cell, header.columns).role);
                if (!roles.every(role => role === "description" || role === "txnType")) break;
                lastRow.cells.description = `${lastRow.cells.description ?? ""} ${line.cells.map(cell => cell.text).join(" ")}`.trim();
                consumed.add(line);
                last = line;
            }
        }

        const pitch = median(
            kept.slice(1).flatMap((a, i) => (a.line.page === kept[i]!.line.page ? [Math.abs(kept[i]!.line.y - a.line.y)] : [])),
            (lines[index]!.cells[0]!.height || 10) * 2
        );

        const rows = kept.map((anchor, position) => {
            const previous = kept[position - 1];
            const following = kept[position + 1];
            const y = anchor.line.y;
            // A row may print its first line a little above its figures, but
            // anything further up is the tail of the row before.
            const rise = (a: StatementLine) => a.cells[0]!.height * 1.2;
            const top = previous && previous.line.page === anchor.line.page ? Math.min((previous.line.y + y) / 2, y + rise(anchor.line)) : y + Math.min(pitch / 2, rise(anchor.line));
            const bottom = following && following.line.page === anchor.line.page ? Math.min((following.line.y + y) / 2, following.line.y + rise(following.line)) : y - rise(anchor.line);
            const band = lines.filter(line => line.page === anchor.line.page && line.y <= top && line.y > bottom && line.order > (lines[index + header.span - 1]!.order));

            // The last row on a page: its narration runs on for as long as
            // the lines stay close and hold only narration.
            if (!following || following.line.page !== anchor.line.page) {
                let last = band[band.length - 1] ?? anchor.line;
                for (const line of lines) {
                    if (line.order <= last.order || line.page !== anchor.line.page) continue;
                    const close = last.y - line.y <= line.cells[0]!.height * 1.6;
                    const narrationOnly = line.cells.every(cell => nearestColumn(cell, header.columns).role === "description" || anchor.line.cells.some(own => Math.abs(own.x - cell.x) <= 3));
                    if (!close || !narrationOnly || line.cells.length > 2) break;
                    band.push(line);
                    last = line;
                }
            }

            band.forEach(line => consumed.add(line));

            const row = readRow(band, anchor.line, header.columns, dateColumn, dates);

            // A row cut by a page break: its figures open the next page.
            if (row && header.kind === "LEDGER" && !MONEY_ROLES.some(role => row.cells[role]) && following && following.line.page !== anchor.line.page) {
                const followingTop = following.line.y + rise(following.line);
                const carried = lines.filter(line => line.page === following.line.page && line.order < following.line.order && line.y > followingTop);
                carried.forEach(line => consumed.add(line));

                return readRow([...band, ...carried], anchor.line, header.columns, dateColumn, dates);
            }

            return row;
        });

        const usable = rows.filter(row => row !== null) as TableRow[];

        if (usable.length > 0 || consumed.size > header.span) {
            tables.push({
                kind: header.kind,
                columns: header.columns.map(c => ({ role: c.role, x: c.x, right: c.right })),
                rows: usable,
                headerOrder: lines[index]!.order,
                lastOrder: Math.max(...[...consumed].map(line => line.order)),
                consumed,
            });
        } else {
            // A header with nothing under it is still not a set of labels.
            tables.push({ kind: header.kind, columns: [], rows: [], headerOrder: lines[index]!.order, lastOrder: lines[index]!.order, consumed });
        }

        index = kept.length > 0 ? kept[kept.length - 1]!.lineIndex + 1 : index + 1;
    }

    return tables;
}

/** Stops at the first anchor that is clearly no longer part of this table. */
function keepContiguous(
    anchors: Array<{ line: StatementLine; lineIndex: number }>,
    header: StatementLine
): Array<{ line: StatementLine; lineIndex: number }> {
    const kept: typeof anchors = [];
    const gaps: number[] = [];

    for (const anchor of anchors) {
        const previous = kept[kept.length - 1];
        const reference = previous?.line ?? header;

        if (reference.page === anchor.line.page) {
            const gap = reference.y - anchor.line.y;
            const typical = gaps.length > 0 ? median(gaps, gap) : gap;

            if (gaps.length >= 2 && gap > typical * 6) break;
            if (previous) gaps.push(gap);
        }

        kept.push(anchor);
    }

    return kept;
}

function readRow(
    band: readonly StatementLine[],
    anchorLine: StatementLine,
    columns: readonly HeaderCell[],
    dateColumn: HeaderCell | undefined,
    dates: DateContext
): TableRow | null {
    const parts: Partial<Record<ColumnRole, string[]>> = {};
    let date: string | null = null;

    const append = (role: ColumnRole, text: string) => {
        (parts[role] ??= []).push(text);
    };

    for (const line of band) {
        for (const cell of line.cells) {
            if (dateColumn && line === anchorLine && date === null && cell.x <= dateColumn.right + 4 && cellRight(cell) >= dateColumn.x - 4) {
                const parsed = parseDatePrefix(cell.text, dates);
                if (parsed) {
                    date = parsed.iso;
                    if (parsed.rest) append("description", parsed.rest);
                    continue;
                }
            }

            // A wrapped line starts where its own cell started on the row's first line.
            const sameStart = line === anchorLine ? undefined : anchorLine.cells.find(own => Math.abs(own.x - cell.x) <= 3);
            const column = nearestColumn(sameStart ?? cell, columns);
            if (column.role) append(column.role, cell.text);
        }
    }

    if (dateColumn && date === null) return null;

    const cells: TableRow["cells"] = {};
    if (parts.txnType) (parts.description ??= []).unshift(...parts.txnType);

    for (const [role, texts] of Object.entries(parts) as Array<[ColumnRole, string[]]>) {
        // A number wrapped mid-token joins without a space ("009900012" + "3").
        cells[role] = texts.reduce((joined, text) => (/\d$/.test(joined) && /^\d+$/.test(text) && role === "description" ? joined + text : `${joined} ${text}`.trim()), "");
    }

    return { page: anchorLine.page, order: anchorLine.order, date: date ?? "", cells };
}
