import { describe, expect, it } from "vitest";

import { computeEmiDueInfo } from "./DashboardService";

// Fixed "today" for deterministic tests - local midday, well clear of
// any UTC calendar-date boundary.
const ASOF = new Date(2026, 5, 30, 12, 0, 0); // 30 Jun 2026, local time

function daysFromAsOf(days: number): string {
    const date = new Date(ASOF);
    date.setDate(date.getDate() + days);

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
    ].join("-");
}

describe("computeEmiDueInfo", () => {
    it("marks a past-due unpaid (UPCOMING) schedule as overdue, with days overdue and dueIn at 0", () => {
        const result = computeEmiDueInfo(
            { dueDate: daysFromAsOf(-4), status: "UPCOMING" },
            ASOF
        );

        expect(result.isOverdue).toBe(true);
        expect(result.daysOverdue).toBe(4);
        expect(result.dueIn).toBe(0);
    });

    it("marks a past-due PARTIAL schedule as overdue too", () => {
        const result = computeEmiDueInfo(
            { dueDate: daysFromAsOf(-1), status: "PARTIAL" },
            ASOF
        );

        expect(result.isOverdue).toBe(true);
        expect(result.daysOverdue).toBe(1);
    });

    it("never marks a PAID schedule as overdue, even with a past due date", () => {
        const result = computeEmiDueInfo(
            { dueDate: daysFromAsOf(-30), status: "PAID" },
            ASOF
        );

        expect(result.isOverdue).toBe(false);
        expect(result.daysOverdue).toBe(0);
    });

    it("keeps a future schedule as upcoming with the correct dueIn count, not overdue", () => {
        const result = computeEmiDueInfo(
            { dueDate: daysFromAsOf(7), status: "UPCOMING" },
            ASOF
        );

        expect(result.isOverdue).toBe(false);
        expect(result.daysOverdue).toBe(0);
        expect(result.dueIn).toBe(7);
    });

    it("treats a schedule due exactly today as upcoming (dueIn 0), not overdue", () => {
        const result = computeEmiDueInfo(
            { dueDate: daysFromAsOf(0), status: "UPCOMING" },
            ASOF
        );

        expect(result.isOverdue).toBe(false);
        expect(result.dueIn).toBe(0);
    });

    it("never produces a negative dueIn - no clamping regression for future rows", () => {
        const result = computeEmiDueInfo(
            { dueDate: daysFromAsOf(1), status: "UPCOMING" },
            ASOF
        );

        expect(result.dueIn).toBeGreaterThanOrEqual(0);
        expect(result.dueIn).toBe(1);
    });

    it("never produces a negative daysOverdue for a non-overdue row", () => {
        const result = computeEmiDueInfo(
            { dueDate: daysFromAsOf(15), status: "UPCOMING" },
            ASOF
        );

        expect(result.daysOverdue).toBe(0);
    });
});
