import { invoke } from "@tauri-apps/api/core";

import { Repository } from "@/core/database/engine/Repository";
import {
    Loan,
    UpdateLoanRequest,
} from "../types";

export interface CreateLoanAtomicRequest {
    loanAccount: {
        id: string;
        institutionId: string | null;
        businessEntityId: string | null;
        currencyId: string;
        name: string;
        accountType: string;
        description: string | null;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
    };
    loan: {
        id: string;
        accountId: string | null;
        lenderInstitutionId: string | null;
        loanType: string;
        name: string;
        principalAmount: number;
        interestRate: number;
        interestType: string;
        tenureMonths: number | null;
        emiAmount: number | null;
        startDate: string;
        maturityDate: string | null;
        outstandingPrincipal: number;
        outstandingInterest: number;
        paidInstallments: number;
        currencyId: string;
        status: string;
        notes: string | null;
        createdAt: string;
        updatedAt: string;
    };
    schedule: Array<{
        id: string;
        installmentNumber: number;
        dueDate: string;
        principalAmount: number;
        interestAmount: number;
        totalAmount: number;
        outstandingPrincipal: number;
        status: string;
        paidDate: string | null;
        paidAmount: number | null;
        transactionId: string | null;
    }>;
    balances: {
        outstandingPrincipal: number;
        outstandingInterest: number;
        status: string;
    };
}

export class LoanRepository extends Repository {
    /**
     * Creates the loan's own mirror account, the loan row, the account
     * link, its full EMI schedule and the schedule-reconciled
     * accounting balances all inside one real, single-connection
     * database transaction (a dedicated Rust command - see
     * src-tauri/src/loan_create.rs for why: `execute()`/`select()`
     * each independently check out a connection from the sqlx pool per
     * call, so the `beginTransaction()`/`execute()`/`commit()` pattern
     * used elsewhere in this class cannot guarantee every statement of
     * a multi-statement write lands on the same connection - which is
     * exactly what let a failed loan creation leave a dangling,
     * never-rolled-back transaction, surfacing as "database is
     * locked" / "cannot rollback - no transaction is active" and a
     * permanently pending create() promise on the next attempt).
     */
    async createAtomic(
        request: CreateLoanAtomicRequest
    ): Promise<void> {
        await invoke("create_loan_atomic", { request });
    }

    /**
     * Deletes every loan-owned row for one loan - its schedule
     * payments, its EMI schedule, its goal-loan links and the loan
     * itself, plus its own mirror account when the caller determined
     * it's safe to - all inside one real, single-connection database
     * transaction (a dedicated Rust command - see
     * src-tauri/src/loan_delete.rs). Same reasoning as createAtomic:
     * this is what fixed a real production bug where a successful
     * delete still reported "cannot commit - no transaction is active"
     * because the JS-level begin / execute / commit sequence it
     * replaced could not guarantee every statement landed on the same
     * connection.
     */
    async deleteAtomic(request: {
        loanId: string;
        loanAccountId: string | null;
    }): Promise<void> {
        await invoke("delete_loan_atomic", { request });
    }

    async getAll(): Promise<Loan[]> {
        const rows = await this.select<Loan>(
            `
            SELECT
                id,
                account_id AS accountId,
                loan_account_id AS loanAccountId,
                lender_institution_id AS lenderInstitutionId,
                loan_type AS loanType,
                name,
                principal_amount AS principalAmount,
                interest_rate AS interestRate,
                interest_type AS interestType,
                tenure_months AS tenureMonths,
                emi_amount AS emiAmount,
                start_date AS startDate,
                maturity_date AS maturityDate,
                outstanding_principal AS outstandingPrincipal,
                outstanding_interest AS outstandingInterest,
                paid_installments AS paidInstallments,
                currency_id AS currencyId,
                status,
                notes,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM loans
            WHERE deleted_at IS NULL
            ORDER BY name
            `
        );

        return rows;
    }

    async getById(id: string): Promise<Loan | null> {
        const rows = await this.select<Loan>(
            `
            SELECT
                id,
                account_id AS accountId,
                loan_account_id AS loanAccountId,
                lender_institution_id AS lenderInstitutionId,
                loan_type AS loanType,
                name,
                principal_amount AS principalAmount,
                interest_rate AS interestRate,
                interest_type AS interestType,
                tenure_months AS tenureMonths,
                emi_amount AS emiAmount,
                start_date AS startDate,
                maturity_date AS maturityDate,
                outstanding_principal AS outstandingPrincipal,
                outstanding_interest AS outstandingInterest,
                paid_installments AS paidInstallments,
                currency_id AS currencyId,
                status,
                notes,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM loans
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );

        return rows[0] ?? null;
    }

    async create(loan: Loan): Promise<void> {
        await this.execute(
            `
            INSERT INTO loans
            (
                id,
                account_id,
                lender_institution_id,
                loan_type,
                name,
                principal_amount,
                interest_rate,
                interest_type,
                tenure_months,
                emi_amount,
                start_date,
                maturity_date,
                outstanding_principal,
                outstanding_interest,
                paid_installments,
                currency_id,
                status,
                notes,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                loan.id,
                loan.accountId,
                loan.lenderInstitutionId,
                loan.loanType,
                loan.name,
                loan.principalAmount,
                loan.interestRate,
                loan.interestType,
                loan.tenureMonths,
                loan.emiAmount,
                loan.startDate,
                loan.maturityDate,
                loan.outstandingPrincipal,
                loan.outstandingInterest,
                loan.paidInstallments,
                loan.currencyId,
                loan.status,
                loan.notes ?? null,
                loan.createdAt,
                loan.updatedAt,
            ]
        );
    }

    async update(loan: UpdateLoanRequest & {
        lenderInstitutionId: string | null;
    }): Promise<void> {
        await this.execute(
            `
            UPDATE loans
            SET
                account_id = ?,
                lender_institution_id = ?,
                loan_type = ?,
                name = ?,
                principal_amount = ?,
                interest_rate = ?,
                interest_type = ?,
                tenure_months = ?,
                emi_amount = ?,
                start_date = ?,
                maturity_date = ?,
                paid_installments = ?,
                currency_id = ?,
                status = ?,
                notes = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                loan.accountId,
                loan.lenderInstitutionId,
                loan.loanType,
                loan.name,
                loan.principalAmount,
                loan.interestRate,
                loan.interestType,
                loan.tenureMonths,
                loan.emiAmount,
                loan.startDate,
                loan.maturityDate,
                loan.paidInstallments,
                loan.currencyId,
                loan.status,
                loan.notes ?? null,
                loan.id,
            ]
        );
    }

    async updateAccountingBalances(
        loanId: string,
        outstandingPrincipal: number,
        outstandingInterest: number,
        status?: Loan["status"]
    ): Promise<void> {
        await this.execute(
            `
            UPDATE loans
            SET
                outstanding_principal = ?,
                outstanding_interest = ?,
                status = COALESCE(?, status),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                outstandingPrincipal,
                outstandingInterest,
                status ?? null,
                loanId,
            ]
        );
    }

    async delete(id: string): Promise<void> {
        await this.execute(
            `
            UPDATE loans
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [id]
        );
    }

    /**
     * Sets/repairs the 1:1 loan-account link. Only the service's create and
     * repair paths call this - a normal edit never changes loan_account_id
     * (it is not in update()'s SET clause).
     */
    async linkLoanAccount(
        loanId: string,
        loanAccountId: string
    ): Promise<void> {
        await this.execute(
            `
            UPDATE loans
            SET loan_account_id = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [loanAccountId, loanId]
        );
    }

    /**
     * The linked loan-account id, resolved even for a soft-deleted loan, so
     * delete() can always clean up the 1:1 account.
     */
    async getLinkedLoanAccountId(
        id: string
    ): Promise<string | null> {
        const rows = await this.select<{
            loanAccountId: string | null;
        }>(
            `
            SELECT loan_account_id AS loanAccountId
            FROM loans
            WHERE id = ?
            LIMIT 1
            `,
            [id]
        );

        return rows[0]?.loanAccountId ?? null;
    }

    /**
     * Whether an account is currently a live loan's linked liability
     * account - used by AccountService.delete() to refuse direct
     * deletion of a loan-linked account through the generic Accounts
     * workflow, which would otherwise leave the loan pointing at a
     * missing account (Delete Loan - generic deletion protection).
     * The loan's own LoanService.delete() is the correct path, and
     * does not go through this guard.
     */
    async isLinkedToLoan(
        accountId: string
    ): Promise<boolean> {
        const rows = await this.select<{ id: string }>(
            `
            SELECT id
            FROM loans
            WHERE loan_account_id = ?
              AND deleted_at IS NULL
            LIMIT 1
            `,
            [accountId]
        );

        return rows.length > 0;
    }
}

