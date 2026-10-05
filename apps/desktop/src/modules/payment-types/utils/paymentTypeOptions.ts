import type { PaymentType, PaymentTypeOption } from "../types";

// ---------------------------------------------------------------------
// The options every Payment Type selector shows, built only from the
// master list (Settings -> Payment Types) - no selector keeps its own
// list. Shared by Import Preview, Custom Import Rules, Add/Edit
// Transaction and the Loan EMI payment.
// ---------------------------------------------------------------------

// Active types, in master-list order - what can be newly selected.
export function activePaymentTypeOptions(
    paymentTypes: readonly PaymentType[]
): PaymentTypeOption[] {
    return paymentTypes
        .filter(type => type.isActive)
        .map(type => ({ value: type.code, label: type.label }));
}

// A selector's options for a record whose current value is `current`:
// the active types, plus `current` itself when it is not one of them (an
// inactive or no-longer-listed code). That value stays selected and
// visible, so opening and saving the record never erases it - it just
// cannot be chosen for anything else.
export function paymentTypeOptionsFor(
    active: readonly PaymentTypeOption[],
    paymentTypes: readonly PaymentType[],
    current: string | null | undefined
): readonly PaymentTypeOption[] {
    if (!current || active.some(option => option.value === current)) {
        return active;
    }

    return [
        ...active,
        {
            value: current,
            label: `${paymentTypeLabel(paymentTypes, current)} (inactive)`,
            inactive: true,
        },
    ];
}

// How a stored code is shown: its master-list label, or the raw code if
// it is not in the list at all.
export function paymentTypeLabel(
    paymentTypes: readonly PaymentType[],
    code: string
): string {
    return paymentTypes.find(type => type.code === code)?.label ?? code;
}
