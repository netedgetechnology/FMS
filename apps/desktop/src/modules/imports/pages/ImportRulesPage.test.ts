import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import ImportRulesPage from "./ImportRulesPage";

// ---------------------------------------------------------------------
// Imports > Import Rules: the permanent management page, its navigation
// entry, and the Import Preview wand sharing the same rule management
// (CustomRuleManager). The list/form themselves are covered in
// components/CustomRuleManager.test.ts and the rule behavior in
// services/ImportService.customRules.test.ts.
// ---------------------------------------------------------------------

const read = (...parts: string[]) =>
    readFileSync(path.resolve(__dirname, ...parts), "utf8").replace(/\r\n/g, "\n");

const pageSource = read("ImportRulesPage.tsx");
const dialogSource = read("CustomRulesDialog.tsx");
const importsPageSource = read("ImportsPage.tsx");
const routesSource = read("../../../routes/index.tsx");
const sidebarSource = read("../../../components/layout/AppSidebar.tsx");

describe("Import Rules page", () => {
    it("loads without an active import: title, description and Add Import Rule", () => {
        const html = renderToStaticMarkup(createElement(ImportRulesPage));

        expect(html).toContain(">Import Rules</h1>");
        expect(html).toContain("automatically modify matching");
        expect(html).toContain("Add Import Rule");
        expect(html).toContain('data-testid="custom-rule-manager"');
        // Nothing about a preview.
        expect(html).not.toContain("In preview");
    });

    it("lists every account's saved rules and manages them through ImportService", () => {
        expect(pageSource).toContain("service.listAllCustomRules()");
        expect(pageSource).toContain("service.createCustomRule(input)");
        expect(pageSource).toContain("service.updateCustomRule(id, input)");
        expect(pageSource).toContain("service.deleteCustomRule(id)");
        // Every account (no scopeAccountId) - with the account column/filter.
        expect(pageSource).not.toContain("scopeAccountId");
        expect(pageSource).toContain("<CustomRuleManager");
    });

    it("never touches transactions", () => {
        expect(pageSource).not.toMatch(/transaction(Service|Repository)/i);
    });
});

describe("navigation", () => {
    it("is routed at /imports/rules", () => {
        expect(routesSource).toMatch(
            /<Route\s+path="\/imports\/rules"\s+element={<ImportRulesPage \/>}/
        );
    });

    it("has a permanent sidebar entry right under Imports; Imports is no longer active on it", () => {
        const imports = sidebarSource.indexOf('label: "Imports", path: "/imports", end: true');
        const rules = sidebarSource.indexOf('label: "Import Rules", path: "/imports/rules", child: true');

        expect(imports).toBeGreaterThan(-1);
        expect(rules).toBeGreaterThan(imports);
        expect(sidebarSource.slice(imports, rules).split("\n").filter(l => l.includes("path:"))).toHaveLength(1);
        expect(sidebarSource).toContain("end={item.end}");
    });
});

describe("Import Preview wand uses the same rule management", () => {
    it("the wand still opens the rules dialog", () => {
        const button = importsPageSource.indexOf('data-testid="manage-custom-rules"');
        const markup = importsPageSource.slice(
            importsPageSource.lastIndexOf("<button", button),
            importsPageSource.indexOf("</button>", button)
        );

        expect(markup).toContain("onClick={() => setCustomRulesOpen(true)}");
    });

    it("the dialog is CustomRuleManager scoped to the preview's account - no second implementation", () => {
        expect(dialogSource).toContain("<CustomRuleManager");
        expect(dialogSource).toContain("scopeAccountId={accountId}");
        expect(dialogSource).toContain("appliedCountByRule={appliedCountByRule}");
        expect(dialogSource).toContain('to="/imports/rules"');
        // No rule form/list of its own.
        expect(dialogSource).not.toContain("<form");
        expect(dialogSource).not.toContain("countCustomRuleMatches");
    });

    it("create, edit and delete from the wand re-apply the rules to the open preview", () => {
        const dialog = importsPageSource.slice(
            importsPageSource.indexOf("<CustomRulesDialog"),
            importsPageSource.indexOf("/>", importsPageSource.indexOf("<CustomRulesDialog"))
        );

        expect(dialog).toContain("accountId={selectedAccountId || null}");
        expect(dialog).toContain("onCreate={handleCreateCustomRule}");
        expect(dialog).toContain("onUpdate={handleUpdateCustomRule}");
        expect(dialog).toContain("onDelete={handleDeleteCustomRule}");

        for (const [handler, call] of [
            ["handleCreateCustomRule", "service.createCustomRule(input)"],
            ["handleUpdateCustomRule", "service.updateCustomRule(id, input)"],
            ["handleDeleteCustomRule", "service.deleteCustomRule(id)"],
        ] as const) {
            const start = importsPageSource.indexOf(`const ${handler} = async`);
            const body = importsPageSource.slice(start, importsPageSource.indexOf("\n    };", start));

            expect(body).toContain(call);
            expect(body).toContain("await refreshCustomRules()");
        }

        const refresh = importsPageSource.slice(
            importsPageSource.indexOf("const refreshCustomRules = async"),
            importsPageSource.indexOf("const handleCreateCustomRule")
        );
        expect(refresh).toContain("reapplyCustomImportRules(previous, rules)");
    });

    it("a resumed preview is updated with rules edited on the Import Rules page meanwhile", () => {
        const start = importsPageSource.indexOf("const handleResumeDraft = async");
        const resume = importsPageSource.slice(start, importsPageSource.indexOf("\n    };", start));

        expect(resume).toContain(".listCustomRules(state.accountId)");
        expect(resume).toMatch(
            /reapplyCustomImportRulesIfChanged\(\s*restored\.preview,\s*currentRules\s*\)/
        );
    });
});
