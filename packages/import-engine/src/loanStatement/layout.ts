// Positioned text: the only thing the engine reads. A PDF and a plain-text
// fixture both become the same pages of lines of cells, so nothing later
// depends on a page number, a table position or how a file was produced.

export interface RawTextItem {
    x: number;
    /** PDF convention: larger is higher on the page. */
    y: number;
    width: number;
    height: number;
    text: string;
}

export interface StatementCell {
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    /** Reading-order position of the cell's line across the whole document. */
    order: number;
}

export interface StatementLine {
    page: number;
    y: number;
    order: number;
    cells: StatementCell[];
}

export interface StatementDocument {
    pageCount: number;
    lines: StatementLine[];
    /** Pages with an image but no text (a scan). */
    imageOnlyPages?: number[];
}

const SAME_LINE_TOLERANCE = 2.5;
/** Items closer than this share of the text height belong to one cell. */
const SAME_CELL_GAP = 0.35;

export function cellRight(cell: { x: number; width: number }): number {
    return cell.x + cell.width;
}

export function documentFromItems(pages: readonly (readonly RawTextItem[])[]): StatementDocument {
    const lines: StatementLine[] = [];
    let order = 0;

    pages.forEach((items, pageIndex) => {
        const page = pageIndex + 1;
        const visible = items
            .filter(item => item.text.trim() !== "")
            .slice()
            .sort((a, b) => b.y - a.y || a.x - b.x);

        const rows: RawTextItem[][] = [];
        for (const item of visible) {
            const row = rows[rows.length - 1];
            if (row && Math.abs(row[0]!.y - item.y) <= SAME_LINE_TOLERANCE) row.push(item);
            else rows.push([item]);
        }

        for (const row of rows) {
            row.sort((a, b) => a.x - b.x);
            const cells: StatementCell[] = [];

            for (const item of row) {
                const last = cells[cells.length - 1];
                const lineHeight = Math.max(item.height, 8);

                if (last && item.x - cellRight(last) <= lineHeight * SAME_CELL_GAP) {
                    const gap = item.x - cellRight(last);
                    last.text = `${last.text}${gap > 0.5 ? " " : ""}${item.text.trim()}`;
                    last.width = cellRight(item) - last.x;
                } else {
                    cells.push({
                        page,
                        x: item.x,
                        y: row[0]!.y,
                        width: item.width,
                        height: lineHeight,
                        text: item.text.trim(),
                        order,
                    });
                }
            }

            lines.push({ page, y: row[0]!.y, order, cells });
            order += 1;
        }
    });

    return { pageCount: pages.length, lines };
}

const CHAR_WIDTH = 5;
const LINE_PITCH = 10;

/**
 * Fixed-width text as positioned items: a run of two or more spaces (or a
 * tab) separates cells, form feeds separate pages. Used by test fixtures
 * and for any source that only offers text.
 */
export function itemsFromLayoutText(text: string): RawTextItem[][] {
    return text.split("\f").map(pageText =>
        pageText.split(/\r?\n/).flatMap((line, lineIndex) => {
            const items: RawTextItem[] = [];
            const pattern = /\S+(?: \S+)*/g;
            const expanded = line.replace(/\t/g, "    ");
            let match: RegExpExecArray | null;

            while ((match = pattern.exec(expanded)) !== null) {
                items.push({
                    x: match.index * CHAR_WIDTH,
                    y: 10000 - lineIndex * LINE_PITCH,
                    width: match[0].length * CHAR_WIDTH,
                    height: LINE_PITCH,
                    text: match[0],
                });
            }

            return items;
        })
    );
}

export function documentFromLayoutText(text: string): StatementDocument {
    return documentFromItems(itemsFromLayoutText(text));
}

export function normaliseLabel(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9%]+/g, " ")
        .trim();
}
