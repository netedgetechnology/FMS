// A user-defined, permanent Import rule (migration 041): when an imported
// row's original Description contains `keyword` (case-insensitive,
// whitespace-normalized), set each specified field. A null field means
// "this rule doesn't set it" - that field keeps flowing through the
// existing Self-Learning / import logic. Scoped to one account, like the
// automatic self-learned rules (CounterpartyRule).
export interface CustomImportRule {
    id: string;
    accountId: string;
    keyword: string;
    payee: string | null;
    notes: string | null;
    categoryId: string | null;
    // Transaction channel (UPI/IMPS/NEFT/...) - the Import Preview's
    // "Type" column, the same field Self-Learning learns as `type`.
    transactionType: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface CreateCustomImportRuleInput {
    accountId: string;
    keyword: string;
    payee?: string | null;
    notes?: string | null;
    categoryId?: string | null;
    transactionType?: string | null;
}
