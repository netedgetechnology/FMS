/**
 * Tracks which async "refresh" call is the most recent one issued, so a
 * slower, still in-flight call started earlier can never overwrite state
 * with data that has already been superseded.
 *
 * Concretely: a list page's initial load can be slowed down by database
 * contention (e.g. the automatic daily backup's `VACUUM INTO` - see
 * dailyDatabaseBackup.ts) while the user deletes a record, which triggers
 * its own, faster refresh. Without this guard, whichever fetch happens to
 * *resolve* last wins the `setState` call regardless of which one was
 * started last - so the slow, stale fetch can land after the fast one and
 * silently bring the just-deleted record back into the list.
 */
export class LatestRequestGuard {
    private latestId = 0;

    /** Call at the start of an async operation; keep the returned id. */
    start(): number {
        this.latestId += 1;

        return this.latestId;
    }

    /** True once a later call to `start()` has superseded `id`. */
    isStale(id: number): boolean {
        return id !== this.latestId;
    }
}
