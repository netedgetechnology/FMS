import { PaymentTypeRepository } from "../repositories";

import {
    CreatePaymentTypeRequest,
    PaymentType,
    UpdatePaymentTypeRequest,
} from "../types";

// "  Google   Pay " -> "Google Pay".
export function normalizePaymentTypeLabel(label: string): string {
    return label.trim().replace(/\s+/g, " ");
}

// The permanent stored code for a new type: "Google Pay" -> "GOOGLE_PAY".
export function paymentTypeCodeFromLabel(label: string): string {
    return normalizePaymentTypeLabel(label)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

export class PaymentTypeService {

    private readonly repository =
        new PaymentTypeRepository();

    async getAll(): Promise<PaymentType[]> {
        return await this.repository.getAll();
    }

    async create(
        request: CreatePaymentTypeRequest
    ): Promise<string> {

        const label =
            normalizePaymentTypeLabel(request.label ?? "");

        const code =
            paymentTypeCodeFromLabel(label);

        if (!label || !code) {
            throw new Error(
                "Enter a payment type name containing at least one letter or number."
            );
        }

        const existing =
            await this.repository.getAll();

        assertNoDuplicate(existing, label, code);

        const now =
            new Date().toISOString();

        const paymentType: PaymentType = {
            id: crypto.randomUUID(),
            code,
            label,
            isActive: true,
            sortOrder:
                existing.reduce(
                    (max, type) => Math.max(max, type.sortOrder),
                    0
                ) + 10,
            createdAt: now,
            updatedAt: now,
        };

        await this.repository.create(paymentType);

        return paymentType.id;
    }

    // Rename and/or activate/deactivate. The code never changes, so every
    // transaction already storing it keeps pointing at this type.
    async update(
        request: UpdatePaymentTypeRequest
    ): Promise<void> {

        const current =
            await this.repository.getById(request.id);

        if (!current) {
            throw new Error("Payment type not found.");
        }

        const label =
            request.label === undefined
                ? current.label
                : normalizePaymentTypeLabel(request.label);

        if (!label) {
            throw new Error("Enter a payment type name.");
        }

        if (label !== current.label) {
            assertNoDuplicate(
                (await this.repository.getAll()).filter(
                    type => type.id !== current.id
                ),
                label,
                null
            );
        }

        await this.repository.update({
            id: current.id,
            label,
            isActive: request.isActive ?? current.isActive,
        });
    }
}

// Duplicates are checked against every type, inactive ones included, so a
// deactivated type is never shadowed by a new copy - it must be
// reactivated instead.
function assertNoDuplicate(
    existing: readonly PaymentType[],
    label: string,
    code: string | null
): void {
    const clash = existing.find(
        type =>
            type.label.trim().toLowerCase() === label.toLowerCase() ||
            (code !== null && type.code.trim().toUpperCase() === code)
    );

    if (!clash) {
        return;
    }

    throw new Error(
        clash.isActive
            ? `A payment type "${clash.label}" already exists.`
            : `A payment type "${clash.label}" already exists but is inactive. Activate it instead of adding it again.`
    );
}
