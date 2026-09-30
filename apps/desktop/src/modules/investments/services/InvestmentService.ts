import { InstitutionRepository } from "@/modules/institutions/repositories/InstitutionRepository";
import { AccountRepository } from "@/modules/accounts/repositories/AccountRepository";
import { Account, AccountType } from "@/modules/accounts/types";

import { InvestmentRepository } from "../repositories/InvestmentRepository";
import { InvestmentTransactionRepository } from "../repositories/InvestmentTransactionRepository";
import { InvestmentHoldingRepository } from "../repositories/InvestmentHoldingRepository";

import {
    Investment,
    CreateInvestmentRequest,
    InvestmentStatus,
    UpdateInvestmentRequest,
} from "../types";

import {
    InvestmentTransactionService,
} from "./InvestmentTransactionService";

// ---------------------------------------------------------------------
// Data-integrity rules enforced here (Investments Safety & Data
// Integrity phase):
//
// Calculated fields - once an investment has at least one
// investment_transactions row, quantity/averageCost are owned by the
// ledger (InvestmentTransactionService.recalculateInvestment). update()
// below ignores any caller-supplied quantity/averageCost in that case
// and keeps the stored, ledger-derived values instead of trusting the
// request - so a stray or UI-bypassing caller can never desync them.
// Before any transaction exists, both remain freely settable (that's
// how an investment is seeded).
//
// Current-value consistency - currentValue is always computed here as
// quantity x currentPrice, in both create() and update(), never taken
// from the request. It can never legitimately be anything else.
//
// Currency changes - update() refuses to change currencyId once any
// transaction exists, since every past transaction amount would be
// silently reinterpreted as the new currency with no conversion.
// ---------------------------------------------------------------------

export class InvestmentService {
    private readonly repository =
        new InvestmentRepository();

    private readonly institutionRepository =
        new InstitutionRepository();

    private readonly accountRepository =
        new AccountRepository();

    private readonly transactionService =
        new InvestmentTransactionService();

    // Used by delete() to clean up the ledger/snapshot instead of
    // leaving orphaned rows behind, and by update() to guard against an
    // unsafe currency change once the ledger is non-empty. Distinct
    // from transactionService (InvestmentTransactionService), which
    // owns individual transaction create/edit/recalculate flows.
    private readonly transactionRepository =
        new InvestmentTransactionRepository();

    private readonly holdingRepository =
        new InvestmentHoldingRepository();

    /**
     * Every investment is backed 1:1 by a real account record
     * (account_type = INVESTMENT) so investments and accounts stay
     * in sync. This mirrors the credit_cards <-> accounts relationship.
     */
    private buildLinkedAccount(
        accountId: string,
        source: {
            name: string;
            currencyId: string;
            businessEntityId: string;
            status: InvestmentStatus;
            notes?: string;
        },
        brokerInstitutionId: string | null,
        now: string
    ): Account {
        return {
            id: accountId,
            name: source.name,
            type: AccountType.INVESTMENT,
            institutionId: brokerInstitutionId,
            businessEntityId: source.businessEntityId,
            currencyId: source.currencyId,
            // Identity only - the investment's worth is tracked in the
            // investments domain, so this stays at 0 and never feeds
            // account balance / net-worth aggregates.
            openingBalance: 0,
            description:
                source.notes ?? "Investment account",
            isActive:
                source.status === InvestmentStatus.ACTIVE,
            createdAt: now,
            updatedAt: now,
        };
    }

    private async resolveBrokerInstitutionId(
        institutionName?: string | null,
        institutionId?: string | null
    ): Promise<string | null> {
        if (institutionId) {
            return institutionId;
        }

        const name = institutionName?.trim();

        if (!name) {
            return null;
        }

        const existing =
            await this.institutionRepository.getByName(
                name
            );

        if (existing) {
            return existing.id;
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        await this.institutionRepository.create({
            id,
            name,
            type: "Financial Institution",
            createdAt: now,
            updatedAt: now,
        });

        return id;
    }

    async getAll(): Promise<Investment[]> {
        return await this.repository.getAll();
    }

    async getById(
        id: string
    ): Promise<Investment | null> {
        return await this.repository.getById(id);
    }

    async create(
        request: CreateInvestmentRequest
    ): Promise<string> {
        const now = new Date().toISOString();

        const brokerInstitutionId =
            await this.resolveBrokerInstitutionId(
                request.brokerInstitutionName,
                request.brokerInstitutionId
            );

        const accountId = crypto.randomUUID();

        await this.accountRepository.create(
            this.buildLinkedAccount(
                accountId,
                request,
                brokerInstitutionId,
                now
            )
        );

        const investment: Investment = {
            id: crypto.randomUUID(),

            accountId,

            businessEntityId:
                request.businessEntityId,

            name:
                request.name,

            investmentType:
                request.investmentType,

            investmentSubtype:
                request.investmentSubtype ?? null,

            symbol:
                request.symbol ?? null,

            isin:
                request.isin ?? null,

            currencyId:
                request.currencyId,

            brokerInstitutionId,

            quantity:
                request.quantity,

            averageCost:
                request.averageCost,

            currentPrice:
                request.currentPrice,

            // Always quantity x currentPrice, never taken from the
            // request - see the "Current-value consistency" note above.
            currentValue:
                request.quantity *
                request.currentPrice,

            // currentPrice is being set for the first time here, so it
            // is "current as of now" by definition.
            priceUpdatedAt: now,

            purchaseDate:
                request.purchaseDate ?? null,

            status:
                request.status,

            notes:
                request.notes,

            createdAt:
                now,

            updatedAt:
                now,
        };

        try {
            await this.repository.create(
                investment
            );

            /*
             * The initial quantity/cost entered while creating
             * an investment represents the position that already
             * existed before FinanceOS started tracking transactions.
             *
             * Store that position as an OPENING_BALANCE transaction
             * so all future portfolio calculations are transaction-driven.
             */
            if (
                investment.quantity > 0 &&
                investment.averageCost >= 0
            ) {
                await this.transactionService.createOpeningBalance(
                    investment.id,
                    investment.quantity,
                    investment.averageCost,
                    investment.purchaseDate ??
                        now.slice(0, 10)
                );
            }
        } catch (error) {
            await this.repository.delete(
                investment.id
            );

            await this.accountRepository.delete(
                accountId
            );

            throw error;
        }

        return investment.id;
    }

    async update(
        request: UpdateInvestmentRequest
    ): Promise<void> {
        const now = new Date().toISOString();

        const brokerInstitutionId =
            await this.resolveBrokerInstitutionId(
                request.brokerInstitutionName,
                request.brokerInstitutionId
            );

        /*
         * The linked account is established once at creation and is never
         * editable through the form. Resolve the *live* linked account from
         * the database; if the link is missing (legacy / unmigrated row) or
         * points at an account that no longer exists or was soft-deleted
         * (e.g. deleted from the Accounts page), repair the 1:1 link by
         * creating a fresh linked account rather than leaving the investment
         * orphaned.
         */
        const existing =
            await this.repository.getById(request.id);

        if (!existing) {
            throw new Error("Investment not found.");
        }

        // Once the transaction ledger is non-empty it is the sole
        // source of truth for quantity/averageCost (recalculated by
        // InvestmentTransactionService on every ledger change) - see
        // the "Calculated fields" note at the top of this file. Any
        // caller-supplied quantity/averageCost is ignored in that case
        // rather than trusted, so a stray or bypassed-UI request can
        // never desync the stored figures from the ledger.
        const transactions =
            await this.transactionRepository.getAllByInvestmentId(
                request.id
            );
        const hasTransactions =
            transactions.length > 0;

        // Changing currency after the transaction ledger is non-empty
        // would silently reinterpret every past BUY/SELL/DIVIDEND/etc.
        // amount as if it had always been in the new currency, with no
        // conversion - fail fast, before any write, rather than let
        // that happen.
        if (
            hasTransactions &&
            existing.currencyId !== request.currencyId
        ) {
            throw new Error(
                "This investment's currency can't be changed because it already has recorded transactions. Create a new investment in the new currency instead."
            );
        }

        const quantity = hasTransactions
            ? existing.quantity
            : request.quantity;

        const averageCost = hasTransactions
            ? existing.averageCost
            : request.averageCost;

        // currentValue is always quantity x currentPrice - never taken
        // from the request - so it can never drift from the two
        // figures it is supposed to represent (see the "Current-value
        // consistency" note at the top of this file).
        const currentValue =
            quantity * request.currentPrice;

        // Only bump priceUpdatedAt when currentPrice itself actually
        // changed - editing unrelated fields (name, notes, status, ...)
        // must not make a stale price look freshly confirmed.
        const priceUpdatedAt =
            existing.currentPrice !==
            request.currentPrice
                ? now
                : existing.priceUpdatedAt;

        const linkedAccountId =
            existing.accountId?.trim() || null;

        const linkedAccount = linkedAccountId
            ? await this.accountRepository.getById(
                  linkedAccountId
              )
            : null;

        let accountId = linkedAccount?.id ?? null;

        if (!accountId) {
            accountId = crypto.randomUUID();

            await this.accountRepository.create(
                this.buildLinkedAccount(
                    accountId,
                    request,
                    brokerInstitutionId,
                    now
                )
            );

            await this.repository.linkAccount(
                request.id,
                accountId
            );
        }

        await this.repository.update({
            ...request,
            brokerInstitutionId,
            quantity,
            averageCost,
            currentValue,
            priceUpdatedAt,
        });

        await this.accountRepository.syncLinkedAccount({
            id: accountId,
            name: request.name,
            currencyId: request.currencyId,
            businessEntityId: request.businessEntityId,
            isActive:
                request.status === InvestmentStatus.ACTIVE,
        });
    }

    async delete(
        id: string
    ): Promise<void> {
        // Read the link before deleting, and without the deleted_at filter,
        // so a retry after a partially-failed delete still finds and soft-
        // deletes the linked account (it can never become orphaned).
        const accountId =
            await this.repository.getLinkedAccountId(id);

        // investment_transactions and investment_holdings have no
        // deleted_at of their own and are never soft-deleted alongside
        // their parent investment, so without this cleanup they are
        // left behind permanently once the investment disappears from
        // every list/report (all of which filter deleted_at IS NULL on
        // investments first). Hard-deleted here, in one transaction
        // with the investment and its mirror account, so a failure
        // partway through leaves nothing orphaned either way.
        await this.repository.beginTransaction();

        try {
            await this.transactionRepository.deleteByInvestmentId(
                id
            );
            await this.holdingRepository.deleteByInvestmentId(
                id
            );
            await this.repository.delete(id);

            if (accountId) {
                await this.accountRepository.delete(
                    accountId
                );
            }

            await this.repository.commit();
        } catch (error) {
            try {
                await this.repository.rollback();
            } catch (rollbackError) {
                console.error(
                    "Failed to rollback investment delete transaction:",
                    rollbackError
                );
            }

            throw error;
        }
    }
}


