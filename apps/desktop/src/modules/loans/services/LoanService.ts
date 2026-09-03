import { InstitutionRepository } from "@/modules/institutions/repositories/InstitutionRepository";
import { AccountRepository } from "@/modules/accounts/repositories/AccountRepository";
import { Account, AccountType } from "@/modules/accounts/types";

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

    private readonly accountRepository =
        new AccountRepository();

    /**
     * Every loan is backed 1:1 by a real account record
     * (account_type = LOAN) so loans appear in the unified Accounts list.
     * This mirrors the Investment <-> Account relationship.
     *
     * The account carries identity only - opening_balance stays 0. The
     * current liability is derived at read time from the loan's outstanding
     * balances and shown as a negative balance, so it never feeds
     * account-balance / net-worth aggregates (which would double-count it).
     */
    private buildLoanAccount(
        accountId: string,
        source: {
            name: string;
            currencyId: string;
            status: Loan["status"];
        },
        lenderInstitutionId: string | null,
        now: string
    ): Account {
        return {
            id: accountId,
            name: source.name,
            type: AccountType.LOAN,
            institutionId: lenderInstitutionId,
            businessEntityId: null,
            currencyId: source.currencyId,
            openingBalance: 0,
            description: "Loan liability account",
            isActive: source.status !== "CLOSED",
            createdAt: now,
            updatedAt: now,
        };
    }

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

        const loanAccountId = crypto.randomUUID();

        await this.accountRepository.create(
            this.buildLoanAccount(
                loanAccountId,
                request,
                lenderInstitutionId,
                now
            )
        );

        const loan: Loan = {
            id: crypto.randomUUID(),

            accountId: request.accountId ?? null,

            loanAccountId,

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

        try {
            await this.repository.create(loan);
            await this.repository.linkLoanAccount(
                loan.id,
                loanAccountId
            );
        } catch (error) {
            await this.accountRepository.delete(loanAccountId);
            throw error;
        }

        return loan.id;
    }

    async update(
        request: UpdateLoanRequest
    ): Promise<void> {
        const now = new Date().toISOString();

        const lenderInstitutionId =
            await this.resolveLenderInstitutionId(
                request.lenderInstitutionName,
                request.lenderInstitutionId
            );

        /*
         * The loan account is established once at creation and is never
         * editable through the form. Resolve the *live* linked account from
         * the database; if the link is missing (legacy / unmigrated loan) or
         * points at an account that no longer exists or was soft-deleted,
         * repair the 1:1 link rather than leaving the loan without an
         * Accounts row.
         */
        const existing = await this.repository.getById(request.id);

        if (!existing) {
            throw new Error("Loan not found.");
        }

        const linkedAccountId =
            existing.loanAccountId?.trim() || null;

        const linkedAccount = linkedAccountId
            ? await this.accountRepository.getById(linkedAccountId)
            : null;

        let loanAccountId = linkedAccount?.id ?? null;

        if (!loanAccountId) {
            loanAccountId = crypto.randomUUID();

            await this.accountRepository.create(
                this.buildLoanAccount(
                    loanAccountId,
                    request,
                    lenderInstitutionId,
                    now
                )
            );

            await this.repository.linkLoanAccount(
                request.id,
                loanAccountId
            );
        }

        await this.repository.update({
            ...request,
            lenderInstitutionId,
        });

        // Identity sync only - opening_balance stays 0; the liability is
        // always derived from the loan's current outstanding balances.
        await this.accountRepository.syncLinkedAccount({
            id: loanAccountId,
            name: request.name,
            currencyId: request.currencyId,
            businessEntityId: null,
            isActive: request.status !== "CLOSED",
        });
    }

    async delete(id: string): Promise<void> {
        // Read the link before deleting, and without the deleted_at filter,
        // so a retry after a partially-failed delete still soft-deletes the
        // linked account (it can never become orphaned).
        const loanAccountId =
            await this.repository.getLinkedLoanAccountId(id);

        await this.repository.delete(id);

        if (loanAccountId) {
            await this.accountRepository.delete(loanAccountId);
        }
    }
}
