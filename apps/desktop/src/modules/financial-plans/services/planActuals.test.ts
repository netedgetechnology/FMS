import { describe, expect, it } from "vitest";

import type { BudgetLedgerEntry } from "@/modules/budgets/services/budgetSpending";
import type { InvestmentTransaction } from "@/modules/investments/types";
import type { LoanPaymentSchedule } from "@/modules/loans/types";

import type {
    FinancialPlan,
    FinancialPlanComponent,
    PlanComponentRole,
    PlanComponentType,
} from "../types";

import {
    calculatePlanActuals,
    PLAN_CALC_UNAVAILABLE_REASONS,
    PLAN_CALC_WARNING_CODES,
    type LedgerAccount,
    type LedgerBundle,
    type LedgerCategory,
    type LedgerInvestment,
    type LedgerLoan,
    type PlanCalcResult,
} from "./planActuals";

const AS_OF = "2026-09-15";

// -------------------- factories --------------------

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
        startDate: "2026-06-01",
        endDate: null,
        currencyId: "INR",
        targetAmount: 1_000_000,
        goalId: null,
        notes: null,
        status: "ACTIVE",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        ...over,
    };
}

let seq = 0;

function comp(
    componentType: PlanComponentType,
    role: PlanComponentRole,
    sourceId: string,
    over: Partial<FinancialPlanComponent> = {}
): FinancialPlanComponent {
    seq += 1;
    return {
        id: over.id ?? `c-${seq}`,
        planId: "plan-1",
        componentType,
        role,
        accountId:
            componentType === "ACCOUNT"
                ? sourceId
                : null,
        categoryId:
            componentType === "CATEGORY"
                ? sourceId
                : null,
        investmentId:
            componentType === "INVESTMENT"
                ? sourceId
                : null,
        loanId:
            componentType === "LOAN"
                ? sourceId
                : null,
        label: null,
        targetAmount: null,
        sortOrder: 0,
        isActive: true,
        notes: null,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        ...over,
    };
}

function tx(
    over: Partial<BudgetLedgerEntry> & {
        accountId: string;
        type: string;
        amount: unknown;
        transactionDate: string;
    }
): BudgetLedgerEntry {
    return {
        id:
            over.id ??
            `t-${Math.random().toString(36).slice(2)}`,
        categoryId: null,
        cardReference: null,
        deletedAt: null,
        ...over,
    } as BudgetLedgerEntry;
}

interface LedgerInput {
    accounts?: Record<
        string,
        Partial<LedgerAccount> & { currencyId?: string }
    >;
    categories?: Record<string, LedgerCategory>;
    investments?: Record<
        string,
        Partial<LedgerInvestment>
    >;
    loans?: Record<string, Partial<LedgerLoan>>;
    transactions?: BudgetLedgerEntry[];
    transfers?: LedgerBundle["transfers"];
    investmentTxns?: Record<
        string,
        Array<{
            transactionType?: string;
            transactionDate?: string;
            amount?: unknown;
            fees?: unknown;
            taxes?: unknown;
            quantity?: number;
            price?: number;
        }>
    >;
    loanSchedules?: Record<
        string,
        Array<{
            status?: string;
            paidDate?: string | null;
            principalAmount?: unknown;
            interestAmount?: number;
            totalAmount?: number;
            outstandingPrincipal?: number;
            transactionId?: string | null;
            paidAmount?: number | null;
            installmentNumber?: number;
            dueDate?: string;
        }>
    >;
    emiInterest?: Record<string, number>;
}

function makeLedger(
    input: LedgerInput = {}
): LedgerBundle {
    const accountsById = new Map<
        string,
        LedgerAccount
    >();
    const creditCardAccountIds = new Set<string>();

    for (const [id, a] of Object.entries(
        input.accounts ?? {}
    )) {
        const type = a.type ?? "SAVINGS";
        accountsById.set(id, {
            name: a.name ?? id,
            currencyId: a.currencyId ?? "INR",
            type,
            openingBalance: a.openingBalance ?? 0,
        });
        if (type === "CREDIT_CARD") {
            creditCardAccountIds.add(id);
        }
    }

    const categoriesById = new Map<
        string,
        LedgerCategory
    >(Object.entries(input.categories ?? {}));

    const investmentsById = new Map<
        string,
        LedgerInvestment
    >();
    for (const [id, i] of Object.entries(
        input.investments ?? {}
    )) {
        investmentsById.set(id, {
            name: i.name ?? id,
            currencyId: i.currencyId ?? "INR",
            status: i.status ?? "ACTIVE",
            currentValue: i.currentValue ?? 0,
        });
    }

    const loansById = new Map<string, LedgerLoan>();
    for (const [id, l] of Object.entries(
        input.loans ?? {}
    )) {
        loansById.set(id, {
            name: l.name ?? id,
            currencyId: l.currencyId ?? "INR",
            status: l.status ?? "ACTIVE",
            outstandingPrincipal:
                l.outstandingPrincipal ?? 0,
            outstandingInterest:
                l.outstandingInterest ?? 0,
        });
    }

    const investmentTransactionsByInvestmentId =
        new Map<string, InvestmentTransaction[]>();
    for (const [id, rows] of Object.entries(
        input.investmentTxns ?? {}
    )) {
        investmentTransactionsByInvestmentId.set(
            id,
            rows.map(
                r =>
                    ({
                        id: "it",
                        investmentId: id,
                        transactionType:
                            r.transactionType ??
                            "BUY",
                        transactionDate:
                            r.transactionDate ??
                            "2026-01-01",
                        quantity: r.quantity ?? 0,
                        price: r.price ?? 0,
                        amount: r.amount ?? 0,
                        fees: r.fees ?? 0,
                        taxes: r.taxes ?? 0,
                        referenceNumber: null,
                        createdAt:
                            "2026-01-01T00:00:00.000Z",
                        updatedAt:
                            "2026-01-01T00:00:00.000Z",
                    }) as unknown as InvestmentTransaction
            )
        );
    }

    const loanScheduleByLoanId = new Map<
        string,
        LoanPaymentSchedule[]
    >();
    for (const [id, rows] of Object.entries(
        input.loanSchedules ?? {}
    )) {
        loanScheduleByLoanId.set(
            id,
            rows.map(
                (r, index) =>
                    ({
                        id: `s-${index}`,
                        loanId: id,
                        installmentNumber:
                            r.installmentNumber ??
                            index + 1,
                        dueDate:
                            r.dueDate ?? "2026-01-01",
                        principalAmount:
                            r.principalAmount,
                        interestAmount:
                            r.interestAmount ?? 0,
                        totalAmount:
                            r.totalAmount ?? 0,
                        outstandingPrincipal:
                            r.outstandingPrincipal ??
                            0,
                        status:
                            r.status ??
                            ("PAID" as LoanPaymentSchedule["status"]),
                        paidDate:
                            r.paidDate ?? null,
                        paidAmount:
                            r.paidAmount ?? null,
                        transactionId:
                            r.transactionId ?? null,
                    }) as unknown as LoanPaymentSchedule
            )
        );
    }

    return {
        accountsById,
        creditCardAccountIds,
        transactions: input.transactions ?? [],
        transfers: input.transfers ?? [],
        emiInterestByTransactionId: new Map(
            Object.entries(input.emiInterest ?? {})
        ),
        categoriesById,
        investmentsById,
        investmentTransactionsByInvestmentId,
        loansById,
        loanScheduleByLoanId,
    };
}

function run(
    p: FinancialPlan,
    components: FinancialPlanComponent[],
    ledger: LedgerBundle,
    asOf = AS_OF
): PlanCalcResult {
    return calculatePlanActuals({
        plan: p,
        components,
        asOf,
        ledger,
    });
}

function codes(r: PlanCalcResult): string[] {
    return r.warnings.map(w => w.code);
}

// =====================================================
// D1 - signed vs magnitude handling
// =====================================================

describe("D1 - signed / magnitude transaction handling", () => {
    it("both a +5000 and a -5000 expense reduce the balance; a -1000 transfer-out reduces it", () => {
        const c = comp("ACCOUNT", "ASSET", "S1");
        const ledger = makeLedger({
            accounts: {
                S1: { openingBalance: 100_000 },
            },
            transactions: [
                tx({
                    accountId: "S1",
                    type: "expense",
                    amount: 5000,
                    transactionDate: "2026-07-01",
                }),
                tx({
                    accountId: "S1",
                    type: "expense",
                    amount: -5000,
                    transactionDate: "2026-07-02",
                }),
            ],
            transfers: [
                {
                    sourceAccountId: "S1",
                    destinationAccountId: "X",
                    amount: -1000,
                    transactionDate: "2026-07-03",
                },
            ],
        });

        const r = run(plan(), [c], ledger);

        expect(
            r.components[0].positionValue
        ).toBe(89_000);
        expect(r.status).toBe("COMPLETE");
    });
});

// =====================================================
// D2 - invalid monetary values
// =====================================================

describe("D2 - invalid monetary values", () => {
    it("a NaN transaction amount skips that row and warns, without poisoning the balance", () => {
        const c = comp("ACCOUNT", "ASSET", "S1");
        const ledger = makeLedger({
            accounts: {
                S1: { openingBalance: 10_000 },
            },
            transactions: [
                tx({
                    accountId: "S1",
                    type: "income",
                    amount: 5000,
                    transactionDate: "2026-07-01",
                }),
                tx({
                    accountId: "S1",
                    type: "income",
                    amount: Number.NaN,
                    transactionDate: "2026-07-02",
                }),
                tx({
                    accountId: "S1",
                    type: "expense",
                    amount: 2000,
                    transactionDate: "2026-07-03",
                }),
            ],
        });

        const r = run(plan(), [c], ledger);

        expect(
            r.components[0].positionValue
        ).toBe(13_000);
        expect(codes(r)).toContain(
            "SKIPPED_MALFORMED_ROWS"
        );
        expect(r.status).toBe("COMPLETE");
    });

    it("a NaN investment current_value makes the component unavailable and the plan INCOMPLETE", () => {
        const c = comp(
            "INVESTMENT",
            "ASSET",
            "I1"
        );
        const ledger = makeLedger({
            investments: {
                I1: {
                    currentValue: Number.NaN,
                },
            },
        });

        const r = run(
            plan({ planType: "PORTFOLIO_GROWTH" }),
            [c],
            ledger
        );

        expect(r.components[0]).toMatchObject({
            available: false,
            unavailableReason: "SOURCE_DATA_ERROR",
            positionValue: null,
        });
        expect(r.status).toBe("INCOMPLETE");
        expect(codes(r)).toContain(
            "COMPONENT_DATA_ERROR"
        );
    });

    it("an omitted investment fee is treated as 0 (missing-optional), not malformed", () => {
        const c = comp(
            "INVESTMENT",
            "CONTRIBUTION",
            "I1"
        );
        const ledger = makeLedger({
            investments: { I1: {} },
            investmentTxns: {
                I1: [
                    {
                        transactionType: "BUY",
                        transactionDate: "2026-09-03",
                        amount: 50_000,
                        // fees / taxes omitted entirely
                    },
                ],
            },
        });

        const r = run(
            plan({ planType: "PORTFOLIO_GROWTH" }),
            [c],
            ledger
        );

        expect(r.components[0].periodFlow).toBe(
            50_000
        );
        expect(codes(r)).not.toContain(
            "SKIPPED_MALFORMED_ROWS"
        );
    });
});

// =====================================================
// D3 - missing PAID paid_date
// =====================================================

describe("D3 - missing PAID paidDate", () => {
    it("a PAID row with no paidDate is excluded from LOAN·CONTRIBUTION and warns", () => {
        const c = comp(
            "LOAN",
            "CONTRIBUTION",
            "L1"
        );
        const ledger = makeLedger({
            loans: { L1: {} },
            loanSchedules: {
                L1: [
                    {
                        status: "PAID",
                        paidDate: "2026-09-05",
                        principalAmount: 9000,
                    },
                    {
                        status: "PAID",
                        paidDate: null,
                        principalAmount: 9000,
                    },
                ],
            },
        });

        const r = run(
            plan({
                planType: "DEBT_PAYOFF",
                startDate: "2026-01-01",
            }),
            [c],
            ledger
        );

        expect(r.components[0].periodFlow).toBe(9000);
        expect(codes(r)).toContain(
            "SKIPPED_MALFORMED_ROWS"
        );
    });
});

// =====================================================
// D4 - malformed vs missing loan principal
// =====================================================

describe("D4 - malformed vs missing loan principal", () => {
    it("NaN principal on a PAID row is skipped + warned; null principal is a real 0 with no warning", () => {
        const c = comp(
            "LOAN",
            "CONTRIBUTION",
            "L1"
        );
        const ledger = makeLedger({
            loans: { L1: {} },
            loanSchedules: {
                L1: [
                    {
                        status: "PAID",
                        paidDate: "2026-09-05",
                        principalAmount:
                            Number.NaN as unknown as number,
                    },
                    {
                        status: "PAID",
                        paidDate: "2026-09-06",
                        principalAmount:
                            null as unknown as number,
                    },
                    {
                        status: "PAID",
                        paidDate: "2026-09-07",
                        principalAmount: 8000,
                    },
                ],
            },
        });

        const r = run(
            plan({
                planType: "DEBT_PAYOFF",
                startDate: "2026-01-01",
            }),
            [c],
            ledger
        );

        expect(r.components[0].periodFlow).toBe(8000);
        expect(
            r.warnings.filter(
                w =>
                    w.code ===
                    "SKIPPED_MALFORMED_ROWS"
            )
        ).toHaveLength(1);
    });
});

// =====================================================
// D5 - warning-code coverage
// =====================================================

describe("D5 - warning-code coverage", () => {
    it("every emitted warning code is declared in the union", () => {
        // Build one fixture that triggers several codes at once, plus
        // reuse: this test only asserts the closed-set property.
        const emitted = new Set<string>();

        const scenarios: PlanCalcResult[] = [];

        // NO_COMPONENTS + PLAN_NOT_STARTED
        scenarios.push(
            run(
                plan({ startDate: "2030-01-01" }),
                [],
                makeLedger()
            )
        );

        // PLAN_ENDED
        scenarios.push(
            run(
                plan({
                    startDate: "2026-01-01",
                    endDate: "2026-03-31",
                }),
                [comp("ACCOUNT", "ASSET", "S1")],
                makeLedger({
                    accounts: { S1: {} },
                })
            )
        );

        // COMPONENT_UNAVAILABLE
        scenarios.push(
            run(
                plan(),
                [
                    comp(
                        "ACCOUNT",
                        "ASSET",
                        "missing"
                    ),
                ],
                makeLedger()
            )
        );

        // COMPONENT_DATA_ERROR
        scenarios.push(
            run(
                plan({
                    planType: "PORTFOLIO_GROWTH",
                }),
                [
                    comp(
                        "INVESTMENT",
                        "ASSET",
                        "I1"
                    ),
                ],
                makeLedger({
                    investments: {
                        I1: {
                            currentValue:
                                Number.NaN,
                        },
                    },
                })
            )
        );

        // COMPONENT_INACTIVE_EXCLUDED
        scenarios.push(
            run(
                plan(),
                [
                    comp("ACCOUNT", "ASSET", "S1", {
                        isActive: false,
                    }),
                ],
                makeLedger({
                    accounts: { S1: {} },
                })
            )
        );

        // CONTAINS_CLOSED_SOURCE
        scenarios.push(
            run(
                plan({ planType: "DEBT_PAYOFF" }),
                [
                    comp(
                        "LOAN",
                        "LIABILITY",
                        "L1"
                    ),
                ],
                makeLedger({
                    loans: {
                        L1: {
                            status: "CLOSED",
                            outstandingPrincipal: 0,
                        },
                    },
                })
            )
        );

        // SKIPPED_MALFORMED_ROWS
        scenarios.push(
            run(
                plan(),
                [comp("ACCOUNT", "ASSET", "S1")],
                makeLedger({
                    accounts: { S1: {} },
                    transactions: [
                        tx({
                            accountId: "S1",
                            type: "income",
                            amount: Number.NaN,
                            transactionDate:
                                "2026-07-01",
                        }),
                    ],
                })
            )
        );

        // PARTIAL_LOAN_PAYMENTS_IGNORED
        scenarios.push(
            run(
                plan({
                    planType: "DEBT_PAYOFF",
                    startDate: "2026-01-01",
                }),
                [
                    comp(
                        "LOAN",
                        "CONTRIBUTION",
                        "L1"
                    ),
                ],
                makeLedger({
                    loans: { L1: {} },
                    loanSchedules: {
                        L1: [
                            {
                                status: "PARTIAL",
                                paidDate:
                                    "2026-09-05",
                                principalAmount: 500,
                            },
                        ],
                    },
                })
            )
        );

        // INVESTMENT_SPLIT_IGNORED
        scenarios.push(
            run(
                plan({
                    planType: "PORTFOLIO_GROWTH",
                }),
                [
                    comp(
                        "INVESTMENT",
                        "CONTRIBUTION",
                        "I1"
                    ),
                ],
                makeLedger({
                    investments: { I1: {} },
                    investmentTxns: {
                        I1: [
                            {
                                transactionType:
                                    "SPLIT",
                                transactionDate:
                                    "2026-09-01",
                            },
                        ],
                    },
                })
            )
        );

        // CROSS_CURRENCY_ROWS_EXCLUDED
        scenarios.push(
            run(
                plan({
                    planType: "CASHFLOW_TARGET",
                    startDate: "2026-08-01",
                    targetAmount: 1000,
                }),
                [
                    comp(
                        "CATEGORY",
                        "SPENDING",
                        "CAT1"
                    ),
                ],
                makeLedger({
                    accounts: {
                        USD1: {
                            currencyId: "USD",
                        },
                    },
                    categories: {
                        CAT1: {
                            name: "Groceries",
                            categoryType: "EXPENSE",
                        },
                    },
                    transactions: [
                        tx({
                            accountId: "USD1",
                            type: "expense",
                            amount: 100,
                            transactionDate:
                                "2026-09-05",
                            categoryId: "CAT1",
                        }),
                    ],
                })
            )
        );

        // MIXED_CASHFLOW_MODE
        scenarios.push(
            run(
                plan({
                    planType: "CASHFLOW_TARGET",
                    startDate: "2026-08-01",
                    targetAmount: 1000,
                }),
                [
                    comp(
                        "ACCOUNT",
                        "CONTRIBUTION",
                        "B1"
                    ),
                    comp(
                        "CATEGORY",
                        "SPENDING",
                        "CAT1"
                    ),
                ],
                makeLedger({
                    accounts: { B1: {} },
                    categories: {
                        CAT1: {
                            name: "Groceries",
                            categoryType: "EXPENSE",
                        },
                    },
                })
            )
        );

        // COMPONENT_NOT_IN_PLAN_MATRIX (Phase 4 engine guard)
        scenarios.push(
            run(
                plan({
                    planType: "DEBT_PAYOFF",
                    startDate: "2026-01-01",
                }),
                [
                    comp(
                        "INVESTMENT",
                        "ASSET",
                        "I1"
                    ),
                ],
                makeLedger({
                    investments: {
                        I1: { currentValue: 1000 },
                    },
                })
            )
        );

        for (const s of scenarios) {
            for (const w of s.warnings) {
                emitted.add(w.code);
            }
        }

        // closed-set: nothing outside the union
        for (const code of emitted) {
            expect(
                PLAN_CALC_WARNING_CODES
            ).toContain(code);
        }

        // coverage: each declared code was produced
        for (const code of PLAN_CALC_WARNING_CODES) {
            expect(emitted).toContain(code);
        }
    });

    it("every unavailableReason emitted is declared", () => {
        const reasons = new Set<string>();

        reasons.add(
            run(
                plan(),
                [
                    comp(
                        "ACCOUNT",
                        "ASSET",
                        "missing"
                    ),
                ],
                makeLedger()
            ).components[0].unavailableReason ?? ""
        );

        // build the rest directly
        const mismatch = run(
            plan(),
            [comp("ACCOUNT", "ASSET", "S1")],
            makeLedger({
                accounts: {
                    S1: { currencyId: "USD" },
                },
            })
        );
        reasons.add(
            mismatch.components[0]
                .unavailableReason ?? ""
        );

        const badType = run(
            plan(),
            [comp("ACCOUNT", "ASSET", "CC1")],
            makeLedger({
                accounts: {
                    CC1: { type: "CREDIT_CARD" },
                },
            })
        );
        reasons.add(
            badType.components[0].unavailableReason ??
                ""
        );

        const badCat = run(
            plan({
                planType: "CASHFLOW_TARGET",
                startDate: "2026-08-01",
                targetAmount: 1,
            }),
            [comp("CATEGORY", "SPENDING", "C1")],
            makeLedger({
                categories: {
                    C1: {
                        name: "x",
                        categoryType: "INCOME",
                    },
                },
            })
        );
        reasons.add(
            badCat.components[0].unavailableReason ??
                ""
        );

        const dataErr = run(
            plan({ planType: "DEBT_PAYOFF" }),
            [comp("LOAN", "LIABILITY", "L1")],
            makeLedger({
                loans: {
                    L1: {
                        outstandingPrincipal:
                            Number.NaN,
                    },
                },
            })
        );
        reasons.add(
            dataErr.components[0]
                .unavailableReason ?? ""
        );

        const incompatible = run(
            plan({
                planType: "DEBT_PAYOFF",
                startDate: "2026-01-01",
            }),
            [comp("INVESTMENT", "ASSET", "I1")],
            makeLedger({
                investments: {
                    I1: { currentValue: 1 },
                },
            })
        );
        reasons.add(
            incompatible.components[0]
                .unavailableReason ?? ""
        );

        reasons.delete("");

        // closed set
        for (const reason of reasons) {
            expect(
                PLAN_CALC_UNAVAILABLE_REASONS
            ).toContain(reason);
        }

        // every declared reason is reachable
        for (const reason of PLAN_CALC_UNAVAILABLE_REASONS) {
            expect(reasons).toContain(reason);
        }
    });
});

// =====================================================
// D6 - closed source behavior
// =====================================================

describe("D6 - closed / on-hold source behavior", () => {
    it("a CLOSED loan is read at its terminal outstanding principal and warns, staying COMPLETE", () => {
        const c = comp(
            "LOAN",
            "LIABILITY",
            "L1"
        );
        const r = run(
            plan({ planType: "DEBT_PAYOFF" }),
            [c],
            makeLedger({
                loans: {
                    L1: {
                        status: "CLOSED",
                        outstandingPrincipal: 0,
                    },
                },
            })
        );

        expect(r.components[0]).toMatchObject({
            available: true,
            sourceStatus: "CLOSED",
            sourceTerminal: true,
            positionValue: 0,
        });
        expect(codes(r)).toContain(
            "CONTAINS_CLOSED_SOURCE"
        );
        expect(r.status).toBe("COMPLETE");
        expect(r.totals.positionValue).toBe(0);
    });

    it("an ON_HOLD investment is counted at its stored current value", () => {
        const c = comp(
            "INVESTMENT",
            "ASSET",
            "I1"
        );
        const r = run(
            plan({ planType: "PORTFOLIO_GROWTH" }),
            [c],
            makeLedger({
                investments: {
                    I1: {
                        status: "ON_HOLD",
                        currentValue: 90_000,
                    },
                },
            })
        );

        expect(r.components[0].positionValue).toBe(
            90_000
        );
        expect(r.components[0].sourceTerminal).toBe(
            true
        );
        expect(r.totals.positionValue).toBe(90_000);
        expect(codes(r)).toContain(
            "CONTAINS_CLOSED_SOURCE"
        );
    });
});

// =====================================================
// D7 - completed plan: current stock, historical flow window
// =====================================================

describe("D7 - completed plan (current stock, clamped flow window)", () => {
    it("stock is current; CATEGORY·SPENDING flow stops at end_date; PLAN_ENDED warns", () => {
        const assetC = comp(
            "ACCOUNT",
            "ASSET",
            "F1"
        );
        const spendC = comp(
            "CATEGORY",
            "SPENDING",
            "EDU"
        );

        const ledger = makeLedger({
            accounts: { F1: { openingBalance: 0 } },
            categories: {
                EDU: {
                    name: "Education",
                    categoryType: "EXPENSE",
                },
            },
            transactions: [
                tx({
                    accountId: "F1",
                    type: "expense",
                    amount: 40_000,
                    transactionDate: "2026-05-10",
                    categoryId: "EDU",
                }),
                tx({
                    accountId: "F1",
                    type: "expense",
                    amount: 25_000,
                    transactionDate: "2026-08-01",
                    categoryId: "EDU",
                }),
            ],
        });

        const r = run(
            plan({
                planType: "EXPENSE_PLAN",
                startDate: "2026-01-01",
                endDate: "2026-06-30",
                periodType: "MONTHLY",
                targetAmount: 100_000,
            }),
            [assetC, spendC],
            ledger
        );

        // current balance reflects BOTH expenses
        expect(
            r.components[0].positionValue
        ).toBe(-65_000);
        // spending flow stops at 2026-06-30 -> only the May row
        expect(
            r.components[1].lifetimeFlow
        ).toBe(40_000);
        expect(r.window.end).toBe("2026-06-30");
        expect(r.window.openEnded).toBe(false);
        expect(r.currentPeriod.start).toBe(
            "2026-06-01"
        );
        expect(r.currentPeriod.end).toBe(
            "2026-06-30"
        );
        expect(codes(r)).toContain("PLAN_ENDED");
        expect(r.status).toBe("COMPLETE");
    });
});

// =====================================================
// D8 - reconciliation-style regressions
// =====================================================

describe("D8 - reconciliation regressions", () => {
    it("credit-card payment excluded, card purchase counted (CATEGORY·SPENDING)", () => {
        const c = comp(
            "CATEGORY",
            "SPENDING",
            "GRO"
        );
        const ledger = makeLedger({
            accounts: {
                BANK: {},
                CC1: { type: "CREDIT_CARD" },
            },
            categories: {
                GRO: {
                    name: "Groceries",
                    categoryType: "EXPENSE",
                },
            },
            transactions: [
                tx({
                    accountId: "BANK",
                    type: "expense",
                    amount: 5000,
                    transactionDate: "2026-09-05",
                    categoryId: "GRO",
                }),
                tx({
                    accountId: "BANK",
                    type: "expense",
                    amount: 40_000,
                    transactionDate: "2026-09-08",
                    categoryId: "GRO",
                    cardReference: "CC1",
                }),
                tx({
                    accountId: "CC1",
                    type: "expense",
                    amount: 3000,
                    transactionDate: "2026-09-09",
                    categoryId: "GRO",
                    cardReference: "CC1",
                }),
            ],
        });

        const r = run(
            plan({
                planType: "CASHFLOW_TARGET",
                startDate: "2026-08-01",
                targetAmount: 10_000,
            }),
            [c],
            ledger
        );

        expect(r.components[0].periodFlow).toBe(8000);
        expect(codes(r)).not.toContain(
            "SKIPPED_MALFORMED_ROWS"
        );
    });

    it("loan EMI: LOAN·CONTRIBUTION counts principal (18000) only, never the full EMI", () => {
        const c = comp(
            "LOAN",
            "CONTRIBUTION",
            "L1"
        );
        const ledger = makeLedger({
            loans: { L1: {} },
            loanSchedules: {
                L1: [
                    {
                        status: "PAID",
                        paidDate: "2026-09-05",
                        principalAmount: 18_000,
                        interestAmount: 7000,
                        transactionId: "T-EMI",
                    },
                ],
            },
            emiInterest: { "T-EMI": 7000 },
        });

        const r = run(
            plan({
                planType: "DEBT_PAYOFF",
                startDate: "2026-01-01",
            }),
            [c],
            ledger
        );

        expect(r.components[0].periodFlow).toBe(
            18_000
        );
    });

    it("INVESTMENT·CONTRIBUTION BUY/SELL fee & tax treatment", () => {
        const c = comp(
            "INVESTMENT",
            "CONTRIBUTION",
            "I1"
        );
        const ledger = makeLedger({
            investments: { I1: {} },
            investmentTxns: {
                I1: [
                    {
                        transactionType: "BUY",
                        transactionDate: "2026-09-03",
                        amount: 50_000,
                        fees: 100,
                        taxes: 50,
                    },
                    {
                        transactionType: "SELL",
                        transactionDate: "2026-09-10",
                        amount: 24_000,
                        fees: 80,
                        taxes: 40,
                    },
                    {
                        transactionType: "DIVIDEND",
                        transactionDate: "2026-09-12",
                        amount: 1200,
                        taxes: 120,
                    },
                    {
                        transactionType:
                            "OPENING_BALANCE",
                        transactionDate: "2026-09-01",
                        amount: 200_000,
                    },
                ],
            },
        });

        const r = run(
            plan({
                planType: "PORTFOLIO_GROWTH",
                startDate: "2026-01-01",
            }),
            [c],
            ledger
        );

        // BUY cash out 50150 - SELL cash in 23880 = 26270
        expect(r.components[0].periodFlow).toBe(
            26_270
        );
    });
});

// =====================================================
// D9 - plan-type golden results
// =====================================================

describe("D9 - plan-type golden totals", () => {
    it("ACCUMULATION", () => {
        const ledger = makeLedger({
            accounts: {
                S1: { openingBalance: 200_000 },
            },
            categories: {
                BONUS: {
                    name: "Bonus",
                    categoryType: "INCOME",
                },
            },
            investments: {
                I1: { currentValue: 150_000 },
            },
            transactions: [
                tx({
                    accountId: "S1",
                    type: "income",
                    amount: 50_000,
                    transactionDate: "2026-07-10",
                    categoryId: "BONUS",
                }),
                tx({
                    accountId: "S1",
                    type: "expense",
                    amount: 10_000,
                    transactionDate: "2026-08-05",
                    categoryId: "GROC",
                }),
                tx({
                    accountId: "S1",
                    type: "income",
                    amount: 50_000,
                    transactionDate: "2026-09-03",
                    categoryId: "BONUS",
                }),
            ],
            transfers: [
                {
                    sourceAccountId: "X",
                    destinationAccountId: "S1",
                    amount: 30_000,
                    transactionDate: "2026-09-01",
                },
            ],
        });

        const r = run(
            plan(),
            [
                comp("ACCOUNT", "ASSET", "S1"),
                comp("INVESTMENT", "ASSET", "I1"),
                comp(
                    "CATEGORY",
                    "CONTRIBUTION",
                    "BONUS"
                ),
            ],
            ledger
        );

        expect(r.totals.positionValue).toBe(470_000);
        expect(r.totals.currentPeriodInflow).toBe(
            50_000
        );
        expect(r.totals.lifetimeInflow).toBe(
            100_000
        );
        expect(
            r.totals.currentPeriodOutflow
        ).toBeNull();
        expect(r.totals.currentPeriodNet).toBeNull();
        expect(r.status).toBe("COMPLETE");
        expect(r.warnings).toHaveLength(0);
    });

    it("DEBT_PAYOFF", () => {
        const ledger = makeLedger({
            accounts: {
                CC1: {
                    type: "CREDIT_CARD",
                    openingBalance: 0,
                },
            },
            loans: {
                L1: {
                    outstandingPrincipal: 380_000,
                },
            },
            loanSchedules: {
                L1: [
                    {
                        status: "PAID",
                        paidDate: "2026-07-05",
                        principalAmount: 8000,
                    },
                    {
                        status: "PAID",
                        paidDate: "2026-08-05",
                        principalAmount: 8200,
                    },
                    {
                        status: "PAID",
                        paidDate: "2026-09-05",
                        principalAmount: 8400,
                    },
                    {
                        status: "PARTIAL",
                        paidDate: "2026-09-20",
                        principalAmount: 8600,
                    },
                ],
            },
            transactions: [
                tx({
                    accountId: "CC1",
                    type: "expense",
                    amount: 15_000,
                    transactionDate: "2026-09-02",
                }),
                tx({
                    accountId: "CC1",
                    type: "income",
                    amount: 5000,
                    transactionDate: "2026-09-10",
                }),
            ],
        });

        const r = run(
            plan({
                planType: "DEBT_PAYOFF",
                startDate: "2026-01-01",
                targetAmount: null,
            }),
            [
                comp("LOAN", "LIABILITY", "L1"),
                comp("LOAN", "CONTRIBUTION", "L1"),
                comp("ACCOUNT", "LIABILITY", "CC1"),
            ],
            ledger
        );

        expect(r.totals.positionValue).toBe(390_000);
        expect(
            r.totals.currentPeriodOutflow
        ).toBe(8400);
        expect(r.totals.lifetimeOutflow).toBe(
            24_600
        );
        expect(
            r.totals.currentPeriodInflow
        ).toBeNull();
        expect(codes(r)).toEqual([
            "PARTIAL_LOAN_PAYMENTS_IGNORED",
        ]);
    });

    it("EXPENSE_PLAN (ONE_TIME)", () => {
        const ledger = makeLedger({
            accounts: { F1: { openingBalance: 0 } },
            categories: {
                EDU: {
                    name: "Education",
                    categoryType: "EXPENSE",
                },
            },
            transactions: [
                tx({
                    accountId: "F1",
                    type: "expense",
                    amount: 80_000,
                    transactionDate: "2026-07-15",
                    categoryId: "EDU",
                }),
            ],
            transfers: [
                "2026-05-01",
                "2026-06-01",
                "2026-07-01",
                "2026-08-01",
                "2026-09-01",
            ].map(d => ({
                sourceAccountId: "X",
                destinationAccountId: "F1",
                amount: 20_000,
                transactionDate: d,
            })),
        });

        const r = run(
            plan({
                planType: "EXPENSE_PLAN",
                periodType: "ONE_TIME",
                startDate: "2026-04-01",
                endDate: "2027-03-31",
                targetAmount: 240_000,
            }),
            [
                comp("ACCOUNT", "ASSET", "F1"),
                comp("CATEGORY", "SPENDING", "EDU"),
            ],
            ledger
        );

        expect(r.totals.positionValue).toBe(20_000);
        expect(
            r.totals.currentPeriodOutflow
        ).toBe(80_000);
        expect(r.totals.lifetimeOutflow).toBe(
            80_000
        );
        expect(r.warnings).toHaveLength(0);
    });

    it("CASHFLOW_TARGET account mode", () => {
        const ledger = makeLedger({
            accounts: {
                B1: { type: "CURRENT" },
            },
            transactions: [
                tx({
                    accountId: "B1",
                    type: "income",
                    amount: 120_000,
                    transactionDate: "2026-07-15",
                }),
                tx({
                    accountId: "B1",
                    type: "expense",
                    amount: 45_000,
                    transactionDate: "2026-07-20",
                }),
                tx({
                    accountId: "B1",
                    type: "income",
                    amount: 150_000,
                    transactionDate: "2026-08-10",
                }),
                tx({
                    accountId: "B1",
                    type: "expense",
                    amount: 60_000,
                    transactionDate: "2026-08-15",
                }),
                tx({
                    accountId: "B1",
                    type: "income",
                    amount: 180_000,
                    transactionDate: "2026-09-04",
                }),
                tx({
                    accountId: "B1",
                    type: "expense",
                    amount: 40_000,
                    transactionDate: "2026-09-06",
                }),
                tx({
                    accountId: "B1",
                    type: "expense",
                    amount: 30_000,
                    transactionDate: "2026-09-12",
                }),
                tx({
                    accountId: "B1",
                    type: "income",
                    amount: 90_000,
                    transactionDate: "2026-09-20",
                }),
            ],
            transfers: [
                {
                    sourceAccountId: "B1",
                    destinationAccountId: "X",
                    amount: 50_000,
                    transactionDate: "2026-09-08",
                },
            ],
        });

        const r = run(
            plan({
                planType: "CASHFLOW_TARGET",
                startDate: "2026-07-01",
                targetAmount: 100_000,
            }),
            [comp("ACCOUNT", "CONTRIBUTION", "B1")],
            ledger
        );

        expect(r.totals.currentPeriodInflow).toBe(
            180_000
        );
        expect(r.totals.currentPeriodOutflow).toBe(
            70_000
        );
        expect(r.totals.currentPeriodNet).toBe(
            110_000
        );
        expect(r.totals.lifetimeInflow).toBe(
            450_000
        );
        expect(r.totals.lifetimeOutflow).toBe(
            175_000
        );
        expect(r.totals.lifetimeNet).toBe(275_000);
        expect(r.totals.positionValue).toBeNull();
        expect(r.totals.isPerPeriodTarget).toBe(
            true
        );
    });

    it("CASHFLOW_TARGET category mode", () => {
        const ledger = makeLedger({
            accounts: { P1: {}, CC1: { type: "CREDIT_CARD" } },
            categories: {
                SAL: {
                    name: "Salary",
                    categoryType: "INCOME",
                },
                GRO: {
                    name: "Groceries",
                    categoryType: "EXPENSE",
                },
                RENT: {
                    name: "Rent",
                    categoryType: "EXPENSE",
                },
            },
            transactions: [
                tx({
                    accountId: "P1",
                    type: "income",
                    amount: 120_000,
                    transactionDate: "2026-09-01",
                    categoryId: "SAL",
                }),
                tx({
                    accountId: "P1",
                    type: "expense",
                    amount: 15_000,
                    transactionDate: "2026-09-05",
                    categoryId: "GRO",
                }),
                tx({
                    accountId: "P1",
                    type: "expense",
                    amount: 8000,
                    transactionDate: "2026-09-12",
                    categoryId: "GRO",
                }),
                tx({
                    accountId: "P1",
                    type: "expense",
                    amount: 45_000,
                    transactionDate: "2026-09-02",
                    categoryId: "RENT",
                }),
                tx({
                    accountId: "P1",
                    type: "expense",
                    amount: 30_000,
                    transactionDate: "2026-09-10",
                    categoryId: "GRO",
                    cardReference: "CC1",
                }),
            ],
        });

        const r = run(
            plan({
                planType: "CASHFLOW_TARGET",
                startDate: "2026-08-01",
                targetAmount: 40_000,
            }),
            [
                comp(
                    "CATEGORY",
                    "CONTRIBUTION",
                    "SAL"
                ),
                comp("CATEGORY", "SPENDING", "GRO"),
                comp("CATEGORY", "SPENDING", "RENT"),
            ],
            ledger
        );

        expect(r.totals.currentPeriodInflow).toBe(
            120_000
        );
        expect(r.totals.currentPeriodOutflow).toBe(
            68_000
        );
        // 120000 income - 68000 classified spend = +52000 surplus
        expect(r.totals.currentPeriodNet).toBe(
            52_000
        );
        expect(r.status).toBe("COMPLETE");
    });

    it("PORTFOLIO_GROWTH (YEARLY)", () => {
        const ledger = makeLedger({
            accounts: {
                BR: {
                    type: "CURRENT",
                    openingBalance: 50_000,
                },
            },
            investments: {
                I2: { currentValue: 2_400_000 },
            },
            investmentTxns: {
                I2: [
                    {
                        transactionType: "BUY",
                        transactionDate: "2025-03-01",
                        amount: 1_000_000,
                        fees: 500,
                        taxes: 200,
                    },
                    {
                        transactionType: "BUY",
                        transactionDate: "2026-02-01",
                        amount: 600_000,
                        fees: 300,
                        taxes: 100,
                    },
                    {
                        transactionType: "SELL",
                        transactionDate: "2026-06-01",
                        amount: 300_000,
                        fees: 200,
                        taxes: 150,
                    },
                ],
            },
        });

        const r = run(
            plan({
                planType: "PORTFOLIO_GROWTH",
                periodType: "YEARLY",
                startDate: "2025-01-01",
                targetAmount: 5_000_000,
            }),
            [
                comp("INVESTMENT", "ASSET", "I2"),
                comp(
                    "INVESTMENT",
                    "CONTRIBUTION",
                    "I2"
                ),
                comp("ACCOUNT", "ASSET", "BR"),
            ],
            ledger
        );

        expect(r.totals.positionValue).toBe(
            2_450_000
        );
        expect(r.totals.currentPeriodInflow).toBe(
            300_750
        );
        expect(r.totals.lifetimeInflow).toBe(
            1_301_450
        );
        expect(r.currentPeriod.label).toBe("2026");
        expect(r.warnings).toHaveLength(0);
    });
});

// =====================================================
// D10 - behavioral invariants
// =====================================================

describe("D10 - behavioral invariants", () => {
    const baseLedger = () =>
        makeLedger({
            accounts: {
                S1: { openingBalance: 200_000 },
            },
            categories: {
                BONUS: {
                    name: "Bonus",
                    categoryType: "INCOME",
                },
            },
            investments: {
                I1: { currentValue: 150_000 },
            },
            transactions: [
                tx({
                    accountId: "S1",
                    type: "income",
                    amount: 50_000,
                    transactionDate: "2026-09-03",
                    categoryId: "BONUS",
                }),
            ],
        });

    const components = () => [
        comp("ACCOUNT", "ASSET", "S1", {
            id: "c-asset",
        }),
        comp("INVESTMENT", "ASSET", "I1", {
            id: "c-inv",
        }),
        comp("CATEGORY", "CONTRIBUTION", "BONUS", {
            id: "c-contrib",
        }),
    ];

    it("unavailable source -> null fields, INCOMPLETE, count", () => {
        // S1 account is absent (soft-deleted since the component was added)
        const ledger = makeLedger({
            categories: {
                BONUS: {
                    name: "Bonus",
                    categoryType: "INCOME",
                },
            },
            investments: {
                I1: { currentValue: 150_000 },
            },
        });

        const r = run(plan(), components(), ledger);
        const asset = r.components.find(
            c => c.componentId === "c-asset"
        )!;

        expect(asset.positionValue).toBeNull();
        expect(asset.available).toBe(false);
        expect(r.status).toBe("INCOMPLETE");
        expect(
            r.totals.unavailableComponentCount
        ).toBe(1);
        // I1 still counted
        expect(r.totals.positionValue).toBe(
            150_000
        );
    });

    it("inactive component -> excluded from totals, COMPLETE", () => {
        const comps = components();
        comps[1].isActive = false;

        const r = run(plan(), comps, baseLedger());

        expect(r.totals.positionValue).toBe(250_000);
        expect(r.status).toBe("COMPLETE");
        expect(codes(r)).toContain(
            "COMPONENT_INACTIVE_EXCLUDED"
        );
        expect(r.totals.activeComponentCount).toBe(
            2
        );
    });

    it("determinism: identical inputs -> deep-equal output", () => {
        const a = run(
            plan(),
            components(),
            baseLedger()
        );
        const b = run(
            plan(),
            components(),
            baseLedger()
        );
        expect(a).toEqual(b);
    });

    it("input immutability: frozen inputs are not mutated", () => {
        const p = Object.freeze(plan());
        const comps = components().map(c =>
            Object.freeze(c)
        );
        const ledger = baseLedger();

        expect(() =>
            calculatePlanActuals({
                plan: p,
                components: comps,
                asOf: AS_OF,
                ledger,
            })
        ).not.toThrow();
    });

    it("zero components -> COMPLETE, null money totals, NO_COMPONENTS", () => {
        const r = run(plan(), [], makeLedger());

        expect(r.status).toBe("COMPLETE");
        expect(r.totals.positionValue).toBeNull();
        expect(
            r.totals.currentPeriodInflow
        ).toBeNull();
        expect(codes(r)).toEqual(["NO_COMPONENTS"]);
    });

    it("cross-check: totals.lifetimeInflow == Σ active available contribution lifetimeFlow", () => {
        const r = run(
            plan(),
            components(),
            baseLedger()
        );

        const manual = r.components
            .filter(
                c =>
                    c.role === "CONTRIBUTION" &&
                    c.isActive &&
                    c.available
            )
            .reduce(
                (s, c) =>
                    s + (c.lifetimeFlow ?? 0),
                0
            );

        expect(r.totals.lifetimeInflow).toBe(manual);
    });

    it("no-throw fuzz: malformed rows never crash the engine", () => {
        const ledger = makeLedger({
            accounts: {
                S1: {
                    openingBalance:
                        5000 as unknown as number,
                },
            },
            categories: {
                C1: {
                    name: "x",
                    categoryType: "EXPENSE",
                },
            },
            investments: {
                I1: { currentValue: 1 },
            },
            loans: { L1: {} },
            transactions: [
                tx({
                    accountId: "S1",
                    type: "expense",
                    amount: Number.POSITIVE_INFINITY,
                    transactionDate: "",
                    categoryId: "C1",
                }),
                tx({
                    accountId: "S1",
                    type: "expense",
                    amount: "abc" as unknown as number,
                    transactionDate: "2026-13-99",
                    categoryId: "C1",
                }),
            ],
            investmentTxns: {
                I1: [
                    {
                        transactionType:
                            "WEIRD" as unknown as InvestmentTransaction["transactionType"],
                        transactionDate: "nope",
                        amount:
                            Number.NaN as unknown as number,
                    },
                ],
            },
            loanSchedules: {
                L1: [
                    {
                        status: "PAID",
                        paidDate: "bad",
                        principalAmount:
                            Number.NaN as unknown as number,
                    },
                ],
            },
        });

        expect(() =>
            run(
                plan({ planType: "EXPENSE_PLAN", targetAmount: 1 }),
                [
                    comp("ACCOUNT", "ASSET", "S1"),
                    comp(
                        "CATEGORY",
                        "SPENDING",
                        "C1"
                    ),
                ],
                ledger
            )
        ).not.toThrow();
    });
});

// =====================================================
// D12 - Phase 4 matrix / target guard (defence in depth)
//
// A plan_type change is blocked at the service, so these components can
// only reach the engine via a direct DB write / legacy row. The engine
// must never silently omit OR silently include them.
// =====================================================

describe("D12 - matrix / target guard (bypass fixtures)", () => {
    it("an ACTIVE matrix-invalid component is unavailable, warned, excluded, and forces INCOMPLETE", () => {
        // INVESTMENT·ASSET is not a DEBT_PAYOFF combo.
        const bad = comp(
            "INVESTMENT",
            "ASSET",
            "I1"
        );
        const r = run(
            plan({
                planType: "DEBT_PAYOFF",
                startDate: "2026-01-01",
            }),
            [bad],
            makeLedger({
                investments: {
                    I1: { currentValue: 999_999 },
                },
            })
        );

        expect(r.components[0]).toMatchObject({
            available: false,
            unavailableReason:
                "INCOMPATIBLE_WITH_PLAN_TYPE",
            positionValue: null,
            periodFlow: null,
            lifetimeFlow: null,
        });
        expect(codes(r)).toContain(
            "COMPONENT_NOT_IN_PLAN_MATRIX"
        );
        expect(r.status).toBe("INCOMPLETE");
        expect(r.totals.positionValue).toBeNull();
        expect(
            r.totals.unavailableComponentCount
        ).toBe(1);
    });

    it("an INACTIVE matrix-invalid component is excluded but does NOT force INCOMPLETE", () => {
        const r = run(
            plan({
                planType: "DEBT_PAYOFF",
                startDate: "2026-01-01",
            }),
            [
                comp("INVESTMENT", "ASSET", "I1", {
                    isActive: false,
                }),
            ],
            makeLedger({
                investments: {
                    I1: { currentValue: 5000 },
                },
            })
        );

        expect(r.components[0].available).toBe(false);
        expect(codes(r)).toContain(
            "COMPONENT_NOT_IN_PLAN_MATRIX"
        );
        expect(codes(r)).toContain(
            "COMPONENT_INACTIVE_EXCLUDED"
        );
        expect(r.status).toBe("COMPLETE");
        expect(r.totals.positionValue).toBeNull();
    });

    it("a valid combo carrying a target the plan_type forbids is treated the same way", () => {
        // CATEGORY·SPENDING is a valid CASHFLOW_TARGET combo, but a
        // per-component target is not allowed there.
        const r = run(
            plan({
                planType: "CASHFLOW_TARGET",
                startDate: "2026-08-01",
                targetAmount: 10_000,
            }),
            [
                comp("CATEGORY", "SPENDING", "GRO", {
                    targetAmount: 100,
                }),
            ],
            makeLedger({
                accounts: { P1: {} },
                categories: {
                    GRO: {
                        name: "Groceries",
                        categoryType: "EXPENSE",
                    },
                },
                transactions: [
                    tx({
                        accountId: "P1",
                        type: "expense",
                        amount: 4000,
                        transactionDate: "2026-09-05",
                        categoryId: "GRO",
                    }),
                ],
            })
        );

        expect(r.components[0]).toMatchObject({
            available: false,
            unavailableReason:
                "INCOMPATIBLE_WITH_PLAN_TYPE",
        });
        expect(codes(r)).toContain(
            "COMPONENT_NOT_IN_PLAN_MATRIX"
        );
        expect(r.totals.currentPeriodOutflow).toBeNull();
    });

    it("wrong-inclusion regression: a stray INVESTMENT·ASSET on an EXPENSE_PLAN is NOT summed into positionValue", () => {
        const r = run(
            plan({
                planType: "EXPENSE_PLAN",
                startDate: "2026-01-01",
                endDate: "2027-03-31",
                periodType: "MONTHLY",
                targetAmount: 100_000,
            }),
            [
                comp("ACCOUNT", "ASSET", "F1"),
                comp("INVESTMENT", "ASSET", "I1"),
            ],
            makeLedger({
                accounts: {
                    F1: { openingBalance: 20_000 },
                },
                investments: {
                    I1: { currentValue: 999_999 },
                },
            })
        );

        // only the real sinking-fund balance counts
        expect(r.totals.positionValue).toBe(20_000);
        expect(r.status).toBe("INCOMPLETE");
        expect(codes(r)).toContain(
            "COMPONENT_NOT_IN_PLAN_MATRIX"
        );
    });
});

// =====================================================
// D11 - performance (informational only)
// =====================================================

describe("D11 - performance (informational)", () => {
    it("computes a large fixture and prints the duration without asserting timing", () => {
        const accounts: LedgerInput["accounts"] = {};
        const transactions: BudgetLedgerEntry[] = [];

        for (let a = 0; a < 20; a += 1) {
            accounts[`A${a}`] = {
                openingBalance: 1000,
            };
        }
        for (let i = 0; i < 5000; i += 1) {
            const a = `A${i % 20}`;
            transactions.push(
                tx({
                    accountId: a,
                    type:
                        i % 2 === 0
                            ? "income"
                            : "expense",
                    amount: 100 + (i % 50),
                    transactionDate: `2026-0${
                        (i % 9) + 1
                    }-15`,
                })
            );
        }

        const ledger = makeLedger({
            accounts,
            transactions,
        });

        const plans: FinancialPlan[] = [];
        const componentsByPlanId = new Map<
            string,
            FinancialPlanComponent[]
        >();
        for (let p = 0; p < 15; p += 1) {
            const id = `plan-${p}`;
            plans.push(
                plan({
                    id,
                    startDate: "2026-01-01",
                })
            );
            componentsByPlanId.set(id, [
                {
                    ...comp(
                        "ACCOUNT",
                        "ASSET",
                        `A${p}`
                    ),
                    planId: id,
                },
                {
                    ...comp(
                        "ACCOUNT",
                        "ASSET",
                        `A${(p + 5) % 20}`
                    ),
                    planId: id,
                },
            ]);
        }

        const started = performance.now();
        const results = plans.map(p =>
            calculatePlanActuals({
                plan: p,
                components:
                    componentsByPlanId.get(p.id) ??
                    [],
                asOf: AS_OF,
                ledger,
            })
        );
        const elapsed = performance.now() - started;

        // eslint-disable-next-line no-console
        console.info(
            `[planActuals] ${plans.length} plans / ${transactions.length} txns computed in ${elapsed.toFixed(
                1
            )} ms`
        );

        expect(results).toHaveLength(15);
        expect(
            results.every(
                r => r.status === "COMPLETE"
            )
        ).toBe(true);
    });
});
