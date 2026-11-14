import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { prepareRateChange, type RateChangeContext, type RateChangeInput } from "../../services/InterestRateChangeService";
import { LoanKind, type Loan } from "../../types";
import type { InterestRateHistoryEntry } from "../../types/InterestRateHistory";
import { InterestRateHistoryView, referenceText, sourceDetails } from "./InterestRateHistoryView";
import { RateChangeReview } from "./RateChangeReview";
import { emptyRateChangeInput } from "./RecordRateChangeDialog";

// Stage 3.3 screens, rendered to static markup (vitest runs in "node").
// Synthetic facilities only.

const facility = (loanType: string, change: Partial<Loan> = {}) =>
    ({
        id: "loan-syn",
        name: `Synthetic ${loanType}`,
        loanKind: LoanKind.OVERDRAFT,
        loanType,
        principalAmount: 0,
        interestRate: 11.25,
        interestType: "REDUCING",
        rateType: "FIXED",
        startDate: "2026-01-10",
        status: "ACTIVE",
        ...change,
    }) as unknown as Loan;

const entry = (id: string, effectiveFrom: string, rate: number, change: Partial<InterestRateHistoryEntry> = {}): InterestRateHistoryEntry => ({
    id,
    loanId: "loan-syn",
    effectiveFrom,
    effectiveUntil: null,
    rate,
    previousRate: null,
    rateType: "FIXED",
    source: "LENDER_NOTICE",
    reference: null,
    documentId: null,
    notes: null,
    appliedFromInstalment: null,
    createdAt: `${effectiveFrom}T00:00:00Z`,
    supersededBy: null,
    supersededAt: null,
    correctionReason: null,
    ...change,
});

function review(ctx: RateChangeContext, input: RateChangeInput): string {
    const result = prepareRateChange(ctx, input, { newId: (() => { let n = 0; return () => `id-${++n}`; })(), now: "2026-06-01T00:00:00Z" });
    if (result.status !== "READY") throw new Error(result.issues.map(issue => issue.message).join(" | "));
    return renderToStaticMarkup(
        createElement(RateChangeReview, {
            input,
            mode: result.mode,
            proposal: result.proposal,
            warnings: result.warnings,
            oldRate: result.oldRate,
            baseline: result.request.initialEntry
                ? { rate: result.request.initialEntry.rate, effectiveFrom: result.request.initialEntry.effectiveFrom, replaced: result.request.supersedes?.id === result.request.initialEntry.id }
                : null,
        })
    );
}

/** The value shown under a review label (SummaryGrid: label, then value). */
function shown(html: string, label: string): string | null {
    const text = html.replace(/<[^>]+>/g, "\n").split("\n").map(part => part.trim()).filter(Boolean);
    const at = text.findIndex(part => part.toLowerCase() === label.toLowerCase());
    return at >= 0 ? text[at + 1] ?? null : null;
}

describe("record-only review: old and new rate (Stage 3.2: the old rate showed '-')", () => {
    const history = [entry("e0", "2026-01-10", 11, { source: "INITIAL" }), entry("e1", "2026-03-01", 11.5, { previousRate: 11 })];

    it.each(["Overdraft", "Cash Credit", "Dropline Overdraft"])("%s with history", loanType => {
        const ctx: RateChangeContext = { available: true, loan: facility(loanType), schedule: [], linkedScheduleIds: [], history };
        const html = review(ctx, { ...emptyRateChangeInput(ctx), rate: 12, effectiveFrom: "2026-05-01" });

        expect(html).toContain('data-schedule="unchanged"');
        expect(shown(html, "Old rate")).toBe("11.5%");
        expect(shown(html, "New rate")).toBe("12%");
    });

    it.each(["Overdraft", "Cash Credit", "Dropline Overdraft"])("%s with no history: the loan's recorded rate", loanType => {
        const ctx: RateChangeContext = { available: true, loan: facility(loanType), schedule: [], linkedScheduleIds: [], history: [] };
        const html = review(ctx, { ...emptyRateChangeInput(ctx), rate: 12, effectiveFrom: "2026-04-01" });

        expect(shown(html, "Old rate")).toBe("11.25%");
        expect(shown(html, "New rate")).toBe("12%");
    });

    it.each(["Overdraft", "Cash Credit", "Dropline Overdraft"])("%s: replacing the recorded rate from the start date", loanType => {
        const ctx: RateChangeContext = { available: true, loan: facility(loanType), schedule: [], linkedScheduleIds: [], history: [] };
        const html = review(ctx, { ...emptyRateChangeInput(ctx), rate: 11.75, effectiveFrom: "2026-01-10", correctionReason: "Lender confirmed" });

        expect(html).toContain("marked corrected and replaced");
        expect(shown(html, "Old rate")).toBe("11.25%");
        expect(shown(html, "New rate")).toBe("11.75%");
    });

    it("no earlier rate known: says so instead of a bare dash", () => {
        const ctx: RateChangeContext = { available: true, loan: facility("Overdraft"), schedule: [], linkedScheduleIds: [], history: [] };
        const input = { ...emptyRateChangeInput(ctx), rate: 12, effectiveFrom: "2026-04-01" };
        const html = renderToStaticMarkup(createElement(RateChangeReview, { input, mode: { kind: "RECORD_ONLY", reason: "x" }, proposal: null, warnings: [], oldRate: null }));

        expect(shown(html, "Old rate")).toBe("Not known");
    });
});

describe("history table: compact source, readable reference, nothing lost", () => {
    const long = "SYN-NOTICE-2026-000123/ABCDEFGHIJ";
    const history = [
        entry("e0", "2026-01-10", 9.5, { source: "INITIAL", rateType: "FLOATING" }),
        entry("e1", "2026-04-10", 10.25, { previousRate: 9.5, rateType: "FLOATING", appliedFromInstalment: 16, reference: long, notes: "Synthetic revision notice" }),
    ];
    const html = renderToStaticMarkup(createElement(InterestRateHistoryView, { loan: facility("Term Loan", { loanKind: LoanKind.TERM_LOAN }), available: true, history, today: "2026-06-01", onRecord: vi.fn(), onCorrect: vi.fn() }));
    const row = html.slice(html.indexOf('data-entry="e1"'), html.indexOf("</tr>", html.indexOf('data-entry="e1"')));

    it("the source is one short line, with rate type and repricing on a short second line", () => {
        expect(sourceDetails(history[1]!)).toEqual({ label: "Lender notice", detail: "Floating · from #16", full: "Lender notice · Floating · repriced from instalment 16" });
        expect(row).toContain('<div class="whitespace-nowrap">Lender notice</div>');
        expect(row).toContain("Floating · from #16");
    });

    it("the complete source and reference stay available in the cell tooltips", () => {
        expect(row).toContain('title="Lender notice · Floating · repriced from instalment 16"');
        expect(row).toContain(`title="${long} · Synthetic revision notice"`);
        expect(referenceText(history[1]!)).toBe(`${long} · Synthetic revision notice`);
    });

    it("a long reference is truncated on screen (no wrapping, no row growth)", () => {
        // The reference column takes only the width left over, and truncates within it.
        expect(row).toMatch(/w-full max-w-0[^>]*data-reference="true"><div class="truncate">/);
    });

    it("dates, rates, change and the action never wrap; headers stay on one line", () => {
        const nowrapCells = row.match(/<td class="whitespace-nowrap/g) ?? [];
        expect(nowrapCells.length).toBe(5);
        expect(html.match(/<th class="whitespace-nowrap/g)).toHaveLength(7);
    });

    it("the previous rate sits under the change, and the Current / Upcoming marker under the rate (narrower table, nothing dropped)", () => {
        expect(row).toMatch(/data-change="true"><div>\+0\.75 pp<\/div><div class="text-\[11px\] text-slate-500">from 9\.5%<\/div>/);
        expect(html).toMatch(/10\.25%<span class="mt-0\.5 block[^"]*" data-current="true">Current<\/span>/);
        expect(html).not.toContain(">Previous<");
    });

    it("a row with no source details or reference shows just the label and a dash", () => {
        expect(sourceDetails({ source: "MANUAL", rateType: null, appliedFromInstalment: null })).toEqual({ label: "Entered manually", detail: null, full: "Entered manually" });
        expect(referenceText({ reference: null, documentId: null, notes: null })).toBeNull();
    });
});

describe("the loan's details reload their rate context whenever a dialog ends", () => {
    const read = (name: string) => readFileSync(join(__dirname, name), "utf8").replace(/\r\n/g, "\n");
    const section = read("InterestRateHistorySection.tsx");
    const dialog = read("RecordRateChangeDialog.tsx");

    it("after a save or a cancel (dialog closed), and after a refused save - only the latest load is kept", () => {
        expect(section).toMatch(/onOpenChange=\{open => \{\s*if \(open\) return;\s*setDialog\(null\);[\s\S]*?void load\(\);/);
        expect(section).toContain("onSaveRefused={() => void load()}");
        expect(section).toMatch(/if \(requests\.current\.isStale\(request\)\) return;\s*setContext\(next\);/);
        expect(dialog).toMatch(/setSaveError\(outcome\.error\);\s*if \(outcome\.error\) onSaveRefused\?\.\(\);/);
    });

    it("every new review needs a new confirmation tick (a re-prepared proposal is never pre-confirmed)", () => {
        expect(dialog).toMatch(/setPrepared\(prepareRateChange\(context, input\)\);\s*setConfirmed\(false\);/);
    });
});
