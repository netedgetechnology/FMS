import { invoke } from "@tauri-apps/api/core";

import { Repository } from "@/core/database/engine/Repository";
import {
    Loan,
    UpdateLoanRequest,
} from "../types";
import {
    OVERDRAFT_POSITIONS_SQL,
    outstandingInterestSql,
    outstandingPrincipalSql,
} from "./overdraftPositionSql";

/**
 * Paid instalments, derived from the loan's own schedule (PAID rows - linked
 * payments and "Settled before FinWea" alike). Only a loan with no schedule
 * at all (an Overdraft, or a legacy row) falls back to the stored column.
 */
export const PAID_INSTALMENTS_SQL = `
    CASE
        WHEN EXISTS (SELECT 1 FROM loan_payment_schedule ps WHERE ps.loan_id = loans.id)
            THEN (SELECT COUNT(*) FROM loan_payment_schedule ps WHERE ps.loan_id = loans.id AND ps.status = 'PAID')
        ELSE loans.paid_installments
    END
`;

export interface CreateLoanAtomicRequest {
    /**
     * A lender institution FinWea does not have yet, created inside the same
     * transaction as the loan so a refused save leaves no stray institution.
     */
    newLenderInstitution?: {
        id: string;
        name: string;
        institutionType: string;
        createdAt: string;
        updatedAt: string;
    };
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
        loanAccountNumber: string | null;
        principalAmount: number;
        interestRate: number;
        interestType: string;
        tenureMonths: number | null;
        emiAmount: number | null;
        firstInstallmentAmount: number | null;
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
    /**
     * Present only for an Overdraft: the loan is then stored as
     * loan_kind = OVERDRAFT with these terms, in the same transaction
     * (src-tauri/src/loan_create.rs). Absent for a Term Loan, whose
     * creation is exactly as before.
     */
    overdraft?: {
        creditLimit: number;
        openingUsed: number;
        openingUsedAsOf: string;
        /** Every linked bank account - one overdraft_accounts row each. */
        accountIds: string[];
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
        /** Lender-imported schedule only: the lender's opening principal. */
        openingPrincipal?: number | null;
        /** Declared "Settled before FinWea" (migration 052) - no payment behind it. */
        settledBeforeFinwea?: boolean;
    }>;
    /**
     * The historical instalments linked to their EXISTING bank debit (a loan
     * that was already running). One loan_schedule_payments row each,
     * written in the same transaction; the Rust command re-checks every
     * transaction and every PAID row (src-tauri/src/loan_create.rs).
     */
    /**
     * Interest Rate History (migration 054): the id for the loan's initial
     * rate row (its rate from its start date), written in the same
     * transaction. Ignored until the table exists.
     */
    initialRateHistoryId?: string;
    /**
     * Stage 4 (Overdraft only): a statement's confirmed rate changes -
     * the original rate (the INITIAL row) and each change, written in the
     * same transaction. Refused for a Term Loan and without migration 054.
     */
    statementRateHistory?: {
        initialRate: number;
        changes: Array<{
            id: string;
            effectiveFrom: string;
            rate: number;
            rateType: "FIXED" | "FLOATING" | null;
            reference: string;
            notes: string;
            createdAt: string;
        }>;
    };
    historicalPayments?: Array<{
        id: string;
        scheduleId: string;
        transactionId: string;
    }>;
    balances: {
        outstandingPrincipal: number;
        outstandingInterest: number;
        status: string;
    };
    /**
     * The Add Loan setup (migration 051, src-tauri/src/loan_setup.rs):
     * lender terms, disbursements and initial expenses, written in the same
     * transaction. Absent: creation is exactly as before.
     */
    setup?: {
        loanPurpose: string | null;
        rateType: string | null;
        interestCalculationMethod: string | null;
        sanctionDate: string | null;
        sanctionedAmount: number | null;
        firstEmiDate: string | null;
        repaymentFrequency: string | null;
        paymentDay: number | null;
        gracePeriodMonths: number | null;
        balloonAmount: number | null;
        scheduleSource: string | null;
        drawingPower: number | null;
        disbursements: Array<{
            id: string;
            sequence: number;
            disbursementDate: string;
            grossAmount: number;
            deductionsAmount: number;
            netAmount: number;
            destinationAccountId: string | null;
            reference: string | null;
            transactionId: string | null;
        }>;
        expenses: Array<{
            id: string;
            expenseType: string;
            description: string | null;
            expenseDate: string;
            baseAmount: number;
            gstRate: number | null;
            gstAmount: number;
            totalAmount: number;
            settlement: string;
            disbursementId: string | null;
            paymentMethod: string | null;
            paymentAccountId: string | null;
            transactionReference: string | null;
            transactionId: string | null;
        }>;
    };
}

// linkedAccountIds arrives as a JSON array (json_group_array) - an empty
// one for a Term Loan.
function fromRow(row: Loan): Loan {
    const raw = row.linkedAccountIds as unknown;

    return {
        ...row,
        linkedAccountIds:
            typeof raw === "string" ? (JSON.parse(raw) as string[]) : (row.linkedAccountIds ?? []),
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
     * Live loans already holding this lender account number (trimmed,
     * case-insensitive) - the same check create_loan_atomic repeats inside
     * its transaction for a Term Loan.
     */
    async findLiveByLoanAccountNumber(
        loanAccountNumber: string
    ): Promise<Array<{ id: string; name: string }>> {
        const number = loanAccountNumber.trim();

        if (!number) return [];

        return await this.select<{ id: string; name: string }>(
            `
            SELECT id, name
            FROM loans
            WHERE deleted_at IS NULL
              AND loan_account_number IS NOT NULL
              AND lower(trim(loan_account_number)) = lower(?)
            `,
            [number]
        );
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
                loan_kind AS loanKind,
                credit_limit AS creditLimit,
                opening_used AS openingUsed,
                opening_used_as_of AS openingUsedAsOf,
                (
                    SELECT json_group_array(account_id)
                    FROM (
                        SELECT account_id
                        FROM overdraft_accounts
                        WHERE overdraft_accounts.loan_id = loans.id
                        ORDER BY created_at, rowid
                    )
                ) AS linkedAccountIds,
                name,
                loan_account_number AS loanAccountNumber,
                principal_amount AS principalAmount,
                interest_rate AS interestRate,
                interest_type AS interestType,
                tenure_months AS tenureMonths,
                emi_amount AS emiAmount,
                first_installment_amount AS firstInstallmentAmount,
                start_date AS startDate,
                maturity_date AS maturityDate,
                ${outstandingPrincipalSql("loans", "od")} AS outstandingPrincipal,
                ${outstandingInterestSql("loans")} AS outstandingInterest,
                ${PAID_INSTALMENTS_SQL} AS paidInstallments,
                currency_id AS currencyId,
                status,
                notes,
                loan_purpose AS loanPurpose,
                rate_type AS rateType,
                interest_calculation_method AS interestCalculationMethod,
                sanction_date AS sanctionDate,
                sanctioned_amount AS sanctionedAmount,
                first_emi_date AS firstEmiDate,
                repayment_frequency AS repaymentFrequency,
                payment_day AS paymentDay,
                grace_period_months AS gracePeriodMonths,
                balloon_amount AS balloonAmount,
                schedule_source AS scheduleSource,
                drawing_power AS drawingPower,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM loans
            LEFT JOIN (${OVERDRAFT_POSITIONS_SQL}) AS od
                ON od.loan_id = loans.id
            WHERE deleted_at IS NULL
            ORDER BY name
            `
        );

        return rows.map(fromRow);
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
                loan_kind AS loanKind,
                credit_limit AS creditLimit,
                opening_used AS openingUsed,
                opening_used_as_of AS openingUsedAsOf,
                (
                    SELECT json_group_array(account_id)
                    FROM (
                        SELECT account_id
                        FROM overdraft_accounts
                        WHERE overdraft_accounts.loan_id = loans.id
                        ORDER BY created_at, rowid
                    )
                ) AS linkedAccountIds,
                name,
                loan_account_number AS loanAccountNumber,
                principal_amount AS principalAmount,
                interest_rate AS interestRate,
                interest_type AS interestType,
                tenure_months AS tenureMonths,
                emi_amount AS emiAmount,
                first_installment_amount AS firstInstallmentAmount,
                start_date AS startDate,
                maturity_date AS maturityDate,
                ${outstandingPrincipalSql("loans", "od")} AS outstandingPrincipal,
                ${outstandingInterestSql("loans")} AS outstandingInterest,
                ${PAID_INSTALMENTS_SQL} AS paidInstallments,
                currency_id AS currencyId,
                status,
                notes,
                loan_purpose AS loanPurpose,
                rate_type AS rateType,
                interest_calculation_method AS interestCalculationMethod,
                sanction_date AS sanctionDate,
                sanctioned_amount AS sanctionedAmount,
                first_emi_date AS firstEmiDate,
                repayment_frequency AS repaymentFrequency,
                payment_day AS paymentDay,
                grace_period_months AS gracePeriodMonths,
                balloon_amount AS balloonAmount,
                schedule_source AS scheduleSource,
                drawing_power AS drawingPower,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM loans
            LEFT JOIN (${OVERDRAFT_POSITIONS_SQL}) AS od
                ON od.loan_id = loans.id
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );

        return rows[0] ? fromRow(rows[0]) : null;
    }

    /**
     * Edits an Overdraft - its own terms and its full set of linked bank
     * accounts - in ONE real database transaction (a dedicated Rust
     * command, src-tauri/src/overdraft_update.rs), so the account set can
     * never be left half-replaced.
     */
    async updateOverdraftAtomic(request: {
        loanId: string;
        name: string;
        loanAccountNumber: string | null;
        lenderInstitutionId: string | null;
        currencyId: string;
        interestRate: number;
        startDate: string;
        status: string;
        notes: string | null;
        creditLimit: number;
        openingUsed: number;
        openingUsedAsOf: string;
        accountIds: string[];
        /** Write drawing_power (migration 051) - false leaves it untouched. */
        updateDrawingPower?: boolean;
        drawingPower?: number | null;
        /** Replace a Dropline's steps (migration 053) - false leaves them untouched. */
        updateDrawingPowerSchedule?: boolean;
        drawingPowerSchedule?: { id: string; effectiveDate: string; drawingPower: number }[];
    }): Promise<void> {
        await invoke("update_overdraft_atomic", { request });
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
                loan_account_number,
                principal_amount,
                interest_rate,
                interest_type,
                tenure_months,
                emi_amount,
                first_installment_amount,
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
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                loan.id,
                loan.accountId,
                loan.lenderInstitutionId,
                loan.loanType,
                loan.name,
                loan.loanAccountNumber ?? null,
                loan.principalAmount,
                loan.interestRate,
                loan.interestType,
                loan.tenureMonths,
                loan.emiAmount,
                loan.firstInstallmentAmount ?? null,
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
                loan_account_number = ?,
                principal_amount = ?,
                interest_rate = ?,
                interest_type = ?,
                tenure_months = ?,
                emi_amount = ?,
                start_date = ?,
                maturity_date = ?,
                -- paid_installments is never written by an edit: it is
                -- derived from the schedule (PAID_INSTALMENTS_SQL).
                currency_id = ?,
                status = ?,
                notes = ?,
                -- OD terms: written for an Overdraft only. The Loan Type
                -- itself (loan_kind) is never changed by an edit.
                credit_limit = CASE WHEN loan_kind = 'OVERDRAFT' THEN ? ELSE credit_limit END,
                opening_used = CASE WHEN loan_kind = 'OVERDRAFT' THEN ? ELSE opening_used END,
                opening_used_as_of = CASE WHEN loan_kind = 'OVERDRAFT' THEN ? ELSE opening_used_as_of END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                loan.accountId,
                loan.lenderInstitutionId,
                loan.loanType,
                loan.name,
                loan.loanAccountNumber ?? null,
                loan.principalAmount,
                loan.interestRate,
                loan.interestType,
                loan.tenureMonths,
                loan.emiAmount,
                loan.startDate,
                loan.maturityDate,
                loan.currencyId,
                loan.status,
                loan.notes ?? null,
                loan.creditLimit ?? null,
                loan.openingUsed ?? null,
                loan.openingUsedAsOf ?? null,
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

