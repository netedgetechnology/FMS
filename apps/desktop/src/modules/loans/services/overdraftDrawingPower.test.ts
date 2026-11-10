import { describe, expect, it } from "vitest";

import { buildOverdraftViewModel } from "../components/ViewLoanDialog";
import { buildOverdraftRow } from "../pages/loansPageSections";
import { LoanKind, type Loan } from "../types";
import { drawingPowerValue } from "../validation";
import { computeOverdraftPosition } from "./overdraftPosition";

// ---------------------------------------------------------------------
// A drawing power below the limit - how a Cash Credit (drawing power from
// stock / book debts) and a Dropline Overdraft work - is the ceiling that
// matters. An Overdraft with no drawing power recorded behaves exactly as
// before: the limit is the ceiling.
// ---------------------------------------------------------------------

const totals = (used: number) => ({ used, totalDrawdowns: 0, totalRepayments: 0, totalInterestCharges: 0, invalidLinks: 0 });

describe("the Drawing Power field's value", () => {
    // The Edit form opened for a facility with a saved drawing power hands
    // the saved number straight back - it used to crash calling .trim() on it.
    it.each([
        ["600000", 600000],
        ["  ", null],
        ["", null],
        [600000, 600000],
        [0, 0],
        [null, null],
        [undefined, null],
        [Number.NaN, null],
    ] as const)("%j -> %j", (input, expected) => {
        expect(drawingPowerValue(input)).toBe(expected);
    });
});

describe("usage status against the drawing power", () => {
    it.each([
        [0, "NOT_USED", 600, 0, 0],
        [300, "PARTLY_USED", 300, 0, 0],
        [600, "FULLY_USED", 0, 0, 0],
        [750, "OVER_DRAWING_POWER", 0, 0, 150],
        [1000, "OVER_DRAWING_POWER", 0, 0, 400],
        [1100, "OVER_LIMIT", 0, 100, 500],
    ] as const)("used %d of a 1,000 limit with drawing power 600: %s", (used, status, available, overLimitBy, overDrawingPowerBy) => {
        expect(computeOverdraftPosition(1000, totals(used), 600)).toMatchObject({
            status,
            available,
            overLimitBy,
            overDrawingPowerBy,
        });
    });

    it.each([
        [null, 0, "NOT_USED"],
        [null, 400, "PARTLY_USED"],
        [null, 1000, "FULLY_USED"],
        [null, 1200, "OVER_LIMIT"],
        // A drawing power at (or recorded above) the limit changes nothing.
        [1000, 1000, "FULLY_USED"],
        [1000, 400, "PARTLY_USED"],
    ] as const)("drawing power %s, used %d: the limit is the ceiling, as before (%s)", (drawingPower, used, status) => {
        const position = computeOverdraftPosition(1000, totals(used), drawingPower);

        expect(position.status).toBe(status);
        expect(position.overDrawingPowerBy).toBe(0);
    });

    it("never hides a review reason behind a drawing-power status", () => {
        expect(computeOverdraftPosition(1000, { ...totals(750), invalidLinks: 1 }, 600).status).toBe("NEEDS_REVIEW");
    });
});

const cashCredit: Loan = {
    id: "cc-1",
    loanKind: LoanKind.OVERDRAFT,
    loanType: "Cash Credit",
    name: "Working capital",
    accountId: "acct-cc",
    linkedAccountIds: ["acct-cc"],
    lenderInstitutionId: null,
    currencyId: "cur-inr",
    principalAmount: 0,
    interestRate: 9.25,
    interestType: "REDUCING",
    tenureMonths: null,
    emiAmount: null,
    startDate: "2026-04-01",
    maturityDate: null,
    outstandingPrincipal: 0,
    outstandingInterest: 0,
    paidInstallments: 0,
    status: "ACTIVE",
    creditLimit: 1000,
    openingUsed: 750,
    openingUsedAsOf: "2026-04-01",
    drawingPower: 600,
} as Loan;

const resolved = {
    lenderName: "",
    linkedAccountNames: ["CC Account"],
    currencyLabel: "INR",
    formatMoney: (value: number) => value.toFixed(2),
    formatDate: (value: string) => value,
};

describe("a Cash Credit drawn beyond its drawing power", () => {
    const position = computeOverdraftPosition(cashCredit.creditLimit, totals(750), cashCredit.drawingPower);

    it("is a warning on the Loans page", () => {
        const row = buildOverdraftRow(cashCredit, position, new Map());

        expect(row.usageStatusLabel).toBe("Over Drawing Power");
        expect(row.usageWarning).toBe(true);
    });

    it("is named as a Cash Credit and shows its drawing power in the View dialog", () => {
        const model = buildOverdraftViewModel(cashCredit, position, resolved);

        expect(model.facilityLabel).toBe("Cash Credit");
        expect(model.headline[0]!.label).toBe("Sanctioned Limit");
        expect(model.overLimitNote).toBe("Over drawing power by 150.00");
        expect(model.details).toContainEqual({ label: "Facility Type", value: "Cash Credit" });
        expect(model.details).toContainEqual({ label: "Drawing Power in Use", value: "600.00" });
        expect(model.drawingPowerSchedule).toEqual([]);
    });

    it("says when no drawing power is recorded", () => {
        const model = buildOverdraftViewModel({ ...cashCredit, drawingPower: null }, computeOverdraftPosition(1000, totals(300), null), resolved);

        expect(model.details).toContainEqual({ label: "Drawing Power in Use", value: "Not recorded - the limit applies" });
        expect(model.overLimitNote).toBeNull();
    });
});
