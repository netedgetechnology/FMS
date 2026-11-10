import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import type { Transaction } from "../types";

vi.mock("@/core/formatting", async importOriginal => ({
    ...(await importOriginal<typeof import("@/core/formatting")>()),
    useDateFormatter: () => (value: string) => value,
}));

import { TransactionTable } from "./TransactionTable";

// ---------------------------------------------------------------------
// The Landmark (Link to Loan) icon for Overdraft transactions, with the
// shapes of real bank rows: OD money moves as Transfer In / Transfer Out.
// The icon appears for both directions on an account an Overdraft is
// linked to - and only there; elsewhere a transfer still has no icon.
// ---------------------------------------------------------------------

const OD_ACCOUNT = "acct-od-bank";
const OTHER_ACCOUNT = "acct-other";

function transaction(
    id: string,
    accountId: string,
    type: Transaction["type"],
    transferDirection: Transaction["transferDirection"] = null
): Transaction {
    return {
        id, accountId, type, transferDirection,
        categoryId: "cat-loan", subcategoryId: null, payee: `TATA CAPITAL (OD) ${id}`, counterparty: null, branch: null,
        amount: 100000, transactionDate: "2026-09-23", referenceNumber: null, notes: null, tags: null,
        status: "CLEARED", paymentMethod: null, upiReference: null, bankTransactionReference: null,
        cardReference: null, transactionType: null, reconciled: false, reconciledAt: null, isImported: true,
        sourceStatement: null, externalTransactionId: null, originalNarration: null,
        createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z",
    } as Transaction;
}

function render(transactions: Transaction[], overdraftAccountIds: string[]) {
    return renderToStaticMarkup(
        createElement(TransactionTable, {
            transactions,
            accounts: new Map([[OD_ACCOUNT, "Netedge 3999"], [OTHER_ACCOUNT, "Netedge 2790"]]),
            categories: new Map<string, string>(),
            selectedIds: new Set<string>(),
            allSelected: false,
            someSelected: false,
            onToggleRow: vi.fn(),
            onToggleAll: vi.fn(),
            onView: vi.fn(),
            onEdit: vi.fn(),
            onDelete: vi.fn(),
            onLinkToLoan: vi.fn(),
            loanLinkedIds: new Set<string>(),
            overdraftAccountIds: new Set(overdraftAccountIds),
            loanLinkCategoryIds: new Set(["cat-loan"]),
        })
    );
}

const linkButtonFor = (html: string, id: string) =>
    (html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? []).find(button =>
        button.includes(`aria-label="Link TATA CAPITAL (OD) ${id} to a loan`)
    );

describe("Transactions - Link to Loan icon for Overdraft transactions", () => {
    const rows = [
        transaction("in", OD_ACCOUNT, "transfer", "IN"),
        transaction("out", OD_ACCOUNT, "transfer", "OUT"),
        transaction("credit", OD_ACCOUNT, "income"),
        transaction("elsewhere", OTHER_ACCOUNT, "transfer", "IN"),
    ];

    it("shows the same Landmark icon, titled Link to Loan, for money in AND money out on the OD's account", () => {
        const html = render(rows, [OD_ACCOUNT]);

        for (const id of ["in", "out", "credit"]) {
            const button = linkButtonFor(html, id);
            expect(button, id).toBeDefined();
            expect(button).toContain("lucide-landmark");
            expect(button).toContain('title="Link to Loan"');
        }
    });

    it("shows no icon for a transfer on an account no Overdraft is linked to", () => {
        expect(linkButtonFor(render(rows, [OD_ACCOUNT]), "elsewhere")).toBeUndefined();
        // Without any Overdraft, transfers and credits have no icon - as before.
        const none = render(rows, []);
        for (const id of ["in", "out", "credit", "elsewhere"]) {
            expect(linkButtonFor(none, id), id).toBeUndefined();
        }
    });

    it("a Term Loan expense row keeps its Link to Loan EMI icon", () => {
        const html = render([transaction("emi", OTHER_ACCOUNT, "expense")], [OD_ACCOUNT]);
        expect(linkButtonFor(html, "emi")).toContain('title="Link to Loan EMI"');
    });
});
