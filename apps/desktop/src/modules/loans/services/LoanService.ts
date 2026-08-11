import { InstitutionRepository } from "@/modules/institutions/repositories/InstitutionRepository";

import { LoanRepository } from "../repositories/LoanRepository";
import {
    Loan,
    CreateLoanRequest,
    UpdateLoanRequest,
} from "../types";

export class LoanService {
    private readonly repository = new LoanRepository();

    private readonly institutionRepository =
        new InstitutionRepository();

    private async resolveLenderInstitutionId(
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
            await this.institutionRepository.getByName(name);

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

    async getAll(): Promise<Loan[]> {
        return await this.repository.getAll();
    }

    async getById(id: string): Promise<Loan | null> {
        return await this.repository.getById(id);
    }

    async create(
        request: CreateLoanRequest
    ): Promise<string> {
        const now = new Date().toISOString();

        const lenderInstitutionId =
            await this.resolveLenderInstitutionId(
                request.lenderInstitutionName,
                request.lenderInstitutionId
            );

        const loan: Loan = {
            id: crypto.randomUUID(),

            accountId: request.accountId ?? null,

            lenderInstitutionId,

            loanType: request.loanType,

            name: request.name,

            principalAmount: request.principalAmount,

            interestRate: request.interestRate,

            interestType: request.interestType,

            tenureMonths: request.tenureMonths ?? null,

            emiAmount: request.emiAmount ?? null,

            startDate: request.startDate,

            maturityDate: request.maturityDate ?? null,

            outstandingPrincipal:
                request.outstandingPrincipal,

            outstandingInterest:
                request.outstandingInterest,

            currencyId: request.currencyId,

            status: request.status,

            notes: request.notes,

            createdAt: now,

            updatedAt: now,
        };

        await this.repository.create(loan);

        return loan.id;
    }

    async update(
        request: UpdateLoanRequest
    ): Promise<void> {
        const lenderInstitutionId =
            await this.resolveLenderInstitutionId(
                request.lenderInstitutionName,
                request.lenderInstitutionId
            );

        await this.repository.update({
            ...request,
            lenderInstitutionId,
        });
    }

    async delete(id: string): Promise<void> {
        await this.repository.delete(id);
    }
}
