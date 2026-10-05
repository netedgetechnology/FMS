import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { SEEDED_PAYMENT_TYPE_LIST } from "../testing/seededPaymentTypes";

import {
    PaymentTypeManagerView,
    type PaymentTypeManagerViewProps,
} from "./PaymentTypeManager";

const noop = () => {};

function render(props: Partial<PaymentTypeManagerViewProps> = {}): string {
    return renderToStaticMarkup(
        createElement(PaymentTypeManagerView, {
            paymentTypes: SEEDED_PAYMENT_TYPE_LIST,
            loading: false,
            loadError: null,
            newLabel: "",
            editingId: null,
            editingLabel: "",
            busy: false,
            formError: null,
            reactivateCandidate: null,
            onReactivateCandidate: noop,
            onNewLabelChange: noop,
            onAdd: noop,
            onStartRename: noop,
            onEditingLabelChange: noop,
            onSaveRename: noop,
            onCancelRename: noop,
            onToggleActive: noop,
            ...props,
        })
    );
}

const rows = (html: string) =>
    [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].slice(1).map(match =>
        match[1]!.replace(/<[^>]+>/g, "|").split("|").map(s => s.trim()).filter(Boolean)
    );

describe("Settings -> Payment Types", () => {
    it("lists every type with its code, status and the right toggle action", () => {
        const listed = rows(render());

        expect(listed).toHaveLength(SEEDED_PAYMENT_TYPE_LIST.length);
        expect(listed).toContainEqual(["PayPal", "PAYPAL", "Active"]);
        expect(listed).toContainEqual(["Other", "OTHER", "Active"]);
        expect(listed).toContainEqual(["Credit Card (legacy)", "CARD", "Inactive"]);

        const html = render();
        expect(html).toContain('aria-label="Deactivate PayPal"');
        expect(html).toContain('aria-label="Activate Credit Card (legacy)"');
        expect(html).not.toContain('aria-label="Activate PayPal"');
    });

    it("Add is disabled until a name is entered", () => {
        const addButton = (html: string) => html.match(/<button[^>]*data-testid="add-payment-type"[^>]*>/)?.[0] ?? "";

        expect(addButton(render())).toContain('disabled=""');
        expect(addButton(render({ newLabel: "Google Pay" }))).not.toContain('disabled=""');
    });

    it("shows a rename field with Save/Cancel for the row being renamed", () => {
        const paypal = SEEDED_PAYMENT_TYPE_LIST.find(type => type.code === "PAYPAL")!;
        const html = render({ editingId: paypal.id, editingLabel: "PayPal (Business)" });

        expect(html).toContain('aria-label="Rename PayPal"');
        expect(html).toContain('value="PayPal (Business)"');
        expect(html).toContain(">Save</button>");
        expect(html).toContain(">Cancel</button>");
    });

    it("shows duplicate and load errors", () => {
        expect(render({ formError: 'A payment type "PayPal" already exists.' })).toContain(
            "A payment type &quot;PayPal&quot; already exists."
        );
        expect(render({ loadError: "db locked" })).toContain("db locked");
        expect(render({ loading: true, paymentTypes: [] })).toContain("Loading payment types...");
    });
});

describe("Settings -> Payment Types - adding a name that matches an inactive type", () => {
    const legacy = SEEDED_PAYMENT_TYPE_LIST.find(type => type.code === "CARD")!;

    it("offers to reactivate the existing inactive type instead of adding a second one", () => {
        const html = render({
            formError: `A payment type "${legacy.label}" already exists but is inactive. Activate it instead of adding it again.`,
            reactivateCandidate: legacy,
        });

        expect(html).toContain("already exists but is inactive");
        expect(html).toContain(">Reactivate &quot;Credit Card (legacy)&quot;</button>");
    });

    it("shows no Reactivate action for an ordinary error", () => {
        const html = render({ formError: 'A payment type "PayPal" already exists.' });

        expect(html).not.toContain("Reactivate");
    });
});

describe("Settings -> Payment Types - Add Payment Type button", () => {
    const addButton = (html: string) =>
        html.match(/<button[^>]*data-testid="add-payment-type"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";

    it("is a real FinWea primary button (dark, white text, icon), not plain text", () => {
        const button = addButton(render({ newLabel: "Test Payment Type" }));

        // A direct click handler, not a form submission.
        expect(button).toContain('type="button"');
        expect(render({ newLabel: "Test Payment Type" })).not.toContain("<form");
        expect(button).toContain("bg-slate-900");
        expect(button).toContain("text-white");
        expect(button).toContain("<svg");
        expect(button).toContain("Add Payment Type");
    });

    it.each([
        ["", true],
        ["   ", true],
        ["---", true],
        ["Test Payment Type", false],
        ["  x ", false],
    ])("name %j -> disabled %s", (newLabel, disabled) => {
        expect(addButton(render({ newLabel })).includes('disabled=""')).toBe(disabled);
    });

    it("disabled looks clearly disabled (muted, not-allowed); enabled is the normal primary button", () => {
        const disabled = addButton(render({ newLabel: "" }));
        const enabled = addButton(render({ newLabel: "Manual Payment Test 123" }));

        for (const cls of ["disabled:bg-slate-200", "disabled:text-slate-400", "disabled:cursor-not-allowed", "disabled:opacity-100", "disabled:hover:bg-slate-200"]) {
            expect(disabled).toContain(cls);
        }
        expect(disabled).toContain('disabled=""');
        expect(enabled).not.toContain('disabled=""');
        expect(enabled).toContain("bg-slate-900");
        expect(enabled).toContain("hover:bg-slate-800");
    });

    it("is disabled while a save is in progress, and says so", () => {
        const busy = addButton(render({ newLabel: "Test Payment Type", busy: true }));

        expect(busy).toContain('disabled=""');
        expect(busy).toContain("Saving...");
        expect(addButton(render({ newLabel: "Test Payment Type" }))).not.toContain("Saving...");
    });

    it("every row action is a compact, explicitly styled icon button with a tooltip and accessible name", () => {
        const html = render();
        const iconButtons = [...html.matchAll(/<button[^>]*aria-label="(Rename|Deactivate|Activate|Delete) [^"]*"[^>]*>([\s\S]*?)<\/button>/g)];

        // Rename + Deactivate/Activate + Delete on every row.
        expect(iconButtons.length).toBe(SEEDED_PAYMENT_TYPE_LIST.length * 3);
        for (const [button, , inner] of iconButtons) {
            expect(button).toMatch(/title="(Rename|Deactivate|Activate|Delete)"/);
            expect(button).toContain('type="button"');
            expect(button).toContain("bg-white");
            expect(button).toMatch(/hover:bg-(slate-100|red-50)/);
            expect(button).toContain("focus-visible:ring-2");
            expect(inner).toContain("<svg");
            expect(inner.replace(/<[^>]+>/g, "").trim()).toBe("");
        }
    });

    it("shows how many types are active and inactive", () => {
        const counts = render().match(/data-testid="payment-type-counts"[^>]*>([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, "") ?? "";

        expect(counts).toBe("16 payment types \u00b7 15 active \u00b7 1 inactive");
    });
});
