import { IMigration } from "../types/IMigration";

export const CategoryTransferDirectionMigration: IMigration = {
    version: 49,
    name: "Category Transfer Direction",
    // A Transfer category's intended direction: 'IN' (money into the
    // account, e.g. a loan principal drawdown) or 'OUT' (money out of it,
    // e.g. a loan principal repayment). NULL = the category is used both
    // ways (e.g. "Bank Transfer"), so the direction keeps coming from the
    // transaction itself. Only meaningful when category_type = 'TRANSFER'
    // (CategoryService stores NULL for any other type).
    //
    // Set by the user in Edit Category. Purely additive and nullable: every
    // existing category gets NULL, and no category or transaction row is
    // changed.
    sql: `
ALTER TABLE categories ADD COLUMN transfer_direction TEXT
    CHECK (transfer_direction IS NULL OR transfer_direction IN ('IN', 'OUT'));
`
};
