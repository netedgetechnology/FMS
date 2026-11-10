// ---------------------------------------------------------------------
// An Overdraft's current position - everything derived from its limit and
// its used amount. The used amount itself comes only from
// OVERDRAFT_POSITIONS_SQL (opening used + live drawdowns - live
// repayments); this file never recomputes it, it only derives what
// follows from it, so every screen shows the same figures:
//
//   Available     = max(0, min(Limit, Drawing power) - Used)
//   Over limit by = max(0, Used - Limit)
//   Over drawing power by = max(0, Used - Drawing power), when a drawing
//                   power below the limit is recorded - for a Cash Credit
//                   or Dropline that, not the limit, is the real ceiling
//   Utilization % = Used / Limit x 100
//
// Interest / charges are shown on their own and never added to Used:
// FinWea does not assume how a particular lender treats interest. If a
// lender adds interest to the OD balance, the user records that debit to
// the OD as a Drawdown.
// ---------------------------------------------------------------------

import type { OverdraftTotalsRow } from "../repositories/OverdraftTransactionLinkRepository";

export type OverdraftUsageStatus =
    | "NOT_USED"
    | "PARTLY_USED"
    | "FULLY_USED"
    | "OVER_LIMIT"
    | "OVER_DRAWING_POWER"
    | "NEEDS_REVIEW";

export const OVERDRAFT_USAGE_STATUS_LABELS: Record<OverdraftUsageStatus, string> = {
    NOT_USED: "Not Used",
    PARTLY_USED: "Partly Used",
    FULLY_USED: "Fully Used",
    OVER_LIMIT: "Over Limit",
    OVER_DRAWING_POWER: "Over Drawing Power",
    NEEDS_REVIEW: "Needs Review",
};

export interface OverdraftPosition {
    limit: number;
    /**
     * The drawing power, when the lender sets one below the limit
     * (migration 051). null: not recorded - the limit applies.
     */
    drawingPower: number | null;
    used: number;
    /**
     * What can still be drawn: min(limit, drawing power) - used, never
     * below 0. Separate from Used (the outstanding principal).
     */
    available: number;
    overLimitBy: number;
    /**
     * How far Used is above a drawing power set below the limit; 0 when
     * none is recorded (the limit is the ceiling, see overLimitBy).
     */
    overDrawingPowerBy: number;
    /** Used / Limit x 100, to 2 decimals; null when there is no valid limit. */
    utilizationPercent: number | null;
    totalDrawdowns: number;
    totalRepayments: number;
    totalInterestCharges: number;
    status: OverdraftUsageStatus;
    /** Plain-language reasons the position needs the user's attention. */
    reviewReasons: string[];
}

/** Float noise only - never a rounding allowance. */
const MONEY_EPSILON = 0.005;

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeOverdraftPosition(
    creditLimit: number | null | undefined,
    totals: OverdraftTotalsRow,
    drawingPowerAmount: number | null | undefined = null
): OverdraftPosition {
    const limit = roundMoney(Number(creditLimit ?? 0));
    const drawingPower =
        drawingPowerAmount === null ||
        drawingPowerAmount === undefined ||
        !Number.isFinite(Number(drawingPowerAmount))
            ? null
            : roundMoney(Number(drawingPowerAmount));
    const drawable = drawingPower === null ? limit : Math.min(limit, drawingPower);
    const used = roundMoney(Number(totals.used ?? 0));
    const invalidLinks = Number(totals.invalidLinks ?? 0);

    const reviewReasons: string[] = [];

    if (!(limit > 0)) {
        reviewReasons.push("The OD limit is missing or not above zero.");
    }

    if (used < -MONEY_EPSILON) {
        reviewReasons.push(
            "The repayments are more than the amount used. Check the linked transactions and the opening used amount."
        );
    }

    if (invalidLinks > 0) {
        reviewReasons.push(
            `${invalidLinks} linked transaction${invalidLinks === 1 ? " no longer fits" : "s no longer fit"} this overdraft (its amount, direction, account or date was changed), so ${invalidLinks === 1 ? "it is" : "they are"} not counted. Unlink and link ${invalidLinks === 1 ? "it" : "them"} again if needed.`
        );
    }

    // A drawing power below the limit is the ceiling that matters: drawn
    // up to it is fully used, beyond it is over drawing power. With none
    // recorded the ceiling is the limit, exactly as before.
    const cappedByDrawingPower = drawingPower !== null && drawable < limit - MONEY_EPSILON;
    const ceiling = cappedByDrawingPower ? drawable : limit;

    const status: OverdraftUsageStatus =
        reviewReasons.length > 0
            ? "NEEDS_REVIEW"
            : Math.abs(used) < MONEY_EPSILON
              ? "NOT_USED"
              : used > limit + MONEY_EPSILON
                ? "OVER_LIMIT"
                : used > ceiling + MONEY_EPSILON
                  ? "OVER_DRAWING_POWER"
                  : Math.abs(used - ceiling) < MONEY_EPSILON
                    ? "FULLY_USED"
                    : "PARTLY_USED";

    return {
        limit,
        drawingPower,
        used,
        available: roundMoney(Math.max(0, drawable - used)),
        overLimitBy: roundMoney(Math.max(0, used - limit)),
        overDrawingPowerBy: cappedByDrawingPower ? roundMoney(Math.max(0, used - drawable)) : 0,
        utilizationPercent: limit > 0 ? roundMoney((used / limit) * 100) : null,
        totalDrawdowns: roundMoney(Number(totals.totalDrawdowns ?? 0)),
        totalRepayments: roundMoney(Number(totals.totalRepayments ?? 0)),
        totalInterestCharges: roundMoney(Number(totals.totalInterestCharges ?? 0)),
        status,
        reviewReasons,
    };
}
