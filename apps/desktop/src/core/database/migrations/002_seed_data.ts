import { IMigration } from "../types/IMigration";

export const SeedDataMigration: IMigration = {
  version: 2,
  name: "Seed Data",
  seed: true,
  sql: `
INSERT OR IGNORE INTO currencies
(id, code, name, symbol, is_default)
VALUES
(
'USD',
'USD',
'US Dollar',
'$',
1
);

INSERT OR IGNORE INTO institutions
(id, name, type)
VALUES
(
'CASH',
'Cash',
'Cash'
);
`
};
