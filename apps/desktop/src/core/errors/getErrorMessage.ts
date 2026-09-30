/**
 * Extracts a user-facing message from a caught value.
 *
 * Every Tauri `invoke()` call - including each `@tauri-apps/plugin-sql`
 * execute()/select() - rejects with a plain string when the Rust side
 * returns `Err(...)`, never an `Error` instance (see tauri-plugin-sql's
 * `Error` type, which serializes itself with `serialize_str`). A bare
 * `error instanceof Error` check therefore silently discards the real
 * reason for every SQL/Tauri failure and always falls back to a generic
 * message, while only errors thrown directly in TS (e.g. a business-rule
 * guard's `throw new Error(...)`) get through. This normalizes both
 * shapes so the real cause reaches the user instead of just the console.
 */
export function getErrorMessage(
    error: unknown,
    fallback: string
): string {
    const raw =
        error instanceof Error
            ? error.message
            : typeof error === "string"
                ? error
                : null;

    if (!raw) {
        return fallback;
    }

    // SQLite allows only one writer at a time. This is what a second
    // process holding the same database file (e.g. another copy of the
    // app already open) surfaces as once the 5s busy-timeout is
    // exhausted - worth naming explicitly rather than showing the raw
    // sqlx error text.
    if (/database is locked|database table is locked/i.test(raw)) {
        return "The database is busy right now - another window of this app may already have it open. Close any other open copies and try again.";
    }

    return raw;
}
