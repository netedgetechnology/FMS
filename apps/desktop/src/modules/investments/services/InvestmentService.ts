import { InstitutionRepository } from "@/modules/institutions/repositories/InstitutionRepository";

import { InvestmentRepository } from "../repositories/InvestmentRepository";

import {
    Investment,
    CreateInvestmentRequest,
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

    private readonly transactionService =
        new InvestmentTransactionService();

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

        const investment: Investment = {
            id: crypto.randomUUID(),

            accountId:
                request.accountId?.trim() || null,

            name:
                request.name,

            investmentType:
                request.investmentType,

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
            try {
                await this.transactionService.createOpeningBalance(
                    investment.id,
                    investment.quantity,
                    investment.averageCost,
                    investment.purchaseDate ??
                        now.slice(0, 10)
                );
            } catch (error) {
                await this.repository.delete(
                    investment.id
                );

                throw error;
            }
        }

        return investment.id;
    }

    async update(
        request: UpdateInvestmentRequest
    ): Promise<void> {
        const brokerInstitutionId =
            await this.resolveBrokerInstitutionId(
                request.brokerInstitutionName,
                request.brokerInstitutionId
            );

        await this.repository.update({
            ...request,
            accountId:
                request.accountId?.trim() || null,
            brokerInstitutionId,
        });
    }

    async delete(
        id: string
    ): Promise<void> {
        await this.repository.delete(id);
    }
}


