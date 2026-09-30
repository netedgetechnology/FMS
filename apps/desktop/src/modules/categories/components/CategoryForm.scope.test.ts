import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import type { FinanceScope } from "../types";

import { CategoryForm } from "./CategoryForm";

// Renders the real Category create/edit form (server-side - no DOM in
// this test environment). Scopes are managed only on the Scopes screen,
// so the form must show no scope controls. The form's data hooks are
// stubbed; they only load dropdown options.

vi.mock("@/modules/business-entities", () => ({
    useBusinessEntities: () => ({ businessEntities: [] }),
}));

vi.mock("@/modules/accounts/hooks", () => ({
    useAccounts: () => ({ accounts: [] }),
}));

function render(financeScope?: FinanceScope): string {
    return renderToStaticMarkup(
        createElement(CategoryForm, {
            financeScope,
            defaultValues: financeScope
                ? { name: "Fuel", categoryType: "EXPENSE" }
                : undefined,
            onSubmit: () => {},
        })
    );
}

describe("Category Create/Edit form - details only", () => {
    it("has no scope controls (no Scope dropdown, no Personal/Business checkboxes)", () => {
        for (const scope of [undefined, "PERSONAL", "BUSINESS", "BOTH"] as const) {
            const html = render(scope);

            expect(html).not.toContain("Finance Scope");
            expect(html).not.toContain("financeScope");
            expect(html).not.toMatch(/role="checkbox"/);
            expect(html).toContain("Category Name");
            expect(html).toContain("Category Type");
            expect(html).toContain("Parent Category");
        }
    });

    it("shows Business Entity only for a category whose saved scope includes Business", () => {
        expect(render()).not.toContain("Business Entity"); // new: Personal
        expect(render("PERSONAL")).not.toContain("Business Entity");
        expect(render("BUSINESS")).toContain("Business Entity");
        expect(render("BOTH")).toContain("Business Entity");
    });

    it("Add creates Personal (as before); Edit never sends a scope", () => {
        const add = readFileSync(path.resolve(__dirname, "AddCategoryDialog.tsx"), "utf8");
        const edit = readFileSync(path.resolve(__dirname, "EditCategoryDialog.tsx"), "utf8");

        expect(add).toMatch(/financeScope: "PERSONAL",/);
        expect(add).not.toContain("values.financeScope");

        const update = edit.slice(edit.indexOf("service.update({"));
        expect(update.slice(0, update.indexOf("});"))).not.toContain("financeScope");
        expect(edit).toContain("financeScope={category.financeScope}");
    });
});
