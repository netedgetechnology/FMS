import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import type { Category } from "@/modules/categories/types";

import type { CustomImportRule } from "../types";

import {
    CustomRuleManager,
    type CustomRuleManagerProps,
    EMPTY_CUSTOM_RULE_FORM,
    canSaveCustomRuleForm,
    customRuleFormFromRule,
    customRuleInputFromForm,
    describeCustomRule,
    filterCustomRules,
} from "./CustomRuleManager";

// ---------------------------------------------------------------------
// The shared Custom Import Rules management UI (Import Rules page and
// the Import Preview wand). No DOM test setup exists (vitest
// environment: "node"), so the list is rendered to static markup and
// the add/edit form logic is tested through its exported helpers.
// ---------------------------------------------------------------------

const ACCOUNTS = [
    { id: "acct-od", name: "Yes Bank OD" },
    { id: "acct-savings", name: "HDFC Savings" },
];

const CATEGORIES = [
    { id: "cat-interest", name: "Bank Interest", isActive: true },
    { id: "cat-salary", name: "Salary", isActive: true },
] as unknown as Category[];

function rule(overrides: Partial<CustomImportRule>): CustomImportRule {
    return {
        id: "rule-1",
        accountId: "acct-od",
        keyword: "LAP DOD INT",
        payee: null,
        notes: null,
        categoryId: null,
        transactionType: null,
        createdAt: "2026-09-01 08:00:00",
        updatedAt: "2026-09-20 08:00:00",
        ...overrides,
    };
}

const DOD = rule({
    id: "rule-dod",
    payee: "DOD Interest",
    notes: "Overdraft interest",
    categoryId: "cat-interest",
    transactionType: "NET_BANKING",
});

const SALARY = rule({
    id: "rule-salary",
    accountId: "acct-savings",
    keyword: "ACME PAYROLL",
    categoryId: "cat-salary",
});

const noop = async () => {};

// What the user reads: markup without tags/attributes.
const visibleText = (html: string) => html.replace(/<[^>]+>/g, " ");

const addButton = (html: string) =>
    html.match(/<button[^>]*data-testid="add-import-rule"[^>]*>/)?.[0] ?? "";

function render(props: Partial<CustomRuleManagerProps> = {}): string {
    return renderToStaticMarkup(
        createElement(CustomRuleManager, {
            rules: [DOD, SALARY],
            accounts: ACCOUNTS,
            categories: CATEGORIES,
            formatDate: value =>
                value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? ""),
            onCreate: noop,
            onUpdate: noop,
            onDelete: noop,
            ...props,
        })
    );
}

describe("Import Rules list", () => {
    it("lists every saved rule with its keyword, account, payee, category, type and notes", () => {
        const html = render();

        expect(html.split('data-testid="import-rule-row"').length - 1).toBe(2);

        for (const text of [
            "LAP DOD INT",
            "Yes Bank OD",
            "DOD Interest",
            "Bank Interest",
            "Net Banking",
            "Overdraft interest",
            "ACME PAYROLL",
            "HDFC Savings",
            "Salary",
        ]) {
            expect(html).toContain(text);
        }

        for (const header of ["Keyword", "Account", "Payee", "Category", "Type", "Notes", "Updated", "Actions"]) {
            expect(html).toContain(`>${header}</th>`);
        }
    });

    it("shows names, never raw ids or codes", () => {
        const html = visibleText(render());

        for (const raw of ["acct-od", "acct-savings", "cat-interest", "cat-salary", "NET_BANKING", "rule-dod"]) {
            expect(html).not.toContain(raw);
        }
    });

    it("shows the last-updated date (SQLite UTC timestamps parsed)", () => {
        expect(render()).toContain("2026-09-20");
    });

    it("every rule has real Edit and Delete buttons", () => {
        const html = render();

        expect(html).toMatch(/<button[^>]*aria-label="Edit import rule LAP DOD INT"/);
        expect(html).toMatch(/<button[^>]*aria-label="Delete import rule LAP DOD INT"/);
        expect(html).toMatch(/<button[^>]*aria-label="Edit import rule ACME PAYROLL"/);
        expect(html).toMatch(/<button[^>]*aria-label="Delete import rule ACME PAYROLL"/);
    });

    it("offers Add Import Rule, search and an account filter", () => {
        const html = render();

        expect(addButton(html)).not.toBe("");
        expect(addButton(html)).not.toContain('disabled=""');
        expect(html).toMatch(/data-testid="add-import-rule"[^>]*>.*Add Import Rule<\/button>/);
        expect(html).toContain('aria-label="Search rules"');
        expect(html).toContain('aria-label="Filter by account"');
    });

    it("empty state when no rules exist - Add Import Rule still available", () => {
        const html = render({ rules: [] });

        expect(html).toContain('data-testid="import-rules-empty"');
        expect(html).toContain("No import rules yet");
        expect(html).not.toContain('data-testid="import-rules-table"');
        expect(addButton(html)).not.toBe("");
        expect(addButton(html)).not.toContain('disabled=""');
    });

    it("shows loading and load errors instead of an empty list", () => {
        expect(render({ loading: true })).toContain("Loading import rules...");
        expect(render({ loadError: "db locked" })).toContain("db locked");
    });

    it("an unknown account/category is shown as unavailable, not as an id", () => {
        const shown = describeCustomRule(
            rule({ accountId: "gone", categoryId: "gone-cat", payee: "X" }),
            ACCOUNTS,
            CATEGORIES
        );

        expect(shown.account).toBe("(unavailable account)");
        expect(shown.category).toBe("(unavailable category)");
    });
});

describe("Import Preview wand (scoped to the preview's account)", () => {
    it("shows only that account's rules, with how many preview rows each applies to", () => {
        const html = render({
            scopeAccountId: "acct-od",
            appliedCountByRule: new Map([["rule-dod", 3]]),
            previewCandidates: [],
        });

        expect(html).toContain("LAP DOD INT");
        expect(html).not.toContain("ACME PAYROLL");
        expect(html).toContain(">In preview</th>");
        expect(visibleText(html).replace(/<!--.*?-->|\s+/g, "")).toContain("3rows");
        // No account filter - the scope is fixed.
        expect(html).not.toContain('aria-label="Filter by account"');
    });

    it("without a selected account nothing can be added", () => {
        const html = render({ rules: [], scopeAccountId: null });

        expect(html).toContain("Select an account to add import rules for it.");
        expect(addButton(html)).toContain('disabled=""');
    });

    it("the permanent page has no preview column", () => {
        expect(render()).not.toContain("In preview");
    });
});

describe("search and account filter", () => {
    it("search matches keyword, account, payee, category, type and notes (case-insensitive)", () => {
        const search = (text: string) =>
            filterCustomRules([DOD, SALARY], { search: text, accountId: "" }, ACCOUNTS, CATEGORIES).map(
                r => r.id
            );

        expect(search("")).toEqual(["rule-dod", "rule-salary"]);
        expect(search("lap dod")).toEqual(["rule-dod"]);
        expect(search("hdfc")).toEqual(["rule-salary"]);
        expect(search("dod interest")).toEqual(["rule-dod"]);
        expect(search("salary")).toEqual(["rule-salary"]);
        expect(search("net banking")).toEqual(["rule-dod"]);
        expect(search("overdraft")).toEqual(["rule-dod"]);
        expect(search("nothing")).toEqual([]);
    });

    it("account filter keeps one account's rules", () => {
        expect(
            filterCustomRules([DOD, SALARY], { search: "", accountId: "acct-savings" }, ACCOUNTS, CATEGORIES).map(
                r => r.id
            )
        ).toEqual(["rule-salary"]);
    });
});

describe("Add / Edit form", () => {
    it("Add: a filled form becomes the create input (blank fields -> null)", () => {
        const form = {
            ...EMPTY_CUSTOM_RULE_FORM,
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
        };

        expect(canSaveCustomRuleForm(form)).toBe(true);
        expect(customRuleInputFromForm(form)).toEqual({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
            notes: null,
            categoryId: null,
            transactionType: null,
        });
    });

    it("needs an account, a keyword and at least one field", () => {
        const base = { ...EMPTY_CUSTOM_RULE_FORM, accountId: "acct-od", keyword: "X", notes: "N" };

        expect(canSaveCustomRuleForm(base)).toBe(true);
        expect(canSaveCustomRuleForm({ ...base, accountId: "" })).toBe(false);
        expect(canSaveCustomRuleForm({ ...base, keyword: "  " })).toBe(false);
        expect(canSaveCustomRuleForm({ ...base, notes: " " })).toBe(false);
    });

    it("Edit: the form starts from the existing rule and round-trips all its fields", () => {
        const form = customRuleFormFromRule(DOD);

        expect(form).toEqual({
            accountId: "acct-od",
            keyword: "LAP DOD INT",
            payee: "DOD Interest",
            notes: "Overdraft interest",
            categoryId: "cat-interest",
            transactionType: "NET_BANKING",
        });
        expect(customRuleInputFromForm(form)).toEqual({
            accountId: DOD.accountId,
            keyword: DOD.keyword,
            payee: DOD.payee,
            notes: DOD.notes,
            categoryId: DOD.categoryId,
            transactionType: DOD.transactionType,
        });
    });
});
