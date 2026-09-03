import { InstitutionRepository } from "@/modules/institutions/repositories/InstitutionRepository";
import { AccountRepository } from "@/modules/accounts/repositories/AccountRepository";
import { Account, AccountType } from "@/modules/accounts/types";

import { InvestmentRepository } from "../repositories/InvestmentRepository";

import {
    Investment,
    CreateInvestmentRequest,
    InvestmentStatus,
    UpdateInvestmentRequest,
} from "../types";

import {
    InvestmentTransactionService,
} from "./InvestmentTransactionService";

export class InvestmentService {
    private readonly repository =
        new InvestmentRepository();

    private readonly institutionRepository =
        new InstitutionRepository();

    private readonly accountRepository =
        new AccountRepository();

    private readonly transactionService =
        new InvestmentTransactionService();

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

            currentValue:
                request.currentValue,

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

        await this.repository.delete(id);

        if (accountId) {
            await this.accountRepository.delete(accountId);
        }
    }
}


