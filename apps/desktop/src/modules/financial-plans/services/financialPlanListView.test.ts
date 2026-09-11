import { describe, expect, it } from "vitest";

import type { Currency } from "@/modules/currencies/types";

import type {
    FinancialPlan,
    FinancialPlanStatus,
} from "../types";
import type { PlanCalcResult } from "./planActuals";

import {
    canArchivePlan,
    canRestorePlan,
    countPlansByStatus,
    countPlansNeedingAttention,
    describePlanActualsSummary,
    filterPlansByStatus,
    getPlanHeadlineActual,
    getPlanStatusClasses,
} from "./financialPlanListView";

function plan(
    status: FinancialPlanStatus,
    id: string = status
): FinancialPlan {
    return {
        id,
        name: id,
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
        status,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };
}

const INR: Currency = {
    id: "INR",
    code: "INR",
    name: "Indian Rupee",
    symbol: "₹",
    isDefault: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
};

function calcResult(
    over: Omit<Partial<PlanCalcResult>, "totals"> & {
        totals?: Partial<PlanCalcResult["totals"]>;
    } = {}
): PlanCalcResult {
    return {
        planId: "plan-1",
        planType: "ACCUMULATION",
        periodType: "MONTHLY",
        currencyId: "INR",
        asOf: "2026-09-15",
        window: {
            start: "2026-01-01",
            end: "2026-09-15",
            openEnded: true,
        },
        currentPeriod: {
            start: "2026-09-01",
            end: "2026-09-15",
            label: "September 2026",
        },
        status: "COMPLETE",
        warnings: [],
        components: [],
        ...over,
        totals: {
            planTarget: 100_000,
            isPerPeriodTarget: false,
            positionValue: null,
            currentPeriodInflow: null,
            currentPeriodOutflow: null,
            currentPeriodNet: null,
            lifetimeInflow: null,
            lifetimeOutflow: null,
            lifetimeNet: null,
            activeComponentCount: 0,
            unavailableComponentCount: 0,
            ...over.totals,
        },
    };
}

describe("filterPlansByStatus", () => {
    const plans = [
        plan("ACTIVE"),
        plan("ACTIVE", "active-2"),
        plan("COMPLETED"),
        plan("ARCHIVED"),
    ];

    it("ALL is a pass-through copy", () => {
        const out = filterPlansByStatus(
            plans,
            "ALL"
        );
        expect(out).toHaveLength(4);
        expect(out).not.toBe(plans);
    });

    it("narrows by each status", () => {
        expect(
            filterPlansByStatus(
                plans,
                "ACTIVE"
            ).map(p => p.id)
        ).toEqual(["ACTIVE", "active-2"]);
        expect(
            filterPlansByStatus(plans, "COMPLETED")
        ).toHaveLength(1);
        expect(
            filterPlansByStatus(plans, "ARCHIVED")
        ).toHaveLength(1);
    });
});

describe("countPlansByStatus", () => {
    it("counts per status plus ALL", () => {
        const counts = countPlansByStatus([
            plan("ACTIVE"),
            plan("ACTIVE", "a2"),
            plan("ARCHIVED"),
        ]);
        expect(counts).toEqual({
            ALL: 3,
            ACTIVE: 2,
            COMPLETED: 0,
            ARCHIVED: 1,
        });
    });
});

describe("getPlanStatusClasses / can*Plan", () => {
    it("returns a class string per status and a fallback", () => {
        expect(
            getPlanStatusClasses("ACTIVE")
        ).toContain("emerald");
        expect(
            getPlanStatusClasses("COMPLETED")
        ).toContain("blue");
        expect(
            getPlanStatusClasses("ARCHIVED")
        ).toContain("slate");
        expect(
            getPlanStatusClasses("WHATEVER")
        ).toContain("slate");
    });

    it("canArchive / canRestore reflect the status", () => {
        expect(
            canArchivePlan({ status: "ACTIVE" })
        ).toBe(true);
        expect(
            canArchivePlan({ status: "ARCHIVED" })
        ).toBe(false);
        expect(
            canRestorePlan({ status: "ARCHIVED" })
        ).toBe(true);
        expect(
            canRestorePlan({ status: "COMPLETED" })
        ).toBe(false);
    });
});

describe("describePlanActualsSummary", () => {
    it("ACCUMULATION: position (emphasis) + contributions + target, no net", () => {
        const summary = describePlanActualsSummary(
            calcResult({
                planType: "ACCUMULATION",
                components: [
                    {} as never,
                ],
                totals: {
                    positionValue: 470_000,
                    currentPeriodInflow: 50_000,
                    lifetimeInflow: 100_000,
                    planTarget: 1_000_000,
                    activeComponentCount: 3,
                },
            }),
            INR
        );

        const labels = summary.rows.map(
            r => r.label
        );
        expect(labels).toContain("Current position");
        expect(labels).toContain(
            "This period — contributions"
        );
        expect(labels).toContain("Target");
        expect(labels).not.toContain(
            "This period — net"
        );
        expect(summary.rows[0]).toMatchObject({
            label: "Current position",
            emphasis: true,
        });
        expect(summary.empty).toBe(false);
        expect(summary.componentCountLabel).toBe(
            "3 active"
        );
    });

    it("DEBT_PAYOFF: 'Outstanding' + 'principal repaid' wording", () => {
        const summary = describePlanActualsSummary(
            calcResult({
                planType: "DEBT_PAYOFF",
                components: [{} as never],
                totals: {
                    positionValue: 390_000,
                    currentPeriodOutflow: 8_400,
                    lifetimeOutflow: 24_600,
                    planTarget: null,
                },
            }),
            INR
        );

        const labels = summary.rows.map(
            r => r.label
        );
        expect(labels[0]).toBe("Outstanding");
        expect(labels).toContain(
            "This period — principal repaid"
        );
        expect(
            summary.rows.find(
                r => r.label === "Target"
            )?.value
        ).toBe("—");
    });

    it("CASHFLOW_TARGET: net row is emphasised when there is no position", () => {
        const summary = describePlanActualsSummary(
            calcResult({
                planType: "CASHFLOW_TARGET",
                components: [{} as never],
                totals: {
                    positionValue: null,
                    currentPeriodInflow: 180_000,
                    currentPeriodOutflow: 70_000,
                    currentPeriodNet: 110_000,
                    isPerPeriodTarget: true,
                    planTarget: 100_000,
                },
            }),
            INR
        );

        const net = summary.rows.find(
            r => r.label === "This period — net"
        );
        expect(net?.emphasis).toBe(true);
        expect(
            summary.rows.some(
                r =>
                    r.label ===
                    "Per-period target"
            )
        ).toBe(true);
    });

    it("passes the engine status through and de-duplicates warnings", () => {
        const summary = describePlanActualsSummary(
            calcResult({
                status: "INCOMPLETE",
                components: [{} as never],
                totals: {
                    positionValue: 10,
                    unavailableComponentCount: 1,
                    activeComponentCount: 2,
                },
                warnings: [
                    {
                        code: "COMPONENT_UNAVAILABLE",
                        componentId: "c1",
                        message: "Source gone",
                    },
                    {
                        code: "COMPONENT_UNAVAILABLE",
                        componentId: "c2",
                        message: "Source gone",
                    },
                    {
                        code: "PLAN_ENDED",
                        componentId: null,
                        message: "Plan ended",
                    },
                ],
            }),
            INR
        );

        expect(summary.status).toBe("INCOMPLETE");
        expect(summary.warnings).toEqual([
            "Source gone",
            "Plan ended",
        ]);
        expect(summary.componentCountLabel).toBe(
            "2 active, 1 unavailable"
        );
    });

    it("marks a plan with no components and no totals as empty", () => {
        const summary = describePlanActualsSummary(
            calcResult({
                components: [],
                warnings: [
                    {
                        code: "NO_COMPONENTS",
                        componentId: null,
                        message:
                            "This plan has no components.",
                    },
                ],
            }),
            INR
        );

        expect(summary.empty).toBe(true);
        // target row is still present
        expect(
            summary.rows.map(r => r.label)
        ).toEqual(["Target"]);
    });
});

describe("getPlanHeadlineActual (Phase 7 list column)", () => {
    it("returns the position row for an accumulation plan", () => {
        const headline = getPlanHeadlineActual(
            calcResult({
                planType: "ACCUMULATION",
                components: [{} as never],
                totals: { positionValue: 320_000 },
            }),
            INR
        );
        expect(headline).toMatchObject({
            label: "Current position",
            emphasis: true,
        });
    });

    it("returns the net row for a cash-flow plan", () => {
        const headline = getPlanHeadlineActual(
            calcResult({
                planType: "CASHFLOW_TARGET",
                components: [{} as never],
                totals: {
                    positionValue: null,
                    currentPeriodInflow: 100,
                    currentPeriodOutflow: 40,
                    currentPeriodNet: 60,
                },
            }),
            INR
        );
        expect(headline?.label).toBe(
            "This period — net"
        );
    });

    it("returns null when there is nothing to headline", () => {
        expect(
            getPlanHeadlineActual(
                calcResult({ components: [] }),
                INR
            )
        ).toBeNull();
    });
});

describe("countPlansNeedingAttention (Phase 7 summary)", () => {
    const results = new Map<
        string,
        { status: "COMPLETE" | "INCOMPLETE" }
    >([
        ["a", { status: "INCOMPLETE" }],
        ["b", { status: "COMPLETE" }],
        ["c", { status: "INCOMPLETE" }],
        ["arch", { status: "INCOMPLETE" }],
    ]);

    it("counts non-archived incomplete plans", () => {
        const plans = [
            plan("ACTIVE", "a"),
            plan("ACTIVE", "b"),
            plan("COMPLETED", "c"),
            plan("ARCHIVED", "arch"),
        ];
        expect(
            countPlansNeedingAttention(
                plans,
                results
            )
        ).toBe(2);
    });

    it("adds plans flagged with integrity issues (still excluding archived)", () => {
        const plans = [
            plan("ACTIVE", "a"),
            plan("ACTIVE", "b"),
            plan("ARCHIVED", "arch"),
        ];
        expect(
            countPlansNeedingAttention(
                plans,
                results,
                new Set(["b", "arch"])
            )
        ).toBe(2); // a (incomplete) + b (integrity); arch excluded
    });
});
