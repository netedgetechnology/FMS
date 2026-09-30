import { describe, expect, it } from "vitest";

import type {
    CreateTransactionRequest,
    Transaction,
    UpdateTransactionRequest,
} from "../types";

import { TransactionService } from "./TransactionService";

// TransactionRepository talks to a live Tauri SQLite connection,
// unavailable in this test environment (see TransactionRepository.test.ts).
// Following that same established pattern, these tests inject a fake
// repository and assert on exactly what TransactionService hands it -
// proving the manual Add/Edit Transaction flow (AddTransactionDialog /
// EditTransactionDialog, which map the form's Description field to
// `originalNarration` before calling this service) persists Description
// into the same `original_narration` column imported transactions use,
// without disturbing Payee, Notes, or Reference Number.

function createServiceWithFakeRepository(): {
    service: TransactionService;
    created: Array<Transaction>;
    updated: Array<UpdateTransactionRequest>;
} {
    const service = new TransactionService();

    const created: Array<Transaction> = [];
    const updated: Array<UpdateTransactionRequest> = [];

    Object.defineProperty(service, "repository", {
        value: {
            async create(transaction: Transaction) {
                created.push(transaction);
            },
            async update(request: UpdateTransactionRequest) {
                updated.push(request);
            },
            // update() looks up the current transaction first, to merge
            // in the fields a partial edit omits (see the category
            // mapping validation tests below). None of these tests set
            // categoryId, so returning null here short-circuits that
            // validation without needing to fake the account/category
            // repositories too.
            async getById() {
                return {
                    id: "txn-1",
                    categoryId: null,
                    accountId: "account-1",
                    type: "expense",
                };
            },
        },
    });

    // assertCompatibleType only reaches these when categoryId is
    // truthy (see its `if (!categoryId) return` guard) - none of the
    // Description tests above set one, so these no-op fakes just stand
    // in for the real (Tauri-backed) repositories the tests below that
    // do set a real categoryId would otherwise hit.
    Object.defineProperty(service, "accountRepository", {
        value: { async getById() { return null; } },
    });

    Object.defineProperty(service, "categoryRepository", {
        value: {
            async getAll() { return []; },
            async getById() { return null; },
        },
    });

    Object.defineProperty(
        service,
        "categoryContextMappingRepository",
        { value: { async getByCategoryId() { return []; } } }
    );

    return { service, created, updated };
}

function baseRequest(
    overrides: Partial<CreateTransactionRequest> = {}
): CreateTransactionRequest {
    return {
        accountId: "account-1",
        payee: "Limestone Networks",
        type: "expense",
        amount: 500,
        transactionDate: "2026-08-01",
        ...overrides,
    };
}

describe("TransactionService - manual transaction Description (original_narration)", () => {
    it("1. a manually created transaction's Description is stored as original_narration", async () => {
        const { service, created } =
            createServiceWithFakeRepository();

        // Mirrors AddTransactionDialog.handleSubmit: the form's
        // `description` field is mapped to `originalNarration` before
        // calling TransactionService.create.
        await service.create(
            baseRequest({
                originalNarration: "Test Reference",
            })
        );

        expect(created).toHaveLength(1);
        expect(created[0].payee).toBe(
            "Limestone Networks"
        );
        expect(created[0].originalNarration).toBe(
            "Test Reference"
        );
    });

    it("2. Payee and Description are stored independently - neither overwrites the other", async () => {
        const { service, created } =
            createServiceWithFakeRepository();

        await service.create(
            baseRequest({
                payee: "Limestone Networks",
                originalNarration: "Test Reference",
                notes: "Reimbursed by employer",
            })
        );

        expect(created[0].payee).toBe(
            "Limestone Networks"
        );
        expect(created[0].originalNarration).toBe(
            "Test Reference"
        );
        expect(created[0].notes).toBe(
            "Reimbursed by employer"
        );
    });

    it("3. leaving Description blank stores a null original_narration, never a placeholder", async () => {
        const { service, created } =
            createServiceWithFakeRepository();

        await service.create(baseRequest());

        expect(
            created[0].originalNarration
        ).toBeNull();
    });

    it("4. editing a transaction's Payee (via EditTransactionDialog, which round-trips the current Description) never modifies original_narration", async () => {
        const { service, updated } =
            createServiceWithFakeRepository();

        // Mirrors EditTransactionDialog: getDefaultValues() prefills
        // `description` from the transaction's existing originalNarration,
        // so a user who only edits Payee still resubmits that same
        // Description, which handleSubmit maps back to originalNarration.
        await service.update({
            id: "txn-1",
            ...baseRequest({
                payee: "Limestone Networks India",
                originalNarration: "Test Reference",
            }),
        });

        expect(updated[0].payee).toBe(
            "Limestone Networks India"
        );
        expect(updated[0].originalNarration).toBe(
            "Test Reference"
        );
    });

    it("5. editing a transaction's Notes never modifies original_narration", async () => {
        const { service, updated } =
            createServiceWithFakeRepository();

        await service.update({
            id: "txn-1",
            ...baseRequest({
                notes: "Updated note",
                originalNarration: "Test Reference",
            }),
        });

        expect(updated[0].notes).toBe(
            "Updated note"
        );
        expect(updated[0].originalNarration).toBe(
            "Test Reference"
        );
    });

    it("6. Reference Number is completely independent of Description in both create and update", async () => {
        const { service, created, updated } =
            createServiceWithFakeRepository();

        await service.create(
            baseRequest({
                referenceNumber: "UTR12345",
                originalNarration: "Test Reference",
            })
        );

        expect(created[0].referenceNumber).toBe(
            "UTR12345"
        );
        expect(created[0].originalNarration).toBe(
            "Test Reference"
        );

        await service.update({
            id: "txn-1",
            ...baseRequest({
                referenceNumber: "UTR12345",
                originalNarration: "Test Reference",
            }),
        });

        expect(updated[0].referenceNumber).toBe(
            "UTR12345"
        );
        expect(updated[0].originalNarration).toBe(
            "Test Reference"
        );
    });
});

// Manual QA finding: Category = "None" saved successfully (correctly -
// Category is intentionally optional, see transactionSchema.test.ts and
// TransactionService.assertCompatibleType's `if (!categoryId) return`).
// But the Category select submits "" for "None", not null/undefined
// (unlike Payment Method, which submits null directly) - these tests
// pin down that TransactionService still normalizes "" to a real null,
// since budget spending's `categoryId === null` "Uncategorized" check
// and findManualDuplicate's own `|| null` both expect null, not "".
describe("TransactionService - Category '\"None\"' normalizes to null", () => {
    it("1. create(): categoryId '' (the form's None option) is stored as null, not ''", async () => {
        const { service, created } =
            createServiceWithFakeRepository();

        await service.create(
            baseRequest({ categoryId: "" })
        );

        expect(created[0].categoryId).toBeNull();
    });

    it("2. create(): categoryId omitted entirely is also stored as null", async () => {
        const { service, created } =
            createServiceWithFakeRepository();

        await service.create(baseRequest());

        expect(created[0].categoryId).toBeNull();
    });

    it("3. create(): a real categoryId is passed through unchanged", async () => {
        const { service, created } =
            createServiceWithFakeRepository();

        await service.create(
            baseRequest({ categoryId: "cat-groceries" })
        );

        expect(created[0].categoryId).toBe(
            "cat-groceries"
        );
    });

    it("4. update(): categoryId '' (switching an existing transaction to None) is stored as null, not ''", async () => {
        const { service, updated } =
            createServiceWithFakeRepository();

        await service.update({
            id: "txn-1",
            ...baseRequest({ categoryId: "" }),
        });

        expect(updated[0].categoryId).toBeNull();
    });
});

// Redesigned category Income/Expense behavior - a category can be
// mapped to a specific transaction type for a specific account or
// business entity. TransactionService must reject a save whose `type`
// disagrees with such a mapping, mirroring the same check the
// TransactionForm performs client-side (see resolveCategoryTransactionType).
describe("TransactionService - category context mapping validation", () => {
    interface Fakes {
        service: TransactionService;
        created: Array<Transaction>;
        updated: Array<UpdateTransactionRequest>;
    }

    function createService(options: {
        account?: { id: string; businessEntityId: string | null } | null;
        categories?: Array<{ id: string; categoryType: string }>;
        mappings?: Array<{
            categoryId: string;
            accountId: string | null;
            businessEntityId: string | null;
            categoryType: string;
            isActive: boolean;
        }>;
        existingTransaction?: {
            id: string;
            categoryId: string | null;
            accountId: string;
            type: string;
        };
    }): Fakes {
        const service = new TransactionService();

        const created: Array<Transaction> = [];
        const updated: Array<UpdateTransactionRequest> = [];

        Object.defineProperty(service, "repository", {
            value: {
                async create(transaction: Transaction) {
                    created.push(transaction);
                },
                async update(request: UpdateTransactionRequest) {
                    updated.push(request);
                },
                async getById() {
                    return (
                        options.existingTransaction ?? {
                            id: "txn-1",
                            categoryId: null,
                            accountId: "account-1",
                            type: "expense",
                        }
                    );
                },
            },
        });

        Object.defineProperty(service, "accountRepository", {
            value: {
                async getById() {
                    return options.account ?? null;
                },
            },
        });

        Object.defineProperty(service, "categoryRepository", {
            value: {
                async getAll() {
                    return options.categories ?? [];
                },
                async getById(id: string) {
                    return (
                        (options.categories ?? []).find(
                            (category: { id: string }) => category.id === id
                        ) ?? null
                    );
                },
            },
        });

        Object.defineProperty(
            service,
            "categoryContextMappingRepository",
            {
                value: {
                    async getByCategoryId() {
                        return options.mappings ?? [];
                    },
                },
            }
        );

        return { service, created, updated };
    }

    it("1. rejects a transaction type that conflicts with an account-specific mapping", async () => {
        const { service } = createService({
            account: { id: "acct-family", businessEntityId: null },
            mappings: [
                {
                    categoryId: "cat-salary",
                    accountId: "acct-family",
                    businessEntityId: null,
                    categoryType: "INCOME",
                    isActive: true,
                },
            ],
        });

        await expect(
            service.create(
                baseRequest({
                    accountId: "acct-family",
                    categoryId: "cat-salary",
                    type: "expense",
                })
            )
        ).rejects.toThrow(/mapped to Income/);
    });

    it("2. accepts a transaction type that matches an account-specific mapping", async () => {
        const { service, created } = createService({
            account: { id: "acct-family", businessEntityId: null },
            mappings: [
                {
                    categoryId: "cat-salary",
                    accountId: "acct-family",
                    businessEntityId: null,
                    categoryType: "INCOME",
                    isActive: true,
                },
            ],
        });

        await service.create(
            baseRequest({
                accountId: "acct-family",
                categoryId: "cat-salary",
                type: "income",
            })
        );

        expect(created).toHaveLength(1);
    });

    it("3. rejects a transaction type that conflicts with a business-entity-specific mapping", async () => {
        const { service } = createService({
            account: {
                id: "acct-netedge",
                businessEntityId: "entity-netedge",
            },
            mappings: [
                {
                    categoryId: "cat-salary",
                    accountId: null,
                    businessEntityId: "entity-netedge",
                    categoryType: "EXPENSE",
                    isActive: true,
                },
            ],
        });

        await expect(
            service.create(
                baseRequest({
                    accountId: "acct-netedge",
                    categoryId: "cat-salary",
                    type: "income",
                })
            )
        ).rejects.toThrow(/mapped to Expense/);
    });

    it("4. an account-specific mapping takes priority over a business-entity mapping for the same category", async () => {
        const { service, created } = createService({
            account: {
                id: "acct-netedge",
                businessEntityId: "entity-netedge",
            },
            mappings: [
                {
                    categoryId: "cat-salary",
                    accountId: null,
                    businessEntityId: "entity-netedge",
                    categoryType: "EXPENSE",
                    isActive: true,
                },
                {
                    categoryId: "cat-salary",
                    accountId: "acct-netedge",
                    businessEntityId: null,
                    categoryType: "INCOME",
                    isActive: true,
                },
            ],
        });

        await service.create(
            baseRequest({
                accountId: "acct-netedge",
                categoryId: "cat-salary",
                type: "income",
            })
        );

        expect(created).toHaveLength(1);
    });

    it("5. a personal account with no business entity and no mapping falls back to the category's own default type without being enforced", async () => {
        const { service, created } = createService({
            account: { id: "acct-family", businessEntityId: null },
            categories: [
                { id: "cat-salary", categoryType: "INCOME" },
            ],
        });

        // The category's default is INCOME, but no explicit mapping
        // exists for this account/entity, so an EXPENSE save is still
        // allowed (soft default - see assertCompatibleType).
        await service.create(
            baseRequest({
                accountId: "acct-family",
                categoryId: "cat-salary",
                type: "expense",
            })
        );

        expect(created).toHaveLength(1);
    });

    it("6. a category/account combination with no mapping at all allows any transaction type", async () => {
        const { service, created } = createService({
            account: { id: "acct-1", businessEntityId: null },
            categories: [],
        });

        await service.create(
            baseRequest({
                accountId: "acct-1",
                categoryId: "cat-unmapped",
                type: "transfer",
            })
        );

        expect(created).toHaveLength(1);
    });

    it("7. a transaction with no category never triggers mapping validation", async () => {
        const { service, created } = createService({});

        await service.create(
            baseRequest({
                accountId: "acct-1",
                type: "income",
            })
        );

        expect(created).toHaveLength(1);
    });

    it("8. re-validates against the mapping on update, using the transaction's existing account/category when the edit omits them", async () => {
        const { service, updated } = createService({
            account: { id: "acct-family", businessEntityId: null },
            mappings: [
                {
                    categoryId: "cat-salary",
                    accountId: "acct-family",
                    businessEntityId: null,
                    categoryType: "INCOME",
                    isActive: true,
                },
            ],
            existingTransaction: {
                id: "txn-1",
                categoryId: "cat-salary",
                accountId: "acct-family",
                type: "income",
            },
        });

        // The edit only changes amount/type - accountId/categoryId are
        // carried over from the existing transaction record.
        await expect(
            service.update({
                id: "txn-1",
                accountId: "acct-family",
                payee: "Test",
                type: "expense",
                amount: 100,
                transactionDate: "2026-08-01",
            })
        ).rejects.toThrow(/mapped to Income/);

        expect(updated).toHaveLength(0);
    });
});

// Loans Phase 6 - a transaction that records a loan EMI payment must
// be reversed through LoanPaymentService.reversePayment() (which
// restores the loan's schedule/balances too), never deleted directly
// through the generic Transactions workflow and left to silently
// desync those.
describe("TransactionService.delete - EMI-linked transaction guard", () => {
    function createService(
        linkedPayment: unknown
    ): {
        service: TransactionService;
        deleted: string[];
    } {
        const service = new TransactionService();
        const deleted: string[] = [];

        Object.defineProperty(service, "repository", {
            value: {
                async delete(id: string) {
                    deleted.push(id);
                },
            },
        });

        Object.defineProperty(
            service,
            "loanSchedulePaymentRepository",
            {
                value: {
                    async getByTransactionId() {
                        return linkedPayment;
                    },
                },
            }
        );

        return { service, deleted };
    }

    it("refuses to delete a transaction linked to a loan EMI payment", async () => {
        const { service, deleted } = createService({
            id: "pay-1",
            transactionId: "txn-1",
        });

        await expect(
            service.delete("txn-1")
        ).rejects.toThrow(
            /reverse the payment instead/
        );

        expect(deleted).toHaveLength(0);
    });

    it("deletes an ordinary (non-loan) transaction normally", async () => {
        const { service, deleted } = createService(null);

        await service.delete("txn-2");

        expect(deleted).toEqual(["txn-2"]);
    });
});

// Transactions - safer bulk delete: BulkDeleteTransactionsDialog calls
// this before deleting anything from a selected batch, so it can
// refuse the whole batch up front instead of partially deleting up to
// the first transaction delete() itself would refuse.
describe("TransactionService.findEmiLinkedTransactionIds", () => {
    function createService(
        linkedPayments: Array<{ transactionId: string }>
    ): {
        service: TransactionService;
        requestedIds: string[][];
    } {
        const service = new TransactionService();
        const requestedIds: string[][] = [];

        Object.defineProperty(
            service,
            "loanSchedulePaymentRepository",
            {
                value: {
                    async getByTransactionIds(
                        ids: string[]
                    ) {
                        requestedIds.push(ids);
                        return linkedPayments;
                    },
                },
            }
        );

        return { service, requestedIds };
    }

    it("returns [] when none of the given ids are EMI-linked", async () => {
        const { service } = createService([]);

        const result =
            await service.findEmiLinkedTransactionIds(
                ["txn-1", "txn-2"]
            );

        expect(result).toEqual([]);
    });

    it("returns the transaction id for a single EMI-linked transaction", async () => {
        const { service } = createService([
            { transactionId: "txn-2" },
        ]);

        const result =
            await service.findEmiLinkedTransactionIds(
                ["txn-1", "txn-2", "txn-3"]
            );

        expect(result).toEqual(["txn-2"]);
    });

    it("returns every EMI-linked transaction id when a batch has more than one", async () => {
        const { service } = createService([
            { transactionId: "txn-1" },
            { transactionId: "txn-3" },
        ]);

        const result =
            await service.findEmiLinkedTransactionIds(
                ["txn-1", "txn-2", "txn-3", "txn-4"]
            );

        expect(result.sort()).toEqual([
            "txn-1",
            "txn-3",
        ]);
    });

    it("passes every requested id straight through to the repository in one call - no per-id looping", async () => {
        const { service, requestedIds } =
            createService([]);

        await service.findEmiLinkedTransactionIds([
            "txn-1",
            "txn-2",
            "txn-missing",
        ]);

        expect(requestedIds).toEqual([
            ["txn-1", "txn-2", "txn-missing"],
        ]);
    });
});
