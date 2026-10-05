import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionSchemaMigration } from "@/core/database/migrations/003_transactions";
import { TransactionDetailsMigration } from "@/core/database/migrations/014_transaction_details";
import { TransactionChannelTypeMigration } from "@/core/database/migrations/024_transaction_type";
import { TransactionCounterpartyBranchMigration } from "@/core/database/migrations/025_transaction_counterparty_branch";
import { TransactionTransferDirectionMigration } from "@/core/database/migrations/040_transaction_transfer_direction";
import { AccountType } from "@/modules/accounts/types";

import { getDefaultValues } from "../components/EditTransactionDialog";
import type { PaymentMethod } from "../types";
import { transactionSchema } from "../validation";

import { TransactionService } from "./TransactionService";

// ---------------------------------------------------------------------
// "PayPal" Payment Method: a plain payment channel, persisted like every
// other PaymentMethod value against the REAL TransactionRepository SQL on
// an in-memory SQLite database (SQLiteProvider mocked, as in
// bulkAccountMove.test). It must never touch Income/Expense/Transfer.
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
    id: "sbi-cc-7709",
    name: "SBI Credit Card 7709",
    type: AccountType.CREDIT_CARD,
    currencyId: "inr",
    openingBalance: 0,
    isActive: true,
    businessEntityId: null,
};

const shopping = {
    id: "cat-shopping",
    name: "Shopping",
    categoryType: "EXPENSE",
};

function service(): TransactionService {
    const s = new TransactionService();
    Object.defineProperty(s, "accountRepository", {
        value: {
            getAll: async () => [creditCard],
            getById: async (id: string) => (id === creditCard.id ? creditCard : null),
        },
    });
    Object.defineProperty(s, "categoryRepository", {
        value: {
            getAll: async () => [shopping],
            getById: async (id: string) => (id === shopping.id ? shopping : null),
        },
    });
    Object.defineProperty(s, "categoryContextMappingRepository", {
        value: { getByCategoryId: async () => [] },
    });
    return s;
}

const row = (id: string) =>
    sqlite.db!.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as Record<string, unknown>;

// The imported credit-card purchase from the report, as import execution
// creates it (no Payment Method - the importer never sets one).
function importLimestone(paymentMethod: PaymentMethod | null = null): Promise<string> {
    return service().create({
        accountId: creditCard.id,
        categoryId: shopping.id,
        payee: "Limestone Network",
        type: "expense",
        amount: 1_250,
        transactionDate: "2026-09-12",
        status: "CLEARED",
        paymentMethod,
        transactionType: "CREDIT_CARD",
        isImported: true,
        sourceStatement: "SBI Card Statement",
        externalTransactionId: "EXT-7709-1",
        originalNarration: "LIMESTONE NETWORK PAYPAL",
    });
}

// Exactly what EditTransactionDialog does: load the row into the form,
// change Payment Method, validate with the form schema, then submit.
async function editPaymentMethod(id: string, paymentMethod: PaymentMethod | null) {
    const s = service();
    const transaction = (await s.getById(id))!;
    const values = transactionSchema.parse({
        ...getDefaultValues(transaction),
        paymentMethod,
    });
    const { description, ...rest } = values;
    await s.update({
        id,
        ...rest,
        originalNarration: description,
        sourceStatement: transaction.sourceStatement,
    });
}

beforeEach(() => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY);`);
    db.exec(`INSERT INTO accounts (id) VALUES ('${creditCard.id}')`);
    for (const migration of [
        TransactionSchemaMigration, TransactionDetailsMigration, TransactionChannelTypeMigration,
        TransactionCounterpartyBranchMigration, TransactionTransferDirectionMigration,
    ]) {
        db.exec(migration.sql);
    }
    db.exec(`CREATE TABLE counterparty_rules (id TEXT PRIMARY KEY, account_id TEXT, pattern TEXT);`);
    sqlite.db = db;
});

describe("Payment Method - PayPal", () => {
    it("is accepted by the transaction form schema", () => {
        const result = transactionSchema.safeParse({
            accountId: creditCard.id,
            payee: "Limestone Network",
            type: "expense",
            amount: 1_250,
            transactionDate: "2026-09-12",
            status: "CLEARED",
            paymentMethod: "PAYPAL",
        });

        expect(result.success).toBe(true);
        expect(result.data?.paymentMethod).toBe("PAYPAL");
    });

    // The allowed set is the Payment Type master list (Settings -> Payment
    // Types), which the form's options come from - not a list in the
    // schema - so any master-list code, including a user-added one, passes.
    it("still accepts every existing Payment Method, and any master-list code; rejects a blank value", () => {
        for (const paymentMethod of [
            "CASH", "CARD", "DEBIT_CARD", "UPI", "BANK_TRANSFER", "DIRECT_DEBIT", "OTHER", "GOOGLE_PAY", null,
        ]) {
            expect(
                transactionSchema.shape.paymentMethod.safeParse(paymentMethod).success
            ).toBe(true);
        }
        expect(transactionSchema.shape.paymentMethod.safeParse("").success).toBe(false);
        expect(transactionSchema.shape.paymentMethod.safeParse("   ").success).toBe(false);
    });

    it("is selectable on an imported credit-card expense and persists through save and re-edit", async () => {
        const id = await importLimestone();
        const before = row(id);
        expect(before.payment_method).toBeNull();

        await editPaymentMethod(id, "PAYPAL");

        const after = row(id);
        expect(after.payment_method).toBe("PAYPAL");

        // Re-opening Edit shows PayPal.
        const reloaded = (await service().getById(id))!;
        expect(reloaded.paymentMethod).toBe("PAYPAL");
        expect(getDefaultValues(reloaded).paymentMethod).toBe("PAYPAL");

        // Saving the edit form again unchanged keeps it.
        await editPaymentMethod(id, "PAYPAL");
        expect(row(id).payment_method).toBe("PAYPAL");
    });

    it("never changes Income/Expense/Transfer classification, direction, category, account or amount", async () => {
        const id = await importLimestone();
        const before = row(id);

        await editPaymentMethod(id, "PAYPAL");

        const after = row(id);
        for (const column of [
            "type", "transfer_direction", "category_id", "account_id", "amount",
            "transaction_date", "payee", "original_narration", "source_statement",
        ]) {
            expect(after[column], column).toEqual(before[column]);
        }
        expect(after.type).toBe("expense");
        expect(after.transfer_direction).toBeNull();
    });

    it("persists on create exactly like any other Payment Method", async () => {
        const id = await importLimestone("PAYPAL");

        expect(row(id).payment_method).toBe("PAYPAL");
        expect(row(id).type).toBe("expense");
        expect((await service().getById(id))!.paymentMethod).toBe("PAYPAL");
    });

    it("existing Payment Methods still round-trip, and switching away from PayPal works", async () => {
        const id = await importLimestone();

        for (const paymentMethod of [
            "CASH", "CARD", "DEBIT_CARD", "UPI", "BANK_TRANSFER", "DIRECT_DEBIT", "PAYPAL", "OTHER",
        ] as const) {
            await editPaymentMethod(id, paymentMethod);
            expect(row(id).payment_method).toBe(paymentMethod);
            expect(row(id).type).toBe("expense");
        }

        await editPaymentMethod(id, null);
        expect(row(id).payment_method).toBeNull();
    });

    it("does not modify any other transaction", async () => {
        const other = await importLimestone("UPI");
        const untouched = row(other);
        const id = await importLimestone();

        await editPaymentMethod(id, "PAYPAL");

        expect(row(other)).toEqual(untouched);
    });
});
