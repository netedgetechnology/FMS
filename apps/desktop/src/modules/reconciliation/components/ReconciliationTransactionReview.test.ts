import { describe, expect, it } from "vitest";

import { getReconciliationDisplayLabel } from "./ReconciliationTransactionReview";

// This repo has no jsdom / component-render test setup (vitest runs
// with environment: "node") - see DeletePlanComponentDialog.test.ts
// for the same convention - so the displayed reconciliation state is
// exercised through the exported pure function instead of rendering
// the component.
//
// Regression: an unreconciled transaction correctly showed "Reconcile",
// but a reconciled one showed "Unmark" - a confusing action label
// where the user expects to see the transaction's current state. The
// toggle itself (ReconciliationService.markTransactionReconciled) is
// unchanged; only this display label changed.

describe("getReconciliationDisplayLabel", () => {
    it("displays 'Reconcile' for an unreconciled transaction", () => {
        expect(
            getReconciliationDisplayLabel(false)
        ).toBe("Reconcile");
    });

    it("displays 'Reconciled' (not 'Unmark') for a reconciled transaction", () => {
        expect(
            getReconciliationDisplayLabel(true)
        ).toBe("Reconciled");
    });

    it("never returns the old 'Unmark' label", () => {
        expect(
            getReconciliationDisplayLabel(true)
        ).not.toBe("Unmark");
        expect(
            getReconciliationDisplayLabel(false)
        ).not.toBe("Unmark");
    });
});
