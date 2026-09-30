export const CATEGORY_TYPE_OPTIONS = [
    { value: "INCOME", label: "Income" },
    { value: "EXPENSE", label: "Expense" },
    { value: "TRANSFER", label: "Transfer" },
] as const;

export const FINANCE_SCOPE_OPTIONS = [
    { value: "PERSONAL", label: "Personal" },
    { value: "BUSINESS", label: "Business" },
] as const;

// A category context mapping's own type - a subset of
// CATEGORY_TYPE_OPTIONS. TRANSFER is excluded: it stays a
// whole-category classification on Category.categoryType and is never
// mapped per-account/per-business-entity (see CategoryMappingType).
export const CATEGORY_MAPPING_TYPE_OPTIONS = CATEGORY_TYPE_OPTIONS.filter(
    option => option.value !== "TRANSFER"
);

// What a category context mapping row applies to - matches
// CategoryMappingRowInput["targetType"] (categories/utils/categoryMappingRows.ts)
// exactly.
export const MAPPING_TARGET_TYPE_OPTIONS = [
    { value: "account", label: "Accounts" },
    { value: "businessEntity", label: "Business Entity" },
] as const;

// Base UI's closed-trigger <Select.Value> does NOT read a mounted
// <Select.Item>'s `label` prop - it only resolves against an `items`
// array/record passed directly to <Select.Root>, which none of the
// Selects in this form use (see @base-ui/react/select's SelectRoot,
// which stores `items` verbatim from its own `items` prop, and
// SelectValue's resolveSelectedLabel, which reads only that same
// `state.items`). With no `items` prop, the closed trigger always
// falls back to stringifying the raw stored value ("account",
// "INCOME", ...) - regardless of any `label` on the dropdown's
// SelectItems, which only affects the OPEN list, not the closed
// summary text. So the closed trigger must be given its label
// explicitly via SelectValue's `children`, looked up from the same
// options mapping the open list already uses - never a second,
// separate hardcoded string.
export function resolveOptionLabel<TValue extends string>(
    options: readonly { value: TValue; label: string }[],
    value: TValue
): string {
    return options.find(option => option.value === value)?.label ?? value;
}
