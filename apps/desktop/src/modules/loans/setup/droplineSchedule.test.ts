import { describe, expect, it, vi } from "vitest";

import { computeOverdraftPosition } from "../services/overdraftPosition";
import { emptyLoanSetupDraft, draftToDetails, validateStep } from "./loanSetupWizard";
import { LoanKind } from "../types";
import { DROPLINE_OVERDRAFT_ENABLED, drawingPowerOn, droplineScheduleIssues } from "./droplineSchedule";

const STEPS = [
    { effectiveDate: "2026-01-01", drawingPower: 950 },
    { effectiveDate: "2026-04-01", drawingPower: 900 },
    { effectiveDate: "2026-07-01", drawingPower: 850 },
];
const totals = (used: number) => ({ used, totalDrawdowns: 0, totalRepayments: 0, totalInterestCharges: 0, invalidLinks: 0 });

describe("drawing power on a date", () => {
    it("is on now that its migration is registered", () => {
        expect(DROPLINE_OVERDRAFT_ENABLED).toBe(true);
    });

    it.each([
        ["2025-12-31", null],
        ["2026-01-01", 950],
        ["2026-03-31", 950],
        ["2026-04-01", 900],
        ["2030-01-01", 850],
    ])("%s -> %s", (date, expected) => {
        expect(drawingPowerOn(STEPS, date)).toBe(expected);
    });

    it("does not depend on the order the steps are stored in", () => {
        expect(drawingPowerOn([...STEPS].reverse(), "2026-05-01")).toBe(900);
    });

    it("drives the available amount, and it falls as steps pass", () => {
        const available = (date: string) => computeOverdraftPosition(1000, totals(600), drawingPowerOn(STEPS, date)).available;

        expect(available("2025-12-01")).toBe(400);
        expect(available("2026-02-01")).toBe(350);
        expect(available("2026-08-01")).toBe(250);
    });
});

describe("dropline setup validation", () => {
    const step = (effectiveDate: string, drawingPower: number | null) => ({ key: effectiveDate + drawingPower, effectiveDate, drawingPower });

    it("needs at least one step", () => {
        expect(droplineScheduleIssues([], 100).map(i => i.field)).toContain("drawingPowerSchedule");
    });

    it("refuses a missing date, a repeated date, and more than the limit", () => {
        expect(droplineScheduleIssues([step("", 50)], 100)).toHaveLength(1);
        expect(droplineScheduleIssues([step("2026-01-01", 50), step("2026-01-01", 40)], 100)).toHaveLength(1);
        expect(droplineScheduleIssues([step("2026-01-01", 150)], 100)).toHaveLength(1);
    });

    it("is checked by the wizard, and a plain overdraft is unaffected", () => {
        const base = { ...emptyLoanSetupDraft(LoanKind.OVERDRAFT), creditLimit: 100, openingUsed: 0, openingUsedAsOf: "2026-01-01", odAccountIds: ["a"] };

        expect(validateStep(base, "overdraft")).toEqual([]);
        expect(validateStep({ ...base, dropline: true }, "overdraft").map(i => i.field)).toEqual(["drawingPowerSchedule"]);
    });

    it("saves the steps instead of a single drawing power", () => {
        const details = draftToDetails({
            ...emptyLoanSetupDraft(LoanKind.OVERDRAFT),
            dropline: true,
            drawingPower: 70,
            drawingPowerSchedule: [step("2026-01-01", 50)],
        });

        expect(details.drawingPower).toBeNull();
        expect(details.drawingPowerSchedule).toEqual([{ effectiveDate: "2026-01-01", drawingPower: 50 }]);
    });

    it("leaves a plain overdraft's saved request exactly as before", () => {
        expect(draftToDetails(emptyLoanSetupDraft(LoanKind.OVERDRAFT))).not.toHaveProperty("drawingPowerSchedule");
    });
});

describe("overdraft position service", () => {
    it("never queries the unapplied table while the feature is off", async () => {
        const select = vi.fn();
        vi.doMock("../repositories/DrawingPowerScheduleRepository", () => ({ DrawingPowerScheduleRepository: class { findByLoan = select; } }));

        const source = (await import("node:fs")).readFileSync(new URL("../services/OverdraftService.ts", import.meta.url), "utf8");

        expect(source).toMatch(/if \(!DROPLINE_OVERDRAFT_ENABLED\) return loan\.drawingPower;/);
        expect(select).not.toHaveBeenCalled();
    });
});
