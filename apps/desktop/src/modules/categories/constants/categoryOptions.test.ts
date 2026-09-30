import { describe, expect, it } from "vitest";

import {
    CATEGORY_MAPPING_TYPE_OPTIONS,
    MAPPING_TARGET_TYPE_OPTIONS,
    resolveOptionLabel,
} from "./categoryOptions";

// The options mapping itself - value/label pairing. This alone does NOT
// fix the closed-trigger display (see resolveOptionLabel tests below);
// it's the single source of truth both SelectItem's rendered children
// (the open dropdown list) and resolveOptionLabel (the closed trigger)
// read from.
describe("MAPPING_TARGET_TYPE_OPTIONS", () => {
    it("keeps the internal 'account' value paired with the 'Accounts' label", () => {
        const option = MAPPING_TARGET_TYPE_OPTIONS.find(
            item => item.value === "account"
        );

        expect(option).toBeDefined();
        expect(option?.value).toBe("account");
        expect(option?.label).toBe("Accounts");
    });

    it("keeps the internal 'businessEntity' value paired with the 'Business Entity' label", () => {
        const option = MAPPING_TARGET_TYPE_OPTIONS.find(
            item => item.value === "businessEntity"
        );

        expect(option).toBeDefined();
        expect(option?.value).toBe("businessEntity");
        expect(option?.label).toBe("Business Entity");
    });

    it("keeps the internal values exactly as CategoryMappingRowInput expects them - never title-cased", () => {
        const values = MAPPING_TARGET_TYPE_OPTIONS.map(option => option.value);

        expect(values).toEqual(["account", "businessEntity"]);
        expect(values).not.toContain("Accounts");
        expect(values).not.toContain("BusinessEntity");
    });

    it("has exactly two options, matching CategoryMappingRowInput['targetType']", () => {
        expect(MAPPING_TARGET_TYPE_OPTIONS).toHaveLength(2);
        expect(MAPPING_TARGET_TYPE_OPTIONS.map(o => o.value)).toEqual([
            "account",
            "businessEntity",
        ]);
    });
});

// CATEGORY_MAPPING_TYPE_OPTIONS is the shared mapping already used
// elsewhere for Category Type - the Context Mapping Type selector reuses
// it rather than defining its own Income/Expense labels.
describe("CATEGORY_MAPPING_TYPE_OPTIONS - Context Mapping Type selector", () => {
    it("keeps the internal 'INCOME' value paired with the 'Income' label", () => {
        const option = CATEGORY_MAPPING_TYPE_OPTIONS.find(
            item => item.value === "INCOME"
        );

        expect(option).toBeDefined();
        expect(option?.value).toBe("INCOME");
        expect(option?.label).toBe("Income");
    });

    it("keeps the internal 'EXPENSE' value paired with the 'Expense' label", () => {
        const option = CATEGORY_MAPPING_TYPE_OPTIONS.find(
            item => item.value === "EXPENSE"
        );

        expect(option).toBeDefined();
        expect(option?.value).toBe("EXPENSE");
        expect(option?.label).toBe("Expense");
    });

    it("excludes TRANSFER - never mapped per-account/per-business-entity", () => {
        const values: readonly string[] =
            CATEGORY_MAPPING_TYPE_OPTIONS.map(option => option.value);

        expect(values).not.toContain("TRANSFER");
        expect(values).toEqual(["INCOME", "EXPENSE"]);
    });
});

// Regression: the Context Mapping "Applies To" and "Type" closed
// triggers kept showing the raw internal value ("account", "INCOME",
// ...) even after every SelectItem was given an explicit `label` prop.
// The reason: Base UI's <Select.Value>, with no `children` of its own,
// resolves its closed-trigger text from `resolveSelectedLabel(value,
// items, ...)` - and `items` there comes ONLY from an `items` prop
// passed directly to <Select.Root> (see @base-ui/react/select's
// SelectRoot/store, which store `items` verbatim from that prop and
// never from mounted <Select.Item> children/labels). None of the
// Selects in CategoryForm pass an `items` prop, so a bare
// `<SelectValue />` always falls through to stringifying the raw value,
// regardless of any SelectItem `label`. resolveOptionLabel is what
// CategoryForm now passes as SelectValue's `children`, so the closed
// trigger resolves its text the same way the open dropdown list already
// did - from this shared options mapping, never a second hardcoded
// string.
describe("resolveOptionLabel - the actual closed-trigger display fix", () => {
    it("resolves 'account' to 'Accounts' using the shared mapping", () => {
        expect(
            resolveOptionLabel(MAPPING_TARGET_TYPE_OPTIONS, "account")
        ).toBe("Accounts");
    });

    it("resolves 'businessEntity' to 'Business Entity' using the shared mapping", () => {
        expect(
            resolveOptionLabel(MAPPING_TARGET_TYPE_OPTIONS, "businessEntity")
        ).toBe("Business Entity");
    });

    it("resolves 'INCOME' to 'Income' using the shared mapping", () => {
        expect(
            resolveOptionLabel(CATEGORY_MAPPING_TYPE_OPTIONS, "INCOME")
        ).toBe("Income");
    });

    it("resolves 'EXPENSE' to 'Expense' using the shared mapping", () => {
        expect(
            resolveOptionLabel(CATEGORY_MAPPING_TYPE_OPTIONS, "EXPENSE")
        ).toBe("Expense");
    });

    it("never mutates or renames the internal value it was given", () => {
        const value = "account";

        resolveOptionLabel(MAPPING_TARGET_TYPE_OPTIONS, value);

        expect(value).toBe("account");
    });

    it("falls back to the raw value itself if a value has no matching option (never throws, never returns undefined)", () => {
        expect(
            resolveOptionLabel(MAPPING_TARGET_TYPE_OPTIONS, "somethingUnmapped")
        ).toBe("somethingUnmapped");
    });
});
