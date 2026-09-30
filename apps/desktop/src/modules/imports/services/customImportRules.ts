import type {
    NormalizedTransactionCandidate,
    TransactionChannel,
} from "@financeos/import-engine";

import type { CategoryContextMapping } from "@/modules/categories/types";
import {
    isLockedResolution,
    resolveCategoryTransactionType,
} from "@/modules/categories/utils";

import type { CustomImportRule } from "../types";

// ---------------------------------------------------------------------
// User-defined Custom Import Rules.
//
// A rule matches a row when the row's ORIGINAL imported Description
// contains the rule's keyword - case-insensitive, with runs of
// whitespace treated as one space - so "LAP DOD INT" matches
// "LAP DOD INT JUN22", "lap  dod int July22" and "LAP DOD INT AUG22".
// The Description itself is never modified.
//
// Precedence, per field:   Custom Rule  >  Self-Learning  >  imported
// Custom rules are applied on top of candidates that Self-Learning has
// already enriched, and only overwrite the fields a rule specifies; every
// other field keeps its learned/imported value. Between several matching
// rules, the most recently created rule wins for each field it sets
// (`rules` must be newest-first - see CustomImportRuleRepository).
// ---------------------------------------------------------------------

export type CustomRuleField =
    | "payee"
    | "notes"
    | "categoryId"
    | "transactionType";

export const CUSTOM_RULE_FIELDS: readonly CustomRuleField[] = [
    "payee",
    "notes",
    "categoryId",
    "transactionType",
];

export interface CustomRuleApplication {
    // The rule that supplied each field it set on this row.
    ruleIdByField: Partial<Record<CustomRuleField, string>>;
    // Every rule that contributed at least one field, newest first.
    ruleIds: string[];
    // The newest contributing rule's keyword - for the row's badge.
    keyword: string;
    // Set when the winning rule's category was NOT applied because it is
    // locked to the opposite direction for this account (see
    // CategoryDirectionLocks) - so the preview can say why the row has no
    // rule category and let the user pick one.
    rejectedCategory?: RejectedRuleCategory;
}

export interface RejectedRuleCategory {
    categoryId: string;
    ruleId: string;
    // The direction the category is locked to for this account.
    lockedTo: "income" | "expense";
}

// categoryId -> the direction an account- or business-entity-specific
// mapping LOCKS it to for one import's destination account - exactly the
// hard rule TransactionService.assertCompatibleType enforces on save and
// the Import Preview's category options filter by (see
// resolveImportCategoryOptions). Categories without such a lock are
// absent: their default categoryType stays a soft suggestion. Plain JSON
// so it can travel with a saved import draft.
export type CategoryDirectionLocks = Readonly<
    Record<string, "income" | "expense">
>;

export function categoryDirectionLocksFor(
    mappings: readonly CategoryContextMapping[],
    account: { id: string; businessEntityId: string | null } | null
): Record<string, "income" | "expense"> {
    const locks: Record<string, "income" | "expense"> = {};

    if (!account) {
        return locks;
    }

    for (const categoryId of new Set(
        mappings.map(mapping => mapping.categoryId)
    )) {
        const resolution = resolveCategoryTransactionType({
            categoryId,
            accountId: account.id,
            businessEntityId: account.businessEntityId,
            mappings,
            // Only mappings can lock a category; the category's own
            // default type is never consulted for a lock.
            categories: [],
        });

        if (isLockedResolution(resolution) && resolution.categoryType) {
            locks[categoryId] =
                resolution.categoryType === "INCOME" ? "income" : "expense";
        }
    }

    return locks;
}

// Whether a rule's category may be applied to a row of this direction:
// never when the category is locked to the other direction (saving it
// would be rejected). A row with no direction yet is left alone.
export function isRuleCategoryAllowed(
    categoryId: string,
    direction: NormalizedTransactionCandidate["type"],
    locks: CategoryDirectionLocks | undefined
): boolean {
    const lockedTo = locks?.[categoryId];

    return !lockedTo || !direction || lockedTo === direction;
}

export function normalizeRuleText(
    value: string | null | undefined
): string {
    return (value ?? "")
        .replace(/ /g, " ")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function specifiedValue(
    rule: CustomImportRule,
    field: CustomRuleField
): string | null {
    const value = rule[field];

    return value === null || value === undefined || value.trim() === ""
        ? null
        : value;
}

// Rules prepared once per call: normalized keyword + the fields they set.
interface PreparedRule {
    rule: CustomImportRule;
    needle: string;
    fields: CustomRuleField[];
}

function prepare(rules: readonly CustomImportRule[]): PreparedRule[] {
    const prepared: PreparedRule[] = [];

    for (const rule of rules) {
        const needle = normalizeRuleText(rule.keyword);
        const fields = CUSTOM_RULE_FIELDS.filter(
            field => specifiedValue(rule, field) !== null
        );

        if (needle && fields.length > 0) {
            prepared.push({ rule, needle, fields });
        }
    }

    return prepared;
}

export function customRuleMatchesDescription(
    rule: Pick<CustomImportRule, "keyword">,
    description: string | null | undefined
): boolean {
    const needle = normalizeRuleText(rule.keyword);

    return (
        needle !== "" &&
        normalizeRuleText(description).includes(needle)
    );
}

// Which fields the matching rules would set on one row (newest rule wins
// per field), or null when no rule matches.
function resolveForDescription(
    prepared: readonly PreparedRule[],
    description: string | null | undefined
): {
    values: Partial<Record<CustomRuleField, string>>;
    application: CustomRuleApplication;
} | null {
    if (prepared.length === 0) {
        return null;
    }

    const haystack = normalizeRuleText(description);

    if (!haystack) {
        return null;
    }

    const values: Partial<Record<CustomRuleField, string>> = {};
    const ruleIdByField: Partial<Record<CustomRuleField, string>> = {};
    const ruleIds: string[] = [];
    let keyword = "";

    for (const { rule, needle, fields } of prepared) {
        if (!haystack.includes(needle)) {
            continue;
        }

        let contributed = false;

        for (const field of fields) {
            if (values[field] === undefined) {
                values[field] = specifiedValue(rule, field)!;
                ruleIdByField[field] = rule.id;
                contributed = true;
            }
        }

        if (contributed) {
            ruleIds.push(rule.id);
            keyword ||= rule.keyword.trim();
        }
    }

    if (ruleIds.length === 0) {
        return null;
    }

    return {
        values,
        application: { ruleIdByField, ruleIds, keyword },
    };
}

export interface CustomRulesResult {
    candidates: NormalizedTransactionCandidate[];
    // rowNumber -> how custom rules applied to it (only matched rows).
    applications: Map<number, CustomRuleApplication>;
}

// The Import Preview's note on a row whose rule category was not applied
// (see CustomRuleApplication.rejectedCategory).
export function describeRejectedRuleCategory(params: {
    keyword: string;
    categoryName: string | null;
    lockedTo: "income" | "expense";
    direction: NormalizedTransactionCandidate["type"];
}): string {
    const { keyword, categoryName, lockedTo, direction } = params;
    const category = categoryName ? `Category "${categoryName}"` : "Its category";
    const locked = lockedTo === "income" ? "Income" : "Expense";
    const row =
        direction === "income"
            ? "a Credit"
            : direction === "expense"
              ? "a Debit"
              : "the other direction";

    return `${category} from rule "${keyword}" not applied: it is ${locked}-only for this account and this row is ${row}. Choose a category.`;
}

// Applies the account's custom rules to (already Self-Learning-enriched)
// candidates. Unmatched rows are returned as the very same objects;
// matched rows get a new object with only the specified fields replaced.
// Linear in rows x rules; each Description is normalized once.
//
// A rule's category is applied only when it is allowed for the row's
// Credit/Debit direction (see isRuleCategoryAllowed / `categoryLocks`).
// Otherwise the row keeps the category it had before custom rules
// (Self-Learning's or none), the rejection is recorded on the row's
// application, and the rule's other fields (Payee, Notes, channel) still
// apply - so the row stays importable and the user chooses a category.
// The row's direction is never changed.
export function applyCustomImportRules(
    candidates: readonly NormalizedTransactionCandidate[],
    rules: readonly CustomImportRule[],
    categoryLocks?: CategoryDirectionLocks
): CustomRulesResult {
    const prepared = prepare(rules);
    const applications = new Map<number, CustomRuleApplication>();

    if (prepared.length === 0) {
        return { candidates: [...candidates], applications };
    }

    const result = candidates.map(candidate => {
        const resolved = resolveForDescription(
            prepared,
            candidate.description
        );

        if (!resolved) {
            return candidate;
        }

        const { values, application } = resolved;

        if (
            values.categoryId !== undefined &&
            !isRuleCategoryAllowed(
                values.categoryId,
                candidate.type,
                categoryLocks
            )
        ) {
            application.rejectedCategory = {
                categoryId: values.categoryId,
                ruleId: application.ruleIdByField.categoryId!,
                lockedTo: categoryLocks![values.categoryId]!,
            };
            delete values.categoryId;
            delete application.ruleIdByField.categoryId;
        }

        applications.set(candidate.rowNumber, application);

        return {
            ...candidate,
            payee: values.payee ?? candidate.payee,
            notes: values.notes ?? candidate.notes,
            categoryId: values.categoryId ?? candidate.categoryId ?? null,
            transactionType:
                (values.transactionType as TransactionChannel | undefined) ??
                candidate.transactionType,
        };
    });

    return { candidates: result, applications };
}

// The fields custom rules set on a row with this Description - used at
// import time so Self-Learning never learns a value a custom rule owns.
export function customRuleFieldsForDescription(
    description: string | null | undefined,
    rules: readonly CustomImportRule[]
): Set<CustomRuleField> {
    const resolved = resolveForDescription(prepare(rules), description);

    return new Set(
        resolved
            ? (Object.keys(resolved.values) as CustomRuleField[])
            : []
    );
}

// How many of these rows a (draft) rule's keyword would match - for the
// "matches N rows" count while creating a rule.
export function countCustomRuleMatches(
    candidates: readonly Pick<NormalizedTransactionCandidate, "description">[],
    keyword: string
): number {
    const needle = normalizeRuleText(keyword);

    if (!needle) {
        return 0;
    }

    let count = 0;

    for (const candidate of candidates) {
        if (normalizeRuleText(candidate.description).includes(needle)) {
            count += 1;
        }
    }

    return count;
}
