import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// "New Import" form: Import Type | Account | Statement File on one row.
const page = readFileSync(path.resolve(__dirname, "ImportsPage.tsx"), "utf8");

const start = page.indexOf('data-testid="new-import-fields"');
const grid = page.slice(start, page.indexOf("{selectedFile && (", start));

describe("New Import field row", () => {
    it("lays the three fields out as one top-aligned, equal-width row (stacking only on narrow screens)", () => {
        expect(start).toBeGreaterThan(-1);
        expect(grid).toContain(
            'className="mt-7 grid grid-cols-1 items-start gap-5 sm:grid-cols-3"'
        );
    });

    it("contains Import Type, Account and Statement File in that order, each a shrinkable column", () => {
        const positions = ["Import Type", "Account", "Statement File"].map(
            label => grid.indexOf(label)
        );

        expect(positions.every(position => position > -1)).toBe(true);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
        expect(grid.split('<div className="min-w-0">').length - 1).toBe(3);
    });

    it("gives every label the same single-line height so the controls start on the same row", () => {
        const labelClass =
            'className="mb-2 block truncate text-sm font-medium leading-5 text-slate-700"';

        expect(grid.split(labelClass).length - 1).toBe(3);
        // Every control keeps its existing fixed height.
        expect(grid.split("h-11 w-full").length - 1).toBe(3);
    });
});

describe("New Import action buttons", () => {
    const actionsStart = page.indexOf('data-testid="import-actions"');
    const actions = page.slice(actionsStart, page.indexOf("</section>", actionsStart));

    it("1. do not include Custom Rules (it lives in the Import Preview header)", () => {
        expect(actions).not.toContain("Custom Rules");
        expect(actions).not.toContain("manage-custom-rules");
        expect(actions).not.toContain("setCustomRulesOpen");
    });

    it("share one centred row (right-aligned, wrapping as a group on narrow screens)", () => {
        expect(actionsStart).toBeGreaterThan(-1);
        expect(actions).toContain(
            'className="mt-6 flex flex-wrap items-center justify-end gap-3"'
        );
    });

    it("contains every action button, each keeping the same fixed height", () => {
        // 3. Preview / Clear Preview / Confirm & Import stay together here.
        for (const label of ["Clear Preview", '"Preview"', '"Confirm & Import"']) {
            expect(actions).toContain(label);
        }

        const buttons = actions.split("<button").length - 1;
        expect(buttons).toBe(3);
        expect(actions.split("inline-flex h-10 items-center gap-2").length - 1).toBe(3);
    });
});
