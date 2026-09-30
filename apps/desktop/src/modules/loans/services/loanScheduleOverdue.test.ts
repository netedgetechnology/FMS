import { describe, expect, it } from "vitest";

import {
    isScheduleOverdue,
    scheduleDaysOverdue,
} from "./loanScheduleOverdue";

// Fixed "today" for deterministic tests - local midday, well clear of
// any UTC calendar-date boundary.
const ASOF = new Date(2026, 5, 30, 12, 0, 0); // 30 Jun 2026, local time

function daysAgoDate(days: number): string {
    const date = new Date(ASOF);
    date.setDate(date.getDate() - days);

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
    ].join("-");
}

describe("isScheduleOverdue", () => {
    it("is true for an UPCOMING row with a past due date", () => {
        expect(
            isScheduleOverdue(
                {
                    dueDate: daysAgoDate(1),
                    status: "UPCOMING",
                },
                ASOF
            )
        ).toBe(true);
    });

    it("is false for an UPCOMING row due exactly today", () => {
        expect(
            isScheduleOverdue(
                {
                    dueDate: daysAgoDate(0),
                    status: "UPCOMING",
                },
                ASOF
            )
        ).toBe(false);
    });

    it("is false for an UPCOMING row with a future due date", () => {
        expect(
            isScheduleOverdue(
                {
                    dueDate: daysAgoDate(-5),
                    status: "UPCOMING",
                },
                ASOF
            )
        ).toBe(false);
    });

    it("is true for a PARTIAL row with a past due date", () => {
        expect(
            isScheduleOverdue(
                {
                    dueDate: daysAgoDate(3),
                    status: "PARTIAL",
                },
                ASOF
            )
        ).toBe(true);
    });

    it("is false for a PARTIAL row due exactly today", () => {
        expect(
            isScheduleOverdue(
                {
                    dueDate: daysAgoDate(0),
                    status: "PARTIAL",
                },
                ASOF
            )
        ).toBe(false);
    });

    it("is false for a PAID row with a past due date - a settled row is never overdue", () => {
        expect(
            isScheduleOverdue(
                {
                    dueDate: daysAgoDate(90),
                    status: "PAID",
                },
                ASOF
            )
        ).toBe(false);
    });

    it("counts by local calendar day, not by 24-hour chunks of elapsed time", () => {
        // 2 minutes apart in real time, but on two different calendar
        // days local to this test's fixed asOf - must count as
        // overdue by 1 day, not 0.
        const asOf = new Date(2026, 5, 2, 0, 1, 0); // 2 Jun 2026, 00:01 local
        const dueLateThePreviousDay = "2026-06-01";

        expect(
            isScheduleOverdue(
                {
                    dueDate: dueLateThePreviousDay,
                    status: "UPCOMING",
                },
                asOf
            )
        ).toBe(true);

        // Due date is the same local calendar day as asOf - not
        // overdue, even though asOf is only one minute past midnight.
        const dueSameDay = "2026-06-02";

        expect(
            isScheduleOverdue(
                {
                    dueDate: dueSameDay,
                    status: "UPCOMING",
                },
                asOf
            )
        ).toBe(false);
    });

    it("defaults asOf to now when omitted", () => {
        const farFuture = new Date();
        farFuture.setFullYear(farFuture.getFullYear() + 5);

        const future = [
            farFuture.getFullYear(),
            String(farFuture.getMonth() + 1).padStart(
                2,
                "0"
            ),
            String(farFuture.getDate()).padStart(2, "0"),
        ].join("-");

        expect(
            isScheduleOverdue({
                dueDate: future,
                status: "UPCOMING",
            })
        ).toBe(false);
    });
});

describe("scheduleDaysOverdue", () => {
    it("is 0 for a row that is not overdue", () => {
        expect(
            scheduleDaysOverdue(
                {
                    dueDate: daysAgoDate(0),
                    status: "UPCOMING",
                },
                ASOF
            )
        ).toBe(0);
    });

    it("is 0 for a PAID row regardless of due date", () => {
        expect(
            scheduleDaysOverdue(
                {
                    dueDate: daysAgoDate(30),
                    status: "PAID",
                },
                ASOF
            )
        ).toBe(0);
    });

    it("counts the exact number of whole calendar days overdue", () => {
        expect(
            scheduleDaysOverdue(
                {
                    dueDate: daysAgoDate(5),
                    status: "UPCOMING",
                },
                ASOF
            )
        ).toBe(5);

        expect(
            scheduleDaysOverdue(
                {
                    dueDate: daysAgoDate(1),
                    status: "PARTIAL",
                },
                ASOF
            )
        ).toBe(1);
    });
});
