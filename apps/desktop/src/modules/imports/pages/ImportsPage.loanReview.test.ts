import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// No component-render setup here (vitest runs with environment: "node"),
// so the wiring of the import's loan-review panel is checked from source.
// Line endings are normalised - the working tree may be CRLF.
function read(name: string): string {
    return readFileSync(
        fileURLToPath(new URL(name, import.meta.url)),
        "utf8"
    ).replace(/\r\n/g, "\n");
}

const page = read("./ImportsPage.tsx");
const panel = read("./ImportLoanPaymentReview.tsx");

describe("Import result - link a debit left for review to a loan EMI", () => {
    it("the page keeps the import's review items and renders the panel", () => {
        expect(page).toContain("batch.loanPayments?.needsReview ?? []");
        expect(page).toContain("<ImportLoanPaymentReview");
        expect(page).toContain("items={loanReview}");
    });

    it("the review list is cleared whenever the result message is", () => {
        const clears = page.match(/setMessage\(null\);/g)?.length ?? 0;
        const reviewClears =
            page.match(/setMessage\(null\);\n\s*setLoanReview\(\[\]\);/g)?.length ?? 0;

        expect(clears).toBeGreaterThan(0);
        expect(reviewClears).toBe(clears);
    });

    it("a linked item leaves the list", () => {
        expect(page).toMatch(/onLinked=\{transactionId =>\s*setLoanReview\(/);
    });

    it("links through the same dialog as Transactions - the existing imported transaction, never a new one", () => {
        expect(panel).toContain("<LinkTransactionToEmiDialog");
        expect(panel).toContain("new TransactionRepository().getById(transactionId)");
        expect(panel).not.toContain(".create(");
        expect(panel).toContain("Link to Loan EMI");
    });
});
