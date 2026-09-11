import { AccountService } from "@/modules/accounts/services";
import { CategoryService } from "@/modules/categories/services";
import { LoanService } from "@/modules/loans/services";
import { InvestmentService } from "@/modules/investments/services";
import { TransactionService } from "@/modules/transactions/services";
import { TransferRepository } from "@/modules/transfers/repositories/TransferRepository";
import { toISODateString } from "@/core/formatting";

import { FinancialGoalRepository } from "../repositories/FinancialGoalRepository";
import { GoalAccountLinkRepository } from "../repositories/GoalAccountLinkRepository";
import { GoalCategoryLinkRepository } from "../repositories/GoalCategoryLinkRepository";
import { GoalLoanLinkRepository } from "../repositories/GoalLoanLinkRepository";
import { GoalInvestmentLinkRepository } from "../repositories/GoalInvestmentLinkRepository";

import { isLinkedGoalMode } from "../constants/goalAccountLinking";

import type { FinancialGoal } from "../types/FinancialGoal";
import type { GoalAccountLink } from "../types/GoalAccountLink";
import type { GoalCategoryLink } from "../types/GoalCategoryLink";
import type { GoalLoanLink } from "../types/GoalLoanLink";
import type { GoalInvestmentLink } from "../types/GoalInvestmentLink";

import {
    calculateCategoryContributionGoalActuals,
    calculateGoalActuals,
    calculateInvestmentGoalActuals,
    calculateLoanPayoffGoalActuals,
    type GoalCalcResult,
    type GoalLedgerAccount,
    type GoalLedgerBundle,
    type GoalLedgerCategory,
    type GoalLedgerInvestment,
    type GoalLedgerLoan,
} from "./goalActuals";

// ---------------------------------------------------------------------
// Financial Goals - Automatic Phase 1 (savings) + Phase 2 (debt payoff)
// + Phase 3 (category-linked income contributions) + Phase 4
// (loan-linked payoff) + Phase 5 (investment-linked savings) I/O layer
//
// Assembles the ledger (accounts / categories / loans / investments /
// transactions / transfers) and delegates to the pure engine
// (goalActuals.ts). Only linked goals (ACCOUNT_LINKED,
// DEBT_PAYOFF_LINKED, CATEGORY_CONTRIBUTION_LINKED, LOAN_PAYOFF_LINKED
// or INVESTMENT_LINKED - see isLinkedGoalMode) are computed here -
// MANUAL goals keep using their stored current_amount and are not
// touched by this service. Account-linked, category-linked,
// loan-linked and investment-linked goals are dispatched to separate
// engine entry points (calculateGoalActuals vs
// calculateCategoryContributionGoalActuals vs
// calculateLoanPayoffGoalActuals vs calculateInvestmentGoalActuals)
// since their link tables and input shapes differ - see goalActuals.ts.
//
// Automatic-updating contract (mirrors PlanActualsService.ts): nothing
// is cached or persisted. Every call re-reads live accounts /
// categories / loans / investments / transactions / transfers and
// re-runs the pure engine from scratch, so the next call after ANY
// change - a new/edited/deleted transaction, a transfer, an account
// opening-balance edit, a category deactivated, a loan's outstanding
// principal changing, an investment's current value changing, or a
// link being added/removed - reflects that change exactly once.
// Verified by GoalActualsService.autoUpdate.test.ts.
// ---------------------------------------------------------------------

export class GoalActualsService {
    private readonly goalRepository =
        new FinancialGoalRepository();

    private readonly accountLinkRepository =
        new GoalAccountLinkRepository();

    private readonly categoryLinkRepository =
        new GoalCategoryLinkRepository();

    private readonly loanLinkRepository =
        new GoalLoanLinkRepository();

    private readonly investmentLinkRepository =
        new GoalInvestmentLinkRepository();

    private readonly transactionService =
        new TransactionService();

    private readonly transferRepository =
        new TransferRepository();

    private readonly accountService =
        new AccountService();

    private readonly categoryService =
        new CategoryService();

    private readonly loanService = new LoanService();

    private readonly investmentService =
        new InvestmentService();

    async getAllGoalActuals(): Promise<
        Map<string, GoalCalcResult>
    > {
        const goals = await this.goalRepository.getAll();

        const linkedGoals = goals.filter(goal =>
            isLinkedGoalMode(goal.goalMode)
        );

        if (linkedGoals.length === 0) {
            return new Map();
        }

        const accountGoals = linkedGoals.filter(
            goal =>
                goal.goalMode !==
                    "CATEGORY_CONTRIBUTION_LINKED" &&
                goal.goalMode !== "LOAN_PAYOFF_LINKED" &&
                goal.goalMode !== "INVESTMENT_LINKED"
        );
        const categoryGoals = linkedGoals.filter(
            goal =>
                goal.goalMode ===
                "CATEGORY_CONTRIBUTION_LINKED"
        );
        const loanGoals = linkedGoals.filter(
            goal =>
                goal.goalMode === "LOAN_PAYOFF_LINKED"
        );
        const investmentGoals = linkedGoals.filter(
            goal =>
                goal.goalMode === "INVESTMENT_LINKED"
        );

        const [
            linksByGoalId,
            categoryLinksByGoalId,
            loanLinksByGoalId,
            investmentLinksByGoalId,
        ] = await Promise.all([
            this.groupLinksByGoal(accountGoals),
            this.groupCategoryLinksByGoal(
                categoryGoals
            ),
            this.groupLoanLinksByGoal(loanGoals),
            this.groupInvestmentLinksByGoal(
                investmentGoals
            ),
        ]);

        const ledger = await this.buildLedger(
            [...categoryLinksByGoalId.values()]
                .flat()
                .map(link => link.categoryId),
            [...loanLinksByGoalId.values()]
                .flat()
                .map(link => link.loanId),
            [...investmentLinksByGoalId.values()]
                .flat()
                .map(link => link.investmentId)
        );

        const asOf = toISODateString(new Date());

        const results = new Map<
            string,
            GoalCalcResult
        >();

        for (const goal of accountGoals) {
            results.set(
                goal.id,
                calculateGoalActuals(
                    goal,
                    linksByGoalId.get(goal.id) ?? [],
                    ledger
                )
            );
        }

        for (const goal of categoryGoals) {
            results.set(
                goal.id,
                calculateCategoryContributionGoalActuals(
                    goal,
                    categoryLinksByGoalId.get(
                        goal.id
                    ) ?? [],
                    ledger,
                    asOf
                )
            );
        }

        for (const goal of loanGoals) {
            results.set(
                goal.id,
                calculateLoanPayoffGoalActuals(
                    goal,
                    loanLinksByGoalId.get(goal.id) ??
                        [],
                    ledger
                )
            );
        }

        for (const goal of investmentGoals) {
            results.set(
                goal.id,
                calculateInvestmentGoalActuals(
                    goal,
                    investmentLinksByGoalId.get(
                        goal.id
                    ) ?? [],
                    ledger
                )
            );
        }

        return results;
    }

    async getGoalActuals(
        goalId: string
    ): Promise<GoalCalcResult | null> {
        const goal = await this.goalRepository.getById(
            goalId
        );

        if (!goal || !isLinkedGoalMode(goal.goalMode)) {
            return null;
        }

        if (
            goal.goalMode ===
            "CATEGORY_CONTRIBUTION_LINKED"
        ) {
            const links =
                await this.categoryLinkRepository.listByGoal(
                    goalId
                );

            const ledger = await this.buildLedger(
                links.map(link => link.categoryId),
                [],
                []
            );

            return calculateCategoryContributionGoalActuals(
                goal,
                links,
                ledger,
                toISODateString(new Date())
            );
        }

        if (goal.goalMode === "LOAN_PAYOFF_LINKED") {
            const links =
                await this.loanLinkRepository.listByGoal(
                    goalId
                );

            const ledger = await this.buildLedger(
                [],
                links.map(link => link.loanId),
                []
            );

            return calculateLoanPayoffGoalActuals(
                goal,
                links,
                ledger
            );
        }

        if (goal.goalMode === "INVESTMENT_LINKED") {
            const links =
                await this.investmentLinkRepository.listByGoal(
                    goalId
                );

            const ledger = await this.buildLedger(
                [],
                [],
                links.map(link => link.investmentId)
            );

            return calculateInvestmentGoalActuals(
                goal,
                links,
                ledger
            );
        }

        const links =
            await this.accountLinkRepository.listByGoal(
                goalId
            );

        const ledger = await this.buildLedger(
            [],
            [],
            []
        );

        return calculateGoalActuals(
            goal,
            links,
            ledger
        );
    }

    private async groupLinksByGoal(
        goals: readonly FinancialGoal[]
    ): Promise<Map<string, GoalAccountLink[]>> {
        const links =
            await this.accountLinkRepository.listByGoals(
                goals.map(goal => goal.id)
            );

        const byGoalId = new Map<
            string,
            GoalAccountLink[]
        >();

        for (const link of links) {
            const existing =
                byGoalId.get(link.goalId) ?? [];
            existing.push(link);
            byGoalId.set(link.goalId, existing);
        }

        return byGoalId;
    }

    private async groupCategoryLinksByGoal(
        goals: readonly FinancialGoal[]
    ): Promise<Map<string, GoalCategoryLink[]>> {
        const links =
            await this.categoryLinkRepository.listByGoals(
                goals.map(goal => goal.id)
            );

        const byGoalId = new Map<
            string,
            GoalCategoryLink[]
        >();

        for (const link of links) {
            const existing =
                byGoalId.get(link.goalId) ?? [];
            existing.push(link);
            byGoalId.set(link.goalId, existing);
        }

        return byGoalId;
    }

    private async groupLoanLinksByGoal(
        goals: readonly FinancialGoal[]
    ): Promise<Map<string, GoalLoanLink[]>> {
        const links =
            await this.loanLinkRepository.listByGoals(
                goals.map(goal => goal.id)
            );

        const byGoalId = new Map<
            string,
            GoalLoanLink[]
        >();

        for (const link of links) {
            const existing =
                byGoalId.get(link.goalId) ?? [];
            existing.push(link);
            byGoalId.set(link.goalId, existing);
        }

        return byGoalId;
    }

    private async groupInvestmentLinksByGoal(
        goals: readonly FinancialGoal[]
    ): Promise<Map<string, GoalInvestmentLink[]>> {
        const links =
            await this.investmentLinkRepository.listByGoals(
                goals.map(goal => goal.id)
            );

        const byGoalId = new Map<
            string,
            GoalInvestmentLink[]
        >();

        for (const link of links) {
            const existing =
                byGoalId.get(link.goalId) ?? [];
            existing.push(link);
            byGoalId.set(link.goalId, existing);
        }

        return byGoalId;
    }

    /**
     * `referencedCategoryIds` bounds the category fetch to only
     * categories actually linked by a CATEGORY_CONTRIBUTION_LINKED goal
     * in this batch, `referencedLoanIds` does the same for loans linked
     * by a LOAN_PAYOFF_LINKED goal, and `referencedInvestmentIds` does
     * the same for investments linked by an INVESTMENT_LINKED goal -
     * mirrors PlanActualsService.buildLedger's per-referenced-source
     * fetch. Pass [] for any of the three when there are no goals of
     * that mode to compute.
     */
    private async buildLedger(
        referencedCategoryIds: readonly string[],
        referencedLoanIds: readonly string[],
        referencedInvestmentIds: readonly string[]
    ): Promise<GoalLedgerBundle> {
        const [transactions, transfers, accounts] =
            await Promise.all([
                this.transactionService.getAll(),
                this.transferRepository.getAll(),
                this.accountService.getAll(),
            ]);

        const accountsById = new Map<
            string,
            GoalLedgerAccount
        >();

        for (const account of accounts) {
            accountsById.set(account.id, {
                name: account.name,
                currencyId: account.currencyId,
                type: String(account.type),
                isActive: account.isActive,
                openingBalance: account.openingBalance,
            });
        }

        const categoriesById = new Map<
            string,
            GoalLedgerCategory
        >();

        for (const categoryId of new Set(
            referencedCategoryIds
        )) {
            const category =
                await this.categoryService.getById(
                    categoryId
                );
            if (category) {
                categoriesById.set(categoryId, {
                    name: category.name,
                    categoryType: String(
                        category.categoryType
                    ),
                    isActive: category.isActive,
                });
            }
        }

        const loansById = new Map<
            string,
            GoalLedgerLoan
        >();

        for (const loanId of new Set(
            referencedLoanIds
        )) {
            const loan =
                await this.loanService.getById(
                    loanId
                );
            if (loan) {
                loansById.set(loanId, {
                    name: loan.name,
                    currencyId: loan.currencyId,
                    status: String(loan.status),
                    outstandingPrincipal:
                        loan.outstandingPrincipal,
                });
            }
        }

        const investmentsById = new Map<
            string,
            GoalLedgerInvestment
        >();

        for (const investmentId of new Set(
            referencedInvestmentIds
        )) {
            const investment =
                await this.investmentService.getById(
                    investmentId
                );
            if (investment) {
                investmentsById.set(investmentId, {
                    name: investment.name,
                    currencyId:
                        investment.currencyId,
                    status: String(
                        investment.status
                    ),
                    currentValue:
                        investment.currentValue,
                });
            }
        }

        return {
            accountsById,
            categoriesById,
            loansById,
            investmentsById,
            transactions: transactions.map(t => ({
                accountId: t.accountId,
                categoryId: t.categoryId,
                type: t.type,
                amount: t.amount,
                transactionDate: t.transactionDate,
            })),
            transfers: transfers.map(t => ({
                sourceAccountId: t.sourceAccountId,
                destinationAccountId:
                    t.destinationAccountId,
                amount: t.amount,
                transactionDate: t.transactionDate,
                deletedAt: t.deletedAt,
            })),
        };
    }
}
