import { describe, expect, it } from "vitest";

import type { FinancialGoal } from "@/modules/financial-goals/types";

import type {
    FinancialPlan,
    FinancialPlanComponent,
    PlanComponentType,
} from "../types";

import {
    checkComponentRowIntegrity,
    checkPlanGoalIntegrity,
    checkPlanIntegrity,
} from "./financialPlanIntegrity";

function plan(
    over: Partial<FinancialPlan> = {}
): FinancialPlan {
    return {
        id: "plan-1",
        name: "Plan",
        planType: "ACCUMULATION",
        planCategory: "CORE_PERSONAL_FINANCE",
        planSubcategory: "SAVINGS",
        periodType: "MONTHLY",
        startDate: "2026-01-01",
        endDate: null,
        currencyId: "INR",
        targetAmount: 1000,
        goalId: null,
        notes: null,
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...over,
    };
}

function goal(
    over: Partial<FinancialGoal> = {}
): FinancialGoal {
    return {
        id: "goal-1",
        name: "House",
        goalType: "SAVINGS",
        goalCategory: "CORE_PERSONAL_FINANCE",
        goalSubcategory: "HOME_PURCHASE",
        targetAmount: 100,
        currentAmount: 0,
        currencyId: "INR",
        targetDate: null,
        priority: 0,
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...over,
    };
}

function component(
    componentType: PlanComponentType,
    over: Partial<FinancialPlanComponent> = {}
): FinancialPlanComponent {
    return {
        id: `c-${componentType}`,
        planId: "plan-1",
        componentType,
        role: "ASSET",
        accountId:
            componentType === "ACCOUNT"
                ? "acc-1"
                : null,
        categoryId:
            componentType === "CATEGORY"
                ? "cat-1"
                : null,
        investmentId:
            componentType === "INVESTMENT"
                ? "inv-1"
                : null,
        loanId:
            componentType === "LOAN"
                ? "loan-1"
                : null,
        label: null,
        targetAmount: null,
        sortOrder: 0,
        isActive: true,
        notes: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...over,
    };
}

describe("checkPlanGoalIntegrity", () => {
    it("no issue when the plan has no goal link", () => {
        expect(
            checkPlanGoalIntegrity(
                plan({ goalId: null }),
                null
            )
        ).toEqual([]);
    });

    it("GOAL_MISSING when the link is set but the goal is gone", () => {
        const issues = checkPlanGoalIntegrity(
            plan({ goalId: "goal-1" }),
            null
        );
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({
            code: "GOAL_MISSING",
            severity: "warning",
        });
        expect(issues[0].message).toMatch(
            /no longer exists.*edit the plan/i
        );
    });

    it("no issue when the goal exists in the same currency", () => {
        expect(
            checkPlanGoalIntegrity(
                plan({
                    goalId: "goal-1",
                    currencyId: "INR",
                }),
                goal({ currencyId: "INR" })
            )
        ).toEqual([]);
    });

    it("GOAL_CURRENCY_MISMATCH when the goal's currency drifted", () => {
        const issues = checkPlanGoalIntegrity(
            plan({
                goalId: "goal-1",
                currencyId: "INR",
            }),
            goal({ currencyId: "USD" })
        );
        expect(issues[0]).toMatchObject({
            code: "GOAL_CURRENCY_MISMATCH",
            severity: "warning",
        });
        expect(issues[0].message).toContain("USD");
        expect(issues[0].message).toContain("INR");
    });
});

describe("checkComponentRowIntegrity", () => {
    it("returns null for a well-formed row (one FK, matching type)", () => {
        expect(
            checkComponentRowIntegrity(
                component("ACCOUNT")
            )
        ).toBeNull();
        expect(
            checkComponentRowIntegrity(
                component("LOAN")
            )
        ).toBeNull();
    });

    it("flags a row with no source FK set", () => {
        const issue = checkComponentRowIntegrity(
            component("ACCOUNT", {
                accountId: null,
            })
        );
        expect(issue).toMatchObject({
            code: "MALFORMED_COMPONENT_ROW",
            severity: "error",
            componentId: "c-ACCOUNT",
        });
    });

    it("flags a row with two source FKs set", () => {
        expect(
            checkComponentRowIntegrity(
                component("ACCOUNT", {
                    categoryId: "cat-x",
                })
            )
        ).toMatchObject({
            code: "MALFORMED_COMPONENT_ROW",
        });
    });

    it("flags a row whose single FK does not match component_type", () => {
        expect(
            checkComponentRowIntegrity(
                component("CATEGORY", {
                    categoryId: null,
                    investmentId: "inv-9",
                })
            )
        ).toMatchObject({
            code: "MALFORMED_COMPONENT_ROW",
        });
    });
});

describe("checkPlanIntegrity", () => {
    it("clean plan -> empty report", () => {
        const report = checkPlanIntegrity(
            plan({ goalId: null }),
            {
                goal: null,
                components: [
                    component("ACCOUNT"),
                    component("INVESTMENT"),
                ],
            }
        );
        expect(report.issues).toEqual([]);
        expect(report.hasErrors).toBe(false);
        expect(report.hasWarnings).toBe(false);
    });

    it("aggregates goal drift (warning) and a malformed row (error)", () => {
        const report = checkPlanIntegrity(
            plan({ goalId: "goal-1" }),
            {
                goal: null,
                components: [
                    component("ACCOUNT"),
                    component("LOAN", {
                        loanId: null,
                    }),
                ],
            }
        );

        expect(
            report.issues.map(i => i.code).sort()
        ).toEqual([
            "GOAL_MISSING",
            "MALFORMED_COMPONENT_ROW",
        ]);
        expect(report.hasErrors).toBe(true);
        expect(report.hasWarnings).toBe(true);
    });

    it("tolerates a missing components list", () => {
        expect(
            checkPlanIntegrity(
                plan({ goalId: null }),
                {}
            ).issues
        ).toEqual([]);
    });
});
