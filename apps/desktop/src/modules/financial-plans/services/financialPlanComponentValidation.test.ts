import { describe, expect, it } from "vitest";

import type { FinancialPlanComponent } from "../types";

import {
    PLAN_COMPONENT_CATALOG,
    PLAN_COMPONENT_MATRIX,
    PLAN_TYPES,
} from "../constants";
import type { PlanType } from "../types";

import {
    exceedsComponentLimit,
    findComponentsIncompatibleWithPlanType,
    findDuplicateComponent,
    validateAccountSource,
    validateCategorySource,
    validateComponentCombo,
    validateComponentCurrency,
    validateComponentFields,
    validateComponentTarget,
    validateInvestmentSource,
    validateLoanSource,
    violatesCashflowMode,
} from "./financialPlanComponentValidation";

function comp(
    overrides: Partial<FinancialPlanComponent> = {}
): FinancialPlanComponent {
    return {
        id: "c-1",
        planId: "plan-1",
        componentType: "ACCOUNT",
        role: "ASSET",
        accountId: "acc-1",
        categoryId: null,
        investmentId: null,
        loanId: null,
        label: null,
        targetAmount: null,
        sortOrder: 0,
        isActive: true,
        notes: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("validateComponentFields", () => {
    it("accepts a well-formed component", () => {
        expect(
            validateComponentFields({
                componentType: "ACCOUNT",
                role: "ASSET",
                sourceId: "acc-1",
            })
        ).toBeNull();
    });

    it("rejects an unknown component type / role", () => {
        expect(
            validateComponentFields({
                componentType: "WALLETS",
                role: "ASSET",
                sourceId: "x",
            })
        ).toMatch(/valid component type/i);

        expect(
            validateComponentFields({
                componentType: "ACCOUNT",
                role: "GROWTH",
                sourceId: "x",
            })
        ).toMatch(/valid component role/i);
    });

    it("rejects a missing source and a negative target", () => {
        expect(
            validateComponentFields({
                componentType: "ACCOUNT",
                role: "ASSET",
                sourceId: "   ",
            })
        ).toMatch(/select a source/i);

        expect(
            validateComponentFields({
                componentType: "ACCOUNT",
                role: "ASSET",
                sourceId: "acc-1",
                targetAmount: -5,
            })
        ).toMatch(/zero or more/i);
    });
});

describe("validateComponentCombo (plan_type x component matrix)", () => {
    const allowed: Array<
        [string, string, string]
    > = [
        ["ACCUMULATION", "ACCOUNT", "ASSET"],
        ["ACCUMULATION", "CATEGORY", "CONTRIBUTION"],
        ["ACCUMULATION", "INVESTMENT", "ASSET"],
        ["ACCUMULATION", "INVESTMENT", "CONTRIBUTION"],
        ["DEBT_PAYOFF", "ACCOUNT", "LIABILITY"],
        ["DEBT_PAYOFF", "LOAN", "LIABILITY"],
        ["DEBT_PAYOFF", "LOAN", "CONTRIBUTION"],
        ["EXPENSE_PLAN", "ACCOUNT", "ASSET"],
        ["EXPENSE_PLAN", "CATEGORY", "SPENDING"],
        ["CASHFLOW_TARGET", "ACCOUNT", "CONTRIBUTION"],
        [
            "CASHFLOW_TARGET",
            "CATEGORY",
            "CONTRIBUTION",
        ],
        ["CASHFLOW_TARGET", "CATEGORY", "SPENDING"],
        ["PORTFOLIO_GROWTH", "ACCOUNT", "ASSET"],
        ["PORTFOLIO_GROWTH", "INVESTMENT", "ASSET"],
        [
            "PORTFOLIO_GROWTH",
            "INVESTMENT",
            "CONTRIBUTION",
        ],
    ];

    const rejected: Array<
        [string, string, string]
    > = [
        ["ACCUMULATION", "ACCOUNT", "LIABILITY"],
        ["ACCUMULATION", "ACCOUNT", "CONTRIBUTION"],
        ["ACCUMULATION", "CATEGORY", "SPENDING"],
        ["ACCUMULATION", "LOAN", "LIABILITY"],
        ["DEBT_PAYOFF", "ACCOUNT", "ASSET"],
        ["DEBT_PAYOFF", "CATEGORY", "SPENDING"],
        ["DEBT_PAYOFF", "INVESTMENT", "ASSET"],
        ["EXPENSE_PLAN", "CATEGORY", "CONTRIBUTION"],
        ["EXPENSE_PLAN", "ACCOUNT", "CONTRIBUTION"],
        ["EXPENSE_PLAN", "LOAN", "LIABILITY"],
        ["CASHFLOW_TARGET", "ACCOUNT", "ASSET"],
        ["CASHFLOW_TARGET", "INVESTMENT", "ASSET"],
        ["CASHFLOW_TARGET", "LOAN", "CONTRIBUTION"],
        ["PORTFOLIO_GROWTH", "CATEGORY", "CONTRIBUTION"],
        ["PORTFOLIO_GROWTH", "LOAN", "LIABILITY"],
        ["PORTFOLIO_GROWTH", "ACCOUNT", "CONTRIBUTION"],
    ];

    it.each(allowed)(
        "%s allows %s / %s",
        (planType, type, role) => {
            expect(
                validateComponentCombo(
                    planType as never,
                    type as never,
                    role as never
                )
            ).toBeNull();
        }
    );

    it.each(rejected)(
        "%s rejects %s / %s",
        (planType, type, role) => {
            expect(
                validateComponentCombo(
                    planType as never,
                    type as never,
                    role as never
                )
            ).toMatch(/cannot include/i);
        }
    );
});

describe("validateComponentTarget", () => {
    it("allows a target for non cash-flow plans", () => {
        expect(
            validateComponentTarget(
                "ACCUMULATION",
                1000
            )
        ).toBeNull();
    });

    it("rejects any component target on a CASHFLOW_TARGET plan", () => {
        expect(
            validateComponentTarget(
                "CASHFLOW_TARGET",
                1
            )
        ).toMatch(/per-period target/i);

        expect(
            validateComponentTarget(
                "CASHFLOW_TARGET",
                null
            )
        ).toBeNull();
    });
});

describe("source reference checks", () => {
    it("ACCOUNT + ASSET needs a cash-like account, not credit-card / investment / loan", () => {
        expect(
            validateAccountSource("ASSET", {
                type: "SAVINGS",
            }).ok
        ).toBe(true);

        expect(
            validateAccountSource("ASSET", {
                type: "CREDIT_CARD",
            })
        ).toMatchObject({
            ok: false,
            unavailableReason:
                "INVALID_ACCOUNT_TYPE",
        });

        expect(
            validateAccountSource("ASSET", {
                type: "INVESTMENT",
            })
        ).toMatchObject({ ok: false });

        expect(
            validateAccountSource("ASSET", null)
        ).toMatchObject({
            ok: false,
            unavailableReason: "SOURCE_MISSING",
        });
    });

    it("ACCOUNT + LIABILITY needs a credit-card account", () => {
        expect(
            validateAccountSource("LIABILITY", {
                type: "CREDIT_CARD",
            }).ok
        ).toBe(true);

        expect(
            validateAccountSource("LIABILITY", {
                type: "SAVINGS",
            }).ok
        ).toBe(false);
    });

    it("CATEGORY role must match category_type; TRANSFER is rejected", () => {
        expect(
            validateCategorySource("CONTRIBUTION", {
                categoryType: "INCOME",
            }).ok
        ).toBe(true);

        expect(
            validateCategorySource("SPENDING", {
                categoryType: "EXPENSE",
            }).ok
        ).toBe(true);

        expect(
            validateCategorySource("SPENDING", {
                categoryType: "INCOME",
            })
        ).toMatchObject({
            ok: false,
            unavailableReason:
                "INVALID_CATEGORY_TYPE",
        });

        expect(
            validateCategorySource("SPENDING", {
                categoryType: "TRANSFER",
            })
        ).toMatchObject({ ok: false });
    });

    it("INVESTMENT / LOAN sources must be ACTIVE", () => {
        expect(
            validateInvestmentSource({
                status: "ACTIVE",
            }).ok
        ).toBe(true);

        expect(
            validateInvestmentSource({
                status: "CLOSED",
            })
        ).toMatchObject({
            ok: false,
            unavailableReason: "SOURCE_INACTIVE",
        });

        expect(
            validateLoanSource({ status: "ACTIVE" })
                .ok
        ).toBe(true);

        expect(
            validateLoanSource({ status: "CLOSED" })
        ).toMatchObject({
            ok: false,
            unavailableReason: "SOURCE_INACTIVE",
        });
    });

    it("currency must match for non-category sources, and is skipped for categories", () => {
        expect(
            validateComponentCurrency(
                "ACCOUNT",
                "INR",
                "INR"
            ).ok
        ).toBe(true);

        expect(
            validateComponentCurrency(
                "ACCOUNT",
                "USD",
                "INR"
            )
        ).toMatchObject({
            ok: false,
            unavailableReason: "CURRENCY_MISMATCH",
        });

        expect(
            validateComponentCurrency(
                "CATEGORY",
                null,
                "INR"
            ).ok
        ).toBe(true);
    });
});

describe("duplicate / mode / limit guards", () => {
    it("finds an exact (type, source, role) duplicate but allows a different role", () => {
        const existing = [
            comp({
                id: "c-1",
                componentType: "INVESTMENT",
                role: "ASSET",
                accountId: null,
                investmentId: "inv-1",
            }),
        ];

        expect(
            findDuplicateComponent(
                {
                    id: null,
                    componentType: "INVESTMENT",
                    role: "ASSET",
                    sourceId: "inv-1",
                },
                existing
            )
        ).not.toBeNull();

        expect(
            findDuplicateComponent(
                {
                    id: null,
                    componentType: "INVESTMENT",
                    role: "CONTRIBUTION",
                    sourceId: "inv-1",
                },
                existing
            )
        ).toBeNull();
    });

    it("CASHFLOW_TARGET cannot mix account and category components", () => {
        const withCategory = [
            comp({
                id: "c-1",
                componentType: "CATEGORY",
                role: "SPENDING",
                accountId: null,
                categoryId: "cat-1",
            }),
        ];

        expect(
            violatesCashflowMode(
                "CASHFLOW_TARGET",
                "ACCOUNT",
                withCategory
            )
        ).toBe(true);

        expect(
            violatesCashflowMode(
                "CASHFLOW_TARGET",
                "CATEGORY",
                withCategory
            )
        ).toBe(false);

        expect(
            violatesCashflowMode(
                "ACCUMULATION",
                "ACCOUNT",
                withCategory
            )
        ).toBe(false);
    });

    it("enforces the per-plan component cap of 20", () => {
        expect(exceedsComponentLimit(19)).toBe(false);
        expect(exceedsComponentLimit(20)).toBe(true);
    });
});

describe("findComponentsIncompatibleWithPlanType (Phase 4)", () => {
    // One component per catalog combo, tagged by id "TYPE:ROLE".
    const allCombos = PLAN_COMPONENT_CATALOG.map(meta =>
        comp({
            id: `${meta.componentType}:${meta.role}`,
            componentType: meta.componentType,
            role: meta.role,
            accountId:
                meta.componentType === "ACCOUNT"
                    ? "acc-1"
                    : null,
            categoryId:
                meta.componentType === "CATEGORY"
                    ? "cat-1"
                    : null,
            investmentId:
                meta.componentType === "INVESTMENT"
                    ? "inv-1"
                    : null,
            loanId:
                meta.componentType === "LOAN"
                    ? "loan-1"
                    : null,
        })
    );

    it.each(PLAN_TYPES as readonly PlanType[])(
        "returns exactly the combos NOT in the matrix for %s",
        planType => {
            const allowed = new Set(
                PLAN_COMPONENT_MATRIX[planType].map(
                    combo =>
                        `${combo.componentType}:${combo.role}`
                )
            );

            const incompatible =
                findComponentsIncompatibleWithPlanType(
                    planType,
                    allCombos
                ).map(c => c.id);

            const expectedIncompatible = allCombos
                .map(c => c.id)
                .filter(id => !allowed.has(id));

            expect(incompatible.sort()).toEqual(
                expectedIncompatible.sort()
            );
        }
    );

    it("flags a valid combo that carries a target the plan type forbids (CASHFLOW_TARGET)", () => {
        const withTarget = comp({
            id: "cat-spend-target",
            componentType: "CATEGORY",
            role: "SPENDING",
            categoryId: "cat-1",
            targetAmount: 100,
        });
        const withoutTarget = comp({
            id: "cat-spend-plain",
            componentType: "CATEGORY",
            role: "SPENDING",
            categoryId: "cat-1",
            targetAmount: null,
        });

        const flagged =
            findComponentsIncompatibleWithPlanType(
                "CASHFLOW_TARGET",
                [withTarget, withoutTarget]
            ).map(c => c.id);

        expect(flagged).toEqual(["cat-spend-target"]);
    });

    it("allows a per-component target for a non cash-flow plan type", () => {
        const withTarget = comp({
            componentType: "ACCOUNT",
            role: "ASSET",
            accountId: "acc-1",
            targetAmount: 5000,
        });

        expect(
            findComponentsIncompatibleWithPlanType(
                "ACCUMULATION",
                [withTarget]
            )
        ).toEqual([]);
    });

    it("returns [] for an empty component list", () => {
        expect(
            findComponentsIncompatibleWithPlanType(
                "DEBT_PAYOFF",
                []
            )
        ).toEqual([]);
    });
});
