import { IMigration } from "../types/IMigration";

export const CurrencyExpansionMigration: IMigration = {
    version: 9,
    name: "Currency Expansion",
    seed: true,
    sql: `
INSERT OR IGNORE INTO currencies
(id, code, name, symbol, is_default)
VALUES
('INR', 'INR', 'Indian Rupee', '₹', 0),
('AUD', 'AUD', 'Australian Dollar', 'A$', 0),
('GBP', 'GBP', 'British Pound', '£', 0);
`,
};
