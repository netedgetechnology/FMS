import { PaymentTypeRepository } from "../repositories";

import {
    CreatePaymentTypeRequest,
    PaymentType,
    PaymentTypeUsage,
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

// Adding or renaming to a name (or code) another type already has. Carries
// that existing type, so the UI can offer to reactivate it when it is
// inactive instead of creating a second record.
export class DuplicatePaymentTypeError extends Error {
    readonly existing: PaymentType;

    constructor(existing: PaymentType) {
        super(
            existing.isActive
                ? `A payment type "${existing.label}" already exists.`
                : `A payment type "${existing.label}" already exists but is inactive. Activate it instead of adding it again.`
        );
        this.name = "DuplicatePaymentTypeError";
        this.existing = existing;
    }
}

// Delete refused: the type is built in, or still stored by some record.
export class PaymentTypeNotDeletableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PaymentTypeNotDeletableError";
    }
}

// The types migration 044 seeds (ids "pt-..."). The import engine detects
// several of them, so they are never deleted - only deactivated.
export function isBuiltInPaymentType(
    paymentType: Pick<PaymentType, "id">
): boolean {
    return paymentType.id.startsWith("pt-");
}

export const PAYMENT_TYPE_IN_USE_MESSAGE =
    "This Payment Type is in use and cannot be deleted. Deactivate it instead.";

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

    // Null when the type may be permanently deleted; otherwise why not.
    async getDeleteBlocker(
        id: string
    ): Promise<string | null> {

        const current =
            await this.repository.getById(id);

        if (!current) {
            return "Payment type not found.";
        }

        return deleteBlocker(
            current,
            await this.repository.getUsage(current.code)
        );
    }

    // Permanently removes an unused, user-added type. A built-in or used
    // type is refused (deactivate it instead); no other record is ever
    // read for change or modified.
    async delete(
        id: string
    ): Promise<void> {

        const blocker =
            await this.getDeleteBlocker(id);

        if (blocker) {
            throw new PaymentTypeNotDeletableError(blocker);
        }

        await this.repository.delete(id);
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

// Why a type cannot be deleted, or null when it can.
function deleteBlocker(
    paymentType: PaymentType,
    usage: PaymentTypeUsage
): string | null {
    if (isBuiltInPaymentType(paymentType)) {
        return `"${paymentType.label}" is a built-in payment type and cannot be deleted. Deactivate it instead.`;
    }

    const uses = [
        [usage.transactions, "transaction"],
        [usage.importRules, "import rule"],
        [usage.learnedRules, "learned import rule"],
        [usage.importHistory, "import history row"],
        [usage.importDrafts, "unfinished import"],
    ] as const;

    const used = uses.filter(([count]) => count > 0);

    if (used.length === 0) {
        return null;
    }

    const detail = used
        .map(([count, noun]) => `${count} ${noun}${count === 1 ? "" : "s"}`)
        .join(", ");

    return `${PAYMENT_TYPE_IN_USE_MESSAGE} (Used by ${detail}.)`;
}

// Duplicates are checked against every type, inactive ones included, so a
// deactivated type is never shadowed by a new copy - it must be
// reactivated instead. Names compare after the same normalization on both
// sides (case, leading/trailing and repeated internal spaces).
function assertNoDuplicate(
    existing: readonly PaymentType[],
    label: string,
    code: string | null
): void {
    const key = normalizePaymentTypeLabel(label).toLowerCase();

    const clash = existing.find(
        type =>
            normalizePaymentTypeLabel(type.label).toLowerCase() === key ||
            (code !== null && type.code.trim().toUpperCase() === code)
    );

    if (clash) {
        throw new DuplicatePaymentTypeError(clash);
    }
}
