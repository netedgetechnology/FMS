import { Repository } from "@/core/database/engine/Repository";
import {
    Account,
    UpdateAccountRequest,
} from "../types";

export class AccountRepository extends Repository {
    async getAll(): Promise<Account[]> {
        const rows = await this.select<Account>(
            `
            SELECT
                accounts.id,
                accounts.name,
                accounts.account_type AS type,
                accounts.institution_id AS institutionId,
                institutions.name AS institutionName,
                accounts.business_entity_id AS businessEntityId,
                business_entities.name AS businessEntityName,
                accounts.currency_id AS currencyId,
                accounts.opening_balance AS openingBalance,
                accounts.account_number AS accountNumber,
                accounts.branch_name AS branchName,
                accounts.ifsc_code AS ifscCode,
                accounts.swift_code AS swiftCode,
                accounts.iban,
                accounts.description,
                accounts.is_active AS isActive,
                accounts.created_at AS createdAt,
                accounts.updated_at AS updatedAt
            FROM accounts
            LEFT JOIN institutions
                ON institutions.id = accounts.institution_id
            LEFT JOIN business_entities
                ON business_entities.id = accounts.business_entity_id
            WHERE accounts.deleted_at IS NULL
            ORDER BY accounts.name
            `
        );

        return rows.map(account => ({
            ...account,
            isActive: Boolean(account.isActive),
        }));
    }

    async getById(id: string): Promise<Account | null> {
        const rows = await this.select<Account>(
            `
            SELECT
                accounts.id,
                accounts.name,
                accounts.account_type AS type,
                accounts.institution_id AS institutionId,
                institutions.name AS institutionName,
                accounts.business_entity_id AS businessEntityId,
                business_entities.name AS businessEntityName,
                accounts.currency_id AS currencyId,
                accounts.opening_balance AS openingBalance,
                accounts.account_number AS accountNumber,
                accounts.branch_name AS branchName,
                accounts.ifsc_code AS ifscCode,
                accounts.swift_code AS swiftCode,
                accounts.iban,
                accounts.description,
                accounts.is_active AS isActive,
                accounts.created_at AS createdAt,
                accounts.updated_at AS updatedAt
            FROM accounts
            LEFT JOIN institutions
                ON institutions.id = accounts.institution_id
            LEFT JOIN business_entities
                ON business_entities.id = accounts.business_entity_id
            WHERE accounts.id = ?
              AND accounts.deleted_at IS NULL
            `,
            [id]
        );

        const account = rows[0];

    if (!account) {
        return null;
    }

    return {
        ...account,
        isActive: Boolean(account.isActive),
    };
    }

    async create(account: Account): Promise<void> {
        await this.execute(
            `
            INSERT INTO accounts
            (
                id,
                institution_id,
                business_entity_id,
                currency_id,
                name,
                account_type,
                opening_balance,
                account_number,
                branch_name,
                ifsc_code,
                swift_code,
                iban,
                description,
                is_active,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                account.id,
                account.institutionId,
                account.businessEntityId ?? null,
                account.currencyId,
                account.name,
                account.type,
                account.openingBalance,
                account.accountNumber ?? null,
                account.branchName ?? null,
                account.ifscCode ?? null,
                account.swiftCode ?? null,
                account.iban ?? null,
                account.description ?? null,
                account.isActive ? 1 : 0,
                account.createdAt,
                account.updatedAt,
            ]
        );
    }

    async update(account: UpdateAccountRequest): Promise<void> {
        await this.execute(
            `
            UPDATE accounts
            SET
                institution_id = ?,
                business_entity_id = ?,
                currency_id = ?,
                name = ?,
                account_type = ?,
                opening_balance = ?,
                account_number = ?,
                branch_name = ?,
                ifsc_code = ?,
                swift_code = ?,
                iban = ?,
                description = ?,
                is_active = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [
                account.institutionId,
                account.businessEntityId ?? null,
                account.currencyId,
                account.name,
                account.type,
                account.openingBalance,
                account.accountNumber ?? null,
                account.branchName ?? null,
                account.ifscCode ?? null,
                account.swiftCode ?? null,
                account.iban ?? null,
                account.description ?? null,
                account.isActive ? 1 : 0,
                account.id,
            ]
        );
    }

    async delete(id: string): Promise<void> {
        await this.execute(
            `
            UPDATE accounts
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [id]
        );
    }

    /**
     * Keeps an account that is owned 1:1 by another record (e.g. an
     * investment) in sync without disturbing its other columns.
     *
     * The monetary worth of such a record lives in its own domain, so this
     * deliberately does NOT touch opening_balance - the linked account stays
     * at 0 and never contributes to balance/net-worth aggregates.
     */
    async syncLinkedAccount(params: {
        id: string;
        name: string;
        currencyId: string;
        businessEntityId: string | null;
        isActive: boolean;
    }): Promise<void> {
        await this.execute(
            `
            UPDATE accounts
            SET
                name = ?,
                currency_id = ?,
                business_entity_id = ?,
                is_active = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [
                params.name,
                params.currencyId,
                params.businessEntityId,
                params.isActive ? 1 : 0,
                params.id,
            ]
        );
    }
}



