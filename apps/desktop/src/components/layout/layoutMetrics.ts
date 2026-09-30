// ---------------------------------------------------------------------
// Shared application-shell measurements (AppLayout).
//
// These mirror the literal Tailwind sizes the shell components use -
// AppSidebar's `w-[220px]` and AppHeader's `h-16` - and
// layoutMetrics.test.ts fails if either drifts, so anything positioned
// against the shell (e.g. the global toast area) stays aligned.
// ---------------------------------------------------------------------

/** AppSidebar: fixed `w-[220px]` column on the left of every page. */
export const APP_SIDEBAR_WIDTH_PX = 220;

/** AppHeader: fixed `h-16` bar across the top of the content column. */
export const APP_HEADER_HEIGHT_PX = 64;

/**
 * Height of a single-line sonner toast as FinanceOS styles it: 16px
 * padding top and bottom, a 13px/~20px title line, and a 1px border.
 */
export const TOAST_SINGLE_LINE_HEIGHT_PX = 54;

export interface ToasterPlacement {
    /** sonner `offset.top`: distance from the top of the window. */
    top: string;
    /**
     * How far right of the window's centre the toast column is centred,
     * so it sits over the content column (right of the sidebar) rather
     * than the whole window.
     */
    centerShift: string;
}

// The global toast area: TOP CENTER of the content column, inside the
// AppHeader bar's empty centre - vertically centred in the 64px bar -
// so toasts never sit over page titles, subtitles or page header
// actions (all of which start below the header), and never over the
// sidebar navigation or the header's own icons on the right.
export function getToasterPlacement(): ToasterPlacement {
    const top = Math.max(
        4,
        Math.round(
            (APP_HEADER_HEIGHT_PX - TOAST_SINGLE_LINE_HEIGHT_PX) / 2
        )
    );

    return {
        top: `${top}px`,
        centerShift: `${APP_SIDEBAR_WIDTH_PX / 2}px`,
    };
}
