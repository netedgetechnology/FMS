import { describe, expect, it } from "vitest";

import { financialPlanSchema } from "./financialPlanSchema";

// Mirrors FinancialPlanForm.tsx's own defaults (ACCUMULATION doesn't
// require a target amount, so the "complete" and "optional fields
// omitted" cases both validate without one).
const baseInput = {
    name: "Retirement Corpus",
    planType: "ACCUMULATION",
    planCategory: "CORE_PERSONAL_FINANCE",
    planSubcategory: "SAVINGS",
    periodType: "MONTHLY",
    startDate: "2026-09-01",
    endDate: "",
    currencyId: "currency-inr",
    targetAmount: null,
    goalId: "",
    notes: "",
    status: "ACTIVE",
};

function issuePaths(
    result: ReturnType<
        typeof financialPlanSchema.safeParse
    >
): string[] {
    return result.success
        ? []
        : result.error.issues.map(issue =>
              issue.path.join(".")
          );
}

describe("financialPlanSchema — valid submissions", () => {
    it("accepts a fully-populated financial plan", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            endDate: "2027-09-01",
            targetAmount: 5000000,
            goalId: "goal-1",
            notes: "Some notes.",
        });

        expect(result.success).toBe(true);
    });

    it("accepts a plan with every optional field omitted", () => {
        const {
            endDate: _endDate,
            targetAmount: _targetAmount,
            goalId: _goalId,
            notes: _notes,
            ...withoutOptionalFields
        } = baseInput;
        void _endDate;
        void _targetAmount;
        void _goalId;
        void _notes;

        const result = financialPlanSchema.safeParse(
            withoutOptionalFields
        );

        expect(result.success).toBe(true);
    });

    it("accepts a target amount of exactly zero", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            targetAmount: 0,
        });

        expect(result.success).toBe(true);
    });

    it("accepts a valid end date on/after the start date", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            startDate: "2026-09-01",
            endDate: "2026-12-31",
        });

        expect(result.success).toBe(true);
    });
});

describe("financialPlanSchema — required fields", () => {
    it("rejects a blank plan name", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            name: "",
        });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain("name");
    });

    it("trims and rejects a whitespace-only plan name", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            name: "   ",
        });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain("name");
    });

    it("trims leading/trailing whitespace from an otherwise valid name", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            name: "  Retirement Corpus  ",
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.name).toBe(
                "Retirement Corpus"
            );
        }
    });

    it("rejects a missing/invalid plan type", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            planType: "",
        });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain(
            "planType"
        );
    });

    it("rejects a missing/invalid review period", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            periodType: "",
        });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain(
            "periodType"
        );
    });

    it("rejects a missing/invalid category", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            planCategory: "",
        });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain(
            "planCategory"
        );
    });

    it("rejects a missing/invalid focus", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            planSubcategory: "",
        });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain(
            "planSubcategory"
        );
    });

    it("rejects a missing/invalid status", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            status: "",
        });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain("status");
    });

    it("rejects a missing/invalid currency", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            currencyId: "",
        });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain(
            "currencyId"
        );
    });

    it("rejects a missing start date", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            startDate: "",
        });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain(
            "startDate"
        );
    });

    it("rejects a malformed start date", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            startDate: "not-a-date",
        });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain(
            "startDate"
        );
    });

    it("rejects every required field missing at once", () => {
        const result = financialPlanSchema.safeParse({
            name: "",
            planType: "",
            planCategory: "",
            planSubcategory: "",
            periodType: "",
            startDate: "",
            endDate: "",
            currencyId: "",
            targetAmount: null,
            goalId: "",
            notes: "",
            status: "",
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            const paths = new Set(
                issuePaths(result)
            );

            expect(paths.has("name")).toBe(true);
            expect(paths.has("planType")).toBe(true);
            expect(paths.has("periodType")).toBe(true);
            expect(paths.has("planCategory")).toBe(
                true
            );
            expect(paths.has("planSubcategory")).toBe(
                true
            );
            expect(paths.has("status")).toBe(true);
            expect(paths.has("currencyId")).toBe(true);
            expect(paths.has("startDate")).toBe(true);
        }
    });
});

describe("financialPlanSchema — optional field rules", () => {
    it("rejects a negative target amount", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            targetAmount: -1,
        });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain(
            "targetAmount"
        );
    });

    it("rejects a non-numeric target amount", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            targetAmount: "abc",
        });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain(
            "targetAmount"
        );
    });

    it("rejects a malformed end date", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            endDate: "not-a-date",
        });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain(
            "endDate"
        );
    });

    it("rejects an end date before the start date", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            startDate: "2026-09-10",
            endDate: "2026-09-01",
        });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain(
            "endDate"
        );
    });

    it("does not require a linked goal", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            goalId: "",
        });

        expect(result.success).toBe(true);
    });

    it("does not require notes", () => {
        const result = financialPlanSchema.safeParse({
            ...baseInput,
            notes: "",
        });

        expect(result.success).toBe(true);
    });
});
