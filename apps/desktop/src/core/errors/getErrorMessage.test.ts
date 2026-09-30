import { describe, expect, it } from "vitest";

import { getErrorMessage } from "./getErrorMessage";

describe("getErrorMessage", () => {
    it("returns the message of a real Error instance", () => {
        expect(
            getErrorMessage(
                new Error("This loan has recorded payments and can't be deleted."),
                "fallback"
            )
        ).toBe("This loan has recorded payments and can't be deleted.");
    });

    it("returns a plain string error as-is (Tauri invoke()/plugin-sql rejection shape)", () => {
        expect(
            getErrorMessage(
                "error returned from database: (code: 1) no such column: foo",
                "fallback"
            )
        ).toBe("error returned from database: (code: 1) no such column: foo");
    });

    it("translates a SQLite lock error into a friendly, actionable message", () => {
        expect(
            getErrorMessage(
                "error returned from database: (code: 5) database is locked",
                "fallback"
            )
        ).toMatch(/another window/i);
    });

    it("falls back for a value with no usable message", () => {
        expect(getErrorMessage({}, "fallback")).toBe("fallback");
        expect(getErrorMessage(null, "fallback")).toBe("fallback");
        expect(getErrorMessage(undefined, "fallback")).toBe("fallback");
        expect(getErrorMessage("", "fallback")).toBe("fallback");
    });
});
