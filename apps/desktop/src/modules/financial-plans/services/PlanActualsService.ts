import { toISODateString } from "@/core/formatting";

import { AccountService } from "@/modules/accounts/services";
import { CategoryRepository } from "@/modules/categories/repositories";
import { InvestmentRepository } from "@/modules/investments/repositories";
import { InvestmentTransactionRepository } from "@/modules/investments/repositories";
import { LoanRepository } from "@/modules/loans/repositories/LoanRepository";
import { LoanPaymentScheduleRepository } from "@/modules/loans/repositories/LoanPaymentScheduleRepository";
import { EMIScheduleService } from "@/modules/loans/services/EMIScheduleService";
import { TransactionService } from "@/modules/transactions/services";
import { TransferRepository } from "@/modules/transfers/repositories/TransferRepository";

import {
    FinancialPlanComponentRepository,
} from "../repositories";
import { FinancialPlanService } from "./FinancialPlanService";

import type { FinancialPlanComponent } from "../types";

import {
    calculateManyPlanActuals,
    type LedgerAccount,
    type LedgerBundle,
    type LedgerCategory,
    type LedgerInvestment,
    type LedgerLoan,
    type PlanCalcResult,
} from "./planActuals";

// ---------------------------------------------------------------------
// Financial Plans - Phase 3 I/O layer
//
// Assembles the LedgerBundle from repositories, resolves `asOf`, and
// delegates to the pure engine (planActuals.ts). Bounded I/O:
//   - one getAll() each for transactions / transfers / accounts / plans
//   - EMIScheduleService.getInterestByTransactionId() (all loans)
//   - one listByPlan() per plan
//   - per-referenced-source getById() for categories / investments /
//     loans, plus the referenced investment's transactions and the
//     referenced loan's schedule.
// No global investment_transactions / loan_payment_schedule fetch (the
// repositories expose none). Nothing is written or cached.
//
// ---------------------------------------------------------------------
// Phase 5 - Automatic Updating contract
//
// A Financial Plan's actual position updates automatically because it is
// never stored: every call to getPlanActuals / getAllPlanActuals
// re-reads the live source data (transactions, transfers, accounts,
// investments, investment transactions, loans, loan schedules, EMI
// splits, plans and their components) and re-runs the pure engine from
// scratch. There is no snapshot, cache, persisted actual/progress value,
// scheduled job, or event listener - so there is nothing that can go
// stale, be double-counted, or conflict.
//
// Guarantees (verified by PlanActualsService.autoUpdate.test.ts):
//  - Freshness: the next call after ANY change to a source - add / edit /
//    soft-delete a transaction, transfer, investment trade or loan
//    instalment; change investments.current_value or
//    loans.outstanding_principal; add / remove / deactivate a component;
//    close or sell a source - reflects that change exactly once.
//  - Determinism: the same `asOf` over the same source state produces a
//    deep-equal PlanCalcResult. `asOf` defaults to today's local date,
//    resolved once per call and applied to every plan in a batch.
//  - No duplication / conflict: calling twice changes nothing; nothing
//    accumulates.
//  - Existing rules are respected automatically, with no extra step:
//      * soft-deleted components / sources     -> excluded at the repository
//      * inactive components                   -> excluded from totals (engine)
//      * matrix-incompatible components         -> COMPONENT_NOT_IN_PLAN_MATRIX,
//                                                 excluded, status INCOMPLETE (Phase 4 guard)
//      * archived / completed plans             -> still computed; plan.status
//                                                 drives no automatic recompute
//                                                 or status transition (locked)
//
// Phase 5 adds NO new mechanism, persisted value, schema/migration,
// scheduled recompute, automatic plan-status change, projection, or
// public result-shape change - the pull-based Phase 3 design already
// delivers automatic updating. This section and the dedicated test suite
// formalise and lock that contract plus financial-event correctness.
// ---------------------------------------------------------------------

export class PlanActualsService {
    private readonly planService =
        new FinancialPlanService();

    private readonly componentRepository =
        new FinancialPlanComponentRepository();

    private readonly transactionService =
        new TransactionService();

    private readonly transferRepository =
        new TransferRepository();

    private readonly accountService =
        new AccountService();

    private readonly emiScheduleService =
        new EMIScheduleService();

    private readonly categoryRepository =
        new CategoryRepository();

    private readonly investmentRepository =
        new InvestmentRepository();

    private readonly investmentTransactionRepository =
        new InvestmentTransactionRepository();

    private readonly loanRepository =
        new LoanRepository();

    private readonly loanScheduleRepository =
        new LoanPaymentScheduleRepository();

    async getAllPlanActuals(
        asOf: string = toISODateString(new Date())
    ): Promise<PlanCalcResult[]> {
        const plans =
            await this.planService.getAll();

        const componentsByPlanId = new Map<
            string,
            FinancialPlanComponent[]
        >();

        for (const plan of plans) {
            componentsByPlanId.set(
                plan.id,
                await this.componentRepository.listByPlan(
                    plan.id
                )
            );
        }

        const ledger = await this.buildLedger(
            [...componentsByPlanId.values()].flat()
        );

        return calculateManyPlanActuals(
            plans,
            componentsByPlanId,
            asOf,
            ledger
        );
    }

    async getPlanActuals(
        planId: string,
        asOf: string = toISODateString(new Date())
    ): Promise<PlanCalcResult | null> {
        const plan =
            await this.planService.getById(planId);

        if (!plan) {
            return null;
        }

        const components =
            await this.componentRepository.listByPlan(
                planId
            );

        const ledger = await this.buildLedger(
            components
        );

        return calculateManyPlanActuals(
            [plan],
            new Map([[plan.id, components]]),
            asOf,
            ledger
        )[0];
    }

    private async buildLedger(
        components: readonly FinancialPlanComponent[]
    ): Promise<LedgerBundle> {
        const categoryIds = uniq(
            components
                .filter(
                    c =>
                        c.componentType === "CATEGORY"
                )
                .map(c => c.categoryId)
        );
        const investmentIds = uniq(
            components
                .filter(
                    c =>
                        c.componentType ===
                        "INVESTMENT"
                )
                .map(c => c.investmentId)
        );
        const loanIds = uniq(
            components
                .filter(
                    c => c.componentType === "LOAN"
                )
                .map(c => c.loanId)
        );

        const [
            transactions,
            transfers,
            accounts,
            emiInterestByTransactionId,
        ] = await Promise.all([
            this.transactionService.getAll(),
            this.transferRepository.getAll(),
            this.accountService.getAll(),
            this.emiScheduleService.getInterestByTransactionId(),
        ]);

        const accountsById = new Map<
            string,
            LedgerAccount
        >();
        const creditCardAccountIds = new Set<string>();

        for (const account of accounts) {
            const type = String(account.type);
            accountsById.set(account.id, {
                name: account.name,
                currencyId: account.currencyId,
                type,
                openingBalance:
                    account.openingBalance,
            });
            if (type === "CREDIT_CARD") {
                creditCardAccountIds.add(account.id);
            }
        }

        const categoriesById = new Map<
            string,
            LedgerCategory
        >();
        for (const id of categoryIds) {
            const category =
                await this.categoryRepository.getById(
                    id
                );
            if (category) {
                categoriesById.set(id, {
                    name: category.name,
                    categoryType:
                        category.categoryType,
                });
            }
        }

        const investmentsById = new Map<
            string,
            LedgerInvestment
        >();
        const investmentTransactionsByInvestmentId =
            new Map<
                string,
                Awaited<
                    ReturnType<
                        InvestmentTransactionRepository["getAllByInvestmentId"]
                    >
                >
            >();

        for (const id of investmentIds) {
            const investment =
                await this.investmentRepository.getById(
                    id
                );
            if (investment) {
                investmentsById.set(id, {
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
            investmentTransactionsByInvestmentId.set(
                id,
                await this.investmentTransactionRepository.getAllByInvestmentId(
                    id
                )
            );
        }

        const loansById = new Map<string, LedgerLoan>();
        const loanScheduleByLoanId = new Map<
            string,
            Awaited<ReturnType<
                LoanPaymentScheduleRepository["getAllByLoanId"]
            >>
        >();

        for (const id of loanIds) {
            const loan =
                await this.loanRepository.getById(id);
            if (loan) {
                loansById.set(id, {
                    name: loan.name,
                    currencyId: loan.currencyId,
                    status: String(loan.status),
                    outstandingPrincipal:
                        loan.outstandingPrincipal,
                    outstandingInterest:
                        loan.outstandingInterest,
                });
            }
            loanScheduleByLoanId.set(
                id,
                await this.loanScheduleRepository.getAllByLoanId(
                    id
                )
            );
        }

        return {
            accountsById,
            creditCardAccountIds,
            transactions: transactions.map(t => ({
                id: t.id,
                type: t.type,
                amount: t.amount,
                transactionDate: t.transactionDate,
                categoryId: t.categoryId,
                accountId: t.accountId,
                cardReference: t.cardReference,
                deletedAt: null,
            })),
            transfers: transfers.map(t => ({
                sourceAccountId: t.sourceAccountId,
                destinationAccountId:
                    t.destinationAccountId,
                amount: t.amount,
                transactionDate: t.transactionDate,
                deletedAt: t.deletedAt,
            })),
            emiInterestByTransactionId,
            categoriesById,
            investmentsById,
            investmentTransactionsByInvestmentId,
            loansById,
            loanScheduleByLoanId,
        };
    }
}

function uniq(
    values: readonly (string | null)[]
): string[] {
    return [
        ...new Set(
            values.filter(
                (v): v is string =>
                    typeof v === "string" &&
                    v.length > 0
            )
        ),
    ];
}
