import { Repository } from "@/core/database/engine/Repository";
import {
    Currency,
    UpdateCurrencyRequest,
} from "../types";

export class CurrencyRepository extends Repository {
    async getAll(): Promise<Currency[]> {
        return await this.select<Currency>(
            `
            SELECT
                id,
                code,
                name,
                symbol,
                is_default AS isDefault,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM currencies
            WHERE deleted_at IS NULL
            ORDER BY
                is_default DESC,
                code ASC
            `
        );
    }

    async getById(id: string): Promise<Currency | null> {
        const rows = await this.select<Currency>(
            `
            SELECT
                id,
                code,
                name,
                symbol,
                is_default AS isDefault,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM currencies
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );

        return rows[0] ?? null;
    }

    async create(currency: Currency): Promise<void> {
        await this.execute(
            `
            INSERT INTO currencies
            (
                id,
                code,
                name,
                symbol,
                is_default,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                currency.id,
                currency.code,
                currency.name,
                currency.symbol,
                currency.isDefault ? 1 : 0,
                currency.createdAt,
                currency.updatedAt,
            ]
        );
    }

    async update(request: UpdateCurrencyRequest): Promise<void> {
        await this.execute(
            `
            UPDATE currencies
            SET
                code = ?,
                name = ?,
                symbol = ?,
                is_default = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [
                request.code,
                request.name,
                request.symbol,
                request.isDefault ? 1 : 0,
                request.id,
            ]
        );
    }

    async delete(id: string): Promise<void> {
        await this.execute(
            `
            UPDATE currencies
            SET
                deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [id]
        );
    }
}
