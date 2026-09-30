import {
    CategoryContextMapping,
    CategoryMappingType,
    CreateCategoryContextMappingRequest,
    UpdateCategoryContextMappingRequest,
} from "../types";

// One row of the CategoryForm "Context Mappings" editor. Not part of
// the react-hook-form/Zod-validated category fields - mappings are a
// separate related entity, synced by the Add/Edit dialogs via
// CategoryContextMappingService after the category itself is
// created/updated. `key` is a stable client-side identity for list
// rendering only, never persisted.
export interface CategoryMappingRowInput {
    key: string;
    id?: string;
    targetType: "account" | "businessEntity";
    targetId: string;
    categoryType: CategoryMappingType;
}

// A stable, shared empty array. CategoryForm's `mappings` prop defaults
// to this when a caller (e.g. AddCategoryDialog, which never has
// existing mappings) omits it. A literal `[]` default parameter value
// would be re-created on every single render - since React re-invokes
// a function component's body on every render, a default parameter
// expression re-runs too - so a `useEffect` keyed on that prop's
// identity would never see two equal reference and would fire after
// every render, each time resetting local row state back to empty and
// wiping out whatever the user had just added. Reusing this one
// constant keeps the reference identical across renders whenever the
// caller doesn't pass anything.
export const EMPTY_CATEGORY_MAPPINGS: readonly CategoryContextMapping[] = [];

function createRowKey(): string {
    return crypto.randomUUID();
}

export function mappingsToRows(
    mappings: readonly CategoryContextMapping[]
): CategoryMappingRowInput[] {
    return mappings.map(mapping => ({
        key: mapping.id,
        id: mapping.id,
        targetType: mapping.accountId ? "account" : "businessEntity",
        targetId: mapping.accountId ?? mapping.businessEntityId ?? "",
        categoryType: mapping.categoryType,
    }));
}

export function addMappingRow(
    rows: readonly CategoryMappingRowInput[]
): CategoryMappingRowInput[] {
    return [
        ...rows,
        {
            key: createRowKey(),
            targetType: "account",
            targetId: "",
            categoryType: "EXPENSE",
        },
    ];
}

export function removeMappingRow(
    rows: readonly CategoryMappingRowInput[],
    key: string
): CategoryMappingRowInput[] {
    return rows.filter(row => row.key !== key);
}

export function updateMappingRow(
    rows: readonly CategoryMappingRowInput[],
    key: string,
    patch: Partial<CategoryMappingRowInput>
): CategoryMappingRowInput[] {
    return rows.map(row =>
        row.key === key
            ? {
                  ...row,
                  ...patch,
                  // Switching Account <-> Business Entity invalidates
                  // the previously selected target - an account id is
                  // never a valid business entity id and vice versa.
                  targetId:
                      patch.targetType && patch.targetType !== row.targetType
                          ? ""
                          : (patch.targetId ?? row.targetId),
              }
            : row
    );
}

export function usedTargetIds(
    rows: readonly CategoryMappingRowInput[],
    targetType: "account" | "businessEntity",
    excludeKey: string
): Set<string> {
    return new Set(
        rows
            .filter(
                row =>
                    row.targetType === targetType &&
                    row.key !== excludeKey &&
                    row.targetId
            )
            .map(row => row.targetId)
    );
}

// Runs immediately before a category (and its mappings) is saved.
// Throws a single, user-facing message describing the first problem
// found, so the Add/Edit Category dialogs can surface it through their
// existing catch/toast error handling without saving anything.
export function validateMappingRowsForSave(
    rows: readonly CategoryMappingRowInput[]
): void {
    const incompleteRow = rows.find(row => !row.targetId);

    if (incompleteRow) {
        throw new Error(
            "Select an Account or Business Entity for every mapping, or remove the incomplete row."
        );
    }

    const seenAccountIds = new Set<string>();
    const seenBusinessEntityIds = new Set<string>();

    for (const row of rows) {
        const seen =
            row.targetType === "account"
                ? seenAccountIds
                : seenBusinessEntityIds;

        if (seen.has(row.targetId)) {
            throw new Error(
                row.targetType === "account"
                    ? "This category already has a mapping for that account. Remove the duplicate row."
                    : "This category already has a mapping for that business entity. Remove the duplicate row."
            );
        }

        seen.add(row.targetId);
    }
}

export interface CategoryMappingWritePlan {
    toCreate: CreateCategoryContextMappingRequest[];
    toUpdate: UpdateCategoryContextMappingRequest[];
    toDeleteIds: string[];
}

// Diffs a category's saved mapping rows against the form's current
// (already-validated - see validateMappingRowsForSave) rows, so the
// Add/Edit Category dialogs only need to execute the resulting plan
// against CategoryContextMappingService, rather than each re-deriving
// which rows are new/changed/removed. AddCategoryDialog always passes
// an empty `existingMappings` (a new category has none yet), so every
// row lands in `toCreate`.
export function planMappingWrites(
    categoryId: string,
    existingMappings: readonly CategoryContextMapping[],
    rows: readonly CategoryMappingRowInput[]
): CategoryMappingWritePlan {
    const rowIds = new Set(
        rows
            .filter((row): row is CategoryMappingRowInput & { id: string } =>
                Boolean(row.id)
            )
            .map(row => row.id)
    );

    const toDeleteIds = existingMappings
        .filter(existing => !rowIds.has(existing.id))
        .map(existing => existing.id);

    const toCreate: CreateCategoryContextMappingRequest[] = [];
    const toUpdate: UpdateCategoryContextMappingRequest[] = [];

    for (const row of rows) {
        const accountId =
            row.targetType === "account" ? row.targetId : null;

        const businessEntityId =
            row.targetType === "businessEntity" ? row.targetId : null;

        if (row.id) {
            toUpdate.push({
                id: row.id,
                accountId,
                businessEntityId,
                categoryType: row.categoryType,
            });
        } else {
            toCreate.push({
                categoryId,
                accountId,
                businessEntityId,
                categoryType: row.categoryType,
            });
        }
    }

    return { toCreate, toUpdate, toDeleteIds };
}
