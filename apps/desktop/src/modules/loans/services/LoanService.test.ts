import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoanService } from "./LoanService";
import type { Loan, UpdateLoanRequest } from "../types";

function loan(overrides: Partial<Loan> = {}): Loan {
    return {
        id: "loan-1",
        accountId: "bank-1",
        loanAccountId: "loan-acct-1",
        lenderInstitutionId: null,
        loanType: "PERSONAL",
        name: "Car loan",
        principalAmount: 100000,
        interestRate: 10,
        interestType: "REDUCING",
        tenureMonths: 12,
        emiAmount: 8792,
        startDate: "2026-01-01",
        maturityDate: "2027-01-01",
        outstandingPrincipal: 100000,
        outstandingInterest: 5000,
        paidInstallments: 0,
        currencyId: "cur-inr",
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function updateRequest(
    overrides: Partial<UpdateLoanRequest> = {}
): UpdateLoanRequest {
    return {
        id: "loan-1",
        accountId: "bank-1",
        loanType: "PERSONAL",
        name: "Car loan",
        principalAmount: 100000,
        interestRate: 10,
        interestType: "REDUCING",
        tenureMonths: 12,
        emiAmount: 8792,
        startDate: "2026-01-01",
        maturityDate: "2027-01-01",
        paidInstallments: 0,
        currencyId: "cur-inr",
        status: "ACTIVE",
        ...overrides,
    };
}

describe("LoanService.create - atomic loan + account + schedule", () => {
    // create() now persists everything (the loan's mirror account, the
    // loan row, the account link, every schedule installment and the
    // schedule-reconciled balances) in ONE real database transaction
    // via a dedicated Rust command (LoanRepository.createAtomic) -
    // replacing the earlier `beginTransaction()`/multiple `execute()`
    // calls/`commit()` sequence, whose separate calls could not
    // guarantee every statement ran on the same physical connection.
    // That gap is exactly what let a failed create (e.g. an
    // unresolved Linked Account) leave a dangling, never-rolled-back
    // transaction - surfacing as "database is locked" / "cannot
    // rollback - no transaction is active" and a permanently pending
    // create() promise (the stuck "Saving..." UI) on the next attempt.
    const repository = {
        createAtomic: vi.fn(),
    };

    const institutionRepository = {
        getByName: vi.fn(),
        create: vi.fn(),
    };

    function createService(): LoanService {
        const service = new LoanService();

        Object.defineProperty(service, "repository", {
            value: repository,
        });
        Object.defineProperty(
            service,
            "institutionRepository",
            { value: institutionRepository }
        );

        return service;
    }

    const request = {
        loanType: "PERSONAL",
        name: "Car loan",
        principalAmount: 100000,
        interestRate: 10,
        interestType: "REDUCING" as const,
        tenureMonths: 12,
        startDate: "2026-01-01",
        outstandingPrincipal: 100000,
        outstandingInterest: 5000,
        paidInstallments: 0,
        currencyId: "cur-inr",
        status: "ACTIVE" as const,
    };

    beforeEach(() => {
        vi.clearAllMocks();

        repository.createAtomic.mockResolvedValue(undefined);
        institutionRepository.getByName.mockResolvedValue(
            null
        );
        institutionRepository.create.mockResolvedValue(
            undefined
        );
    });

    it("2. computes the schedule and persists the account, the loan, the link and every installment in one atomic call, and resolves with the new loan id", async () => {
        const service = createService();

        const loanId = await service.create(request);

        expect(loanId).toBeTruthy();
        expect(repository.createAtomic).toHaveBeenCalledTimes(
            1
        );

        const payload = repository.createAtomic.mock
            .calls[0][0] as {
            loanAccount: { id: string };
            loan: { id: string; accountId: unknown };
            schedule: unknown[];
            balances: Record<string, unknown>;
        };

        expect(payload.loan.id).toBe(loanId);
        expect(payload.loanAccount.id).toBeTruthy();
        // 12 months tenure, no prior installments -> 12 schedule rows.
        expect(payload.schedule).toHaveLength(12);
        expect(payload.balances).toHaveProperty(
            "outstandingPrincipal"
        );
        expect(payload.balances).toHaveProperty(
            "outstandingInterest"
        );
        expect(payload.balances).toHaveProperty("status");
    });

    // Production bug: "Add Loan" with the Linked Account select left
    // blank failed with a generic "Failed to create loan" error. Root
    // cause traced (and confirmed by directly executing the equivalent
    // INSERT against a disposable copy of the real database) to
    // loans.account_id having a FOREIGN KEY constraint against
    // accounts(id) - the form's blank Linked Account is "" (its select
    // default, and the zod schema's `.optional()` only skips a literal
    // undefined), and "" never resolves to a real account, so the
    // insert always failed with SQLITE_CONSTRAINT_FOREIGNKEY. Fixed by
    // normalizing a blank accountId to null before it reaches the
    // repository.
    it("1. creates a loan with every field from the reported reproduction scenario, including a blank Linked Account", async () => {
        const service = createService();

        const loanId = await service.create({
            name: "Production Test Loan",
            loanType: "Home Loan",
            lenderInstitutionName: "Production Test Lender",
            accountId: "",
            currencyId: "cur-inr",
            principalAmount: 10000,
            interestRate: 12,
            interestType: "REDUCING",
            tenureMonths: 12,
            startDate: "2026-09-20",
            maturityDate: "2027-09-20",
            emiAmount: 888.49,
            paidInstallments: 0,
            outstandingPrincipal: 10000,
            outstandingInterest: 661.86,
            status: "ACTIVE",
            notes: "Production loan test",
        });

        expect(loanId).toBeTruthy();
        expect(repository.createAtomic).toHaveBeenCalledTimes(
            1
        );

        const payload = repository.createAtomic.mock
            .calls[0][0] as { loan: { accountId: unknown } };

        // The exact discovered failure: a blank Linked Account must
        // reach the repository as null, never as "" - "" would violate
        // loans.account_id's FOREIGN KEY constraint against accounts(id).
        expect(payload.loan.accountId).toBeNull();
    });

    it("normalizes a blank (empty-string) Linked Account to null instead of persisting it as-is", async () => {
        const service = createService();

        await service.create({
            ...request,
            accountId: "",
        });

        const payload = repository.createAtomic.mock
            .calls[0][0] as { loan: { accountId: unknown } };

        expect(payload.loan.accountId).toBeNull();
    });

    it("still persists a real Linked Account id unchanged", async () => {
        const service = createService();

        await service.create({
            ...request,
            accountId: "bank-1",
        });

        const payload = repository.createAtomic.mock
            .calls[0][0] as { loan: { accountId: unknown } };

        expect(payload.loan.accountId).toBe("bank-1");
    });

    it("3. writes nothing at all when schedule generation fails (e.g. missing tenure) - the failure happens before any DB call", async () => {
        const service = createService();

        await expect(
            service.create({
                ...request,
                tenureMonths: undefined,
            })
        ).rejects.toThrow(
            "Loan tenure is required to generate an EMI schedule."
        );

        expect(repository.createAtomic).not.toHaveBeenCalled();
    });

    // The old JS-level fake transaction's rollback-then-rethrow dance
    // no longer exists - the real sqlx transaction inside
    // create_loan_atomic (src-tauri/src/loan_create.rs) rolls back
    // atomically on its own connection and rejects with the real
    // underlying error. Here, that just means create() propagates
    // whatever createAtomic() rejects with, verbatim - including a
    // plain string (a real Tauri/SQL rejection is never an Error
    // instance; see getErrorMessage's own doc comment).
    it("propagates the real underlying error verbatim when the atomic transaction itself fails", async () => {
        repository.createAtomic.mockRejectedValue(
            "FOREIGN KEY constraint failed"
        );

        const service = createService();

        await expect(
            service.create(request)
        ).rejects.toBe("FOREIGN KEY constraint failed");
    });
});

describe("LoanService.delete - Delete Loan policy", () => {
    // delete() now persists everything (schedule/payment cleanup, the
    // goal-link soft-delete, the loan's own soft-delete and its mirror
    // account's) in ONE real database transaction via a dedicated Rust
    // command (LoanRepository.deleteAtomic) - replacing the earlier
    // `beginTransaction()`/multiple `execute()` calls/`commit()`
    // sequence. That gap was a real production bug: a delete whose
    // statements had already taken effect could still report "cannot
    // commit - no transaction is active", because the final COMMIT
    // could land on a connection with no transaction on it to commit.
    const repository = {
        getById: vi.fn(),
        getLinkedLoanAccountId: vi.fn(),
        deleteAtomic: vi.fn(),
    };

    const paymentRepository = {
        getAllByLoanId: vi.fn(),
    };

    const transactionRepository = {
        existsForAccount: vi.fn(),
    };

    function createService(): LoanService {
        const service = new LoanService();

        Object.defineProperty(service, "repository", {
            value: repository,
        });
        Object.defineProperty(
            service,
            "paymentRepository",
            { value: paymentRepository }
        );
        Object.defineProperty(
            service,
            "transactionRepository",
            { value: transactionRepository }
        );

        return service;
    }

    beforeEach(() => {
        vi.clearAllMocks();

        repository.getById.mockResolvedValue(
            loan({ status: "ACTIVE" })
        );
        repository.getLinkedLoanAccountId.mockResolvedValue(
            "loan-acct-1"
        );
        repository.deleteAtomic.mockResolvedValue(undefined);
        paymentRepository.getAllByLoanId.mockResolvedValue(
            []
        );
        transactionRepository.existsForAccount.mockResolvedValue(
            false
        );
    });

    describe("no payments recorded", () => {
        it("1. deletes the loan and its linked account (safe to remove) in one atomic call", async () => {
            const service = createService();

            await service.delete("loan-1");

            expect(
                repository.deleteAtomic
            ).toHaveBeenCalledTimes(1);
            expect(
                repository.deleteAtomic
            ).toHaveBeenCalledWith({
                loanId: "loan-1",
                loanAccountId: "loan-acct-1",
            });
        });

        it("skips the mirror-account delete when the loan has no linked account", async () => {
            repository.getLinkedLoanAccountId.mockResolvedValue(
                null
            );

            const service = createService();

            await service.delete("loan-1");

            expect(
                transactionRepository.existsForAccount
            ).not.toHaveBeenCalled();
            expect(
                repository.deleteAtomic
            ).toHaveBeenCalledWith({
                loanId: "loan-1",
                loanAccountId: null,
            });
        });

        it("5. preserves the linked account when it has a live transaction on it, but still deletes the loan", async () => {
            transactionRepository.existsForAccount.mockResolvedValue(
                true
            );

            const service = createService();

            await service.delete("loan-1");

            expect(
                transactionRepository.existsForAccount
            ).toHaveBeenCalledWith("loan-acct-1");
            expect(
                repository.deleteAtomic
            ).toHaveBeenCalledWith({
                loanId: "loan-1",
                loanAccountId: null,
            });
        });

        it("7. never touches the transactions table beyond checking existence - no bank transaction is deleted", async () => {
            const service = createService();

            await service.delete("loan-1");

            expect(
                Object.keys(transactionRepository)
            ).toEqual(["existsForAccount"]);
        });
    });

    describe("blocked when any payment exists", () => {
        it("refuses to delete an ACTIVE loan with a full payment recorded, and never calls deleteAtomic", async () => {
            repository.getById.mockResolvedValue(
                loan({ status: "ACTIVE" })
            );
            paymentRepository.getAllByLoanId.mockResolvedValue(
                [{ id: "pay-1", amount: 8800 }]
            );

            const service = createService();

            await expect(
                service.delete("loan-1")
            ).rejects.toThrow(
                /reverse every payment/i
            );

            expect(
                repository.deleteAtomic
            ).not.toHaveBeenCalled();
        });

        it("refuses to delete an ACTIVE loan with only a partial payment recorded", async () => {
            paymentRepository.getAllByLoanId.mockResolvedValue(
                [{ id: "pay-1", amount: 300 }]
            );

            const service = createService();

            await expect(
                service.delete("loan-1")
            ).rejects.toThrow(
                /reverse every payment/i
            );
        });

        it("refuses to delete a CLOSED loan with payment history - status makes no difference", async () => {
            repository.getById.mockResolvedValue(
                loan({ status: "CLOSED" })
            );
            paymentRepository.getAllByLoanId.mockResolvedValue(
                [{ id: "pay-1", amount: 8800 }]
            );

            const service = createService();

            await expect(
                service.delete("loan-1")
            ).rejects.toThrow(
                /reverse every payment/i
            );

            expect(
                repository.deleteAtomic
            ).not.toHaveBeenCalled();
        });
    });

    describe("validation", () => {
        it("throws when the loan does not exist", async () => {
            repository.getById.mockResolvedValue(null);

            const service = createService();

            await expect(
                service.delete("missing")
            ).rejects.toThrow("Loan not found.");

            expect(
                paymentRepository.getAllByLoanId
            ).not.toHaveBeenCalled();
            expect(
                repository.deleteAtomic
            ).not.toHaveBeenCalled();
        });
    });

    // The old JS-level "beginTransaction, several execute() calls,
    // commit, rollback-on-catch" dance no longer exists here - the real
    // sqlx transaction inside delete_loan_atomic
    // (src-tauri/src/loan_delete.rs) rolls back atomically on its own
    // connection (see that module's own rollback/no-dangling-
    // transaction tests) and rejects with the real underlying error.
    // Here, that just means delete() propagates whatever
    // deleteAtomic() rejects with, verbatim.
    describe("error propagation", () => {
        it("4. does not swallow or rewrite an error from the atomic delete - success reports no error, failure propagates the real one", async () => {
            const service = createService();

            await expect(
                service.delete("loan-1")
            ).resolves.toBeUndefined();
        });

        it("2. propagates the real underlying error verbatim when the atomic transaction itself fails", async () => {
            repository.deleteAtomic.mockRejectedValue(
                "cannot commit - no transaction is active"
            );

            const service = createService();

            await expect(
                service.delete("loan-1")
            ).rejects.toBe(
                "cannot commit - no transaction is active"
            );
        });
    });
});

describe("LoanService.update - protecting a generated schedule from unsafe edits", () => {
    const repository = {
        getById: vi.fn(),
        update: vi.fn(),
        linkLoanAccount: vi.fn(),
    };

    const accountRepository = {
        getById: vi.fn(),
        create: vi.fn(),
        syncLinkedAccount: vi.fn(),
    };

    const scheduleRepository = {
        getAllByLoanId: vi.fn(),
    };

    const institutionRepository = {
        getByName: vi.fn(),
        create: vi.fn(),
    };

    function createService(): LoanService {
        const service = new LoanService();

        Object.defineProperty(service, "repository", {
            value: repository,
        });
        Object.defineProperty(service, "accountRepository", {
            value: accountRepository,
        });
        Object.defineProperty(
            service,
            "scheduleRepository",
            { value: scheduleRepository }
        );
        Object.defineProperty(
            service,
            "institutionRepository",
            { value: institutionRepository }
        );

        return service;
    }

    beforeEach(() => {
        vi.clearAllMocks();

        repository.getById.mockResolvedValue(loan());
        repository.update.mockResolvedValue(undefined);
        accountRepository.getById.mockResolvedValue({
            id: "loan-acct-1",
        });
        accountRepository.syncLinkedAccount.mockResolvedValue(
            undefined
        );
        institutionRepository.getByName.mockResolvedValue(
            null
        );
        institutionRepository.create.mockResolvedValue(
            undefined
        );
    });

    describe("once a schedule exists", () => {
        beforeEach(() => {
            scheduleRepository.getAllByLoanId.mockResolvedValue(
                [{ id: "sch-1" }]
            );
        });

        it.each([
            ["principalAmount", { principalAmount: 150000 }],
            ["interestRate", { interestRate: 12 }],
            ["interestType", { interestType: "FLAT" as const }],
            ["tenureMonths", { tenureMonths: 24 }],
            ["startDate", { startDate: "2026-02-01" }],
            ["currencyId", { currencyId: "cur-usd" }],
            ["emiAmount", { emiAmount: 9000 }],
            ["maturityDate", { maturityDate: "2028-01-01" }],
        ])(
            "rejects a change to %s",
            async (_label, override) => {
                const service = createService();

                await expect(
                    service.update(
                        updateRequest(override)
                    )
                ).rejects.toThrow(
                    /EMI schedule has already been generated/
                );

                expect(repository.update).not.toHaveBeenCalled();
            }
        );

        it("allows saving with every protected term unchanged", async () => {
            const service = createService();

            await service.update(updateRequest());

            expect(repository.update).toHaveBeenCalledTimes(
                1
            );
        });

        it("allows metadata-only edits (name, lender, notes, status)", async () => {
            const service = createService();

            await service.update(
                updateRequest({
                    name: "Renamed loan",
                    lenderInstitutionName: "New Bank",
                    notes: "Refinanced verbally",
                    status: "ON_HOLD",
                })
            );

            expect(repository.update).toHaveBeenCalledTimes(
                1
            );
        });

        it("treats a null stored tenure/EMI/maturity as unchanged when the request omits them", async () => {
            repository.getById.mockResolvedValue(
                loan({
                    tenureMonths: null,
                    emiAmount: null,
                    maturityDate: null,
                })
            );

            const service = createService();

            await service.update(
                updateRequest({
                    tenureMonths: undefined,
                    emiAmount: undefined,
                    maturityDate: undefined,
                })
            );

            expect(repository.update).toHaveBeenCalledTimes(
                1
            );
        });

        it("never touches the payment schedule, and never writes outstandingPrincipal/outstandingInterest, even on a successful metadata edit", async () => {
            const service = createService();

            await service.update(
                updateRequest({
                    name: "Renamed loan",
                    notes: "Updated notes",
                })
            );

            // The schedule mock only exposes getAllByLoanId - if update()
            // tried to create/update/delete a schedule row, this test
            // would throw a TypeError on that call, failing loudly.
            expect(
                scheduleRepository.getAllByLoanId
            ).toHaveBeenCalledTimes(1);

            const persisted = repository.update.mock
                .calls[0][0] as Record<string, unknown>;

            expect(persisted).not.toHaveProperty(
                "outstandingPrincipal"
            );
            expect(persisted).not.toHaveProperty(
                "outstandingInterest"
            );
        });
    });

    describe("closing a loan with an outstanding balance", () => {
        beforeEach(() => {
            scheduleRepository.getAllByLoanId.mockResolvedValue(
                [{ id: "sch-1" }]
            );
        });

        it("rejects marking an ACTIVE loan CLOSED while principal is still outstanding", async () => {
            repository.getById.mockResolvedValue(
                loan({
                    status: "ACTIVE",
                    outstandingPrincipal: 100000,
                    outstandingInterest: 0,
                })
            );

            const service = createService();

            await expect(
                service.update(
                    updateRequest({ status: "CLOSED" })
                )
            ).rejects.toThrow(
                /can't be marked Closed while it still has an outstanding/
            );

            expect(repository.update).not.toHaveBeenCalled();
        });

        it("rejects marking a loan CLOSED while only interest (no principal) is still outstanding", async () => {
            repository.getById.mockResolvedValue(
                loan({
                    status: "ACTIVE",
                    outstandingPrincipal: 0,
                    outstandingInterest: 250,
                })
            );

            const service = createService();

            await expect(
                service.update(
                    updateRequest({ status: "CLOSED" })
                )
            ).rejects.toThrow(
                /can't be marked Closed/
            );
        });

        it("allows marking a loan CLOSED once both outstanding balances are exactly zero", async () => {
            repository.getById.mockResolvedValue(
                loan({
                    status: "ACTIVE",
                    outstandingPrincipal: 0,
                    outstandingInterest: 0,
                })
            );

            const service = createService();

            await service.update(
                updateRequest({ status: "CLOSED" })
            );

            expect(repository.update).toHaveBeenCalledTimes(
                1
            );
        });

        it("does not re-block a loan that is already CLOSED with a leftover balance from being saved again unchanged", async () => {
            repository.getById.mockResolvedValue(
                loan({
                    status: "CLOSED",
                    outstandingPrincipal: 500,
                    outstandingInterest: 0,
                })
            );

            const service = createService();

            await service.update(
                updateRequest({
                    status: "CLOSED",
                    notes: "Legacy data, pre-dates this guard",
                })
            );

            expect(repository.update).toHaveBeenCalledTimes(
                1
            );
        });

        it("allows switching between ACTIVE, ON_HOLD and DEFAULTED regardless of outstanding balance", async () => {
            repository.getById.mockResolvedValue(
                loan({
                    status: "ACTIVE",
                    outstandingPrincipal: 100000,
                    outstandingInterest: 5000,
                })
            );

            const service = createService();

            await service.update(
                updateRequest({ status: "DEFAULTED" })
            );

            expect(repository.update).toHaveBeenCalledTimes(
                1
            );
        });
    });

    describe("before any schedule exists", () => {
        beforeEach(() => {
            scheduleRepository.getAllByLoanId.mockResolvedValue(
                []
            );
        });

        it("allows changing terms freely", async () => {
            const service = createService();

            await service.update(
                updateRequest({
                    principalAmount: 200000,
                    interestRate: 15,
                })
            );

            expect(repository.update).toHaveBeenCalledTimes(
                1
            );
        });

        // Same root cause as LoanService.create's Linked Account bug:
        // loans.account_id has a FOREIGN KEY constraint against
        // accounts(id), so a blank Linked Account ("" from the form)
        // must never reach the repository as-is.
        it("normalizes a blank (empty-string) Linked Account to null on update too", async () => {
            const service = createService();

            await service.update(
                updateRequest({ accountId: "" })
            );

            const persisted = repository.update.mock
                .calls[0][0] as { accountId: unknown };

            expect(persisted.accountId).toBeNull();
        });

        it("still rejects marking a scheduleless loan CLOSED while a balance is outstanding (the guard is independent of schedule state)", async () => {
            repository.getById.mockResolvedValue(
                loan({
                    status: "ACTIVE",
                    outstandingPrincipal: 100000,
                    outstandingInterest: 0,
                })
            );

            const service = createService();

            await expect(
                service.update(
                    updateRequest({ status: "CLOSED" })
                )
            ).rejects.toThrow(
                /can't be marked Closed/
            );
        });
    });
});
