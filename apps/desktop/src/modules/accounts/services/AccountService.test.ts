import { describe, expect, it } from "vitest";

import { AccountService } from "./AccountService";

// Delete Loan - generic deletion protection. An account that is a
// loan's linked liability account must be removed through
// LoanService.delete() (which enforces the no-payments policy and
// cleans up the loan's own schedule/ledger), never directly through
// the generic Accounts workflow - deleting it here would leave the
// loan pointing at a missing account.
describe("AccountService.delete - loan-linked account guard", () => {
    function createService(options: {
        linkedToLoan?: boolean;
        hasTransactions?: boolean;
    }): {
        service: AccountService;
        deleted: string[];
    } {
        const service = new AccountService();
        const deleted: string[] = [];

        Object.defineProperty(service, "repository", {
            value: {
                async delete(id: string) {
                    deleted.push(id);
                },
            },
        });

        Object.defineProperty(service, "loanRepository", {
            value: {
                async isLinkedToLoan() {
                    return options.linkedToLoan ?? false;
                },
            },
        });

        Object.defineProperty(service, "transactionRepository", {
            value: {
                async existsForAccount() {
                    return options.hasTransactions ?? false;
                },
            },
        });

        return { service, deleted };
    }

    it("refuses to delete an account linked to a loan", async () => {
        const { service, deleted } = createService({
            linkedToLoan: true,
        });

        await expect(
            service.delete("loan-acct-1")
        ).rejects.toThrow(
            /delete the loan from the loans page instead/i
        );

        expect(deleted).toHaveLength(0);
    });

    it("deletes an ordinary (non-loan-linked) account normally", async () => {
        const { service, deleted } = createService({});

        await service.delete("acct-1");

        expect(deleted).toEqual(["acct-1"]);
    });
});

// Delete Account - transaction deletion protection (production bug:
// an account with a linked transaction could be hard-deleted, leaving
// the transaction pointing at a missing account that every list
// resolves by falling back to the raw account UUID). An account with
// any live transaction booked against it must never be deleted through
// this generic workflow - see AccountService.delete().
describe("AccountService.delete - transaction-linked account guard", () => {
    function createService(options: {
        linkedToLoan?: boolean;
        hasTransactions?: boolean;
    }): {
        service: AccountService;
        deleted: string[];
    } {
        const service = new AccountService();
        const deleted: string[] = [];

        Object.defineProperty(service, "repository", {
            value: {
                async delete(id: string) {
                    deleted.push(id);
                },
            },
        });

        Object.defineProperty(service, "loanRepository", {
            value: {
                async isLinkedToLoan() {
                    return options.linkedToLoan ?? false;
                },
            },
        });

        Object.defineProperty(service, "transactionRepository", {
            value: {
                async existsForAccount() {
                    return options.hasTransactions ?? false;
                },
            },
        });

        return { service, deleted };
    }

    it("refuses to delete an account with linked transactions", async () => {
        const { service, deleted } = createService({
            hasTransactions: true,
        });

        await expect(
            service.delete("acct-with-txns")
        ).rejects.toThrow(
            /transactions linked to it and can't be deleted/i
        );

        expect(deleted).toHaveLength(0);
    });

    it("deletes an account without any transactions", async () => {
        const { service, deleted } = createService({
            hasTransactions: false,
        });

        await service.delete("acct-no-txns");

        expect(deleted).toEqual(["acct-no-txns"]);
    });

    it("checks the loan guard before the transaction guard", async () => {
        // A loan-linked account is always rejected with the loan-specific
        // message, regardless of whether it also has transactions -
        // the loan flow is the correct place to resolve both at once.
        const { service, deleted } = createService({
            linkedToLoan: true,
            hasTransactions: true,
        });

        await expect(
            service.delete("loan-acct-with-txns")
        ).rejects.toThrow(
            /delete the loan from the loans page instead/i
        );

        expect(deleted).toHaveLength(0);
    });
});
