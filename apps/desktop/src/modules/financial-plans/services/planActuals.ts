import {
    endOfMonth,
    endOfQuarter,
    endOfYear,
    formatMonthLabel,
    formatQuarterLabel,
    startOfMonth,
    startOfQuarter,
    startOfYear,
    toISODateString,
} from "@/core/formatting";

import {
    classifyBudgetTransaction,
    type BudgetSpendingContext,
} from "@/modules/budgets/services/budgetTransaction";
import type { BudgetLedgerEntry } from "@/modules/budgets/services/budgetSpending";
import type { InvestmentTransaction } from "@/modules/investments/types";
import type { LoanPaymentSchedule } from "@/modules/loans/types";

import {
    ACCOUNT_ASSET_TYPES,
    ACCOUNT_EXCLUDED_TYPES,
    ACCOUNT_LIABILITY_TYPES,
    deriveCategoryRole,
    isPerPeriodTarget,
    isPlanComponentComboAllowed,
} from "../constants";
import { validateComponentTarget } from "./financialPlanComponentValidation";
import type {
    FinancialPlan,
    FinancialPlanComponent,
    PlanComponentRole,
    PlanComponentType,
    PlanPeriodType,
    PlanType,
} from "../types";

// =====================================================================
// Financial Plans - Phase 3: Actuals & Calculation Engine
//
// A pure, deterministic function that derives CURRENT actual values from
// existing FinWea data + Phase 2 component definitions. No projections,
// no progress %, no persistence, no I/O, no clock. See the approved
// Phase 3 spec (decisions A1-A17).
//
// Verified invariants this engine relies on:
//  - transactions.amount / transfers.amount / investment_transactions.*
//    / loan_payment_schedule.* are stored as NON-NEGATIVE MAGNITUDES;
//    direction lives in transaction.type or the transfer's
//    source/destination. Every formula does Math.abs() AFTER finite
//    validation, then applies the type-directed sign. A stray signed
//    value can never reverse the intended direction.
//  - ACCOUNT balance == ReconciliationService.calculateAccountBalance:
//    opening + Σ|income| - Σ|expense| + Σ(transfers-table in/out);
//    `type='transfer'` transaction rows are ignored.
//  - CATEGORY·SPENDING reuses classifyBudgetTransaction verbatim.
//  - LoanPaymentStatus = UPCOMING | PAID | PARTIAL | OVERDUE.
//  - InvestmentTransactionType = BUY | SELL | DIVIDEND | INTEREST |
//    BONUS | SPLIT | OPENING_BALANCE | OTHER. BUY cost = amount+fees+
//    taxes, SELL proceeds = amount-fees-taxes.
// =====================================================================

// -------------------- result types --------------------

export type PlanCalcStatus = "COMPLETE" | "INCOMPLETE";
export type ComponentMeasure = "STOCK" | "FLOW";

export type PlanCalcUnavailableReason =
    | "SOURCE_MISSING"
    | "CURRENCY_MISMATCH"
    | "INVALID_ACCOUNT_TYPE"
    | "INVALID_CATEGORY_TYPE"
    | "SOURCE_DATA_ERROR"
    | "INCOMPATIBLE_WITH_PLAN_TYPE";

export type PlanCalcWarningCode =
    | "NO_COMPONENTS"
    | "PLAN_NOT_STARTED"
    | "PLAN_ENDED"
    | "COMPONENT_UNAVAILABLE"
    | "COMPONENT_DATA_ERROR"
    | "COMPONENT_INACTIVE_EXCLUDED"
    | "CONTAINS_CLOSED_SOURCE"
    | "SKIPPED_MALFORMED_ROWS"
    | "PARTIAL_LOAN_PAYMENTS_IGNORED"
    | "INVESTMENT_SPLIT_IGNORED"
    | "CROSS_CURRENCY_ROWS_EXCLUDED"
    | "MIXED_CASHFLOW_MODE"
    | "COMPONENT_NOT_IN_PLAN_MATRIX";

export interface PlanCalcWarning {
    code: PlanCalcWarningCode;
    componentId: string | null;
    message: string;
}

export interface PlanComponentValueDetail {
    /** ACCOUNT·ASSET / ACCOUNT·LIABILITY: signed account balance. */
    rawBalance?: number;
    /** ACCOUNT·CONTRIBUTION: current-period gross split. */
    grossInflow?: number;
    grossOutflow?: number;
    /** ACCOUNT·CONTRIBUTION: lifetime (plan-window) gross split. */
    lifetimeGrossInflow?: number;
    lifetimeGrossOutflow?: number;
    /** LOAN·LIABILITY. */
    outstandingPrincipal?: number;
    outstandingInterest?: number;
    /** LOAN·CONTRIBUTION. */
    principalRepaidInPeriod?: number;
    principalRepaidLifetime?: number;
}

export interface PlanComponentCalcResult {
    componentId: string;
    componentType: PlanComponentType;
    role: PlanComponentRole;
    measure: ComponentMeasure;
    sourceName: string | null;

    isActive: boolean;
    available: boolean;
    unavailableReason: PlanCalcUnavailableReason | null;

    /** Non-null for LOAN / INVESTMENT sources. */
    sourceStatus: string | null;
    /** True when a CLOSED / ON_HOLD / DEFAULTED source value was used. */
    sourceTerminal: boolean;

    positionValue: number | null; // STOCK only
    periodFlow: number | null; // FLOW only, over current period P
    lifetimeFlow: number | null; // FLOW only, over plan window W

    componentTarget: number | null; // Phase-2 field, echoed; unused here
    detail: PlanComponentValueDetail;
}

export interface PlanCalcTotals {
    planTarget: number | null;
    isPerPeriodTarget: boolean;

    positionValue: number | null;
    currentPeriodInflow: number | null;
    currentPeriodOutflow: number | null;
    currentPeriodNet: number | null;
    lifetimeInflow: number | null;
    lifetimeOutflow: number | null;
    lifetimeNet: number | null;

    activeComponentCount: number;
    unavailableComponentCount: number;
}

export interface PlanCalcResult {
    planId: string;
    planType: PlanType;
    periodType: PlanPeriodType;
    currencyId: string;

    asOf: string;
    window: { start: string; end: string; openEnded: boolean };
    currentPeriod: {
        start: string;
        end: string;
        label: string;
    };

    status: PlanCalcStatus;
    warnings: PlanCalcWarning[];
    components: PlanComponentCalcResult[];
    totals: PlanCalcTotals;
}

// -------------------- ledger bundle (injected) --------------------

export interface LedgerAccount {
    name: string;
    currencyId: string;
    type: string;
    openingBalance: unknown;
}

export interface LedgerTransfer {
    sourceAccountId: string;
    destinationAccountId: string;
    amount: unknown;
    transactionDate: string;
    deletedAt?: string | null;
}

export interface LedgerCategory {
    name: string;
    categoryType: string;
}

export interface LedgerInvestment {
    name: string;
    currencyId: string;
    status: string;
    currentValue: unknown;
}

export interface LedgerLoan {
    name: string;
    currencyId: string;
    status: string;
    outstandingPrincipal: unknown;
    outstandingInterest: unknown;
}

export interface LedgerBundle {
    accountsById: ReadonlyMap<string, LedgerAccount>;
    creditCardAccountIds: ReadonlySet<string>;
    transactions: readonly BudgetLedgerEntry[];
    transfers: readonly LedgerTransfer[];
    emiInterestByTransactionId: ReadonlyMap<string, number>;
    categoriesById: ReadonlyMap<string, LedgerCategory>;
    investmentsById: ReadonlyMap<string, LedgerInvestment>;
    investmentTransactionsByInvestmentId: ReadonlyMap<
        string,
        readonly InvestmentTransaction[]
    >;
    loansById: ReadonlyMap<string, LedgerLoan>;
    loanScheduleByLoanId: ReadonlyMap<
        string,
        readonly LoanPaymentSchedule[]
    >;
}

export interface CalculatePlanActualsInput {
    plan: FinancialPlan;
    components: readonly FinancialPlanComponent[];
    asOf: string;
    ledger: LedgerBundle;
}

// -------------------- money / date helpers --------------------

const MALFORMED = Symbol("malformed");
type MoneyRead = number | typeof MALFORMED;

/**
 * - finite number -> the number
 * - null/undefined AND optional (schema permits it) -> 0
 * - anything else (NaN, Infinity, "", non-numeric, required-but-missing)
 *   -> MALFORMED
 */
function readMoney(
    value: unknown,
    optional: boolean
): MoneyRead {
    if (value === null || value === undefined) {
        return optional ? 0 : MALFORMED;
    }

    const n =
        typeof value === "number"
            ? value
            : Number(value);

    return Number.isFinite(n) ? n : MALFORMED;
}

/** Magnitude of a money value; MALFORMED propagates. */
function mag(
    value: unknown,
    optional: boolean
): MoneyRead {
    const r = readMoney(value, optional);
    return r === MALFORMED ? MALFORMED : Math.abs(r);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: unknown): value is string {
    return (
        typeof value === "string" &&
        ISO_DATE.test(value) &&
        !Number.isNaN(Date.parse(value))
    );
}

function inWindow(
    date: string,
    start: string,
    end: string
): boolean {
    return date >= start && date <= end;
}

function parseLocalDate(iso: string): Date {
    const [y, m, d] = iso
        .split("-")
        .map(part => Number(part));
    return new Date(y, m - 1, d);
}

function clampDate(
    value: string,
    lo: string,
    hi: string
): string {
    if (value < lo) {
        return lo;
    }
    if (value > hi) {
        return hi;
    }
    return value;
}

function round2(n: number): number {
    return (
        Math.round((n + Number.EPSILON) * 100) / 100
    );
}

function sum(values: readonly number[]): number {
    return values.reduce((a, b) => a + b, 0);
}

function measureOf(
    role: PlanComponentRole
): ComponentMeasure {
    return role === "ASSET" || role === "LIABILITY"
        ? "STOCK"
        : "FLOW";
}

// -------------------- window / period --------------------

interface WindowPeriod {
    window: { start: string; end: string; openEnded: boolean };
    period: { start: string; end: string; label: string };
}

function resolveWindowAndPeriod(
    plan: FinancialPlan,
    asOf: string
): WindowPeriod {
    const start = plan.startDate;

    const endRaw =
        plan.endDate && plan.endDate.trim()
            ? plan.endDate.trim()
            : null;

    const openEnded = endRaw === null;
    const hardEnd = openEnded ? asOf : endRaw;

    // effectiveEnd = min(asOf, hardEnd)
    const effectiveEnd =
        hardEnd < asOf ? hardEnd : asOf;

    const window = {
        start,
        end: effectiveEnd,
        openEnded,
    };

    const ref = clampDate(asOf, start, hardEnd);
    const refDate = parseLocalDate(ref);

    let pStart: string;
    let pEnd: string;
    let label: string;

    switch (plan.periodType) {
        case "MONTHLY":
            pStart = toISODateString(
                startOfMonth(refDate)
            );
            pEnd = toISODateString(
                endOfMonth(refDate)
            );
            label = formatMonthLabel(refDate);
            break;
        case "QUARTERLY":
            pStart = toISODateString(
                startOfQuarter(refDate)
            );
            pEnd = toISODateString(
                endOfQuarter(refDate)
            );
            label = formatQuarterLabel(refDate);
            break;
        case "YEARLY":
            pStart = toISODateString(
                startOfYear(refDate)
            );
            pEnd = toISODateString(
                endOfYear(refDate)
            );
            label = String(refDate.getFullYear());
            break;
        case "ONE_TIME":
        default:
            pStart = window.start;
            pEnd = window.end;
            label = "Plan term";
            break;
    }

    return {
        window,
        period: {
            start:
                pStart > window.start
                    ? pStart
                    : window.start,
            end:
                pEnd < window.end
                    ? pEnd
                    : window.end,
            label,
        },
    };
}

// -------------------- component evaluation --------------------

interface EvalCtx {
    plan: FinancialPlan;
    window: WindowPeriod["window"];
    period: WindowPeriod["period"];
    ledger: LedgerBundle;
    classifyCtx: BudgetSpendingContext;
}

interface EvalOutput {
    result: PlanComponentCalcResult;
    warnings: PlanCalcWarning[];
}

function makeBase(
    component: FinancialPlanComponent
): PlanComponentCalcResult {
    return {
        componentId: component.id,
        componentType: component.componentType,
        role: component.role,
        measure: measureOf(component.role),
        sourceName: null,
        isActive: component.isActive,
        available: true,
        unavailableReason: null,
        sourceStatus: null,
        sourceTerminal: false,
        positionValue: null,
        periodFlow: null,
        lifetimeFlow: null,
        componentTarget: component.targetAmount ?? null,
        detail: {},
    };
}

function unavailable(
    base: PlanComponentCalcResult,
    reason: PlanCalcUnavailableReason,
    message: string
): EvalOutput {
    base.available = false;
    base.unavailableReason = reason;
    base.positionValue = null;
    base.periodFlow = null;
    base.lifetimeFlow = null;

    return {
        result: base,
        warnings: [
            {
                code: warningCodeForReason(reason),
                componentId: base.componentId,
                message,
            },
        ],
    };
}

function warningCodeForReason(
    reason: PlanCalcUnavailableReason
): PlanCalcWarningCode {
    if (reason === "SOURCE_DATA_ERROR") {
        return "COMPONENT_DATA_ERROR";
    }
    if (reason === "INCOMPATIBLE_WITH_PLAN_TYPE") {
        return "COMPONENT_NOT_IN_PLAN_MATRIX";
    }
    return "COMPONENT_UNAVAILABLE";
}

function skippedWarning(
    componentId: string,
    count: number
): PlanCalcWarning {
    return {
        code: "SKIPPED_MALFORMED_ROWS",
        componentId,
        message: `${count} row(s) skipped: non-finite amount or unusable date.`,
    };
}

function evaluateComponent(
    component: FinancialPlanComponent,
    ctx: EvalCtx
): EvalOutput {
    try {
        return evaluateComponentInner(component, ctx);
    } catch {
        const base = makeBase(component);
        base.available = false;
        base.unavailableReason = "SOURCE_DATA_ERROR";
        base.positionValue = null;
        base.periodFlow = null;
        base.lifetimeFlow = null;

        return {
            result: base,
            warnings: [
                {
                    code: "COMPONENT_DATA_ERROR",
                    componentId: component.id,
                    message:
                        "This component could not be evaluated.",
                },
            ],
        };
    }
}

function evaluateComponentInner(
    component: FinancialPlanComponent,
    ctx: EvalCtx
): EvalOutput {
    // Phase 4 defence in depth: a component must still be valid for the
    // plan's CURRENT type - its (type, role) combo in the matrix AND a
    // per-component target the type permits. A plan_type change is
    // blocked at the service, so this only catches data that reached the
    // engine another way. Route it through the standard unavailable path
    // so it is neither silently omitted nor silently included.
    if (
        !isPlanComponentComboAllowed(
            ctx.plan.planType,
            component.componentType,
            component.role
        ) ||
        validateComponentTarget(
            ctx.plan.planType,
            component.targetAmount ?? null
        ) !== null
    ) {
        return unavailable(
            makeBase(component),
            "INCOMPATIBLE_WITH_PLAN_TYPE",
            "This component is not valid for the plan's current type."
        );
    }

    switch (component.componentType) {
        case "ACCOUNT":
            return evalAccount(component, ctx);
        case "CATEGORY":
            return evalCategory(component, ctx);
        case "INVESTMENT":
            return evalInvestment(component, ctx);
        case "LOAN":
            return evalLoan(component, ctx);
        default:
            return unavailable(
                makeBase(component),
                "SOURCE_DATA_ERROR",
                "Unknown component type."
            );
    }
}

// ---- ACCOUNT ----

interface AccountRow {
    date: string;
    type: "income" | "expense";
    m: number;
}

function collectAccountRows(
    ledger: LedgerBundle,
    accountId: string
): { rows: AccountRow[]; skipped: number } {
    const rows: AccountRow[] = [];
    let skipped = 0;

    for (const t of ledger.transactions) {
        if (t.accountId !== accountId) {
            continue;
        }
        if (t.deletedAt) {
            continue;
        }
        if (
            t.type !== "income" &&
            t.type !== "expense"
        ) {
            continue; // 'transfer' rows never touch the balance
        }
        if (!isValidDate(t.transactionDate)) {
            skipped += 1;
            continue;
        }
        const m = mag(t.amount, false);
        if (m === MALFORMED) {
            skipped += 1;
            continue;
        }
        rows.push({
            date: t.transactionDate,
            type: t.type,
            m,
        });
    }

    return { rows, skipped };
}

interface TransferRow {
    date: string;
    delta: number; // +in / -out relative to the account
}

function collectTransferRows(
    ledger: LedgerBundle,
    accountId: string
): { rows: TransferRow[]; skipped: number } {
    const rows: TransferRow[] = [];
    let skipped = 0;

    for (const tr of ledger.transfers) {
        const touches =
            tr.sourceAccountId === accountId ||
            tr.destinationAccountId === accountId;
        if (!touches) {
            continue;
        }
        if (tr.deletedAt) {
            continue;
        }
        if (!isValidDate(tr.transactionDate)) {
            skipped += 1;
            continue;
        }
        const m = mag(tr.amount, false);
        if (m === MALFORMED) {
            skipped += 1;
            continue;
        }

        let delta = 0;
        if (tr.destinationAccountId === accountId) {
            delta += m;
        }
        if (tr.sourceAccountId === accountId) {
            delta -= m;
        }
        rows.push({
            date: tr.transactionDate,
            delta,
        });
    }

    return { rows, skipped };
}

function evalAccount(
    component: FinancialPlanComponent,
    ctx: EvalCtx
): EvalOutput {
    const base = makeBase(component);
    const acc = ctx.ledger.accountsById.get(
        component.accountId ?? ""
    );

    if (!acc) {
        return unavailable(
            base,
            "SOURCE_MISSING",
            "The linked account no longer exists."
        );
    }

    base.sourceName = acc.name;

    if (acc.currencyId !== ctx.plan.currencyId) {
        return unavailable(
            base,
            "CURRENCY_MISMATCH",
            "The account's currency no longer matches the plan."
        );
    }

    if (ACCOUNT_EXCLUDED_TYPES.includes(acc.type)) {
        return unavailable(
            base,
            "INVALID_ACCOUNT_TYPE",
            "Investment / loan accounts are not valid account components."
        );
    }

    if (
        component.role === "ASSET" &&
        !ACCOUNT_ASSET_TYPES.includes(acc.type)
    ) {
        return unavailable(
            base,
            "INVALID_ACCOUNT_TYPE",
            "This account's type is no longer valid for an asset component."
        );
    }

    if (
        component.role === "LIABILITY" &&
        !ACCOUNT_LIABILITY_TYPES.includes(acc.type)
    ) {
        return unavailable(
            base,
            "INVALID_ACCOUNT_TYPE",
            "This account's type is no longer valid for a liability component."
        );
    }

    const warnings: PlanCalcWarning[] = [];
    const txn = collectAccountRows(
        ctx.ledger,
        component.accountId ?? ""
    );

    if (
        component.role === "ASSET" ||
        component.role === "LIABILITY"
    ) {
        // Transfers only affect a point-in-time balance, never the
        // income/expense-only ACCOUNT·CONTRIBUTION cash flow.
        const trn = collectTransferRows(
            ctx.ledger,
            component.accountId ?? ""
        );
        const skipped =
            txn.skipped + trn.skipped;

        const opening = readMoney(
            acc.openingBalance,
            false
        );

        if (opening === MALFORMED) {
            return unavailable(
                base,
                "SOURCE_DATA_ERROR",
                "The account's opening balance is not a valid number."
            );
        }

        let balance = opening;
        for (const row of txn.rows) {
            balance +=
                row.type === "income"
                    ? row.m
                    : -row.m;
        }
        for (const row of trn.rows) {
            balance += row.delta;
        }

        if (!Number.isFinite(balance)) {
            return unavailable(
                base,
                "SOURCE_DATA_ERROR",
                "The account balance could not be computed."
            );
        }

        if (skipped > 0) {
            warnings.push(
                skippedWarning(component.id, skipped)
            );
        }

        base.detail.rawBalance = round2(balance);
        base.positionValue = round2(
            component.role === "ASSET"
                ? balance
                : -balance
        );

        return { result: base, warnings };
    }

    // ACCOUNT·CONTRIBUTION - raw cash movement, transfers NOT consulted.
    const grossOver = (
        start: string,
        end: string
    ) => {
        let gin = 0;
        let gout = 0;
        for (const row of txn.rows) {
            if (!inWindow(row.date, start, end)) {
                continue;
            }
            if (row.type === "income") {
                gin += row.m;
            } else {
                gout += row.m;
            }
        }
        return { gin, gout };
    };

    const p = grossOver(
        ctx.period.start,
        ctx.period.end
    );
    const w = grossOver(
        ctx.window.start,
        ctx.window.end
    );

    if (txn.skipped > 0) {
        warnings.push(
            skippedWarning(
                component.id,
                txn.skipped
            )
        );
    }

    base.detail.grossInflow = round2(p.gin);
    base.detail.grossOutflow = round2(p.gout);
    base.detail.lifetimeGrossInflow = round2(w.gin);
    base.detail.lifetimeGrossOutflow = round2(w.gout);
    base.periodFlow = round2(p.gin - p.gout);
    base.lifetimeFlow = round2(w.gin - w.gout);

    return { result: base, warnings };
}

// ---- CATEGORY ----

function evalCategory(
    component: FinancialPlanComponent,
    ctx: EvalCtx
): EvalOutput {
    const base = makeBase(component);
    const cat = ctx.ledger.categoriesById.get(
        component.categoryId ?? ""
    );

    if (!cat) {
        return unavailable(
            base,
            "SOURCE_MISSING",
            "The linked category no longer exists."
        );
    }

    base.sourceName = cat.name;

    const expectedRole = deriveCategoryRole(
        cat.categoryType
    );

    if (
        expectedRole === null ||
        expectedRole !== component.role
    ) {
        return unavailable(
            base,
            "INVALID_CATEGORY_TYPE",
            "The category's type no longer matches this component's role."
        );
    }

    const warnings: PlanCalcWarning[] = [];
    let skipped = 0;
    let crossCurrency = 0;

    const rows: Array<{
        date: string;
        amount: number;
    }> = [];

    for (const t of ctx.ledger.transactions) {
        if (t.categoryId !== component.categoryId) {
            continue; // exact id, no parent rollup
        }
        if (t.deletedAt) {
            continue;
        }

        const acc = t.accountId
            ? ctx.ledger.accountsById.get(t.accountId)
            : undefined;

        if (!acc) {
            skipped += 1;
            continue; // cannot verify currency
        }
        if (acc.currencyId !== ctx.plan.currencyId) {
            crossCurrency += 1;
            continue; // excluded, never converted
        }
        if (!isValidDate(t.transactionDate)) {
            skipped += 1;
            continue;
        }

        if (component.role === "CONTRIBUTION") {
            if (t.type !== "income") {
                continue;
            }
            const m = mag(t.amount, false);
            if (m === MALFORMED) {
                skipped += 1;
                continue;
            }
            rows.push({
                date: t.transactionDate,
                amount: m,
            });
        } else {
            // SPENDING - reuse the Budget classifier verbatim.
            if (
                !Number.isFinite(Number(t.amount))
            ) {
                skipped += 1;
                continue;
            }
            const classification =
                classifyBudgetTransaction(
                    t,
                    ctx.classifyCtx
                );
            if (!classification.include) {
                continue;
            }
            rows.push({
                date: t.transactionDate,
                amount: classification.amount,
            });
        }
    }

    if (crossCurrency > 0) {
        warnings.push({
            code: "CROSS_CURRENCY_ROWS_EXCLUDED",
            componentId: component.id,
            message: `${crossCurrency} transaction(s) in another currency were excluded (no conversion).`,
        });
    }
    if (skipped > 0) {
        warnings.push(
            skippedWarning(component.id, skipped)
        );
    }

    base.periodFlow = round2(
        sum(
            rows
                .filter(r =>
                    inWindow(
                        r.date,
                        ctx.period.start,
                        ctx.period.end
                    )
                )
                .map(r => r.amount)
        )
    );
    base.lifetimeFlow = round2(
        sum(
            rows
                .filter(r =>
                    inWindow(
                        r.date,
                        ctx.window.start,
                        ctx.window.end
                    )
                )
                .map(r => r.amount)
        )
    );

    return { result: base, warnings };
}

// ---- INVESTMENT ----

const KNOWN_INVESTMENT_TYPES = new Set([
    "BUY",
    "SELL",
    "DIVIDEND",
    "INTEREST",
    "BONUS",
    "SPLIT",
    "OPENING_BALANCE",
    "OTHER",
]);

function markTerminal(
    base: PlanComponentCalcResult,
    status: string,
    warnings: PlanCalcWarning[]
): void {
    base.sourceStatus = status;

    if (status !== "ACTIVE") {
        base.sourceTerminal = true;
        warnings.push({
            code: "CONTAINS_CLOSED_SOURCE",
            componentId: base.componentId,
            message: `The linked source is ${status}; its stored value was used.`,
        });
    }
}

function evalInvestment(
    component: FinancialPlanComponent,
    ctx: EvalCtx
): EvalOutput {
    const base = makeBase(component);
    const inv = ctx.ledger.investmentsById.get(
        component.investmentId ?? ""
    );

    if (!inv) {
        return unavailable(
            base,
            "SOURCE_MISSING",
            "The linked investment no longer exists."
        );
    }

    base.sourceName = inv.name;

    if (inv.currencyId !== ctx.plan.currencyId) {
        return unavailable(
            base,
            "CURRENCY_MISMATCH",
            "The investment's currency no longer matches the plan."
        );
    }

    const warnings: PlanCalcWarning[] = [];
    markTerminal(base, inv.status, warnings);

    if (component.role === "ASSET") {
        const value = readMoney(
            inv.currentValue,
            false
        );
        if (value === MALFORMED) {
            return unavailable(
                base,
                "SOURCE_DATA_ERROR",
                "The investment's current value is not a valid number."
            );
        }
        base.positionValue = round2(value);
        return { result: base, warnings };
    }

    // INVESTMENT·CONTRIBUTION - net invested (BUY out - SELL in).
    const txns =
        ctx.ledger.investmentTransactionsByInvestmentId.get(
            component.investmentId ?? ""
        ) ?? [];

    let skipped = 0;
    let hasSplit = false;

    const rows: Array<{
        date: string;
        value: number;
    }> = [];

    for (const r of txns) {
        const type = String(r.transactionType);

        if (type === "SPLIT") {
            hasSplit = true;
            continue;
        }
        if (!KNOWN_INVESTMENT_TYPES.has(type)) {
            skipped += 1;
            continue;
        }
        if (type !== "BUY" && type !== "SELL") {
            continue; // DIVIDEND / INTEREST / BONUS / OPENING_BALANCE / OTHER
        }
        if (!isValidDate(r.transactionDate)) {
            skipped += 1;
            continue;
        }

        const amount = mag(r.amount, false);
        const fees = mag(r.fees, true);
        const taxes = mag(r.taxes, true);

        if (
            amount === MALFORMED ||
            fees === MALFORMED ||
            taxes === MALFORMED
        ) {
            skipped += 1;
            continue;
        }

        const cash =
            type === "BUY"
                ? amount + fees + taxes
                : amount - fees - taxes;

        rows.push({
            date: r.transactionDate,
            value: type === "BUY" ? cash : -cash,
        });
    }

    if (hasSplit) {
        warnings.push({
            code: "INVESTMENT_SPLIT_IGNORED",
            componentId: component.id,
            message:
                "SPLIT transactions were ignored (no split ratio in the data model).",
        });
    }
    if (skipped > 0) {
        warnings.push(
            skippedWarning(component.id, skipped)
        );
    }

    base.periodFlow = round2(
        sum(
            rows
                .filter(r =>
                    inWindow(
                        r.date,
                        ctx.period.start,
                        ctx.period.end
                    )
                )
                .map(r => r.value)
        )
    );
    base.lifetimeFlow = round2(
        sum(
            rows
                .filter(r =>
                    inWindow(
                        r.date,
                        ctx.window.start,
                        ctx.window.end
                    )
                )
                .map(r => r.value)
        )
    );

    return { result: base, warnings };
}

// ---- LOAN ----

function evalLoan(
    component: FinancialPlanComponent,
    ctx: EvalCtx
): EvalOutput {
    const base = makeBase(component);
    const loan = ctx.ledger.loansById.get(
        component.loanId ?? ""
    );

    if (!loan) {
        return unavailable(
            base,
            "SOURCE_MISSING",
            "The linked loan no longer exists."
        );
    }

    base.sourceName = loan.name;

    if (loan.currencyId !== ctx.plan.currencyId) {
        return unavailable(
            base,
            "CURRENCY_MISMATCH",
            "The loan's currency no longer matches the plan."
        );
    }

    const warnings: PlanCalcWarning[] = [];
    markTerminal(base, loan.status, warnings);

    if (component.role === "LIABILITY") {
        const principal = readMoney(
            loan.outstandingPrincipal,
            false
        );
        if (principal === MALFORMED) {
            return unavailable(
                base,
                "SOURCE_DATA_ERROR",
                "The loan's outstanding principal is not a valid number."
            );
        }

        base.positionValue = round2(principal);
        base.detail.outstandingPrincipal =
            round2(principal);

        const interest = readMoney(
            loan.outstandingInterest,
            true
        );
        if (interest !== MALFORMED) {
            base.detail.outstandingInterest =
                round2(interest);
        }

        return { result: base, warnings };
    }

    // LOAN·CONTRIBUTION - principal repaid on PAID schedule rows.
    const schedule =
        ctx.ledger.loanScheduleByLoanId.get(
            component.loanId ?? ""
        ) ?? [];

    let skipped = 0;
    let hasPartial = false;

    const rows: Array<{
        date: string;
        value: number;
    }> = [];

    for (const s of schedule) {
        const status = String(s.status);

        if (status === "PARTIAL") {
            hasPartial = true;
            continue;
        }
        if (status !== "PAID") {
            continue; // UPCOMING / OVERDUE
        }
        if (!isValidDate(s.paidDate)) {
            skipped += 1;
            continue;
        }

        const principal = readMoney(
            s.principalAmount,
            true // NOT NULL DEFAULT 0 -> a missing value is a real 0
        );
        if (principal === MALFORMED) {
            skipped += 1;
            continue;
        }

        rows.push({
            date: s.paidDate as string,
            value: Math.abs(principal),
        });
    }

    if (hasPartial) {
        warnings.push({
            code: "PARTIAL_LOAN_PAYMENTS_IGNORED",
            componentId: component.id,
            message:
                "PARTIAL instalments were excluded from principal repaid.",
        });
    }
    if (skipped > 0) {
        warnings.push(
            skippedWarning(component.id, skipped)
        );
    }

    base.periodFlow = round2(
        sum(
            rows
                .filter(r =>
                    inWindow(
                        r.date,
                        ctx.period.start,
                        ctx.period.end
                    )
                )
                .map(r => r.value)
        )
    );
    base.lifetimeFlow = round2(
        sum(
            rows
                .filter(r =>
                    inWindow(
                        r.date,
                        ctx.window.start,
                        ctx.window.end
                    )
                )
                .map(r => r.value)
        )
    );

    base.detail.principalRepaidInPeriod =
        base.periodFlow;
    base.detail.principalRepaidLifetime =
        base.lifetimeFlow;

    return { result: base, warnings };
}

// -------------------- plan aggregation --------------------

function aggregate(
    plan: FinancialPlan,
    results: readonly PlanComponentCalcResult[],
    warnings: PlanCalcWarning[]
): PlanCalcTotals {
    const active = results.filter(
        r => r.isActive && r.available
    );

    const byRole = (role: PlanComponentRole) =>
        active.filter(r => r.role === role);

    const assets = byRole("ASSET");
    const liabilities = byRole("LIABILITY");
    const contributions = byRole("CONTRIBUTION");
    const spending = byRole("SPENDING");

    const totals: PlanCalcTotals = {
        planTarget: plan.targetAmount ?? null,
        isPerPeriodTarget: isPerPeriodTarget(
            plan.planType
        ),
        positionValue: null,
        currentPeriodInflow: null,
        currentPeriodOutflow: null,
        currentPeriodNet: null,
        lifetimeInflow: null,
        lifetimeOutflow: null,
        lifetimeNet: null,
        activeComponentCount: results.filter(
            r => r.isActive
        ).length,
        unavailableComponentCount: results.filter(
            r => !r.available
        ).length,
    };

    const assetSum = round2(
        sum(assets.map(r => r.positionValue ?? 0))
    );
    const liabilitySum = round2(
        sum(
            liabilities.map(r => r.positionValue ?? 0)
        )
    );

    const contribPeriod = round2(
        sum(contributions.map(r => r.periodFlow ?? 0))
    );
    const contribLifetime = round2(
        sum(
            contributions.map(r => r.lifetimeFlow ?? 0)
        )
    );
    const spendPeriod = round2(
        sum(spending.map(r => r.periodFlow ?? 0))
    );
    const spendLifetime = round2(
        sum(spending.map(r => r.lifetimeFlow ?? 0))
    );

    switch (plan.planType) {
        case "ACCUMULATION":
        case "PORTFOLIO_GROWTH":
            if (assets.length > 0) {
                totals.positionValue = assetSum;
            }
            if (contributions.length > 0) {
                totals.currentPeriodInflow =
                    contribPeriod;
                totals.lifetimeInflow =
                    contribLifetime;
            }
            break;

        case "DEBT_PAYOFF":
            if (liabilities.length > 0) {
                totals.positionValue = liabilitySum;
            }
            if (contributions.length > 0) {
                totals.currentPeriodOutflow =
                    contribPeriod;
                totals.lifetimeOutflow =
                    contribLifetime;
            }
            break;

        case "EXPENSE_PLAN":
            if (assets.length > 0) {
                totals.positionValue = assetSum;
            }
            if (spending.length > 0) {
                totals.currentPeriodOutflow =
                    spendPeriod;
                totals.lifetimeOutflow =
                    spendLifetime;
            }
            break;

        case "CASHFLOW_TARGET": {
            const accountComps = active.filter(
                r => r.componentType === "ACCOUNT"
            );
            const categoryComps = active.filter(
                r => r.componentType === "CATEGORY"
            );

            if (
                accountComps.length > 0 &&
                categoryComps.length > 0
            ) {
                warnings.push({
                    code: "MIXED_CASHFLOW_MODE",
                    componentId: null,
                    message:
                        "This cash-flow plan has both account and category components; account mode was used.",
                });
            }

            if (accountComps.length > 0) {
                totals.currentPeriodInflow = round2(
                    sum(
                        accountComps.map(
                            r =>
                                r.detail
                                    .grossInflow ?? 0
                        )
                    )
                );
                totals.currentPeriodOutflow = round2(
                    sum(
                        accountComps.map(
                            r =>
                                r.detail
                                    .grossOutflow ?? 0
                        )
                    )
                );
                totals.lifetimeInflow = round2(
                    sum(
                        accountComps.map(
                            r =>
                                r.detail
                                    .lifetimeGrossInflow ??
                                0
                        )
                    )
                );
                totals.lifetimeOutflow = round2(
                    sum(
                        accountComps.map(
                            r =>
                                r.detail
                                    .lifetimeGrossOutflow ??
                                0
                        )
                    )
                );
            } else if (categoryComps.length > 0) {
                const cIn = categoryComps.filter(
                    r => r.role === "CONTRIBUTION"
                );
                const cOut = categoryComps.filter(
                    r => r.role === "SPENDING"
                );
                totals.currentPeriodInflow = round2(
                    sum(
                        cIn.map(
                            r => r.periodFlow ?? 0
                        )
                    )
                );
                totals.currentPeriodOutflow = round2(
                    sum(
                        cOut.map(
                            r => r.periodFlow ?? 0
                        )
                    )
                );
                totals.lifetimeInflow = round2(
                    sum(
                        cIn.map(
                            r => r.lifetimeFlow ?? 0
                        )
                    )
                );
                totals.lifetimeOutflow = round2(
                    sum(
                        cOut.map(
                            r => r.lifetimeFlow ?? 0
                        )
                    )
                );
            }

            if (
                totals.currentPeriodInflow !== null ||
                totals.currentPeriodOutflow !== null
            ) {
                totals.currentPeriodNet = round2(
                    (totals.currentPeriodInflow ??
                        0) -
                        (totals.currentPeriodOutflow ??
                            0)
                );
                totals.lifetimeNet = round2(
                    (totals.lifetimeInflow ?? 0) -
                        (totals.lifetimeOutflow ?? 0)
                );
            }
            break;
        }

        default:
            break;
    }

    return totals;
}

// -------------------- public entry points --------------------

export function calculatePlanActuals(
    input: CalculatePlanActualsInput
): PlanCalcResult {
    const { plan, components, asOf, ledger } = input;

    const { window, period } =
        resolveWindowAndPeriod(plan, asOf);

    const classifyCtx: BudgetSpendingContext = {
        emiInterestByTransactionId:
            ledger.emiInterestByTransactionId,
        creditCardAccountIds:
            ledger.creditCardAccountIds,
    };

    const ctx: EvalCtx = {
        plan,
        window,
        period,
        ledger,
        classifyCtx,
    };

    const warnings: PlanCalcWarning[] = [];

    if (components.length === 0) {
        warnings.push({
            code: "NO_COMPONENTS",
            componentId: null,
            message: "This plan has no components.",
        });
    }

    if (asOf < plan.startDate) {
        warnings.push({
            code: "PLAN_NOT_STARTED",
            componentId: null,
            message: `This plan starts on ${plan.startDate}.`,
        });
    }

    if (
        !window.openEnded &&
        plan.endDate &&
        asOf > plan.endDate
    ) {
        warnings.push({
            code: "PLAN_ENDED",
            componentId: null,
            message: `This plan ended on ${plan.endDate}; positions are shown as of ${asOf}, activity through ${plan.endDate}.`,
        });
    }

    const results: PlanComponentCalcResult[] = [];

    for (const component of components) {
        const out = evaluateComponent(component, ctx);
        results.push(out.result);
        warnings.push(...out.warnings);

        if (!out.result.isActive) {
            warnings.push({
                code: "COMPONENT_INACTIVE_EXCLUDED",
                componentId: component.id,
                message:
                    "This component is inactive and is excluded from the plan totals.",
            });
        }
    }

    const totals = aggregate(
        plan,
        results,
        warnings
    );

    const status: PlanCalcStatus = results.some(
        r => r.isActive && !r.available
    )
        ? "INCOMPLETE"
        : "COMPLETE";

    return {
        planId: plan.id,
        planType: plan.planType,
        periodType: plan.periodType,
        currencyId: plan.currencyId,
        asOf,
        window,
        currentPeriod: period,
        status,
        warnings,
        components: results,
        totals,
    };
}

export function calculateManyPlanActuals(
    plans: readonly FinancialPlan[],
    componentsByPlanId: ReadonlyMap<
        string,
        readonly FinancialPlanComponent[]
    >,
    asOf: string,
    ledger: LedgerBundle
): PlanCalcResult[] {
    return plans.map(plan =>
        calculatePlanActuals({
            plan,
            components:
                componentsByPlanId.get(plan.id) ?? [],
            asOf,
            ledger,
        })
    );
}

/** Every warning code the engine can emit - for test coverage checks. */
export const PLAN_CALC_WARNING_CODES: readonly PlanCalcWarningCode[] =
    [
        "NO_COMPONENTS",
        "PLAN_NOT_STARTED",
        "PLAN_ENDED",
        "COMPONENT_UNAVAILABLE",
        "COMPONENT_DATA_ERROR",
        "COMPONENT_INACTIVE_EXCLUDED",
        "CONTAINS_CLOSED_SOURCE",
        "SKIPPED_MALFORMED_ROWS",
        "PARTIAL_LOAN_PAYMENTS_IGNORED",
        "INVESTMENT_SPLIT_IGNORED",
        "CROSS_CURRENCY_ROWS_EXCLUDED",
        "MIXED_CASHFLOW_MODE",
        "COMPONENT_NOT_IN_PLAN_MATRIX",
    ];

export const PLAN_CALC_UNAVAILABLE_REASONS: readonly PlanCalcUnavailableReason[] =
    [
        "SOURCE_MISSING",
        "CURRENCY_MISMATCH",
        "INVALID_ACCOUNT_TYPE",
        "INVALID_CATEGORY_TYPE",
        "SOURCE_DATA_ERROR",
        "INCOMPATIBLE_WITH_PLAN_TYPE",
    ];
