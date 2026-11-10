// Dropline Overdraft: a drawing power that falls on dated steps. Pure rules.
// Steps are stored in loan_drawing_power_schedule (migration 053, registered
// and applied); the feature is on whenever that migration is registered.

import { DroplineDrawingPowerScheduleMigration } from "@/core/database/migrations/053_dropline_drawing_power_schedule";
import { migrations } from "@/core/database/migrations/registry";

import type { SetupIssue } from "./loanSetupTypes";

export const DROPLINE_OVERDRAFT_ENABLED: boolean = migrations.some(
    migration => migration.version === DroplineDrawingPowerScheduleMigration.version
);

export interface DrawingPowerStep {
    effectiveDate: string;
    drawingPower: number;
}

export interface DrawingPowerStepDraft {
    key: string;
    effectiveDate: string;
    drawingPower: number | null;
}

/**
 * The drawing power in force on a date: the latest step on or before it.
 * null before the first step - the sanctioned limit applies until then.
 */
export function drawingPowerOn(steps: readonly DrawingPowerStep[], date: string): number | null {
    let current: DrawingPowerStep | null = null;

    for (const step of steps) {
        if (step.effectiveDate <= date && (current === null || step.effectiveDate > current.effectiveDate)) {
            current = step;
        }
    }

    return current?.drawingPower ?? null;
}

/** Saved steps as editable rows, by date. */
export function stepDraftsFrom(steps: readonly DrawingPowerStep[]): DrawingPowerStepDraft[] {
    return [...steps]
        .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
        .map((step, index) => ({ key: `saved-${index}-${step.effectiveDate}`, effectiveDate: step.effectiveDate, drawingPower: step.drawingPower }));
}

/**
 * Editable rows back to steps, by date - only once droplineScheduleIssues
 * has none, so every row has a date and an amount.
 */
export function stepsFromDrafts(drafts: readonly DrawingPowerStepDraft[]): DrawingPowerStep[] {
    return drafts
        .map(draft => ({ effectiveDate: draft.effectiveDate, drawingPower: Number(draft.drawingPower) }))
        .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function droplineScheduleIssues(steps: readonly DrawingPowerStepDraft[], creditLimit: number | null): SetupIssue[] {
    const issues: SetupIssue[] = [];
    const seen = new Set<string>();

    if (steps.length === 0) {
        issues.push({ field: "drawingPowerSchedule", message: "Add at least one drawing-power step for a Dropline Overdraft." });
    }

    steps.forEach((step, index) => {
        const at = `Step ${index + 1}`;

        if (!ISO_DATE.test(step.effectiveDate)) {
            issues.push({ field: `drawingPowerSchedule.${index}`, message: `${at}: enter the date it takes effect.` });
        } else if (seen.has(step.effectiveDate)) {
            issues.push({ field: `drawingPowerSchedule.${index}`, message: `${at}: two steps cannot take effect on the same date.` });
        }
        seen.add(step.effectiveDate);

        if (step.drawingPower === null || !(step.drawingPower >= 0)) {
            issues.push({ field: `drawingPowerSchedule.${index}`, message: `${at}: enter the drawing power.` });
        } else if (creditLimit !== null && step.drawingPower > creditLimit) {
            issues.push({ field: `drawingPowerSchedule.${index}`, message: `${at}: drawing power cannot be more than the sanctioned limit.` });
        }
    });

    return issues;
}
