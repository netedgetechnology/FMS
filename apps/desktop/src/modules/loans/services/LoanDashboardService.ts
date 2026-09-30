import { LoanPaymentScheduleRepository } from "../repositories/LoanPaymentScheduleRepository";
import type { Loan, LoanPaymentSchedule } from "../types";
import { paidInterestPortion } from "./loanPaymentAllocation";
import { isScheduleOverdue } from "./loanScheduleOverdue";

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

        // OVERDUE is never persisted (Loans Phase 5) - derived here
        // from dueDate vs. today, excluding PAID rows unconditionally.
        const overdue = schedules.filter(item =>
            isScheduleOverdue(item)
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
            // Remaining interest still owed on each unpaid/partial row -
            // its scheduled interestAmount minus whatever interest has
            // already been paid against it (Loans Phase 4). For a row
            // with no payment yet (paidAmount null) this is unchanged:
            // the full scheduled interestAmount.
            totalOutstandingInterest: unpaid.reduce(
                (total, item) =>
                    total +
                    Math.max(
                        0,
                        Number(item.interestAmount ?? 0) -
                            paidInterestPortion(
                                item,
                                item.paidAmount
                            )
                    ),
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
