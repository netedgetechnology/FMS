import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { isTransferClassified, transferCategoryIdSet } from "@/core/accounting/transferClassification";
import { TransactionSchemaMigration } from "@/core/database/migrations/003_transactions";
import { TransactionDetailsMigration } from "@/core/database/migrations/014_transaction_details";
import { TransactionChannelTypeMigration } from "@/core/database/migrations/024_transaction_type";
import { TransactionCounterpartyBranchMigration } from "@/core/database/migrations/025_transaction_counterparty_branch";
import { TransactionTransferDirectionMigration } from "@/core/database/migrations/040_transaction_transfer_direction";
import { computeAccountCurrentBalances } from "@/modules/accounts/utils";
import type { Category, CategoryContextMapping } from "@/modules/categories/types";

import type { Transaction } from "../types";

import {
    categoriesForBulkChange,
    incompatibleTransactionIds,
    runBulkCategoryChange,
} from "./bulkCategoryChange";
import { TransactionService } from "./TransactionService";

// ---------------------------------------------------------------------
// Transactions - bulk Change Category.
//
// TransactionRepository's real SQL runs against an in-memory database
// built from the app's own transactions migrations (003/014/024/025);
// SQLiteProvider is mocked to it and every statement is logged. Account /
// category / mapping lookups are stubbed on the service. Page and dialog
// wiring is checked against their source (no DOM test setup exists).
// ---------------------------------------------------------------------

const sqlite = { db: null as DatabaseSync | null };
const sqlLog: string[] = [];

vi.mock("@/core/database/engine/SQLiteProvider", () => ({
    SQLiteProvider: {
        getInstance: () => ({
            async select(sql: string, binds: unknown[] = []) {
                sqlLog.push(sql.replace(/\s+/g, " ").trim());
                return sqlite.db!.prepare(sql).all(...(binds as never[]));
            },
            async execute(sql: string, binds: unknown[] = []) {
                sqlLog.push(sql.replace(/\s+/g, " ").trim());
                sqlite.db!.prepare(sql).run(...(binds as never[]));
            },
        }),
    },
}));

type Row = Record<string, unknown>;

function category(
    id: string,
    name: string,
    categoryType: Category["categoryType"],
    isActive = true
): Category {
    return {
        id, parentId: null, name, categoryType, financeScope: "PERSONAL",
        businessEntityId: null, description: null, isActive, createdAt: "", updatedAt: "",
    };
}

const categories: Category[] = [
    category("cat-fuel", "Fuel", "EXPENSE"),
    category("cat-groceries", "Groceries", "EXPENSE"),
    category("cat-salary", "Salary", "INCOME"),
    category("cat-self", "Self Transfer", "TRANSFER"),
    category("cat-consulting", "Consulting", "EXPENSE"),
    category("cat-old", "Old", "EXPENSE", false),
];

// "Consulting" is locked to INCOME for the business entity be-1.
const mappings: CategoryContextMapping[] = [
    {
        id: "map-1", categoryId: "cat-consulting", accountId: null, businessEntityId: "be-1",
        categoryType: "INCOME", isActive: true, createdAt: "", updatedAt: "",
    },
];

const accounts = [
    { id: "acct-personal", businessEntityId: null, openingBalance: 10000 },
    { id: "acct-biz", businessEntityId: "be-1", openingBalance: 5000 },
];

function seed(db: DatabaseSync) {
    // transactions.account_id references accounts (an earlier migration).
    db.exec(`
        CREATE TABLE accounts (id TEXT PRIMARY KEY);
        INSERT INTO accounts (id) VALUES ('acct-personal'), ('acct-biz');
    `);

    for (const migration of [
        TransactionSchemaMigration,
        TransactionDetailsMigration,
        TransactionChannelTypeMigration,
        TransactionCounterpartyBranchMigration,
        TransactionTransferDirectionMigration,
    ]) {
        db.exec(migration.sql);
    }

    const insert = db.prepare(`
        INSERT INTO transactions
        (id, account_id, category_id, subcategory_id, payee, counterparty, branch, type, amount,
         transaction_date, reference_number, notes, tags, status, payment_method, upi_reference,
         bank_transaction_reference, card_reference, transaction_type, reconciled, reconciled_at,
         is_imported, source_statement, external_transaction_id, original_narration, created_at, updated_at)
        VALUES (?, ?, ?, 'sub-x', ?, 'Counterparty', 'Branch', ?, ?, '2026-09-10', ?, 'a note', 'tag',
                'CLEARED', 'UPI', 'upi-ref', 'bank-ref', NULL, 'UPI', ?, ?, 1, 'HDFC Statement',
                ?, ?, 'created', 'orig')
    `);

    const rows: [string, string, string | null, string, string, number, number][] = [
        ["t1", "acct-personal", "cat-groceries", "Indian Oil", "expense", 1200, 1],
        ["t2", "acct-personal", null, "HP Petrol", "expense", 800, 0],
        ["t3", "acct-personal", "cat-salary", "Employer", "income", 50000, 0],
        ["t4", "acct-biz", "cat-groceries", "To Savings", "expense", 2000, 0],
        ["t5", "acct-biz", null, "Client", "income", 7000, 0],
    ];

    for (const [id, accountId, categoryId, payee, type, amount, reconciled] of rows) {
        insert.run(
            id, accountId, categoryId, payee, type, amount, `REF-${id}`, reconciled,
            reconciled ? "2026-09-12" : null, `EXT-${id}`, `NARRATION ${id}`
        );
    }

    db.exec(`
        INSERT INTO transactions (id, account_id, category_id, payee, type, amount, transaction_date, deleted_at)
        VALUES ('t-deleted', 'acct-personal', 'cat-groceries', 'Gone', 'expense', 10, '2026-09-01', '2026-09-02');
    `);
}

function service(): TransactionService {
    const s = new TransactionService();

    Object.defineProperty(s, "accountRepository", {
        value: { getAll: async () => accounts, getById: async (id: string) => accounts.find(a => a.id === id) ?? null },
    });
    Object.defineProperty(s, "categoryRepository", {
        value: {
            getById: async (id: string) => categories.find(c => c.id === id) ?? null,
            getAll: async () => categories,
        },
    });
    Object.defineProperty(s, "categoryContextMappingRepository", {
        value: { getByCategoryId: async (id: string) => mappings.filter(m => m.categoryId === id) },
    });

    return s;
}

function rows(): Map<string, Row> {
    return new Map(
        (sqlite.db!.prepare("SELECT * FROM transactions").all() as Row[]).map(r => [r.id as string, r])
    );
}

function withoutCategory(row: Row | undefined): Row {
    const { category_id: _c, updated_at: _u, ...rest } = row ?? {};
    return rest;
}

function notifier() {
    return { success: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
    const db = new DatabaseSync(":memory:");
    seed(db);
    sqlite.db = db;
    sqlLog.length = 0;
    vi.restoreAllMocks();
});

describe("TransactionService.changeCategory", () => {
    it("changes one selected transaction", async () => {
        const before = rows();

        expect(await service().changeCategory(["t2"], "cat-fuel")).toEqual({ updated: 1 });

        const after = rows();
        expect(after.get("t2")?.category_id).toBe("cat-fuel");
        expect(after.get("t2")?.updated_at).not.toBe("orig");
        expect(withoutCategory(after.get("t2"))).toEqual(withoutCategory(before.get("t2")));
    });

    it("changes several selected transactions, and only those", async () => {
        const before = rows();

        await service().changeCategory(["t1", "t2", "t4"], "cat-fuel");

        const after = rows();
        for (const id of ["t1", "t2", "t4"]) {
            expect(after.get(id)?.category_id).toBe("cat-fuel");
            // amount, date, payee, narration, reference, account, type,
            // sub-category, reconciliation, status... all unchanged.
            expect(withoutCategory(after.get(id))).toEqual(withoutCategory(before.get(id)));
        }
        for (const id of ["t3", "t5", "t-deleted"]) {
            expect(after.get(id)).toEqual(before.get(id));
        }
    });

    it("keeps a reconciled transaction reconciled", async () => {
        await service().changeCategory(["t1"], "cat-fuel");

        expect(rows().get("t1")).toMatchObject({ reconciled: 1, reconciled_at: "2026-09-12" });
    });

    it("uses one lookup and ONE atomic UPDATE, never per-row writes - even for thousands", async () => {
        const insert = sqlite.db!.prepare(
            "INSERT INTO transactions (id, account_id, payee, type, amount, transaction_date) VALUES (?, 'acct-personal', ?, 'expense', 10, '2026-09-10')"
        );
        const ids: string[] = [];
        for (let i = 0; i < 3000; i++) {
            ids.push(`bulk-${i}`);
            insert.run(`bulk-${i}`, `Payee ${i}`);
        }
        sqlLog.length = 0;

        const started = performance.now();
        const result = await service().changeCategory(ids, "cat-fuel");
        const elapsed = performance.now() - started;

        expect(result).toEqual({ updated: 3000 });
        expect(sqlLog.filter(sql => sql.startsWith("UPDATE"))).toHaveLength(1);
        expect(sqlLog.filter(sql => sql.startsWith("SELECT"))).toHaveLength(1);
        expect(sqlLog.join(" ")).not.toMatch(/counterparty_rules/);
        expect(
            sqlite.db!.prepare("SELECT COUNT(*) AS n FROM transactions WHERE category_id = 'cat-fuel'").get()
        ).toEqual({ n: 3000 });
        expect(elapsed).toBeLessThan(2000);
    });

    it("a Transfer category makes the rows transfers, keeping each one's direction - balances unchanged", async () => {
        const before = rows();
        const balances = (all: Map<string, Row>) =>
            computeAccountCurrentBalances(
                accounts,
                [...all.values()]
                    .filter(r => !r.deleted_at)
                    .map(r => ({
                        accountId: r.account_id as string,
                        type: r.type as string,
                        amount: r.amount as number,
                        transferDirection: r.transfer_direction as string | null,
                    }))
            );

        await service().changeCategory(["t4", "t5"], "cat-self");

        const after = rows();
        // t4 was an expense (Debit) -> Transfer OUT; t5 an income (Credit) -> Transfer IN.
        expect(after.get("t4")).toMatchObject({ category_id: "cat-self", type: "transfer", transfer_direction: "OUT", amount: 2000 });
        expect(after.get("t5")).toMatchObject({ category_id: "cat-self", type: "transfer", transfer_direction: "IN", amount: 7000 });
        // Everything else about them unchanged.
        for (const id of ["t4", "t5"]) {
            const { type: _t, transfer_direction: _d, ...restAfter } = withoutCategory(after.get(id));
            const { type: _t2, transfer_direction: _d2, ...restBefore } = withoutCategory(before.get(id));
            expect(restAfter).toEqual(restBefore);
        }
        // Unselected rows untouched.
        for (const id of ["t1", "t2", "t3", "t-deleted"]) {
            expect(after.get(id)).toEqual(before.get(id));
        }
        // Account balances are exactly what they were.
        expect(balances(after)).toEqual(balances(before));

        // ...and they now count as neither Income nor Expense.
        expect(
            isTransferClassified(
                { type: "transfer", categoryId: "cat-self" },
                transferCategoryIdSet(categories)
            )
        ).toBe(true);
    });

    it("a normal category replacing a Transfer category restores Income/Expense from the direction", async () => {
        await service().changeCategory(["t4", "t5"], "cat-self");
        await service().changeCategory(["t4", "t5", "t1"], "cat-fuel");

        // Transfer OUT -> Expense, Transfer IN -> Income: balances unchanged.
        expect(rows().get("t4")).toMatchObject({ category_id: "cat-fuel", type: "expense", transfer_direction: null, amount: 2000 });
        expect(rows().get("t5")).toMatchObject({ category_id: "cat-fuel", type: "income", transfer_direction: null, amount: 7000 });
        expect(rows().get("t1")).toMatchObject({ category_id: "cat-fuel", type: "expense", transfer_direction: null });
    });

    it("a normal category never changes a standalone transfer (typed by hand, not via a Transfer category)", async () => {
        sqlite.db!.exec("UPDATE transactions SET type = 'transfer', transfer_direction = 'OUT' WHERE id = 't4'");

        await service().changeCategory(["t4"], "cat-fuel");

        expect(rows().get("t4")).toMatchObject({ category_id: "cat-fuel", type: "transfer", transfer_direction: "OUT" });
    });

    it("category and type change together or not at all", async () => {
        sqlite.db!.exec(`
            CREATE TRIGGER fail_on_t5 BEFORE UPDATE ON transactions
            WHEN OLD.id = 't5' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
        `);
        const before = rows();

        await expect(service().changeCategory(["t4", "t5"], "cat-self")).rejects.toThrow("simulated failure");

        expect(rows()).toEqual(before);
    });

    it("rolls back completely when the update fails part-way", async () => {
        sqlite.db!.exec(`
            CREATE TRIGGER fail_on_t4 BEFORE UPDATE OF category_id ON transactions
            WHEN OLD.id = 't4' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;
        `);
        const before = rows();

        await expect(
            service().changeCategory(["t1", "t2", "t4"], "cat-fuel")
        ).rejects.toThrow("simulated failure");

        expect(rows()).toEqual(before);
    });

    it("refuses the whole batch if any transaction is locked to the other type - nothing is written", async () => {
        const before = rows();

        // Consulting is INCOME for be-1; t4 is an EXPENSE on the be-1 account.
        await expect(
            service().changeCategory(["t1", "t4"], "cat-consulting")
        ).rejects.toThrow('1 of the selected transactions can\'t use "Consulting"');

        expect(rows()).toEqual(before);
        expect(sqlLog.filter(sql => sql.startsWith("UPDATE"))).toHaveLength(0);
    });

    it("refuses an inactive or missing category", async () => {
        await expect(service().changeCategory(["t1"], "cat-old")).rejects.toThrow("inactive");
        await expect(service().changeCategory(["t1"], "cat-nope")).rejects.toThrow("Category not found.");
    });

    it("skips deleted transactions and counts only the ones changed", async () => {
        const result = await service().changeCategory(["t1", "t-deleted", "t1"], "cat-fuel");

        expect(result).toEqual({ updated: 1 });
        expect(rows().get("t-deleted")?.category_id).toBe("cat-groceries");
    });
});

describe("runBulkCategoryChange (the dialog's Apply)", () => {
    it("one success toast naming the category and count", async () => {
        const notify = notifier();

        const outcome = await runBulkCategoryChange(
            service(),
            ["t1", "t2"],
            { id: "cat-fuel", name: "Fuel" },
            notify
        );

        expect(outcome).toEqual({ changed: true });
        expect(notify.success).toHaveBeenCalledOnce();
        expect(notify.success).toHaveBeenCalledWith("Category changed to Fuel for 2 transactions.");
        expect(notify.error).not.toHaveBeenCalled();

        const one = notifier();
        await runBulkCategoryChange(service(), ["t3"], { id: "cat-salary", name: "Salary" }, one);
        expect(one.success).toHaveBeenCalledWith("Category changed to Salary for 1 transaction.");
    });

    it("on failure: one error toast, nothing changed, reported as not changed", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const before = rows();
        const notify = notifier();

        const outcome = await runBulkCategoryChange(
            service(),
            ["t1", "t4"],
            { id: "cat-consulting", name: "Consulting" },
            notify
        );

        expect(outcome).toEqual({ changed: false });
        expect(notify.success).not.toHaveBeenCalled();
        expect(notify.error.mock.calls[0][0]).toMatch(/^Failed to change category - no transactions were changed\./);
        expect(rows()).toEqual(before);
    });
});

describe("category options", () => {
    const businessEntities = new Map(accounts.map(a => [a.id, a.businessEntityId]));
    const tx = (id: string, accountId: string, type: Transaction["type"]) => ({ id, accountId, type });

    it("offers every active category valid for all selected rows, Transfer categories included", () => {
        const names = categoriesForBulkChange(
            categories,
            [tx("a", "acct-personal", "expense"), tx("b", "acct-biz", "income")],
            mappings,
            businessEntities
        ).map(c => c.name);

        expect(names).toEqual(["Fuel", "Groceries", "Salary", "Self Transfer", "Consulting"]);
    });

    it("hides a category locked to the other type for any selected row", () => {
        const names = categoriesForBulkChange(
            categories,
            [tx("a", "acct-personal", "expense"), tx("b", "acct-biz", "expense")],
            mappings,
            businessEntities
        ).map(c => c.name);

        expect(names).not.toContain("Consulting");
        expect(
            incompatibleTransactionIds(categories[4], [tx("b", "acct-biz", "expense")], mappings, businessEntities)
        ).toEqual(["b"]);
    });
});

describe("page and dialog wiring", () => {
    const page = readFileSync(path.resolve(__dirname, "../pages/TransactionsPage.tsx"), "utf8");
    const dialog = readFileSync(path.resolve(__dirname, "../components/BulkChangeCategoryDialog.tsx"), "utf8");

    it("Change Category sits beside bulk Delete, with the same enabled rule and selection", () => {
        const deleteAt = page.indexOf('aria-label="Delete selected transactions"');
        const changeAt = page.indexOf('aria-label="Change category of selected transactions"');

        expect(deleteAt).toBeGreaterThan(-1);
        expect(changeAt).toBeGreaterThan(deleteAt);
        expect(page).toMatch(/disabled=\{selectedIds\.size === 0\}\s+onClick=\{\(\) => setIsBulkCategoryOpen\(true\)\}/);
        // The selected rows come from the existing selection - unchanged
        // filter / search / select-all behaviour.
        expect(page).toMatch(/transactions\.filter\(transaction =>\s+selectedIds\.has\(transaction\.id\)\s+\)/);
    });

    it("clears the selection and refreshes after success; bulk Delete is unchanged", () => {
        expect(page).toMatch(
            /<BulkChangeCategoryDialog\s+transactions=\{selectedTransactions\}[\s\S]*?onSuccess=\{async \(\) => \{\s+setSelectedIds\(new Set\(\)\);\s+await refresh\(\);/
        );
        expect(page).toMatch(
            /<BulkDeleteTransactionsDialog\s+transactionIds=\{Array\.from\(selectedIds\)\}\s+open=\{isBulkDeleteOpen\}\s+onOpenChange=\{setIsBulkDeleteOpen\}/
        );
    });

    it("keeps the selection on failure: onSuccess (which clears it) runs only after a successful change", () => {
        expect(dialog).toMatch(/if \(outcome\.changed\) \{\s+await onSuccess\?\.\(\);\s+onOpenChange\(false\);/);
    });

    it("blocks duplicate submissions and closing while applying", () => {
        expect(dialog).toMatch(
            /if \(count === 0 \|\| !selectedCategory \|\| inFlight\.current\) \{\s+return;\s+\}\s+inFlight\.current = true;/
        );
        expect(dialog).toMatch(/disabled=\{loading \|\| !selectedCategory\}\s+onClick=\{handleApply\}/);
        expect(dialog).toMatch(/if \(!loading\) \{\s+onOpenChange\(open\);/);
        expect(dialog).toMatch(/showCloseButton=\{!loading\}/);
    });

    it("never touches learned import rules", () => {
        const helper = readFileSync(path.resolve(__dirname, "bulkCategoryChange.ts"), "utf8");
        for (const source of [dialog, helper]) {
            expect(source).not.toMatch(/CounterpartyRule|learnRule|counterparty_rules/);
        }
    });
});
