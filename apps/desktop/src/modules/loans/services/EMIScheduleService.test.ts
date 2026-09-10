import { describe, expect, it } from "vitest";

import type { Loan, LoanPaymentSchedule } from "../types";

import { EMIScheduleService } from "./EMIScheduleService";

// LoanRepository / LoanPaymentScheduleRepository talk to a live Tauri
// SQLite connection, unavailable here. Following the BudgetService.test.ts
// pattern, both are replaced with in-memory fakes.

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
        outstandingPrincipal: 50000,
        outstandingInterest: 3000,
        paidInstallments: 0,
        currencyId: "currency-inr",
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
        outstandingPrincipal: 92000,
        status: "UPCOMING" as LoanPaymentSchedule["status"],
        paidDate: null,
        paidAmount: null,
        transactionId: null,
        ...overrides,
    };
}

function createService(options: {
    loans: Loan[];
    schedulesByLoanId: Record<
        string,
        LoanPaymentSchedule[]
    >;
}) {
    const service = new EMIScheduleService();

    Object.defineProperty(service, "loanRepository", {
        value: {
            async getAll() {
                return options.loans;
            },
        },
    });

    Object.defineProperty(
        service,
        "scheduleRepository",
        {
            value: {
                async getAllByLoanId(loanId: string) {
                    return (
                        options.schedulesByLoanId[
                            loanId
                        ] ?? []
                    );
                },
            },
        }
    );

    return service;
}

describe("EMIScheduleService.getInterestByTransactionId", () => {
    it("maps each linked EMI payment transaction to its interest portion", async () => {
        const service = createService({
            loans: [loan({ id: "loan-1" })],
            schedulesByLoanId: {
                "loan-1": [
                    scheduleRow({
                        id: "s1",
                        interestAmount: 800,
                        transactionId: "txn-1",
                    }),
                    scheduleRow({
                        id: "s2",
                        interestAmount: 720,
                        transactionId: "txn-2",
                    }),
                ],
            },
        });

        const map =
            await service.getInterestByTransactionId();

        expect(map.get("txn-1")).toBe(800);
        expect(map.get("txn-2")).toBe(720);
        expect(map.size).toBe(2);
    });

    it("ignores schedule rows that have no linked transaction", async () => {
        const service = createService({
            loans: [loan({ id: "loan-1" })],
            schedulesByLoanId: {
                "loan-1": [
                    scheduleRow({
                        transactionId: null,
                    }),
                    scheduleRow({
                        id: "s2",
                        interestAmount: 500,
                        transactionId: "txn-paid",
                    }),
                ],
            },
        });

        const map =
            await service.getInterestByTransactionId();

        expect(map.size).toBe(1);
        expect(map.get("txn-paid")).toBe(500);
    });

    it("covers every loan, not just active ones", async () => {
        const service = createService({
            loans: [
                loan({ id: "loan-1", status: "ACTIVE" }),
                loan({ id: "loan-2", status: "CLOSED" }),
            ],
            schedulesByLoanId: {
                "loan-1": [
                    scheduleRow({
                        interestAmount: 800,
                        transactionId: "txn-a",
                    }),
                ],
                "loan-2": [
                    scheduleRow({
                        loanId: "loan-2",
                        interestAmount: 100,
                        transactionId: "txn-b",
                    }),
                ],
            },
        });

        const map =
            await service.getInterestByTransactionId();

        expect(map.get("txn-a")).toBe(800);
        expect(map.get("txn-b")).toBe(100);
    });

    it("coerces a non-finite interest amount to zero", async () => {
        const service = createService({
            loans: [loan({ id: "loan-1" })],
            schedulesByLoanId: {
                "loan-1": [
                    scheduleRow({
                        interestAmount:
                            Number.NaN as unknown as number,
                        transactionId: "txn-x",
                    }),
                ],
            },
        });

        const map =
            await service.getInterestByTransactionId();

        expect(map.get("txn-x")).toBe(0);
    });
});
