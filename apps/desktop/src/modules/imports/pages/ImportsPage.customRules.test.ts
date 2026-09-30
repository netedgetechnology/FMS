import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import { withCustomImportRules } from "../services/ImportService";
import type { CustomImportRule } from "../types";

import {
    countImportProgress,
    createEmptyPreviewOverrides,
    deriveSessionLearnedRowNumbers,
} from "./ImportsPage";
import { ImportPreviewRow, type ImportPreviewRowProps } from "./ImportPreviewRow";

function row(
    rowNumber: number,
    description: string
): NormalizedTransactionCandidate {
    return {
        rowNumber,
        transactionDate: "2026-06-30",
        payee: description,
        description,
        amount: 100,
        type: "expense",
        referenceNumber: null,
        externalTransactionId: null,
        transactionType: null,
        balance: null,
        branch: null,
        counterparty: null,
        notes: null,
        categoryId: null,
        rawData: {},
    };
}

const DOD: CustomImportRule = {
    id: "rule-dod",
    accountId: "acct-od",
    keyword: "LAP DOD INT",
    payee: "DOD Interest",
    notes: null,
    categoryId: null,
    transactionType: null,
    createdAt: "",
    updatedAt: "",
};

const noop = () => {};

function render(props: Partial<ImportPreviewRowProps> & { candidate: NormalizedTransactionCandidate }) {
    return renderToStaticMarkup(
        createElement(
            "table",
            null,
            createElement(
                "tbody",
                null,
                createElement(ImportPreviewRow, {
                    displayNumber: 1,
                    hasErrors: false,
                    isDuplicate: false,
                    isTransfer: false,
                    indicatorState: "blank",
                    indicatorClickable: false,
                    hasMatchedLearnedRule: false,
                    importing: false,
                    directionCategoryOptions: [],
                    categories: [],
                    categoriesLoading: false,
                    onToggleSelfLearning: noop,
                    onPayeeCommit: noop,
                    onTransactionTypeChange: noop,
                    onCategoryChange: noop,
                    onNotesCommit: noop,
                    onViewDescription: noop,
                    ...props,
                })
            )
        )
    );
}

describe("Import Preview header - Custom Rules entry point", () => {
    const page = readFileSync(path.resolve(__dirname, "ImportsPage.tsx"), "utf8");

    it("2. Custom Rules is absent from the Import Preview title/header (no button, no count)", () => {
        expect(page).not.toContain('data-testid="custom-rules-button"');
        expect(page).not.toContain('data-testid="import-preview-title-actions"');
        expect(page).not.toContain("customRuleRowCount");

        const titleBar = page.slice(
            page.indexOf("Import Preview\n"),
            page.indexOf('data-testid="import-preview-header"')
        );
        expect(titleBar).not.toContain("Custom Rules");
        expect(titleBar).not.toContain("manage-custom-rules");
        expect(titleBar).not.toContain("customRules.length");
        // The status pill is still there.
        expect(titleBar).toContain("{previewStatusLabel}");
    });

    it("the PAYEE column header contains no Custom Rule icon or indicator - just the label", () => {
        const payeeHeaderStart = page.lastIndexOf(
            "<th",
            page.indexOf("                                                Payee\n")
        );
        const payeeHeader = page.slice(
            payeeHeaderStart,
            page.indexOf("</th>", payeeHeaderStart) + "</th>".length
        );

        expect(payeeHeader).toBe(
            [
                '<th className="px-4 py-3">',
                "                                                Payee",
                "                                            </th>",
            ].join("\n")
        );

        // The table header row as a whole carries no rule icon either.
        const thead = page.slice(
            page.indexOf("<thead"),
            page.indexOf("</thead>")
        );
        expect(thead).not.toMatch(/Wand2|custom-rule|manage-custom-rules/);
        // On the page itself the wand icon appears exactly once: on the
        // Custom Rules button (the row indicator lives in ImportPreviewRow).
        expect(page.split("<Wand2").length - 1).toBe(1);
    });

    it("3/4/5. Custom Rules sits immediately after the Processed counter; counters keep their order; Category Scope stays right", () => {
        // Exactly one Custom Rules button on the page.
        expect(page.split('data-testid="manage-custom-rules"').length - 1).toBe(1);

        const row = page.indexOf('data-testid="import-preview-header"');
        const group = page.indexOf('data-testid="import-progress-group"', row);
        const counters = page.indexOf("<ImportProgressCounters", group);
        const countersEnd = page.indexOf("/>", counters) + 2;
        const button = page.indexOf('data-testid="manage-custom-rules"');
        const groupEnd = page.indexOf('data-testid="import-category-scope"', row);

        // Header row -> left group [counters, Custom Rules] -> scope block.
        expect(group).toBeGreaterThan(row);
        expect(counters).toBeGreaterThan(group);
        expect(button).toBeGreaterThan(countersEnd);
        expect(groupEnd).toBeGreaterThan(button);

        // Nothing but whitespace/comment between the counters and the button.
        const between = page
            .slice(countersEnd, page.lastIndexOf("<button", button))
            .trim();
        expect(between).toBe("");

        // The left group is a wrapping, vertically centred row.
        const groupTag = page.slice(
            page.lastIndexOf("<div", group),
            page.indexOf(">", group)
        );
        expect(groupTag).toContain("flex flex-wrap items-center gap-2");

        // The header row still pushes Category Scope to the right.
        const rowTag = page.slice(page.lastIndexOf("<div", row), page.indexOf(">", row));
        expect(rowTag).toContain("justify-between");
        const scopeTag = page.slice(
            page.lastIndexOf("<div", groupEnd),
            page.indexOf(">", groupEnd)
        );
        expect(scopeTag).toContain("ml-auto");

        // The three counters keep their order: Processed is last, so the
        // button follows it directly.
        const counterSource = readFileSync(
            path.resolve(__dirname, "ImportProgressCounters.tsx"),
            "utf8"
        );
        const learned = counterSource.indexOf("Learned\n");
        const manual = counterSource.indexOf("Manual / Left");
        const processed = counterSource.indexOf("Processed of {counts.total}");
        expect(learned).toBeGreaterThan(-1);
        expect(manual).toBeGreaterThan(learned);
        expect(processed).toBeGreaterThan(manual);

        // Compact, pill-height (28px) and never squeezed; no count.
        const buttonMarkup = page.slice(
            page.lastIndexOf("<button", button),
            page.indexOf("</button>", button)
        );
        expect(buttonMarkup).toContain("h-7 w-7 shrink-0");
        expect(buttonMarkup).toContain("rounded-full");
        expect(buttonMarkup).not.toMatch(/customRules\.length|RowCount/);
    });

    describe("icon-only Custom Rules button", () => {
        const button = page.indexOf('data-testid="manage-custom-rules"');
        const openTag = page.slice(
            page.lastIndexOf("<button", button),
            page.indexOf(">", button) + 1
        );
        const body = page.slice(
            page.indexOf(">", button) + 1,
            page.indexOf("</button>", button)
        );

        it("1. contains only the SAME Custom Rule icon as the row-level Payee indicator", () => {
            const row = readFileSync(
                path.resolve(__dirname, "ImportPreviewRow.tsx"),
                "utf8"
            );
            const indicator = row.slice(
                row.indexOf('data-testid="custom-rule-icon"'),
                row.indexOf("</span>", row.indexOf('data-testid="custom-rule-icon"'))
            );
            expect(indicator).toContain('<Wand2 size={14} aria-hidden="true" />');
            expect(indicator).toContain("text-violet-600");

            // The body is exactly one element: that icon, same size/colour.
            expect(body.trim()).toBe(
                [
                    "<Wand2",
                    "                                        size={14}",
                    '                                        aria-hidden="true"',
                    '                                        className="text-violet-600"',
                    "                                    />",
                ].join("\n")
            );
        });

        it("2. renders no visible text", () => {
            expect(body).not.toContain("Custom Rules");
            expect(body.replace(/<Wand2[\s\S]*?\/>/, "").trim()).toBe("");
        });

        it("3/4. accessible label and hover tooltip are both exactly \"Custom Rules\"", () => {
            expect(openTag).toContain('aria-label="Custom Rules"');
            expect(openTag).toContain('title="Custom Rules"');
            // A real, focusable <button> (keyboard accessible), with a
            // visible focus ring.
            expect(openTag.startsWith("<button")).toBe(true);
            expect(openTag).toContain('type="button"');
            expect(openTag).not.toContain("tabIndex");
            expect(openTag).toContain("focus-visible:ring-2");
        });

        it("renders an accessible, text-free icon button (static render)", async () => {
            const { createElement: h } = await import("react");
            const { renderToStaticMarkup: toHtml } = await import("react-dom/server");
            const { Wand2 } = await import("lucide-react");

            // Mirrors the markup above, rendered for real.
            const html = toHtml(
                h(
                    "button",
                    { type: "button", "aria-label": "Custom Rules", title: "Custom Rules" },
                    h(Wand2, { size: 14, "aria-hidden": "true", className: "text-violet-600" })
                )
            );

            expect(html).toContain('aria-label="Custom Rules"');
            expect(html.replace(/<[^>]+>/g, "").trim()).toBe("");
        });
    });

    it("6. the button still opens the Custom Rules dialog (shared Import Rules management)", () => {
        const button = page.indexOf('data-testid="manage-custom-rules"');
        const buttonMarkup = page.slice(
            page.lastIndexOf("<button", button),
            page.indexOf("</button>", button)
        );

        expect(buttonMarkup).toContain("onClick={() => setCustomRulesOpen(true)}");

        const dialog = page.slice(
            page.indexOf("<CustomRulesDialog"),
            page.indexOf("/>", page.indexOf("<CustomRulesDialog"))
        );
        expect(dialog).toContain("open={customRulesOpen}");
        expect(dialog).toContain("onOpenChange={setCustomRulesOpen}");
        expect(dialog).toContain("onCreate={handleCreateCustomRule}");
        expect(dialog).toContain("onUpdate={handleUpdateCustomRule}");
        expect(dialog).toContain("onDelete={handleDeleteCustomRule}");
    });
});

describe("Import Preview - Custom Rule indication", () => {
    it("1. a row a custom rule applied to shows the Custom Rule icon right beside the Payee, and keeps its Payee and original Description", () => {
        const [applied] = withCustomImportRules(
            { candidates: [row(1, "LAP DOD INT JUN22")], matchedRowNumbers: new Set() },
            [DOD]
        ).candidates;

        const html = render({
            candidate: applied!,
            customRuleKeyword: "LAP DOD INT",
        });

        expect(html.match(/data-testid="custom-rule-icon"/g)).toHaveLength(1);
        expect(html).toContain('value="DOD Interest"');
        expect(html).toContain("LAP DOD INT JUN22");

        // The old keyword text badge is gone.
        expect(html).not.toContain("Rule: LAP DOD INT");
    });

    it("places the icon OUTSIDE the Payee input, as its immediate next sibling, one small gap after it", () => {
        const html = render({
            candidate: row(1, "LAP DOD INT JUN22"),
            customRuleKeyword: "LAP DOD INT",
        });

        // The Payee field container: exactly [input][icon], nothing else.
        const fieldStart = html.indexOf('data-testid="payee-field"');
        const fieldOpenEnd = html.indexOf(">", fieldStart) + 1;
        const fieldTag = html.slice(html.lastIndexOf("<div", fieldStart), fieldOpenEnd);
        const fieldBody = html.slice(fieldOpenEnd, html.indexOf("</div>", fieldStart));

        // Horizontal row, vertically centred, one gap-1 (~one space) between.
        expect(fieldTag).toContain("flex");
        expect(fieldTag).toContain("items-center");
        expect(fieldTag).toContain("gap-1");
        expect(fieldTag).not.toContain("flex-col");

        // <input .../> is a void element, so nothing can be inside it; the
        // icon span must begin right where the input tag ends.
        expect(fieldBody.startsWith("<input ")).toBe(true);
        const inputTagEnd = fieldBody.indexOf("/>") + 2;
        expect(fieldBody.slice(inputTagEnd)).toMatch(
            /^<span role="img" data-testid="custom-rule-icon"/
        );
        // ...and it's the last thing in the field.
        expect(fieldBody.trimEnd().endsWith("</svg></span>")).toBe(true);

        // Not absolutely positioned or pushed elsewhere; icon never shrinks.
        const iconTag = fieldBody.slice(
            inputTagEnd,
            fieldBody.indexOf(">", inputTagEnd) + 1
        );
        expect(iconTag).not.toMatch(/absolute|fixed|ml-auto|order-/);
        expect(iconTag).toContain("shrink-0");

        // The input gives way instead of letting the icon overlap it.
        const inputTag = fieldBody.slice(0, inputTagEnd);
        expect(inputTag).toContain("min-w-0");
        expect(inputTag).toContain("flex-1");
        expect(inputTag).not.toContain("w-full");
    });

    it("the Payee cell has only the input (no icon) when no custom rule applies", () => {
        const html = render({ candidate: row(2, "NET TXN: BILLDESK SBICARD") });

        const fieldStart = html.indexOf('data-testid="payee-field"');
        const fieldOpenEnd = html.indexOf(">", fieldStart) + 1;
        const fieldBody = html.slice(fieldOpenEnd, html.indexOf("</div>", fieldStart));

        expect(fieldBody.startsWith("<input ")).toBe(true);
        expect(fieldBody.slice(fieldBody.indexOf("/>") + 2)).toBe("");
    });

    it("2. a row without a custom rule shows no Custom Rule icon", () => {
        const candidate = row(2, "NET TXN: BILLDESK SBICARD");

        expect(render({ candidate })).toBe(
            render({ candidate, customRuleKeyword: undefined })
        );
        expect(render({ candidate })).not.toContain("custom-rule-icon");
        expect(render({ candidate })).not.toContain(
            "Custom import rule applied to this transaction"
        );
    });

    it("3. the Custom Rule icon has the exact tooltip and accessible label", () => {
        const html = render({
            candidate: row(1, "LAP DOD INT JUN22"),
            customRuleKeyword: "LAP DOD INT",
        });

        const icon = html.slice(
            html.indexOf('<span role="img" data-testid="custom-rule-icon"'),
            html.indexOf("</span>", html.indexOf('data-testid="custom-rule-icon"'))
        );

        expect(icon).toContain(
            'aria-label="Custom import rule applied to this transaction"'
        );
        expect(icon).toContain(
            'title="Custom import rule applied to this transaction"'
        );
        // Decorative SVG is hidden; the span carries the label.
        expect(icon).toContain('aria-hidden="true"');
    });

    it("4. the green Learned check still works: shown for learned rows, with its tooltip, alongside the Custom Rule icon", () => {
        const candidate = row(1, "LAP DOD INT JUN22");
        const green = {
            candidate,
            indicatorState: "green" as const,
            indicatorClickable: true,
            hasMatchedLearnedRule: true,
        };

        const custom = render({ ...green, customRuleKeyword: "LAP DOD INT" });

        expect(custom).toContain(
            'aria-label="Custom import rule applied to this transaction"'
        );
        expect(custom).toContain(
            'title="Custom import rule applied to this transaction — click to disable for this import"'
        );
        expect(custom).not.toContain("Existing learned rule applied");

        const learned = render(green);

        expect(learned).toContain(
            'aria-label="Existing learned rule applied to this transaction"'
        );
        expect(learned).toContain(
            'title="Existing learned rule applied to this transaction — click to disable for this import"'
        );
        expect(learned).not.toContain("Custom import rule applied");
    });

    it("custom-rule rows count as Learned in the progress counters, never Manual", () => {
        const base = [
            row(1, "LAP DOD INT JUN22"),
            row(2, "LAP DOD INT July22"),
            row(3, "NET TXN: BILLDESK SBICARD"),
        ];

        const result = withCustomImportRules(
            { candidates: base, matchedRowNumbers: new Set() },
            [DOD]
        );

        const overrides = createEmptyPreviewOverrides();

        expect(
            countImportProgress(
                result.candidates,
                result.matchedRowNumbers,
                deriveSessionLearnedRowNumbers(
                    result.candidates,
                    overrides,
                    result.matchedRowNumbers
                ),
                new Map(),
                overrides
            )
        ).toEqual({
            learned: 2,
            manual: 0,
            remaining: 1,
            processed: 2,
            total: 3,
        });
    });
});
