import { Repository } from "@/core/database/engine/Repository";

import type {
    OverdraftEntryKind,
    OverdraftLinkSource,
    OverdraftTransactionLink,
} from "../types";
import { OVERDRAFT_POSITIONS_SQL } from "./overdraftPositionSql";

/** An OD's derived totals - one row of OVERDRAFT_POSITIONS_SQL. */
export interface OverdraftTotalsRow {
    used: number;
    totalDrawdowns: number;
    totalRepayments: number;
    totalInterestCharges: number;
    invalidLinks: number;
}

const LINK_FIELDS = `
    id,
    loan_id AS loanId,
    transaction_id AS transactionId,
    entry_kind AS entryKind,
    link_source AS linkSource,
    created_at AS createdAt
`;

/**
 * Inserts one link - a single statement, so it is atomic by itself (no
 * multi-statement JS transaction). It inserts nothing when the
 * transaction is already a loan EMI payment, and UNIQUE(transaction_id)
 * refuses a second OD link outright: one transaction is never counted
 * twice. Binds: id, loanId, transactionId, entryKind, linkSource,
 * transactionId.
 */
export const INSERT_OVERDRAFT_LINK_SQL = `
    INSERT INTO overdraft_transaction_links
        (id, loan_id, transaction_id, entry_kind, link_source)
    SELECT ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
        SELECT 1 FROM loan_schedule_payments WHERE transaction_id = ?
    )
`;

export const SELECT_OVERDRAFT_TOTALS_SQL = `
    SELECT
        od_used AS used,
        od_total_drawdowns AS totalDrawdowns,
        od_total_repayments AS totalRepayments,
        od_total_interest_charges AS totalInterestCharges,
        od_invalid_links AS invalidLinks
    FROM (${OVERDRAFT_POSITIONS_SQL}) AS od
    WHERE od.loan_id = ?
`;

export class OverdraftTransactionLinkRepository extends Repository {
    async getTotals(loanId: string): Promise<OverdraftTotalsRow | null> {
        const rows = await this.select<OverdraftTotalsRow>(
            SELECT_OVERDRAFT_TOTALS_SQL,
            [loanId]
        );

        return rows[0] ?? null;
    }

    async getAllByLoanId(loanId: string): Promise<OverdraftTransactionLink[]> {
        return await this.select<OverdraftTransactionLink>(
            `
            SELECT ${LINK_FIELDS}
            FROM overdraft_transaction_links
            WHERE loan_id = ?
            ORDER BY created_at ASC, id ASC
            `,
            [loanId]
        );
    }

    async getByTransactionId(
        transactionId: string
    ): Promise<OverdraftTransactionLink | null> {
        const rows = await this.select<OverdraftTransactionLink>(
            `
            SELECT ${LINK_FIELDS}
            FROM overdraft_transaction_links
            WHERE transaction_id = ?
            LIMIT 1
            `,
            [transactionId]
        );

        return rows[0] ?? null;
    }

    /** Every OD-linked transaction id - for the Transactions linked icon. */
    async getAllTransactionIds(): Promise<string[]> {
        const rows = await this.select<{ transactionId: string }>(
            `SELECT transaction_id AS transactionId FROM overdraft_transaction_links`
        );

        return rows.map(row => row.transactionId);
    }

    async insert(link: {
        id: string;
        loanId: string;
        transactionId: string;
        entryKind: OverdraftEntryKind;
        linkSource: OverdraftLinkSource;
    }): Promise<void> {
        await this.execute(INSERT_OVERDRAFT_LINK_SQL, [
            link.id,
            link.loanId,
            link.transactionId,
            link.entryKind,
            link.linkSource,
            link.transactionId,
        ]);
    }

    /**
     * A principal link following its transaction's corrected side
     * (Repayment <-> Drawdown) - one statement, only for the link that
     * currently has `fromKind`, so a link changed meanwhile is left alone.
     * Nothing else about the link or the transaction changes.
     */
    async updateEntryKind(
        transactionId: string,
        fromKind: string,
        toKind: string
    ): Promise<void> {
        await this.execute(
            `
            UPDATE overdraft_transaction_links
            SET entry_kind = ?
            WHERE transaction_id = ?
              AND entry_kind = ?
            `,
            [toKind, transactionId, fromKind]
        );
    }

    /** Unlink - removes only the link; the transaction is never touched. */
    async deleteByTransactionId(transactionId: string): Promise<void> {
        await this.execute(
            `DELETE FROM overdraft_transaction_links WHERE transaction_id = ?`,
            [transactionId]
        );
    }
}
