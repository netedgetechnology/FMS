import { describe, expect, it } from "vitest";

import {
    addMonths,
    currentMonth,
    formatMonthLabel,
    isSameMonth,
} from "@/core/formatting";

import type { Budget } from "../types";

import {
    budgetAppliesToMonth,
    selectBudgetsForMonth,
} from "../services";

function budget(
    overrides: Partial<Budget> = {}
): Budget {
    return {
        id: "budget-1",
        name: "Groceries",
        categoryId: "cat-groceries",
        businessEntityId: null,
        amount: 10000,
        periodType: "MONTHLY",
        startDate: "2026-09-01",
        endDate: null,
        currencyId: "INR",
        alertThreshold: 80,
        isActive: true,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        ...overrides,
    };
}

const september2026 = new Date(2026, 8, 1);
const august2026 = new Date(2026, 7, 1);
const october2026 = new Date(2026, 9, 1);
const january2027 = new Date(2027, 0, 1);

describe("BudgetsPage - month navigation", () => {
    it("defaults the selected month to the current calendar month", () => {
        const initial = currentMonth();

        expect(isSameMonth(initial, new Date())).toBe(
            true
        );
        expect(initial.getDate()).toBe(1);
    });

    it("Previous Month steps back one calendar month", () => {
        const previous = addMonths(september2026, -1);

        expect(formatMonthLabel(previous)).toBe(
            "August 2026"
        );
    });

    it("Next Month steps forward one calendar month", () => {
        const next = addMonths(september2026, 1);

        expect(formatMonthLabel(next)).toBe(
            "October 2026"
        );
    });

    it("Current Month returns to today's calendar month from anywhere", () => {
        const wandered = addMonths(september2026, -14);

        expect(
            isSameMonth(wandered, currentMonth())
        ).toBe(false);

        expect(
            isSameMonth(currentMonth(), new Date())
        ).toBe(true);
    });
});

describe("budgetAppliesToMonth - monthly budget contract", () => {
    it("applies to the calendar month its startDate falls in", () => {
        const b = budget({ startDate: "2026-09-15" });

        expect(budgetAppliesToMonth(b, september2026)).toBe(
            true
        );
    });

    it("applies to every month after its startDate when endDate is open", () => {
        const b = budget({
            startDate: "2026-09-01",
            endDate: null,
        });

        expect(budgetAppliesToMonth(b, october2026)).toBe(
            true
        );
        expect(budgetAppliesToMonth(b, january2027)).toBe(
            true
        );
    });

    it("is excluded from months entirely before its startDate", () => {
        const b = budget({ startDate: "2026-09-15" });

        expect(budgetAppliesToMonth(b, august2026)).toBe(
            false
        );
    });

    it("is excluded from months entirely after its endDate", () => {
        const b = budget({
            startDate: "2026-09-01",
            endDate: "2026-09-30",
        });

        expect(budgetAppliesToMonth(b, october2026)).toBe(
            false
        );
    });

    it("includes the endDate boundary month itself", () => {
        const endsMidOctober = budget({
            startDate: "2026-09-01",
            endDate: "2026-10-15",
        });

        expect(
            budgetAppliesToMonth(endsMidOctober, october2026)
        ).toBe(true);
        expect(
            budgetAppliesToMonth(endsMidOctober, september2026)
        ).toBe(true);
        expect(
            budgetAppliesToMonth(endsMidOctober, new Date(2026, 10, 1))
        ).toBe(false);
    });

    it("includes the startDate boundary month even when startDate is the last day", () => {
        const b = budget({ startDate: "2026-09-30" });

        expect(budgetAppliesToMonth(b, september2026)).toBe(
            true
        );
        expect(budgetAppliesToMonth(b, august2026)).toBe(
            false
        );
    });

    it("treats a blank endDate the same as an open-ended one", () => {
        const b = budget({
            startDate: "2026-09-01",
            endDate: "" as unknown as null,
        });

        expect(budgetAppliesToMonth(b, january2027)).toBe(
            true
        );
    });

    it("does not redesign QUARTERLY/YEARLY/CUSTOM - they use the same overlap check", () => {
        const yearly = budget({
            periodType: "YEARLY",
            startDate: "2026-01-01",
            endDate: null,
        });

        const custom = budget({
            periodType: "CUSTOM",
            startDate: "2026-09-10",
            endDate: "2026-11-20",
        });

        expect(budgetAppliesToMonth(yearly, september2026)).toBe(
            true
        );
        expect(budgetAppliesToMonth(custom, october2026)).toBe(
            true
        );
        expect(
            budgetAppliesToMonth(custom, new Date(2026, 11, 1))
        ).toBe(false);
    });
});

describe("selectBudgetsForMonth - multiple budgets across different months", () => {
    const budgets: Budget[] = [
        budget({
            id: "sept-only",
            name: "September only",
            startDate: "2026-09-01",
            endDate: "2026-09-30",
        }),
        budget({
            id: "from-october",
            name: "Starts October",
            startDate: "2026-10-01",
            endDate: null,
        }),
        budget({
            id: "ongoing",
            name: "Ongoing since August",
            startDate: "2026-08-01",
            endDate: null,
        }),
        budget({
            id: "ended-july",
            name: "Ended July",
            startDate: "2026-01-01",
            endDate: "2026-07-31",
        }),
    ];

    it("returns only the budgets applicable to September 2026", () => {
        const result = selectBudgetsForMonth(
            budgets,
            september2026
        );

        expect(result.map(b => b.id).sort()).toEqual([
            "ongoing",
            "sept-only",
        ]);
    });

    it("returns only the budgets applicable to October 2026", () => {
        const result = selectBudgetsForMonth(
            budgets,
            october2026
        );

        expect(result.map(b => b.id).sort()).toEqual([
            "from-october",
            "ongoing",
        ]);
    });

    it("returns none for a month before every budget started", () => {
        const result = selectBudgetsForMonth(
            budgets,
            new Date(2025, 11, 1)
        );

        expect(result).toEqual([]);
    });

    it("preserves the input ordering of the budgets it keeps", () => {
        const result = selectBudgetsForMonth(
            budgets,
            september2026
        );

        expect(result.map(b => b.id)).toEqual([
            "sept-only",
            "ongoing",
        ]);
    });
});
