import type { BusinessEntity } from "@/modules/business-entities/types";
import type { Category } from "@/modules/categories/types";
import type { Currency } from "@/modules/currencies/types";

import type {
    Budget,
    BudgetPeriodType,
} from "../types";

// ---------------------------------------------------------------------
// Phase 4 - Budget Integrity
//
// Pure validation helpers used at the BudgetService boundary:
//  - field validation (name / amount / period / dates / currency)
//  - category assignability (valid, active, EXPENSE - or intentional null)
//  - duplicate detection (same category + currency + entity scope,
//    applying to a common calendar month, among ACTIVE budgets)
//
// No storage, no engine changes. Duplicate detection uses the same
// [startMonth, endMonth-or-open] model as the Phase 1 applicability rule.
// ---------------------------------------------------------------------

const OPEN_ENDED_MONTH = "9999-12";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const VALID_PERIOD_TYPES: readonly BudgetPeriodType[] = [
    "MONTHLY",
    "QUARTERLY",
    "YEARLY",
    "CUSTOM",
];

// -------------------- field validation --------------------

export interface BudgetFieldInput {
    name: string;
    amount: number;
    periodType: string;
    startDate: string;
    endDate?: string | null;
    currencyId: string;
}

function isValidIsoDate(value: string): boolean {
    return (
        ISO_DATE.test(value) &&
        !Number.isNaN(Date.parse(value))
    );
}

// Returns the first validation problem, or null when the fields are
// acceptable. Deliberately matches the existing zod form rules so it
// never rejects anything the Add/Edit form already allows - it just
// also guards non-form callers. Zero amounts stay allowed (the DB and
// the spending engine both handle them).
export function validateBudgetFields(
    input: BudgetFieldInput
): string | null {
    if (!input.name || !input.name.trim()) {
        return "Budget name is required.";
    }

    if (
        typeof input.amount !== "number" ||
        !Number.isFinite(input.amount) ||
        input.amount < 0
    ) {
        return "Budget amount must be a number of zero or more.";
    }

    if (
        !VALID_PERIOD_TYPES.includes(
            input.periodType as BudgetPeriodType
        )
    ) {
        return "Select a valid budget period.";
    }

    if (
        !input.startDate ||
        !isValidIsoDate(input.startDate)
    ) {
        return "A valid start date is required.";
    }

    const endDate = input.endDate ?? "";

    if (endDate) {
        if (!isValidIsoDate(endDate)) {
            return "The end date is not a valid date.";
        }

        if (endDate < input.startDate) {
            return "The end date cannot be before the start date.";
        }
    }

    if (
        input.periodType === "CUSTOM" &&
        !endDate
    ) {
        return "A custom budget period needs an end date.";
    }

    if (
        !input.currencyId ||
        !input.currencyId.trim()
    ) {
        return "A currency is required.";
    }

    return null;
}

// -------------------- category assignability --------------------

export interface BudgetCategoryCheck {
    ok: boolean;
    reason?: string;
}

// A budget's category must be a real, active EXPENSE category. A null
// category is always valid - it is an intentional overall/all-category
// budget, not a missing reference.
export function validateBudgetCategory(
    categoryId: string | null,
    category: Category | null | undefined
): BudgetCategoryCheck {
    if (categoryId === null) {
        return { ok: true };
    }

    if (!category) {
        return {
            ok: false,
            reason: "The selected category no longer exists.",
        };
    }

    if (category.categoryType !== "EXPENSE") {
        return {
            ok: false,
            reason: "Budgets can only track expense categories.",
        };
    }

    if (!category.isActive) {
        return {
            ok: false,
            reason: "The selected category is inactive.",
        };
    }

    return { ok: true };
}

// -------------------- reference validation --------------------

export interface BudgetReferenceCheck {
    ok: boolean;
    reason?: string;
}

// A budget's currency is mandatory. It must resolve to a real, non
// soft-deleted currency row. Currencies have no active/inactive state,
// so existence is the whole check.
export function validateBudgetCurrency(
    currency: Currency | null | undefined
): BudgetReferenceCheck {
    if (!currency) {
        return {
            ok: false,
            reason: "The selected currency no longer exists.",
        };
    }

    return { ok: true };
}

// A budget's business entity is optional. A null entity is always valid
// - an unscoped/personal budget, not a missing reference. When one is
// supplied it must resolve to a real, active entity - the same shape of
// rule as validateBudgetCategory above.
export function validateBudgetBusinessEntity(
    businessEntityId: string | null,
    entity: BusinessEntity | null | undefined
): BudgetReferenceCheck {
    if (businessEntityId === null) {
        return { ok: true };
    }

    if (!entity) {
        return {
            ok: false,
            reason: "The selected business entity no longer exists.",
        };
    }

    if (!entity.isActive) {
        return {
            ok: false,
            reason: "The selected business entity is inactive.",
        };
    }

    return { ok: true };
}

// -------------------- duplicate detection --------------------

export interface BudgetConflictIdentity {
    /** Present on edit - the budget being changed is never its own duplicate. */
    id?: string | null;
    categoryId: string | null;
    currencyId: string;
    businessEntityId: string | null;
    startDate: string;
    endDate: string | null;
}

function monthKey(date: string): string {
    return date.slice(0, 7);
}

// Do the two budgets' applicable calendar-month ranges overlap? Same
// [startMonth, endMonth-or-open] model the Phase 1 rule uses for
// "does this budget apply to month X".
export function budgetMonthRangesOverlap(
    a: Pick<BudgetConflictIdentity, "startDate" | "endDate">,
    b: Pick<BudgetConflictIdentity, "startDate" | "endDate">
): boolean {
    const aStart = monthKey(a.startDate);
    const bStart = monthKey(b.startDate);

    const aEnd = a.endDate
        ? monthKey(a.endDate)
        : OPEN_ENDED_MONTH;

    const bEnd = b.endDate
        ? monthKey(b.endDate)
        : OPEN_ENDED_MONTH;

    return aStart <= bEnd && bStart <= aEnd;
}

// Same category, currency and business-entity scope, and overlapping
// applicable months. periodType-agnostic on purpose: two budgets that
// would both be counted for one category in one month are duplicates
// however each one labels its period. Different month / currency /
// entity scopes never conflict.
export function budgetIdentitiesConflict(
    a: BudgetConflictIdentity,
    b: BudgetConflictIdentity
): boolean {
    if (
        (a.categoryId ?? null) !==
        (b.categoryId ?? null)
    ) {
        return false;
    }

    if (a.currencyId !== b.currencyId) {
        return false;
    }

    if (
        (a.businessEntityId ?? null) !==
        (b.businessEntityId ?? null)
    ) {
        return false;
    }

    return budgetMonthRangesOverlap(a, b);
}

// The first ACTIVE budget that duplicates `candidate` (self excluded by
// id), or null. `existing` is expected to already exclude soft-deleted
// rows - BudgetRepository.getAll does.
export function findConflictingBudget(
    candidate: BudgetConflictIdentity,
    existing: readonly Budget[]
): Budget | null {
    for (const budget of existing) {
        if (
            candidate.id &&
            budget.id === candidate.id
        ) {
            continue;
        }

        if (!budget.isActive) {
            continue;
        }

        if (
            budgetIdentitiesConflict(
                candidate,
                budget
            )
        ) {
            return budget;
        }
    }

    return null;
}
