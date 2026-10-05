import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoanPaymentService } from "./LoanPaymentService";
import { LoanPaymentStatus } from "../types/LoanPaymentStatus";
import type { Loan, LoanPaymentSchedule, LoanSchedulePayment } from "../types";
import type { RecordEmiPaymentRequest } from "../repositories/emiPaymentAtomic";

// ---------------------------------------------------------------------
// Regression: "Failed to process EMI payment." for a previous-month,
// partial EMI payment. Uses the user's exact loan/instalment/payment.
// The service must build ONE atomic request (src-tauri loan_payment.rs)
// - never the JS-managed begin/execute/commit that split the writes
// across pooled connections, committed them one by one and then failed
// on COMMIT.
// ---------------------------------------------------------------------

const LOAN: Loan = {
    id: "094f1dd8-0b5a-4de6-a769-ef4cdecc2da9",
    accountId: "ab08e489-b321-402a-b2ee-7ef8c0a10e0d",
    loanAccountId: "loan-acct",
    lenderInstitutionId: null,
    loanType: "HOME",
    name: "Aditya Birla Capital",
    principalAmount: 13300000,
    interestRate: 11,
    interestType: "REDUCING",
    tenureMonths: 180,
    emiAmount: 151167.39,
    startDate: "2026-04-05",
    maturityDate: null,
    outstandingPrincipal: 13300000,
    outstandingInterest: 13910131.34,
    paidInstallments: 0,
    currencyId: "cur-inr",
    status: "ACTIVE",
    createdAt: "2026-10-05T14:27:41.724Z",
    updatedAt: "2026-10-05T14:27:41.724Z",
} as Loan;

const INSTALMENT_1: LoanPaymentSchedule = {
    id: "4f13144a-44d5-48ef-b831-067802615b12",
    loanId: LOAN.id,
    installmentNumber: 1,
    dueDate: "2026-05-05",
    principalAmount: 29250.72,
    interestAmount: 121916.67,
    totalAmount: 151167.39,
    outstandingPrincipal: 13270749.28,
    status: LoanPaymentStatus.UPCOMING,
    paidDate: null,
    paidAmount: null,
    transactionId: null,
};

const USER_PAYMENT = {
    loanId: LOAN.id,
    scheduleId: INSTALMENT_1.id,
    paymentDate: "2026-04-06",
    amount: 68943.0,
    paymentMethod: "EMANDATE",
    referenceNumber: null,
    notes: null,
};

const loanRepository = { getById: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
const scheduleRepository = { getById: vi.fn() };
const paymentRepository = { getAllByScheduleId: vi.fn() };
const transactionService = { prepareCreate: vi.fn() };
const atomicWriter = { recordPayment: vi.fn(), reversePayment: vi.fn() };

function service(): LoanPaymentService {
    const s = new LoanPaymentService();
    for (const [name, value] of Object.entries({ loanRepository, scheduleRepository, paymentRepository, transactionService, atomicWriter })) {
        Object.defineProperty(s, name, { value });
    }
    return s;
}

const sent = (): RecordEmiPaymentRequest => atomicWriter.recordPayment.mock.calls[atomicWriter.recordPayment.mock.calls.length - 1]![0];

beforeEach(() => {
    vi.clearAllMocks();
    loanRepository.getById.mockResolvedValue({ ...LOAN });
    scheduleRepository.getById.mockResolvedValue({ ...INSTALMENT_1 });
    paymentRepository.getAllByScheduleId.mockResolvedValue([]);
    // The real prepareCreate builds the stored row from the request.
    transactionService.prepareCreate.mockImplementation(async (request: Record<string, unknown>) => ({
        id: "txn-new",
        ...request,
        createdAt: "2026-10-05T14:31:08.601Z",
        updatedAt: "2026-10-05T14:31:08.601Z",
    }));
    atomicWriter.recordPayment.mockResolvedValue(undefined);
});

describe("EMI payment regression - Rs 68,943.00 on 2026-04-06 against instalment 1 (Rs 1,51,167.39, due 2026-05-05)", () => {
    it("1+3+4. records a PARTIAL payment: paid 68,943.00, remaining 82,224.39, NOT marked paid", async () => {
        const result = await service().processPayment(USER_PAYMENT);

        expect(result.amountPaid).toBe(68943);
        expect(result.schedule.status).toBe(LoanPaymentStatus.PARTIAL);
        expect(result.schedule.paidAmount).toBe(68943);
        expect(Math.round((INSTALMENT_1.totalAmount - result.schedule.paidAmount!) * 100) / 100).toBe(82224.39);
        expect(sent().schedule).toEqual({
            id: INSTALMENT_1.id, status: "PARTIAL", paidDate: "2026-04-06", paidAmount: 68943, transactionId: "txn-new",
        });
    });

    it("allocates interest first (existing accounting model): all 68,943 to interest, principal unchanged", async () => {
        const result = await service().processPayment(USER_PAYMENT);

        expect(result.interestPaid).toBe(68943);
        expect(result.principalPaid).toBe(0);
        expect(sent().loan).toEqual({
            id: LOAN.id, outstandingPrincipal: 13300000, outstandingInterest: 13841188.34, status: "ACTIVE",
        });
        expect(sent().payment).toMatchObject({ amount: 68943, principalAmount: 0, interestAmount: 68943 });
    });

    it("2+10. accepts a payment dated before the due date and keeps both dates exactly (no format/timezone shift)", async () => {
        const result = await service().processPayment(USER_PAYMENT);

        // 2026-04-06 = 6 April 2026 (the dialog's date input), stored as-is;
        // the instalment's due date 2026-05-05 is untouched.
        expect(sent().transaction.transactionDate).toBe("2026-04-06");
        expect(sent().payment.paymentDate).toBe("2026-04-06");
        expect(sent().schedule.paidDate).toBe("2026-04-06");
        expect(result.schedule.dueDate).toBe("2026-05-05");
    });

    it("6. creates the bank-side expense transaction for exactly the payment", async () => {
        await service().processPayment(USER_PAYMENT);

        expect(transactionService.prepareCreate).toHaveBeenCalledTimes(1);
        expect(sent().transaction).toMatchObject({
            id: "txn-new",
            accountId: LOAN.accountId,
            payee: "Aditya Birla Capital",
            type: "expense",
            amount: 68943,
            transactionDate: "2026-04-06",
            paymentMethod: "EMANDATE",
            status: "CLEARED",
            notes: "EMI payment - Installment 1",
        });
        expect(sent().payment).toMatchObject({ transactionId: "txn-new", scheduleId: INSTALMENT_1.id, loanId: LOAN.id });
    });

    it("writes everything in ONE atomic call - never the JS-managed transaction that caused the bug", async () => {
        await service().processPayment(USER_PAYMENT);

        expect(atomicWriter.recordPayment).toHaveBeenCalledTimes(1);
        expect(loanRepository.beginTransaction).not.toHaveBeenCalled();
        expect(loanRepository.commit).not.toHaveBeenCalled();
        expect(loanRepository.rollback).not.toHaveBeenCalled();
    });

    it("5. completing the remaining 82,224.39 marks the instalment PAID (interest 52,973.67 + principal 29,250.72)", async () => {
        const first: LoanSchedulePayment = {
            id: "pay-1", loanId: LOAN.id, scheduleId: INSTALMENT_1.id, transactionId: "txn-1",
            paymentDate: "2026-04-06", amount: 68943, principalAmount: 0, interestAmount: 68943,
            createdAt: "2026-10-05 14:31:08",
        };
        paymentRepository.getAllByScheduleId.mockResolvedValue([first]);
        scheduleRepository.getById.mockResolvedValue({ ...INSTALMENT_1, status: LoanPaymentStatus.PARTIAL, paidAmount: 68943, paidDate: "2026-04-06", transactionId: "txn-1" });
        loanRepository.getById.mockResolvedValue({ ...LOAN, outstandingInterest: 13841188.34 });

        const result = await service().processPayment({ ...USER_PAYMENT, paymentDate: "2026-05-05", amount: 82224.39 });

        expect(result.schedule.status).toBe(LoanPaymentStatus.PAID);
        expect(result.schedule.paidAmount).toBe(151167.39);
        expect(result.interestPaid).toBe(52973.67);
        expect(result.principalPaid).toBe(29250.72);
        // The first payment's transaction stays the instalment's reference.
        expect(sent().schedule.transactionId).toBe("txn-1");
        expect(sent().loan.outstandingPrincipal).toBe(13270749.28);
        expect(sent().loan.outstandingInterest).toBe(13788214.67);
    });

    it("9. refuses more than what remains (82,224.40 after the first payment) and writes nothing", async () => {
        paymentRepository.getAllByScheduleId.mockResolvedValue([
            { id: "pay-1", loanId: LOAN.id, scheduleId: INSTALMENT_1.id, transactionId: "txn-1", paymentDate: "2026-04-06", amount: 68943, principalAmount: 0, interestAmount: 68943, createdAt: "x" },
        ]);

        await expect(service().processPayment({ ...USER_PAYMENT, amount: 82224.40 })).rejects.toThrow(
            /cannot exceed the remaining scheduled amount of 82224.39/
        );
        expect(atomicWriter.recordPayment).not.toHaveBeenCalled();
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("8. refuses an invalid amount (%s) and writes nothing", async amount => {
        await expect(service().processPayment({ ...USER_PAYMENT, amount })).rejects.toThrow(/greater than zero|cannot exceed/);
        expect(atomicWriter.recordPayment).not.toHaveBeenCalled();
        expect(transactionService.prepareCreate).not.toHaveBeenCalled();
    });

    it("7. a repeated submission that the atomic write refuses is reported, not swallowed", async () => {
        atomicWriter.recordPayment.mockRejectedValueOnce(
            new Error("This payment was not recorded: only 0.00 remains on this installment (it may already have been paid).")
        );

        await expect(service().processPayment(USER_PAYMENT)).rejects.toThrow(/may already have been paid/);
    });

    it("a payment is allowed for an OVERDUE instalment and for a future one (no date rule exists)", async () => {
        scheduleRepository.getById.mockResolvedValue({ ...INSTALMENT_1, status: "OVERDUE" });
        await expect(service().processPayment(USER_PAYMENT)).resolves.toMatchObject({ amountPaid: 68943 });

        scheduleRepository.getById.mockResolvedValue({ ...INSTALMENT_1, dueDate: "2027-01-05" });
        await expect(service().processPayment({ ...USER_PAYMENT, paymentDate: "2026-10-05" })).resolves.toMatchObject({ amountPaid: 68943 });
    });
});
