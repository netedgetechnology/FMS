import { Repository } from "@/core/database/engine/Repository";

import type { CustomImportRule } from "../types";

const SELECT_COLUMNS = `
    id,
    account_id AS accountId,
    keyword,
    payee,
    notes,
    category_id AS categoryId,
    transaction_type AS transactionType,
    created_at AS createdAt,
    updated_at AS updatedAt
`;

// Storage for user-defined Import rules (import_custom_rules, migration
// 041). Never touches counterparty_rules (automatic Self-Learning) or
// any transaction.
export class CustomImportRuleRepository extends Repository {
    // One account's rules, NEWEST FIRST (insertion order) - the order in
    // which applyCustomImportRules gives each field to the first match.
    async listByAccount(
        accountId: string
    ): Promise<CustomImportRule[]> {
        return await this.select<CustomImportRule>(
            `
            SELECT ${SELECT_COLUMNS}
            FROM import_custom_rules
            WHERE account_id = ?
            ORDER BY rowid DESC
            `,
            [accountId]
        );
    }

    // Every account's rules, newest first - for the Import Rules page.
    async listAll(): Promise<CustomImportRule[]> {
        return await this.select<CustomImportRule>(
            `
            SELECT ${SELECT_COLUMNS}
            FROM import_custom_rules
            ORDER BY rowid DESC
            `
        );
    }

    async create(
        rule: Omit<CustomImportRule, "createdAt" | "updatedAt">
    ): Promise<CustomImportRule> {
        await this.execute(
            `
            INSERT INTO import_custom_rules
            (
                id,
                account_id,
                keyword,
                payee,
                notes,
                category_id,
                transaction_type,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `,
            [
                rule.id,
                rule.accountId,
                rule.keyword,
                rule.payee,
                rule.notes,
                rule.categoryId,
                rule.transactionType,
            ]
        );

        const rows = await this.select<CustomImportRule>(
            `
            SELECT ${SELECT_COLUMNS}
            FROM import_custom_rules
            WHERE id = ?
            `,
            [rule.id]
        );

        if (!rows[0]) {
            throw new Error("Failed to save custom import rule.");
        }

        return rows[0];
    }

    // Edits a rule in place: same id and rowid, so it keeps its place in
    // the newest-first precedence order. created_at is kept.
    async update(
        rule: Omit<CustomImportRule, "createdAt" | "updatedAt">
    ): Promise<CustomImportRule> {
        await this.execute(
            `
            UPDATE import_custom_rules
            SET
                account_id = ?,
                keyword = ?,
                payee = ?,
                notes = ?,
                category_id = ?,
                transaction_type = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [
                rule.accountId,
                rule.keyword,
                rule.payee,
                rule.notes,
                rule.categoryId,
                rule.transactionType,
                rule.id,
            ]
        );

        const rows = await this.select<CustomImportRule>(
            `
            SELECT ${SELECT_COLUMNS}
            FROM import_custom_rules
            WHERE id = ?
            `,
            [rule.id]
        );

        if (!rows[0]) {
            throw new Error("This custom import rule no longer exists.");
        }

        return rows[0];
    }

    async delete(id: string): Promise<void> {
        await this.execute(
            `
            DELETE FROM import_custom_rules
            WHERE id = ?
            `,
            [id]
        );
    }
}
