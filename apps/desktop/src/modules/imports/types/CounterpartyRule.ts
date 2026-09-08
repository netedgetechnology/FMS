export interface CounterpartyRule {
    id: string;
    // Scoped to the destination FinanceOS account - the same narration
    // pattern is learned/matched independently per account.
    accountId: string;
    pattern: string;
    // The learned Payee for this pattern. Named "counterparty" because
    // this row/table is shared with the original Counterparty-learning
    // feature (see migrations 026/027) and that column can never be
    // renamed - it now carries the Payee.
    counterparty: string;
    // The learned Transaction Type channel (UPI/IMPS/NEFT/...) for this
    // pattern, or null when no Type has been learned yet - see
    // migration 028. A raw string here (not the import-engine
    // TransactionChannel type) since this is the untyped DB shape.
    type: string | null;
    // The learned Notes for this pattern, or null when none has been
    // learned yet - see migration 028. Independent from Description.
    notes: string | null;
    matchCount: number;
    createdAt: string;
    updatedAt: string;
}
