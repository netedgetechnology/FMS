import { describe, expect, it } from "vitest";

import {
    FINANCIAL_GOAL_STATUS_LABELS,
    getFinancialGoalStatusLabel,
} from "./financialGoalStatus";

// Regression coverage for the Financial Goal Details popup showing the
// raw stored enum value ("ACTIVE") instead of a human-readable label
// ("Active"). The database column is untouched - only this display
// mapping is new.
describe("getFinancialGoalStatusLabel", () => {
    it("maps every stored status to its human-readable label", () => {
        expect(getFinancialGoalStatusLabel("ACTIVE")).toBe(
            "Active"
        );
        expect(
            getFinancialGoalStatusLabel("COMPLETED")
        ).toBe("Completed");
        expect(getFinancialGoalStatusLabel("PAUSED")).toBe(
            "Paused"
        );
        expect(
            getFinancialGoalStatusLabel("CANCELLED")
        ).toBe("Cancelled");
    });

    it("covers every status the type allows, not just a subset", () => {
        expect(
            Object.keys(FINANCIAL_GOAL_STATUS_LABELS)
                .length
        ).toBe(4);
    });

    it("falls back to the raw value for an unknown status rather than crashing", () => {
        expect(
            getFinancialGoalStatusLabel("SOMETHING_NEW")
        ).toBe("SOMETHING_NEW");
    });
});
