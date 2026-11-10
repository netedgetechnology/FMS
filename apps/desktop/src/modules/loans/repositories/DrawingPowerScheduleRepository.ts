import { Repository } from "@/core/database/engine/Repository";

import type { DrawingPowerStep } from "../setup/droplineSchedule";

/** Read-only: steps are written with the loan by create_loan_atomic. */
export class DrawingPowerScheduleRepository extends Repository {
    async findByLoan(loanId: string): Promise<DrawingPowerStep[]> {
        return this.select<DrawingPowerStep>(
            `SELECT effective_date AS effectiveDate, drawing_power AS drawingPower
             FROM loan_drawing_power_schedule
             WHERE loan_id = ?
             ORDER BY effective_date`,
            [loanId]
        );
    }
}
