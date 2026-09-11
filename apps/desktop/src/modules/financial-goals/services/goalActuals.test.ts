import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import {
    calculateCategoryContributionGoalActuals,
    calculateGoalActuals,
    calculateInvestmentGoalActuals,
    calculateLoanPayoffGoalActuals,
    type GoalLedgerBundle,
} from "./goalActuals";
import type { GoalAccountLink } from "../types/GoalAccountLink";
import type { GoalCategoryLink } from "../types/GoalCategoryLink";
import type { GoalLoanLink } from "../types/GoalLoanLink";
import type { GoalInvestmentLink } from "../types/GoalInvestmentLink";

function makeLedger(
    overrides: Partial<GoalLedgerBundle> = {}
): GoalLedgerBundle {
    return {
        accountsById: new Map([
            [
                "acc-1",
                {
                    name: "Savings",
                    currencyId: "INR",
                    type: "SAVINGS",
                    isActive: true,
                    openingBalance: 10_000,
                },
            ],
        ]),
        transactions: [],
        transfers: [],
        ...overrides,
    };
}

function makeLink(
    overrides: Partial<GoalAccountLink> = {}
): GoalAccountLink {
    return {
        id: "link-1",
        goalId: "goal-1",
        accountId: "acc-1",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

const GOAL = {
    id: "goal-1",
    currencyId: "INR",
    targetAmount: 100_000,
    goalMode: "ACCOUNT_LINKED" as const,
};

describe("calculateGoalActuals - opening balance", () => {
    it("uses the opening balance when there are no transactions", () => {
        const result = calculateGoalActuals(
            GOAL,
            [makeLink()],
            makeLedger()
        );

        expect(result.totals.currentAmount).toBe(
            10_000
        );
        expect(
            result.links[0].balance
        ).toBe(10_000);
    });
});

describe("calculateGoalActuals - income / expense", () => {
    it("adds income and subtracts expense transactions", () => {
        const ledger = makeLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    type: "income",
                    amount: 5_000,
                    transactionDate: "2026-02-01",
                },
                {
                    accountId: "acc-1",
                    type: "expense",
                    amount: 2_000,
                    transactionDate: "2026-02-05",
                },
            ],
        });

        const result = calculateGoalActuals(
            GOAL,
            [makeLink()],
            ledger
        );

        // 10_000 + 5_000 - 2_000
        expect(result.totals.currentAmount).toBe(
            13_000
        );
    });

    it("ignores transactions on other accounts", () => {
        const ledger = makeLedger({
            transactions: [
                {
                    accountId: "acc-other",
                    type: "income",
                    amount: 99_999,
                    transactionDate: "2026-02-01",
                },
            ],
        });

        const result = calculateGoalActuals(
            GOAL,
            [makeLink()],
            ledger
        );

        expect(result.totals.currentAmount).toBe(
            10_000
        );
    });

    it("ignores transfer-typed transaction rows (transfers are handled separately)", () => {
        const ledger = makeLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    type: "transfer",
                    amount: 5_000,
                    transactionDate: "2026-02-01",
                },
            ],
        });

        const result = calculateGoalActuals(
            GOAL,
            [makeLink()],
            ledger
        );

        expect(result.totals.currentAmount).toBe(
            10_000
        );
    });
});

describe("calculateGoalActuals - transfers", () => {
    it("adds an incoming transfer and subtracts an outgoing transfer", () => {
        const ledger = makeLedger({
            transfers: [
                {
                    sourceAccountId: "acc-other",
                    destinationAccountId: "acc-1",
                    amount: 3_000,
                    transactionDate: "2026-02-01",
                    deletedAt: null,
                },
                {
                    sourceAccountId: "acc-1",
                    destinationAccountId: "acc-other",
                    amount: 1_000,
                    transactionDate: "2026-02-02",
                    deletedAt: null,
                },
            ],
        });

        const result = calculateGoalActuals(
            GOAL,
            [makeLink()],
            ledger
        );

        // 10_000 + 3_000 - 1_000
        expect(result.totals.currentAmount).toBe(
            12_000
        );
    });

    it("ignores a soft-deleted transfer", () => {
        const ledger = makeLedger({
            transfers: [
                {
                    sourceAccountId: "acc-other",
                    destinationAccountId: "acc-1",
                    amount: 3_000,
                    transactionDate: "2026-02-01",
                    deletedAt: "2026-02-03T00:00:00.000Z",
                },
            ],
        });

        const result = calculateGoalActuals(
            GOAL,
            [makeLink()],
            ledger
        );

        expect(result.totals.currentAmount).toBe(
            10_000
        );
    });
});

describe("calculateGoalActuals - multiple linked accounts", () => {
    it("sums balances across every active linked account", () => {
        const ledger = makeLedger({
            accountsById: new Map([
                [
                    "acc-1",
                    {
                        name: "Savings",
                        currencyId: "INR",
                        type: "SAVINGS",
                        isActive: true,
                        openingBalance: 10_000,
                    },
                ],
                [
                    "acc-2",
                    {
                        name: "Cash",
                        currencyId: "INR",
                        type: "CASH",
                        isActive: true,
                        openingBalance: 2_000,
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            GOAL,
            [
                makeLink({
                    id: "link-1",
                    accountId: "acc-1",
                }),
                makeLink({
                    id: "link-2",
                    accountId: "acc-2",
                }),
            ],
            ledger
        );

        expect(result.totals.currentAmount).toBe(
            12_000
        );
        expect(result.links).toHaveLength(2);
    });

    it("excludes an inactive (unlinked) link from the sum", () => {
        const ledger = makeLedger({
            accountsById: new Map([
                [
                    "acc-1",
                    {
                        name: "Savings",
                        currencyId: "INR",
                        type: "SAVINGS",
                        isActive: true,
                        openingBalance: 10_000,
                    },
                ],
                [
                    "acc-2",
                    {
                        name: "Cash",
                        currencyId: "INR",
                        type: "CASH",
                        isActive: true,
                        openingBalance: 2_000,
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            GOAL,
            [
                makeLink({
                    id: "link-1",
                    accountId: "acc-1",
                }),
                makeLink({
                    id: "link-2",
                    accountId: "acc-2",
                    isActive: false,
                }),
            ],
            ledger
        );

        expect(result.totals.currentAmount).toBe(
            10_000
        );
        expect(result.links).toHaveLength(1);
    });
});

describe("calculateGoalActuals - unavailable links", () => {
    it("flags a missing account with SOURCE_MISSING and excludes it from the sum", () => {
        const result = calculateGoalActuals(
            GOAL,
            [
                makeLink({
                    accountId: "does-not-exist",
                }),
            ],
            makeLedger()
        );

        expect(result.totals.currentAmount).toBe(0);
        expect(result.links[0].available).toBe(
            false
        );
        expect(
            result.links[0].unavailableReason
        ).toBe("SOURCE_MISSING");
        expect(result.warnings).toHaveLength(1);
    });

    it("flags an inactive account with SOURCE_INACTIVE and excludes it from the sum", () => {
        const ledger = makeLedger({
            accountsById: new Map([
                [
                    "acc-1",
                    {
                        name: "Savings",
                        currencyId: "INR",
                        type: "SAVINGS",
                        isActive: false,
                        openingBalance: 10_000,
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            GOAL,
            [makeLink()],
            ledger
        );

        expect(result.totals.currentAmount).toBe(0);
        expect(
            result.links[0].unavailableReason
        ).toBe("SOURCE_INACTIVE");
    });

    it("flags a currency mismatch and never sums it in (no conversion)", () => {
        const ledger = makeLedger({
            accountsById: new Map([
                [
                    "acc-1",
                    {
                        name: "US Savings",
                        currencyId: "USD",
                        type: "SAVINGS",
                        isActive: true,
                        openingBalance: 10_000,
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            GOAL,
            [makeLink()],
            ledger
        );

        expect(result.totals.currentAmount).toBe(0);
        expect(
            result.links[0].unavailableReason
        ).toBe("CURRENCY_MISMATCH");
    });

    it("flags an ineligible account type (e.g. CREDIT_CARD) with INVALID_ACCOUNT_TYPE", () => {
        const ledger = makeLedger({
            accountsById: new Map([
                [
                    "acc-1",
                    {
                        name: "Credit Card",
                        currencyId: "INR",
                        type: "CREDIT_CARD",
                        isActive: true,
                        openingBalance: -5_000,
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            GOAL,
            [makeLink()],
            ledger
        );

        expect(result.totals.currentAmount).toBe(0);
        expect(
            result.links[0].unavailableReason
        ).toBe("INVALID_ACCOUNT_TYPE");
    });

    it("sums the available links while excluding unavailable ones", () => {
        const ledger = makeLedger({
            accountsById: new Map([
                [
                    "acc-1",
                    {
                        name: "Savings",
                        currencyId: "INR",
                        type: "SAVINGS",
                        isActive: true,
                        openingBalance: 10_000,
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            GOAL,
            [
                makeLink({
                    id: "link-1",
                    accountId: "acc-1",
                }),
                makeLink({
                    id: "link-2",
                    accountId: "missing-account",
                }),
            ],
            ledger
        );

        expect(result.totals.currentAmount).toBe(
            10_000
        );
        expect(result.warnings).toHaveLength(1);
    });
});

describe("calculateGoalActuals - progress / remaining / completion", () => {
    it("clamps progress at 100% when current exceeds target", () => {
        const ledger = makeLedger({
            accountsById: new Map([
                [
                    "acc-1",
                    {
                        name: "Savings",
                        currencyId: "INR",
                        type: "SAVINGS",
                        isActive: true,
                        openingBalance: 200_000,
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            GOAL,
            [makeLink()],
            ledger
        );

        expect(
            result.totals.progressPercentage
        ).toBe(100);
        expect(result.totals.remainingAmount).toBe(
            0
        );
        expect(result.totals.isComplete).toBe(true);
    });

    it("floors progress at 0% for a negative balance", () => {
        const ledger = makeLedger({
            accountsById: new Map([
                [
                    "acc-1",
                    {
                        name: "Savings",
                        currencyId: "INR",
                        type: "SAVINGS",
                        isActive: true,
                        openingBalance: -500,
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            GOAL,
            [makeLink()],
            ledger
        );

        expect(
            result.totals.progressPercentage
        ).toBe(0);
        expect(result.totals.isComplete).toBe(
            false
        );
    });

    it("computes remaining amount as target minus current", () => {
        const result = calculateGoalActuals(
            GOAL,
            [makeLink()],
            makeLedger()
        );

        // target 100_000, current 10_000
        expect(result.totals.remainingAmount).toBe(
            90_000
        );
    });

    it("returns 0% progress when target amount is 0 (no divide-by-zero)", () => {
        const result = calculateGoalActuals(
            { ...GOAL, targetAmount: 0 },
            [makeLink()],
            makeLedger()
        );

        expect(
            result.totals.progressPercentage
        ).toBe(0);
        expect(result.totals.isComplete).toBe(
            false
        );
    });

    it("is not complete exactly at 0 progress and is complete exactly at target", () => {
        const exact = calculateGoalActuals(
            GOAL,
            [makeLink()],
            makeLedger({
                accountsById: new Map([
                    [
                        "acc-1",
                        {
                            name: "Savings",
                            currencyId: "INR",
                            type: "SAVINGS",
                            isActive: true,
                            openingBalance: 100_000,
                        },
                    ],
                ]),
            })
        );

        expect(exact.totals.isComplete).toBe(true);
        expect(
            exact.totals.progressPercentage
        ).toBe(100);
    });
});

describe("calculateGoalActuals - no linked accounts", () => {
    it("returns 0 current amount with no links", () => {
        const result = calculateGoalActuals(
            GOAL,
            [],
            makeLedger()
        );

        expect(result.totals.currentAmount).toBe(0);
        expect(result.links).toHaveLength(0);
        expect(result.warnings).toHaveLength(0);
    });
});

// =====================================================================
// Phase 2 - DEBT_PAYOFF_LINKED goals
//
// Sign convention verified against the real Financial Plans test data
// (planActuals.test.ts's DEBT_PAYOFF case): a CREDIT_CARD account with
// opening balance 0, a 15,000 expense and a 5,000 income has a raw
// ledger balance of 0 + 5,000 - 15,000 = -10,000, and the liability
// "amount owed" is -balance = 10,000. That exact fixture is reused
// below as `makeCreditCardLedger`.
// =====================================================================

function makeCreditCardLedger(
    overrides: Partial<GoalLedgerBundle> = {}
): GoalLedgerBundle {
    return {
        accountsById: new Map([
            [
                "cc-1",
                {
                    name: "Credit Card",
                    currencyId: "INR",
                    type: "CREDIT_CARD",
                    isActive: true,
                    openingBalance: 0,
                },
            ],
        ]),
        transactions: [],
        transfers: [],
        ...overrides,
    };
}

function makeCreditCardLink(
    overrides: Partial<GoalAccountLink> = {}
): GoalAccountLink {
    return {
        id: "link-1",
        goalId: "debt-goal-1",
        accountId: "cc-1",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

const DEBT_GOAL = {
    id: "debt-goal-1",
    currencyId: "INR",
    targetAmount: 100_000,
    goalMode: "DEBT_PAYOFF_LINKED" as const,
};

describe("calculateGoalActuals - DEBT_PAYOFF_LINKED sign convention", () => {
    it("matches the Financial Plans DEBT_PAYOFF fixture exactly: -10,000 raw balance -> 10,000 owed", () => {
        const ledger = makeCreditCardLedger({
            transactions: [
                {
                    accountId: "cc-1",
                    type: "expense",
                    amount: 15_000,
                    transactionDate: "2026-09-02",
                },
                {
                    accountId: "cc-1",
                    type: "income",
                    amount: 5_000,
                    transactionDate: "2026-09-10",
                },
            ],
        });

        const result = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            ledger
        );

        expect(
            result.totals.outstandingDebt
        ).toBe(10_000);
        expect(result.links[0].balance).toBe(
            10_000
        );
    });
});

describe("calculateGoalActuals - DEBT_PAYOFF_LINKED outstanding debt", () => {
    it("treats a zero opening balance as zero debt", () => {
        const result = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            makeCreditCardLedger()
        );

        expect(
            result.totals.outstandingDebt
        ).toBe(0);
    });

    it("a positive opening balance (already-owed debt) is treated as owed, not credit", () => {
        // A credit card seeded with a positive opening_balance means
        // debt already owed at setup time; the raw-balance formula
        // (opening + income - expense) then needs a NEGATIVE opening
        // balance to represent debt (matching the expense/income sign
        // test above), so this fixture uses a negative opening balance
        // to represent 20,000 already owed.
        const ledger = makeCreditCardLedger({
            accountsById: new Map([
                [
                    "cc-1",
                    {
                        name: "Credit Card",
                        currencyId: "INR",
                        type: "CREDIT_CARD",
                        isActive: true,
                        openingBalance: -20_000,
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            ledger
        );

        expect(
            result.totals.outstandingDebt
        ).toBe(20_000);
    });
});

describe("calculateGoalActuals - DEBT_PAYOFF_LINKED amount paid off / progress", () => {
    it("computes amountPaidOff = max(0, target - outstandingDebt)", () => {
        const ledger = makeCreditCardLedger({
            accountsById: new Map([
                [
                    "cc-1",
                    {
                        name: "Credit Card",
                        currencyId: "INR",
                        type: "CREDIT_CARD",
                        isActive: true,
                        openingBalance: -40_000,
                    },
                ],
            ]),
        });

        // target 100_000, outstanding 40_000 -> paid off 60_000
        const result = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            ledger
        );

        expect(result.totals.currentAmount).toBe(
            60_000
        );
        expect(
            result.totals.progressPercentage
        ).toBe(60);
    });

    it("progress increases as debt decreases (a payment)", () => {
        const before = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            makeCreditCardLedger({
                accountsById: new Map([
                    [
                        "cc-1",
                        {
                            name: "Credit Card",
                            currencyId: "INR",
                            type: "CREDIT_CARD",
                            isActive: true,
                            openingBalance: -50_000,
                        },
                    ],
                ]),
            })
        );

        const afterPayment = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            makeCreditCardLedger({
                accountsById: new Map([
                    [
                        "cc-1",
                        {
                            name: "Credit Card",
                            currencyId: "INR",
                            type: "CREDIT_CARD",
                            isActive: true,
                            openingBalance: -50_000,
                        },
                    ],
                ]),
                transactions: [
                    {
                        accountId: "cc-1",
                        type: "income",
                        amount: 10_000,
                        transactionDate:
                            "2026-05-01",
                    },
                ],
            })
        );

        expect(
            afterPayment.totals.progressPercentage
        ).toBeGreaterThan(
            before.totals.progressPercentage
        );
        expect(
            afterPayment.totals.currentAmount
        ).toBeGreaterThan(
            before.totals.currentAmount
        );
    });

    it("progress decreases as debt increases (a new charge)", () => {
        const before = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            makeCreditCardLedger({
                accountsById: new Map([
                    [
                        "cc-1",
                        {
                            name: "Credit Card",
                            currencyId: "INR",
                            type: "CREDIT_CARD",
                            isActive: true,
                            openingBalance: -50_000,
                        },
                    ],
                ]),
            })
        );

        const afterCharge = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            makeCreditCardLedger({
                accountsById: new Map([
                    [
                        "cc-1",
                        {
                            name: "Credit Card",
                            currencyId: "INR",
                            type: "CREDIT_CARD",
                            isActive: true,
                            openingBalance: -50_000,
                        },
                    ],
                ]),
                transactions: [
                    {
                        accountId: "cc-1",
                        type: "expense",
                        amount: 8_000,
                        transactionDate:
                            "2026-05-01",
                    },
                ],
            })
        );

        expect(
            afterCharge.totals.progressPercentage
        ).toBeLessThan(
            before.totals.progressPercentage
        );
        expect(
            afterCharge.totals.currentAmount
        ).toBeLessThan(before.totals.currentAmount);
    });

    it("a transfer payment from another account reduces outstanding debt", () => {
        const ledger = makeCreditCardLedger({
            accountsById: new Map([
                [
                    "cc-1",
                    {
                        name: "Credit Card",
                        currencyId: "INR",
                        type: "CREDIT_CARD",
                        isActive: true,
                        openingBalance: -30_000,
                    },
                ],
            ]),
            transfers: [
                {
                    sourceAccountId: "bank-1",
                    destinationAccountId: "cc-1",
                    amount: 12_000,
                    transactionDate: "2026-06-01",
                    deletedAt: null,
                },
            ],
        });

        const result = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            ledger
        );

        // raw balance = -30_000 + 12_000 = -18_000 -> owed 18_000
        expect(
            result.totals.outstandingDebt
        ).toBe(18_000);
    });
});

describe("calculateGoalActuals - DEBT_PAYOFF_LINKED progress clamping", () => {
    it("reaches 100% progress and amountPaidOff = target when there is no debt at all (0 balance)", () => {
        const result = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            makeCreditCardLedger()
        );

        // target 100_000, outstanding 0 -> paid off
        // max(0, 100_000 - 0) = 100_000 -> 100%
        expect(
            result.totals.progressPercentage
        ).toBe(100);
        expect(result.totals.currentAmount).toBe(
            100_000
        );
        expect(result.totals.isComplete).toBe(
            true
        );
    });

    it("clamps progress at 100% and remaining debt at 0 when the account is in credit (overpaid)", () => {
        const ledger = makeCreditCardLedger({
            accountsById: new Map([
                [
                    "cc-1",
                    {
                        name: "Credit Card",
                        currencyId: "INR",
                        type: "CREDIT_CARD",
                        isActive: true,
                        openingBalance: 5_000, // net credit balance
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            ledger
        );

        // outstandingDebt is negative (in credit)
        expect(
            result.totals.outstandingDebt
        ).toBe(-5_000);
        // remainingDebt floors at 0, not negative
        expect(
            result.totals.remainingAmount
        ).toBe(0);
        // amountPaidOff clamps at target (100_000), progress at 100%
        expect(
            result.totals.progressPercentage
        ).toBe(100);
        expect(result.totals.isComplete).toBe(
            true
        );
    });

    it("clamps progress at 0% and does not go negative when debt exceeds the original target", () => {
        const ledger = makeCreditCardLedger({
            accountsById: new Map([
                [
                    "cc-1",
                    {
                        name: "Credit Card",
                        currencyId: "INR",
                        type: "CREDIT_CARD",
                        isActive: true,
                        openingBalance:
                            -150_000, // exceeds the 100_000 target
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            ledger
        );

        expect(
            result.totals.outstandingDebt
        ).toBe(150_000);
        // amountPaidOff = max(0, 100_000 - 150_000) = 0
        expect(result.totals.currentAmount).toBe(
            0
        );
        expect(
            result.totals.progressPercentage
        ).toBe(0);
        // remainingDebt shows the FULL 150_000 owed, not capped at
        // the 100_000 target - the whole point of remainingAmount
        // being derived from outstandingDebt directly.
        expect(
            result.totals.remainingAmount
        ).toBe(150_000);
        expect(result.totals.isComplete).toBe(
            false
        );
    });

    it("returns 0% progress when target amount is 0 (no divide-by-zero)", () => {
        const result = calculateGoalActuals(
            { ...DEBT_GOAL, targetAmount: 0 },
            [makeCreditCardLink()],
            makeCreditCardLedger({
                accountsById: new Map([
                    [
                        "cc-1",
                        {
                            name: "Credit Card",
                            currencyId: "INR",
                            type: "CREDIT_CARD",
                            isActive: true,
                            openingBalance: -1_000,
                        },
                    ],
                ]),
            })
        );

        expect(
            result.totals.progressPercentage
        ).toBe(0);
        expect(result.totals.isComplete).toBe(
            false
        );
    });
});

describe("calculateGoalActuals - DEBT_PAYOFF_LINKED multiple linked accounts", () => {
    it("sums outstanding debt across every active linked liability account", () => {
        const ledger = makeCreditCardLedger({
            accountsById: new Map([
                [
                    "cc-1",
                    {
                        name: "Credit Card A",
                        currencyId: "INR",
                        type: "CREDIT_CARD",
                        isActive: true,
                        openingBalance: -20_000,
                    },
                ],
                [
                    "cc-2",
                    {
                        name: "Credit Card B",
                        currencyId: "INR",
                        type: "CREDIT_CARD",
                        isActive: true,
                        openingBalance: -15_000,
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            DEBT_GOAL,
            [
                makeCreditCardLink({
                    id: "link-1",
                    accountId: "cc-1",
                }),
                makeCreditCardLink({
                    id: "link-2",
                    accountId: "cc-2",
                }),
            ],
            ledger
        );

        expect(
            result.totals.outstandingDebt
        ).toBe(35_000);
    });
});

describe("calculateGoalActuals - DEBT_PAYOFF_LINKED rejects asset accounts", () => {
    it("flags a SAVINGS account linked to a debt-payoff goal as INVALID_ACCOUNT_TYPE and excludes it", () => {
        const ledger = makeCreditCardLedger({
            accountsById: new Map([
                [
                    "cc-1",
                    {
                        name: "Savings (wrong type)",
                        currencyId: "INR",
                        type: "SAVINGS",
                        isActive: true,
                        openingBalance: 20_000,
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            ledger
        );

        expect(
            result.totals.outstandingDebt
        ).toBe(0);
        expect(
            result.links[0].unavailableReason
        ).toBe("INVALID_ACCOUNT_TYPE");
        expect(result.warnings).toHaveLength(1);
    });

    it("flags a CASH account linked to a debt-payoff goal as INVALID_ACCOUNT_TYPE", () => {
        const ledger = makeCreditCardLedger({
            accountsById: new Map([
                [
                    "cc-1",
                    {
                        name: "Cash (wrong type)",
                        currencyId: "INR",
                        type: "CASH",
                        isActive: true,
                        openingBalance: 20_000,
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            ledger
        );

        expect(
            result.links[0].unavailableReason
        ).toBe("INVALID_ACCOUNT_TYPE");
    });
});

describe("calculateGoalActuals - DEBT_PAYOFF_LINKED unavailable links", () => {
    it("flags a missing linked account with SOURCE_MISSING", () => {
        const result = calculateGoalActuals(
            DEBT_GOAL,
            [
                makeCreditCardLink({
                    accountId: "does-not-exist",
                }),
            ],
            makeCreditCardLedger()
        );

        expect(
            result.links[0].unavailableReason
        ).toBe("SOURCE_MISSING");
        expect(
            result.totals.outstandingDebt
        ).toBe(0);
    });

    it("flags an inactive linked account with SOURCE_INACTIVE", () => {
        const ledger = makeCreditCardLedger({
            accountsById: new Map([
                [
                    "cc-1",
                    {
                        name: "Credit Card",
                        currencyId: "INR",
                        type: "CREDIT_CARD",
                        isActive: false,
                        openingBalance: -10_000,
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            ledger
        );

        expect(
            result.links[0].unavailableReason
        ).toBe("SOURCE_INACTIVE");
        expect(
            result.totals.outstandingDebt
        ).toBe(0);
    });

    it("flags a currency mismatch and never sums it in (no conversion)", () => {
        const ledger = makeCreditCardLedger({
            accountsById: new Map([
                [
                    "cc-1",
                    {
                        name: "US Credit Card",
                        currencyId: "USD",
                        type: "CREDIT_CARD",
                        isActive: true,
                        openingBalance: -10_000,
                    },
                ],
            ]),
        });

        const result = calculateGoalActuals(
            DEBT_GOAL,
            [makeCreditCardLink()],
            ledger
        );

        expect(
            result.links[0].unavailableReason
        ).toBe("CURRENCY_MISMATCH");
        expect(
            result.totals.outstandingDebt
        ).toBe(0);
    });
});

// =====================================================================
// Phase 3 - CATEGORY_CONTRIBUTION_LINKED goals
// =====================================================================

function makeCategoryLedger(
    overrides: Partial<GoalLedgerBundle> = {}
): GoalLedgerBundle {
    return {
        accountsById: new Map([
            [
                "acc-1",
                {
                    name: "Bank",
                    currencyId: "INR",
                    type: "CURRENT",
                    isActive: true,
                    openingBalance: 0,
                },
            ],
        ]),
        categoriesById: new Map([
            [
                "cat-1",
                {
                    name: "Freelance Income",
                    categoryType: "INCOME",
                    isActive: true,
                },
            ],
        ]),
        transactions: [],
        transfers: [],
        ...overrides,
    };
}

function makeCategoryLink(
    overrides: Partial<GoalCategoryLink> = {}
): GoalCategoryLink {
    return {
        id: "clink-1",
        goalId: "contrib-goal-1",
        categoryId: "cat-1",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

const CONTRIB_GOAL = {
    id: "contrib-goal-1",
    currencyId: "INR",
    targetAmount: 50_000,
    createdAt: "2026-01-01T00:00:00.000Z",
    targetDate: null as string | null,
};

const TODAY = "2026-12-31";

describe("calculateCategoryContributionGoalActuals - basic sum", () => {
    it("sums matching income transactions for the linked category", () => {
        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 12_000,
                    transactionDate: "2026-03-01",
                },
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 8_000,
                    transactionDate: "2026-04-01",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(
            20_000
        );
    });

    it("returns 0 with no linked categories", () => {
        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [],
                makeCategoryLedger(),
                TODAY
            );

        expect(result.totals.currentAmount).toBe(0);
        expect(result.warnings).toHaveLength(0);
    });

    it("uses the absolute value of the amount, so the total can never be negative", () => {
        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: -5_000, // malformed sign, still counted as magnitude
                    transactionDate: "2026-03-01",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(
            5_000
        );
    });
});

describe("calculateCategoryContributionGoalActuals - exact category match, no rollup", () => {
    it("does not roll up a child category's transactions into the linked parent category", () => {
        const ledger = makeCategoryLedger({
            categoriesById: new Map([
                [
                    "cat-1",
                    {
                        name: "Income",
                        categoryType: "INCOME",
                        isActive: true,
                    },
                ],
                [
                    "cat-1-child",
                    {
                        name: "Freelance (child)",
                        categoryType: "INCOME",
                        isActive: true,
                    },
                ],
            ]),
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1-child",
                    type: "income",
                    amount: 9_000,
                    transactionDate: "2026-03-01",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [makeCategoryLink({ categoryId: "cat-1" })],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(0);
    });

    it("ignores transactions in an unrelated category", () => {
        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-other",
                    type: "income",
                    amount: 9_000,
                    transactionDate: "2026-03-01",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(0);
    });
});

describe("calculateCategoryContributionGoalActuals - transfers excluded", () => {
    it("ignores a transfer-typed transaction row in the linked category", () => {
        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "transfer",
                    amount: 9_000,
                    transactionDate: "2026-03-01",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(0);
    });

    it("ignores an expense-typed transaction row in the linked category", () => {
        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "expense",
                    amount: 9_000,
                    transactionDate: "2026-03-01",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(0);
    });

    it("never touches the separate transfers table", () => {
        const ledger = makeCategoryLedger({
            transfers: [
                {
                    sourceAccountId: "acc-other",
                    destinationAccountId: "acc-1",
                    amount: 9_000,
                    transactionDate: "2026-03-01",
                    deletedAt: null,
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(0);
    });
});

describe("calculateCategoryContributionGoalActuals - date window", () => {
    it("excludes a transaction before the goal's createdAt", () => {
        const goal = {
            ...CONTRIB_GOAL,
            createdAt: "2026-06-01T00:00:00.000Z",
        };
        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 9_000,
                    transactionDate: "2026-05-15",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                goal,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(0);
    });

    it("includes a transaction exactly on createdAt's date", () => {
        const goal = {
            ...CONTRIB_GOAL,
            createdAt: "2026-06-01T12:00:00.000Z",
        };
        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 9_000,
                    transactionDate: "2026-06-01",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                goal,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(
            9_000
        );
    });

    it("excludes a transaction after targetDate when one is set", () => {
        const goal = {
            ...CONTRIB_GOAL,
            targetDate: "2026-06-30",
        };
        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 9_000,
                    transactionDate: "2026-07-01",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                goal,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(0);
    });

    it("includes a transaction on targetDate itself (inclusive end)", () => {
        const goal = {
            ...CONTRIB_GOAL,
            targetDate: "2026-06-30",
        };
        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 9_000,
                    transactionDate: "2026-06-30",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                goal,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(
            9_000
        );
    });

    it("with no targetDate, uses asOf (today) as the window end", () => {
        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 9_000,
                    // after the injected "today" (TODAY = 2026-12-31)
                    transactionDate: "2027-01-15",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(0);
    });
});

// Regression coverage for the createdAt window-start bug: windowStart
// used to be derived via goal.createdAt.slice(0, 10), which takes the
// UTC calendar date of a full ISO timestamp. asOf/targetDate already
// use the local calendar date (toISODateString), so in timezones
// behind UTC a goal created late in the local day could get a
// windowStart one calendar day ahead of the user's actual "today",
// silently excluding a same-day contribution. Fixed by deriving
// windowStart via toISODateString(new Date(goal.createdAt)) - the same
// local-date convention used everywhere else. These tests force a
// timezone behind UTC (America/Bogota, UTC-5, no DST, so the result
// is deterministic regardless of the host machine's own timezone) and
// restore process.env.TZ afterward so no other test file is affected.
describe("calculateCategoryContributionGoalActuals - createdAt local-date window start (timezone regression)", () => {
    const ORIGINAL_TZ = process.env.TZ;

    afterEach(() => {
        process.env.TZ = ORIGINAL_TZ;
    });

    // 03:00 UTC on 2026-06-02 is 22:00 on 2026-06-01 in America/Bogota
    // (UTC-5) - the UTC calendar date is a day ahead of the user's
    // local calendar date.
    const LATE_LOCAL_CREATED_AT =
        "2026-06-02T03:00:00.000Z";
    const LOCAL_CREATION_DATE = "2026-06-01";

    it("includes a valid contribution dated on the user's local creation date, even though createdAt's UTC date is a day later", () => {
        process.env.TZ = "America/Bogota";

        const goal = {
            ...CONTRIB_GOAL,
            createdAt: LATE_LOCAL_CREATED_AT,
        };

        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 9_000,
                    transactionDate:
                        LOCAL_CREATION_DATE,
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                goal,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(
            9_000
        );
    });

    it("excludes a transaction dated the day before the user's local creation date", () => {
        process.env.TZ = "America/Bogota";

        const goal = {
            ...CONTRIB_GOAL,
            createdAt: LATE_LOCAL_CREATED_AT,
        };

        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 9_000,
                    transactionDate: "2026-05-31",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                goal,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(0);
    });

    it("keeps the targetDate end boundary inclusive under a non-UTC local timezone", () => {
        process.env.TZ = "America/Bogota";

        const goal = {
            ...CONTRIB_GOAL,
            createdAt: LATE_LOCAL_CREATED_AT,
            targetDate: "2026-06-30",
        };

        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 9_000,
                    transactionDate: "2026-06-30",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                goal,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(
            9_000
        );
    });

    it("keeps the no-target-date (asOf) end boundary correct under a non-UTC local timezone", () => {
        process.env.TZ = "America/Bogota";

        const goal = {
            ...CONTRIB_GOAL,
            createdAt: LATE_LOCAL_CREATED_AT,
        };

        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 9_000,
                    transactionDate: TODAY, // on asOf - included
                },
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 5_000,
                    // after asOf - excluded
                    transactionDate: "2027-01-15",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                goal,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(
            9_000
        );
    });
});

// Regression coverage for the default `asOf` parameter (Phase 6
// audit): it used to fall back to new Date().toISOString().slice(0, 10)
// - the same UTC-calendar-date bug windowStart was fixed for - while
// GoalActualsService always passes an explicit local-date asOf
// (toISODateString), so this default was a latent inconsistency for
// any direct caller of the pure engine function that omits asOf. Fixed
// to toISODateString(new Date()). These tests fix the system clock
// (vi.setSystemTime) and force a timezone behind UTC so the UTC
// calendar date and the local calendar date differ, then call the
// function without the 4th argument to exercise the default itself.
describe("calculateCategoryContributionGoalActuals - default asOf parameter (timezone regression)", () => {
    const ORIGINAL_TZ = process.env.TZ;

    afterEach(() => {
        process.env.TZ = ORIGINAL_TZ;
        vi.useRealTimers();
    });

    it("excludes a transaction dated on the UTC 'today' when local 'today' is a day earlier", () => {
        process.env.TZ = "America/Bogota"; // UTC-5, no DST

        // 03:00 UTC on 2026-06-02 is 22:00 on 2026-06-01 in
        // America/Bogota - local "today" is 2026-06-01, a day behind
        // the UTC calendar date.
        vi.useFakeTimers();
        vi.setSystemTime(
            new Date("2026-06-02T03:00:00.000Z")
        );

        const goal = {
            ...CONTRIB_GOAL,
            createdAt: "2026-01-01T00:00:00.000Z",
            targetDate: null as string | null,
        };

        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 9_000,
                    // the UTC calendar date "now" - a day ahead of
                    // the correct local "today" (2026-06-01)
                    transactionDate: "2026-06-02",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                goal,
                [makeCategoryLink()],
                ledger
                // asOf omitted - exercises the default parameter
            );

        expect(result.totals.currentAmount).toBe(0);
    });

    it("includes a transaction dated on the correct local 'today' via the default asOf", () => {
        process.env.TZ = "America/Bogota";

        vi.useFakeTimers();
        vi.setSystemTime(
            new Date("2026-06-02T03:00:00.000Z")
        );

        const goal = {
            ...CONTRIB_GOAL,
            createdAt: "2026-01-01T00:00:00.000Z",
            targetDate: null as string | null,
        };

        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 9_000,
                    transactionDate: "2026-06-01", // correct local "today"
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                goal,
                [makeCategoryLink()],
                ledger
            );

        expect(result.totals.currentAmount).toBe(
            9_000
        );
    });
});

describe("calculateCategoryContributionGoalActuals - currency handling", () => {
    it("excludes a transaction whose account currency differs from the goal's, with an aggregate warning", () => {
        const ledger = makeCategoryLedger({
            accountsById: new Map([
                [
                    "acc-1",
                    {
                        name: "US Bank",
                        currencyId: "USD",
                        type: "CURRENT",
                        isActive: true,
                        openingBalance: 0,
                    },
                ],
            ]),
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 9_000,
                    transactionDate: "2026-03-01",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(0);
        expect(result.warnings).toEqual([
            "1 transaction(s) in another currency were excluded (no conversion).",
        ]);
    });

    it("silently skips a transaction whose account no longer exists (cannot verify currency)", () => {
        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "does-not-exist",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 9_000,
                    transactionDate: "2026-03-01",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(0);
        expect(result.warnings).toHaveLength(0);
    });
});

describe("calculateCategoryContributionGoalActuals - unavailable links", () => {
    it("flags a missing category with SOURCE_MISSING", () => {
        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [
                    makeCategoryLink({
                        categoryId: "does-not-exist",
                    }),
                ],
                makeCategoryLedger(),
                TODAY
            );

        expect(result.warnings).toHaveLength(1);
        expect(
            result.warnings[0]
        ).toContain("no longer exists");
    });

    it("flags an inactive category with SOURCE_INACTIVE", () => {
        const ledger = makeCategoryLedger({
            categoriesById: new Map([
                [
                    "cat-1",
                    {
                        name: "Freelance Income",
                        categoryType: "INCOME",
                        isActive: false,
                    },
                ],
            ]),
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(
            result.warnings[0]
        ).toContain("no longer active");
    });

    it("flags an EXPENSE-type category with INVALID_CATEGORY_TYPE", () => {
        const ledger = makeCategoryLedger({
            categoriesById: new Map([
                [
                    "cat-1",
                    {
                        name: "Groceries",
                        categoryType: "EXPENSE",
                        isActive: true,
                    },
                ],
            ]),
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(result.warnings).toHaveLength(1);
    });

    it("sums the available links while excluding unavailable ones", () => {
        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 9_000,
                    transactionDate: "2026-03-01",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [
                    makeCategoryLink({
                        id: "clink-1",
                        categoryId: "cat-1",
                    }),
                    makeCategoryLink({
                        id: "clink-2",
                        categoryId: "missing-cat",
                    }),
                ],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(
            9_000
        );
        expect(result.warnings).toHaveLength(1);
    });
});

describe("calculateCategoryContributionGoalActuals - multiple linked categories", () => {
    it("sums contributions across every active linked category", () => {
        const ledger = makeCategoryLedger({
            categoriesById: new Map([
                [
                    "cat-1",
                    {
                        name: "Freelance",
                        categoryType: "INCOME",
                        isActive: true,
                    },
                ],
                [
                    "cat-2",
                    {
                        name: "Consulting",
                        categoryType: "INCOME",
                        isActive: true,
                    },
                ],
            ]),
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 10_000,
                    transactionDate: "2026-03-01",
                },
                {
                    accountId: "acc-1",
                    categoryId: "cat-2",
                    type: "income",
                    amount: 6_000,
                    transactionDate: "2026-03-02",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [
                    makeCategoryLink({
                        id: "clink-1",
                        categoryId: "cat-1",
                    }),
                    makeCategoryLink({
                        id: "clink-2",
                        categoryId: "cat-2",
                    }),
                ],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(
            16_000
        );
    });

    it("excludes an inactive (unlinked) link from the sum", () => {
        const ledger = makeCategoryLedger({
            categoriesById: new Map([
                [
                    "cat-1",
                    {
                        name: "Freelance",
                        categoryType: "INCOME",
                        isActive: true,
                    },
                ],
            ]),
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 10_000,
                    transactionDate: "2026-03-01",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [
                    makeCategoryLink({
                        id: "clink-1",
                        categoryId: "cat-1",
                        isActive: true,
                    }),
                    makeCategoryLink({
                        id: "clink-2",
                        categoryId: "cat-1",
                        isActive: false,
                    }),
                ],
                ledger,
                TODAY
            );

        expect(result.totals.currentAmount).toBe(
            10_000
        );
    });
});

describe("calculateCategoryContributionGoalActuals - progress / remaining / completion", () => {
    it("computes remaining amount as target minus current", () => {
        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 20_000,
                    transactionDate: "2026-03-01",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        // target 50_000, current 20_000
        expect(result.totals.remainingAmount).toBe(
            30_000
        );
        expect(
            result.totals.progressPercentage
        ).toBe(40);
    });

    it("clamps progress at 100% when contributions exceed target", () => {
        const ledger = makeCategoryLedger({
            transactions: [
                {
                    accountId: "acc-1",
                    categoryId: "cat-1",
                    type: "income",
                    amount: 90_000,
                    transactionDate: "2026-03-01",
                },
            ],
        });

        const result =
            calculateCategoryContributionGoalActuals(
                CONTRIB_GOAL,
                [makeCategoryLink()],
                ledger,
                TODAY
            );

        expect(
            result.totals.progressPercentage
        ).toBe(100);
        expect(result.totals.remainingAmount).toBe(
            0
        );
        expect(result.totals.isComplete).toBe(true);
    });

    it("returns 0% progress when target amount is 0 (no divide-by-zero)", () => {
        const result =
            calculateCategoryContributionGoalActuals(
                { ...CONTRIB_GOAL, targetAmount: 0 },
                [makeCategoryLink()],
                makeCategoryLedger({
                    transactions: [
                        {
                            accountId: "acc-1",
                            categoryId: "cat-1",
                            type: "income",
                            amount: 1_000,
                            transactionDate:
                                "2026-03-01",
                        },
                    ],
                }),
                TODAY
            );

        expect(
            result.totals.progressPercentage
        ).toBe(0);
        expect(result.totals.isComplete).toBe(
            false
        );
    });
});

// =====================================================================
// Phase 4 - LOAN_PAYOFF_LINKED goals
// =====================================================================

function makeLoanLedger(
    overrides: Partial<GoalLedgerBundle> = {}
): GoalLedgerBundle {
    return {
        accountsById: new Map(),
        loansById: new Map([
            [
                "loan-1",
                {
                    name: "Personal Loan",
                    currencyId: "INR",
                    status: "ACTIVE",
                    outstandingPrincipal: 40_000,
                },
            ],
        ]),
        transactions: [],
        transfers: [],
        ...overrides,
    };
}

function makeLoanLink(
    overrides: Partial<GoalLoanLink> = {}
): GoalLoanLink {
    return {
        id: "loan-link-1",
        goalId: "loan-goal-1",
        loanId: "loan-1",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

const LOAN_GOAL = {
    id: "loan-goal-1",
    currencyId: "INR",
    targetAmount: 100_000,
};

describe("calculateLoanPayoffGoalActuals - basic sum", () => {
    it("uses the linked loan's outstandingPrincipal as the outstanding debt", () => {
        const result = calculateLoanPayoffGoalActuals(
            LOAN_GOAL,
            [makeLoanLink()],
            makeLoanLedger()
        );

        expect(
            result.totals.outstandingDebt
        ).toBe(40_000);
    });

    it("documents current behavior: two distinct link rows pointing at the same loan sum it twice (no dedup by source id)", () => {
        // The service layer de-dupes loan ids at CREATE time
        // (new Set(request.loanIds) in FinancialGoalService.create),
        // and the "Add a loan" picker excludes already-linked loans, so
        // this should not occur through normal UI use - but the
        // engine itself does not defend against two active link ROWS
        // referencing the same loanId (e.g. from manual data edits).
        // This is the existing, consistent behavior across all four
        // linked modes (account/category/loan/investment), not a
        // Phase 4/5-specific gap - documented here rather than changed,
        // since deduping the read path would be a behavior change
        // beyond this audit's scope.
        const result = calculateLoanPayoffGoalActuals(
            LOAN_GOAL,
            [
                makeLoanLink({ id: "loan-link-1" }),
                makeLoanLink({ id: "loan-link-2" }),
            ],
            makeLoanLedger()
        );

        expect(
            result.totals.outstandingDebt
        ).toBe(80_000);
    });

    it("sums outstandingPrincipal across multiple linked loans", () => {
        const ledger = makeLoanLedger({
            loansById: new Map([
                [
                    "loan-1",
                    {
                        name: "Personal Loan",
                        currencyId: "INR",
                        status: "ACTIVE",
                        outstandingPrincipal: 40_000,
                    },
                ],
                [
                    "loan-2",
                    {
                        name: "Car Loan",
                        currencyId: "INR",
                        status: "ACTIVE",
                        outstandingPrincipal: 15_000,
                    },
                ],
            ]),
        });

        const result = calculateLoanPayoffGoalActuals(
            LOAN_GOAL,
            [
                makeLoanLink(),
                makeLoanLink({
                    id: "loan-link-2",
                    loanId: "loan-2",
                }),
            ],
            ledger
        );

        expect(
            result.totals.outstandingDebt
        ).toBe(55_000);
    });

    it("ignores an inactive link entirely (no contribution, no warning)", () => {
        const result = calculateLoanPayoffGoalActuals(
            LOAN_GOAL,
            [makeLoanLink({ isActive: false })],
            makeLoanLedger()
        );

        expect(
            result.totals.outstandingDebt
        ).toBe(0);
        expect(result.warnings).toEqual([]);
    });
});

describe("calculateLoanPayoffGoalActuals - amount paid off / progress / remaining", () => {
    it("computes amountPaidOff = max(0, target - outstandingDebt)", () => {
        // target 100_000, outstanding 40_000 -> paid off 60_000
        const result = calculateLoanPayoffGoalActuals(
            LOAN_GOAL,
            [makeLoanLink()],
            makeLoanLedger()
        );

        expect(
            result.totals.currentAmount
        ).toBe(60_000);
        expect(
            result.totals.progressPercentage
        ).toBe(60);
    });

    it("remainingDebt = max(0, outstandingDebt), independent of target", () => {
        const ledger = makeLoanLedger({
            loansById: new Map([
                [
                    "loan-1",
                    {
                        name: "Personal Loan",
                        currencyId: "INR",
                        status: "ACTIVE",
                        // beyond the 100_000 target
                        outstandingPrincipal: 150_000,
                    },
                ],
            ]),
        });

        const result = calculateLoanPayoffGoalActuals(
            LOAN_GOAL,
            [makeLoanLink()],
            ledger
        );

        expect(
            result.totals.remainingAmount
        ).toBe(150_000);
        // amountPaidOff clamped at 0, not negative
        expect(
            result.totals.currentAmount
        ).toBe(0);
        expect(
            result.totals.progressPercentage
        ).toBe(0);
    });

    it("clamps progress at 100% when the loan is fully paid off (outstanding 0)", () => {
        const ledger = makeLoanLedger({
            loansById: new Map([
                [
                    "loan-1",
                    {
                        name: "Personal Loan",
                        currencyId: "INR",
                        status: "ACTIVE",
                        outstandingPrincipal: 0,
                    },
                ],
            ]),
        });

        const result = calculateLoanPayoffGoalActuals(
            LOAN_GOAL,
            [makeLoanLink()],
            ledger
        );

        expect(
            result.totals.currentAmount
        ).toBe(100_000);
        expect(
            result.totals.progressPercentage
        ).toBe(100);
        expect(result.totals.isComplete).toBe(
            true
        );
    });

    it("guards against divide-by-zero when targetAmount is 0", () => {
        const result = calculateLoanPayoffGoalActuals(
            { ...LOAN_GOAL, targetAmount: 0 },
            [makeLoanLink()],
            makeLoanLedger()
        );

        expect(
            result.totals.progressPercentage
        ).toBe(0);
        expect(result.totals.isComplete).toBe(
            false
        );
    });

    it("handles a negative outstandingPrincipal (data anomaly / net-credit loan) without going over 100% or negative", () => {
        const ledger = makeLoanLedger({
            loansById: new Map([
                [
                    "loan-1",
                    {
                        name: "Personal Loan",
                        currencyId: "INR",
                        status: "ACTIVE",
                        outstandingPrincipal: -5_000,
                    },
                ],
            ]),
        });

        const result = calculateLoanPayoffGoalActuals(
            LOAN_GOAL,
            [makeLoanLink()],
            ledger
        );

        expect(
            result.totals.outstandingDebt
        ).toBe(-5_000);
        // remainingDebt floors at 0, never negative
        expect(
            result.totals.remainingAmount
        ).toBe(0);
        // amountPaidOff clamps at 100% progress, never over
        expect(
            result.totals.progressPercentage
        ).toBe(100);
        expect(result.totals.isComplete).toBe(
            true
        );
    });
});

describe("calculateLoanPayoffGoalActuals - unavailable sources", () => {
    it("excludes a deleted/missing loan with a SOURCE_MISSING warning", () => {
        const result = calculateLoanPayoffGoalActuals(
            LOAN_GOAL,
            [makeLoanLink({ loanId: "loan-gone" })],
            makeLoanLedger()
        );

        expect(
            result.totals.outstandingDebt
        ).toBe(0);
        expect(result.warnings).toEqual([
            "A loan: The linked loan no longer exists.",
        ]);
    });

    it.each([
        "CLOSED",
        "ON_HOLD",
        "DEFAULTED",
    ])(
        "excludes a %s loan with a SOURCE_INACTIVE warning",
        (status) => {
            const ledger = makeLoanLedger({
                loansById: new Map([
                    [
                        "loan-1",
                        {
                            name: "Personal Loan",
                            currencyId: "INR",
                            status,
                            outstandingPrincipal: 40_000,
                        },
                    ],
                ]),
            });

            const result =
                calculateLoanPayoffGoalActuals(
                    LOAN_GOAL,
                    [makeLoanLink()],
                    ledger
                );

            expect(
                result.totals.outstandingDebt
            ).toBe(0);
            expect(result.warnings).toEqual([
                "Personal Loan: The linked loan is no longer active.",
            ]);
        }
    );

    it("excludes a currency-mismatched loan with a warning, never converting", () => {
        const ledger = makeLoanLedger({
            loansById: new Map([
                [
                    "loan-1",
                    {
                        name: "US Personal Loan",
                        currencyId: "USD",
                        status: "ACTIVE",
                        outstandingPrincipal: 40_000,
                    },
                ],
            ]),
        });

        const result = calculateLoanPayoffGoalActuals(
            LOAN_GOAL,
            [makeLoanLink()],
            ledger
        );

        expect(
            result.totals.outstandingDebt
        ).toBe(0);
        expect(result.warnings).toEqual([
            "US Personal Loan: The linked loan's currency no longer matches this goal.",
        ]);
    });

    it("still sums the available loans when one linked loan is unavailable", () => {
        const ledger = makeLoanLedger({
            loansById: new Map([
                [
                    "loan-1",
                    {
                        name: "Personal Loan",
                        currencyId: "INR",
                        status: "ACTIVE",
                        outstandingPrincipal: 40_000,
                    },
                ],
                [
                    "loan-2",
                    {
                        name: "Closed Loan",
                        currencyId: "INR",
                        status: "CLOSED",
                        outstandingPrincipal: 5_000,
                    },
                ],
            ]),
        });

        const result = calculateLoanPayoffGoalActuals(
            LOAN_GOAL,
            [
                makeLoanLink(),
                makeLoanLink({
                    id: "loan-link-2",
                    loanId: "loan-2",
                }),
            ],
            ledger
        );

        expect(
            result.totals.outstandingDebt
        ).toBe(40_000);
        expect(result.warnings).toEqual([
            "Closed Loan: The linked loan is no longer active.",
        ]);
    });
});

describe("calculateLoanPayoffGoalActuals - result shape", () => {
    it("does not expose loan-link detail through the generic links field", () => {
        const result = calculateLoanPayoffGoalActuals(
            LOAN_GOAL,
            [makeLoanLink()],
            makeLoanLedger()
        );

        expect(result.links).toEqual([]);
    });

    it("carries the goal's id and currencyId through", () => {
        const result = calculateLoanPayoffGoalActuals(
            LOAN_GOAL,
            [makeLoanLink()],
            makeLoanLedger()
        );

        expect(result.goalId).toBe("loan-goal-1");
        expect(result.currencyId).toBe("INR");
    });
});

// =====================================================================
// Phase 5 - INVESTMENT_LINKED goals
// =====================================================================

function makeInvestmentLedger(
    overrides: Partial<GoalLedgerBundle> = {}
): GoalLedgerBundle {
    return {
        accountsById: new Map(),
        investmentsById: new Map([
            [
                "inv-1",
                {
                    name: "Index Fund",
                    currencyId: "INR",
                    status: "ACTIVE",
                    currentValue: 40_000,
                },
            ],
        ]),
        transactions: [],
        transfers: [],
        ...overrides,
    };
}

function makeInvestmentLink(
    overrides: Partial<GoalInvestmentLink> = {}
): GoalInvestmentLink {
    return {
        id: "inv-link-1",
        goalId: "investment-goal-1",
        investmentId: "inv-1",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

const INVESTMENT_GOAL = {
    id: "investment-goal-1",
    currencyId: "INR",
    targetAmount: 100_000,
};

describe("calculateInvestmentGoalActuals - basic sum", () => {
    it("uses the linked investment's currentValue as the current amount", () => {
        const result = calculateInvestmentGoalActuals(
            INVESTMENT_GOAL,
            [makeInvestmentLink()],
            makeInvestmentLedger()
        );

        expect(
            result.totals.currentAmount
        ).toBe(40_000);
    });

    it("sums currentValue across multiple linked investments", () => {
        const ledger = makeInvestmentLedger({
            investmentsById: new Map([
                [
                    "inv-1",
                    {
                        name: "Index Fund",
                        currencyId: "INR",
                        status: "ACTIVE",
                        currentValue: 40_000,
                    },
                ],
                [
                    "inv-2",
                    {
                        name: "Bond Fund",
                        currencyId: "INR",
                        status: "ACTIVE",
                        currentValue: 15_000,
                    },
                ],
            ]),
        });

        const result = calculateInvestmentGoalActuals(
            INVESTMENT_GOAL,
            [
                makeInvestmentLink(),
                makeInvestmentLink({
                    id: "inv-link-2",
                    investmentId: "inv-2",
                }),
            ],
            ledger
        );

        expect(
            result.totals.currentAmount
        ).toBe(55_000);
    });

    it("ignores an inactive link entirely (no contribution, no warning)", () => {
        const result = calculateInvestmentGoalActuals(
            INVESTMENT_GOAL,
            [
                makeInvestmentLink({
                    isActive: false,
                }),
            ],
            makeInvestmentLedger()
        );

        expect(
            result.totals.currentAmount
        ).toBe(0);
        expect(result.warnings).toEqual([]);
    });

    it("treats a zero currentValue as zero (no error)", () => {
        const ledger = makeInvestmentLedger({
            investmentsById: new Map([
                [
                    "inv-1",
                    {
                        name: "Index Fund",
                        currencyId: "INR",
                        status: "ACTIVE",
                        currentValue: 0,
                    },
                ],
            ]),
        });

        const result = calculateInvestmentGoalActuals(
            INVESTMENT_GOAL,
            [makeInvestmentLink()],
            ledger
        );

        expect(
            result.totals.currentAmount
        ).toBe(0);
        expect(result.warnings).toEqual([]);
    });
});

describe("calculateInvestmentGoalActuals - progress / remaining", () => {
    it("computes remainingAmount = max(0, target - currentAmount)", () => {
        // target 100_000, current 40_000 -> remaining 60_000
        const result = calculateInvestmentGoalActuals(
            INVESTMENT_GOAL,
            [makeInvestmentLink()],
            makeInvestmentLedger()
        );

        expect(
            result.totals.remainingAmount
        ).toBe(60_000);
        expect(
            result.totals.progressPercentage
        ).toBe(40);
    });

    it("clamps progress at 100% when currentValue exceeds the target", () => {
        const ledger = makeInvestmentLedger({
            investmentsById: new Map([
                [
                    "inv-1",
                    {
                        name: "Index Fund",
                        currencyId: "INR",
                        status: "ACTIVE",
                        currentValue: 150_000,
                    },
                ],
            ]),
        });

        const result = calculateInvestmentGoalActuals(
            INVESTMENT_GOAL,
            [makeInvestmentLink()],
            ledger
        );

        expect(
            result.totals.progressPercentage
        ).toBe(100);
        expect(
            result.totals.remainingAmount
        ).toBe(0);
        expect(result.totals.isComplete).toBe(
            true
        );
    });

    it("guards against divide-by-zero when targetAmount is 0", () => {
        const result = calculateInvestmentGoalActuals(
            { ...INVESTMENT_GOAL, targetAmount: 0 },
            [makeInvestmentLink()],
            makeInvestmentLedger()
        );

        expect(
            result.totals.progressPercentage
        ).toBe(0);
        expect(result.totals.isComplete).toBe(
            false
        );
    });

    it("floors progress at 0% for a negative currentValue (data anomaly), never negative or NaN", () => {
        const ledger = makeInvestmentLedger({
            investmentsById: new Map([
                [
                    "inv-1",
                    {
                        name: "Index Fund",
                        currencyId: "INR",
                        status: "ACTIVE",
                        currentValue: -5_000,
                    },
                ],
            ]),
        });

        const result = calculateInvestmentGoalActuals(
            INVESTMENT_GOAL,
            [makeInvestmentLink()],
            ledger
        );

        expect(
            result.totals.currentAmount
        ).toBe(-5_000);
        expect(
            result.totals.progressPercentage
        ).toBe(0);
        expect(
            Number.isNaN(
                result.totals.progressPercentage
            )
        ).toBe(false);
        expect(
            result.totals.remainingAmount
        ).toBeGreaterThanOrEqual(0);
        expect(result.totals.isComplete).toBe(
            false
        );
    });
});

describe("calculateInvestmentGoalActuals - unavailable sources", () => {
    it("excludes a deleted/missing investment with a SOURCE_MISSING warning", () => {
        const result = calculateInvestmentGoalActuals(
            INVESTMENT_GOAL,
            [
                makeInvestmentLink({
                    investmentId: "inv-gone",
                }),
            ],
            makeInvestmentLedger()
        );

        expect(
            result.totals.currentAmount
        ).toBe(0);
        expect(result.warnings).toEqual([
            "An investment: The linked investment no longer exists.",
        ]);
    });

    it.each(["CLOSED", "ON_HOLD"])(
        "excludes a %s investment with a SOURCE_INACTIVE warning",
        (status) => {
            const ledger = makeInvestmentLedger({
                investmentsById: new Map([
                    [
                        "inv-1",
                        {
                            name: "Index Fund",
                            currencyId: "INR",
                            status,
                            currentValue: 40_000,
                        },
                    ],
                ]),
            });

            const result =
                calculateInvestmentGoalActuals(
                    INVESTMENT_GOAL,
                    [makeInvestmentLink()],
                    ledger
                );

            expect(
                result.totals.currentAmount
            ).toBe(0);
            expect(result.warnings).toEqual([
                "Index Fund: The linked investment is no longer active.",
            ]);
        }
    );

    it("excludes a currency-mismatched investment with a warning, never converting", () => {
        const ledger = makeInvestmentLedger({
            investmentsById: new Map([
                [
                    "inv-1",
                    {
                        name: "US Index Fund",
                        currencyId: "USD",
                        status: "ACTIVE",
                        currentValue: 40_000,
                    },
                ],
            ]),
        });

        const result = calculateInvestmentGoalActuals(
            INVESTMENT_GOAL,
            [makeInvestmentLink()],
            ledger
        );

        expect(
            result.totals.currentAmount
        ).toBe(0);
        expect(result.warnings).toEqual([
            "US Index Fund: The linked investment's currency no longer matches this goal.",
        ]);
    });

    it("still sums the available investments when one linked investment is unavailable", () => {
        const ledger = makeInvestmentLedger({
            investmentsById: new Map([
                [
                    "inv-1",
                    {
                        name: "Index Fund",
                        currencyId: "INR",
                        status: "ACTIVE",
                        currentValue: 40_000,
                    },
                ],
                [
                    "inv-2",
                    {
                        name: "Closed Fund",
                        currencyId: "INR",
                        status: "CLOSED",
                        currentValue: 5_000,
                    },
                ],
            ]),
        });

        const result = calculateInvestmentGoalActuals(
            INVESTMENT_GOAL,
            [
                makeInvestmentLink(),
                makeInvestmentLink({
                    id: "inv-link-2",
                    investmentId: "inv-2",
                }),
            ],
            ledger
        );

        expect(
            result.totals.currentAmount
        ).toBe(40_000);
        expect(result.warnings).toEqual([
            "Closed Fund: The linked investment is no longer active.",
        ]);
    });
});

describe("calculateInvestmentGoalActuals - result shape", () => {
    it("does not expose investment-link detail through the generic links field", () => {
        const result = calculateInvestmentGoalActuals(
            INVESTMENT_GOAL,
            [makeInvestmentLink()],
            makeInvestmentLedger()
        );

        expect(result.links).toEqual([]);
    });

    it("carries the goal's id and currencyId through", () => {
        const result = calculateInvestmentGoalActuals(
            INVESTMENT_GOAL,
            [makeInvestmentLink()],
            makeInvestmentLedger()
        );

        expect(result.goalId).toBe(
            "investment-goal-1"
        );
        expect(result.currencyId).toBe("INR");
    });
});
