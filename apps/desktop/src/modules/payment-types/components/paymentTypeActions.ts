import { getErrorMessage } from "@/core/errors";

import { notifyPaymentTypesChanged } from "../hooks";
import {
    DuplicatePaymentTypeError,
    type PaymentTypeService,
} from "../services";
import type { PaymentType } from "../types";

// ---------------------------------------------------------------------
// What each Payment Types page action does, independent of React state:
// call the service, refresh every open Payment Type list/selector on
// success, and turn any failure into a message (never swallowed - it is
// returned for display and logged to the console). PaymentTypeManager
// applies the result; tests drive these directly.
// ---------------------------------------------------------------------

export interface PaymentTypeActionResult {
    ok: boolean;
    success: string | null;
    error: string | null;
    // An inactive type matching the name just added - offered for
    // reactivation instead of creating a second record.
    reactivateCandidate: PaymentType | null;
    // The record an Add created (to scroll to and highlight).
    createdId: string | null;
}

type PaymentTypeWriter = Pick<
    PaymentTypeService,
    "create" | "update" | "delete" | "getDeleteBlocker"
>;

export async function runPaymentTypeAction(
    action: () => Promise<unknown>,
    success: string,
    fallback: string
): Promise<PaymentTypeActionResult> {
    try {
        await action();
    } catch (err) {
        console.error("PAYMENT TYPE ACTION ERROR:", err);

        return {
            ok: false,
            success: null,
            error: getErrorMessage(err, fallback),
            reactivateCandidate:
                err instanceof DuplicatePaymentTypeError &&
                !err.existing.isActive
                    ? err.existing
                    : null,
            createdId: null,
        };
    }

    notifyPaymentTypesChanged();

    return { ok: true, success, error: null, reactivateCandidate: null, createdId: null };
}

export async function addPaymentType(
    service: PaymentTypeWriter,
    label: string
): Promise<PaymentTypeActionResult> {
    let createdId: string | null = null;

    const result = await runPaymentTypeAction(
        async () => {
            createdId = await service.create({ label });
        },
        "Payment type added.",
        "Unable to add the payment type."
    );

    return { ...result, createdId: result.ok ? createdId : null };
}

// Before asking for confirmation: why this type cannot be deleted (built
// in, or in use - deactivate it instead), or null when it can.
export async function deleteBlockerFor(
    service: PaymentTypeWriter,
    paymentType: PaymentType
): Promise<string | null> {
    try {
        return await service.getDeleteBlocker(paymentType.id);
    } catch (err) {
        console.error("PAYMENT TYPE ACTION ERROR:", err);

        return getErrorMessage(err, "Unable to check whether this payment type is in use.");
    }
}

// Permanently deletes an unused type (the service re-checks usage).
export function deletePaymentType(
    service: PaymentTypeWriter,
    paymentType: PaymentType
): Promise<PaymentTypeActionResult> {
    return runPaymentTypeAction(
        () => service.delete(paymentType.id),
        `"${paymentType.label}" deleted.`,
        "Unable to delete the payment type."
    );
}

// Reactivates the existing inactive type instead of adding a duplicate.
export function reactivatePaymentType(
    service: PaymentTypeWriter,
    paymentType: PaymentType
): Promise<PaymentTypeActionResult> {
    return runPaymentTypeAction(
        () => service.update({ id: paymentType.id, isActive: true }),
        `"${paymentType.label}" activated.`,
        "Unable to update the payment type."
    );
}

export function renamePaymentType(
    service: PaymentTypeWriter,
    id: string,
    label: string
): Promise<PaymentTypeActionResult> {
    return runPaymentTypeAction(
        () => service.update({ id, label }),
        "Payment type renamed.",
        "Unable to rename the payment type."
    );
}

export function togglePaymentTypeActive(
    service: PaymentTypeWriter,
    paymentType: PaymentType
): Promise<PaymentTypeActionResult> {
    return runPaymentTypeAction(
        () => service.update({ id: paymentType.id, isActive: !paymentType.isActive }),
        paymentType.isActive
            ? `"${paymentType.label}" deactivated.`
            : `"${paymentType.label}" activated.`,
        "Unable to update the payment type."
    );
}

// The New payment type input after an Add/Reactivate: cleared on success,
// kept (so it can be corrected) on failure.
export function newLabelAfter(
    result: PaymentTypeActionResult,
    current: string
): string {
    return result.ok ? "" : current;
}
