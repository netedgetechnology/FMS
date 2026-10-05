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

// How many persistent records store a payment type's code. Any non-zero
// count means the type is in use and must not be deleted.
export interface PaymentTypeUsage {
    // transactions.payment_method or transactions.transaction_type,
    // soft-deleted transactions included.
    transactions: number;
    // import_custom_rules.transaction_type
    importRules: number;
    // counterparty_rules.type (self-learned import rules)
    learnedRules: number;
    // import_rows.normalized_data.transactionType (import history)
    importHistory: number;
    // An unfinished Import Preview draft mentioning the code.
    importDrafts: number;
}

// One <option> of a Payment Type selector.
export interface PaymentTypeOption {
    value: string;

    label: string;

    // The row's own current value, which is not an active type - shown so
    // it is never silently cleared, but not offered to anything else.
    inactive?: boolean;
}
