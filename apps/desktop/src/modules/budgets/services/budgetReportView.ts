import type { Budget } from "../types";

import type {
    BudgetSpendingLine,
    BudgetSpendingSummary,
} from "./budgetSpending";

// ---------------------------------------------------------------------
// Phase 3 - Budget-vs-Actual view logic
//
// Pure transforms that turn a Phase 2 BudgetSpendingSummary into the
// shape the Budgets screen renders. NONE of this recalculates spending,
// remaining, or percentages - every number here is read straight off
// the engine's `lines` / totals. It only adds display labels, status
// wording, ordering and text filtering.
// ---------------------------------------------------------------------

export type BudgetStatusKey =
    | "no-spending"
    | "on-track"
    | "approaching"
    | "over";

export interface BudgetStatusDescriptor {
    key: BudgetStatusKey;
    label: string;
}

// Reads the engine's own verdict (overBudget / thresholdState) and picks
// a label. "No spending" and "On track" are both the engine's "ok"
// state - split here only so the screen can show the two sub-cases the
// UI spec asks for; they carry the same (calm) visual weight.
export function describeBudgetStatus(
    line: Pick<
        BudgetSpendingLine,
        "thresholdState" | "overBudget" | "actualAmount"
    >
): BudgetStatusDescriptor {
    if (
        line.overBudget ||
        line.thresholdState === "over"
    ) {
        return { key: "over", label: "Over budget" };
    }

    if (line.thresholdState === "approaching") {
        return {
            key: "approaching",
            label: "Approaching limit",
        };
    }

    if (line.actualAmount === 0) {
        return {
            key: "no-spending",
            label: "No spending",
        };
    }

    return { key: "on-track", label: "On track" };
}

export interface BudgetReportRow {
    budgetId: string;
    budgetName: string;
    /** Category name, or the overall-budget label for a null category. */
    categoryLabel: string;
    /** True when this is a null-category ("overall") budget. */
    isOverallBudget: boolean;
    budgetAmount: number;
    actualAmount: number;
    /** NOT clamped - may be negative. Straight from the engine line. */
    remainingAmount: number;
    /** NOT clamped - may exceed 100. Straight from the engine line. */
    percentageUsed: number;
    overBudget: boolean;
    status: BudgetStatusDescriptor;
}

export const OVERALL_BUDGET_LABEL = "All categories";
export const UNKNOWN_CATEGORY_LABEL = "Unknown category";

// The label to show for a budget's category. `null` returns undefined so
// the caller can render its own overall-budget wording; a categoryId
// that no longer resolves (deleted / hidden category) is shown as
// "Unknown category" rather than being mistaken for an overall budget.
export function resolveBudgetCategoryLabel(
    categoryId: string | null,
    categoryNameById: ReadonlyMap<string, string>
): string | undefined {
    if (categoryId === null) {
        return undefined;
    }

    return (
        categoryNameById.get(categoryId) ??
        UNKNOWN_CATEGORY_LABEL
    );
}

// One display row per engine line, in the engine's order. A category
// budget whose category can't be resolved (e.g. a deleted category -
// handled properly in a later phase) is labelled "Unknown category"
// rather than being conflated with an overall budget.
export function buildBudgetReportRows(
    summary: BudgetSpendingSummary,
    categoryNameById: ReadonlyMap<string, string>
): BudgetReportRow[] {
    return summary.lines.map(line => {
        const isOverallBudget = line.categoryId === null;

        const categoryLabel = isOverallBudget
            ? OVERALL_BUDGET_LABEL
            : categoryNameById.get(line.categoryId as string) ??
              UNKNOWN_CATEGORY_LABEL;

        return {
            budgetId: line.budgetId,
            budgetName: line.budgetName,
            categoryLabel,
            isOverallBudget,
            budgetAmount: line.budgetAmount,
            actualAmount: line.actualAmount,
            remainingAmount: line.remainingAmount,
            percentageUsed: line.percentageUsed,
            overBudget: line.overBudget,
            status: describeBudgetStatus(line),
        };
    });
}

// Text filter over the rendered rows (budget name + category label).
// Mirrors the existing Budgets page search behaviour.
export function filterBudgetReportRows(
    rows: readonly BudgetReportRow[],
    query: string
): BudgetReportRow[] {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
        return [...rows];
    }

    return rows.filter(row =>
        `${row.budgetName} ${row.categoryLabel}`
            .toLowerCase()
            .includes(normalized)
    );
}

// A percent string to 1 decimal place, or "—" when there is no budget
// to measure against (avoids a misleading "0%").
export function formatPercentUsed(
    percentageUsed: number,
    budgetAmount: number
): string {
    if (
        budgetAmount <= 0 ||
        !Number.isFinite(percentageUsed)
    ) {
        return "—";
    }

    return `${percentageUsed.toFixed(1)}%`;
}

export interface CurrencyScopeOption {
    id: string;
    code: string;
    isDefault: boolean;
}

// The distinct currencies to render a Budget-vs-Actual section for: one
// per currency that has an applicable budget this month (default
// currency first, then alphabetical by code). When nothing applies,
// falls back to the single default currency so a spending-only view
// still has a scope to report in. Never merges currencies.
//
// `appDefaultCurrencyCode` (optional) is the app's actual configured
// default currency - see useDisplaySettings' defaultCurrency, sourced
// from app_settings (general.default_currency), which is what every
// other module already treats as "the" default. It is preferred over
// each currency's own `isDefault` column whenever provided: that
// column lives on the currencies table and can drift out of sync with
// the real app-wide setting (a real production case - is_default was
// left set on USD from initial seeding while general.default_currency
// had since been changed to INR), which is exactly what made the
// zero-budget fallback pick "$" while every other page correctly
// showed "₹". Omitting it (existing callers) preserves the previous,
// isDefault-only behavior exactly.
export function resolveBudgetCurrencyScopes(
    applicableBudgets: readonly Pick<Budget, "currencyId">[],
    currencies: readonly CurrencyScopeOption[],
    appDefaultCurrencyCode?: string
): string[] {
    const byId = new Map(
        currencies.map(currency => [currency.id, currency])
    );

    const isAppDefault = (
        currency: CurrencyScopeOption | undefined
    ): boolean =>
        appDefaultCurrencyCode
            ? currency?.code === appDefaultCurrencyCode
            : Boolean(currency?.isDefault);

    const distinct = Array.from(
        new Set(
            applicableBudgets.map(
                budget => budget.currencyId
            )
        )
    );

    if (distinct.length === 0) {
        const fallback =
            currencies.find(currency =>
                isAppDefault(currency)
            ) ??
            currencies.find(
                currency => currency.isDefault
            ) ??
            currencies[0];

        return fallback ? [fallback.id] : [];
    }

    return distinct.sort((a, b) => {
        const left = byId.get(a);
        const right = byId.get(b);

        const leftIsDefault = isAppDefault(left);
        const rightIsDefault = isAppDefault(right);

        if (leftIsDefault && !rightIsDefault) {
            return -1;
        }

        if (rightIsDefault && !leftIsDefault) {
            return 1;
        }

        return (left?.code ?? a).localeCompare(
            right?.code ?? b
        );
    });
}
