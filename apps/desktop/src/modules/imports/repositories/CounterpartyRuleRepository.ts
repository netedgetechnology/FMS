import { Repository } from "@/core/database/engine/Repository";

import type { CounterpartyRule } from "../types";

export class CounterpartyRuleRepository
    extends Repository
{
    async findByAccountAndPattern(
        accountId: string,
        pattern: string
    ): Promise<CounterpartyRule | null> {
        const rows =
            await this.select<CounterpartyRule>(
                `
                SELECT
                    id,
                    account_id AS accountId,
                    pattern,
                    counterparty,
                    type,
                    notes,
                    match_count AS matchCount,
                    created_at AS createdAt,
                    updated_at AS updatedAt
                FROM counterparty_rules
                WHERE account_id = ?
                  AND pattern = ?
                `,
                [accountId, pattern]
            );

        return rows[0] ?? null;
    }

    // Learns (or refreshes) an "account + pattern -> Payee/Type/Notes"
    // association from a user's manual entry/correction. A rule already
    // saved for the same account + pattern (UNIQUE) is updated in place
    // - same id, incremented match_count - rather than duplicated. The
    // same pattern in a *different* account is a separate rule
    // entirely. Payee always overwrites (it's never blank); a null
    // `type` or `notes` preserves whatever was previously learned
    // instead of erasing it - only a real value ever replaces one.
    async upsert(
        accountId: string,
        pattern: string,
        counterparty: string,
        type: string | null = null,
        notes: string | null = null
    ): Promise<CounterpartyRule> {
        const existing =
            await this.findByAccountAndPattern(
                accountId,
                pattern
            );

        const id = existing?.id ?? crypto.randomUUID();

        await this.execute(
            `
            INSERT INTO counterparty_rules
            (
                id,
                account_id,
                pattern,
                counterparty,
                type,
                notes,
                match_count,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(account_id, pattern) DO UPDATE SET
                counterparty = excluded.counterparty,
                type = COALESCE(excluded.type, counterparty_rules.type),
                notes = COALESCE(excluded.notes, counterparty_rules.notes),
                match_count = counterparty_rules.match_count + 1,
                updated_at = CURRENT_TIMESTAMP
            `,
            [id, accountId, pattern, counterparty, type, notes]
        );

        const saved =
            await this.findByAccountAndPattern(
                accountId,
                pattern
            );

        if (!saved) {
            throw new Error(
                "Failed to save counterparty rule."
            );
        }

        return saved;
    }

    // Permanently deletes every persisted self-learned rule, across every
    // account - used by the Import Preview's "clear all self-learned
    // rules" header action (see ImportService.clearAllLearnedRules). Not
    // scoped to a single account: the action is explicitly presented to
    // the user as clearing ALL saved rules.
    async deleteAll(): Promise<void> {
        await this.execute(
            `
            DELETE FROM counterparty_rules
            `
        );
    }
}
