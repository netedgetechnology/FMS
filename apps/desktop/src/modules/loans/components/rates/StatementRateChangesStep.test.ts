import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

const tauriInvoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriInvoke }));

import type { ConfirmedRateChange } from "../../statementImport/statementRateProposals";
import { FollowUpList, UnrecordedConfirmation } from "./StatementRateChangesStep";

// ---------------------------------------------------------------------
// Pre-activation audit H1: a statement Term Loan's confirmed rate changes
// are never dropped silently after the loan is created. No DOM test setup
// exists (vitest environment "node"), so the parts are rendered to static
// markup and the dialog's close guard is checked in its source.
// Synthetic changes only.
// ---------------------------------------------------------------------

const changes: ConfirmedRateChange[] = [
    { key: "r-0", effectiveFrom: "2026-04-10", rate: 10.25, rateType: null, reference: "synthetic-term.pdf, page 2", notes: "" },
    { key: "r-1", effectiveFrom: "2026-08-10", rate: 10.5, rateType: null, reference: "synthetic-term.pdf, page 2", notes: "" },
];

const list = (props: Partial<Parameters<typeof FollowUpList>[0]> = {}) =>
    renderToStaticMarkup(
        createElement(FollowUpList, {
            changes,
            statuses: {},
            confirmingSkip: null,
            today: "2026-11-12",
            onRecord: vi.fn(),
            onAskSkip: vi.fn(),
            onConfirmSkip: vi.fn(),
            onCancelSkip: vi.fn(),
            ...props,
        })
    );

describe("H1: Do not record needs its own confirmation, per change", () => {
    it("offers Review and record / Do not record on the next change only, with no confirmation yet", () => {
        const html = list();
        expect(html.match(/Do not record/g)).toHaveLength(1);
        expect(html).not.toContain("data-confirm-skip");
    });

    it("Do not record only asks: the change stays pending, with an explicit Leave it unrecorded", () => {
        const html = list({ confirmingSkip: "r-0" });
        expect(html).toContain('data-confirm-skip="r-0"');
        expect(html).toContain("Leave 10.25% from 10/04/2026 unrecorded?");
        expect(html).toContain("Leave it unrecorded");
        expect(html).toContain('data-follow-up="r-0" data-status="PENDING"');
        // The buttons are replaced by the question while it is open.
        expect(html).not.toContain("Do not record");
    });

    it("a change left out is shown as Not recorded", () => {
        const html = list({ statuses: { "r-0": "SKIPPED" } });
        expect(html).toContain('data-follow-up="r-0" data-status="SKIPPED"');
        expect(html).toContain("Not recorded");
    });
});

describe("H1: finishing or closing with unrecorded changes lists them first", () => {
    it("names each change and its statement reference, and both choices", () => {
        const html = renderToStaticMarkup(createElement(UnrecordedConfirmation, { unrecorded: changes, action: "Close", onConfirm: vi.fn(), onCancel: vi.fn() }));
        expect(html).toContain("Close without recording 2 rate change(s)?");
        expect(html).toContain("10.25% from 10/04/2026");
        expect(html).toContain("10.5% from 10/08/2026");
        expect(html).toContain("synthetic-term.pdf, page 2");
        expect(html).toContain("not saved anywhere");
        expect(html).toContain("Keep recording");
        expect(html).toContain("Close and leave them unrecorded");
    });
});

describe("H1: wiring (source)", () => {
    const read = (path: string) => readFileSync(join(__dirname, path), "utf8");
    const dialog = read("../AddLoanDialog.tsx");
    const step = read("./StatementRateChangesStep.tsx");

    it("the dialog's close (X / Escape / outside click) is refused while changes are unrecorded, and asks instead", () => {
        const handler = dialog.slice(dialog.indexOf("function handleOpenChange"), dialog.indexOf("function finishFollowUp"));
        expect(handler).toMatch(/else if \(rateFollowUp\) \{[\s\S]*unrecorded\.changes\.length > 0[\s\S]*setCloseRequested\(true\);\s*return;/);
        expect(dialog).toMatch(/<UnrecordedConfirmation[\s\S]*action="Close"/);
    });

    it("the unrecorded list starts as every confirmed change, before the step has loaded", () => {
        expect(dialog).toMatch(/setUnrecorded\(\{ changes: rateChanges\.changes/);
    });

    it("finishing announces what was left unrecorded, until dismissed", () => {
        const finish = dialog.slice(dialog.indexOf("function finishFollowUp"));
        expect(finish).toMatch(/unrecordedNotice\(loanName, left\)/);
        expect(finish).toMatch(/toast\.warning\(notice, \{ duration: Infinity/);
    });

    it("Finish asks first when anything is unrecorded; cancelling a review leaves the change pending", () => {
        expect(step).toMatch(/function finish\(\) \{\s*if \(unrecorded\.length > 0\) \{\s*setConfirmingFinish\(true\);\s*return;/);
        expect(step).not.toMatch(/onClick=\{onDone\}/);
        const close = step.slice(step.indexOf("onOpenChange={next =>"), step.indexOf("onSaved="));
        expect(close).not.toContain("SKIPPED");
    });
});
