import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionSchemaMigration } from "@/core/database/migrations/003_transactions";
import { TransactionDetailsMigration } from "@/core/database/migrations/014_transaction_details";
import { TransactionChannelTypeMigration } from "@/core/database/migrations/024_transaction_type";
import { TransactionCounterpartyBranchMigration } from "@/core/database/migrations/025_transaction_counterparty_branch";
import { TransactionTransferDirectionMigration } from "@/core/database/migrations/040_transaction_transfer_direction";
import { AccountType } from "@/modules/accounts/types";
import {
    computeBalanceSnapshot,
    computeCashFlowSeries,
} from "@/modules/dashboard/services/DashboardService";

import {
    accountsForBulkMove,
    bulkMoveBlockReason,
    runBulkAccountMove,
} from "./bulkAccountMove";
import { TransactionService } from "./TransactionService";

// ---------------------------------------------------------------------
// Bulk "Move to Account" against the REAL TransactionRepository SQL on an
// in-memory SQLite database (SQLiteProvider mocked, as in the import
// self-learning lifecycle test). Every statement the move runs is logged.
// ---------------------------------------------------------------------

const sqlite = { db: null as DatabaseSync | null, log: [] as string[] };

vi.mock("@/core/database/engine/SQLiteProvider", () => ({
    SQLiteProvider: {
        getInstance: () => ({
            async select(sql: string, binds: unknown[] = []) {
                sqlite.log.push(sql);
                return sqlite.db!.prepare(sql).all(...(binds as never[]));
            },
            async execute(sql: string, binds: unknown[] = []) {
                sqlite.log.push(sql);
                sqlite.db!.prepare(sql).run(...(binds as never[]));
            },
        }),
    },
}));

const accounts = [
    { id: "hdfc", name: "HDFC Bank", type: AccountType.SAVINGS, currencyId: "inr", openingBalance: 10_000, isActive: true },
    { id: "axis", name: "Axis Bank", type: AccountType.CURRENT, currencyId: "inr", openingBalance: 5_000, isActive: true },
    { id: "cash", name: "Cash", type: AccountType.CASH, currencyId: "inr", openingBalance: 500, isActive: true },
    { id: "usd", name: "USD Savings", type: AccountType.SAVINGS, currencyId: "usd", openingBalance: 0, isActive: true },
    { id: "loan", name: "Home Loan", type: AccountType.LOAN, currencyId: "inr", openingBalance: -800_000, isActive: true },
    { id: "old", name: "Old Bank", type: AccountType.SAVINGS, currencyId: "inr", openingBalance: 0, isActive: false },
];

function service(): TransactionService {
    const s = new TransactionService();
    Object.defineProperty(s, "accountRepository", {
        value: {
            getAll: async () => accounts.map(a => ({ ...a, businessEntityId: null })),
            getById: async (id: string) => accounts.find(a => a.id === id) ?? null,
        },
    });
    return s;
}

let seq = 0;

// A fully-populated transaction row, so "every field is preserved" is real.
function insert(accountId: string, overrides: Record<string, unknown> = {}): string {
    seq += 1;
    const id = String(overrides.id ?? `t${seq}`);
    const row: Record<string, unknown> = {
        id, account_id: accountId, category_id: `cat-${seq % 3}`, subcategory_id: null,
        payee: `Payee ${seq}`, counterparty: "Counterparty", branch: "MG Road",
        type: seq % 2 ? "expense" : "income", transfer_direction: null,
        amount: 100 + seq, transaction_date: `2026-08-${String((seq % 28) + 1).padStart(2, "0")}`,
        reference_number: `REF${seq}`, notes: `note ${seq}`, tags: "tag", status: "CLEARED",
        payment_method: "UPI", upi_reference: `UPI${seq}`, bank_transaction_reference: `BTR${seq}`,
        card_reference: null, transaction_type: "NEFT", reconciled: seq % 2, reconciled_at: seq % 2 ? "2026-09-01" : null,
        is_imported: 1, source_statement: "Axis Statement", external_transaction_id: `EXT${seq}`,
        original_narration: `NEFT/${seq}/PAYEE`, created_at: "2026-08-01 10:00:00", updated_at: "2026-08-01 10:00:00",
        ...overrides,
    };
    row.id = id;
    const columns = Object.keys(row);
    sqlite.db!.prepare(
        `INSERT INTO transactions (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    ).run(...(Object.values(row) as never[]));
    return id;
}

const rows = (where = "1 = 1") =>
    sqlite.db!.prepare(`SELECT * FROM transactions WHERE ${where} ORDER BY id`).all() as Record<string, unknown>[];

const idsIn = (accountId: string) =>
    rows(`account_id = '${accountId}' AND deleted_at IS NULL`).map(r => r.id);

function withoutAccount(row: Record<string, unknown>) {
    const rest = { ...row };
    delete rest.account_id;
    delete rest.updated_at;
    return rest;
}

beforeEach(() => {
    seq = 0;
    sqlite.log = [];
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY);`);
    for (const a of accounts) db.exec(`INSERT INTO accounts (id) VALUES ('${a.id}')`);
    for (const migration of [
        TransactionSchemaMigration, TransactionDetailsMigration, TransactionChannelTypeMigration,
        TransactionCounterpartyBranchMigration, TransactionTransferDirectionMigration,
    ]) {
        db.exec(migration.sql);
    }
    // Import history and reconciliations - must never change.
    db.exec(`
        CREATE TABLE import_batches (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, status TEXT);
        CREATE TABLE import_rows (id TEXT PRIMARY KEY, import_batch_id TEXT, transaction_id TEXT REFERENCES transactions(id), status TEXT);
        CREATE TABLE reconciliations (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, statement_balance REAL, status TEXT);
        CREATE TABLE counterparty_rules (id TEXT PRIMARY KEY, account_id TEXT, pattern TEXT);
    `);
    sqlite.db = db;
});

describe("TransactionService.moveToAccount", () => {
    it("moves one transaction - same id, only its account changes", async () => {
        const id = insert("hdfc");
        const before = rows()[0];

        await expect(service().moveToAccount([id], "axis")).resolves.toEqual({ moved: 1 });

        const after = rows()[0];
        expect(after.id).toBe(id);
        expect(after.account_id).toBe("axis");
        expect(withoutAccount(after)).toEqual(withoutAccount(before));
    });

    it("moves many - every field (type, amount, date, payee, category, notes, references, reconciliation, import fields) is preserved", async () => {
        const ids = Array.from({ length: 46 }, () => insert("hdfc"));
        const other = insert("hdfc");
        const before = rows();

        await expect(service().moveToAccount(ids, "axis")).resolves.toEqual({ moved: 46 });

        const after = rows();
        expect(after).toHaveLength(before.length); // nothing created or deleted
        expect(after.map(r => r.id)).toEqual(before.map(r => r.id));
        after.forEach((row, i) => expect(withoutAccount(row)).toEqual(withoutAccount(before[i])));

        // Source no longer has them; destination does; the unselected one stays.
        expect(idsIn("hdfc")).toEqual([other]);
        expect(idsIn("axis").sort()).toEqual([...ids].sort());
        // Reconciled flags survive unchanged.
        expect(after.filter(r => r.reconciled === 1).length).toBe(before.filter(r => r.reconciled === 1).length);
    });

    it("writes exactly ONE statement - an UPDATE of transactions.account_id - and creates no transfer / rule / import change", async () => {
        const ids = [insert("hdfc"), insert("hdfc", { type: "transfer", transfer_direction: "OUT" })];
        sqlite.db!.exec(`
            INSERT INTO import_batches VALUES ('b1', 'hdfc', 'COMPLETED');
            INSERT INTO import_rows VALUES ('r1', 'b1', '${ids[0]}', 'IMPORTED');
            INSERT INTO reconciliations VALUES ('rec1', 'hdfc', 10000, 'RECONCILED');
        `);
        const snapshot = () => ({
            batches: sqlite.db!.prepare("SELECT * FROM import_batches").all(),
            importRows: sqlite.db!.prepare("SELECT * FROM import_rows").all(),
            reconciliations: sqlite.db!.prepare("SELECT * FROM reconciliations").all(),
            rules: sqlite.db!.prepare("SELECT * FROM counterparty_rules").all(),
        });
        const before = snapshot();
        sqlite.log = [];

        await service().moveToAccount(ids, "axis");

        const writes = sqlite.log.filter(sql => !/^\s*SELECT/i.test(sql));
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatch(/UPDATE transactions\s+SET\s+account_id = \?,\s+updated_at = CURRENT_TIMESTAMP/);
        expect(writes[0]).not.toMatch(/INSERT|DELETE|type =|transfer_direction|amount|category_id/);
        expect(snapshot()).toEqual(before);
        // The transfer keeps its type/direction; no new transfer appears.
        expect(rows(`id = '${ids[1]}'`)[0]).toMatchObject({ type: "transfer", transfer_direction: "OUT" });
        expect(rows()).toHaveLength(2);
    });

    it("is atomic: if the update fails part-way, no transaction moves", async () => {
        const ids = Array.from({ length: 10 }, () => insert("hdfc"));
        sqlite.db!.exec(`
            CREATE TRIGGER fail_mid_move BEFORE UPDATE OF account_id ON transactions
            WHEN NEW.id = '${ids[6]}'
            BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
        `);

        await expect(service().moveToAccount(ids, "axis")).rejects.toThrow("simulated failure");

        expect(idsIn("hdfc").sort()).toEqual([...ids].sort());
        expect(idsIn("axis")).toEqual([]);
    });

    it("refuses before writing anything: same account, inactive, loan account, other currency, loan source", async () => {
        const id = insert("hdfc");
        const loanRow = insert("loan");
        sqlite.log = [];

        await expect(service().moveToAccount([id], "hdfc")).rejects.toThrow(/already in "HDFC Bank"/);
        await expect(service().moveToAccount([id], "old")).rejects.toThrow(/inactive/);
        await expect(service().moveToAccount([id], "loan")).rejects.toThrow(/loan account/);
        await expect(service().moveToAccount([id], "usd")).rejects.toThrow(/different currency/);
        await expect(service().moveToAccount([loanRow], "axis")).rejects.toThrow(/can't be moved/);
        await expect(service().moveToAccount([id], "missing")).rejects.toThrow(/not found/);

        expect(sqlite.log.filter(sql => !/^\s*SELECT/i.test(sql))).toEqual([]);
        expect(idsIn("hdfc")).toEqual([id]);
    });

    it("rows already in the destination are left alone; deleted rows are never moved", async () => {
        const a = insert("hdfc");
        const b = insert("axis");
        const gone = insert("hdfc", { deleted_at: "2026-09-01" });

        await expect(service().moveToAccount([a, b, gone], "axis")).resolves.toEqual({ moved: 1 });
        expect(rows(`id = '${gone}'`)[0].account_id).toBe("hdfc");
        expect(rows(`id = '${b}'`)[0].updated_at).toBe("2026-08-01 10:00:00");
    });

    it("moves 1,000+ transactions with a single UPDATE, quickly", async () => {
        const ids = Array.from({ length: 1_200 }, () => insert("hdfc"));
        sqlite.log = [];

        const started = performance.now();
        await expect(service().moveToAccount(ids, "axis")).resolves.toEqual({ moved: 1_200 });
        const elapsed = performance.now() - started;

        // One SELECT (getByIds, a single json_each bind) + ONE UPDATE - never per row.
        expect(sqlite.log).toHaveLength(2);
        expect(sqlite.log.filter(sql => /^\s*UPDATE transactions/.test(sql))).toHaveLength(1);
        expect(idsIn("axis")).toHaveLength(1_200);
        expect(elapsed).toBeLessThan(2_000);
    });
});

describe("accounting effect: a reassignment, not a transfer", () => {
    const balanceAccounts = accounts.filter(a => a.isActive);

    function ledger() {
        return rows("deleted_at IS NULL").map(r => ({
            id: String(r.id), accountId: String(r.account_id), type: String(r.type),
            amount: Number(r.amount), transferDirection: (r.transfer_direction as string | null) ?? null,
            transactionDate: String(r.transaction_date), categoryId: (r.category_id as string | null) ?? null,
        }));
    }

    function position() {
        const txns = ledger();
        const snapshot = computeBalanceSnapshot({
            accounts: balanceAccounts, transactions: txns, loans: [], loanPayments: [],
            investments: [], investmentTransactions: [], asOf: null,
        });
        const flow = computeCashFlowSeries(txns, { start: "2026-08-01", end: "2026-08-31" });
        return {
            snapshot,
            income: flow.reduce((s, p) => s + p.income, 0),
            expense: flow.reduce((s, p) => s + p.expense, 0),
            balance: (id: string) => snapshot.accounts.find(a => a.id === id)?.amount,
        };
    }

    it("only the source and destination balances change; Net Worth, bank total, Income and Expenses don't", async () => {
        const moved = [
            insert("hdfc", { type: "income", amount: 3_000 }),
            insert("hdfc", { type: "expense", amount: 1_200 }),
            insert("hdfc", { type: "transfer", transfer_direction: "OUT", amount: 400 }),
        ];
        insert("hdfc", { type: "expense", amount: 50 });
        insert("cash", { type: "expense", amount: 20 });

        const before = position();
        await service().moveToAccount(moved, "axis");
        const after = position();

        // 3,000 - 1,200 - 400 = +1,400 net moves from HDFC to Axis.
        expect(after.balance("hdfc")).toBe(before.balance("hdfc")! - 1_400);
        expect(after.balance("axis")).toBe(before.balance("axis")! + 1_400);
        expect(after.balance("cash")).toBe(before.balance("cash"));

        expect(after.snapshot.bankBalance).toBe(before.snapshot.bankBalance);
        expect(after.snapshot.netWorth).toBe(before.snapshot.netWorth);
        expect(after.income).toBe(before.income);
        expect(after.expense).toBe(before.expense);
        expect(after.income).toBe(3_000); // not duplicated; transfer excluded
    });
});

describe("dialog rules and toast", () => {
    const sel = (accountId: string) => [{ id: "t", accountId }];
    const byId = new Map(accounts.map(a => [a.id, a]));

    it("offers other active ledger accounts in the same currency - never the selection's own account", () => {
        expect(accountsForBulkMove(accounts, sel("hdfc")).map(a => a.id)).toEqual(["axis", "cash"]);
        // A mixed-account selection can go to either of its accounts.
        expect(accountsForBulkMove(accounts, [...sel("hdfc"), { id: "u", accountId: "axis" }]).map(a => a.id)).toEqual(["hdfc", "axis", "cash"]);
        expect(accountsForBulkMove(accounts, sel("loan"))).toEqual([]);
        expect(bulkMoveBlockReason(sel("hdfc"), byId.get("usd")!, byId)).toMatch(/different currency/);
    });

    it("toasts 'N transactions moved to <Account>.' on success, and a nothing-moved error on failure", async () => {
        const notify = { success: vi.fn(), error: vi.fn() };

        await expect(runBulkAccountMove({ moveToAccount: async () => ({ moved: 46 }) }, ["a"], { id: "axis", name: "Axis Bank" }, notify))
            .resolves.toEqual({ moved: true });
        expect(notify.success).toHaveBeenCalledWith("46 transactions moved to Axis Bank.");

        await expect(runBulkAccountMove({ moveToAccount: async () => { throw new Error("boom"); } }, ["a"], { id: "axis", name: "Axis Bank" }, notify))
            .resolves.toEqual({ moved: false });
        expect(notify.error).toHaveBeenCalledWith(expect.stringContaining("none were moved"));
    });
});

describe("Transactions page wiring", () => {
    const page = readFileSync(path.resolve(__dirname, "../pages/TransactionsPage.tsx"), "utf-8").replace(/\r\n/g, "\n");

    it("adds a Move to Account bulk action next to the existing ones, disabled with no selection", () => {
        const click = page.indexOf("onClick={() => setIsBulkMoveOpen(true)}");
        const button = page.slice(click - 120, page.indexOf("Move to Account\n", click));
        expect(button).toContain("disabled={selectedIds.size === 0}");
        // Existing bulk actions are still there.
        expect(page).toContain("onClick={() => setIsBulkDeleteOpen(true)}");
        expect(page).toContain("onClick={() => setIsBulkCategoryOpen(true)}");
        expect(page).toContain("<BulkMoveToAccountDialog");
    });
});
