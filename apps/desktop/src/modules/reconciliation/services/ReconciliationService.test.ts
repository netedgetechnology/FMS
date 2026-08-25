import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

import { ReconciliationService } from "./ReconciliationService";

describe("ReconciliationService.calculateAccountBalance", () => {
    const accountRepository = {
        getById: vi.fn(),
    };

    const transactionRepository = {
        getAll: vi.fn(),
    };

    const transferRepository = {
        getAllByAccountId: vi.fn(),
        getAllByAccountIdUpToDate: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        accountRepository.getById.mockResolvedValue({
            id: "account-1",
            openingBalance: 1000,
        });

        transactionRepository.getAll.mockResolvedValue([]);

        transferRepository.getAllByAccountId.mockResolvedValue([]);
        transferRepository.getAllByAccountIdUpToDate
            .mockResolvedValue([]);
    });

    function createService(): ReconciliationService {
        const service =
            new ReconciliationService();

        Object.defineProperty(
            service,
            "accountRepository",
            {
                value: accountRepository,
            }
        );

        Object.defineProperty(
            service,
            "transactionRepository",
            {
                value: transactionRepository,
            }
        );

        Object.defineProperty(
            service,
            "transferRepository",
            {
                value: transferRepository,
            }
        );

        return service;
    }

    it("returns the opening balance when there are no movements", async () => {
        const service = createService();

        const balance =
            await service.calculateAccountBalance(
                "account-1"
            );

        expect(balance).toBe(1000);
    });

    it("adds income transactions", async () => {
        transactionRepository.getAll.mockResolvedValue([
            {
                accountId: "account-1",
                type: "income",
                amount: 500,
                transactionDate: "2026-08-10",
            },
        ]);

        const service = createService();

        const balance =
            await service.calculateAccountBalance(
                "account-1"
            );

        expect(balance).toBe(1500);
    });

    it("subtracts expense transactions", async () => {
        transactionRepository.getAll.mockResolvedValue([
            {
                accountId: "account-1",
                type: "expense",
                amount: 250,
                transactionDate: "2026-08-10",
            },
        ]);

        const service = createService();

        const balance =
            await service.calculateAccountBalance(
                "account-1"
            );

        expect(balance).toBe(750);
    });

    it("subtracts transfers leaving the account", async () => {
        transferRepository.getAllByAccountId
            .mockResolvedValue([
                {
                    sourceAccountId: "account-1",
                    destinationAccountId: "account-2",
                    amount: 300,
                    transactionDate: "2026-08-10",
                },
            ]);

        const service = createService();

        const balance =
            await service.calculateAccountBalance(
                "account-1"
            );

        expect(balance).toBe(700);
    });

    it("adds transfers entering the account", async () => {
        transferRepository.getAllByAccountId
            .mockResolvedValue([
                {
                    sourceAccountId: "account-2",
                    destinationAccountId: "account-1",
                    amount: 400,
                    transactionDate: "2026-08-10",
                },
            ]);

        const service = createService();

        const balance =
            await service.calculateAccountBalance(
                "account-1"
            );

        expect(balance).toBe(1400);
    });

    it("excludes transactions after the statement date", async () => {
        transactionRepository.getAll.mockResolvedValue([
            {
                accountId: "account-1",
                type: "income",
                amount: 500,
                transactionDate: "2026-08-10",
            },
            {
                accountId: "account-1",
                type: "income",
                amount: 900,
                transactionDate: "2026-08-20",
            },
        ]);

        const service = createService();

        const balance =
            await service.calculateAccountBalance(
                "account-1",
                "2026-08-15"
            );

        expect(balance).toBe(1500);
    });

    it("uses the date-aware transfer repository method for a statement date", async () => {
        transferRepository
            .getAllByAccountIdUpToDate
            .mockResolvedValue([
                {
                    sourceAccountId: "account-1",
                    destinationAccountId: "account-2",
                    amount: 200,
                    transactionDate: "2026-08-10",
                },
            ]);

        const service = createService();

        const balance =
            await service.calculateAccountBalance(
                "account-1",
                "2026-08-15"
            );

        expect(
            transferRepository
                .getAllByAccountIdUpToDate
        ).toHaveBeenCalledWith(
            "account-1",
            "2026-08-15"
        );

        expect(balance).toBe(800);
    });

    it("combines transactions and transfers", async () => {
        transactionRepository.getAll.mockResolvedValue([
            {
                accountId: "account-1",
                type: "income",
                amount: 1000,
                transactionDate: "2026-08-05",
            },
            {
                accountId: "account-1",
                type: "expense",
                amount: 250,
                transactionDate: "2026-08-06",
            },
        ]);

        transferRepository.getAllByAccountId
            .mockResolvedValue([
                {
                    sourceAccountId: "account-1",
                    destinationAccountId: "account-2",
                    amount: 150,
                    transactionDate: "2026-08-07",
                },
                {
                    sourceAccountId: "account-3",
                    destinationAccountId: "account-1",
                    amount: 500,
                    transactionDate: "2026-08-08",
                },
            ]);

        const service = createService();

        const balance =
            await service.calculateAccountBalance(
                "account-1"
            );

        expect(balance).toBe(2100);
    });

    it("rejects a missing account id", async () => {
        const service = createService();

        await expect(
            service.calculateAccountBalance("")
        ).rejects.toThrow(
            "Account is required for balance calculation."
        );
    });

    it("rejects an unknown account", async () => {
        accountRepository.getById.mockResolvedValue(null);

        const service = createService();

        await expect(
            service.calculateAccountBalance(
                "missing-account"
            )
        ).rejects.toThrow("Account not found.");
    });
});

describe("ReconciliationService.calculateDifference", () => {
    it("returns statement balance minus system balance", () => {
        const service =
            new ReconciliationService();

        expect(
            service.calculateDifference(
                1200,
                1000
            )
        ).toBe(200);

        expect(
            service.calculateDifference(
                900,
                1000
            )
        ).toBe(-100);
    });

    it("rejects an invalid statement balance", () => {
        const service =
            new ReconciliationService();

        expect(() =>
            service.calculateDifference(
                Number.NaN,
                1000
            )
        ).toThrow(
            "Statement balance must be a valid number."
        );
    });

    it("rejects an invalid system balance", () => {
        const service =
            new ReconciliationService();

        expect(() =>
            service.calculateDifference(
                1000,
                Number.NaN
            )
        ).toThrow(
            "System balance must be a valid number."
        );
    });
});
describe("Task 13 - Validation and Edge Cases", () => {
    const accountRepository = {
        getById: vi.fn(),
    };

    const transactionRepository = {
        getAll: vi.fn(),
        getById: vi.fn(),
        update: vi.fn(),
    };

    const transferRepository = {
        getAllByAccountId: vi.fn(),
        getAllByAccountIdUpToDate: vi.fn(),
    };

    function createService(): ReconciliationService {
        const service = new ReconciliationService();

        Object.defineProperty(service, "accountRepository", {
            value: accountRepository,
        });

        Object.defineProperty(service, "transactionRepository", {
            value: transactionRepository,
        });

        Object.defineProperty(service, "transferRepository", {
            value: transferRepository,
        });

        return service;
    }

    beforeEach(() => {
        vi.clearAllMocks();

        accountRepository.getById.mockResolvedValue({
            id: "account-1",
            openingBalance: 1000,
        });

        transactionRepository.getAll.mockResolvedValue([]);
        transactionRepository.getById.mockResolvedValue(null);
        transactionRepository.update.mockResolvedValue(undefined);

        transferRepository.getAllByAccountId.mockResolvedValue([]);
        transferRepository.getAllByAccountIdUpToDate
            .mockResolvedValue([]);
    });

    it("rejects a missing account for transaction review", async () => {
        const service = createService();

        await expect(
            service.getTransactionsForReview("")
        ).rejects.toThrow(
            "Account is required for transaction review."
        );
    });

    it("rejects an unknown account for transaction review", async () => {
        accountRepository.getById.mockResolvedValue(null);

        const service = createService();

        await expect(
            service.getTransactionsForReview("missing-account")
        ).rejects.toThrow("Account not found.");
    });

    it("rejects a missing transaction id when marking reconciled", async () => {
        const service = createService();

        await expect(
            service.markTransactionReconciled("", true)
        ).rejects.toThrow(
            "Transaction ID is required."
        );
    });

    it("rejects an unknown transaction when marking reconciled", async () => {
        const service = createService();

        await expect(
            service.markTransactionReconciled(
                "missing-transaction",
                true
            )
        ).rejects.toThrow(
            "Transaction not found."
        );
    });

    it("rejects an invalid statement balance", () => {
        const service = createService();

        expect(() =>
            service.calculateDifference(
                Number.POSITIVE_INFINITY,
                1000
            )
        ).toThrow(
            "Statement balance must be a valid number."
        );
    });

    it("rejects an invalid system balance", () => {
        const service = createService();

        expect(() =>
            service.calculateDifference(
                1000,
                Number.NEGATIVE_INFINITY
            )
        ).toThrow(
            "System balance must be a valid number."
        );
    });
});
describe("Task 13 - Transaction Review Edge Cases", () => {
    const accountRepository = {
        getById: vi.fn(),
    };

    const transactionRepository = {
        getAll: vi.fn(),
        getById: vi.fn(),
        update: vi.fn(),
    };

    const transferRepository = {
        getAllByAccountId: vi.fn(),
        getAllByAccountIdUpToDate: vi.fn(),
    };

    function createService(): ReconciliationService {
        const service = new ReconciliationService();

        Object.defineProperty(service, "accountRepository", {
            value: accountRepository,
        });

        Object.defineProperty(service, "transactionRepository", {
            value: transactionRepository,
        });

        Object.defineProperty(service, "transferRepository", {
            value: transferRepository,
        });

        return service;
    }

    beforeEach(() => {
        vi.clearAllMocks();

        accountRepository.getById.mockResolvedValue({
            id: "account-1",
            openingBalance: 1000,
        });

        transactionRepository.getAll.mockResolvedValue([]);
        transactionRepository.getById.mockResolvedValue({
            id: "transaction-1",
            accountId: "account-1",
        });
        transactionRepository.update.mockResolvedValue(undefined);

        transferRepository.getAllByAccountId.mockResolvedValue([]);
        transferRepository.getAllByAccountIdUpToDate
            .mockResolvedValue([]);
    });

    it("returns an empty transaction review list when no transactions exist", async () => {
        const service = createService();

        const result =
            await service.getTransactionsForReview("account-1");

        expect(result).toEqual([]);
        expect(transactionRepository.getAll).toHaveBeenCalled();
    });

    it("marks an existing transaction as reconciled", async () => {
        const service = createService();

        await service.markTransactionReconciled(
            "transaction-1",
            true
        );

        expect(transactionRepository.update).toHaveBeenCalled();
    });

    it("marks an existing transaction as unreconciled", async () => {
        const service = createService();

        await service.markTransactionReconciled(
            "transaction-1",
            false
        );

        expect(transactionRepository.update).toHaveBeenCalled();
    });

    it("rejects an invalid reconciliation status", async () => {
        const service = createService();

        await expect(
            service.markTransactionReconciled(
                "transaction-1",
                undefined as unknown as boolean
            )
        ).rejects.toThrow();
    });
});
