import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMIScheduleGenerator } from "./EMIScheduleGenerator";
import { computeLoanScheduleAndBalances } from "./EMIScheduleService";
import { estimateLoan } from "./loanEstimate";
import { LoanPaymentService } from "./LoanPaymentService";
import { LoanPaymentStatus } from "../types/LoanPaymentStatus";
import type { Loan, LoanPaymentSchedule } from "../types";

// ---------------------------------------------------------------------
// Optional irregular first instalment (broken-period / pre-EMI interest),
// with the actual Aditya Birla Capital terms: Rs 1,33,00,000 at 11%
// reducing, 180 regular EMIs of Rs 1,51,167.39, start 2026-04-05, and a
// first instalment of Rs 68,943.00 due 2026-05-05.
// ---------------------------------------------------------------------

const TERMS = {
    loanId: "abc-loan",
    principalAmount: 13300000,
    interestRate: 11,
    interestType: "REDUCING" as const,
    tenureMonths: 180,
    emiAmount: 151167.39,
    startDate: "2026-04-05",
};

const generate = (extra: Record<string, unknown> = {}) =>
    new EMIScheduleGenerator().generate({ ...TERMS, ...extra });

const money = (n: number) => Math.round(n * 100) / 100;
const sum = (rows: LoanPaymentSchedule[], key: "interestAmount" | "principalAmount" | "totalAmount") =>
    money(rows.reduce((s, r) => s + r[key], 0));

describe("1+10. a regular loan (first EMI = regular EMI) is unchanged", () => {
    it("reproduces the Aditya Birla rows FinWea stored before this change", () => {
        const rows = generate();

        expect(rows).toHaveLength(180);
        expect(rows[0]).toMatchObject({
            installmentNumber: 1, dueDate: "2026-05-05",
            principalAmount: 29250.72, interestAmount: 121916.67, totalAmount: 151167.39,
            outstandingPrincipal: 13270749.28,
        });
        expect(rows[179]).toMatchObject({ installmentNumber: 180, dueDate: "2041-04-05", outstandingPrincipal: 0 });
        expect(sum(rows, "totalAmount")).toBe(27210131.34);
    });

    it("an empty or zero first instalment changes nothing", () => {
        const plain = generate().map(({ id: _id, ...row }) => row);

        for (const firstInstallmentAmount of [null, undefined, 0]) {
            expect(generate({ firstInstallmentAmount }).map(({ id: _id, ...row }) => row)).toEqual(plain);
        }
    });
});

describe("2+3. a first instalment different from (smaller than) the regular EMI", () => {
    const rows = generate({ firstInstallmentAmount: 68943 });

    it("instalment 1 is Rs 68,943.00 broken-period interest due 05/05/2026: all interest, no principal", () => {
        expect(rows[0]).toMatchObject({
            installmentNumber: 1, dueDate: "2026-05-05",
            principalAmount: 0, interestAmount: 68943, totalAmount: 68943,
            outstandingPrincipal: 13300000, status: LoanPaymentStatus.UPCOMING,
        });
        expect(rows[0].totalAmount).toBeLessThan(rows[1].totalAmount);
    });

    it("6. instalment 2 onward is the regular Rs 1,51,167.39 EMI from 05/06/2026, amortizing the full principal", () => {
        expect(rows[1]).toMatchObject({
            installmentNumber: 2, dueDate: "2026-06-05",
            principalAmount: 29250.72, interestAmount: 121916.67, totalAmount: 151167.39,
            outstandingPrincipal: 13270749.28,
        });
        expect(rows[2]).toMatchObject({ installmentNumber: 3, dueDate: "2026-07-05", totalAmount: 151167.39 });
        expect(rows.slice(1, -1).every(r => r.totalAmount === 151167.39)).toBe(true);
    });

    it("180 regular EMIs follow it (181 instalments), the last on 05/05/2041 clearing the principal exactly", () => {
        expect(rows).toHaveLength(181);
        expect(rows[180]).toMatchObject({ installmentNumber: 181, dueDate: "2041-05-05", outstandingPrincipal: 0 });
        expect(sum(rows, "principalAmount")).toBe(13300000);
        // Every instalment number in order, no gaps.
        expect(rows.map(r => r.installmentNumber)).toEqual(Array.from({ length: 181 }, (_, i) => i + 1));
    });

    it("total scheduled = first instalment + the same 180 regular EMIs as before", () => {
        expect(sum(rows, "totalAmount")).toBe(money(68943 + 27210131.34));
        expect(sum(rows, "interestAmount")).toBe(money(68943 + 27210131.34 - 13300000));
    });

    it("8. the loan's outstanding balances are derived from that schedule", () => {
        const balances = computeLoanScheduleAndBalances({
            id: "abc-loan", principalAmount: 13300000, interestRate: 11, interestType: "REDUCING",
            tenureMonths: 180, emiAmount: 151167.39, firstInstallmentAmount: 68943,
            startDate: "2026-04-05", paidInstallments: 0, status: "ACTIVE",
        });

        expect(balances.schedule).toHaveLength(181);
        expect(balances.outstandingPrincipal).toBe(13300000);
        expect(balances.outstandingInterest).toBe(money(68943 + 27210131.34 - 13300000));
    });

    it("an already-paid instalment count marks the first instalment first", () => {
        const paid = generate({ firstInstallmentAmount: 68943, paidInstallments: 1 });

        expect(paid[0]).toMatchObject({ status: LoanPaymentStatus.PAID, paidAmount: 68943 });
        expect(paid[1].status).toBe(LoanPaymentStatus.UPCOMING);
    });

    it("rejects a negative first instalment", () => {
        expect(() => generate({ firstInstallmentAmount: -1 })).toThrow(/cannot be negative/);
    });
});

describe("estimateLoan with a first instalment", () => {
    it("reports the REGULAR EMI and the shifted maturity", () => {
        const base = { principalAmount: 13300000, interestRate: 11, interestType: "REDUCING" as const, tenureMonths: 180, startDate: "2026-04-05" };

        expect(estimateLoan(base)).toMatchObject({ emiAmount: 151167.39, maturityDate: "2041-04-05" });
        expect(estimateLoan({ ...base, firstInstallmentAmount: 68943 })).toMatchObject({ emiAmount: 151167.39, maturityDate: "2041-05-05" });
    });
});

describe("payments against the irregular first instalment", () => {
    const rows = generate({ firstInstallmentAmount: 68943 });
    const loan = {
        id: "abc-loan", accountId: "acct", name: "Aditya Birla Capital", status: "ACTIVE",
        outstandingPrincipal: 13300000, outstandingInterest: money(68943 + 27210131.34 - 13300000),
    } as Loan;

    const loanRepository = { getById: vi.fn() };
    const scheduleRepository = { getById: vi.fn() };
    const paymentRepository = { getAllByScheduleId: vi.fn() };
    const transactionService = { prepareCreate: vi.fn() };
    const atomicWriter = { recordPayment: vi.fn(), reversePayment: vi.fn() };
    const service = () => {
        const s = new LoanPaymentService();
        for (const [name, value] of Object.entries({ loanRepository, scheduleRepository, paymentRepository, transactionService, atomicWriter })) {
            Object.defineProperty(s, name, { value });
        }
        return s;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        loanRepository.getById.mockResolvedValue({ ...loan });
        paymentRepository.getAllByScheduleId.mockResolvedValue([]);
        transactionService.prepareCreate.mockImplementation(async (r: Record<string, unknown>) => ({ id: "txn", ...r }));
        atomicWriter.recordPayment.mockResolvedValue(undefined);
    });

    it("4+5. Rs 68,943.00 fully pays instalment 1: PAID, nothing remaining, all interest", async () => {
        scheduleRepository.getById.mockResolvedValue({ ...rows[0] });

        const result = await service().processPayment({ loanId: "abc-loan", scheduleId: rows[0].id, paymentDate: "2026-04-06", amount: 68943 });

        expect(result.schedule.status).toBe(LoanPaymentStatus.PAID);
        expect(result.schedule.paidAmount).toBe(68943);
        expect(money(result.schedule.totalAmount - result.schedule.paidAmount!)).toBe(0);
        expect(result.interestPaid).toBe(68943);
        expect(result.principalPaid).toBe(0);
        expect(result.loan.outstandingPrincipal).toBe(13300000);
        expect(result.loan.outstandingInterest).toBe(money(27210131.34 - 13300000));
    });

    it("9. a second payment against the paid first instalment is refused - no duplicate", async () => {
        scheduleRepository.getById.mockResolvedValue({ ...rows[0], status: LoanPaymentStatus.PAID, paidAmount: 68943 });

        await expect(service().processPayment({ loanId: "abc-loan", scheduleId: rows[0].id, paymentDate: "2026-04-06", amount: 68943 }))
            .rejects.toThrow(/already been paid/);
        expect(atomicWriter.recordPayment).not.toHaveBeenCalled();
    });

    it("6. the regular instalment 2 is paid in full at Rs 1,51,167.39 (principal 29,250.72 + interest 1,21,916.67)", async () => {
        scheduleRepository.getById.mockResolvedValue({ ...rows[1] });

        const result = await service().processPayment({ loanId: "abc-loan", scheduleId: rows[1].id, paymentDate: "2026-06-05" });

        expect(result.amountPaid).toBe(151167.39);
        expect(result.schedule.status).toBe(LoanPaymentStatus.PAID);
        expect(result.principalPaid).toBe(29250.72);
        expect(result.interestPaid).toBe(121916.67);
    });

    it("7. a genuinely partial payment of a regular EMI is still PARTIAL", async () => {
        scheduleRepository.getById.mockResolvedValue({ ...rows[1] });

        const result = await service().processPayment({ loanId: "abc-loan", scheduleId: rows[1].id, paymentDate: "2026-06-05", amount: 50000 });

        expect(result.schedule.status).toBe(LoanPaymentStatus.PARTIAL);
        expect(money(result.schedule.totalAmount - result.schedule.paidAmount!)).toBe(101167.39);
    });
});
