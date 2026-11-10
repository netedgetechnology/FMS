import { Repository } from "@/core/database/engine/Repository";

import { moneySideOf } from "../setup/loanSetupAccounting";
import type {
    ExpenseSettlement,
    InitialExpenseType,
    LinkedTransactionSummary,
    MoneySide,
} from "../setup/loanSetupTypes";

// ---------------------------------------------------------------------
// Read side of the Add Loan setup (migration 051): which existing bank
// transactions a disbursement / initial expense may point at, and a
// loan's stored setup. Writes happen only inside create_loan_atomic.
//
// "Claimed" = the transaction already backs an Overdraft link, an EMI
// payment, a disbursement or an initial expense. A claimed transaction is
// never offered and never accepted - one bank movement, counted once.
// ---------------------------------------------------------------------

const CLAIMED_BY_SQL = `
    CASE
        WHEN EXISTS (SELECT 1 FROM overdraft_transaction_links o WHERE o.transaction_id = t.id) THEN 'an overdraft'
        WHEN EXISTS (SELECT 1 FROM loan_schedule_payments p WHERE p.transaction_id = t.id) THEN 'a loan EMI payment'
        WHEN EXISTS (SELECT 1 FROM loan_disbursements d WHERE d.transaction_id = t.id) THEN 'a loan disbursement'
        WHEN EXISTS (SELECT 1 FROM loan_initial_expenses e WHERE e.transaction_id = t.id) THEN 'a loan expense'
        ELSE NULL
    END
`;

const TRANSACTION_FIELDS = `
    t.id,
    t.transaction_date AS transactionDate,
    t.amount,
    t.account_id AS accountId,
    a.name AS accountName,
    t.type,
    t.transfer_direction AS transferDirection,
    t.payee,
    t.original_narration AS originalNarration,
    c.name AS categoryName,
    c.category_type AS categoryType,
    t.deleted_at AS deletedAt,
    ${CLAIMED_BY_SQL} AS claimedBy
`;

const TRANSACTION_FROM = `
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = NULLIF(t.category_id, '')
`;

interface TransactionRow {
    id: string;
    transactionDate: string;
    amount: number;
    accountId: string;
    accountName: string | null;
    type: string;
    transferDirection: string | null;
    payee: string;
    originalNarration: string | null;
    categoryName: string | null;
    categoryType: string | null;
    deletedAt: string | null;
    claimedBy: string | null;
}

export interface LinkableTransaction extends LinkedTransactionSummary {
    deleted: boolean;
    /** What already uses it ("an overdraft", ...), or null when free. */
    claimedBy: string | null;
}

function toLinkable(row: TransactionRow): LinkableTransaction {
    return {
        id: row.id,
        date: row.transactionDate.slice(0, 10),
        amount: Number(row.amount),
        accountId: row.accountId,
        accountName: row.accountName,
        side: moneySideOf({ type: row.type, transferDirection: row.transferDirection }),
        payee: row.payee,
        narration: row.originalNarration,
        categoryName: row.categoryName,
        categoryType: row.categoryType,
        deleted: row.deletedAt !== null,
        claimedBy: row.claimedBy,
    };
}

export interface StoredDisbursement {
    id: string;
    sequence: number;
    disbursementDate: string;
    grossAmount: number;
    deductionsAmount: number;
    netAmount: number;
    destinationAccountId: string | null;
    destinationAccountName: string | null;
    reference: string | null;
    transactionId: string | null;
}

export interface StoredInitialExpense {
    id: string;
    expenseType: InitialExpenseType;
    description: string | null;
    expenseDate: string;
    baseAmount: number;
    gstRate: number | null;
    gstAmount: number;
    totalAmount: number;
    settlement: ExpenseSettlement;
    disbursementId: string | null;
    paymentMethod: string | null;
    paymentAccountId: string | null;
    paymentAccountName: string | null;
    transactionReference: string | null;
    transactionId: string | null;
}

export class LoanSetupRepository extends Repository {
    /** The given transactions as the setup checks them (deleted ones included). */
    async getTransactionsForLinking(ids: readonly string[]): Promise<LinkableTransaction[]> {
        if (ids.length === 0) {
            return [];
        }

        const rows = await this.select<TransactionRow>(
            `SELECT ${TRANSACTION_FIELDS} ${TRANSACTION_FROM}
             WHERE t.id IN (${ids.map(() => "?").join(", ")})`,
            [...ids]
        );

        return rows.map(toLinkable);
    }

    /**
     * Unclaimed, live transactions that could back a disbursement (money
     * IN) or a separately paid expense (money OUT): on `accountId`, for
     * EXACTLY `amount` when given (no tolerance), nearest `aroundDate`
     * first. Never returns a claimed or deleted transaction.
     */
    async findLinkCandidates(filter: {
        accountId: string;
        side: MoneySide;
        amount: number | null;
        aroundDate: string | null;
        excludeIds?: readonly string[];
        limit?: number;
    }): Promise<LinkableTransaction[]> {
        const sideSql =
            filter.side === "IN"
                ? `(t.type = 'income' OR (t.type = 'transfer' AND t.transfer_direction = 'IN'))`
                : `(t.type = 'expense' OR (t.type = 'transfer' AND t.transfer_direction = 'OUT'))`;
        const params: unknown[] = [filter.accountId];
        let amountSql = "";

        if (filter.amount !== null && filter.amount > 0) {
            amountSql = "AND ABS(t.amount - ?) < 0.005";
            params.push(filter.amount);
        }

        const exclude = filter.excludeIds ?? [];
        const excludeSql = exclude.length ? `AND t.id NOT IN (${exclude.map(() => "?").join(", ")})` : "";
        params.push(...exclude);

        const orderSql = filter.aroundDate
            ? "ORDER BY ABS(julianday(substr(t.transaction_date, 1, 10)) - julianday(?)), t.transaction_date DESC"
            : "ORDER BY t.transaction_date DESC";
        if (filter.aroundDate) {
            params.push(filter.aroundDate);
        }

        params.push(filter.limit ?? 25);

        const rows = await this.select<TransactionRow>(
            `SELECT ${TRANSACTION_FIELDS} ${TRANSACTION_FROM}
             WHERE t.account_id = ?
               AND t.deleted_at IS NULL
               AND ${sideSql}
               ${amountSql}
               ${excludeSql}
               AND (${CLAIMED_BY_SQL}) IS NULL
             ${orderSql}
             LIMIT ?`,
            params
        );

        return rows.map(toLinkable);
    }

    /**
     * Unclaimed, live money-OUT transactions on the loan's EMI account,
     * dated within [fromDate, toDate], for EXACTLY one of `amounts` (no
     * tolerance) - the raw material for historical EMI matching
     * (setup/historicalInstalments.ts decides which instalment each could
     * be, and the user confirms). Never returns a claimed or deleted one.
     */
    async findHistoricalEmiCandidates(filter: {
        accountId: string;
        amounts: readonly number[];
        fromDate: string;
        toDate: string;
        excludeIds?: readonly string[];
        limit?: number;
    }): Promise<LinkableTransaction[]> {
        const amounts = [...new Set(filter.amounts.filter(amount => amount > 0))];

        if (amounts.length === 0) {
            return [];
        }

        const exclude = filter.excludeIds ?? [];
        const params: unknown[] = [filter.accountId, filter.fromDate, filter.toDate, ...amounts, ...exclude, filter.limit ?? 500];

        const rows = await this.select<TransactionRow>(
            `SELECT ${TRANSACTION_FIELDS} ${TRANSACTION_FROM}
             WHERE t.account_id = ?
               AND t.deleted_at IS NULL
               AND (t.type = 'expense' OR (t.type = 'transfer' AND t.transfer_direction = 'OUT'))
               AND substr(t.transaction_date, 1, 10) BETWEEN ? AND ?
               AND (${amounts.map(() => "ABS(t.amount - ?) < 0.005").join(" OR ")})
               ${exclude.length ? `AND t.id NOT IN (${exclude.map(() => "?").join(", ")})` : ""}
               AND (${CLAIMED_BY_SQL}) IS NULL
             ORDER BY t.transaction_date, t.id
             LIMIT ?`,
            params
        );

        return rows.map(toLinkable);
    }

    async getDisbursements(loanId: string): Promise<StoredDisbursement[]> {
        return await this.select<StoredDisbursement>(
            `SELECT
                d.id,
                d.sequence,
                d.disbursement_date AS disbursementDate,
                d.gross_amount AS grossAmount,
                d.deductions_amount AS deductionsAmount,
                d.net_amount AS netAmount,
                d.destination_account_id AS destinationAccountId,
                a.name AS destinationAccountName,
                d.reference,
                d.transaction_id AS transactionId
             FROM loan_disbursements d
             LEFT JOIN accounts a ON a.id = d.destination_account_id
             WHERE d.loan_id = ?
             ORDER BY d.sequence`,
            [loanId]
        );
    }

    async getInitialExpenses(loanId: string): Promise<StoredInitialExpense[]> {
        return await this.select<StoredInitialExpense>(
            `SELECT
                e.id,
                e.expense_type AS expenseType,
                e.description,
                e.expense_date AS expenseDate,
                e.base_amount AS baseAmount,
                e.gst_rate AS gstRate,
                e.gst_amount AS gstAmount,
                e.total_amount AS totalAmount,
                e.settlement,
                e.disbursement_id AS disbursementId,
                e.payment_method AS paymentMethod,
                e.payment_account_id AS paymentAccountId,
                a.name AS paymentAccountName,
                e.transaction_reference AS transactionReference,
                e.transaction_id AS transactionId
             FROM loan_initial_expenses e
             LEFT JOIN accounts a ON a.id = e.payment_account_id
             WHERE e.loan_id = ?
             ORDER BY e.expense_date, e.rowid`,
            [loanId]
        );
    }
}
