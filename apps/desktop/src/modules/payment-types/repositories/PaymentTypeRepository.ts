import { Repository } from "@/core/database/engine/Repository";

import { PaymentType, PaymentTypeUsage } from "../types";

export class PaymentTypeRepository extends Repository {

    private readonly selectFields = `
        id,
        code,
        label,
        is_active AS isActive,
        sort_order AS sortOrder,
        created_at AS createdAt,
        updated_at AS updatedAt
    `;

    // Every type, active and inactive, in display order.
    async getAll(): Promise<PaymentType[]> {

        const rows =
            await this.select<PaymentType>(
                `
                SELECT
                    ${this.selectFields}
                FROM payment_types
                ORDER BY sort_order, LOWER(label)
                `
            );

        return rows.map(toPaymentType);
    }

    async getById(
        id: string
    ): Promise<PaymentType | null> {

        const rows =
            await this.select<PaymentType>(
                `
                SELECT
                    ${this.selectFields}
                FROM payment_types
                WHERE id = ?
                `,
                [id]
            );

        return rows[0] ? toPaymentType(rows[0]) : null;
    }

    async create(
        paymentType: PaymentType
    ): Promise<void> {

        await this.execute(
            `
            INSERT INTO payment_types
            (
                id,
                code,
                label,
                is_active,
                sort_order,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                paymentType.id,
                paymentType.code,
                paymentType.label,
                paymentType.isActive ? 1 : 0,
                paymentType.sortOrder,
                paymentType.createdAt,
                paymentType.updatedAt,
            ]
        );
    }

    // Every persistent record that stores this code. Read-only.
    async getUsage(
        code: string
    ): Promise<PaymentTypeUsage> {

        const quoted = JSON.stringify(code);

        const rows =
            await this.select<PaymentTypeUsage>(
                `
                SELECT
                    (
                        SELECT COUNT(*)
                        FROM transactions
                        WHERE payment_method = ?
                           OR transaction_type = ?
                    ) AS transactions,
                    (
                        SELECT COUNT(*)
                        FROM import_custom_rules
                        WHERE transaction_type = ?
                    ) AS importRules,
                    (
                        SELECT COUNT(*)
                        FROM counterparty_rules
                        WHERE type = ?
                    ) AS learnedRules,
                    (
                        SELECT COUNT(*)
                        FROM import_rows
                        WHERE json_valid(normalized_data)
                          AND json_extract(normalized_data, '$.transactionType') = ?
                    ) AS importHistory,
                    (
                        SELECT COUNT(*)
                        FROM import_drafts
                        WHERE instr(state_json, ?) > 0
                           OR instr(preview_json, ?) > 0
                    ) AS importDrafts
                `,
                [code, code, code, code, code, quoted, quoted]
            );

        const row = rows[0];

        return {
            transactions: Number(row?.transactions ?? 0),
            importRules: Number(row?.importRules ?? 0),
            learnedRules: Number(row?.learnedRules ?? 0),
            importHistory: Number(row?.importHistory ?? 0),
            importDrafts: Number(row?.importDrafts ?? 0),
        };
    }

    // Permanent removal - only ever called for an unused, user-added
    // type (see PaymentTypeService.delete).
    async delete(
        id: string
    ): Promise<void> {

        await this.execute(
            `
            DELETE FROM payment_types
            WHERE id = ?
            `,
            [id]
        );
    }

    // Label and active state only - a code is permanent, since
    // transactions store it.
    async update(
        paymentType: Pick<PaymentType, "id" | "label" | "isActive">
    ): Promise<void> {

        await this.execute(
            `
            UPDATE payment_types
            SET
                label = ?,
                is_active = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [
                paymentType.label,
                paymentType.isActive ? 1 : 0,
                paymentType.id,
            ]
        );
    }
}

function toPaymentType(row: PaymentType): PaymentType {
    return {
        ...row,
        isActive: Boolean(row.isActive),
        sortOrder: Number(row.sortOrder),
    };
}
