import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import type { RateChange } from "@financeos/import-engine";

import { rateReviewFromFacility, setOriginalRate } from "../../statementImport/statementRateProposals";
import { LoanKind } from "../../types";
import { StatementRateConfirmation, StatementRateProposals, ratesBefore } from "./StatementRateProposals";

// Stage 4 screens, rendered to static markup (vitest runs in "node").
// Synthetic statement lines only.

const change = (effectiveDate: string | null, rate: number, previousRate: number | null, extra: Partial<RateChange> = {}): RateChange => ({
    effectiveDate,
    rate,
    previousRate,
    page: 2,
    raw: `${effectiveDate ?? "--"} SYNTHETIC interest rate changed from ${previousRate ?? "?"}% to ${rate}%`,
    origin: "TEXT",
    datesInText: effectiveDate ? [effectiveDate] : [],
    ...extra,
});

const REVIEW = rateReviewFromFacility(
    {
        rateHistory: [
            change("2026-09-01", 12, 11.75),
            change("2026-06-01", 11.75, 11.25, { origin: "TABLE", page: 1 }),
            change(null, 12.5, 12),
            change("2026-10-05", 12.25, 12, { datesInText: ["2026-10-05", "2026-09-20"] }),
        ],
    },
    "Floating"
);

const render = (props: Partial<Parameters<typeof StatementRateProposals>[0]> = {}) =>
    renderToStaticMarkup(createElement(StatementRateProposals, { review: REVIEW, available: true, onChange: vi.fn(), onOriginalRateChange: vi.fn(), ...props }));

describe("statement review: proposed rate changes", () => {
    it("without migration 054: listed for information only - nothing to edit, confirm or save", () => {
        const html = render({ available: false });

        expect(html).toContain('data-rates="information-only"');
        expect(html).toContain("not saved with the loan");
        expect(html).not.toContain("<input");
        expect(html).not.toContain('data-rates="proposals"');
    });

    it("each change is labelled Proposed, with its page, how it was read and the statement's own line", () => {
        const html = render();

        expect(html.match(/>Proposed</g)).toHaveLength(4);
        expect(html).toContain("Page 1 · rate table row");
        expect(html).toContain("Page 2 · statement text");
        expect(html).toContain("SYNTHETIC interest rate changed from 11.25% to 11.75%");
        expect(html).toContain("Rate type taken from the statement&#x27;s interest type");
    });

    it("rows run in date order; the undated one last and unresolved", () => {
        const html = render();
        const order = [...html.matchAll(/data-proposal="(r-\d)"/g)].map(match => match[1]);

        expect(order).toEqual(["r-1", "r-0", "r-3", "r-2"]);
        expect(html).toMatch(/data-proposal="r-2" data-state="unresolved"/);
        expect(html).toContain("gives no effective date");
    });

    it("an ambiguous date offers every date on the line - the customer chooses", () => {
        const html = render();

        expect(html).toMatch(/data-proposal="r-3" data-state="unresolved"/);
        expect(html).toContain('data-ambiguous-dates="true"');
        expect(html).toContain("Use 05/10/2026");
        expect(html).toContain("Use 20/09/2026");
    });

    it("shows the previous rate from the timeline, with the printed one beside it", () => {
        expect(ratesBefore(REVIEW).get("r-0")).toBe(11.75);
        expect(render()).toContain("(printed 11.75%)");
    });

    it("an unknown original rate says it is never guessed", () => {
        const html = render({ review: setOriginalRate(REVIEW, null) });
        expect(html).toContain("it is never guessed");
    });

    it("no rate changes in the statement: nothing is shown at all", () => {
        expect(render({ review: rateReviewFromFacility({ rateHistory: [] }) })).toBe("");
    });
});

describe("the separate confirmation at the final save", () => {
    const resolved = rateReviewFromFacility({ rateHistory: [change("2026-06-01", 11.75, 11.25), change("2027-01-01", 12, 11.75)] }, null);
    const confirm = (review = resolved, kind = LoanKind.OVERDRAFT, loanRate = 11.75) =>
        renderToStaticMarkup(
            createElement(StatementRateConfirmation, {
                review,
                context: { loanKind: kind, startDate: "2026-04-01", loanRate, today: "2026-11-12" },
                confirmed: false,
                onConfirmedChange: vi.fn(),
                termLoan: kind === LoanKind.TERM_LOAN,
            })
        );

    it("OD: lists the original rate and each change (upcoming marked), with its own tick", () => {
        const html = confirm();

        expect(html).toContain("Original rate from the start date (01/04/2026): 11.25%");
        expect(html).toContain("01/01/2027: 12% · upcoming");
        expect(html).toContain("Record them with the loan.");
        expect(html).toContain('role="checkbox"');
        expect(html).toContain("The schedule and drawing power are not recalculated.");
    });

    it("Term Loan: explains nothing is recalculated before each change's own review", () => {
        const html = confirm(resolved, LoanKind.TERM_LOAN, 11.25);

        expect(html).toContain("Recorded after the loan is created - one at a time, each with its own review.");
        expect(html).toContain("Nothing is recalculated before that.");
    });

    it("while anything is unresolved there is no tick - only what to fix", () => {
        const html = confirm(resolved, LoanKind.OVERDRAFT, 12.5);

        expect(html).not.toContain('role="checkbox"');
        expect(html).toContain("but the loan&#x27;s interest rate is 12.5%");
    });
});

describe("wiring (source): saves only after both ticks, and only where it belongs", () => {
    const read = (path: string) => readFileSync(join(__dirname, path), "utf8").replace(/\r\n/g, "\n");

    it("the wizard attaches the history only for an Overdraft-kind loan, after its own tick", () => {
        const wizard = read("AddLoanWizard.tsx");
        expect(wizard).toContain("draft.loanKind === LoanKind.OVERDRAFT && hasRateProposals(statementRates.review)");
        expect(wizard).toMatch(/if \(stepIssues\("review"\)\.length > 0 \|\| !confirmed \|\| !ratesReady\) return;/);
        expect(wizard).toContain("disabled={loading || !confirmed || !ratesReady}");
    });

    it("a statement Term Loan is created without the changes, which go to the follow-up step", () => {
        const setup = read("StatementLoanSetup.tsx");
        expect(setup).toContain("await onSave(request, rateChanges);");
        expect(setup).not.toContain("statementRateHistory");
        const dialog = read("../AddLoanDialog.tsx");
        expect(dialog).toContain("setRateFollowUp({ loanId: result.loanId, confirmed: rateChanges });");
    });

    it("without rate history nothing about rates is carried to the wizard", () => {
        const panel = read("StatementImportPanel.tsx");
        expect(panel).toContain("rateHistory: rateHistoryAvailable ? result.rateHistory : null");
    });
});

describe("pre-activation audit M1: every statement rate change left out (OD)", () => {
    const allOut = (() => {
        let review = REVIEW;
        for (const proposal of REVIEW.proposals) review = { ...review, proposals: review.proposals.map(item => (item.key === proposal.key ? { ...item, included: false } : item)) };
        return review;
    })();

    it("says nothing is recorded and the loan's own rate applies, and still asks for an explicit tick", () => {
        const html = renderToStaticMarkup(
            createElement(StatementRateConfirmation, {
                review: allOut,
                context: { loanKind: LoanKind.OVERDRAFT, startDate: "2026-04-01", loanRate: 12.25, today: "2026-11-12" },
                confirmed: false,
                onConfirmedChange: vi.fn(),
                termLoan: false,
            })
        );
        expect(html).toContain('data-rates-all-left-out="true"');
        expect(html).toContain(`You left out all ${REVIEW.proposals.length} rate change(s) the statement prints. None is recorded`);
        expect(html).toContain("its own rate of 12.25%");
        expect(html).toContain("Save the loan without them.");
        expect(html).not.toContain('data-issue="blocking"');
    });

    it("the wizard sends a statement history only when one change or more is included", () => {
        const wizard = readFileSync(join(__dirname, "AddLoanWizard.tsx"), "utf8");
        expect(wizard).toContain("overdraftStatementRateHistoryFor(statementRates!.review, rateContext, statementRates!.fileName)");
        expect(wizard).toMatch(/if \(history\) request = \{ \.\.\.request, statementRateHistory: history \};/);
        expect(wizard).not.toContain("overdraftStatementRateHistory(confirmedStatementRates(");
    });
});
