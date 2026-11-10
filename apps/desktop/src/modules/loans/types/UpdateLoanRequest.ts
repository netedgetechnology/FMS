import type { DrawingPowerStep } from "../setup/droplineSchedule";
import type { CreateLoanRequest } from "./CreateLoanRequest";

export type UpdateLoanRequest = Omit<
    CreateLoanRequest,
    "outstandingPrincipal" | "outstandingInterest" | "paidInstallments"
> & {
    id: string;
    /**
     * Never editable: the paid-instalment count is derived from the EMI
     * schedule. Sent only by older callers - a value different from the
     * loan's own count is refused (LoanService.update).
     */
    paidInstallments?: number | null;
    /**
     * A Dropline Overdraft's dated drawing-power steps, replaced as a whole
     * (migration 053). Not sent (undefined) = the saved steps are kept.
     */
    drawingPowerSchedule?: DrawingPowerStep[];
};
