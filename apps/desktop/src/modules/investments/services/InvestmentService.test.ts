import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvestmentService } from "./InvestmentService";
import { InvestmentStatus, UpdateInvestmentRequest } from "../types";

describe("InvestmentService.update - 1:1 linked-account integrity", () => {
    const repository = {
        getById: vi.fn(),
        update: vi.fn(),
        linkAccount: vi.fn(),
    };

    const accountRepository = {
        getById: vi.fn(),
        create: vi.fn(),
        syncLinkedAccount: vi.fn(),
    };

    const transactionRepository = {
        getAllByInvestmentId: vi.fn(),
    };

    function createService(): InvestmentService {
        const service = new InvestmentService();

        Object.defineProperty(service, "repository", {
            value: repository,
        });
        Object.defineProperty(service, "accountRepository", {
            value: accountRepository,
        });
        Object.defineProperty(
            service,
            "transactionRepository",
            { value: transactionRepository }
        );

        return service;
    }

    const request: UpdateInvestmentRequest = {
        id: "inv-1",
        businessEntityId: "be-1",
        name: "My Fund",
        investmentType: "Stocks",
        currencyId: "cur-inr",
        quantity: 0,
        averageCost: 0,
        currentPrice: 0,
        currentValue: 0,
        status: InvestmentStatus.ACTIVE,
    };

    beforeEach(() => {
        vi.clearAllMocks();

        repository.getById.mockResolvedValue({
            id: "inv-1",
            accountId: "acct-1",
            // Matches `request`'s currencyId/currentPrice by default so
            // these account-link-repair tests aren't incidentally
            // exercising the currency-change guard or the
            // priceUpdatedAt bump added in the Safety & Data Integrity
            // phase - those get their own describe blocks below.
            currencyId: "cur-inr",
            currentPrice: 0,
            quantity: 0,
            averageCost: 0,
            priceUpdatedAt: null,
        });
        repository.update.mockResolvedValue(undefined);
        repository.linkAccount.mockResolvedValue(undefined);
        accountRepository.create.mockResolvedValue(undefined);
        accountRepository.syncLinkedAccount.mockResolvedValue(undefined);
        transactionRepository.getAllByInvestmentId.mockResolvedValue(
            []
        );
    });

    it("keeps the existing link and does not repair when the linked account is live", async () => {
        accountRepository.getById.mockResolvedValue({
            id: "acct-1",
            type: "INVESTMENT",
        });

        await createService().update({ ...request });

        expect(accountRepository.getById).toHaveBeenCalledWith("acct-1");
        expect(accountRepository.create).not.toHaveBeenCalled();
        expect(repository.linkAccount).not.toHaveBeenCalled();

        expect(repository.update).toHaveBeenCalledTimes(1);
        expect(repository.update.mock.calls[0][0]).not.toHaveProperty(
            "accountId"
        );

        expect(accountRepository.syncLinkedAccount).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "acct-1",
                businessEntityId: "be-1",
                isActive: true,
            })
        );
    });

    it("repairs the link when the stored account_id points at a missing / soft-deleted account", async () => {
        // AccountRepository.getById filters deleted_at IS NULL, so a
        // soft-deleted linked account comes back as null.
        accountRepository.getById.mockResolvedValue(null);

        await createService().update({ ...request });

        expect(accountRepository.getById).toHaveBeenCalledWith("acct-1");
        expect(accountRepository.create).toHaveBeenCalledTimes(1);

        const createdAccount = accountRepository.create.mock.calls[0][0];
        expect(createdAccount).toMatchObject({
            type: "INVESTMENT",
            openingBalance: 0,
            businessEntityId: "be-1",
            name: "My Fund",
            currencyId: "cur-inr",
            isActive: true,
        });
        expect(createdAccount.id).toEqual(expect.any(String));
        expect(createdAccount.id).not.toBe("acct-1");

        expect(repository.linkAccount).toHaveBeenCalledWith(
            "inv-1",
            createdAccount.id
        );
        expect(accountRepository.syncLinkedAccount).toHaveBeenCalledWith(
            expect.objectContaining({ id: createdAccount.id })
        );
    });

    it("repairs the link when the investment has no account_id at all", async () => {
        repository.getById.mockResolvedValue({
            id: "inv-1",
            accountId: null,
        });

        await createService().update({ ...request });

        // no id to look up, so it must not try
        expect(accountRepository.getById).not.toHaveBeenCalled();
        expect(accountRepository.create).toHaveBeenCalledTimes(1);
        expect(repository.linkAccount).toHaveBeenCalledTimes(1);

        const createdAccount = accountRepository.create.mock.calls[0][0];
        expect(repository.linkAccount).toHaveBeenCalledWith(
            "inv-1",
            createdAccount.id
        );
    });

    it("treats a whitespace-only account_id as no link and repairs", async () => {
        repository.getById.mockResolvedValue({
            id: "inv-1",
            accountId: "   ",
        });

        await createService().update({ ...request });

        expect(accountRepository.getById).not.toHaveBeenCalled();
        expect(accountRepository.create).toHaveBeenCalledTimes(1);
        expect(repository.linkAccount).toHaveBeenCalledTimes(1);
    });

    it("throws and creates nothing when the investment does not exist", async () => {
        repository.getById.mockResolvedValue(null);

        await expect(
            createService().update({ ...request })
        ).rejects.toThrow("Investment not found.");

        expect(accountRepository.create).not.toHaveBeenCalled();
        expect(repository.update).not.toHaveBeenCalled();
    });

    describe("calculated field authority (quantity / averageCost / currentValue)", () => {
        beforeEach(() => {
            accountRepository.getById.mockResolvedValue({
                id: "acct-1",
                type: "INVESTMENT",
            });
        });

        it("ignores the request's quantity/averageCost once the investment has transactions, and computes currentValue from the ledger-derived quantity", async () => {
            repository.getById.mockResolvedValue({
                id: "inv-1",
                accountId: "acct-1",
                currencyId: "cur-inr",
                currentPrice: 0,
                quantity: 25,
                averageCost: 80,
                priceUpdatedAt: null,
            });
            transactionRepository.getAllByInvestmentId.mockResolvedValue(
                [{ id: "txn-1" }]
            );

            await createService().update({
                ...request,
                quantity: 999, // attempted override - must be ignored
                averageCost: 999, // attempted override - must be ignored
                currentPrice: 10,
                currentValue: 1, // attempted override - must be ignored
            });

            const updatePayload =
                repository.update.mock.calls[0][0];

            expect(updatePayload.quantity).toBe(25);
            expect(updatePayload.averageCost).toBe(80);
            // 25 (ledger quantity) x 10 (new currentPrice), not the
            // request's currentValue: 1
            expect(updatePayload.currentValue).toBe(
                250
            );
        });

        it("allows quantity/averageCost to be set freely when no transactions exist yet", async () => {
            transactionRepository.getAllByInvestmentId.mockResolvedValue(
                []
            );

            await createService().update({
                ...request,
                quantity: 40,
                averageCost: 55,
                currentPrice: 12,
                currentValue: 1, // ignored regardless - always computed
            });

            const updatePayload =
                repository.update.mock.calls[0][0];

            expect(updatePayload.quantity).toBe(40);
            expect(updatePayload.averageCost).toBe(55);
            expect(updatePayload.currentValue).toBe(
                480
            );
        });
    });

    describe("currency changes", () => {
        beforeEach(() => {
            accountRepository.getById.mockResolvedValue({
                id: "acct-1",
                type: "INVESTMENT",
            });
        });

        it("rejects a currency change once the investment has transactions", async () => {
            repository.getById.mockResolvedValue({
                id: "inv-1",
                accountId: "acct-1",
                currencyId: "cur-inr",
                currentPrice: 0,
                priceUpdatedAt: null,
            });
            transactionRepository.getAllByInvestmentId.mockResolvedValue(
                [{ id: "txn-1" }]
            );

            await expect(
                createService().update({
                    ...request,
                    currencyId: "cur-usd",
                })
            ).rejects.toThrow(/currency can't be changed/i);

            expect(repository.update).not.toHaveBeenCalled();
        });

        it("allows a currency change when there are no transactions yet", async () => {
            repository.getById.mockResolvedValue({
                id: "inv-1",
                accountId: "acct-1",
                currencyId: "cur-inr",
                currentPrice: 0,
                priceUpdatedAt: null,
            });
            transactionRepository.getAllByInvestmentId.mockResolvedValue(
                []
            );

            await createService().update({
                ...request,
                currencyId: "cur-usd",
            });

            expect(repository.update).toHaveBeenCalledTimes(
                1
            );
            expect(
                repository.update.mock.calls[0][0]
                    .currencyId
            ).toBe("cur-usd");
        });
    });

    describe("price freshness (priceUpdatedAt)", () => {
        beforeEach(() => {
            accountRepository.getById.mockResolvedValue({
                id: "acct-1",
                type: "INVESTMENT",
            });
        });

        it("bumps priceUpdatedAt when currentPrice changes", async () => {
            repository.getById.mockResolvedValue({
                id: "inv-1",
                accountId: "acct-1",
                currencyId: "cur-inr",
                currentPrice: 100,
                priceUpdatedAt: "2026-01-01T00:00:00.000Z",
            });

            await createService().update({
                ...request,
                currentPrice: 150,
            });

            const updatePayload =
                repository.update.mock.calls[0][0];

            expect(
                updatePayload.priceUpdatedAt
            ).not.toBe("2026-01-01T00:00:00.000Z");
            expect(
                typeof updatePayload.priceUpdatedAt
            ).toBe("string");
        });

        it("keeps the existing priceUpdatedAt when currentPrice is unchanged", async () => {
            repository.getById.mockResolvedValue({
                id: "inv-1",
                accountId: "acct-1",
                currencyId: "cur-inr",
                currentPrice: 100,
                priceUpdatedAt: "2026-01-01T00:00:00.000Z",
            });

            await createService().update({
                ...request,
                currentPrice: 100,
            });

            const updatePayload =
                repository.update.mock.calls[0][0];

            expect(
                updatePayload.priceUpdatedAt
            ).toBe("2026-01-01T00:00:00.000Z");
        });
    });
});

describe("InvestmentService.delete - orphan cleanup", () => {
    const repository = {
        getLinkedAccountId: vi.fn(),
        delete: vi.fn(),
        beginTransaction: vi.fn(),
        commit: vi.fn(),
        rollback: vi.fn(),
    };

    const accountRepository = {
        delete: vi.fn(),
    };

    const transactionRepository = {
        deleteByInvestmentId: vi.fn(),
    };

    const holdingRepository = {
        deleteByInvestmentId: vi.fn(),
    };

    function createService(): InvestmentService {
        const service = new InvestmentService();

        Object.defineProperty(service, "repository", {
            value: repository,
        });
        Object.defineProperty(
            service,
            "accountRepository",
            { value: accountRepository }
        );
        Object.defineProperty(
            service,
            "transactionRepository",
            { value: transactionRepository }
        );
        Object.defineProperty(
            service,
            "holdingRepository",
            { value: holdingRepository }
        );

        return service;
    }

    beforeEach(() => {
        vi.clearAllMocks();

        repository.getLinkedAccountId.mockResolvedValue(
            "acct-1"
        );
        repository.delete.mockResolvedValue(undefined);
        repository.beginTransaction.mockResolvedValue(
            undefined
        );
        repository.commit.mockResolvedValue(undefined);
        repository.rollback.mockResolvedValue(undefined);
        accountRepository.delete.mockResolvedValue(
            undefined
        );
        transactionRepository.deleteByInvestmentId.mockResolvedValue(
            undefined
        );
        holdingRepository.deleteByInvestmentId.mockResolvedValue(
            undefined
        );
    });

    it("deletes transactions, holdings, the investment and its mirror account, then commits", async () => {
        await createService().delete("inv-1");

        expect(repository.beginTransaction).toHaveBeenCalledTimes(
            1
        );
        expect(
            transactionRepository.deleteByInvestmentId
        ).toHaveBeenCalledWith("inv-1");
        expect(
            holdingRepository.deleteByInvestmentId
        ).toHaveBeenCalledWith("inv-1");
        expect(repository.delete).toHaveBeenCalledWith(
            "inv-1"
        );
        expect(accountRepository.delete).toHaveBeenCalledWith(
            "acct-1"
        );
        expect(repository.commit).toHaveBeenCalledTimes(1);
        expect(repository.rollback).not.toHaveBeenCalled();
    });

    it("skips the mirror-account delete when the investment has no linked account", async () => {
        repository.getLinkedAccountId.mockResolvedValue(
            null
        );

        await createService().delete("inv-1");

        expect(accountRepository.delete).not.toHaveBeenCalled();
        expect(repository.commit).toHaveBeenCalledTimes(1);
    });

    it("rolls back and rethrows when a step inside the transaction fails", async () => {
        repository.delete.mockRejectedValue(
            new Error("disk full")
        );

        await expect(
            createService().delete("inv-1")
        ).rejects.toThrow("disk full");

        expect(repository.rollback).toHaveBeenCalledTimes(
            1
        );
        expect(repository.commit).not.toHaveBeenCalled();
        // The mirror account delete must not run after a failed step.
        expect(accountRepository.delete).not.toHaveBeenCalled();
    });
});
