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
        },
    });

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
