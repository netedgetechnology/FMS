import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

import {
    addMonths,
    currentMonth,
    formatMoney,
    formatMonthLabel,
    isSameMonth,
    MONTH_LABELS,
} from "@/core/formatting";

import type { Budget } from "../types";

import {
    ALL_BUDGETS_LABEL,
    budgetAppliesToMonth,
    budgetAppliesToMonthRange,
    budgetAppliesToYear,
    buildBudgetReportRows,
    calculateBudgetSpending,
    calculateBudgetSpendingForView,
    DEFAULT_BUDGET_VIEW_MODE,
    filterBudgetReportRows,
    resolveBudgetCategoryLabel,
    resolveBudgetCurrencyScopes,
    selectBudgetsForMonth,
    selectBudgetsForView,
    UNKNOWN_CATEGORY_LABEL,
    type BudgetLedgerEntry,
    type BudgetMonthRange,
    type BudgetViewMode,
} from "../services";
import { BudgetRepository } from "../repositories";
import {
    applyRangeMonthClick,
    buildMonthPickerCells,
    buildYearPickerCells,
    formatBudgetPeriodLabel,
    formatMonthRange,
    formatYearPageLabel,
    rangeCellState,
    selectMonthInYear,
    selectYearContext,
    startRangeDraft,
    stepBudgetPeriod,
    stepRangeDraftYear,
    YEAR_PAGE_SIZE,
    yearPageStart,
} from "../components/BudgetPeriodControls";

// BudgetRepository extends the app's Repository base class, which talks
// to a live Tauri SQLite connection - unavailable here. Route its
// select() to an in-memory node:sqlite database instead, so the real
// getAll() SQL (and its soft-delete filter) is what gets exercised.
const repositoryDb = { current: null as DatabaseSync | null };

vi.mock("@/core/database/engine/SQLiteProvider", () => ({
    SQLiteProvider: {
        getInstance: () => ({
            select: async (
                sql: string,
                bindValues: unknown[] = []
            ) =>
                repositoryDb.current!
                    .prepare(sql)
                    .all(
                        ...(bindValues as (
                            | string
                            | number
                            | null
                        )[])
                    ),
        }),
    },
}));

function budget(
    overrides: Partial<Budget> = {}
): Budget {
    return {
        id: "budget-1",
        name: "Groceries",
        categoryId: "cat-groceries",
        businessEntityId: null,
        amount: 10000,
        periodType: "MONTHLY",
        startDate: "2026-09-01",
        endDate: null,
        currencyId: "INR",
        alertThreshold: 80,
        isActive: true,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        ...overrides,
    };
}

const september2026 = new Date(2026, 8, 1);
const august2026 = new Date(2026, 7, 1);
const october2026 = new Date(2026, 9, 1);
const january2027 = new Date(2027, 0, 1);

describe("BudgetsPage - month navigation", () => {
    it("starts the (remembered) month picker on the current calendar month", () => {
        const initial = currentMonth();

        expect(isSameMonth(initial, new Date())).toBe(
            true
        );
        expect(initial.getDate()).toBe(1);
    });

    it("Previous Month steps back one calendar month", () => {
        const previous = addMonths(september2026, -1);

        expect(formatMonthLabel(previous)).toBe(
            "August 2026"
        );
    });

    it("Next Month steps forward one calendar month", () => {
        const next = addMonths(september2026, 1);

        expect(formatMonthLabel(next)).toBe(
            "October 2026"
        );
    });

    it("currentMonth() is today's calendar month from anywhere", () => {
        const wandered = addMonths(september2026, -14);

        expect(
            isSameMonth(wandered, currentMonth())
        ).toBe(false);

        expect(
            isSameMonth(currentMonth(), new Date())
        ).toBe(true);
    });
});

describe("budgetAppliesToMonth - monthly budget contract", () => {
    it("applies to the calendar month its startDate falls in", () => {
        const b = budget({ startDate: "2026-09-15" });

        expect(budgetAppliesToMonth(b, september2026)).toBe(
            true
        );
    });

    it("applies to every month after its startDate when endDate is open", () => {
        const b = budget({
            startDate: "2026-09-01",
            endDate: null,
        });

        expect(budgetAppliesToMonth(b, october2026)).toBe(
            true
        );
        expect(budgetAppliesToMonth(b, january2027)).toBe(
            true
        );
    });

    it("is excluded from months entirely before its startDate", () => {
        const b = budget({ startDate: "2026-09-15" });

        expect(budgetAppliesToMonth(b, august2026)).toBe(
            false
        );
    });

    it("is excluded from months entirely after its endDate", () => {
        const b = budget({
            startDate: "2026-09-01",
            endDate: "2026-09-30",
        });

        expect(budgetAppliesToMonth(b, october2026)).toBe(
            false
        );
    });

    it("includes the endDate boundary month itself", () => {
        const endsMidOctober = budget({
            startDate: "2026-09-01",
            endDate: "2026-10-15",
        });

        expect(
            budgetAppliesToMonth(endsMidOctober, october2026)
        ).toBe(true);
        expect(
            budgetAppliesToMonth(endsMidOctober, september2026)
        ).toBe(true);
        expect(
            budgetAppliesToMonth(endsMidOctober, new Date(2026, 10, 1))
        ).toBe(false);
    });

    it("includes the startDate boundary month even when startDate is the last day", () => {
        const b = budget({ startDate: "2026-09-30" });

        expect(budgetAppliesToMonth(b, september2026)).toBe(
            true
        );
        expect(budgetAppliesToMonth(b, august2026)).toBe(
            false
        );
    });

    it("treats a blank endDate the same as an open-ended one", () => {
        const b = budget({
            startDate: "2026-09-01",
            endDate: "" as unknown as null,
        });

        expect(budgetAppliesToMonth(b, january2027)).toBe(
            true
        );
    });

    it("does not redesign QUARTERLY/YEARLY/CUSTOM - they use the same overlap check", () => {
        const yearly = budget({
            periodType: "YEARLY",
            startDate: "2026-01-01",
            endDate: null,
        });

        const custom = budget({
            periodType: "CUSTOM",
            startDate: "2026-09-10",
            endDate: "2026-11-20",
        });

        expect(budgetAppliesToMonth(yearly, september2026)).toBe(
            true
        );
        expect(budgetAppliesToMonth(custom, october2026)).toBe(
            true
        );
        expect(
            budgetAppliesToMonth(custom, new Date(2026, 11, 1))
        ).toBe(false);
    });
});

describe("selectBudgetsForMonth - multiple budgets across different months", () => {
    const budgets: Budget[] = [
        budget({
            id: "sept-only",
            name: "September only",
            startDate: "2026-09-01",
            endDate: "2026-09-30",
        }),
        budget({
            id: "from-october",
            name: "Starts October",
            startDate: "2026-10-01",
            endDate: null,
        }),
        budget({
            id: "ongoing",
            name: "Ongoing since August",
            startDate: "2026-08-01",
            endDate: null,
        }),
        budget({
            id: "ended-july",
            name: "Ended July",
            startDate: "2026-01-01",
            endDate: "2026-07-31",
        }),
    ];

    it("returns only the budgets applicable to September 2026", () => {
        const result = selectBudgetsForMonth(
            budgets,
            september2026
        );

        expect(result.map(b => b.id).sort()).toEqual([
            "ongoing",
            "sept-only",
        ]);
    });

    it("returns only the budgets applicable to October 2026", () => {
        const result = selectBudgetsForMonth(
            budgets,
            october2026
        );

        expect(result.map(b => b.id).sort()).toEqual([
            "from-october",
            "ongoing",
        ]);
    });

    it("returns none for a month before every budget started", () => {
        const result = selectBudgetsForMonth(
            budgets,
            new Date(2025, 11, 1)
        );

        expect(result).toEqual([]);
    });

    it("preserves the input ordering of the budgets it keeps", () => {
        const result = selectBudgetsForMonth(
            budgets,
            september2026
        );

        expect(result.map(b => b.id)).toEqual([
            "sept-only",
            "ongoing",
        ]);
    });
});

// ---------------------------------------------------------------------
// All Budgets view (default) vs month / year view
//
// This repo has no component-render test setup (vitest runs with
// environment: "node"), so the page's wiring is exercised through the
// exact pure functions BudgetsPage calls: selectBudgetsForView for the
// listed budgets, calculateBudgetSpendingForView for the summary cards
// and rows, filterBudgetReportRows for search.
// ---------------------------------------------------------------------

const INR_ID = "currency-inr";
const USD_ID = "currency-usd";

const currencies = [
    { id: INR_ID, code: "INR", isDefault: false },
    { id: USD_ID, code: "USD", isDefault: true },
];

// The real "Shopping" category id Festival Shopping points at - that
// category row is soft-deleted, so it never appears in the loaded
// category list below.
const SHOPPING_ID = "5dab159b-05f8-4f7e-a0a4-dabf017aa241";

const categoryNameById = new Map([
    ["cat-groceries", "Groceries"],
]);

const festivalShopping = budget({
    id: "festival",
    name: "Festival Shopping",
    categoryId: SHOPPING_ID,
    amount: 50000,
    periodType: "CUSTOM",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    currencyId: INR_ID,
});

const septemberGroceries = budget({
    id: "sept-groceries",
    name: "September Groceries",
    categoryId: "cat-groceries",
    amount: 10000,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    currencyId: INR_ID,
});

const activeBudgets = [festivalShopping, septemberGroceries];

function spend(
    transactionDate: string,
    categoryId: string | null,
    amount: number
): BudgetLedgerEntry {
    return {
        type: "expense",
        amount,
        transactionDate,
        categoryId,
    };
}

const ledger: BudgetLedgerEntry[] = [
    spend("2026-10-05", SHOPPING_ID, 12000),
    // Shopping outside Festival Shopping's own range - unbudgeted.
    spend("2026-09-20", SHOPPING_ID, 3000),
    spend("2026-09-10", "cat-groceries", 4000),
    // Groceries after its September-only budget ended - unbudgeted.
    spend("2026-10-10", "cat-groceries", 2000),
    spend("2026-10-15", null, 500),
    // Before every budget's range - outside the All Budgets view.
    spend("2026-07-01", "cat-groceries", 700),
    {
        type: "income",
        amount: 90000,
        transactionDate: "2026-10-01",
        categoryId: null,
    },
];

function summaryFor(
    viewMode: BudgetViewMode,
    month: Date = october2026,
    budgets: readonly Budget[] = activeBudgets
) {
    return calculateBudgetSpendingForView({
        viewMode,
        budgets,
        transactions: ledger,
        month,
        currencyId: INR_ID,
    });
}

describe("BudgetsPage - All Budgets default view", () => {
    it("1. opens in All Budgets mode by default", () => {
        expect(DEFAULT_BUDGET_VIEW_MODE).toBe("all");
        expect(ALL_BUDGETS_LABEL).toBe("All Budgets");
    });

    it("2. includes every active budget regardless of its month or date range", () => {
        expect(
            selectBudgetsForView(
                activeBudgets,
                "all",
                september2026
            ).map(b => b.id)
        ).toEqual(["festival", "sept-groceries"]);

        // One summary line per active budget, whichever month is
        // remembered in the (unused) month picker.
        for (const month of [
            august2026,
            september2026,
            january2027,
        ]) {
            expect(
                summaryFor("all", month).lines.map(
                    line => line.budgetId
                )
            ).toEqual(["festival", "sept-groceries"]);
        }
    });

    it("2. with the current data, shows the active Festival Shopping - 50,000 - October 2026 budget", () => {
        const summary = summaryFor("all", september2026, [
            festivalShopping,
        ]);

        expect(summary.lines).toHaveLength(1);
        expect(summary.lines[0]).toMatchObject({
            budgetId: "festival",
            budgetName: "Festival Shopping",
            budgetAmount: 50000,
            actualAmount: 12000,
        });
        expect(summary.totalBudgetAmount).toBe(50000);
    });

    it("4. summary cards total every included budget, each measured over its own date range", () => {
        const summary = summaryFor("all");

        expect(
            summary.lines.map(line => [
                line.budgetId,
                line.actualAmount,
            ])
        ).toEqual([
            ["festival", 12000],
            ["sept-groceries", 4000],
        ]);

        expect(summary.totalBudgetAmount).toBe(60000);
        expect(summary.budgetedActual).toBe(16000);
        expect(summary.totalRemaining).toBe(44000);
        expect(summary.totalPercentageUsed).toBeCloseTo(
            (16000 / 60000) * 100
        );
        // Spending inside the budgets' periods (Sept + Oct), excluding
        // July (no budget covers it) and income.
        expect(summary.totalExpense).toBe(21500);
        expect(summary.unbudgetedSpending).toBe(5500);
        expect(summary.uncategorizedSpending).toBe(500);
    });
});

describe("BudgetsPage - soft-deleted budgets never reach the page", () => {
    it("3. BudgetRepository.getAll (the page's only budget source) excludes soft-deleted rows", async () => {
        const db = new DatabaseSync(":memory:");

        db.exec(`
            CREATE TABLE budgets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                category_id TEXT,
                business_entity_id TEXT,
                amount REAL NOT NULL,
                period_type TEXT NOT NULL,
                start_date TEXT NOT NULL,
                end_date TEXT,
                currency_id TEXT NOT NULL,
                alert_threshold REAL NOT NULL,
                is_active INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );
        `);

        const insert = db.prepare(`
            INSERT INTO budgets VALUES
            (?, ?, ?, NULL, ?, ?, ?, ?, 'currency-inr', 80, 1, 'x', 'x', ?)
        `);

        insert.run("festival", "Festival Shopping", SHOPPING_ID, 50000, "CUSTOM", "2026-10-01", "2026-10-31", null);
        insert.run("household", "Household Expenses", "cat-household", 30000, "MONTHLY", "2026-08-01", null, "2026-09-12 20:24:58");
        insert.run("insurance", "Annual Insurance", "cat-insurance", 120000, "YEARLY", "2026-08-01", null, "2026-09-12 20:24:55");

        repositoryDb.current = db;

        try {
            const loaded = await new BudgetRepository().getAll();

            expect(
                selectBudgetsForView(
                    loaded,
                    "all",
                    september2026
                ).map(b => b.name)
            ).toEqual(["Festival Shopping"]);
        } finally {
            repositoryDb.current = null;
            db.close();
        }
    });
});

describe("BudgetsPage - month / year filter", () => {
    // What the page builds when the Month / Year selects change.
    const pick = (monthIndex: number, year: number) =>
        new Date(year, monthIndex, 1);

    it("offers all twelve months", () => {
        expect(MONTH_LABELS).toHaveLength(12);
        expect(MONTH_LABELS[9]).toBe("October");
        expect(formatMonthLabel(pick(9, 2026))).toBe(
            "October 2026"
        );
    });

    it("Previous arrow steps back month by month across a year boundary", () => {
        const visited: string[] = [];
        let month = pick(1, 2027);

        for (let step = 0; step < 4; step++) {
            month = addMonths(month, -1);
            visited.push(formatMonthLabel(month));
        }

        expect(visited).toEqual([
            "January 2027",
            "December 2026",
            "November 2026",
            "October 2026",
        ]);
    });

    it("Next arrow steps forward month by month across a year boundary", () => {
        const visited: string[] = [];
        let month = pick(9, 2026);

        for (let step = 0; step < 4; step++) {
            month = addMonths(month, 1);
            visited.push(formatMonthLabel(month));
        }

        expect(visited).toEqual([
            "November 2026",
            "December 2026",
            "January 2027",
            "February 2027",
        ]);
    });

    it("arrows keep navigating through months with zero budgets", () => {
        // From October 2026 (Festival Shopping) forward through 14
        // budget-less months, then back again to where it started.
        let month = pick(9, 2026);
        const budgetCounts: number[] = [];

        for (let step = 0; step < 14; step++) {
            month = addMonths(month, 1);
            budgetCounts.push(
                selectBudgetsForView(activeBudgets, "month", month)
                    .length
            );
        }

        expect(formatMonthLabel(month)).toBe("December 2027");
        expect(budgetCounts.every(count => count === 0)).toBe(
            true
        );

        for (let step = 0; step < 14; step++) {
            month = addMonths(month, -1);
        }

        expect(formatMonthLabel(month)).toBe("October 2026");
        expect(
            selectBudgetsForView(activeBudgets, "month", month).map(
                b => b.id
            )
        ).toEqual(["festival"]);
    });

    it("an arbitrary month with no budget gives the zero-budget state; spending still uses the existing month logic", () => {
        // July 2026: no budget applies, one groceries expense (700).
        const july = pick(6, 2026);

        expect(
            selectBudgetsForView(activeBudgets, "month", july)
        ).toEqual([]);

        const summary = summaryFor("month", july);

        expect(summary.lines).toEqual([]);
        expect(summary.totalBudgetAmount).toBe(0);
        expect(summary.budgetedActual).toBe(0);
        expect(summary.totalRemaining).toBe(0);
        expect(summary.totalPercentageUsed).toBe(0);
        expect(summary.totalExpense).toBe(700);
        expect(summary.unbudgetedSpending).toBe(700);
        expect(summary.uncategorizedSpending).toBe(0);
        expect(summary).toEqual(
            calculateBudgetSpending({
                budgets: activeBudgets,
                transactions: ledger,
                month: july,
                currencyId: INR_ID,
            })
        );

        // A far-off month with no budgets and no spending: all zero.
        const far = summaryFor("month", pick(4, 2035));

        expect(far.lines).toEqual([]);
        expect(far.totalExpense).toBe(0);
        expect(far.unbudgetedSpending).toBe(0);
    });

    it("5. a selected month/year shows only the budgets applicable to it (existing month rule)", () => {
        const cases: Array<[Date, string[]]> = [
            [pick(8, 2026), ["sept-groceries"]],
            [pick(9, 2026), ["festival"]],
            [pick(10, 2026), []],
        ];

        for (const [month, expected] of cases) {
            const listed = selectBudgetsForView(
                activeBudgets,
                "month",
                month
            );

            expect(listed.map(b => b.id)).toEqual(expected);

            // Unchanged Phase 1 rule.
            expect(listed).toEqual(
                selectBudgetsForMonth(activeBudgets, month)
            );
        }
    });

    it("6. summary cards recalculate for the selected month", () => {
        const october = summaryFor("month", pick(9, 2026));

        expect(october.lines.map(l => l.budgetId)).toEqual([
            "festival",
        ]);
        expect(october.totalBudgetAmount).toBe(50000);
        expect(october.budgetedActual).toBe(12000);
        expect(october.totalRemaining).toBe(38000);
        expect(october.totalPercentageUsed).toBeCloseTo(24);
        expect(october.totalExpense).toBe(14500);
        expect(october.unbudgetedSpending).toBe(2500);
        expect(october.uncategorizedSpending).toBe(500);

        const september = summaryFor("month", pick(8, 2026));

        expect(september.totalBudgetAmount).toBe(10000);
        expect(september.budgetedActual).toBe(4000);
        expect(september.totalExpense).toBe(7000);
        expect(september.unbudgetedSpending).toBe(3000);
        expect(september.uncategorizedSpending).toBe(0);

        // Month mode is exactly the existing month engine.
        expect(october).toEqual(
            calculateBudgetSpending({
                budgets: activeBudgets,
                transactions: ledger,
                month: pick(9, 2026),
                currencyId: INR_ID,
            })
        );
    });

    it("7. switching back to All Budgets restores every active budget and the all-budgets totals", () => {
        const before = summaryFor("all");

        expect(
            summaryFor("month", pick(8, 2026)).lines
        ).toHaveLength(1);

        // The month picker still remembers September.
        expect(summaryFor("all", pick(8, 2026))).toEqual(
            before
        );
        expect(
            selectBudgetsForView(
                activeBudgets,
                "all",
                pick(8, 2026)
            )
        ).toEqual(activeBudgets);
    });
});

describe("BudgetsPage - search in both views", () => {
    const rowsFor = (viewMode: BudgetViewMode) =>
        buildBudgetReportRows(
            summaryFor(viewMode, october2026),
            categoryNameById
        );

    it("8. filters All Budgets rows by budget name and category label", () => {
        const rows = rowsFor("all");

        expect(
            filterBudgetReportRows(rows, "festival").map(
                row => row.budgetId
            )
        ).toEqual(["festival"]);
        expect(
            filterBudgetReportRows(rows, "groceries").map(
                row => row.budgetId
            )
        ).toEqual(["sept-groceries"]);
        expect(
            filterBudgetReportRows(rows, "")
        ).toHaveLength(2);
        expect(
            filterBudgetReportRows(rows, "nothing-matches")
        ).toEqual([]);
    });

    it("8. filters month rows, only within that month's budgets", () => {
        const rows = rowsFor("month");

        expect(
            filterBudgetReportRows(rows, "festival").map(
                row => row.budgetId
            )
        ).toEqual(["festival"]);
        expect(
            filterBudgetReportRows(rows, "groceries")
        ).toEqual([]);
    });
});

describe("BudgetsPage - actions, currency and deleted category in All Budgets view", () => {
    const budgetsById = new Map(
        activeBudgets.map(b => [b.id, b])
    );

    it("9. every row resolves to its Budget so View / Edit / Delete receive the right record in both views", () => {
        for (const viewMode of ["all", "month"] as const) {
            const rows = buildBudgetReportRows(
                summaryFor(viewMode),
                categoryNameById
            );

            expect(rows.length).toBeGreaterThan(0);

            for (const row of rows) {
                expect(
                    budgetsById.get(row.budgetId)?.id
                ).toBe(row.budgetId);
            }
        }

        expect(budgetsById.get("festival")).toBe(
            festivalShopping
        );
    });

    it("10. reports in each budget's own currency via the shared formatter - nothing hardcoded", () => {
        const listed = selectBudgetsForView(
            activeBudgets,
            "all",
            october2026
        );

        // App default is INR (general.default_currency) even though the
        // currencies table's isDefault flag is on USD.
        expect(
            resolveBudgetCurrencyScopes(
                listed,
                currencies,
                "INR"
            )
        ).toEqual([INR_ID]);

        const summary = summaryFor("all");
        const code = currencies.find(
            c => c.id === summary.currencyId
        )?.code;

        expect(
            formatMoney(summary.totalBudgetAmount, {
                currency: code,
            })
        ).toBe(formatMoney(60000, { currency: "INR" }));

        // A USD budget gets its own USD section, never merged into INR.
        const usdBudget = budget({
            id: "usd",
            currencyId: USD_ID,
            startDate: "2026-10-01",
            endDate: "2026-10-31",
        });

        expect(
            resolveBudgetCurrencyScopes(
                [...listed, usdBudget],
                currencies,
                "INR"
            )
        ).toEqual([INR_ID, USD_ID]);
        expect(
            calculateBudgetSpendingForView({
                viewMode: "all",
                budgets: [...activeBudgets, usdBudget],
                transactions: ledger,
                month: october2026,
                currencyId: USD_ID,
            }).lines.map(line => line.budgetId)
        ).toEqual(["usd"]);
    });

    it("11. Festival Shopping's soft-deleted Shopping category still shows as Unknown category", () => {
        const festival = buildBudgetReportRows(
            summaryFor("all"),
            categoryNameById
        ).find(row => row.budgetId === "festival");

        expect(festival?.categoryLabel).toBe(
            UNKNOWN_CATEGORY_LABEL
        );
        expect(festival?.isOverallBudget).toBe(false);
        expect(
            resolveBudgetCategoryLabel(
                festivalShopping.categoryId,
                categoryNameById
            )
        ).toBe(UNKNOWN_CATEGORY_LABEL);
        // The stored category id is left exactly as it was.
        expect(festivalShopping.categoryId).toBe(SHOPPING_ID);
    });
});

// ---------------------------------------------------------------------
// Four views: All Budgets | Year | Month | Range
//
// Year, Month and Range are separate pickers (BudgetYearPicker /
// BudgetMonthPicker / BudgetRangePicker). Their selection rules are the
// pure helpers they call, and the page's arrows are stepBudgetPeriod (no
// render test setup in this repo).
// ---------------------------------------------------------------------

const at = (monthIndex: number, year: number) =>
    new Date(year, monthIndex, 1);

const range = (
    startMonth: number,
    startYear: number,
    endMonth: number,
    endYear: number
): BudgetMonthRange => ({
    start: at(startMonth, startYear),
    end: at(endMonth, endYear),
});

describe("Budgets - All Budgets mode", () => {
    it("is the default and lists every active budget with no date filter", () => {
        expect(DEFAULT_BUDGET_VIEW_MODE).toBe("all");
        expect(
            selectBudgetsForView(activeBudgets, "all", at(2, 2031))
        ).toEqual(activeBudgets);
        expect(summaryFor("all", at(2, 2031))).toEqual(
            summaryFor("all", october2026)
        );
        expect(formatBudgetPeriodLabel("all", at(2, 2031), null)).toBe(
            "All Budgets"
        );
    });
});

describe("Budgets - Year picker", () => {
    it("shows a 3 x 4 grid of 12 years containing the selected year", () => {
        const start = yearPageStart(2026);
        const cells = buildYearPickerCells(start, 2026, true);

        expect(start).toBe(2016);
        expect(formatYearPageLabel(start)).toBe("2016 – 2027");
        expect(cells.map(cell => cell.year)).toEqual([
            2016, 2017, 2018, 2019, 2020, 2021,
            2022, 2023, 2024, 2025, 2026, 2027,
        ]);
        expect(
            cells.filter(cell => cell.selected).map(cell => cell.year)
        ).toEqual([2026]);

        // Only marked while the Year view is showing.
        expect(
            buildYearPickerCells(start, 2026, false).some(
                cell => cell.selected
            )
        ).toBe(false);
    });

    it("previous / next pages move 12 years with no boundary", () => {
        let start = yearPageStart(2026);

        start += YEAR_PAGE_SIZE;
        expect(formatYearPageLabel(start)).toBe("2028 – 2039");

        start -= 3 * YEAR_PAGE_SIZE;
        expect(formatYearPageLabel(start)).toBe("1992 – 2003");

        for (let page = 0; page < 20; page++) {
            start += YEAR_PAGE_SIZE;
        }

        expect(buildYearPickerCells(start, 2026, true)[0].year).toBe(
            2232
        );
    });

    it("selecting a year shows the Year view for that year", () => {
        const month = selectYearContext(at(9, 2026), 2024);

        expect(month).toEqual(at(9, 2024));
        expect(formatBudgetPeriodLabel("year", month, null)).toBe(
            "2024"
        );
        expect(
            selectBudgetsForView(activeBudgets, "year", month)
        ).toEqual([]);
        expect(
            selectBudgetsForView(activeBudgets, "year", at(0, 2026)).map(
                b => b.id
            )
        ).toEqual(["festival", "sept-groceries"]);
    });

    it("the arrows step the Year view one year at a time", () => {
        expect(stepBudgetPeriod("year", at(9, 2026), 1)).toEqual(
            at(9, 2027)
        );
        expect(stepBudgetPeriod("year", at(9, 2026), -5)).toEqual(
            at(9, 2021)
        );
    });
});

describe("Budgets - Month picker", () => {
    it("contains only the 12 months - no years, no All Year", () => {
        const cells = buildMonthPickerCells(at(9, 2026), true);

        expect(cells.map(cell => cell.label)).toEqual([
            "January", "February", "March",
            "April", "May", "June",
            "July", "August", "September",
            "October", "November", "December",
        ]);
        expect(
            cells.filter(cell => cell.selected).map(cell => cell.label)
        ).toEqual(["October"]);
        expect(
            buildMonthPickerCells(at(9, 2026), false).some(
                cell => cell.selected
            )
        ).toBe(false);
    });

    it("selecting a month uses the selected year: October with 2026 selected is October 2026", () => {
        const month = selectMonthInYear(at(0, 2026), 9);

        expect(month).toEqual(at(9, 2026));
        expect(formatBudgetPeriodLabel("month", month, null)).toBe(
            "October"
        );
    });

    it("changing the year changes the month's year context", () => {
        // October 2026 -> pick 2027 in the Year picker -> pick October.
        const year2027 = selectYearContext(at(9, 2026), 2027);
        const october = selectMonthInYear(year2027, 9);

        expect(october).toEqual(at(9, 2027));
        expect(
            selectBudgetsForView(activeBudgets, "month", october)
        ).toEqual([]);

        // Back to 2026 -> October is Festival Shopping again.
        const back = selectMonthInYear(
            selectYearContext(october, 2026),
            9
        );

        expect(
            selectBudgetsForView(activeBudgets, "month", back).map(
                b => b.name
            )
        ).toEqual(["Festival Shopping"]);
    });

    it("the arrows step one month and carry the year context across year boundaries", () => {
        let month = at(10, 2026);
        const visited: string[] = [];

        for (let step = 0; step < 3; step++) {
            month = stepBudgetPeriod("month", month, 1);
            visited.push(formatMonthLabel(month));
        }

        expect(visited).toEqual([
            "December 2026",
            "January 2027",
            "February 2027",
        ]);
        // The Year picker now shows 2027.
        expect(month.getFullYear()).toBe(2027);

        for (let step = 0; step < 4; step++) {
            month = stepBudgetPeriod("month", month, -1);
        }

        expect(month).toEqual(at(9, 2026));
    });

    it("the arrows do nothing in All Budgets / Range (they are disabled)", () => {
        const month = at(9, 2026);

        expect(stepBudgetPeriod("all", month, 1)).toBe(month);
        expect(stepBudgetPeriod("range", month, 1)).toBe(month);
    });
});

describe("Budgets - Range picker", () => {
    it("the first click picks one end, the second completes the range", () => {
        let draft = startRangeDraft(null, at(8, 2026));

        expect(draft).toEqual({ year: 2026, anchor: null });

        const first = applyRangeMonthClick(draft, 0);

        expect(first.range).toBeNull();
        expect(rangeCellState(first.draft, null, 0)).toBe("anchor");

        draft = first.draft;

        const second = applyRangeMonthClick(draft, 2);

        expect(second.range).toEqual(range(0, 2026, 2, 2026));
        expect(second.draft.anchor).toBeNull();
        expect(formatMonthRange(second.range!)).toBe(
            "Jan 2026 – Mar 2026"
        );
    });

    it("picking the end before the start still gives an ordered range; the same month twice is one month", () => {
        const reversed = applyRangeMonthClick(
            applyRangeMonthClick({ year: 2026, anchor: null }, 5).draft,
            1
        );

        expect(reversed.range).toEqual(range(1, 2026, 5, 2026));

        const single = applyRangeMonthClick(
            applyRangeMonthClick({ year: 2026, anchor: null }, 9).draft,
            9
        );

        expect(single.range).toEqual(range(9, 2026, 9, 2026));
        expect(formatMonthRange(single.range!)).toBe("Oct 2026");
    });

    it("crosses years: November 2026 -> next year -> February 2027", () => {
        let draft = startRangeDraft(null, at(0, 2026));

        draft = applyRangeMonthClick(draft, 10).draft;
        draft = stepRangeDraftYear(draft, 1);

        expect(draft.year).toBe(2027);

        const result = applyRangeMonthClick(draft, 1);

        expect(result.range).toEqual(range(10, 2026, 1, 2027));
        expect(formatMonthRange(result.range!)).toBe(
            "Nov 2026 – Feb 2027"
        );
        expect(
            formatBudgetPeriodLabel("range", at(0, 2026), result.range)
        ).toBe("Nov 2026 – Feb 2027");
    });

    it("reopening shows the current range highlighted", () => {
        const current = range(0, 2026, 2, 2026);
        const draft = startRangeDraft(current, at(9, 2030));

        expect(draft.year).toBe(2026);
        expect(
            MONTH_LABELS.map((_, index) =>
                rangeCellState(draft, current, index)
            ).slice(0, 4)
        ).toEqual(["start", "inside", "end", null]);
    });

    it("a same-year range includes every budget applicable to any month of it, with range totals", () => {
        const septToOct = range(8, 2026, 9, 2026);

        expect(
            selectBudgetsForView(activeBudgets, "range", at(0, 2026), septToOct).map(
                b => b.id
            )
        ).toEqual(["festival", "sept-groceries"]);

        const summary = calculateBudgetSpendingForView({
            viewMode: "range",
            range: septToOct,
            budgets: activeBudgets,
            transactions: ledger,
            month: at(0, 2026),
            currencyId: INR_ID,
        });

        expect(summary.monthStart).toBe("2026-09-01");
        expect(summary.monthEnd).toBe("2026-10-31");
        expect(
            summary.lines.map(line => [line.budgetId, line.actualAmount])
        ).toEqual([
            ["festival", 12000],
            ["sept-groceries", 4000],
        ]);
        expect(summary.totalBudgetAmount).toBe(60000);
        // Sept + Oct spending (not July's 700), income excluded.
        expect(summary.totalExpense).toBe(21500);
        expect(summary.unbudgetedSpending).toBe(5500);
        expect(summary.uncategorizedSpending).toBe(500);

        // Jan -> Mar 2026: no budgets applicable.
        expect(
            selectBudgetsForView(
                activeBudgets,
                "range",
                at(0, 2026),
                range(0, 2026, 2, 2026)
            )
        ).toEqual([]);
    });

    it("a cross-year range covers the complete span", () => {
        const decToFeb = range(11, 2026, 1, 2027);
        const decemberBudget = budget({
            id: "december",
            categoryId: "cat-groceries",
            startDate: "2026-12-01",
            endDate: "2026-12-31",
            currencyId: INR_ID,
        });
        const februaryBudget = budget({
            id: "february",
            categoryId: "cat-groceries",
            startDate: "2027-02-01",
            endDate: "2027-02-28",
            currencyId: INR_ID,
        });
        const budgets = [
            festivalShopping,
            decemberBudget,
            februaryBudget,
        ];

        expect(
            selectBudgetsForView(budgets, "range", at(0, 2026), decToFeb).map(
                b => b.id
            )
        ).toEqual(["december", "february"]);

        const summary = calculateBudgetSpendingForView({
            viewMode: "range",
            range: decToFeb,
            budgets,
            transactions: [
                spend("2026-12-05", "cat-groceries", 100),
                spend("2027-01-15", "cat-groceries", 200),
                spend("2027-02-28", "cat-groceries", 400),
                spend("2027-03-01", "cat-groceries", 800),
            ],
            month: at(0, 2026),
            currencyId: INR_ID,
        });

        expect(summary.monthStart).toBe("2026-12-01");
        expect(summary.monthEnd).toBe("2027-02-28");
        expect(
            summary.lines.map(line => [line.budgetId, line.actualAmount])
        ).toEqual([
            ["december", 100],
            ["february", 400],
        ]);
        // January is inside the range but no budget covers it.
        expect(summary.totalExpense).toBe(700);
        expect(summary.budgetedActual).toBe(500);
        expect(summary.unbudgetedSpending).toBe(200);
    });

    it("a one-month range equals the Month view exactly", () => {
        expect(
            calculateBudgetSpendingForView({
                viewMode: "range",
                range: range(9, 2026, 9, 2026),
                budgets: activeBudgets,
                transactions: ledger,
                month: at(0, 2020),
                currencyId: INR_ID,
            })
        ).toEqual(summaryFor("month", at(9, 2026)));
    });
});

describe("Budgets - Year view calculation (unchanged)", () => {
    it("2026 totals are the January - December range", () => {
        const summary = summaryFor("year", at(0, 2026));

        expect(summary.monthStart).toBe("2026-01-01");
        expect(summary.monthEnd).toBe("2026-12-31");
        expect(
            summary.lines.map(line => [line.budgetId, line.actualAmount])
        ).toEqual([
            ["festival", 12000],
            ["sept-groceries", 4000],
        ]);
        expect(summary.totalBudgetAmount).toBe(60000);
        expect(summary.budgetedActual).toBe(16000);
        expect(summary.totalExpense).toBe(22200);
        expect(summary.unbudgetedSpending).toBe(6200);
        expect(summary.uncategorizedSpending).toBe(500);
        expect(summary).toEqual(
            calculateBudgetSpendingForView({
                viewMode: "range",
                range: range(0, 2026, 11, 2026),
                budgets: activeBudgets,
                transactions: ledger,
                month: at(5, 1999),
                currencyId: INR_ID,
            })
        );
    });

    it("measures an open-ended / mid-month budget over its months within the year", () => {
        const summary = calculateBudgetSpendingForView({
            viewMode: "year",
            budgets: [
                budget({
                    id: "open",
                    categoryId: "cat-groceries",
                    startDate: "2026-09-15",
                    endDate: null,
                    currencyId: INR_ID,
                }),
            ],
            transactions: [
                spend("2026-09-10", "cat-groceries", 400),
                spend("2026-12-31", "cat-groceries", 100),
                spend("2026-08-31", "cat-groceries", 50),
                spend("2027-01-01", "cat-groceries", 25),
            ],
            month: at(0, 2026),
            currencyId: INR_ID,
        });

        expect(summary.lines[0].actualAmount).toBe(500);
        expect(summary.totalExpense).toBe(550);
        expect(summary.unbudgetedSpending).toBe(50);
    });

    it("applicability: a year / range applies exactly when one of its months does", () => {
        const budgets = [
            festivalShopping,
            septemberGroceries,
            budget({ id: "open", startDate: "2025-11-15", endDate: null }),
            budget({ id: "old", startDate: "2024-01-01", endDate: "2024-06-30" }),
            budget({ id: "span", startDate: "2025-12-31", endDate: "2026-01-01" }),
        ];

        for (const year of [2023, 2024, 2025, 2026, 2027]) {
            const byMonths = budgets.filter(b =>
                MONTH_LABELS.some((_, monthIndex) =>
                    budgetAppliesToMonth(b, at(monthIndex, year))
                )
            );

            expect(
                budgets.filter(b => budgetAppliesToYear(b, year))
            ).toEqual(byMonths);
        }

        expect(
            budgetAppliesToMonthRange(festivalShopping, range(10, 2026, 1, 2027))
        ).toBe(false);
        expect(
            budgetAppliesToMonthRange(festivalShopping, range(9, 2026, 1, 2027))
        ).toBe(true);
    });
});

describe("Budgets - empty periods", () => {
    it("a year, month or range with no budgets gives the zero-budget state; spending still counts", () => {
        const emptyYear = summaryFor("year", at(0, 2031));
        const emptyMonth = summaryFor("month", at(6, 2026));
        const emptyRange = calculateBudgetSpendingForView({
            viewMode: "range",
            range: range(0, 2026, 7, 2026),
            budgets: activeBudgets,
            transactions: ledger,
            month: at(0, 2026),
            currencyId: INR_ID,
        });

        for (const summary of [emptyYear, emptyMonth, emptyRange]) {
            expect(summary.lines).toEqual([]);
            expect(summary.totalBudgetAmount).toBe(0);
            expect(summary.budgetedActual).toBe(0);
        }

        expect(emptyYear.totalExpense).toBe(0);
        // July 2026's 700 groceries is unbudgeted spending.
        expect(emptyMonth.totalExpense).toBe(700);
        expect(emptyMonth.unbudgetedSpending).toBe(700);
        expect(emptyRange.totalExpense).toBe(700);
        expect(emptyRange.unbudgetedSpending).toBe(700);
    });
});

describe("Budgets - 2026 October Festival Shopping (unchanged)", () => {
    it("Year 2026 -> Month October shows Festival Shopping with the existing month calculation", () => {
        const october = selectMonthInYear(
            selectYearContext(currentMonth(), 2026),
            9
        );

        expect(october).toEqual(at(9, 2026));

        const summary = summaryFor("month", october);

        expect(summary.lines.map(l => l.budgetName)).toEqual([
            "Festival Shopping",
        ]);
        expect(summary.totalBudgetAmount).toBe(50000);
        expect(summary.budgetedActual).toBe(12000);
        expect(summary).toEqual(
            calculateBudgetSpending({
                budgets: activeBudgets,
                transactions: ledger,
                month: at(9, 2026),
                currencyId: INR_ID,
            })
        );
    });
});

describe("Budgets - search and category behaviour in Year / Range views", () => {
    for (const [label, summary] of [
        ["year", () => summaryFor("year", at(0, 2026))],
        [
            "range",
            () =>
                calculateBudgetSpendingForView({
                    viewMode: "range",
                    range: range(8, 2026, 9, 2026),
                    budgets: activeBudgets,
                    transactions: ledger,
                    month: at(0, 2026),
                    currencyId: INR_ID,
                }),
        ],
    ] as const) {
        it(`search and the deleted Shopping category work in ${label} view`, () => {
            const rows = buildBudgetReportRows(
                summary(),
                categoryNameById
            );

            expect(
                filterBudgetReportRows(rows, "festival").map(
                    r => r.budgetId
                )
            ).toEqual(["festival"]);
            expect(
                filterBudgetReportRows(rows, "groceries").map(
                    r => r.budgetId
                )
            ).toEqual(["sept-groceries"]);
            expect(filterBudgetReportRows(rows, "")).toHaveLength(2);
            expect(
                rows.find(r => r.budgetId === "festival")?.categoryLabel
            ).toBe(UNKNOWN_CATEGORY_LABEL);
            expect(festivalShopping.categoryId).toBe(SHOPPING_ID);
        });
    }
});
