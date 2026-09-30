import { describe, expect, it } from "vitest";

import { LoanDashboardService } from "./LoanDashboardService";
import { LoanPaymentStatus } from "../types/LoanPaymentStatus";
import type { Loan, LoanPaymentSchedule } from "../types";

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
        outstandingInterest: 4000,
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
        outstandingPrincipal: 42000,
        status: LoanPaymentStatus.UPCOMING,
        paidDate: null,
        paidAmount: null,
        transactionId: null,
        ...overrides,
    };
}

function createService(
    schedulesByLoanId: Record<string, LoanPaymentSchedule[]>
): LoanDashboardService {
    const service = new LoanDashboardService();

    Object.defineProperty(service, "scheduleRepository", {
        value: {
            async getAllByLoanId(loanId: string) {
                return schedulesByLoanId[loanId] ?? [];
            },
        },
    });

    return service;
}

describe("LoanDashboardService.getSummary - totalOutstandingInterest", () => {
    it("counts the full scheduled interest for an unpaid row (unchanged behaviour)", async () => {
        const service = createService({
            "loan-1": [scheduleRow({ interestAmount: 800 })],
        });

        const summary = await service.getSummary([
            loan(),
        ]);

        expect(summary.totalOutstandingInterest).toBe(
            800
        );
    });

    it("subtracts the interest already paid on a PARTIAL row from the outstanding total (Loans Phase 4)", async () => {
        const service = createService({
            "loan-1": [
                scheduleRow({
                    status: LoanPaymentStatus.PARTIAL,
                    interestAmount: 800,
                    paidAmount: 300,
                }),
            ],
        });

        const summary = await service.getSummary([
            loan(),
        ]);

        // 800 scheduled - 300 already paid (all to interest) = 500
        // still owed on this instalment.
        expect(summary.totalOutstandingInterest).toBe(
            500
        );
    });

    it("counts zero remaining interest once a partial payment has already fully covered it", async () => {
        const service = createService({
            "loan-1": [
                scheduleRow({
                    status: LoanPaymentStatus.PARTIAL,
                    interestAmount: 800,
                    // Interest fully covered; 200 already went to
                    // principal, but that doesn't affect this figure.
                    paidAmount: 1000,
                }),
            ],
        });

        const summary = await service.getSummary([
            loan(),
        ]);

        expect(summary.totalOutstandingInterest).toBe(0);
    });

    it("excludes PAID rows entirely, whether or not more rows remain", async () => {
        const service = createService({
            "loan-1": [
                scheduleRow({
                    id: "sch-1",
                    status: LoanPaymentStatus.PAID,
                    interestAmount: 800,
                    paidAmount: 8800,
                }),
                scheduleRow({
                    id: "sch-2",
                    interestAmount: 700,
                }),
            ],
        });

        const summary = await service.getSummary([
            loan(),
        ]);

        expect(summary.totalOutstandingInterest).toBe(
            700
        );
    });
});

// Relative to the real clock, since LoanDashboardService.getSummary()
// always derives overdue-ness from `new Date()` (Loans Phase 5 - no
// asOf injection point at this level).
function daysFromNow(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
    ].join("-");
}

describe("LoanDashboardService.getSummary - derived overdue (Loans Phase 5)", () => {
    it("counts a past-due UPCOMING row as overdue", async () => {
        const service = createService({
            "loan-1": [
                scheduleRow({
                    dueDate: daysFromNow(-3),
                    totalAmount: 8800,
                    paidAmount: null,
                }),
            ],
        });

        const summary = await service.getSummary([
            loan(),
        ]);

        expect(summary.overdueCount).toBe(1);
        expect(summary.overdueAmount).toBe(8800);
    });

    it("calculates overdue amount from the remaining unpaid amount on a PARTIAL row", async () => {
        const service = createService({
            "loan-1": [
                scheduleRow({
                    status: LoanPaymentStatus.PARTIAL,
                    dueDate: daysFromNow(-1),
                    totalAmount: 8800,
                    paidAmount: 300,
                }),
            ],
        });

        const summary = await service.getSummary([
            loan(),
        ]);

        expect(summary.overdueCount).toBe(1);
        expect(summary.overdueAmount).toBe(8500);
    });

    it("never counts a PAID row as overdue, even with a past due date", async () => {
        const service = createService({
            "loan-1": [
                scheduleRow({
                    status: LoanPaymentStatus.PAID,
                    dueDate: daysFromNow(-30),
                    totalAmount: 8800,
                    paidAmount: 8800,
                }),
            ],
        });

        const summary = await service.getSummary([
            loan(),
        ]);

        expect(summary.overdueCount).toBe(0);
        expect(summary.overdueAmount).toBe(0);
    });

    it("does not count a not-yet-due UPCOMING row as overdue", async () => {
        const service = createService({
            "loan-1": [
                scheduleRow({
                    dueDate: daysFromNow(5),
                }),
            ],
        });

        const summary = await service.getSummary([
            loan(),
        ]);

        expect(summary.overdueCount).toBe(0);
        expect(summary.overdueAmount).toBe(0);
    });

    it("counts multiple overdue rows across the same loan", async () => {
        const service = createService({
            "loan-1": [
                scheduleRow({
                    id: "sch-1",
                    dueDate: daysFromNow(-10),
                    totalAmount: 8800,
                }),
                scheduleRow({
                    id: "sch-2",
                    dueDate: daysFromNow(-1),
                    totalAmount: 8800,
                }),
                scheduleRow({
                    id: "sch-3",
                    dueDate: daysFromNow(10),
                    totalAmount: 8800,
                }),
            ],
        });

        const summary = await service.getSummary([
            loan(),
        ]);

        expect(summary.overdueCount).toBe(2);
        expect(summary.overdueAmount).toBe(17600);
    });

    it("preserves existing next-EMI ordering (earliest due date first, overdue included)", async () => {
        const service = createService({
            "loan-1": [
                scheduleRow({
                    id: "sch-later",
                    dueDate: daysFromNow(10),
                }),
                scheduleRow({
                    id: "sch-overdue",
                    dueDate: daysFromNow(-2),
                }),
            ],
        });

        const summary = await service.getSummary([
            loan(),
        ]);

        expect(summary.nextEmi?.id).toBe("sch-overdue");
    });
});
