import { describe, expect, it } from "vitest";

import {
    getPlanComponentDeleteConfirmationCopy,
    getPlanComponentDisplayTitle,
} from "./DeletePlanComponentDialog";

// The manage-components dialog has no confirmation before deleting a
// component (production bug: clicking the trash icon deletes immediately).
// The fix routes the trash button through an AlertDialog that must name the
// exact component being removed. This repo has no jsdom / component-render
// test setup (vitest runs with environment: "node", no
// @testing-library/react) - see FinancialPlanForm.test.ts for the same
// convention - so the copy the dialog renders is exported as a pure
// function and tested here instead of rendering the dialog.

describe("getPlanComponentDisplayTitle", () => {
    it("prefers the user label when set", () => {
        expect(
            getPlanComponentDisplayTitle({
                label: "Family Savings Account Final",
                sourceName: "Family Member Account Updated",
            })
        ).toBe("Family Savings Account Final");
    });

    it("falls back to the live source name when there is no label", () => {
        expect(
            getPlanComponentDisplayTitle({
                label: null,
                sourceName: "Family Member Account Updated",
            })
        ).toBe("Family Member Account Updated");
    });

    it("falls back to 'Unknown source' when neither is available", () => {
        expect(
            getPlanComponentDisplayTitle({
                label: null,
                sourceName: null,
            })
        ).toBe("Unknown source");
    });
});

describe("getPlanComponentDeleteConfirmationCopy", () => {
    it("identifies the exact component being deleted", () => {
        const copy = getPlanComponentDeleteConfirmationCopy({
            label: "Family Savings Account Final",
            sourceName: "Family Member Account Updated",
            componentType: "ACCOUNT",
        });

        expect(copy.title).toBe(
            "Family Savings Account Final"
        );
    });

    it("names the correct underlying source type per component type", () => {
        expect(
            getPlanComponentDeleteConfirmationCopy({
                label: null,
                sourceName: "Checking",
                componentType: "ACCOUNT",
            }).sourceTypeLabel
        ).toBe("account");

        expect(
            getPlanComponentDeleteConfirmationCopy({
                label: null,
                sourceName: "Groceries",
                componentType: "CATEGORY",
            }).sourceTypeLabel
        ).toBe("category");

        expect(
            getPlanComponentDeleteConfirmationCopy({
                label: null,
                sourceName: "Index Fund",
                componentType: "INVESTMENT",
            }).sourceTypeLabel
        ).toBe("investment");

        expect(
            getPlanComponentDeleteConfirmationCopy({
                label: null,
                sourceName: "Car Loan",
                componentType: "LOAN",
            }).sourceTypeLabel
        ).toBe("loan");
    });
});
