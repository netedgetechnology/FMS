import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import type { Category } from "../types";

import { CategoryTable } from "./CategoryTable";

// Renders the real table markup (server-side - no DOM in this test
// environment) to check the checkbox column and states.

function category(id: string, name: string): Category {
    return {
        id,
        parentId: null,
        name,
        categoryType: "EXPENSE",
        financeScope: "PERSONAL",
        businessEntityId: null,
        description: null,
        isActive: true,
        createdAt: "",
        updatedAt: "",
    };
}

const categories = [category("rent", "Rent"), category("fuel", "Fuel")];

function render(
    selectedIds: string[],
    allSelected: boolean,
    someSelected: boolean
): string {
    const noop = () => {};

    return renderToStaticMarkup(
        createElement(CategoryTable, {
            categories,
            selectedIds: new Set(selectedIds),
            allSelected,
            someSelected,
            onToggleRow: noop,
            onToggleAll: noop,
            onView: noop,
            onEdit: noop,
            onDelete: noop,
        })
    );
}

function checkboxState(html: string, label: string): string | undefined {
    const tag = html
        .match(/<span[^>]*role="checkbox"[^>]*>/g)
        ?.find(element => element.includes(`aria-label="${label}"`));

    return tag?.match(/aria-checked="([^"]+)"/)?.[1];
}

describe("CategoryTable selection column", () => {
    it("puts the select-all checkbox before the CATEGORY column", () => {
        const html = render([], false, false);
        const header = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));

        expect(header.indexOf('aria-label="Select all categories"')).toBeGreaterThan(-1);
        expect(header.indexOf('aria-label="Select all categories"')).toBeLessThan(
            header.indexOf("Category")
        );
    });

    it("renders a checkbox on every row", () => {
        const html = render([], false, false);

        expect(checkboxState(html, "Select Rent")).toBe("false");
        expect(checkboxState(html, "Select Fuel")).toBe("false");
    });

    it("header is unchecked when none are selected", () => {
        expect(checkboxState(render([], false, false), "Select all categories")).toBe("false");
    });

    it("header is indeterminate when some are selected; rows reflect selection", () => {
        const html = render(["rent"], false, true);

        expect(checkboxState(html, "Select all categories")).toBe("mixed");
        expect(checkboxState(html, "Select Rent")).toBe("true");
        expect(checkboxState(html, "Select Fuel")).toBe("false");
    });

    it("header is checked when all displayed rows are selected", () => {
        const html = render(["rent", "fuel"], true, false);

        expect(checkboxState(html, "Select all categories")).toBe("true");
    });

    it("keeps the existing View / Edit / Delete row actions", () => {
        const html = render([], false, false);

        for (const action of ["View", "Edit", "Delete"]) {
            expect(html).toContain(`aria-label="${action} Rent"`);
            expect(html).toContain(`aria-label="${action} Fuel"`);
        }
    });
});
