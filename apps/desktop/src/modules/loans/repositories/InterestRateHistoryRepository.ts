import { Repository } from "@/core/database/engine/Repository";

import { rateOn, withEffectiveUntil } from "../setup/interestRateHistory";
import type { InterestRateHistoryEntry } from "../types/InterestRateHistory";

const TABLE = "loan_interest_rate_history";

const SELECT_COLUMNS = `SELECT id,
                    loan_id AS loanId,
                    effective_from AS effectiveFrom,
                    rate,
                    previous_rate AS previousRate,
                    rate_type AS rateType,
                    source,
                    reference,
                    document_id AS documentId,
                    notes,
                    applied_from_instalment AS appliedFromInstalment,
                    created_at AS createdAt,
                    superseded_by AS supersededBy,
                    superseded_at AS supersededAt,
                    correction_reason AS correctionReason`;

/**
 * Interest Rate History (migration 054) - read-only in Stage 1. The initial
 * row is written with the loan by create_loan_atomic; later rows (manual
 * changes, statement imports, corrections) arrive in later stages, each in
 * its own atomic Rust command.
 *
 * Until migration 054 is applied the table does not exist: every read then
 * returns no history, so the rest of the app behaves exactly as before.
 */
export class InterestRateHistoryRepository extends Repository {
    async isAvailable(): Promise<boolean> {
        const rows = await this.select<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", [TABLE]);
        return Number(rows[0]?.n ?? 0) > 0;
    }

    /**
     * A loan's entries, live ones in date order with "effective until"
     * worked out, then superseded ones (the audit trail).
     */
    async findByLoan(loanId: string, options: { includeSuperseded?: boolean } = {}): Promise<InterestRateHistoryEntry[]> {
        if (!(await this.isAvailable())) return [];

        const rows = await this.select<Omit<InterestRateHistoryEntry, "effectiveUntil">>(
            `${SELECT_COLUMNS}
             FROM ${TABLE}
             WHERE loan_id = ?
               ${options.includeSuperseded ? "" : "AND superseded_at IS NULL"}
             ORDER BY effective_from, created_at`,
            [loanId]
        );

        return withEffectiveUntil(rows);
    }

    /**
     * Every loan's live entries in one read (the loan list derives each
     * loan's current rate from them). Empty until migration 054 is applied.
     */
    async findAllLive(): Promise<Omit<InterestRateHistoryEntry, "effectiveUntil">[]> {
        if (!(await this.isAvailable())) return [];

        const rows = await this.select<Omit<InterestRateHistoryEntry, "effectiveUntil">>(
            `${SELECT_COLUMNS}
             FROM ${TABLE}
             WHERE superseded_at IS NULL
             ORDER BY loan_id, effective_from, created_at`
        );

        // Not run through withEffectiveUntil: that works per loan.
        return rows;
    }

    /** The live entry in effect on a date, or null (no history, or before the first). */
    async findInEffectOn(loanId: string, date: string): Promise<InterestRateHistoryEntry | null> {
        return rateOn(await this.findByLoan(loanId), date);
    }
}
