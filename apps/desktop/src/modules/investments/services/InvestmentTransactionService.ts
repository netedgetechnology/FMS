import { InvestmentHoldingRepository } from "../repositories/InvestmentHoldingRepository";
import { InvestmentRepository } from "../repositories/InvestmentRepository";
import { InvestmentTransactionRepository } from "../repositories/InvestmentTransactionRepository";

import {
    InvestmentTransaction,
    InvestmentTransactionType,
} from "../types";

import {
    InvestmentPortfolioCalculator,
} from "./InvestmentPortfolioCalculator";

export interface CreateInvestmentTransactionRequest {
    investmentId: string;
    transactionType: InvestmentTransactionType;
    transactionDate: string;
    quantity: number;
    price: number;
    amount: number;
    fees: number;
    taxes: number;
    referenceNumber?: string | null;
    notes?: string;
}

export interface UpdateInvestmentTransactionRequest {
    id: string;
    transactionType: InvestmentTransactionType;
    transactionDate: string;
    quantity: number;
    price: number;
    amount: number;
    fees: number;
    taxes: number;
    referenceNumber?: string | null;
    notes?: string;
}

export class InvestmentTransactionService {
    private readonly repository =
        new InvestmentTransactionRepository();

    private readonly investmentRepository =
        new InvestmentRepository();

    private readonly holdingRepository =
        new InvestmentHoldingRepository();

    private readonly calculator =
        new InvestmentPortfolioCalculator();

    private calculateTradeAmount(
        transactionType: InvestmentTransactionType,
        quantity: number,
        price: number,
        amount: number
    ): number {
        if (
            transactionType ===
                InvestmentTransactionType.BUY ||
            transactionType ===
                InvestmentTransactionType.SELL
        ) {
            return quantity * price;
        }

        return amount;
    }

    async getAllByInvestmentId(
        investmentId: string
    ): Promise<InvestmentTransaction[]> {
        return await this.repository.getAllByInvestmentId(
            investmentId
        );
    }

    async getPortfolioCalculation(
        investmentId: string
    ) {
        const investment =
            await this.investmentRepository.getById(
                investmentId
            );

        if (!investment) {
            throw new Error(
                "Investment not found."
            );
        }

        const transactions =
            await this.repository.getAllByInvestmentId(
                investmentId
            );

        const calculation =
            this.calculator.calculate(
                transactions
            );

        const currentValue =
            calculation.quantity *
            investment.currentPrice;

        return {
            ...calculation,
            currentValue,
        };
    }
    async getById(
        id: string
    ): Promise<InvestmentTransaction | null> {
        return await this.repository.getById(id);
    }

    async createOpeningBalance(
        investmentId: string,
        quantity: number,
        averageCost: number,
        transactionDate: string
    ): Promise<string> {
        const investment =
            await this.investmentRepository.getById(
                investmentId
            );

        if (!investment) {
            throw new Error(
                "Investment not found."
            );
        }

        if (quantity <= 0) {
            throw new Error(
                "Opening balance quantity must be greater than zero."
            );
        }

        if (averageCost < 0) {
            throw new Error(
                "Opening balance average cost cannot be negative."
            );
        }

        const now = new Date().toISOString();

        const transaction: InvestmentTransaction = {
            id: crypto.randomUUID(),

            investmentId,

            transactionType:
                InvestmentTransactionType.OPENING_BALANCE,

            transactionDate,

            quantity,

            price:
                averageCost,

            amount:
                quantity * averageCost,

            fees: 0,

            taxes: 0,

            referenceNumber:
                "OPENING_BALANCE",

            notes:
                "Opening balance created automatically from the initial investment holding.",

            createdAt: now,
            updatedAt: now,
        };

        await this.repository.create(
            transaction
        );

        try {
            await this.recalculateInvestment(
                investmentId
            );
        } catch (error) {
            await this.repository.delete(
                transaction.id
            );

            throw error;
        }

        return transaction.id;
    }
    async create(
        request: CreateInvestmentTransactionRequest
    ): Promise<string> {
        const investment =
            await this.investmentRepository.getById(
                request.investmentId
            );

        if (!investment) {
            throw new Error(
                "Investment not found."
            );
        }

        const now = new Date().toISOString();

        const amount =
            this.calculateTradeAmount(
                request.transactionType,
                request.quantity,
                request.price,
                request.amount
            );

        const transaction: InvestmentTransaction = {
            id: crypto.randomUUID(),

            investmentId:
                request.investmentId,

            transactionType:
                request.transactionType,

            transactionDate:
                request.transactionDate,

            quantity:
                request.quantity,

            price:
                request.price,

            amount,

            fees:
                request.fees,

            taxes:
                request.taxes,

            referenceNumber:
                request.referenceNumber ?? null,

            notes:
                request.notes,

            createdAt: now,
            updatedAt: now,
        };

        await this.repository.create(
            transaction
        );

        try {
            await this.recalculateInvestment(
                request.investmentId
            );
        } catch (error) {
            await this.repository.delete(
                transaction.id
            );

            throw error;
        }

        return transaction.id;
    }

    async update(
        request: UpdateInvestmentTransactionRequest
    ): Promise<void> {
        const existing =
            await this.repository.getById(
                request.id
            );

        if (!existing) {
            throw new Error(
                "Investment transaction not found."
            );
        }

        const investment =
            await this.investmentRepository.getById(
                existing.investmentId
            );

        if (!investment) {
            throw new Error(
                "Investment not found."
            );
        }

        const amount =
            this.calculateTradeAmount(
                request.transactionType,
                request.quantity,
                request.price,
                request.amount
            );

        const transaction: InvestmentTransaction = {
            ...existing,

            transactionType:
                request.transactionType,

            transactionDate:
                request.transactionDate,

            quantity:
                request.quantity,

            price:
                request.price,

            amount,

            fees:
                request.fees,

            taxes:
                request.taxes,

            referenceNumber:
                request.referenceNumber ?? null,

            notes:
                request.notes,

            updatedAt:
                new Date().toISOString(),
        };

        await this.repository.update(
            transaction
        );

        try {
            await this.recalculateInvestment(
                existing.investmentId
            );
        } catch (error) {
            await this.repository.update(
                existing
            );

            throw error;
        }
    }

    async delete(
        id: string
    ): Promise<void> {
        const existing =
            await this.repository.getById(id);

        if (!existing) {
            throw new Error(
                "Investment transaction not found."
            );
        }

        await this.repository.delete(id);

        try {
            await this.recalculateInvestment(
                existing.investmentId
            );
        } catch (error) {
            await this.repository.create(
                existing
            );

            throw error;
        }
    }

    private async recalculateInvestment(
        investmentId: string
    ): Promise<void> {
        const investment =
            await this.investmentRepository.getById(
                investmentId
            );

        if (!investment) {
            throw new Error(
                "Investment not found."
            );
        }

        const transactions =
            await this.repository.getAllByInvestmentId(
                investmentId
            );

        const calculation =
            this.calculator.calculate(
                transactions
            );

        const currentValue =
            calculation.quantity *
            investment.currentPrice;

        await this.investmentRepository.updatePortfolioValues(
            investmentId,
            calculation.quantity,
            calculation.averageCost,
            currentValue
        );

        const now =
            new Date().toISOString();

        const holding = {
            id: crypto.randomUUID(),

            investmentId,

            quantity:
                calculation.quantity,

            averageCost:
                calculation.averageCost,

            currentPrice:
                investment.currentPrice,

            currentValue,

            asOfDate:
                now.slice(0, 10),

            createdAt: now,

            updatedAt: now,
        };

        await this.holdingRepository.replaceLatest(
            holding
        );
    }
}



