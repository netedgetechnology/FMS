import { AccountRepository } from "../repositories/AccountRepository";
import { InstitutionRepository } from "@/modules/institutions/repositories/InstitutionRepository";
import { LoanRepository } from "@/modules/loans/repositories/LoanRepository";
import { TransactionRepository } from "@/modules/transactions/repositories/TransactionRepository";
import {
    Account,
    CreateAccountRequest,
    UpdateAccountRequest,
} from "../types";

export class AccountService {
    private readonly repository = new AccountRepository();
    private readonly institutionRepository = new InstitutionRepository();

    // Delete Loan - generic deletion protection. A loan's linked
    // liability account must be removed through LoanService.delete()
    // (which also enforces the no-payments policy and cleans up the
    // loan's own schedule/ledger), never directly here - deleting it
    // through the generic Accounts workflow would leave the loan
    // pointing at a missing account.
    private readonly loanRepository = new LoanRepository();

    // Delete Account - transaction deletion protection. An account with
    // any live (non-soft-deleted) transaction booked against it must
    // never be hard/soft-deleted through this generic workflow: the
    // accounts list (AccountRepository.getAll/getById) filters
    // deleted_at IS NULL, so once an account disappears here, every
    // page that resolves a transaction's account name by looking it up
    // in that list falls back to showing the raw account UUID instead -
    // an orphaned-looking reference in a transaction that itself is
    // still very much real. Deleting the account's transactions first
    // (from the Transactions page) is the only way past this guard.
    private readonly transactionRepository =
        new TransactionRepository();

    private async resolveInstitutionId(
        institutionName?: string | null
    ): Promise<string | null> {
        const name = institutionName?.trim();

        if (!name) {
            return null;
        }

        const existing = await this.institutionRepository.getByName(name);

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

    async getAll(): Promise<Account[]> {
        return await this.repository.getAll();
    }

    async getById(id: string): Promise<Account | null> {
        return await this.repository.getById(id);
    }

    async create(
        request: CreateAccountRequest & {
            institutionName?: string | null;
        }
    ): Promise<void> {
        const now = new Date().toISOString();

        const institutionId = await this.resolveInstitutionId(
            request.institutionName
        );

        const account: Account = {
            id: crypto.randomUUID(),
            name: request.name,
            type: request.type,
            institutionId,
            businessEntityId: request.businessEntityId,
            currencyId: request.currencyId,
            openingBalance: request.openingBalance,
            accountNumber: request.accountNumber,
            branchName: request.branchName,
            ifscCode: request.ifscCode,
            swiftCode: request.swiftCode,
            iban: request.iban,
            description: request.description,
            isActive: request.isActive ?? true,
            createdAt: now,
            updatedAt: now,
        };

        await this.repository.create(account);
    }

    async update(
        request: UpdateAccountRequest & {
            institutionName?: string | null;
        }
    ): Promise<void> {
        const institutionId = await this.resolveInstitutionId(
            request.institutionName
        );

        await this.repository.update({
            ...request,
            institutionId,
        });
    }

    async delete(id: string): Promise<void> {
        const linkedToLoan =
            await this.loanRepository.isLinkedToLoan(id);

        if (linkedToLoan) {
            throw new Error(
                "This account is linked to a loan and can't be deleted here. Delete the loan from the Loans page instead."
            );
        }

        const hasTransactions =
            await this.transactionRepository.existsForAccount(id);

        if (hasTransactions) {
            throw new Error(
                "This account has transactions linked to it and can't be deleted. Delete or reassign its transactions first, or keep the account for your records."
            );
        }

        await this.repository.delete(id);
    }
}


