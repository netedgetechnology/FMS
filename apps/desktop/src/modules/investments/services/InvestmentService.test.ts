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

    function createService(): InvestmentService {
        const service = new InvestmentService();

        Object.defineProperty(service, "repository", {
            value: repository,
        });
        Object.defineProperty(service, "accountRepository", {
            value: accountRepository,
        });

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
        });
        repository.update.mockResolvedValue(undefined);
        repository.linkAccount.mockResolvedValue(undefined);
        accountRepository.create.mockResolvedValue(undefined);
        accountRepository.syncLinkedAccount.mockResolvedValue(undefined);
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
});
