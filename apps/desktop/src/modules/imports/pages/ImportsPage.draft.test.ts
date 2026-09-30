import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { AlertDialogAction } from "@/components/ui/alert-dialog";

import {
    ImportDraftBanner,
    ImportDraftSaveIndicator,
    describeUnfinishedImport,
} from "./ImportDraftRecovery";

// ---------------------------------------------------------------------
// Import Draft wiring in ImportsPage. No DOM test setup exists (vitest
// environment: "node"), so the small UI pieces are rendered to static
// markup and the page's wiring is checked against its source - the
// behavior behind it (saving, restoring, lifecycle) is covered end to end
// in importDraft.test.ts.
// ---------------------------------------------------------------------

const pageSource = readFileSync(
    path.join(__dirname, "ImportsPage.tsx"),
    "utf8"
).replace(/\r\n/g, "\n");

function functionBody(name: string): string {
    const start = pageSource.indexOf(`const ${name} = `);

    expect(start).toBeGreaterThan(-1);

    const next = pageSource.indexOf("\n    const ", start + 1);

    return pageSource.slice(start, next === -1 ? undefined : next);
}

describe("Import draft UI", () => {
    it("describes the unfinished import with a formatted row count", () => {
        expect(describeUnfinishedImport(1_407)).toBe(
            "You have an unfinished import with 1,407 rows."
        );
        expect(describeUnfinishedImport(1)).toBe(
            "You have an unfinished import with 1 row."
        );
    });

    it("shows Saving... / Saved <time> / a retry warning, nothing when idle", () => {
        const render = (status: Parameters<typeof ImportDraftSaveIndicator>[0]["status"]) =>
            renderToStaticMarkup(createElement(ImportDraftSaveIndicator, { status }));

        expect(render({ kind: "idle" })).toBe("");
        expect(render({ kind: "saving" })).toContain("Saving...");
        expect(render({ kind: "saved", at: "2026-09-28T10:15:00.000Z" })).toMatch(
            /Saved \d/
        );
        expect(render({ kind: "error", message: "locked" })).toContain(
            "Draft not saved - retrying"
        );
    });

    it("the banner names the draft and offers Resume/Discard", () => {
        const html = renderToStaticMarkup(
            createElement(ImportDraftBanner, {
                draft: {
                    id: "d",
                    formatVersion: 1,
                    accountId: "a",
                    importType: "BANK_PDF",
                    fileName: "august.pdf",
                    rowCount: 1407,
                    createdAt: "2026-09-28T09:00:00.000Z",
                    updatedAt: "2026-09-28T10:00:00.000Z",
                },
                onOpen: () => {},
            })
        );

        expect(html).toContain("You have an unfinished import with 1,407 rows.");
        expect(html).toContain("august.pdf");
        expect(html).toContain("Resume or Discard...");
    });
});

describe("Unfinished Import Found dialog buttons", () => {
    // The dialog renders through a portal, so the recovery step's footer
    // is read from source and each action is rendered with its exact
    // props to check the markup the user actually gets.
    const recoverySource = readFileSync(
        path.join(__dirname, "ImportDraftRecovery.tsx"),
        "utf8"
    ).replace(/\r\n/g, "\n");

    const footerStart = recoverySource.indexOf(
        ") : (",
        recoverySource.indexOf("<AlertDialogFooter>")
    );
    const recoveryFooter = recoverySource.slice(
        footerStart,
        recoverySource.indexOf("</AlertDialogFooter>", footerStart)
    );

    function renderAction(label: string) {
        const props = recoveryFooter
            .split("<AlertDialogAction")
            .find(chunk => chunk.includes(label));

        expect(props).toBeDefined();

        const className = props!.match(/className="([^"]+)"/)?.[1] ?? "";
        const variant = props!.match(/variant="([^"]+)"/)?.[1] as
            | "outline"
            | undefined;
        const html = renderToStaticMarkup(
            createElement(AlertDialogAction, { className, variant }, label)
        );
        const classes = new Set(
            (html.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/)
        );

        return { variant, html, classes };
    }

    it("keeps Discard Draft before Resume Import", () => {
        const discard = recoveryFooter.indexOf("Discard Draft");

        expect(discard).toBeGreaterThan(-1);
        expect(discard).toBeLessThan(recoveryFooter.indexOf("Resume Import"));
    });

    it("both actions are real buttons with the same FinWea dialog button sizing", () => {
        for (const label of ["Discard Draft", "Resume Import"]) {
            const { html, classes } = renderAction(label);

            expect(html).toMatch(/^<button[^>]*>/);
            expect(html).toContain(label);

            for (const cls of ["h-9", "rounded-lg", "px-4", "text-sm", "font-medium"]) {
                expect(classes).toContain(cls);
            }
        }
    });

    it("Resume Import is the filled primary action", () => {
        const { variant, classes } = renderAction("Resume Import");

        expect(variant).toBeUndefined();
        expect(classes).toContain("bg-slate-900");
        expect(classes).toContain("text-white");
        expect(classes).toContain("hover:bg-slate-800");
    });

    it("Discard Draft is the bordered secondary action", () => {
        const { variant, classes } = renderAction("Discard Draft");

        expect(variant).toBe("outline");
        expect(classes).toContain("border");
        expect(classes).toContain("border-slate-300");
        expect(classes).toContain("bg-white");
        expect(classes).toContain("text-slate-700");
        expect(classes).not.toContain("bg-slate-900");
    });
});

describe("ImportsPage draft wiring", () => {
    it("refresh recovery: looks for a saved draft on mount and opens the recovery dialog", () => {
        expect(pageSource).toMatch(
            /draftStore\s*\.getSummary\(\)\s*\.then\(summary => \{\s*if \(!cancelled && summary\) \{\s*setStoredDraft\(summary\);\s*setRecoveryDialogOpen\(true\);/
        );
        expect(pageSource).toContain("<ImportDraftRecoveryDialog");
    });

    it("auto-saves every piece of preview state the screen is built from", () => {
        const start = pageSource.indexOf("draftSaver.schedule({");
        const effect = pageSource.slice(start, pageSource.indexOf("]);", start));

        for (const field of [
            "preview,",
            "accountId: selectedAccountId",
            "importType,",
            "file: draftFile",
            "mappingName,",
            "matchedMapping,",
            "overrides: previewOverrides",
            "selfLearningDisabledRows,",
            "categoryScope,",
            "showAffectedRowsOnly,",
        ]) {
            expect(effect).toContain(field);
        }
    });

    it("resume restores every piece of that state", () => {
        const resume = functionBody("handleResumeDraft");

        for (const call of [
            "setSelectedAccountId(state.accountId)",
            "setImportType(state.importType)",
            "setPreview(restored.preview)",
            "setMappingName(state.mappingName)",
            "setMatchedMapping(state.matchedMapping)",
            "setPreviewOverrides(state.overrides)",
            "state.selfLearningDisabledRows",
            "setCategoryScope(state.categoryScope)",
            "setShowAffectedRowsOnly(state.showAffectedRowsOnly)",
            "setDraftFile(state.file)",
            "parseImportDraft(record)",
        ]) {
            expect(resume).toContain(call);
        }

        // A damaged draft is reported, never thrown out of the handler.
        expect(resume).toContain("setDraftRecoveryError(");
    });

    it("a draft is deleted only by an explicit discard or a committed import", () => {
        const deletes = pageSource.match(/draftStore\.delete\(/g) ?? [];

        expect(deletes).toHaveLength(1);
        expect(functionBody("handleDiscardDraft")).toContain(
            "draftStore.delete(discardedId)"
        );
        expect(functionBody("handleImport")).toContain("runImportWithDraft({");

        // Selecting another file or closing the preview never touches it.
        expect(functionBody("handleFileChange")).not.toMatch(/draftStore|draftSaver/);
        expect(functionBody("closePreview")).not.toMatch(/draftStore|draftSaver/);
    });

    it("a new preview asks before replacing an unfinished draft", () => {
        const preview = functionBody("handlePreview");
        const check = preview.indexOf("requiresDraftReplacementConfirmation(");

        expect(check).toBeGreaterThan(-1);
        expect(check).toBeLessThan(preview.indexOf("setPreview("));
        expect(preview).toContain("setReplaceDraftDialogOpen(true);");
        expect(pageSource).toContain("<ReplaceImportDraftDialog");
    });

    it("a restored preview (no File any more) imports under its saved file name", () => {
        const importBody = functionBody("handleImport");

        expect(importBody).toContain("hasFile: !!sourceFileName");
        expect(importBody).not.toContain("selectedFile.name");
        expect(pageSource).toContain(
            "draftFile?.name ?? selectedFile?.name ?? null"
        );
    });

    it("guards reload/close while a save is outstanding, and flushes on leave", () => {
        expect(pageSource).toContain('addEventListener("beforeunload"');
        expect(pageSource).toContain("draftSaver.hasUnsavedChanges()");
        expect(pageSource).toMatch(/removeEventListener\([\s\S]*?void draftSaver\.flush\(\);/);
    });

    it("shows the save status in the Import Preview header", () => {
        expect(pageSource).toContain(
            "<ImportDraftSaveIndicator\n                                status={draftSaveStatus}"
        );
    });
});
