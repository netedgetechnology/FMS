import { describe, expect, it, vi } from "vitest";

import type { FinancialGoal } from "../types/FinancialGoal";
import type { CreateFinancialGoalRequest } from "../types/CreateFinancialGoalRequest";

import { FinancialGoalService } from "./FinancialGoalService";

function createRequest(
    over: Partial<CreateFinancialGoalRequest> = {}
): CreateFinancialGoalRequest {
    return {
        name: "Emergency Fund",
        goalType: "EMERGENCY_FUND",
        goalCategory: "CORE_PERSONAL_FINANCE",
        goalSubcategory: "EMERGENCY_FUND",
        targetAmount: 100_000,
        currencyId: "INR",
        priority: 0,
        status: "ACTIVE",
        ...over,
    };
}

// FinancialGoalService news up live repositories internally, each
// talking to a real Tauri SQLite connection unavailable here. Following
// GoalActualsService.test.ts's pattern, each is replaced with an
// in-memory fake via Object.defineProperty.
function build() {
    const service = new FinancialGoalService();

    const created: FinancialGoal[] = [];
    const createdLinks: Array<{
        id: string;
        goalId: string;
        accountId: string;
    }> = [];
    const createdCategoryLinks: Array<{
        id: string;
        goalId: string;
        categoryId: string;
    }> = [];
    const createdLoanLinks: Array<{
        id: string;
        goalId: string;
        loanId: string;
    }> = [];
    const createdInvestmentLinks: Array<{
        id: string;
        goalId: string;
        investmentId: string;
    }> = [];
    const deletedGoalIds: string[] = [];
    const softDeletedByGoalIds: string[] = [];
    const categorySoftDeletedByGoalIds: string[] = [];
    const loanSoftDeletedByGoalIds: string[] = [];
    const investmentSoftDeletedByGoalIds: string[] =
        [];

    const goalCreate = vi.fn(
        async (goal: FinancialGoal) => {
            created.push(goal);
        }
    );
    const goalDelete = vi.fn(
        async (id: string) => {
            deletedGoalIds.push(id);
        }
    );
    const linkCreate = vi.fn(
        async (link: {
            id: string;
            goalId: string;
            accountId: string;
        }) => {
            createdLinks.push(link);
        }
    );
    const linkSoftDeleteByGoal = vi.fn(
        async (goalId: string) => {
            softDeletedByGoalIds.push(goalId);
        }
    );
    const categoryLinkCreate = vi.fn(
        async (link: {
            id: string;
            goalId: string;
            categoryId: string;
        }) => {
            createdCategoryLinks.push(link);
        }
    );
    const categoryLinkSoftDeleteByGoal = vi.fn(
        async (goalId: string) => {
            categorySoftDeletedByGoalIds.push(goalId);
        }
    );
    const loanLinkCreate = vi.fn(
        async (link: {
            id: string;
            goalId: string;
            loanId: string;
        }) => {
            createdLoanLinks.push(link);
        }
    );
    const loanLinkSoftDeleteByGoal = vi.fn(
        async (goalId: string) => {
            loanSoftDeletedByGoalIds.push(goalId);
        }
    );
    const investmentLinkCreate = vi.fn(
        async (link: {
            id: string;
            goalId: string;
            investmentId: string;
        }) => {
            createdInvestmentLinks.push(link);
        }
    );
    const investmentLinkSoftDeleteByGoal = vi.fn(
        async (goalId: string) => {
            investmentSoftDeletedByGoalIds.push(
                goalId
            );
        }
    );

    const set = (prop: string, value: unknown) =>
        Object.defineProperty(service, prop, {
            value,
        });

    set("repository", {
        create: goalCreate,
        delete: goalDelete,
        update: vi.fn(async () => {}),
    });
    set("accountLinkRepository", {
        create: linkCreate,
        softDeleteByGoal: linkSoftDeleteByGoal,
    });
    set("categoryLinkRepository", {
        create: categoryLinkCreate,
        softDeleteByGoal:
            categoryLinkSoftDeleteByGoal,
    });
    set("loanLinkRepository", {
        create: loanLinkCreate,
        softDeleteByGoal: loanLinkSoftDeleteByGoal,
    });
    set("investmentLinkRepository", {
        create: investmentLinkCreate,
        softDeleteByGoal:
            investmentLinkSoftDeleteByGoal,
    });

    return {
        service,
        created,
        createdLinks,
        createdCategoryLinks,
        createdLoanLinks,
        createdInvestmentLinks,
        deletedGoalIds,
        softDeletedByGoalIds,
        categorySoftDeletedByGoalIds,
        loanSoftDeletedByGoalIds,
        investmentSoftDeletedByGoalIds,
        spies: {
            goalCreate,
            goalDelete,
            linkCreate,
            categoryLinkCreate,
            loanLinkCreate,
            investmentLinkCreate,
        },
    };
}

describe("FinancialGoalService.create - manual goals (unchanged)", () => {
    it("defaults goalMode to MANUAL and stores the typed current amount", async () => {
        const { service, created, createdLinks } =
            build();

        await service.create(
            createRequest({ currentAmount: 25_000 })
        );

        expect(created[0].goalMode).toBe("MANUAL");
        expect(created[0].currentAmount).toBe(
            25_000
        );
        expect(createdLinks).toHaveLength(0);
    });
});

describe("FinancialGoalService.create - account-linked goals", () => {
    it("stores goalMode ACCOUNT_LINKED with currentAmount forced to 0", async () => {
        const { service, created } = build();

        await service.create(
            createRequest({
                goalMode: "ACCOUNT_LINKED",
                currentAmount: 999, // ignored for linked goals
                accountIds: ["acc-1"],
            })
        );

        expect(created[0].goalMode).toBe(
            "ACCOUNT_LINKED"
        );
        expect(created[0].currentAmount).toBe(0);
    });

    it("creates one account link per requested account id", async () => {
        const { service, createdLinks } = build();

        const goalId = await service.create(
            createRequest({
                goalMode: "ACCOUNT_LINKED",
                accountIds: ["acc-1", "acc-2"],
            })
        );

        expect(
            createdLinks.map(l => l.accountId).sort()
        ).toEqual(["acc-1", "acc-2"]);
        expect(
            createdLinks.every(
                l => l.goalId === goalId
            )
        ).toBe(true);
    });

    it("de-duplicates repeated account ids", async () => {
        const { service, createdLinks } = build();

        await service.create(
            createRequest({
                goalMode: "ACCOUNT_LINKED",
                accountIds: ["acc-1", "acc-1"],
            })
        );

        expect(createdLinks).toHaveLength(1);
    });

    it("rejects an account-linked goal with no accounts selected", async () => {
        const { service } = build();

        await expect(
            service.create(
                createRequest({
                    goalMode: "ACCOUNT_LINKED",
                    accountIds: [],
                })
            )
        ).rejects.toThrow(
            /at least one linked account/i
        );
    });

    it("rejects an account-linked goal with accountIds omitted entirely", async () => {
        const { service } = build();

        await expect(
            service.create(
                createRequest({
                    goalMode: "ACCOUNT_LINKED",
                })
            )
        ).rejects.toThrow(
            /at least one linked account/i
        );
    });
});

describe("FinancialGoalService.create - debt-payoff goals", () => {
    it("stores goalMode DEBT_PAYOFF_LINKED with currentAmount forced to 0", async () => {
        const { service, created } = build();

        await service.create(
            createRequest({
                goalMode: "DEBT_PAYOFF_LINKED",
                currentAmount: 999, // ignored for linked goals
                accountIds: ["cc-1"],
            })
        );

        expect(created[0].goalMode).toBe(
            "DEBT_PAYOFF_LINKED"
        );
        expect(created[0].currentAmount).toBe(0);
    });

    it("creates one account link per requested liability account id", async () => {
        const { service, createdLinks } = build();

        const goalId = await service.create(
            createRequest({
                goalMode: "DEBT_PAYOFF_LINKED",
                accountIds: ["cc-1", "cc-2"],
            })
        );

        expect(
            createdLinks.map(l => l.accountId).sort()
        ).toEqual(["cc-1", "cc-2"]);
        expect(
            createdLinks.every(
                l => l.goalId === goalId
            )
        ).toBe(true);
    });

    it("rejects a debt-payoff goal with no accounts selected", async () => {
        const { service } = build();

        await expect(
            service.create(
                createRequest({
                    goalMode: "DEBT_PAYOFF_LINKED",
                    accountIds: [],
                })
            )
        ).rejects.toThrow(
            /at least one linked account/i
        );
    });
});

describe("FinancialGoalService.create - category-contribution goals", () => {
    it("stores goalMode CATEGORY_CONTRIBUTION_LINKED with currentAmount forced to 0", async () => {
        const { service, created } = build();

        await service.create(
            createRequest({
                goalMode:
                    "CATEGORY_CONTRIBUTION_LINKED",
                currentAmount: 999, // ignored for linked goals
                categoryIds: ["cat-1"],
            })
        );

        expect(created[0].goalMode).toBe(
            "CATEGORY_CONTRIBUTION_LINKED"
        );
        expect(created[0].currentAmount).toBe(0);
    });

    it("creates one category link per requested category id, and no account links", async () => {
        const {
            service,
            createdCategoryLinks,
            createdLinks,
        } = build();

        const goalId = await service.create(
            createRequest({
                goalMode:
                    "CATEGORY_CONTRIBUTION_LINKED",
                categoryIds: ["cat-1", "cat-2"],
            })
        );

        expect(
            createdCategoryLinks
                .map(l => l.categoryId)
                .sort()
        ).toEqual(["cat-1", "cat-2"]);
        expect(
            createdCategoryLinks.every(
                l => l.goalId === goalId
            )
        ).toBe(true);
        expect(createdLinks).toHaveLength(0);
    });

    it("de-duplicates repeated category ids", async () => {
        const { service, createdCategoryLinks } =
            build();

        await service.create(
            createRequest({
                goalMode:
                    "CATEGORY_CONTRIBUTION_LINKED",
                categoryIds: ["cat-1", "cat-1"],
            })
        );

        expect(createdCategoryLinks).toHaveLength(
            1
        );
    });

    it("rejects a category-linked goal with no categories selected", async () => {
        const { service } = build();

        await expect(
            service.create(
                createRequest({
                    goalMode:
                        "CATEGORY_CONTRIBUTION_LINKED",
                    categoryIds: [],
                })
            )
        ).rejects.toThrow(
            /at least one linked category/i
        );
    });

    it("rejects a category-linked goal with categoryIds omitted entirely", async () => {
        const { service } = build();

        await expect(
            service.create(
                createRequest({
                    goalMode:
                        "CATEGORY_CONTRIBUTION_LINKED",
                })
            )
        ).rejects.toThrow(
            /at least one linked category/i
        );
    });
});

describe("FinancialGoalService.create - loan-linked goals", () => {
    it("stores goalMode LOAN_PAYOFF_LINKED with currentAmount forced to 0", async () => {
        const { service, created } = build();

        await service.create(
            createRequest({
                goalMode: "LOAN_PAYOFF_LINKED",
                currentAmount: 999, // ignored for linked goals
                loanIds: ["loan-1"],
            })
        );

        expect(created[0].goalMode).toBe(
            "LOAN_PAYOFF_LINKED"
        );
        expect(created[0].currentAmount).toBe(0);
    });

    it("creates one loan link per requested loan id, and no account/category links", async () => {
        const {
            service,
            createdLoanLinks,
            createdLinks,
            createdCategoryLinks,
        } = build();

        const goalId = await service.create(
            createRequest({
                goalMode: "LOAN_PAYOFF_LINKED",
                loanIds: ["loan-1", "loan-2"],
            })
        );

        expect(
            createdLoanLinks
                .map(l => l.loanId)
                .sort()
        ).toEqual(["loan-1", "loan-2"]);
        expect(
            createdLoanLinks.every(
                l => l.goalId === goalId
            )
        ).toBe(true);
        expect(createdLinks).toHaveLength(0);
        expect(createdCategoryLinks).toHaveLength(
            0
        );
    });

    it("de-duplicates repeated loan ids", async () => {
        const { service, createdLoanLinks } =
            build();

        await service.create(
            createRequest({
                goalMode: "LOAN_PAYOFF_LINKED",
                loanIds: ["loan-1", "loan-1"],
            })
        );

        expect(createdLoanLinks).toHaveLength(1);
    });

    it("rejects a loan-linked goal with no loans selected", async () => {
        const { service } = build();

        await expect(
            service.create(
                createRequest({
                    goalMode: "LOAN_PAYOFF_LINKED",
                    loanIds: [],
                })
            )
        ).rejects.toThrow(
            /at least one linked loan/i
        );
    });

    it("rejects a loan-linked goal with loanIds omitted entirely", async () => {
        const { service } = build();

        await expect(
            service.create(
                createRequest({
                    goalMode: "LOAN_PAYOFF_LINKED",
                })
            )
        ).rejects.toThrow(
            /at least one linked loan/i
        );
    });
});

describe("FinancialGoalService.create - investment-linked goals", () => {
    it("stores goalMode INVESTMENT_LINKED with currentAmount forced to 0", async () => {
        const { service, created } = build();

        await service.create(
            createRequest({
                goalMode: "INVESTMENT_LINKED",
                currentAmount: 999, // ignored for linked goals
                investmentIds: ["inv-1"],
            })
        );

        expect(created[0].goalMode).toBe(
            "INVESTMENT_LINKED"
        );
        expect(created[0].currentAmount).toBe(0);
    });

    it("creates one investment link per requested investment id, and no account/category/loan links", async () => {
        const {
            service,
            createdInvestmentLinks,
            createdLinks,
            createdCategoryLinks,
            createdLoanLinks,
        } = build();

        const goalId = await service.create(
            createRequest({
                goalMode: "INVESTMENT_LINKED",
                investmentIds: [
                    "inv-1",
                    "inv-2",
                ],
            })
        );

        expect(
            createdInvestmentLinks
                .map(l => l.investmentId)
                .sort()
        ).toEqual(["inv-1", "inv-2"]);
        expect(
            createdInvestmentLinks.every(
                l => l.goalId === goalId
            )
        ).toBe(true);
        expect(createdLinks).toHaveLength(0);
        expect(createdCategoryLinks).toHaveLength(
            0
        );
        expect(createdLoanLinks).toHaveLength(0);
    });

    it("de-duplicates repeated investment ids", async () => {
        const { service, createdInvestmentLinks } =
            build();

        await service.create(
            createRequest({
                goalMode: "INVESTMENT_LINKED",
                investmentIds: ["inv-1", "inv-1"],
            })
        );

        expect(
            createdInvestmentLinks
        ).toHaveLength(1);
    });

    it("rejects an investment-linked goal with no investments selected", async () => {
        const { service } = build();

        await expect(
            service.create(
                createRequest({
                    goalMode: "INVESTMENT_LINKED",
                    investmentIds: [],
                })
            )
        ).rejects.toThrow(
            /at least one linked investment/i
        );
    });

    it("rejects an investment-linked goal with investmentIds omitted entirely", async () => {
        const { service } = build();

        await expect(
            service.create(
                createRequest({
                    goalMode: "INVESTMENT_LINKED",
                })
            )
        ).rejects.toThrow(
            /at least one linked investment/i
        );
    });
});

describe("FinancialGoalService.delete", () => {
    it("soft-deletes the goal's account, category, loan AND investment links before deleting the goal", async () => {
        const {
            service,
            deletedGoalIds,
            softDeletedByGoalIds,
            categorySoftDeletedByGoalIds,
            loanSoftDeletedByGoalIds,
            investmentSoftDeletedByGoalIds,
        } = build();

        await service.delete("goal-1");

        expect(softDeletedByGoalIds).toEqual([
            "goal-1",
        ]);
        expect(
            categorySoftDeletedByGoalIds
        ).toEqual(["goal-1"]);
        expect(
            loanSoftDeletedByGoalIds
        ).toEqual(["goal-1"]);
        expect(
            investmentSoftDeletedByGoalIds
        ).toEqual(["goal-1"]);
        expect(deletedGoalIds).toEqual(["goal-1"]);
    });
});
