import { Repository } from "@/core/database/engine/Repository";
import {
    Loan,
    UpdateLoanRequest,
} from "../types";

export class LoanRepository extends Repository {
    async getAll(): Promise<Loan[]> {
        const rows = await this.select<Loan>(
            `
            SELECT
                id,
                account_id AS accountId,
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
                currency_id,
                status,
                notes,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                outstanding_principal = ?,
                outstanding_interest = ?,
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
                loan.outstandingPrincipal,
                loan.outstandingInterest,
                loan.currencyId,
                loan.status,
                loan.notes ?? null,
                loan.id,
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
}


