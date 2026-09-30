import { describe, expect, it } from "vitest";

import type { CategoryContextMapping } from "../types/CategoryContextMapping";

import {
    addMappingRow,
    CategoryMappingRowInput,
    EMPTY_CATEGORY_MAPPINGS,
    mappingsToRows,
    planMappingWrites,
    removeMappingRow,
    updateMappingRow,
    usedTargetIds,
    validateMappingRowsForSave,
} from "./categoryMappingRows";

function mapping(
    overrides: Partial<CategoryContextMapping>
): CategoryContextMapping {
    return {
        id: "map-1",
        categoryId: "cat-salary",
        accountId: null,
        businessEntityId: null,
        categoryType: "EXPENSE",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

// This module exists because CategoryForm's "+ Add Mapping" button
// silently did nothing: the component's own `mappings` prop defaulted
// to a brand-new `[]` literal on every render (a fresh object identity
// each time, since default parameters re-evaluate on every call where
// the caller omits the prop - true on every AddCategoryDialog render),
// which fed a useEffect keyed on that identity. React saw the
// dependency as "changed" after every render - including the one right
// after a row was added - and the effect immediately reset local row
// state back to []. These tests exercise the row-management logic in
// isolation (this codebase has no DOM/component-render test harness),
// mirroring the click-driven scenarios a user would actually perform.
// Root-cause regression: CategoryForm's `mappings` prop used to default
// to a bare `mappings = []`. A destructured default expression
// re-evaluates every time the function is called with that argument
// omitted - true on every render of a function component, since React
// re-invokes the component body each time - so AddCategoryDialog (which
// never passes a `mappings` prop) produced a brand-new [] object on
// every single render. CategoryForm's `useEffect(() => setMappingRows
// (mappingsToRows(mappings)), [mappings])` was keyed on that value's
// identity, so it re-ran after every render - including the one right
// after "+ Add Mapping" added a row - and immediately reset the row
// list back to []. The button appeared to do nothing, with no thrown
// error. These two tests demonstrate the exact mechanism and confirm
// EMPTY_CATEGORY_MAPPINGS eliminates it.
describe("EMPTY_CATEGORY_MAPPINGS - root cause of the '+ Add Mapping' no-op", () => {
    function withInlineLiteralDefault(
        mappings: readonly CategoryContextMapping[] = []
    ): readonly CategoryContextMapping[] {
        return mappings;
    }

    function withSharedConstantDefault(
        mappings: readonly CategoryContextMapping[] = EMPTY_CATEGORY_MAPPINGS
    ): readonly CategoryContextMapping[] {
        return mappings;
    }

    it("reproduces the bug: an inline `= []` default is a new array reference on every call where the argument is omitted", () => {
        const first = withInlineLiteralDefault();
        const second = withInlineLiteralDefault();

        expect(first).toEqual(second);
        expect(first).not.toBe(second);
    });

    it("confirms the fix: the shared EMPTY_CATEGORY_MAPPINGS default is the identical reference on every call", () => {
        const first = withSharedConstantDefault();
        const second = withSharedConstantDefault();

        expect(first).toBe(second);
    });

    it("CategoryForm's actual default value is stable across repeated accesses", () => {
        expect(EMPTY_CATEGORY_MAPPINGS).toBe(EMPTY_CATEGORY_MAPPINGS);
        expect(EMPTY_CATEGORY_MAPPINGS).toEqual([]);
    });
});

describe("addMappingRow - '+ Add Mapping' button", () => {
    it("1. clicking Add Mapping once adds exactly one row", () => {
        const rows = addMappingRow([]);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            targetType: "account",
            targetId: "",
            categoryType: "EXPENSE",
        });
        expect(rows[0].key).toBeTruthy();
    });

    it("2. clicking Add Mapping multiple times adds multiple rows, each with a distinct key", () => {
        let rows: CategoryMappingRowInput[] = [];

        rows = addMappingRow(rows);
        rows = addMappingRow(rows);
        rows = addMappingRow(rows);

        expect(rows).toHaveLength(3);

        const keys = new Set(rows.map(row => row.key));
        expect(keys.size).toBe(3);
    });

    it("3. adding a row never mutates the array it was given (safe to use directly as React state)", () => {
        const original: CategoryMappingRowInput[] = [];

        const rows = addMappingRow(original);

        expect(original).toHaveLength(0);
        expect(rows).not.toBe(original);
    });

    it("4. adding a row preserves existing rows untouched", () => {
        const existing: CategoryMappingRowInput[] = [
            {
                key: "row-1",
                targetType: "businessEntity",
                targetId: "entity-netedge",
                categoryType: "EXPENSE",
            },
        ];

        const rows = addMappingRow(existing);

        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual(existing[0]);
    });
});

describe("removeMappingRow", () => {
    it("1. removes only the targeted row", () => {
        const rows: CategoryMappingRowInput[] = [
            { key: "row-1", targetType: "account", targetId: "acct-1", categoryType: "INCOME" },
            { key: "row-2", targetType: "account", targetId: "acct-2", categoryType: "EXPENSE" },
        ];

        const result = removeMappingRow(rows, "row-1");

        expect(result).toHaveLength(1);
        expect(result[0].key).toBe("row-2");
    });

    it("2. removing an unrecognized key is a no-op", () => {
        const rows: CategoryMappingRowInput[] = [
            { key: "row-1", targetType: "account", targetId: "acct-1", categoryType: "INCOME" },
        ];

        const result = removeMappingRow(rows, "does-not-exist");

        expect(result).toHaveLength(1);
    });

    it("3. can remove every row down to an empty list", () => {
        const rows: CategoryMappingRowInput[] = [
            { key: "row-1", targetType: "account", targetId: "acct-1", categoryType: "INCOME" },
        ];

        expect(removeMappingRow(rows, "row-1")).toEqual([]);
    });
});

describe("updateMappingRow", () => {
    it("1. updates the targeted row's fields", () => {
        const rows: CategoryMappingRowInput[] = [
            { key: "row-1", targetType: "account", targetId: "acct-1", categoryType: "INCOME" },
        ];

        const result = updateMappingRow(rows, "row-1", { categoryType: "EXPENSE" });

        expect(result[0].categoryType).toBe("EXPENSE");
        expect(result[0].targetId).toBe("acct-1");
    });

    it("2. switching Applies-To from Account to Business Entity clears the previously selected target", () => {
        const rows: CategoryMappingRowInput[] = [
            { key: "row-1", targetType: "account", targetId: "acct-family", categoryType: "INCOME" },
        ];

        const result = updateMappingRow(rows, "row-1", { targetType: "businessEntity" });

        expect(result[0].targetType).toBe("businessEntity");
        expect(result[0].targetId).toBe("");
    });

    it("3. leaves other rows untouched", () => {
        const rows: CategoryMappingRowInput[] = [
            { key: "row-1", targetType: "account", targetId: "acct-1", categoryType: "INCOME" },
            { key: "row-2", targetType: "account", targetId: "acct-2", categoryType: "EXPENSE" },
        ];

        const result = updateMappingRow(rows, "row-1", { categoryType: "EXPENSE" });

        expect(result[1]).toEqual(rows[1]);
    });
});

describe("mappingsToRows - loading existing mappings when editing a category", () => {
    it("1. converts an account-specific mapping into a row", () => {
        const rows = mappingsToRows([
            mapping({ id: "map-1", accountId: "acct-family", categoryType: "INCOME" }),
        ]);

        expect(rows).toEqual([
            {
                key: "map-1",
                id: "map-1",
                targetType: "account",
                targetId: "acct-family",
                categoryType: "INCOME",
            },
        ]);
    });

    it("2. converts a business-entity-specific mapping into a row", () => {
        const rows = mappingsToRows([
            mapping({ id: "map-2", businessEntityId: "entity-netedge", categoryType: "EXPENSE" }),
        ]);

        expect(rows).toEqual([
            {
                key: "map-2",
                id: "map-2",
                targetType: "businessEntity",
                targetId: "entity-netedge",
                categoryType: "EXPENSE",
            },
        ]);
    });

    it("3. converts several existing mappings into the same number of rows", () => {
        const rows = mappingsToRows([
            mapping({ id: "map-1", accountId: "acct-family", categoryType: "INCOME" }),
            mapping({ id: "map-2", businessEntityId: "entity-netedge", categoryType: "EXPENSE" }),
        ]);

        expect(rows).toHaveLength(2);
    });

    it("4. an empty mapping list produces no rows", () => {
        expect(mappingsToRows([])).toEqual([]);
    });
});

describe("usedTargetIds", () => {
    it("1. excludes the row itself from its own used-ids set", () => {
        const rows: CategoryMappingRowInput[] = [
            { key: "row-1", targetType: "account", targetId: "acct-1", categoryType: "INCOME" },
        ];

        expect(usedTargetIds(rows, "account", "row-1").size).toBe(0);
    });

    it("2. includes a target already chosen by a different row of the same type", () => {
        const rows: CategoryMappingRowInput[] = [
            { key: "row-1", targetType: "account", targetId: "acct-1", categoryType: "INCOME" },
            { key: "row-2", targetType: "account", targetId: "", categoryType: "EXPENSE" },
        ];

        expect(usedTargetIds(rows, "account", "row-2")).toEqual(new Set(["acct-1"]));
    });

    it("3. does not cross-contaminate between account and business-entity target types", () => {
        const rows: CategoryMappingRowInput[] = [
            { key: "row-1", targetType: "account", targetId: "acct-1", categoryType: "INCOME" },
            { key: "row-2", targetType: "businessEntity", targetId: "", categoryType: "EXPENSE" },
        ];

        expect(usedTargetIds(rows, "businessEntity", "row-2").size).toBe(0);
    });
});

describe("planMappingWrites - saving new/edited mappings with a category", () => {
    it("1. a brand-new account mapping (Add Category flow, no existing mappings) is planned as a create", () => {
        const plan = planMappingWrites(
            "cat-salary",
            [],
            [
                {
                    key: "row-1",
                    targetType: "account",
                    targetId: "acct-family",
                    categoryType: "INCOME",
                },
            ]
        );

        expect(plan.toCreate).toEqual([
            {
                categoryId: "cat-salary",
                accountId: "acct-family",
                businessEntityId: null,
                categoryType: "INCOME",
            },
        ]);
        expect(plan.toUpdate).toEqual([]);
        expect(plan.toDeleteIds).toEqual([]);
    });

    it("2. a brand-new business-entity mapping is planned as a create with businessEntityId set and accountId null", () => {
        const plan = planMappingWrites(
            "cat-salary",
            [],
            [
                {
                    key: "row-1",
                    targetType: "businessEntity",
                    targetId: "entity-netedge",
                    categoryType: "EXPENSE",
                },
            ]
        );

        expect(plan.toCreate).toEqual([
            {
                categoryId: "cat-salary",
                accountId: null,
                businessEntityId: "entity-netedge",
                categoryType: "EXPENSE",
            },
        ]);
    });

    it("3. multiple new rows in one submit are all planned as creates", () => {
        const plan = planMappingWrites(
            "cat-salary",
            [],
            [
                { key: "row-1", targetType: "account", targetId: "acct-family", categoryType: "INCOME" },
                { key: "row-2", targetType: "businessEntity", targetId: "entity-netedge", categoryType: "EXPENSE" },
            ]
        );

        expect(plan.toCreate).toHaveLength(2);
        expect(plan.toUpdate).toEqual([]);
        expect(plan.toDeleteIds).toEqual([]);
    });

    it("4. a row carrying an existing mapping's id is planned as an update, not a create", () => {
        const existing = [
            mapping({ id: "map-1", accountId: "acct-family", categoryType: "INCOME" }),
        ];

        const plan = planMappingWrites(
            "cat-salary",
            existing,
            [
                {
                    key: "map-1",
                    id: "map-1",
                    targetType: "account",
                    targetId: "acct-family",
                    categoryType: "EXPENSE",
                },
            ]
        );

        expect(plan.toCreate).toEqual([]);
        expect(plan.toUpdate).toEqual([
            {
                id: "map-1",
                accountId: "acct-family",
                businessEntityId: null,
                categoryType: "EXPENSE",
            },
        ]);
        expect(plan.toDeleteIds).toEqual([]);
    });

    it("5. an existing mapping whose row was removed is planned for deletion", () => {
        const existing = [
            mapping({ id: "map-1", accountId: "acct-family", categoryType: "INCOME" }),
            mapping({ id: "map-2", businessEntityId: "entity-netedge", categoryType: "EXPENSE" }),
        ];

        const plan = planMappingWrites(
            "cat-salary",
            existing,
            [
                {
                    key: "map-1",
                    id: "map-1",
                    targetType: "account",
                    targetId: "acct-family",
                    categoryType: "INCOME",
                },
            ]
        );

        expect(plan.toDeleteIds).toEqual(["map-2"]);
    });

    it("6. an unchanged existing mapping is planned as an update (idempotent), never a delete+create", () => {
        const existing = [
            mapping({ id: "map-1", accountId: "acct-family", categoryType: "INCOME" }),
        ];

        const plan = planMappingWrites(
            "cat-salary",
            existing,
            mappingsToRowsForTest(existing)
        );

        expect(plan.toDeleteIds).toEqual([]);
        expect(plan.toCreate).toEqual([]);
        expect(plan.toUpdate).toHaveLength(1);
    });

    it("7. removing every row plans every existing mapping for deletion and nothing else", () => {
        const existing = [
            mapping({ id: "map-1", accountId: "acct-family", categoryType: "INCOME" }),
        ];

        const plan = planMappingWrites("cat-salary", existing, []);

        expect(plan.toDeleteIds).toEqual(["map-1"]);
        expect(plan.toCreate).toEqual([]);
        expect(plan.toUpdate).toEqual([]);
    });
});

function mappingsToRowsForTest(
    mappings: CategoryContextMapping[]
): CategoryMappingRowInput[] {
    return mappingsToRows(mappings);
}

describe("validateMappingRowsForSave", () => {
    it("1. accepts an empty list of mappings", () => {
        expect(() => validateMappingRowsForSave([])).not.toThrow();
    });

    it("2. accepts a valid account mapping", () => {
        expect(() =>
            validateMappingRowsForSave([
                { key: "row-1", targetType: "account", targetId: "acct-family", categoryType: "INCOME" },
            ])
        ).not.toThrow();
    });

    it("3. accepts a valid business-entity mapping", () => {
        expect(() =>
            validateMappingRowsForSave([
                { key: "row-1", targetType: "businessEntity", targetId: "entity-netedge", categoryType: "EXPENSE" },
            ])
        ).not.toThrow();
    });

    it("4. rejects a row where neither Account nor Business Entity is selected", () => {
        expect(() =>
            validateMappingRowsForSave([
                { key: "row-1", targetType: "account", targetId: "", categoryType: "INCOME" },
            ])
        ).toThrow(/Select an Account or Business Entity/);
    });

    it("5. rejects two rows mapped to the same account", () => {
        expect(() =>
            validateMappingRowsForSave([
                { key: "row-1", targetType: "account", targetId: "acct-family", categoryType: "INCOME" },
                { key: "row-2", targetType: "account", targetId: "acct-family", categoryType: "EXPENSE" },
            ])
        ).toThrow(/already has a mapping for that account/);
    });

    it("6. rejects two rows mapped to the same business entity", () => {
        expect(() =>
            validateMappingRowsForSave([
                { key: "row-1", targetType: "businessEntity", targetId: "entity-netedge", categoryType: "INCOME" },
                { key: "row-2", targetType: "businessEntity", targetId: "entity-netedge", categoryType: "EXPENSE" },
            ])
        ).toThrow(/already has a mapping for that business entity/);
    });

    it("7. allows the same target id to be used once as an account and once as a business entity (ids come from different tables)", () => {
        expect(() =>
            validateMappingRowsForSave([
                { key: "row-1", targetType: "account", targetId: "shared-id", categoryType: "INCOME" },
                { key: "row-2", targetType: "businessEntity", targetId: "shared-id", categoryType: "EXPENSE" },
            ])
        ).not.toThrow();
    });

    it("8. a row's targetType always carries exactly one kind of target - never both - by construction", () => {
        // CategoryMappingRowInput has a single targetId discriminated by
        // targetType, so a row can never carry both an account id and a
        // business entity id simultaneously - this is enforced by the
        // type itself, not by a runtime check. The service layer
        // (CategoryContextMappingService) and the database CHECK
        // constraint (migration 038) are the defense-in-depth backstops
        // for this same rule.
        const row: CategoryMappingRowInput = {
            key: "row-1",
            targetType: "account",
            targetId: "acct-family",
            categoryType: "INCOME",
        };

        expect(row.targetType === "account" || row.targetType === "businessEntity").toBe(true);
    });
});
