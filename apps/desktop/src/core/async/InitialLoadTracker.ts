import { toast } from "sonner";

/**
 * Decides when a data load may show the page-wide loading state.
 *
 * Only the FIRST load of a list shows it - there is nothing to show yet.
 * Every later load (the refresh after a create, edit, delete, link ...)
 * runs in the background: the current rows stay on screen and are
 * replaced when the new data arrives, so the page never blanks to a
 * "Loading..." placeholder, and its search, filters, page, selection and
 * scroll position are never lost.
 *
 * Likewise a failed background refresh never replaces the rows already
 * shown with an error message: they stay, and the failure is reported
 * (reportBackgroundRefreshFailure). Only a failed first load - with
 * nothing to show - shows the error in place of the content.
 *
 * Used beside LatestRequestGuard, in the same useRef style:
 *
 *   const loadTracker = useRef(new InitialLoadTracker());
 *   if (loadTracker.current.showsLoading()) setLoading(true);
 *   ...on success:  loadTracker.current.markLoaded();
 *   ...on failure:  loadTracker.current.hasLoaded
 *                       ? reportBackgroundRefreshFailure("accounts", err)
 *                       : setError(message);
 */
export class InitialLoadTracker {
    private loaded = false;

    /** Whether a load starting now should show the page-wide loading state. */
    showsLoading(): boolean {
        return !this.loaded;
    }

    /** Records that data has been shown at least once. */
    markLoaded(): void {
        this.loaded = true;
    }

    /** Whether data has been shown at least once. */
    get hasLoaded(): boolean {
        return this.loaded;
    }
}

/** The message shown when a background refresh fails. */
export function backgroundRefreshFailureMessage(what: string): string {
    return `Couldn't refresh ${what}. Showing the last loaded data - try again in a moment.`;
}

/**
 * A background refresh failed while older data is on screen: keep it,
 * log the cause and tell the user the view may be out of date.
 */
export function reportBackgroundRefreshFailure(
    what: string,
    error: unknown
): void {
    console.error(`Failed to refresh ${what}:`, error);
    toast.error(backgroundRefreshFailureMessage(what));
}
