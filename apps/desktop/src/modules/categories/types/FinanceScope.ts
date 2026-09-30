// A single scope a category can be available in.
export type BaseFinanceScope =
    | "PERSONAL"
    | "BUSINESS";

// A category's stored scope (categories.finance_scope): Personal-only,
// Business-only, or both. See utils/financeScope.ts.
export type FinanceScope =
    | BaseFinanceScope
    | "BOTH";
