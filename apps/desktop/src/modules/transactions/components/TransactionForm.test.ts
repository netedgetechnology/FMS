import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import { todayLocalDate } from "./TransactionForm";

describe("todayLocalDate", () => {
    const originalTz = process.env.TZ;

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        process.env.TZ = originalTz;
    });

    it("1. returns the local calendar date, not the UTC date - the reported bug (18-09-2026 shown instead of 19-09-2026 in IST)", () => {
        process.env.TZ = "Asia/Kolkata";

        // 2026-09-18 20:00 UTC is already 2026-09-19 01:30 IST (UTC+5:30) -
        // `new Date().toISOString().slice(0, 10)` (the old, buggy
        // implementation) would read this as "2026-09-18".
        vi.setSystemTime(new Date("2026-09-18T20:00:00.000Z"));

        expect(todayLocalDate()).toBe("2026-09-19");
    });

    it("2. matches the UTC date too when local and UTC calendar days agree", () => {
        process.env.TZ = "UTC";

        vi.setSystemTime(new Date("2026-09-19T12:00:00.000Z"));

        expect(todayLocalDate()).toBe("2026-09-19");
    });

    it("3. handles a negative UTC offset the same way (date shouldn't roll forward either)", () => {
        process.env.TZ = "America/Los_Angeles";

        // 2026-09-19 02:00 UTC is still 2026-09-18 19:00 PDT (UTC-7).
        vi.setSystemTime(new Date("2026-09-19T02:00:00.000Z"));

        expect(todayLocalDate()).toBe("2026-09-18");
    });

    it("4. always returns YYYY-MM-DD, zero-padded", () => {
        process.env.TZ = "UTC";

        vi.setSystemTime(new Date("2026-01-05T00:00:00.000Z"));

        expect(todayLocalDate()).toBe("2026-01-05");
    });
});
