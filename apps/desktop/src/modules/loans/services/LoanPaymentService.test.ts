import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoanPaymentService } from "./LoanPaymentService";
import { LoanPaymentStatus } from "../types/LoanPaymentStatus";
import type {
    Loan,
    LoanPaymentSchedule,
    LoanSchedulePayment,
} from "../types";

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
        maturityDate: null,
        outstandingPrincipal: 8000,
        outstandingInterest: 800,
        paidInstallments: 0,
        currencyId: "cur-inr",
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function scheduleRow(
    overrides: Partial<LoanPaymentSchedule> = {}
): LoanPaymentSchedule {
    return {
        id: "sch-1",
        loanId: "loan-1",
        installmentNumber: 1,
        dueDate: "2026-02-01",
        principalAmount: 8000,
        interestAmount: 800,
        totalAmount: 8800,
        outstandingPrincipal: 0,
        status: LoanPaymentStatus.UPCOMING,
        paidDate: null,
        paidAmount: null,
        transactionId: null,
        ...overrides,
    };
}

function priorPayment(
    overrides: Partial<LoanSchedulePayment> = {}
): LoanSchedulePayment {
    return {
        id: "pay-existing",
        loanId: "loan-1",
        scheduleId: "sch-1",
        transactionId: "txn-existing",
        paymentDate: "2026-02-01",
        amount: 0,
        principalAmount: 0,
        interestAmount: 0,
        createdAt: "2026-02-01T00:00:00.000Z",
        ...overrides,
    };
}

describe("LoanPaymentService.processPayment", () => {
    const loanRepository = {
        getById: vi.fn(),
        beginTransaction: vi.fn(),
        commit: vi.fn(),
        rollback: vi.fn(),
        updateAccountingBalances: vi.fn(),
    };

    const scheduleRepository = {
        getById: vi.fn(),
        update: vi.fn(),
    };

    const paymentRepository = {
        getAllByScheduleId: vi.fn(),
        create: vi.fn(),
    };

    const transactionService = {
        create: vi.fn(),
        prepareCreate: vi.fn(),
    };

    // The one atomic write (src-tauri loan_payment.rs). Its default mock
    // replays the request into the repository mocks the assertions below
    // inspect, so they check exactly what is sent to the atomic write.
    const atomicWriter = {
        recordPayment: vi.fn(),
        reversePayment: vi.fn(),
    };

    function createService(): LoanPaymentService {
        const service = new LoanPaymentService();

        Object.defineProperty(service, "loanRepository", {
            value: loanRepository,
        });
        Object.defineProperty(
            service,
            "scheduleRepository",
            { value: scheduleRepository }
        );
        Object.defineProperty(
            service,
            "paymentRepository",
            { value: paymentRepository }
        );
        Object.defineProperty(
            service,
            "transactionService",
            { value: transactionService }
        );
        Object.defineProperty(
            service,
            "atomicWriter",
            { value: atomicWriter }
        );

        return service;
    }

    const baseRequest = {
        loanId: "loan-1",
        scheduleId: "sch-1",
        paymentDate: "2026-02-01",
    };

    beforeEach(() => {
        vi.clearAllMocks();

        loanRepository.getById.mockResolvedValue(loan());
        loanRepository.beginTransaction.mockResolvedValue(
            undefined
        );
        loanRepository.commit.mockResolvedValue(undefined);
        loanRepository.rollback.mockResolvedValue(undefined);
        loanRepository.updateAccountingBalances.mockResolvedValue(
            undefined
        );
        scheduleRepository.getById.mockResolvedValue(
            scheduleRow()
        );
        scheduleRepository.update.mockResolvedValue(
            undefined
        );
        paymentRepository.getAllByScheduleId.mockResolvedValue(
            []
        );
        paymentRepository.create.mockResolvedValue(
            undefined
        );
        transactionService.create.mockResolvedValue(
            "txn-1"
        );
        // prepareCreate builds the row create() would insert; its id
        // comes from the create mock so the existing assertions hold.
        transactionService.prepareCreate.mockImplementation(
            async (request: Record<string, unknown>) => ({
                ...request,
                id: await transactionService.create(request),
            })
        );
        atomicWriter.recordPayment.mockImplementation(
            async (request: {
                payment: Record<string, unknown>;
                schedule: Record<string, unknown>;
                loan: { id: string; outstandingPrincipal: number; outstandingInterest: number; status: string };
            }) => {
                await paymentRepository.create(request.payment);
                await scheduleRepository.update(request.schedule);
                await loanRepository.updateAccountingBalances(
                    request.loan.id,
                    request.loan.outstandingPrincipal,
                    request.loan.outstandingInterest,
                    request.loan.status
                );
            }
        );
    });

    describe("full-EMI payment on a fresh row (existing behaviour, unchanged)", () => {
        it("pays the full scheduled amount when no amount is given", async () => {
            const service = createService();

            const result = await service.processPayment(
                baseRequest
            );

            expect(
                transactionService.create
            ).toHaveBeenCalledWith(
                expect.objectContaining({ amount: 8800 })
            );
            expect(result.principalPaid).toBe(8000);
            expect(result.interestPaid).toBe(800);
            expect(result.amountPaid).toBe(8800);
            expect(result.schedule.status).toBe(
                LoanPaymentStatus.PAID
            );
            expect(result.schedule.paidAmount).toBe(8800);
            expect(result.schedule.transactionId).toBe(
                "txn-1"
            );
            expect(result.loan.outstandingPrincipal).toBe(
                0
            );
            expect(result.loan.outstandingInterest).toBe(
                0
            );
            expect(result.loan.status).toBe("CLOSED");
        });

        it("records a loan_schedule_payments row for the payment", async () => {
            const service = createService();

            await service.processPayment(baseRequest);

            expect(
                paymentRepository.create
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    loanId: "loan-1",
                    scheduleId: "sch-1",
                    transactionId: "txn-1",
                    amount: 8800,
                    principalAmount: 8000,
                    interestAmount: 800,
                })
            );
        });

        it("does not close the loan when outstanding balances remain after a full payment", async () => {
            loanRepository.getById.mockResolvedValue(
                loan({
                    outstandingPrincipal: 50000,
                    outstandingInterest: 4000,
                })
            );

            const service = createService();

            const result = await service.processPayment(
                baseRequest
            );

            expect(result.loan.status).toBe("ACTIVE");
            expect(
                result.loan.outstandingPrincipal
            ).toBe(42000);
            expect(
                result.loan.outstandingInterest
            ).toBe(3200);
        });
    });

    describe("first partial payment", () => {
        it("allocates a partial payment to interest first, then principal, and marks the row PARTIAL", async () => {
            loanRepository.getById.mockResolvedValue(
                loan({
                    outstandingPrincipal: 50000,
                    outstandingInterest: 4000,
                })
            );

            const service = createService();

            const result = await service.processPayment({
                ...baseRequest,
                amount: 1000,
            });

            // interest (800) fully covered, 200 toward principal.
            expect(result.interestPaid).toBe(800);
            expect(result.principalPaid).toBe(200);
            expect(result.amountPaid).toBe(1000);
            expect(result.schedule.status).toBe(
                LoanPaymentStatus.PARTIAL
            );
            expect(result.schedule.paidAmount).toBe(1000);
            expect(
                result.loan.outstandingPrincipal
            ).toBe(49800);
            expect(
                result.loan.outstandingInterest
            ).toBe(3200);
            expect(result.loan.status).toBe("ACTIVE");
        });

        it("allocates a payment smaller than the interest amount entirely to interest", async () => {
            const service = createService();

            const result = await service.processPayment({
                ...baseRequest,
                amount: 300,
            });

            expect(result.interestPaid).toBe(300);
            expect(result.principalPaid).toBe(0);
        });

        it("sets the schedule's transaction link on the first payment", async () => {
            const service = createService();

            const result = await service.processPayment({
                ...baseRequest,
                amount: 300,
            });

            expect(result.schedule.transactionId).toBe(
                "txn-1"
            );
        });
    });

    describe("completing a partial payment", () => {
        beforeEach(() => {
            // A first payment of 300 (all interest) already exists
            // against this row.
            paymentRepository.getAllByScheduleId.mockResolvedValue(
                [
                    priorPayment({
                        transactionId: "txn-first",
                        amount: 300,
                        principalAmount: 0,
                        interestAmount: 300,
                    }),
                ]
            );

            scheduleRepository.getById.mockResolvedValue(
                scheduleRow({
                    status: LoanPaymentStatus.PARTIAL,
                    paidAmount: 300,
                    paidDate: "2026-02-01",
                    transactionId: "txn-first",
                })
            );
        });

        it("pays exactly the remaining amount and marks the row PAID", async () => {
            const service = createService();

            const result = await service.processPayment({
                ...baseRequest,
                paymentDate: "2026-03-01",
                amount: 8500,
            });

            // Remaining interest (800 - 300 = 500) + all 8000
            // principal = 8500.
            expect(result.interestPaid).toBe(500);
            expect(result.principalPaid).toBe(8000);
            expect(result.schedule.status).toBe(
                LoanPaymentStatus.PAID
            );
            // Cumulative: 300 (first) + 8500 (this) = 8800.
            expect(result.schedule.paidAmount).toBe(8800);
        });

        it("does NOT overwrite the original transaction link with the completing payment's transaction", async () => {
            const service = createService();

            const result = await service.processPayment({
                ...baseRequest,
                paymentDate: "2026-03-01",
                amount: 8500,
            });

            expect(result.schedule.transactionId).toBe(
                "txn-first"
            );
            expect(result.schedule.transactionId).not.toBe(
                "txn-1"
            );
        });

        it("creates a NEW, separate loan_schedule_payments row rather than rewriting the first one", async () => {
            const service = createService();

            await service.processPayment({
                ...baseRequest,
                paymentDate: "2026-03-01",
                amount: 8500,
            });

            expect(
                paymentRepository.create
            ).toHaveBeenCalledTimes(1);
            expect(
                paymentRepository.create
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    transactionId: "txn-1",
                    amount: 8500,
                    principalAmount: 8000,
                    interestAmount: 500,
                })
            );
        });

        it("updates outstanding balances only by the newly allocated amount, not the cumulative total", async () => {
            loanRepository.getById.mockResolvedValue(
                loan({
                    outstandingPrincipal: 8000,
                    outstandingInterest: 500,
                })
            );

            const service = createService();

            const result = await service.processPayment({
                ...baseRequest,
                paymentDate: "2026-03-01",
                amount: 8500,
            });

            expect(
                result.loan.outstandingPrincipal
            ).toBe(0);
            expect(
                result.loan.outstandingInterest
            ).toBe(0);
            expect(result.loan.status).toBe("CLOSED");
        });

        it("rejects a completing payment larger than the remaining amount", async () => {
            const service = createService();

            await expect(
                service.processPayment({
                    ...baseRequest,
                    amount: 9000,
                })
            ).rejects.toThrow(
                /cannot exceed the remaining scheduled amount/
            );

            expect(
                atomicWriter.recordPayment
            ).not.toHaveBeenCalled();
        });

        it("allows a second partial top-up that still leaves the row PARTIAL (multiple partial payments)", async () => {
            const service = createService();

            const result = await service.processPayment({
                ...baseRequest,
                paymentDate: "2026-03-01",
                amount: 4000,
            });

            expect(result.schedule.status).toBe(
                LoanPaymentStatus.PARTIAL
            );
            // 300 (first) + 4000 (this) = 4300 cumulative.
            expect(result.schedule.paidAmount).toBe(4300);
            // Remaining interest after first payment = 500; this
            // payment of 4000 fully covers it, remainder (3500) to
            // principal.
            expect(result.interestPaid).toBe(500);
            expect(result.principalPaid).toBe(3500);
        });
    });

    describe("total paid never exceeds the scheduled amount", () => {
        it("rejects a fresh payment above the full scheduled amount (overpayment)", async () => {
            const service = createService();

            await expect(
                service.processPayment({
                    ...baseRequest,
                    amount: 9000,
                })
            ).rejects.toThrow(
                /cannot exceed the remaining scheduled amount/
            );
        });

        it("computes remaining from the payment ledger, not the schedule row's own cached paidAmount", async () => {
            // Schedule row's cache says 0 paid, but the ledger says
            // 8000 has already been recorded - the ledger wins.
            scheduleRepository.getById.mockResolvedValue(
                scheduleRow({
                    status: LoanPaymentStatus.PARTIAL,
                    paidAmount: 0,
                })
            );
            paymentRepository.getAllByScheduleId.mockResolvedValue(
                [priorPayment({ amount: 8000 })]
            );

            const service = createService();

            await expect(
                service.processPayment({
                    ...baseRequest,
                    amount: 900,
                })
            ).rejects.toThrow(
                /cannot exceed the remaining scheduled amount/
            );
        });

        it("rejects any payment against a row already fully paid off by the ledger, even if its status is stale", async () => {
            scheduleRepository.getById.mockResolvedValue(
                scheduleRow({
                    status: LoanPaymentStatus.PARTIAL,
                })
            );
            paymentRepository.getAllByScheduleId.mockResolvedValue(
                [priorPayment({ amount: 8800 })]
            );

            const service = createService();

            await expect(
                service.processPayment(baseRequest)
            ).rejects.toThrow(/already been paid/);
        });
    });

    describe("validation", () => {
        it("rejects a zero payment amount", async () => {
            const service = createService();

            await expect(
                service.processPayment({
                    ...baseRequest,
                    amount: 0,
                })
            ).rejects.toThrow(/greater than zero/);

            expect(
                atomicWriter.recordPayment
            ).not.toHaveBeenCalled();
        });

        it("rejects a negative payment amount", async () => {
            const service = createService();

            await expect(
                service.processPayment({
                    ...baseRequest,
                    amount: -50,
                })
            ).rejects.toThrow(/greater than zero/);
        });

        it("rejects a payment against an already-PAID schedule row", async () => {
            scheduleRepository.getById.mockResolvedValue(
                scheduleRow({
                    status: LoanPaymentStatus.PAID,
                })
            );

            const service = createService();

            await expect(
                service.processPayment(baseRequest)
            ).rejects.toThrow(/already been paid/);

            expect(
                paymentRepository.getAllByScheduleId
            ).not.toHaveBeenCalled();
        });

        it("rejects a payment against a CLOSED loan", async () => {
            loanRepository.getById.mockResolvedValue(
                loan({ status: "CLOSED" })
            );

            const service = createService();

            await expect(
                service.processPayment(baseRequest)
            ).rejects.toThrow(/loan is closed/i);

            expect(
                atomicWriter.recordPayment
            ).not.toHaveBeenCalled();
        });
    });

    describe("atomic write safety (no JS-managed transaction)", () => {
        function expectNoJsManagedTransaction() {
            expect(loanRepository.beginTransaction).not.toHaveBeenCalled();
            expect(loanRepository.commit).not.toHaveBeenCalled();
            expect(loanRepository.rollback).not.toHaveBeenCalled();
        }

        it("rethrows when building the transaction row fails, and writes nothing", async () => {
            transactionService.create.mockRejectedValue(
                new Error("Transaction write failed.")
            );

            const service = createService();

            await expect(
                service.processPayment(baseRequest)
            ).rejects.toThrow(
                "Transaction write failed."
            );

            expect(
                atomicWriter.recordPayment
            ).not.toHaveBeenCalled();
            expectNoJsManagedTransaction();
        });

        it("rethrows the original error when the atomic write fails (nothing is committed)", async () => {
            paymentRepository.create.mockRejectedValue(
                new Error("Payment ledger write failed.")
            );

            const service = createService();

            await expect(
                service.processPayment(baseRequest)
            ).rejects.toThrow(
                "Payment ledger write failed."
            );

            expect(
                atomicWriter.recordPayment
            ).toHaveBeenCalledTimes(1);
            expectNoJsManagedTransaction();
        });

        it("sends the transaction, ledger row, schedule and loan balances as ONE write", async () => {
            const service = createService();

            await service.processPayment(baseRequest);

            expect(
                atomicWriter.recordPayment
            ).toHaveBeenCalledTimes(1);
            expect(
                transactionService.prepareCreate
            ).toHaveBeenCalledTimes(1);
            expectNoJsManagedTransaction();
        });

        it("propagates a refusal from the atomic write (e.g. a repeated submission) unchanged", async () => {
            atomicWriter.recordPayment.mockRejectedValue(
                new Error("This payment was not recorded: only 0.00 remains on this installment (it may already have been paid).")
            );

            const service = createService();

            await expect(
                service.processPayment(baseRequest)
            ).rejects.toThrow(/may already have been paid/);
            expectNoJsManagedTransaction();
        });
    });
});

describe("LoanPaymentService.reversePayment", () => {
    const loanRepository = {
        getById: vi.fn(),
        beginTransaction: vi.fn(),
        commit: vi.fn(),
        rollback: vi.fn(),
        updateAccountingBalances: vi.fn(),
    };

    const scheduleRepository = {
        getById: vi.fn(),
        update: vi.fn(),
    };

    const paymentRepository = {
        getById: vi.fn(),
        delete: vi.fn(),
        getAllByScheduleId: vi.fn(),
    };

    const transactionRepository = {
        getById: vi.fn(),
        delete: vi.fn(),
    };

    // See processPayment's atomicWriter: replays the request into the
    // repository mocks the assertions below inspect.
    const atomicWriter = {
        recordPayment: vi.fn(),
        reversePayment: vi.fn(),
    };

    function createService(): LoanPaymentService {
        const service = new LoanPaymentService();

        Object.defineProperty(service, "loanRepository", {
            value: loanRepository,
        });
        Object.defineProperty(
            service,
            "scheduleRepository",
            { value: scheduleRepository }
        );
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
        Object.defineProperty(
            service,
            "atomicWriter",
            { value: atomicWriter }
        );

        return service;
    }

    beforeEach(() => {
        vi.clearAllMocks();

        loanRepository.getById.mockResolvedValue(
            loan({
                outstandingPrincipal: 0,
                outstandingInterest: 0,
                status: "CLOSED",
            })
        );
        loanRepository.beginTransaction.mockResolvedValue(
            undefined
        );
        loanRepository.commit.mockResolvedValue(undefined);
        loanRepository.rollback.mockResolvedValue(
            undefined
        );
        loanRepository.updateAccountingBalances.mockResolvedValue(
            undefined
        );
        scheduleRepository.getById.mockResolvedValue(
            scheduleRow({
                status: LoanPaymentStatus.PAID,
                paidAmount: 8800,
                paidDate: "2026-02-01",
                transactionId: "txn-1",
            })
        );
        scheduleRepository.update.mockResolvedValue(
            undefined
        );
        paymentRepository.delete.mockResolvedValue(
            undefined
        );
        transactionRepository.getById.mockResolvedValue({
            id: "txn-1",
        });
        transactionRepository.delete.mockResolvedValue(
            undefined
        );
        atomicWriter.reversePayment.mockImplementation(
            async (request: {
                paymentId: string;
                transactionId: string | null;
                schedule: Record<string, unknown>;
                loan: { id: string; outstandingPrincipal: number; outstandingInterest: number; status: string };
            }) => {
                if (request.transactionId) {
                    await transactionRepository.delete(request.transactionId);
                }
                await paymentRepository.delete(request.paymentId);
                await scheduleRepository.update(request.schedule);
                await loanRepository.updateAccountingBalances(
                    request.loan.id,
                    request.loan.outstandingPrincipal,
                    request.loan.outstandingInterest,
                    request.loan.status
                );
            }
        );
    });

    describe("reversing the only payment on a row", () => {
        it("reverses a sole full payment: schedule reverts to UPCOMING, transaction soft-deleted, loan reopened", async () => {
            paymentRepository.getById.mockResolvedValue(
                priorPayment({
                    id: "pay-1",
                    transactionId: "txn-1",
                    amount: 8800,
                    principalAmount: 8000,
                    interestAmount: 800,
                })
            );
            paymentRepository.getAllByScheduleId.mockResolvedValue(
                []
            );

            const service = createService();
            const result = await service.reversePayment(
                "pay-1"
            );

            expect(
                transactionRepository.delete
            ).toHaveBeenCalledWith("txn-1");
            expect(
                paymentRepository.delete
            ).toHaveBeenCalledWith("pay-1");

            expect(result.schedule.status).toBe(
                LoanPaymentStatus.UPCOMING
            );
            expect(result.schedule.paidAmount).toBeNull();
            expect(result.schedule.paidDate).toBeNull();
            expect(
                result.schedule.transactionId
            ).toBeNull();

            expect(result.loan.outstandingPrincipal).toBe(
                8000
            );
            expect(result.loan.outstandingInterest).toBe(
                800
            );
            expect(result.loan.status).toBe("ACTIVE");

            expect(
                loanRepository.updateAccountingBalances
            ).toHaveBeenCalledWith(
                "loan-1",
                8000,
                800,
                "ACTIVE"
            );
            expect(
                atomicWriter.reversePayment
            ).toHaveBeenCalledTimes(1);
        });

        it("reverses a sole partial payment: schedule reverts to UPCOMING", async () => {
            loanRepository.getById.mockResolvedValue(
                loan({
                    outstandingPrincipal: 8000,
                    outstandingInterest: 500,
                    status: "ACTIVE",
                })
            );
            scheduleRepository.getById.mockResolvedValue(
                scheduleRow({
                    status: LoanPaymentStatus.PARTIAL,
                    paidAmount: 300,
                    paidDate: "2026-02-01",
                    transactionId: "txn-1",
                })
            );
            paymentRepository.getById.mockResolvedValue(
                priorPayment({
                    id: "pay-1",
                    transactionId: "txn-1",
                    amount: 300,
                    principalAmount: 0,
                    interestAmount: 300,
                })
            );
            paymentRepository.getAllByScheduleId.mockResolvedValue(
                []
            );

            const service = createService();
            const result = await service.reversePayment(
                "pay-1"
            );

            expect(result.schedule.status).toBe(
                LoanPaymentStatus.UPCOMING
            );
            expect(result.loan.outstandingPrincipal).toBe(
                8000
            );
            expect(result.loan.outstandingInterest).toBe(
                800
            );
            // Was already ACTIVE - reversal must not touch status.
            expect(result.loan.status).toBe("ACTIVE");
        });
    });

    describe("reversing one of several payments", () => {
        it("reversing the completing (second) payment leaves the row PARTIAL, keeping the first payment's transaction link", async () => {
            loanRepository.getById.mockResolvedValue(
                loan({
                    outstandingPrincipal: 0,
                    outstandingInterest: 0,
                    status: "CLOSED",
                })
            );
            scheduleRepository.getById.mockResolvedValue(
                scheduleRow({
                    status: LoanPaymentStatus.PAID,
                    paidAmount: 8800,
                    paidDate: "2026-03-01",
                    // Never overwritten past the first payment
                    // (Loans Phase 4) - still points at pay-1.
                    transactionId: "txn-1",
                })
            );
            paymentRepository.getById.mockResolvedValue(
                priorPayment({
                    id: "pay-2",
                    transactionId: "txn-2",
                    paymentDate: "2026-03-01",
                    amount: 8500,
                    principalAmount: 8000,
                    interestAmount: 500,
                    createdAt:
                        "2026-03-01T00:00:00.000Z",
                })
            );
            paymentRepository.getAllByScheduleId.mockResolvedValue(
                [
                    priorPayment({
                        id: "pay-1",
                        transactionId: "txn-1",
                        paymentDate: "2026-02-01",
                        amount: 300,
                        principalAmount: 0,
                        interestAmount: 300,
                        createdAt:
                            "2026-02-01T00:00:00.000Z",
                    }),
                ]
            );
            transactionRepository.getById.mockResolvedValue(
                { id: "txn-2" }
            );

            const service = createService();
            const result = await service.reversePayment(
                "pay-2"
            );

            expect(
                transactionRepository.delete
            ).toHaveBeenCalledWith("txn-2");
            expect(result.schedule.status).toBe(
                LoanPaymentStatus.PARTIAL
            );
            expect(result.schedule.paidAmount).toBe(300);
            expect(result.schedule.paidDate).toBe(
                "2026-02-01"
            );
            expect(
                result.schedule.transactionId
            ).toBe("txn-1");

            // Restored using pay-2's own allocation only.
            expect(result.loan.outstandingPrincipal).toBe(
                8000
            );
            expect(result.loan.outstandingInterest).toBe(
                500
            );
            expect(result.loan.status).toBe("ACTIVE");
        });

        it("reversing the first payment recomputes the schedule's transaction link to the surviving (second) payment", async () => {
            loanRepository.getById.mockResolvedValue(
                loan({
                    outstandingPrincipal: 0,
                    outstandingInterest: 0,
                    status: "CLOSED",
                })
            );
            scheduleRepository.getById.mockResolvedValue(
                scheduleRow({
                    status: LoanPaymentStatus.PAID,
                    paidAmount: 8800,
                    paidDate: "2026-03-01",
                    transactionId: "txn-1",
                })
            );
            paymentRepository.getById.mockResolvedValue(
                priorPayment({
                    id: "pay-1",
                    transactionId: "txn-1",
                    paymentDate: "2026-02-01",
                    amount: 300,
                    principalAmount: 0,
                    interestAmount: 300,
                })
            );
            paymentRepository.getAllByScheduleId.mockResolvedValue(
                [
                    priorPayment({
                        id: "pay-2",
                        transactionId: "txn-2",
                        paymentDate: "2026-03-01",
                        amount: 8500,
                        principalAmount: 8000,
                        interestAmount: 500,
                        createdAt:
                            "2026-03-01T00:00:00.000Z",
                    }),
                ]
            );

            const service = createService();
            const result = await service.reversePayment(
                "pay-1"
            );

            // 8500 of 8800 remains - PARTIAL, not PAID, even though
            // the surviving payment was originally the "completing"
            // one.
            expect(result.schedule.status).toBe(
                LoanPaymentStatus.PARTIAL
            );
            expect(result.schedule.paidAmount).toBe(8500);
            expect(result.schedule.paidDate).toBe(
                "2026-03-01"
            );
            expect(
                result.schedule.transactionId
            ).toBe("txn-2");

            // Restored using pay-1's own allocation only (300
            // interest, 0 principal) - not pay-2's.
            expect(result.loan.outstandingPrincipal).toBe(
                0
            );
            expect(result.loan.outstandingInterest).toBe(
                300
            );
        });

        it("reversing a middle payment out of three recomputes correctly from the two survivors", async () => {
            loanRepository.getById.mockResolvedValue(
                loan({
                    outstandingPrincipal: 0,
                    outstandingInterest: 0,
                    status: "CLOSED",
                })
            );
            scheduleRepository.getById.mockResolvedValue(
                scheduleRow({
                    totalAmount: 900,
                    principalAmount: 600,
                    interestAmount: 300,
                    status: LoanPaymentStatus.PAID,
                    paidAmount: 900,
                    paidDate: "2026-04-01",
                    transactionId: "txn-a",
                })
            );
            paymentRepository.getById.mockResolvedValue(
                priorPayment({
                    id: "pay-b",
                    transactionId: "txn-b",
                    paymentDate: "2026-03-01",
                    amount: 300,
                    principalAmount: 300,
                    interestAmount: 0,
                })
            );
            paymentRepository.getAllByScheduleId.mockResolvedValue(
                [
                    priorPayment({
                        id: "pay-a",
                        transactionId: "txn-a",
                        paymentDate: "2026-02-01",
                        amount: 300,
                        principalAmount: 0,
                        interestAmount: 300,
                        createdAt:
                            "2026-02-01T00:00:00.000Z",
                    }),
                    priorPayment({
                        id: "pay-c",
                        transactionId: "txn-c",
                        paymentDate: "2026-04-01",
                        amount: 300,
                        principalAmount: 300,
                        interestAmount: 0,
                        createdAt:
                            "2026-04-01T00:00:00.000Z",
                    }),
                ]
            );

            const service = createService();
            const result = await service.reversePayment(
                "pay-b"
            );

            expect(result.schedule.status).toBe(
                LoanPaymentStatus.PARTIAL
            );
            expect(result.schedule.paidAmount).toBe(600);
            expect(result.schedule.transactionId).toBe(
                "txn-a"
            );
            expect(result.loan.outstandingPrincipal).toBe(
                300
            );
            expect(result.loan.outstandingInterest).toBe(
                0
            );
        });
    });

    describe("already-missing linked transaction", () => {
        it("still corrects the loan side when the linked transaction is already gone", async () => {
            transactionRepository.getById.mockResolvedValue(
                null
            );
            paymentRepository.getById.mockResolvedValue(
                priorPayment({
                    id: "pay-1",
                    transactionId: "txn-1",
                    amount: 8800,
                    principalAmount: 8000,
                    interestAmount: 800,
                })
            );
            paymentRepository.getAllByScheduleId.mockResolvedValue(
                []
            );

            const service = createService();
            const result = await service.reversePayment(
                "pay-1"
            );

            expect(
                transactionRepository.delete
            ).not.toHaveBeenCalled();
            expect(
                paymentRepository.delete
            ).toHaveBeenCalledWith("pay-1");
            expect(result.schedule.status).toBe(
                LoanPaymentStatus.UPCOMING
            );
            expect(
                atomicWriter.reversePayment
            ).toHaveBeenCalledTimes(1);
        });
    });

    describe("validation", () => {
        it("refuses safely, with no writes, when the payment record cannot be found", async () => {
            paymentRepository.getById.mockResolvedValue(
                null
            );

            const service = createService();

            await expect(
                service.reversePayment("missing")
            ).rejects.toThrow(
                /may have already been reversed/
            );

            expect(
                atomicWriter.reversePayment
            ).not.toHaveBeenCalled();
            expect(
                paymentRepository.delete
            ).not.toHaveBeenCalled();
        });

        it("throws when the schedule row is missing", async () => {
            paymentRepository.getById.mockResolvedValue(
                priorPayment({ id: "pay-1" })
            );
            scheduleRepository.getById.mockResolvedValue(
                null
            );

            const service = createService();

            await expect(
                service.reversePayment("pay-1")
            ).rejects.toThrow(
                "EMI installment not found."
            );
        });

        it("throws when the loan is missing", async () => {
            paymentRepository.getById.mockResolvedValue(
                priorPayment({ id: "pay-1" })
            );
            loanRepository.getById.mockResolvedValue(
                null
            );

            const service = createService();

            await expect(
                service.reversePayment("pay-1")
            ).rejects.toThrow("Loan not found.");
        });
    });

    describe("rollback safety", () => {
        beforeEach(() => {
            paymentRepository.getById.mockResolvedValue(
                priorPayment({
                    id: "pay-1",
                    transactionId: "txn-1",
                    amount: 8800,
                    principalAmount: 8000,
                    interestAmount: 800,
                })
            );
            paymentRepository.getAllByScheduleId.mockResolvedValue(
                []
            );
        });

        function expectNoJsManagedTransaction() {
            expect(loanRepository.beginTransaction).not.toHaveBeenCalled();
            expect(loanRepository.commit).not.toHaveBeenCalled();
            expect(loanRepository.rollback).not.toHaveBeenCalled();
        }

        it.each([
            ["deleting the transaction", () => transactionRepository.delete.mockRejectedValue(new Error("Transaction delete failed.")), "Transaction delete failed."],
            ["deleting the payment ledger row", () => paymentRepository.delete.mockRejectedValue(new Error("Ledger delete failed.")), "Ledger delete failed."],
            ["the schedule update", () => scheduleRepository.update.mockRejectedValue(new Error("Schedule update failed.")), "Schedule update failed."],
            ["restoring loan balances", () => loanRepository.updateAccountingBalances.mockRejectedValue(new Error("Balance update failed.")), "Balance update failed."],
        ])("rethrows the original error when %s fails inside the atomic write (nothing is committed)", async (_step, fail, message) => {
            fail();

            const service = createService();

            await expect(
                service.reversePayment("pay-1")
            ).rejects.toThrow(message);

            expect(
                atomicWriter.reversePayment
            ).toHaveBeenCalledTimes(1);
            expectNoJsManagedTransaction();
        });

        it("sends the whole reversal as ONE write", async () => {
            const service = createService();

            await service.reversePayment("pay-1");

            expect(
                atomicWriter.reversePayment
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    paymentId: "pay-1",
                    transactionId: "txn-1",
                })
            );
            expectNoJsManagedTransaction();
        });
    });
});
