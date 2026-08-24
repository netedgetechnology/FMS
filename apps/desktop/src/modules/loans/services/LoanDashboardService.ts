import { LoanPaymentScheduleRepository } from "../repositories/LoanPaymentScheduleRepository";
import type { Loan, LoanPaymentSchedule } from "../types";

export interface LoanDashboardSummary {
    totalOutstandingInterest: number;
    totalRemainingEmi: number;
    overdueCount: number;
    overdueAmount: number;
    nextEmi: LoanPaymentSchedule | null;
}

export class LoanDashboardService {
    private readonly scheduleRepository =
        new LoanPaymentScheduleRepository();

    async getSummary(
        loans: Loan[]
    ): Promise<LoanDashboardSummary> {
        const activeLoans = loans.filter(
            loan => loan.status === "ACTIVE"
        );

        const schedules = (
            await Promise.all(
                activeLoans.map(loan =>
                    this.scheduleRepository.getAllByLoanId(
                        loan.id
                    )
                )
            )
        ).flat();

        const unpaid = schedules.filter(
            item => item.status !== "PAID"
        );

        const overdue = schedules.filter(
            item => item.status === "OVERDUE"
        );

        const upcoming = schedules
            .filter(
                item =>
                    item.status === "UPCOMING" ||
                    item.status === "PARTIAL"
            )
            .sort(
                (a, b) =>
                    new Date(a.dueDate).getTime() -
                    new Date(b.dueDate).getTime()
            );

        return {
            totalOutstandingInterest: unpaid.reduce(
                (total, item) =>
                    total + Number(item.interestAmount ?? 0),
                0
            ),

            totalRemainingEmi: unpaid.reduce(
                (total, item) =>
                    total +
                    Number(
                        item.paidAmount
                            ? Math.max(
                                  0,
                                  item.totalAmount -
                                      item.paidAmount
                              )
                            : item.totalAmount
                    ),
                0
            ),

            overdueCount: overdue.length,

            overdueAmount: overdue.reduce(
                (total, item) =>
                    total +
                    Math.max(
                        0,
                        Number(item.totalAmount ?? 0) -
                            Number(item.paidAmount ?? 0)
                    ),
                0
            ),

            nextEmi: upcoming[0] ?? null,
        };
    }
}
