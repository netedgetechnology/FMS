import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

import { OverdraftEntryKind } from "../types";
import {
    LINK_DIALOG_LAYOUT,
    LinkTransactionSummary,
    canLinkEmiChoice,
    canLinkOverdraftChoice,
} from "./LinkTransactionToEmiDialog";

// The Link to Loan / Overdraft dialog: when Link is enabled, and a layout
// that can't be pushed wider than the dialog by a long bank narration.
// (vitest runs in "node" - no browser layout - so the layout is checked
// through its classes and the rendered summary markup.)

const { DRAWDOWN, REPAYMENT, INTEREST_CHARGE } = OverdraftEntryKind;

// The real shape of the reported row's narration: one unbroken token.
const LONG_NARRATION =
    "RTGS/ICICR42026091600579106/TATA CAPITAL LIMITED/ICICI BANK LIMITED//URGENT/700020278710234077R01";

describe("Link button - Overdraft", () => {
    const outgoing = { refusal: null, kinds: [REPAYMENT, INTEREST_CHARGE] };
    const base = { saving: false, options: { refusal: null }, overdraft: outgoing, entryKind: null };

    it("stays disabled while the opening-date (or any) refusal applies, whatever kind is chosen", () => {
        const refused = {
            refusal: "This transaction is dated 2026-09-16, on or before 2026-10-08 - TATA Capital's Opening Used As Of date ...",
            kinds: [REPAYMENT, INTEREST_CHARGE],
        };

        expect(canLinkOverdraftChoice({ ...base, overdraft: refused, entryKind: REPAYMENT })).toBe(false);
        expect(canLinkOverdraftChoice({ ...base, overdraft: refused, entryKind: INTEREST_CHARGE })).toBe(false);
        expect(canLinkOverdraftChoice({ ...base, options: { refusal: "not a loan category" }, entryKind: REPAYMENT })).toBe(false);
    });

    it("with no refusal, needs the user's choice of movement - never assumed", () => {
        expect(canLinkOverdraftChoice(base)).toBe(false);
        expect(canLinkOverdraftChoice({ ...base, entryKind: REPAYMENT })).toBe(true);
        expect(canLinkOverdraftChoice({ ...base, entryKind: INTEREST_CHARGE })).toBe(true);
    });

    it("a kind the direction doesn't allow, no overdraft, still loading, or saving -> disabled", () => {
        expect(canLinkOverdraftChoice({ ...base, entryKind: DRAWDOWN })).toBe(false);
        expect(canLinkOverdraftChoice({ ...base, overdraft: null, entryKind: REPAYMENT })).toBe(false);
        expect(canLinkOverdraftChoice({ ...base, options: null, entryKind: REPAYMENT })).toBe(false);
        expect(canLinkOverdraftChoice({ ...base, saving: true, entryKind: REPAYMENT })).toBe(false);
    });
});

describe("Link Payment button - Term Loan EMI (unchanged)", () => {
    const base = {
        saving: false,
        options: { refusal: null },
        loanSelected: true,
        installment: { modes: ["partial", "settle"] as const },
        mode: "partial" as const,
        needsDuplicateConfirmation: false,
        confirmedNotDuplicate: false,
    };

    it("enabled for a valid instalment and mode", () => {
        expect(canLinkEmiChoice(base)).toBe(true);
    });

    it("disabled without a mode, with a mode the amount doesn't fit, or a refusal", () => {
        expect(canLinkEmiChoice({ ...base, mode: null })).toBe(false);
        expect(canLinkEmiChoice({ ...base, mode: "full" as never })).toBe(false);
        expect(canLinkEmiChoice({ ...base, options: { refusal: "x" } })).toBe(false);
        expect(canLinkEmiChoice({ ...base, loanSelected: false })).toBe(false);
    });

    it("a possible duplicate needs the user's confirmation", () => {
        expect(canLinkEmiChoice({ ...base, needsDuplicateConfirmation: true })).toBe(false);
        expect(canLinkEmiChoice({ ...base, needsDuplicateConfirmation: true, confirmedNotDuplicate: true })).toBe(true);
    });

    it("a loan that refuses this transaction (e.g. money in for a Term Loan) never enables Link Payment", () => {
        expect(canLinkEmiChoice({ ...base, loanRefusal: "Only an outgoing (expense) transaction can be a loan EMI payment." })).toBe(false);
        expect(canLinkEmiChoice({ ...base, loanRefusal: null })).toBe(true);
    });
});

describe("dialog wiring - one universal Link Transaction to Loan", () => {
    const source = readFileSync(fileURLToPath(new URL("./LinkTransactionToEmiDialog.tsx", import.meta.url)), "latin1");

    it("one title; nothing preselected; the selected loan decides the workflow; no account warning or tick", () => {
        expect(source).toContain("{LINK_DIALOG_TITLE}");
        expect(source).not.toContain("suggestedLoanId");
        expect(source).not.toContain("setLoanId(initialLoan");
        expect(source).toContain('const workflow = linkWorkflowFor(overdraft ? "overdraft" : loan ? "loan" : null);');
        expect(source).not.toContain("paymentAccountMismatch");
        expect(source).not.toContain("confirmedOtherAccount");
        expect(source).not.toContain("Link to Overdraft");
    });

    it("every loan is listed with its type", () => {
        expect(source.match(/\{item\.loanName\} \(\{item\.loanType\}\)/g)).toHaveLength(2);
    });
});

describe("dialog layout - nothing escapes the dialog", () => {
    it("the transaction summary wraps a long unbroken narration instead of widening the dialog", () => {
        const html = renderToStaticMarkup(
            createElement(LinkTransactionSummary, {
                payee: "TATA CAPITAL LIMITED (OD)",
                narration: LONG_NARRATION,
                amount: "₹2,50,000.00",
                date: "16/09/2026",
            })
        );

        expect(html).toContain(LONG_NARRATION);
        expect(html).toContain(`title="${LONG_NARRATION}"`);
        // Every flex row / text block may shrink, and text breaks anywhere.
        expect(html.match(/min-w-0/g)!.length).toBeGreaterThanOrEqual(3);
        expect(html).toMatch(/class="[^"]*line-clamp-3[^"]*\[overflow-wrap:anywhere\][^"]*" title=/);
        // Only the short amount and date stay on one line.
        expect(html.match(/whitespace-nowrap/g)).toHaveLength(2);
        expect(html).not.toContain("truncate");
    });

    it("a flex column bounded by the viewport; only the body scrolls, vertically", () => {
        // Merged with the base DialogContent (a grid) exactly as at runtime.
        const content = cn(
            "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[28px] p-0",
            LINK_DIALOG_LAYOUT.content
        ).split(" ");

        expect(content).toContain("flex");
        expect(content).not.toContain("grid");
        expect(content).toEqual(expect.arrayContaining([
            "flex-col", "overflow-hidden", "w-[560px]", "max-w-[calc(100vw-48px)]", "max-h-[calc(100vh-48px)]",
        ]));
        expect(content).not.toContain("max-w-[calc(100%-2rem)]");

        expect(LINK_DIALOG_LAYOUT.body.split(" ")).toEqual(expect.arrayContaining([
            "min-h-0", "min-w-0", "flex-1", "overflow-y-auto", "overflow-x-hidden",
        ]));
        expect(LINK_DIALOG_LAYOUT.header.split(" ")).toEqual(expect.arrayContaining(["shrink-0", "min-w-0", "pr-14"]));
        expect(LINK_DIALOG_LAYOUT.footer.split(" ")).toEqual(expect.arrayContaining(["shrink-0", "flex-wrap"]));
        expect(LINK_DIALOG_LAYOUT.notice).toContain("[overflow-wrap:anywhere]");
        expect(LINK_DIALOG_LAYOUT.selectTrigger.split(" ")).toContain("min-w-0");
        expect(LINK_DIALOG_LAYOUT.selectText.split(" ")).toEqual(["min-w-0", "truncate"]);

        expect(Object.values(LINK_DIALOG_LAYOUT).join(" ")).not.toMatch(/overflow-x-(auto|scroll)/);
    });

    it("the dialog really uses these classes for its content, header, body, footer, notices and selects", () => {
        const source = readFileSync(
            fileURLToPath(new URL("./LinkTransactionToEmiDialog.tsx", import.meta.url)),
            "utf8"
        );

        expect(source).toContain("className={LINK_DIALOG_LAYOUT.content}");
        expect(source).toContain("<DialogHeader className={LINK_DIALOG_LAYOUT.header}>");
        expect(source).toContain("<div className={LINK_DIALOG_LAYOUT.body}>");
        expect(source).toContain("<div className={LINK_DIALOG_LAYOUT.footer}>");
        expect(source.match(/className=\{LINK_DIALOG_LAYOUT\.notice\}/g)).toHaveLength(4);
        expect(source.match(/className=\{LINK_DIALOG_LAYOUT\.selectTrigger\}/g)).toHaveLength(2);
        expect(source).toContain("<LinkTransactionSummary");
        // No hard-coded amber notice left outside the shared class.
        expect(source).not.toContain('className="rounded-lg border border-amber-200');
    });
});
