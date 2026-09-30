import { describe, expect, it } from "vitest";

import { LatestRequestGuard } from "./LatestRequestGuard";

describe("LatestRequestGuard", () => {
    it("treats the only in-flight request as current", () => {
        const guard = new LatestRequestGuard();

        const id = guard.start();

        expect(guard.isStale(id)).toBe(false);
    });

    it("marks an earlier request stale once a newer one has started", () => {
        const guard = new LatestRequestGuard();

        const first = guard.start();
        const second = guard.start();

        expect(guard.isStale(first)).toBe(true);
        expect(guard.isStale(second)).toBe(false);
    });

    it("keeps only the latest of several overlapping requests current", () => {
        const guard = new LatestRequestGuard();

        const first = guard.start();
        const second = guard.start();
        const third = guard.start();

        expect(guard.isStale(first)).toBe(true);
        expect(guard.isStale(second)).toBe(true);
        expect(guard.isStale(third)).toBe(false);
    });

    it("models the reappearing-record race: a slow stale fetch must not win over a faster newer one", () => {
        const guard = new LatestRequestGuard();

        // Page mounts: initial load starts (slow - contends with the
        // automatic backup).
        const initialLoad = guard.start();

        // User deletes a record before the initial load resolves; the
        // resulting refresh starts (and, in the real bug, finishes first).
        const postDeleteRefresh = guard.start();

        // The refresh triggered by the delete resolves first and applies
        // its data.
        expect(guard.isStale(postDeleteRefresh)).toBe(false);

        // The slow initial load finally resolves afterwards - it must be
        // recognised as stale so its (pre-delete) data is discarded
        // instead of overwriting the correct, post-delete list.
        expect(guard.isStale(initialLoad)).toBe(true);
    });
});
