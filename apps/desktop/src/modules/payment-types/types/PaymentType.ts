// One entry of the user-managed Payment Type master list (Settings ->
// Payment Types). `code` is what transactions store - in both
// transactions.transaction_type (import channel) and
// transactions.payment_method - and never changes once created; `label`
// is only how it is shown and can be renamed freely.
export interface PaymentType {
    id: string;

    code: string;

    label: string;

    // Inactive types are not offered for new selections, but every
    // existing transaction keeps (and still displays) its value.
    isActive: boolean;

    sortOrder: number;

    createdAt: string;

    updatedAt: string;
}

export interface CreatePaymentTypeRequest {
    label: string;
}

export interface UpdatePaymentTypeRequest {
    id: string;

    label?: string;

    isActive?: boolean;
}

// One <option> of a Payment Type selector.
export interface PaymentTypeOption {
    value: string;

    label: string;

    // The row's own current value, which is not an active type - shown so
    // it is never silently cleared, but not offered to anything else.
    inactive?: boolean;
}
