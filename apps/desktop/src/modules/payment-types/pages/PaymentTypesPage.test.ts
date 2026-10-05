import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { describe, expect, it } from "vitest";

import { menu } from "@/components/layout/AppSidebar";
import AppRoutes from "@/routes";

// ---------------------------------------------------------------------
// Payment Type navigation: its own sidebar item directly below
// Categories, opening the one Payment Type management page. Settings only
// links to that page - there is exactly one PaymentTypeManager.
// ---------------------------------------------------------------------

const src = path.resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(path.join(src, relative), "utf-8");

function renderAt(url: string): string {
    return renderToStaticMarkup(
        createElement(MemoryRouter, { initialEntries: [url] }, createElement(AppRoutes))
    );
}

describe("Sidebar - Payment Type", () => {
    it("sits directly below Categories and opens /payment-types", () => {
        const labels = menu.map(item => item.label);
        const categories = labels.indexOf("Categories");

        expect(categories).toBeGreaterThan(-1);
        expect(labels[categories + 1]).toBe("Payment Type");
        expect(menu[categories + 1]).toMatchObject({ path: "/payment-types" });
    });

    it("leaves every other item in its original order", () => {
        expect(menu.map(item => item.label).filter(label => label !== "Payment Type")).toEqual([
            "Dashboard", "Accounts", "Business Entities", "Transactions", "Imports", "Import Rules",
            "Budgets", "Financial Plans", "Financial Goals", "Investments", "Loans", "Reports",
            "Categories", "Reconciliation",
        ]);
    });
});

describe("/payment-types", () => {
    const html = renderAt("/payment-types");

    it("opens the Payment Type management page inside the app layout", () => {
        expect(html).toContain(">Payment Types</h1>");
        expect(html).toContain("Master data");
        expect(html).toContain(">Payment Type List</h2>");
        expect(html).toContain('data-testid="add-payment-type"');
        expect(html).toContain('aria-label="New payment type"');
    });

    it("highlights Payment Type as the active sidebar item", () => {
        const link = html.match(/<a[^>]*href="\/payment-types"[^>]*>/)?.[0] ?? "";

        expect(link).toContain('aria-current="page"');
        expect(link).toContain("text-[#2563EB]");
    });
});

describe("one Payment Type management implementation", () => {
    it("PaymentTypeManager is rendered only by the Payment Types page", () => {
        const settings = read("modules/settings/pages/SettingsPage.tsx");

        expect(settings).not.toContain("PaymentTypeManager");
        expect(read("modules/payment-types/pages/PaymentTypesPage.tsx")).toContain("<PaymentTypeManager />");
    });

    it("Settings -> Payment Types links to the same page", () => {
        const settings = read("modules/settings/pages/SettingsPage.tsx");

        expect(settings).toMatch(/<SectionCard title="Payment Types">[\s\S]*?to="\/payment-types"[\s\S]*?Open Payment Types/);
    });
});
