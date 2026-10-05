import { Repository } from "@/core/database/engine/Repository";

import { PaymentType } from "../types";

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
