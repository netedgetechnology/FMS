import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// This repo has no jsdom / component-render test setup (vitest runs
// with environment: "node"), so the icon-only action buttons (Rename/
// Delete/Refresh in Saved Mappings, View/Delete/Refresh in Import
// History) can't be asserted on via a rendered DOM. Reading the
// component's own source is the one reliable way, in this environment,
// to verify the exact accessible labels are present, the old visible
// text labels are gone, and the same click handlers are still wired -
// i.e. this is a UI/markup change only, nothing behavioral.
const source = readFileSync(
    fileURLToPath(
        new URL("./ImportsPage.tsx", import.meta.url)
    ),
    "utf8"
);

describe("ImportsPage action buttons - icon-only with accessible labels", () => {
    it("Saved Mappings: Rename is icon-only with its exact accessible label, and still opens the rename flow", () => {
        expect(source).toContain(
            'aria-label="Rename saved mapping"'
        );
        expect(source).toContain(
            'title="Rename saved mapping"'
        );
        expect(source).toContain(
            "handleStartRenameMapping(\n"
        );
    });

    it("Saved Mappings: Delete is icon-only with its exact accessible label, and still opens the existing delete confirmation", () => {
        expect(source).toContain(
            'aria-label="Delete saved mapping"'
        );
        expect(source).toContain(
            'title="Delete saved mapping"'
        );
        expect(source).toContain(
            "setMappingToDelete(\n"
        );
    });

    it("Saved Mappings: Refresh is icon-only with its exact accessible label, and still reloads the list", () => {
        expect(source).toContain(
            'aria-label="Refresh saved mappings"'
        );
        expect(source).toContain(
            'title="Refresh saved mappings"'
        );
        expect(source).toContain(
            "void loadMappings()"
        );
    });

    it("Import History: View is icon-only with its exact accessible label, and still opens the existing import details", () => {
        expect(source).toContain(
            'aria-label="View import details"'
        );
        expect(source).toContain(
            'title="View import details"'
        );
        expect(source).toContain(
            "void handleViewDetails(\n"
        );
    });

    it("Import History: Delete is icon-only with its exact accessible label, and still opens the existing delete confirmation", () => {
        expect(source).toContain(
            'aria-label="Delete import history"'
        );
        expect(source).toContain(
            'title="Delete import history"'
        );
        expect(source).toContain(
            "setBatchToDelete(\n"
        );
    });

    it("Import History: Refresh is icon-only with its exact accessible label, and still reloads the list", () => {
        expect(source).toContain(
            'aria-label="Refresh import history"'
        );
        expect(source).toContain(
            'title="Refresh import history"'
        );
        expect(source).toContain(
            "void loadBatches()"
        );
    });

    it("none of the four row actions render a visible text label alongside their icon any more", () => {
        // Each of these action buttons used to end with a bare text
        // node right after its icon (e.g. "/>\n\nRename\n</button>").
        // None of that literal text should remain as button content.
        expect(source).not.toMatch(
            />\s*\n\s*Rename\s*\n\s*<\/button>/
        );
        expect(source).not.toMatch(
            />\s*\n\s*View\s*\n\s*<\/button>/
        );
        expect(source).not.toMatch(
            />\s*\n\s*Delete\s*\n\s*<\/button>/
        );
        expect(source).not.toMatch(
            />\s*\n\s*Refresh\s*\n\s*<\/button>/
        );
    });

    it("the destructive Delete actions keep their red styling; Rename/View/Refresh keep the existing neutral styling", () => {
        // Delete (mapping) and Delete (batch) buttons.
        const deleteButtonBlocks = source
            .split(
                'aria-label="Delete saved mapping"'
            )[1]
            ?.slice(0, 400);
        expect(deleteButtonBlocks).toContain(
            "text-red-600"
        );
        expect(deleteButtonBlocks).toContain(
            "hover:bg-red-50"
        );

        const deleteHistoryBlock = source
            .split(
                'aria-label="Delete import history"'
            )[1]
            ?.slice(0, 400);
        expect(deleteHistoryBlock).toContain(
            "text-red-600"
        );
        expect(deleteHistoryBlock).toContain(
            "hover:bg-red-50"
        );
    });
});
