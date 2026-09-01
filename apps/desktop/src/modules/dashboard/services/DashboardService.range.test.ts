import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import {
    DEFAULT_DASHBOARD_RANGE_DAYS,
    MAX_DASHBOARD_RANGE_DAYS,
    rangeFromDays,
} from "./DashboardService";

describe("rangeFromDays", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const freezeAt = (iso: string) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(iso));
    };

    it("defaults to the last 30 calendar days ending today", () => {
        freezeAt("2026-09-01T10:30:00");

        expect(rangeFromDays()).toEqual({
            start: "2026-08-03",
            end: "2026-09-01",
        });

        expect(DEFAULT_DASHBOARD_RANGE_DAYS).toBe(30);
    });

    it("treats 1 day as today only", () => {
        freezeAt("2026-09-01T00:00:00");

        expect(rangeFromDays(1)).toEqual({
            start: "2026-09-01",
            end: "2026-09-01",
        });
    });

    it("supports arbitrary custom day counts", () => {
        freezeAt("2026-09-01T00:00:00");

        expect(rangeFromDays(7).start).toBe("2026-08-26");
        expect(rangeFromDays(365).start).toBe("2025-09-02");
    });

    it("crosses month and year boundaries correctly", () => {
        freezeAt("2026-01-05T12:00:00");

        expect(rangeFromDays(10)).toEqual({
            start: "2025-12-27",
            end: "2026-01-05",
        });
    });

    it("falls back to the default for invalid input", () => {
        freezeAt("2026-09-01T00:00:00");

        expect(rangeFromDays(0).start).toBe("2026-08-03");
        expect(rangeFromDays(-5).start).toBe("2026-08-03");
        expect(rangeFromDays(Number.NaN).start).toBe("2026-08-03");
    });

    it("clamps very large ranges to the maximum", () => {
        freezeAt("2026-09-01T00:00:00");

        const clamped = rangeFromDays(9_999_999);
        const atMax = rangeFromDays(MAX_DASHBOARD_RANGE_DAYS);

        expect(clamped).toEqual(atMax);
    });
});
