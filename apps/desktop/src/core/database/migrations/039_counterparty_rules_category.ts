import { IMigration } from "../types/IMigration";

export const CounterpartyRulesCategoryMigration: IMigration = {
    version: 39,
    name: "Counterparty Rules Category",
    // Lets a self-learned import rule (see ImportService's
    // learnRuleFromCandidate / enrichCandidatesWithLearnedRules) also
    // remember the Category the user chose for that payee pattern +
    // Credit/Debit direction, alongside the already-learned Payee, Type
    // and Notes (migration 028). Purely additive and nullable: every
    // existing rule keeps working unchanged (NULL = no category learned
    // yet), and no existing row, table or constraint is touched. Stores
    // the Categories module id, never a name.
    sql: `
ALTER TABLE counterparty_rules ADD COLUMN category_id TEXT;
`
};
