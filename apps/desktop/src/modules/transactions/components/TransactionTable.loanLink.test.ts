import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import type { Transaction } from "../types";

// The table's only hook - stubbed so the component can also be called as
// a plain function below, to reach its real click handlers.
vi.mock("@/core/formatting", async importOriginal => ({
    ...(await importOriginal<typeof import("@/core/formatting")>()),
    useDateFormatter: () => (value: string) => value,
}));

import { LinkedEmiDetails } from "@/modules/loans/components/LinkedEmiPaymentDialog";

import { TransactionTable } from "./TransactionTable";

// ---------------------------------------------------------------------
// Transactions -> the Link to Loan EMI icon, rendered for real. A linked
// transaction keeps the very same button and icon in the same place;
// only the icon colour and the tooltip change.
// ---------------------------------------------------------------------

// The button exactly as it was before the linked state existed.
const ORIGINAL_CLASS =
    "inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800";

function transaction(id: string): Transaction {
    return {
        id,
        accountId: "account-1",
        subcategoryId: null,
        payee: "Aster Finance",
        // A loan-link category - only those rows can show the icon.
        categoryId: "cat-loan",
        counterparty: null,
        branch: null,
        type: "expense",
        amount: 148250,
        transactionDate: "2026-09-05",
        referenceNumber: null,
        notes: null,
        tags: null,
        status: "CLEARED",
        paymentMethod: null,
        upiReference: null,
        bankTransactionReference: null,
        cardReference: null,
        transactionType: null,
        reconciled: false,
        reconciledAt: null,
        isImported: true,
        sourceStatement: null,
        externalTransactionId: null,
        originalNarration: null,
        createdAt: "2026-09-05T00:00:00.000Z",
        updatedAt: "2026-09-05T00:00:00.000Z",
    } as Transaction;
}

function props(linkedIds: string[], onLinkToLoan = vi.fn()) {
    return {
        transactions: [transaction("t1")],
        accounts: new Map([["account-1", "Operating"]]),
        categories: new Map<string, string>(),
        selectedIds: new Set<string>(),
        allSelected: false,
        someSelected: false,
        onToggleRow: vi.fn(),
        onToggleAll: vi.fn(),
        onView: vi.fn(),
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        onLinkToLoan,
        loanLinkedIds: new Set(linkedIds),
        loanLinkCategoryIds: new Set(["cat-loan"]),
    };
}

const render = (linkedIds: string[]) =>
    renderToStaticMarkup(createElement(TransactionTable, props(linkedIds)));

// The row's action buttons, in order, as rendered HTML.
function actionButtons(html: string): string[] {
    return html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

function loanButton(html: string): string {
    const button = actionButtons(html).find(b => /title="Link(ed)? to Loan"/.test(b));
    expect(button).toBeDefined();
    return button!;
}

// The button's inner markup - the icon itself.
const icon = (button: string) => button.replace(/^<button[^>]*>/, "");
const attr = (button: string, name: string) =>
    new RegExp(`${name}="([^"]*)"`).exec(button)?.[1];

function findButton(node: ReactNode, title: string): ReactElement<{ onClick: () => void; disabled?: boolean }> | null {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findButton(child, title);
            if (found) return found;
        }
        return null;
    }
    if (!isValidElement<{ title?: string; children?: ReactNode }>(node)) {
        return null;
    }
    if (node.type === "button" && node.props.title === title) {
        return node as ReactElement<{ onClick: () => void }>;
    }
    return findButton(node.props.children, title);
}

describe("Transactions - Link to Loan EMI icon, linked and unlinked", () => {
    const unlinked = loanButton(render([]));
    const linked = loanButton(render(["t1"]));

    it("1. an unlinked transaction shows the original Link to Loan EMI icon, gray, exactly as before", () => {
        expect(icon(unlinked)).toContain("lucide-landmark");
        expect(attr(unlinked, "class")).toBe(ORIGINAL_CLASS);
        expect(attr(unlinked, "aria-label")).toBe("Link Aster Finance to a loan EMI");
    });

    it("2. a linked transaction shows the very same icon - not another one, not hidden", () => {
        expect(icon(linked)).toBe(icon(unlinked));
        expect(icon(linked)).toContain("lucide-landmark");
    });

    it("2. ...in the same place among the row's actions, with no extra button", () => {
        const before = actionButtons(render([]));
        const after = actionButtons(render(["t1"]));

        expect(after).toHaveLength(before.length);
        expect(before.indexOf(unlinked)).toBe(after.indexOf(linked));
        // Every other button is untouched.
        expect(after.filter(b => b !== linked)).toEqual(before.filter(b => b !== unlinked));
    });

    it("3. only the colour changes: gray -> green, same size, shape and layout", () => {
        const unlinkedClasses = attr(unlinked, "class")!.split(" ");
        const linkedClasses = attr(linked, "class")!.split(" ");

        expect(unlinkedClasses.filter(c => !linkedClasses.includes(c)).sort()).toEqual([
            "hover:text-slate-800",
            "text-slate-500",
        ]);
        expect(linkedClasses.filter(c => !unlinkedClasses.includes(c)).sort()).toEqual([
            "hover:text-emerald-700",
            "text-emerald-600",
        ]);
    });

    it("6. the tooltip says Link to Loan / Linked to Loan (one universal action)", () => {
        expect(attr(unlinked, "title")).toBe("Link to Loan");
        expect(attr(linked, "title")).toBe("Linked to Loan");
    });

    it("4. a linked transaction's icon stays clickable and calls the same action", () => {
        expect(linked).not.toContain("disabled");

        const onLinkToLoan = vi.fn();
        const tree = TransactionTable(props(["t1"], onLinkToLoan));
        const button = findButton(tree, "Linked to Loan");

        expect(button).not.toBeNull();
        button!.props.onClick();
        expect(onLinkToLoan).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
    });
});

describe("Transactions page - gray icon opens the link dialog, green icon opens the linked-payment popup", () => {
    const page = readFileSync(
        fileURLToPath(new URL("../pages/TransactionsPage.tsx", import.meta.url)),
        "utf8"
    ).replace(/\r\n/g, "\n");

    const handler = /const handleLinkToLoan = \(transaction: Transaction\) => \{([\s\S]*?)\n {4}\};/.exec(page)?.[1];

    it("1. an unlinked transaction opens the Link to Loan EMI dialog", () => {
        expect(handler).toBeDefined();
        expect(handler).toMatch(
            /if \(canOpenLoanLinkDialog\(transaction, loanLinkedIds\)\) \{\s*setLinkingTransaction\(transaction\);\s*return;\s*\}/
        );
        expect(page).toContain("onLinkToLoan={handleLinkToLoan}");
        expect(page).toContain("loanLinkedIds={loanLinkedIds}");
    });

    it("3/5. a linked transaction opens the linked-payment popup, never the link dialog again", () => {
        const afterGuard = handler!.split("return;\n        }")[1]!;

        expect(afterGuard.trim()).toBe("setLinkedTransaction(transaction);");
        expect(page).toMatch(/<LinkedEmiPaymentDialog\s+transaction=\{linkedTransaction\}\s+open=\{linkedTransaction !== null\}/);
    });

    it("9. after Unlink the list is re-read, and with it which transactions are linked - the icon turns gray again", () => {
        // The unlinked row is re-read in place (no page-wide reload) ...
        expect(page).toMatch(/onUnlinked=\{\(\) =>\s+linkedTransaction\s+\? applySaved\(\[linkedTransaction\.id\]\)\s+: refresh\(\)/);
        // ... and the linked set is reloaded whenever the transactions are.
        expect(page).toMatch(/new LoanSchedulePaymentRepository\(\)\s*\.getAll\(\)[\s\S]*?\}, \[transactions\]\);/);
    });
});

describe("Linked-payment popup", () => {
    const dialog = readFileSync(
        fileURLToPath(new URL("../../loans/components/LinkedEmiPaymentDialog.tsx", import.meta.url)),
        "utf8"
    ).replace(/\r\n/g, "\n");

    it("4. shows the linked loan, the EMI and the payment amount", () => {
        const html = renderToStaticMarkup(
            createElement(LinkedEmiDetails, {
                details: { loanName: "Northwind Capital", installmentNumber: 6, amount: 148250 },
                currency: "INR",
            })
        );

        expect(html).toContain("Linked to Northwind Capital");
        expect(html).toContain("EMI #6");
        expect(html).toMatch(/Payment: .*1,48,250\.00/);
    });

    it("5. has an Unlink action that unlinks this transaction, guarded against a double click", () => {
        expect(dialog).toMatch(/onClick=\{handleUnlink\}[\s\S]*?\{unlinking \? "Unlinking\.\.\." : "Unlink"\}/);
        expect(dialog).toContain("disabled={!details || unlinking}");
        expect(dialog).toContain("if (!transaction || !details || inFlight.current)");
        expect(dialog).toContain(".unlink(transaction.id)");
        // Unlink keeps the transaction - the popup never deletes or creates one.
        expect(dialog).not.toMatch(/delete|create\(/i);
    });
});
