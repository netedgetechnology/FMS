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
        expect(listed).toContainEqual(["PayPal", "PAYPAL", "Active", "Rename", "Deactivate"]);
        expect(listed).toContainEqual(["Other", "OTHER", "Active", "Rename", "Deactivate"]);
        expect(listed).toContainEqual(["Credit Card (legacy)", "CARD", "Inactive", "Rename", "Activate"]);
    });

    it("Add is disabled until a name is entered", () => {
        const addButton = (html: string) => html.match(/<button[^>]*>Add Payment Type<\/button>/)?.[0] ?? "";

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
