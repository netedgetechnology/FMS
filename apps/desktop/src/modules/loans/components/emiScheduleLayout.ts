// ---------------------------------------------------------------------
// EMI Schedule dialog width: sized to the schedule table's own natural
// (unwrapped, max-content) width - never a fixed width and never a
// horizontal scrollbar. The dialog grows to fit every column up to the
// viewport (minus a margin on each side); when even that is too narrow,
// the table switches to a compact density (tighter cell padding, slightly
// smaller text) instead of scrolling or hiding columns.
// ---------------------------------------------------------------------

// The dialog's own horizontal chrome around the table: px-7 on both sides
// of the scroll area (2 x 28px) plus the dialog's 1px border on each side.
export const EMI_DIALOG_HORIZONTAL_CHROME_PX = 58;

// Gap kept between the dialog and each edge of the window.
export const EMI_DIALOG_SCREEN_MARGIN_PX = 24;

// The dialog never shrinks below this (header, summary cards and the
// payment form stay comfortable even for a short table).
export const EMI_DIALOG_MIN_WIDTH_PX = 760;

export interface EmiDialogLayout {
    /** Dialog width in px. */
    width: number;
    /** True when the whole table fits at this width. */
    fits: boolean;
}

// `scrollbarWidth`: the vertical scrollbar the schedule list shows when it
// has more rows than fit (it takes width from the content area, so the
// dialog must be that much wider for the table to keep its full width).
export function emiDialogLayout(
    naturalTableWidth: number,
    viewportWidth: number,
    scrollbarWidth = 0
): EmiDialogLayout {
    const available = Math.max(
        0,
        viewportWidth - 2 * EMI_DIALOG_SCREEN_MARGIN_PX
    );

    const needed =
        Math.ceil(naturalTableWidth) +
        EMI_DIALOG_HORIZONTAL_CHROME_PX +
        Math.max(0, Math.ceil(scrollbarWidth));

    return {
        width: Math.min(
            Math.max(needed, EMI_DIALOG_MIN_WIDTH_PX),
            available
        ),
        fits: needed <= available,
    };
}

// The table's natural width: what it occupies with no width constraint,
// every cell on one line. Measured by laying it out at max-content
// momentarily (synchronously, so nothing ever paints at that width).
export function measureNaturalTableWidth(
    table: HTMLTableElement
): number {
    const previous = table.style.width;

    table.style.width = "max-content";
    const natural = table.getBoundingClientRect().width;
    table.style.width = previous;

    return natural;
}
