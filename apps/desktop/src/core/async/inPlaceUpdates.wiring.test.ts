import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------
// Application-wide: after a create / edit / delete / link the affected
// list is updated without a page-wide "Loading..." flash.
//
// Root cause fixed everywhere: every data hook / page loader set its
// `loading` flag on EVERY load, and every page swaps its content for a
// "Loading..." placeholder while `loading` is true - so each refresh after
// a mutation unmounted the list and lost search, filters, page, selection
// and scroll position. Now only the first load sets `loading`
// (InitialLoadTracker, or a per-key ref for hooks keyed by a plan /
// investment); later loads run in the background.
//
// No component-render setup exists (vitest environment "node"), so the
// wiring is checked in each source file.
// ---------------------------------------------------------------------

const SRC = path.resolve(__dirname, "../..");

function source(relative: string): string {
    return readFileSync(path.join(SRC, relative), "utf8").replace(/\r\n/g, "\n");
}

// Every loader that blanks a page / section / dialog while `loading`.
const TRACKED_LOADERS: Record<string, { loading: string; marker: string }> = {
    "modules/accounts/hooks/useAccounts.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/business-entities/hooks/useBusinessEntities.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/categories/hooks/useCategories.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/categories/hooks/useCategoryContextMappings.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/investments/hooks/useInvestments.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/loans/hooks/useLoans.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/payment-types/hooks/usePaymentTypes.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/budgets/hooks/useBudgets.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/budgets/hooks/useEmiInterestByTransactionId.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/financial-plans/hooks/useFinancialPlans.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/financial-plans/hooks/usePlanActualsBatch.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/financial-goals/hooks/useFinancialGoals.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/financial-goals/hooks/useGoalActualsBatch.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/institutions/hooks/useInstitutions.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/currencies/hooks/useCurrencies.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/transactions/hooks/useTransactions.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/profile/hooks/useProfile.ts": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/loans/pages/LoansPage.tsx": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/investments/pages/InvestmentsPage.tsx": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/reconciliation/pages/ReconciliationPage.tsx": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/documents/pages/DocumentsPage.tsx": { loading: "setLoading", marker: "loadTracker.current.markLoaded()" },
    "modules/imports/pages/ImportsPage.tsx": { loading: "setLoading", marker: "batchesLoadTracker.current.markLoaded()" },
};

describe("no page-wide loading flash after a mutation", () => {
    for (const [file, { loading, marker }] of Object.entries(TRACKED_LOADERS)) {
        it(`${file}: only the first load sets ${loading}(true)`, () => {
            const text = source(file);
            const sets = [...text.matchAll(new RegExp(`\\n([^\\n]*)\\n[ \\t]*${loading}\\(true\\);`, "g"))];

            expect(sets.length).toBeGreaterThan(0);
            for (const [, previousLine] of sets) {
                // Each `setLoading(true)` is directly inside a first-load check.
                expect(previousLine).toMatch(/showsLoading\(\)|!isRefresh|!==/);
            }
            expect(text).toContain(marker);
        });
    }

    it("hooks keyed by a plan / investment blank only when a different one opens", () => {
        expect(source("modules/financial-plans/hooks/usePlanComponents.ts")).toMatch(
            /const isRefresh = loadedPlanId\.current === planId;\s+if \(!isRefresh\) \{\s+setLoading\(true\);/
        );
        expect(source("modules/financial-plans/hooks/usePlanActuals.ts")).toMatch(
            /if \(shownPlanId\.current !== planId\) \{\s+setLoading\(true\);/
        );
        expect(source("modules/investments/pages/InvestmentsPage.tsx")).toMatch(
            /if \(!isRefresh\) \{\s+setTransactionsLoading\(true\);/
        );
        expect(source("modules/imports/pages/ImportsPage.tsx")).toMatch(
            /if \(mappingsLoadTracker\.current\.showsLoading\(\)\) \{\s+setMappingsLoading\(true\);/
        );
    });

    it("computed figures (plan / goal actuals, EMI interest) are still cleared when recalculation fails", () => {
        expect(source("modules/financial-plans/hooks/usePlanActualsBatch.ts")).toMatch(/catch \(err\) \{[\s\S]*?setResults\(\[\]\);/);
        expect(source("modules/financial-goals/hooks/useGoalActualsBatch.ts")).toMatch(/catch \(err\) \{[\s\S]*?setResultsByGoalId\(new Map\(\)\);/);
        expect(source("modules/financial-plans/hooks/usePlanActuals.ts")).toMatch(/catch \(err\) \{[\s\S]*?setResult\(null\);/);
        expect(source("modules/budgets/hooks/useEmiInterestByTransactionId.ts")).toMatch(/catch \(error\) \{[\s\S]*?setEmiInterestByTransactionId\(new Map\(\)\);/);
    });

    it("lists already shown are kept (and the failure reported) when a background refresh fails", () => {
        for (const file of [
            "modules/accounts/hooks/useAccounts.ts",
            "modules/transactions/hooks/useTransactions.ts",
            "modules/loans/pages/LoansPage.tsx",
            "modules/investments/pages/InvestmentsPage.tsx",
            "modules/reconciliation/pages/ReconciliationPage.tsx",
        ]) {
            expect(source(file)).toMatch(/if \(loadTracker\.current\.hasLoaded\) \{\s+reportBackgroundRefreshFailure\(/);
        }
    });
});

describe("in-dialog lists", () => {
    it("Reconciliation review: a Reconcile toggle keeps the list on screen; a failed toggle is a notification", () => {
        const review = source("modules/reconciliation/components/ReconciliationTransactionReview.tsx");
        const toggle = review.slice(review.indexOf("const handleToggle"), review.indexOf("if (loading) {"));
        const toggleCatch = toggle.slice(toggle.indexOf("} catch (err) {"), toggle.indexOf("} finally {"));

        expect(review).toMatch(/const isRefresh = shownFor\.current === key;\s+if \(!isRefresh\) \{\s+setLoading\(true\);/);
        expect(toggle).toContain("await loadTransactions();");
        expect(toggleCatch).toContain("toast.error(");
        // Not setError - that would replace the whole list with the message.
        expect(toggleCatch).not.toContain("setError(");
    });

    it("EMI schedule: the payments panel reloads in the background after a reversal", () => {
        const dialog = source("modules/loans/components/EMIScheduleDialog.tsx");

        expect(dialog).toMatch(/if \(!background\) \{\s+setPaymentsLoading\(true\);/);
        expect(dialog).toMatch(/await loadPayments\(\s+viewingPaymentsFor\.id,\s+true\s+\);/);
        // Opening a different instalment still shows its loading state.
        expect(dialog).toContain("void loadPayments(item.id);");
    });
});

describe("Loans and Investments: one consistent update", () => {
    it("Loans: rows, OD positions and summary cards are committed together, after the stale check", () => {
        const page = source("modules/loans/pages/LoansPage.tsx");
        const load = page.slice(page.indexOf("const loadLoans = useCallback"), page.indexOf("useEffect(() => {\n        void loadLoans();"));

        expect(load.indexOf("isStale(requestId)")).toBeLessThan(load.indexOf("setLoans(result)"));
        expect(load).toMatch(/setLoans\(result\);\s+setOverdraftPositions\(positions\);[\s\S]*?setDashboardSummary\(dashboardResult\);/);
        // The refresh icon spins during a background refresh.
        expect(page).toMatch(/refreshing \? "animate-spin" : ""/);
    });

    it("Investments: rows and portfolio figures are committed together", () => {
        const page = source("modules/investments/pages/InvestmentsPage.tsx");

        expect(page).toMatch(/setInvestments\(result\);\s+setPortfolioCalculations\(calculations\);/);
    });
});

describe("Transactions page mutations update rows in place", () => {
    const page = source("modules/transactions/pages/TransactionsPage.tsx");

    function block(start: string, end: string): string {
        return page.slice(page.indexOf(start), page.indexOf(end, page.indexOf(start)));
    }

    it("Add inserts the saved row", () => {
        expect(page).toContain("onSuccess={createdId => applySaved([createdId])}");
    });

    it("Delete / bulk Delete remove the rows (and the deleted ids from the selection)", () => {
        expect(block("<DeleteTransactionDialog", "/>")).toMatch(/removeTransactions\(\[deletedId\]\);\s+setSelectedIds\(previous => withoutIds\(previous, \[deletedId\]\)\);/);
        expect(block("<BulkDeleteTransactionsDialog", "/>")).toMatch(/setSelectedIds\(new Set\(\)\);\s+removeTransactions\(deletedIds\);/);
    });

    it("bulk Change Category / Move to Account / Link / Unlink re-read just those rows", () => {
        expect(block("<BulkMoveToAccountDialog", "/>")).toContain("await applySaved(movedIds);");
        expect(block("<LinkTransactionToEmiDialog", "/>")).toContain("applySaved([linkingTransaction.id])");
        expect(block("<LinkedEmiPaymentDialog", "/>")).toContain("applySaved([linkedTransaction.id])");
    });

    it("no Transactions dialog reloads the whole list any more", () => {
        expect(page).not.toMatch(/onSuccess=\{refresh\}|onUnlinked=\{refresh\}|await refresh\(\);/);
    });

    it("dialogs hand back what they changed, and only after it succeeded", () => {
        const add = source("modules/transactions/components/AddTransactionDialog.tsx");
        const del = source("modules/transactions/components/DeleteTransactionDialog.tsx");
        const bulk = source("modules/transactions/components/BulkDeleteTransactionsDialog.tsx");

        expect(add).toMatch(/const createdId = await service\.create\(\{[\s\S]*?\}\);\s+await onSuccess\?\.\(createdId\);[\s\S]*?setOpen\(false\);\s+\} catch/);
        expect(del).toMatch(/await service\.delete\(transaction\.id\);\s+await onSuccess\?\.\(transaction\.id\);/);
        expect(bulk).toMatch(/await service\.delete\(id\);\s+\}\s+await onSuccess\?\.\(\[\.\.\.transactionIds\]\);/);

        // A failed save keeps the dialog (and the user's input) open.
        const addCatch = add.slice(add.indexOf("} catch (error) {"), add.indexOf("} finally {"));
        expect(addCatch).not.toContain("setOpen(false)");
    });
});
