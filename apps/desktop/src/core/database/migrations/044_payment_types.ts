import { IMigration } from "../types/IMigration";

// Seeded Payment Types: every value either Payment Type field already
// accepted before this master list existed, with its exact stored code -
// transactions.transaction_type (import channel) and
// transactions.payment_method (manual Payment Method) both keep storing
// these codes unchanged. Exported so tests can assert the seed.
//
// CARD is the Payment Method form's old code for "Credit Card", while the
// import channel stores CREDIT_CARD for the same thing. One master list
// cannot offer "Credit Card" twice, so CREDIT_CARD is the active one and
// CARD is kept as an inactive legacy entry: existing CARD transactions
// keep their value and still display, it is just not offered for new
// selections (it can be reactivated in Settings -> Payment Types).
export const SEEDED_PAYMENT_TYPES: ReadonlyArray<{
    code: string;
    label: string;
    isActive: boolean;
}> = [
    { code: "UPI", label: "UPI", isActive: true },
    { code: "IMPS", label: "IMPS", isActive: true },
    { code: "NEFT", label: "NEFT", isActive: true },
    { code: "RTGS", label: "RTGS", isActive: true },
    { code: "CASH", label: "Cash", isActive: true },
    { code: "CHEQUE", label: "Cheque", isActive: true },
    { code: "EMANDATE", label: "E-Mandate", isActive: true },
    { code: "NET_BANKING", label: "Net Banking", isActive: true },
    { code: "MOBILE_APP", label: "Mobile App", isActive: true },
    { code: "CREDIT_CARD", label: "Credit Card", isActive: true },
    { code: "DEBIT_CARD", label: "Debit Card", isActive: true },
    { code: "BANK_TRANSFER", label: "Bank Transfer", isActive: true },
    { code: "DIRECT_DEBIT", label: "Direct Debit", isActive: true },
    { code: "PAYPAL", label: "PayPal", isActive: true },
    { code: "OTHER", label: "Other", isActive: true },
    { code: "CARD", label: "Credit Card (legacy)", isActive: false },
];

const seedRows = SEEDED_PAYMENT_TYPES.map(
    (type, index) =>
        `('pt-${type.code.toLowerCase().replace(/_/g, "-")}', '${type.code}', '${type.label}', ${type.isActive ? 1 : 0}, ${(index + 1) * 10})`
).join(",\n    ");

export const PaymentTypesMigration: IMigration = {
    version: 44,
    name: "Payment Types",
    // The one user-managed Payment Type master list (Settings -> Payment
    // Types). Every Payment Type selector reads it: Import Preview, Custom
    // Import Rules, Add/Edit Transaction and the Loan EMI payment. It
    // backs BOTH existing fields - transactions.transaction_type and
    // transactions.payment_method - which stay separate columns holding
    // a payment type's code. No transaction row is read or changed here.
    //
    // code is the stable stored value and never changes once created
    // (renaming only changes label). Both code and label are unique,
    // case-insensitively. Rows are only ever deactivated, never deleted,
    // since historical transactions may reference any code.
    sql: `

CREATE TABLE IF NOT EXISTS payment_types (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (TRIM(code) <> ''),
    CHECK (TRIM(label) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_types_code
ON payment_types(UPPER(TRIM(code)));

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_types_label
ON payment_types(LOWER(TRIM(label)));

INSERT OR IGNORE INTO payment_types
    (id, code, label, is_active, sort_order)
VALUES
    ${seedRows};

`
};
