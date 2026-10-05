import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionSchemaMigration } from "@/core/database/migrations/003_transactions";
import { TransactionDetailsMigration } from "@/core/database/migrations/014_transaction_details";
import { TransactionChannelTypeMigration } from "@/core/database/migrations/024_transaction_type";
import { TransactionCounterpartyBranchMigration } from "@/core/database/migrations/025_transaction_counterparty_branch";
import { CounterpartyRulesMigration } from "@/core/database/migrations/026_counterparty_rules";
import { CounterpartyRulesAccountScopeMigration } from "@/core/database/migrations/027_counterparty_rules_account_scope";
import { CounterpartyRulesTypeNotesMigration } from "@/core/database/migrations/028_counterparty_rules_type_notes";
import { CounterpartyRulesCategoryMigration } from "@/core/database/migrations/039_counterparty_rules_category";
import { TransactionTransferDirectionMigration } from "@/core/database/migrations/040_transaction_transfer_direction";
import { AccountType } from "@/modules/accounts/types";
import { ReconciliationService } from "@/modules/reconciliation/services/ReconciliationService";

import { getDefaultValues } from "../components/EditTransactionDialog";
import { TransactionRepository } from "../repositories";
import type { TransactionFormInput } from "../validation";
import { transactionSchema } from "../validation";

import { TransactionService } from "./TransactionService";

// ---------------------------------------------------------------------
// Transactions -> Edit -> Save must change only what the user edited.
// The Edit form carries only the fields it shows; every stored field it
// does not carry (import metadata, reconciliation state) must survive the
// save. Runs the REAL TransactionRepository SQL on an in-memory SQLite
// database (SQLiteProvider mocked, as in bulkAccountMove.test).
// ---------------------------------------------------------------------

const sqlite = { db: null as DatabaseSync | null };

vi.mock("@/core/database/engine/SQLiteProvider", () => ({
    SQLiteProvider: {
        getInstance: () => ({
            async select(sql: string, binds: unknown[] = []) {
                return sqlite.db!.prepare(sql).all(...(binds as never[]));
            },
            async execute(sql: string, binds: unknown[] = []) {
                sqlite.db!.prepare(sql).run(...(binds as never[]));
            },
        }),
    },
}));

const creditCard = {
    id: "sbi-cc-7709", name: "SBI Credit Card 7709", type: AccountType.CREDIT_CARD,
    currencyId: "inr", openingBalance: 0, isActive: true, businessEntityId: null,
};
const savings = {
    id: "hdfc", name: "HDFC Bank", type: AccountType.SAVINGS,
    currencyId: "inr", openingBalance: 0, isActive: true, businessEntityId: null,
};
const accounts = [creditCard, savings];
const categories = [
    { id: "cat-shopping", name: "Shopping", categoryType: "EXPENSE" },
    { id: "cat-software", name: "Software", categoryType: "EXPENSE" },
];

function service(): TransactionService {
    const s = new TransactionService();
    Object.defineProperty(s, "accountRepository", {
        value: {
            getAll: async () => accounts,
            getById: async (id: string) => accounts.find(a => a.id === id) ?? null,
        },
    });
    Object.defineProperty(s, "categoryRepository", {
        value: {
            getAll: async () => categories,
            getById: async (id: string) => categories.find(c => c.id === id) ?? null,
        },
    });
    Object.defineProperty(s, "categoryContextMappingRepository", {
        value: { getByCategoryId: async () => [] },
    });
    return s;
}

const row = (id: string) =>
    sqlite.db!.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as Record<string, unknown>;

// The fields the Edit form does not carry - the ones the bug erased.
const PRESERVED = {
    transaction_type: "CREDIT_CARD",
    is_imported: 1,
    external_transaction_id: "EXT-7709-0912-001",
    counterparty: "Limestone Network Pte Ltd",
    branch: "Singapore",
    reconciled: 1,
    reconciled_at: "2026-09-30T10:00:00.000Z",
    source_statement: "SBI Card Statement",
} as const;

// An imported, reconciled credit-card purchase with every field populated,
// exactly as the import + reconciliation flows leave it in the database.
function insertImported(overrides: Record<string, unknown> = {}): string {
    const values: Record<string, unknown> = {
        id: "imported-1",
        account_id: creditCard.id,
        category_id: "cat-shopping",
        subcategory_id: null,
        payee: "Limestone Network",
        type: "expense",
        transfer_direction: null,
        amount: 1250,
        transaction_date: "2026-09-12",
        reference_number: "REF-0912",
        notes: "Hosting",
        tags: "business",
        status: "CLEARED",
        payment_method: "CARD",
        upi_reference: null,
        bank_transaction_reference: null,
        card_reference: creditCard.id,
        original_narration: "LIMESTONE NETWORK PAYPAL *LIMESTONE",
        created_at: "2026-09-13 09:00:00",
        updated_at: "2026-09-13 09:00:00",
        ...PRESERVED,
        ...overrides,
    };
    const columns = Object.keys(values);
    sqlite.db!.prepare(
        `INSERT INTO transactions (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    ).run(...(Object.values(values) as never[]));
    return String(values.id);
}

// Exactly what EditTransactionDialog does: load the row into the form,
// apply the user's edits, validate with the form schema, then submit.
async function editViaDialog(id: string, edits: Partial<TransactionFormInput>) {
    const s = service();
    const transaction = (await s.getById(id))!;
    const values = transactionSchema.parse({
        ...getDefaultValues(transaction),
        ...edits,
    });
    const { description, ...rest } = values;
    await s.update({
        id,
        ...rest,
        originalNarration: description,
        sourceStatement: transaction.sourceStatement,
    });
}

// Every column except the ones listed (and updated_at, which an edit
// always bumps) must be byte-for-byte what it was.
function expectOnlyChanged(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    changed: string[] = []
) {
    for (const column of Object.keys(before)) {
        if (column === "updated_at" || changed.includes(column)) {
            continue;
        }
        if (column === "subcategory_id" && !before[column]) {
            // Pre-existing and out of scope here: the form's "None"
            // subcategory submits "" and create()/update() store it as-is,
            // so a NULL subcategory_id comes back as "". Every reader
            // treats it truthily (see transferClassification), so both
            // mean "no subcategory" - assert exactly that.
            expect(after[column] || null, column).toBeNull();
            continue;
        }
        expect(after[column], column).toEqual(before[column]);
    }
}

beforeEach(() => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY);`);
    for (const a of accounts) db.exec(`INSERT INTO accounts (id) VALUES ('${a.id}')`);
    for (const migration of [
        TransactionSchemaMigration, TransactionDetailsMigration, TransactionChannelTypeMigration,
        TransactionCounterpartyBranchMigration, TransactionTransferDirectionMigration,
        // Edit self-learning writes here - real schema, so it really runs.
        CounterpartyRulesMigration, CounterpartyRulesAccountScopeMigration,
        CounterpartyRulesTypeNotesMigration, CounterpartyRulesCategoryMigration,
    ]) {
        db.exec(migration.sql);
    }
    sqlite.db = db;
});

describe("Transaction Edit -> Save preserves fields the form does not carry", () => {
    it("Payment Method CARD -> PayPal changes only payment_method; all import metadata and reconciliation survive", async () => {
        const id = insertImported();
        const before = row(id);

        await editViaDialog(id, { paymentMethod: "PAYPAL" });

        const after = row(id);
        expect(after.payment_method).toBe("PAYPAL");

        // Import metadata + reconciliation state, field by field.
        expect(after.transaction_type).toBe("CREDIT_CARD");
        expect(after.is_imported).toBe(1);
        expect(after.external_transaction_id).toBe("EXT-7709-0912-001");
        expect(after.counterparty).toBe("Limestone Network Pte Ltd");
        expect(after.branch).toBe("Singapore");
        expect(after.reconciled).toBe(1);
        expect(after.reconciled_at).toBe("2026-09-30T10:00:00.000Z");
        expect(after.source_statement).toBe("SBI Card Statement");

        // Classification and core values.
        expect(after.type).toBe("expense");
        expect(after.transfer_direction).toBeNull();
        expect(after.amount).toBe(1250);
        expect(after.category_id).toBe("cat-shopping");
        expect(after.account_id).toBe(creditCard.id);
        expect(after.transaction_date).toBe("2026-09-12");
        expect(after.payee).toBe("Limestone Network");
        expect(after.original_narration).toBe("LIMESTONE NETWORK PAYPAL *LIMESTONE");

        // And nothing else moved at all.
        expectOnlyChanged(before, after, ["payment_method"]);
        expect(after.updated_at).not.toBe(before.updated_at);
    });

    it("re-opening and re-saving the edited transaction is a no-op for every stored field", async () => {
        const id = insertImported();
        await editViaDialog(id, { paymentMethod: "PAYPAL" });
        const first = row(id);

        await editViaDialog(id, {});

        expectOnlyChanged(first, row(id));
    });

    it.each([
        ["payee", { payee: "Limestone Networks" }, "payee", "Limestone Networks"],
        ["category", { categoryId: "cat-software" }, "category_id", "cat-software"],
        ["notes", { notes: "VPS renewal" }, "notes", "VPS renewal"],
        ["amount", { amount: 1300 }, "amount", 1300],
        ["date", { transactionDate: "2026-09-13" }, "transaction_date", "2026-09-13"],
        ["tags", { tags: "hosting" }, "tags", "hosting"],
        ["reference number", { referenceNumber: "REF-NEW" }, "reference_number", "REF-NEW"],
        ["status", { status: "PENDING" }, "status", "PENDING"],
        ["description (narration)", { description: "LIMESTONE EDITED" }, "original_narration", "LIMESTONE EDITED"],
    ] as const)(
        "editing %s changes that field and preserves every import/reconciliation field",
        async (_label, edits, column, expected) => {
            const id = insertImported();
            const before = row(id);

            await editViaDialog(id, edits as Partial<TransactionFormInput>);

            const after = row(id);
            expect(after[column]).toBe(expected);
            for (const [field, value] of Object.entries(PRESERVED)) {
                expect(after[field], field).toBe(value);
            }
            expectOnlyChanged(before, after, [column]);
        }
    );

    it("intentional clears from the form still apply (notes/tags/payment method/category to empty)", async () => {
        const id = insertImported();

        await editViaDialog(id, { notes: "", tags: "", paymentMethod: null, categoryId: "" });

        const after = row(id);
        expect(after.notes).toBeNull();
        expect(after.tags).toBeNull();
        expect(after.payment_method).toBeNull();
        expect(after.category_id).toBeNull();
        for (const [field, value] of Object.entries(PRESERVED)) {
            expect(after[field], field).toBe(value);
        }
    });

    it("moving the transaction to another account via Edit still works and keeps its metadata", async () => {
        const id = insertImported();

        await editViaDialog(id, { accountId: savings.id, paymentMethod: "PAYPAL" });

        const after = row(id);
        expect(after.account_id).toBe(savings.id);
        for (const [field, value] of Object.entries(PRESERVED)) {
            expect(after[field], field).toBe(value);
        }
    });

    it("an explicit value for a preserved field in the update request is still applied", async () => {
        const id = insertImported();

        await service().update({
            id,
            counterparty: "Limestone (corrected)",
            branch: "",
            transactionType: "NET_BANKING",
            reconciled: false,
            reconciledAt: null,
            isImported: false,
            externalTransactionId: "EXT-NEW",
        });

        const after = row(id);
        expect(after.counterparty).toBe("Limestone (corrected)");
        expect(after.branch).toBeNull();
        expect(after.transaction_type).toBe("NET_BANKING");
        expect(after.reconciled).toBe(0);
        expect(after.reconciled_at).toBeNull();
        expect(after.is_imported).toBe(0);
        expect(after.external_transaction_id).toBe("EXT-NEW");
        // A request naming only those fields leaves everything else alone.
        expect(after.payee).toBe("Limestone Network");
        expect(after.amount).toBe(1250);
        expect(after.category_id).toBe("cat-shopping");
        expect(after.payment_method).toBe("CARD");
        expect(after.original_narration).toBe("LIMESTONE NETWORK PAYPAL *LIMESTONE");
    });

    it("reconciliation's own un-reconcile/re-reconcile still changes reconciled state after an edit", async () => {
        const id = insertImported();
        await editViaDialog(id, { paymentMethod: "PAYPAL" });

        await new ReconciliationService().markTransactionReconciled(id, false);
        expect(row(id).reconciled).toBe(0);
        expect(row(id).reconciled_at).toBeNull();
        expect(row(id).payment_method).toBe("PAYPAL");
        expect(row(id).external_transaction_id).toBe("EXT-7709-0912-001");

        await new ReconciliationService().markTransactionReconciled(id, true);
        expect(row(id).reconciled).toBe(1);
        expect(row(id).reconciled_at).not.toBeNull();
    });

    it("re-importing the same statement row is still detected as a duplicate of the edited transaction", async () => {
        const id = insertImported();
        await editViaDialog(id, { paymentMethod: "PAYPAL", payee: "Limestone Networks" });

        const duplicate = await new TransactionRepository().findDuplicate(
            creditCard.id,
            "2026-09-12",
            "expense",
            1250,
            "REF-0912",
            "LIMESTONE NETWORK PAYPAL *LIMESTONE",
            "LIMESTONE NETWORK PAYPAL *LIMESTONE"
        );

        expect(duplicate?.id).toBe(id);
        expect(duplicate?.externalTransactionId).toBe("EXT-7709-0912-001");
        expect(duplicate?.isImported).toBeTruthy();
    });

    it("Edit self-learning still runs: a Payee correction still teaches the account-scoped rule", async () => {
        const id = insertImported();

        await editViaDialog(id, { payee: "Limestone Networks", paymentMethod: "PAYPAL" });

        const rules = sqlite.db!.prepare(`SELECT * FROM counterparty_rules`).all() as Record<string, unknown>[];
        expect(rules).toHaveLength(1);
        expect(rules[0].account_id).toBe(creditCard.id);
        expect(rules[0].counterparty).toBe("Limestone Networks");
    });

    it("leaves every other transaction untouched", async () => {
        insertImported();
        const otherId = insertImported({ id: "imported-2", external_transaction_id: "EXT-OTHER", amount: 99 });
        const other = row(otherId);

        await editViaDialog("imported-1", { paymentMethod: "PAYPAL" });

        expect(row(otherId)).toEqual(other);
    });
});

describe("Transaction Edit -> Save on a manual (non-imported) transaction", () => {
    it("creates and edits as before: fields edited change, absent import metadata stays absent", async () => {
        const id = await service().create({
            accountId: savings.id,
            categoryId: "cat-shopping",
            payee: "Corner Store",
            type: "expense",
            amount: 200,
            transactionDate: "2026-09-20",
            status: "CLEARED",
            paymentMethod: "CASH",
        });
        const before = row(id);
        expect(before.is_imported).toBe(0);

        await editViaDialog(id, { payee: "Corner Store Ltd", paymentMethod: "PAYPAL", amount: 210 });

        const after = row(id);
        expect(after.payee).toBe("Corner Store Ltd");
        expect(after.payment_method).toBe("PAYPAL");
        expect(after.amount).toBe(210);
        expect(after.type).toBe("expense");
        expect(after.is_imported).toBe(0);
        expect(after.reconciled).toBe(0);
        expect(after.transaction_type).toBeNull();
        expect(after.external_transaction_id).toBeNull();
        expect(after.counterparty).toBeNull();
        expect(after.branch).toBeNull();
        expectOnlyChanged(before, after, ["payee", "payment_method", "amount"]);
    });

    it("a reconciled manual transaction stays reconciled after an edit", async () => {
        const id = await service().create({
            accountId: savings.id,
            payee: "Rent",
            type: "expense",
            amount: 15000,
            transactionDate: "2026-09-01",
            reconciled: true,
            reconciledAt: "2026-09-30T00:00:00.000Z",
        });

        await editViaDialog(id, { notes: "September" });

        expect(row(id).notes).toBe("September");
        expect(row(id).reconciled).toBe(1);
        expect(row(id).reconciled_at).toBe("2026-09-30T00:00:00.000Z");
    });

    it("type changes through Edit still apply (expense -> income)", async () => {
        const id = insertImported({ category_id: null });

        await editViaDialog(id, { type: "income" });

        expect(row(id).type).toBe("income");
        for (const [field, value] of Object.entries(PRESERVED)) {
            expect(row(id)[field], field).toBe(value);
        }
    });
});
