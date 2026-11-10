import { describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

import {
    InitialLoadTracker,
    backgroundRefreshFailureMessage,
    reportBackgroundRefreshFailure,
} from "./InitialLoadTracker";

describe("InitialLoadTracker", () => {
    it("shows the page-wide loading state for the first load only", () => {
        const tracker = new InitialLoadTracker();

        expect(tracker.showsLoading()).toBe(true);
        expect(tracker.hasLoaded).toBe(false);

        tracker.markLoaded();

        // Every refresh after a mutation keeps the content on screen.
        expect(tracker.showsLoading()).toBe(false);
        expect(tracker.hasLoaded).toBe(true);
        expect(tracker.showsLoading()).toBe(false);
    });

    it("keeps showing the loading state while the first load keeps failing", () => {
        const tracker = new InitialLoadTracker();

        tracker.showsLoading();
        // failed - markLoaded never called

        expect(tracker.showsLoading()).toBe(true);
        expect(tracker.hasLoaded).toBe(false);
    });
});

describe("reportBackgroundRefreshFailure", () => {
    it("tells the user the data shown may be out of date and logs the cause", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const cause = new Error("database is locked");

        reportBackgroundRefreshFailure("transactions", cause);

        expect(toastError).toHaveBeenCalledWith(backgroundRefreshFailureMessage("transactions"));
        expect(backgroundRefreshFailureMessage("transactions")).toContain("Showing the last loaded data");
        expect(consoleError).toHaveBeenCalledWith("Failed to refresh transactions:", cause);

        consoleError.mockRestore();
    });
});
