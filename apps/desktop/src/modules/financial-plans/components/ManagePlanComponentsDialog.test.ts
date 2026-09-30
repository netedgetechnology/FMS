import { describe, expect, it } from "vitest";

import { getPlanComponentDisplayTitle } from "./DeletePlanComponentDialog";
import { resolveEditedComponentLabel } from "./ManagePlanComponentsDialog";

// This repo has no jsdom / component-render test setup (vitest runs with
// environment: "node") - see DeletePlanComponentDialog.test.ts for the same
// convention - so the edit form's label-initialization/save behavior is
// exercised through the exported pure functions instead of rendering the
// dialog.

describe("edit-form label pre-fill (getPlanComponentDisplayTitle)", () => {
    it("pre-fills the effective display label when there is no explicit label", () => {
        // "Salary" component: no stored label, source name is "Salary".
        expect(
            getPlanComponentDisplayTitle({
                label: null,
                sourceName: "Salary",
            })
        ).toBe("Salary");
    });

    it("pre-fills the explicit label when one is stored", () => {
        expect(
            getPlanComponentDisplayTitle({
                label: "Primary Income",
                sourceName: "Salary",
            })
        ).toBe("Primary Income");
    });
});

describe("resolveEditedComponentLabel", () => {
    it("keeps persisting null when the fallback label is saved unchanged", () => {
        expect(
            resolveEditedComponentLabel({
                enteredLabel: "Salary",
                initialLabel: "Salary",
                hasExplicitLabel: false,
            })
        ).toBeNull();
    });

    it("persists the new value when the user changes the fallback label", () => {
        expect(
            resolveEditedComponentLabel({
                enteredLabel: "Primary Income",
                initialLabel: "Salary",
                hasExplicitLabel: false,
            })
        ).toBe("Primary Income");
    });

    it("persists null when the user clears the fallback label", () => {
        expect(
            resolveEditedComponentLabel({
                enteredLabel: "   ",
                initialLabel: "Salary",
                hasExplicitLabel: false,
            })
        ).toBeNull();
    });

    it("keeps an explicit label unchanged when saved as-is", () => {
        expect(
            resolveEditedComponentLabel({
                enteredLabel: "Primary Income",
                initialLabel: "Primary Income",
                hasExplicitLabel: true,
            })
        ).toBe("Primary Income");
    });

    it("still persists an explicit label even if it matches the source name", () => {
        // An explicit label equal to the source name is a deliberate user
        // choice, not the unedited fallback - it must still be written.
        expect(
            resolveEditedComponentLabel({
                enteredLabel: "Salary",
                initialLabel: "Salary",
                hasExplicitLabel: true,
            })
        ).toBe("Salary");
    });

    it("persists null when an explicit label is cleared out", () => {
        expect(
            resolveEditedComponentLabel({
                enteredLabel: "",
                initialLabel: "Primary Income",
                hasExplicitLabel: true,
            })
        ).toBeNull();
    });
});
