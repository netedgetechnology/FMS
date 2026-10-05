import { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import { TransactionSchemaMigration } from "@/core/database/migrations/003_transactions";
import { TransactionDetailsMigration } from "@/core/database/migrations/014_transaction_details";
import { TransactionChannelTypeMigration } from "@/core/database/migrations/024_transaction_type";
import { TransactionCounterpartyBranchMigration } from "@/core/database/migrations/025_transaction_counterparty_branch";
import { CounterpartyRulesMigration } from "@/core/database/migrations/026_counterparty_rules";
import { CounterpartyRulesAccountScopeMigration } from "@/core/database/migrations/027_counterparty_rules_account_scope";
import { CounterpartyRulesTypeNotesMigration } from "@/core/database/migrations/028_counterparty_rules_type_notes";
import { CounterpartyRulesCategoryMigration } from "@/core/database/migrations/039_counterparty_rules_category";
import { TransactionTransferDirectionMigration } from "@/core/database/migrations/040_transaction_transfer_direction";
import { PaymentTypesMigration } from "@/core/database/migrations/044_payment_types";
import { AccountType } from "@/modules/accounts/types";
import {
    customRuleTypeOptions,
    describeCustomRule,
} from "@/modules/imports/components/CustomRuleManager";
import {
    applyPreviewOverrides,
    createEmptyPreviewOverrides,
} from "@/modules/imports/pages/ImportsPage";
import { ImportPreviewRow } from "@/modules/imports/pages/ImportPreviewRow";
import type { CustomImportRule } from "@/modules/imports/types";
import { getDefaultValues } from "@/modules/transactions/components/EditTransactionDialog";
import { isCreditCardPaymentType } from "@/modules/transactions/components/TransactionForm";
import { TransactionService } from "@/modules/transactions/services/TransactionService";
import { transactionSchema } from "@/modules/transactions/validation";

import { PaymentTypeService } from "./services";
import type { PaymentType, PaymentTypeOption } from "./types";
import { activePaymentTypeOptions, paymentTypeLabel, paymentTypeOptionsFor } from "./utils";

// ---------------------------------------------------------------------
// The Payment Type master list as the single source of truth for every
// selector. The list is loaded from a real in-memory database seeded by
// migration 044 through PaymentTypeService - the same path the
// usePaymentTypes hook takes - and handed to the real selector code.
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

const REQUIRED = [
    "UPI", "IMPS", "NEFT", "RTGS", "Cash", "Cheque", "E-Mandate",
    "Net Banking", "Mobile App", "Credit Card", "PayPal", "Other",
];

beforeEach(() => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY); INSERT INTO accounts (id) VALUES ('sbi-cc')`);
    for (const migration of [
        TransactionSchemaMigration, TransactionDetailsMigration, TransactionChannelTypeMigration,
        TransactionCounterpartyBranchMigration, TransactionTransferDirectionMigration,
        CounterpartyRulesMigration, CounterpartyRulesAccountScopeMigration,
        CounterpartyRulesTypeNotesMigration, CounterpartyRulesCategoryMigration,
    ]) {
        db.exec(migration.sql);
    }
    for (const statement of PaymentTypesMigration.sql.split(";").map(s => s.trim()).filter(Boolean)) {
        db.exec(statement);
    }
    sqlite.db = db;
});

// What usePaymentTypes() provides: the full list and its active options.
async function loadMasterList(): Promise<{ list: PaymentType[]; active: PaymentTypeOption[] }> {
    const list = await new PaymentTypeService().getAll();
    return { list, active: activePaymentTypeOptions(list) };
}

function candidate(overrides: Partial<NormalizedTransactionCandidate> = {}): NormalizedTransactionCandidate {
    return {
        rowNumber: 2, transactionDate: "2026-09-12", payee: "Limestone Network",
        description: "LIMESTONE NETWORK PAYPAL", amount: 1250, type: "expense",
        referenceNumber: null, externalTransactionId: null, transactionType: null,
        balance: null, branch: null, counterparty: null, notes: null,
        categoryId: null, rawData: {},
        ...overrides,
    };
}

// The Import Preview row's Type <select>: its options and selected value.
async function renderPreviewTypeSelect(row: NormalizedTransactionCandidate) {
    const { list, active } = await loadMasterList();
    const noop = () => {};
    const html = renderToStaticMarkup(
        createElement("table", null, createElement("tbody", null,
            createElement(ImportPreviewRow, {
                candidate: row, displayNumber: 1, hasErrors: false, isDuplicate: false, isTransfer: false,
                indicatorState: "blank", indicatorClickable: false, hasMatchedLearnedRule: false,
                importing: false, directionCategoryOptions: [], categories: [], categoriesLoading: false,
                paymentTypeOptions: active, paymentTypes: list,
                onToggleSelfLearning: noop, onPayeeCommit: noop, onTransactionTypeChange: noop,
                onCategoryChange: noop, onNotesCommit: noop, onViewDescription: noop,
            })
        ))
    );
    const select = [...html.matchAll(/<select[\s\S]*?<\/select>/g)]
        .map(match => match[0])
        .find(markup => /<option value=""( selected="")?>—<\/option>/.test(markup));
    expect(select, "Type select rendered").toBeDefined();
    const options = [...select!.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)]
        .map(match => ({ value: match[1]!, label: match[3]!, selected: !!match[2] }));
    return {
        values: options.filter(o => o.value !== "").map(o => o.value),
        labels: options.filter(o => o.value !== "").map(o => o.label),
        selected: options.find(o => o.selected)?.value ?? "",
    };
}

const unique = (values: string[]) => new Set(values).size === values.length;

describe("Import Preview Type select - from the master list", () => {
    it("offers PayPal, Other and every existing type, with no duplicates", async () => {
        const { labels, values } = await renderPreviewTypeSelect(candidate());

        for (const label of REQUIRED) {
            expect(labels, label).toContain(label);
        }
        expect(labels).toContain("Debit Card");
        expect(labels).toContain("Bank Transfer");
        expect(labels).toContain("Direct Debit");
        expect(unique(values)).toBe(true);
        expect(unique(labels)).toBe(true);
        // The inactive legacy CARD entry is not offered for a new selection.
        expect(values).not.toContain("CARD");
    });

    it("keeps showing an engine-detected value selected", async () => {
        const { selected } = await renderPreviewTypeSelect(candidate({ transactionType: "NET_BANKING" }));

        expect(selected).toBe("NET_BANKING");
    });

    it("follows renames from Settings -> Payment Types", async () => {
        const paypal = (await new PaymentTypeService().getAll()).find(t => t.code === "PAYPAL")!;
        await new PaymentTypeService().update({ id: paypal.id, label: "PayPal (Business)" });

        const { labels } = await renderPreviewTypeSelect(candidate());

        expect(labels).toContain("PayPal (Business)");
        expect(labels).not.toContain("PayPal");
    });
});

describe("Google Pay added through Payment Type Management - no code change", () => {
    it("appears in Import Preview, Custom Import Rules and Add/Edit Transaction, then deactivates cleanly", async () => {
        // Not there yet.
        expect((await renderPreviewTypeSelect(candidate())).labels).not.toContain("Google Pay");

        // Add it the way Settings -> Payment Types does.
        const id = await new PaymentTypeService().create({ label: "Google Pay" });
        const { list, active } = await loadMasterList();

        // Import Preview.
        const preview = await renderPreviewTypeSelect(candidate());
        expect(preview.labels).toContain("Google Pay");
        expect(preview.values).toContain("GOOGLE_PAY");
        expect(unique(preview.values)).toBe(true);

        // Custom Import Rules form, and how a rule using it is shown.
        expect(customRuleTypeOptions(list, null).map(o => o.label)).toContain("Google Pay");
        const rule = { transactionType: "GOOGLE_PAY", accountId: "sbi-cc", keyword: "GPAY", payee: null, notes: null, categoryId: null } as CustomImportRule;
        expect(describeCustomRule(rule, [], [], list).type).toBe("Google Pay");

        // Add/Edit Transaction (a new transaction has no current value).
        expect(paymentTypeOptionsFor(active, list, null).map(o => o.label)).toContain("Google Pay");

        // Remove it via the supported workflow: deactivate.
        await new PaymentTypeService().update({ id, isActive: false });
        const after = await loadMasterList();

        expect((await renderPreviewTypeSelect(candidate())).labels).not.toContain("Google Pay");
        expect(customRuleTypeOptions(after.list, null).map(o => o.value)).not.toContain("GOOGLE_PAY");
        expect(paymentTypeOptionsFor(after.active, after.list, null).map(o => o.value)).not.toContain("GOOGLE_PAY");
        // Still in the list (never deleted), just inactive.
        expect(after.list.find(t => t.code === "GOOGLE_PAY")).toMatchObject({ isActive: false });
    });
});

describe("Deactivated types: unavailable for new selections, kept where already used", () => {
    async function addAndDeactivateGooglePay() {
        const id = await new PaymentTypeService().create({ label: "Google Pay" });
        await new PaymentTypeService().update({ id, isActive: false });
    }

    it("an Import Preview row that already has the inactive type keeps it selected and labelled", async () => {
        await addAndDeactivateGooglePay();

        const fresh = await renderPreviewTypeSelect(candidate());
        expect(fresh.values).not.toContain("GOOGLE_PAY");

        const existing = await renderPreviewTypeSelect(candidate({ transactionType: "GOOGLE_PAY" as never }));
        expect(existing.selected).toBe("GOOGLE_PAY");
        expect(existing.labels).toContain("Google Pay (inactive)");
        expect(existing.values.filter(v => v === "GOOGLE_PAY")).toHaveLength(1);
    });

    it("editing a Custom Import Rule whose Type is inactive keeps that Type available", async () => {
        await addAndDeactivateGooglePay();
        const { list } = await loadMasterList();

        const options = customRuleTypeOptions(list, { transactionType: "GOOGLE_PAY" });
        expect(options.find(o => o.value === "GOOGLE_PAY")).toMatchObject({ label: "Google Pay (inactive)", inactive: true });
    });

    it("editing a transaction whose Payment Method is the inactive legacy CARD keeps it selectable", async () => {
        const { list, active } = await loadMasterList();

        const options = paymentTypeOptionsFor(active, list, "CARD");
        expect(options.find(o => o.value === "CARD")).toMatchObject({ label: "Credit Card (legacy) (inactive)" });
        expect(options.filter(o => o.label.startsWith("Credit Card"))).toHaveLength(2);
        // ...while a new transaction is only offered the active Credit Card.
        expect(paymentTypeOptionsFor(active, list, null).filter(o => o.label.startsWith("Credit Card")).map(o => o.value))
            .toEqual(["CREDIT_CARD"]);
    });

    it("the Card Reference picker still applies to the legacy CARD code and to CREDIT_CARD", () => {
        expect(isCreditCardPaymentType("CARD")).toBe(true);
        expect(isCreditCardPaymentType("CREDIT_CARD")).toBe(true);
        expect(isCreditCardPaymentType("PAYPAL")).toBe(false);
        expect(isCreditCardPaymentType(null)).toBe(false);
    });
});

describe("Add/Edit Transaction - PayPal and Other", () => {
    it("are offered and selectable", async () => {
        const { list, active } = await loadMasterList();
        const options = paymentTypeOptionsFor(active, list, null);

        expect(options.map(o => o.label)).toEqual(expect.arrayContaining(["PayPal", "Other"]));
        for (const code of ["PAYPAL", "OTHER"]) {
            expect(transactionSchema.shape.paymentMethod.safeParse(code).success).toBe(true);
        }
    });
});

describe("Existing transactions keep their values", () => {
    const creditCard = { id: "sbi-cc", type: AccountType.CREDIT_CARD, businessEntityId: null };

    function txService(): TransactionService {
        const s = new TransactionService();
        Object.defineProperty(s, "accountRepository", { value: { getById: async () => creditCard, getAll: async () => [creditCard] } });
        Object.defineProperty(s, "categoryRepository", { value: { getById: async () => null, getAll: async () => [] } });
        Object.defineProperty(s, "categoryContextMappingRepository", { value: { getByCategoryId: async () => [] } });
        return s;
    }

    const row = (id: string) =>
        sqlite.db!.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as Record<string, unknown>;

    async function editNotes(id: string, notes: string) {
        const s = txService();
        const values = transactionSchema.parse({ ...getDefaultValues((await s.getById(id))!), notes });
        const { description, ...rest } = values;
        await s.update({ id, ...rest, originalNarration: description });
    }

    it("a transaction using a since-deactivated type keeps both Payment Type fields through Edit -> Save", async () => {
        const typeId = await new PaymentTypeService().create({ label: "Google Pay" });
        const id = await txService().create({
            accountId: "sbi-cc", payee: "Cafe", type: "expense", amount: 120,
            transactionDate: "2026-09-20", paymentMethod: "GOOGLE_PAY", transactionType: "GOOGLE_PAY",
            isImported: true, originalNarration: "GPAY CAFE",
        });
        await new PaymentTypeService().update({ id: typeId, isActive: false });
        const before = row(id);

        await editNotes(id, "coffee");

        const after = row(id);
        expect(after.notes).toBe("coffee");
        expect(after.payment_method).toBe("GOOGLE_PAY");
        expect(after.transaction_type).toBe("GOOGLE_PAY");
        expect(after.type).toBe(before.type);
        expect(after.amount).toBe(before.amount);
    });

    it("a historical CARD transaction keeps CARD through Edit -> Save", async () => {
        const id = await txService().create({
            accountId: "sbi-cc", payee: "Shop", type: "expense", amount: 99,
            transactionDate: "2026-08-01", paymentMethod: "CARD", transactionType: "NET_BANKING",
        });

        await editNotes(id, "edited");

        expect(row(id).payment_method).toBe("CARD");
        expect(row(id).transaction_type).toBe("NET_BANKING");
    });

    it("Payment Type master-list changes never touch transactions", async () => {
        const id = await txService().create({
            accountId: "sbi-cc", payee: "Shop", type: "expense", amount: 50,
            transactionDate: "2026-08-02", paymentMethod: "PAYPAL", transactionType: "UPI",
        });
        const before = row(id);
        const list = await new PaymentTypeService().getAll();

        const gpay = await new PaymentTypeService().create({ label: "Google Pay" });
        await new PaymentTypeService().update({ id: gpay, isActive: false });
        await new PaymentTypeService().update({ id: list.find(t => t.code === "PAYPAL")!.id, label: "PayPal (renamed)", isActive: false });
        await new PaymentTypeService().update({ id: list.find(t => t.code === "UPI")!.id, isActive: false });

        expect(row(id)).toEqual(before);
    });
});

describe("Import Preview override -> import: metadata only", () => {
    it("choosing PayPal sets only the row's Payment Type; direction, amount, category and payee are unchanged", () => {
        const row = candidate({ transactionType: "CREDIT_CARD", categoryId: "cat-shopping" });
        const overrides = createEmptyPreviewOverrides();
        overrides.transactionType.set(row.rowNumber, "PAYPAL");

        const [applied] = applyPreviewOverrides([row], overrides);

        expect(applied).toEqual({ ...row, transactionType: "PAYPAL" });
    });

    it("clearing the Type override still clears it", () => {
        const row = candidate({ transactionType: "UPI" });
        const overrides = createEmptyPreviewOverrides();
        overrides.transactionType.set(row.rowNumber, "");

        expect(applyPreviewOverrides([row], overrides)[0]!.transactionType).toBeNull();
    });
});

describe("Rename and reactivate - selectors follow, history does not change", () => {
    const creditCard = { id: "sbi-cc", type: AccountType.CREDIT_CARD, businessEntityId: null };

    function txService(): TransactionService {
        const s = new TransactionService();
        Object.defineProperty(s, "accountRepository", { value: { getById: async () => creditCard, getAll: async () => [creditCard] } });
        Object.defineProperty(s, "categoryRepository", { value: { getById: async () => null, getAll: async () => [] } });
        Object.defineProperty(s, "categoryContextMappingRepository", { value: { getByCategoryId: async () => [] } });
        return s;
    }

    const row = (id: string) =>
        sqlite.db!.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as Record<string, unknown>;

    it("renaming XYZ keeps the record and every transaction using it; they now display the new name", async () => {
        const typeId = await new PaymentTypeService().create({ label: "XYZ" });
        const txId = await txService().create({
            accountId: "sbi-cc", payee: "Shop", type: "expense", amount: 75, transactionDate: "2026-09-01",
            paymentMethod: "XYZ", transactionType: "XYZ", isImported: true, originalNarration: "XYZ SHOP",
        });
        const before = row(txId);

        await new PaymentTypeService().update({ id: typeId, label: "XYZ Wallet" });
        const { list } = await loadMasterList();

        expect(row(txId)).toEqual(before);
        expect(list.find(t => t.id === typeId)).toMatchObject({ code: "XYZ", label: "XYZ Wallet" });
        expect(paymentTypeLabel(list, before.payment_method as string)).toBe("XYZ Wallet");
        const preview = await renderPreviewTypeSelect(candidate({ transactionType: "XYZ" as never }));
        expect(preview.selected).toBe("XYZ");
        expect(preview.labels).toContain("XYZ Wallet");
        expect(preview.labels).not.toContain("XYZ");
    });

    it("a reactivated type is offered again by every selector, as the same code", async () => {
        const id = await new PaymentTypeService().create({ label: "Google Pay" });
        await new PaymentTypeService().update({ id, isActive: false });
        expect((await renderPreviewTypeSelect(candidate())).values).not.toContain("GOOGLE_PAY");

        await new PaymentTypeService().update({ id, isActive: true });
        const { list, active } = await loadMasterList();

        expect((await renderPreviewTypeSelect(candidate())).values).toContain("GOOGLE_PAY");
        expect(customRuleTypeOptions(list, null).map(o => o.value)).toContain("GOOGLE_PAY");
        expect(paymentTypeOptionsFor(active, list, null).map(o => o.value)).toContain("GOOGLE_PAY");
        expect(list.filter(t => t.code === "GOOGLE_PAY")).toHaveLength(1);
    });
});

describe("Manual acceptance flow: add Test Payment Type", () => {
    it("is offered by Import Preview, Custom Import Rules, Add/Edit Transaction and Loan EMI, and survives deactivate/reactivate", async () => {
        const id = await new PaymentTypeService().create({ label: "Test Payment Type" });
        let { list, active } = await loadMasterList();

        expect(list.find(t => t.id === id)).toMatchObject({ code: "TEST_PAYMENT_TYPE", label: "Test Payment Type", isActive: true });
        // Import Preview
        expect((await renderPreviewTypeSelect(candidate())).labels).toContain("Test Payment Type");
        // Custom Import Rules
        expect(customRuleTypeOptions(list, null).map(o => o.label)).toContain("Test Payment Type");
        // Add Transaction (no current value) and Loan EMI (active options only)
        expect(paymentTypeOptionsFor(active, list, null).map(o => o.label)).toContain("Test Payment Type");
        expect(active.map(o => o.label)).toContain("Test Payment Type");
        // Edit Transaction (any existing value)
        expect(paymentTypeOptionsFor(active, list, "UPI").map(o => o.label)).toContain("Test Payment Type");

        await new PaymentTypeService().update({ id, isActive: false });
        ({ list, active } = await loadMasterList());
        expect(active.map(o => o.value)).not.toContain("TEST_PAYMENT_TYPE");
        expect((await renderPreviewTypeSelect(candidate())).values).not.toContain("TEST_PAYMENT_TYPE");

        await new PaymentTypeService().update({ id, isActive: true });
        ({ list, active } = await loadMasterList());
        expect(active.map(o => o.value)).toContain("TEST_PAYMENT_TYPE");
        expect((await renderPreviewTypeSelect(candidate())).values).toContain("TEST_PAYMENT_TYPE");
    });
});
