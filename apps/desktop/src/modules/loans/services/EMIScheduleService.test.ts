import { describe, expect, it } from "vitest";

import type { LoanSchedulePayment } from "../types";

import { EMIScheduleService } from "./EMIScheduleService";

// LoanSchedulePaymentRepository talks to a live Tauri SQLite
// connection, unavailable here. Following the BudgetService.test.ts
// pattern, it is replaced with an in-memory fake.

function payment(
    overrides: Partial<LoanSchedulePayment> = {}
): LoanSchedulePayment {
    return {
        id: "pay-1",
        loanId: "loan-1",
        scheduleId: "sch-1",
        transactionId: "txn-1",
        paymentDate: "2026-02-01",
        amount: 8800,
        principalAmount: 8000,
        interestAmount: 800,
        createdAt: "2026-02-01T00:00:00.000Z",
        ...overrides,
    };
}

function createService(
    payments: LoanSchedulePayment[]
): EMIScheduleService {
    const service = new EMIScheduleService();

    Object.defineProperty(
        service,
        "paymentRepository",
        {
            value: {
                async getAll() {
                    return payments;
                },
            },
        }
    );

    return service;
}

describe("EMIScheduleService.getInterestByTransactionId", () => {
    it("maps each recorded payment transaction to its own interest portion", async () => {
        const service = createService([
            payment({
                transactionId: "txn-1",
                interestAmount: 800,
            }),
            payment({
                id: "pay-2",
                scheduleId: "sch-2",
                transactionId: "txn-2",
                interestAmount: 720,
            }),
        ]);

        const map =
            await service.getInterestByTransactionId();

        expect(map.get("txn-1")).toBe(800);
        expect(map.get("txn-2")).toBe(720);
        expect(map.size).toBe(2);
    });

    it("covers every loan, not just active ones - a closed loan's past EMI payments split the same way", async () => {
        const service = createService([
            payment({
                loanId: "loan-1",
                transactionId: "txn-a",
                interestAmount: 800,
            }),
            payment({
                id: "pay-2",
                loanId: "loan-2",
                scheduleId: "sch-2",
                transactionId: "txn-b",
                interestAmount: 100,
            }),
        ]);

        const map =
            await service.getInterestByTransactionId();

        expect(map.get("txn-a")).toBe(800);
        expect(map.get("txn-b")).toBe(100);
    });

    it("coerces a non-finite interest amount to zero", async () => {
        const service = createService([
            payment({
                transactionId: "txn-x",
                interestAmount:
                    Number.NaN as unknown as number,
            }),
        ]);

        const map =
            await service.getInterestByTransactionId();

        expect(map.get("txn-x")).toBe(0);
    });

    it("keeps a first partial payment's own interest figure distinct from a later completing payment's (Loans Phase 4 correction)", async () => {
        const service = createService([
            // First payment: 300 paid, all interest (instalment has
            // 800 interest / 8000 principal).
            payment({
                id: "pay-1",
                transactionId: "txn-first",
                amount: 300,
                principalAmount: 0,
                interestAmount: 300,
            }),
            // Second payment completes the instalment: remaining 500
            // interest + 8000 principal = 8500.
            payment({
                id: "pay-2",
                transactionId: "txn-second",
                amount: 8500,
                principalAmount: 8000,
                interestAmount: 500,
            }),
        ]);

        const map =
            await service.getInterestByTransactionId();

        expect(map.get("txn-first")).toBe(300);
        expect(map.get("txn-second")).toBe(500);
        expect(map.size).toBe(2);
    });
});
