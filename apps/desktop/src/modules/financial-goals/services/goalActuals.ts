import type { GoalAccountLink } from "../types/GoalAccountLink";
import type { GoalCategoryLink } from "../types/GoalCategoryLink";
import type { GoalLoanLink } from "../types/GoalLoanLink";
import type { GoalInvestmentLink } from "../types/GoalInvestmentLink";
import type { FinancialGoal } from "../types/FinancialGoal";

import {
    isGoalEligibleAccountType,
    roleForGoalMode,
    type GoalAccountRole,
} from "../constants/goalAccountLinking";
import { isGoalEligibleCategoryType } from "../constants/goalCategoryLinking";
import { isGoalEligibleLoanStatus } from "../constants/goalLoanLinking";
import { isGoalEligibleInvestmentStatus } from "../constants/goalInvestmentLinking";

import { toISODateString } from "@/core/formatting";

// ---------------------------------------------------------------------
// Financial Goals - Automatic Phase 1 (savings, ASSET) + Phase 2 (debt
// payoff, LIABILITY) + Phase 3 (category-linked income contributions)
// + Phase 4 (loan payoff) + Phase 5 (investment-linked savings, see
// calculateInvestmentGoalActuals further down)
//
// Pure engine: no I/O. Given a goal, its active account links, and a
// pre-fetched ledger bundle, computes the goal's current amount,
// progress and remaining amount from live account balances.
//
// Mirrors the ACCOUNT/ASSET and ACCOUNT/LIABILITY (STOCK) calculations
// already proven in financial-plans/services/planActuals.ts (opening
// balance + income - expense transactions + transfer deltas, then
// negated for LIABILITY - verified against planActuals.test.ts's
// DEBT_PAYOFF case: a credit-card account with opening balance 0, a
// 15,000 expense and a 5,000 income has raw balance -10,000, and
// positionValue = -balance = 10,000 owed), scoped down to just ACCOUNT
// sources - Phase 1/2 have no other source types, and no windows /
// periods, so the full plan-component matrix machinery does not apply
// here. Nothing is persisted; every call recomputes from scratch, same
// as Financial Plans' pull-based model (see PlanActualsService.ts).
//
// A goal is either fully ASSET-linked (savings) or fully
// LIABILITY-linked (debt payoff) - never mixed - so the role is derived
// once from the goal's own goalMode (roleForGoalMode), not stored per
// link.
// ---------------------------------------------------------------------

export type GoalAccountUnavailableReason =
    | "SOURCE_MISSING"
    | "SOURCE_INACTIVE"
    | "CURRENCY_MISMATCH"
    | "INVALID_ACCOUNT_TYPE";

export interface GoalAccountLinkCalcResult {
    linkId: string;
    accountId: string;
    accountName: string | null;
    available: boolean;
    unavailableReason: GoalAccountUnavailableReason | null;
    /** null when unavailable. */
    balance: number | null;
}

export interface GoalCalcTotals {
    /** ASSET: amount saved. LIABILITY: amount paid off. */
    currentAmount: number;
    /** ASSET: target - current. LIABILITY: remaining debt (max(0, outstandingDebt)). */
    remainingAmount: number;
    /** 0-100, clamped. */
    progressPercentage: number;
    isComplete: boolean;
    /**
     * LIABILITY (DEBT_PAYOFF_LINKED) goals only: the raw sum of linked
     * liability balances - may be negative if the linked accounts are
     * net in credit. Omitted for ASSET goals.
     */
    outstandingDebt?: number;
}

export interface GoalCalcResult {
    goalId: string;
    currencyId: string;
    links: GoalAccountLinkCalcResult[];
    totals: GoalCalcTotals;
    /** One human-readable message per unavailable link. */
    warnings: string[];
}

// -------------------- ledger (injected) --------------------

export interface GoalLedgerAccount {
    name: string;
    currencyId: string;
    type: string;
    isActive: boolean;
    openingBalance: number;
}

export interface GoalLedgerTransaction {
    accountId: string;
    type: "income" | "expense" | "transfer";
    amount: number;
    transactionDate: string;
    /** Phase 3 only. Optional so Phase 1/2 ledger fixtures need not set it. */
    categoryId?: string | null;
}

export interface GoalLedgerTransfer {
    sourceAccountId: string;
    destinationAccountId: string;
    amount: number;
    transactionDate: string;
    deletedAt: string | null;
}

export interface GoalLedgerCategory {
    name: string;
    categoryType: string;
    isActive: boolean;
}

export interface GoalLedgerLoan {
    name: string;
    currencyId: string;
    status: string;
    outstandingPrincipal: number;
}

export interface GoalLedgerInvestment {
    name: string;
    currencyId: string;
    status: string;
    currentValue: number;
}

export interface GoalLedgerBundle {
    accountsById: ReadonlyMap<string, GoalLedgerAccount>;
    transactions: readonly GoalLedgerTransaction[];
    transfers: readonly GoalLedgerTransfer[];
    /** Phase 3 only. Optional so Phase 1/2 ledger fixtures need not set it. */
    categoriesById?: ReadonlyMap<string, GoalLedgerCategory>;
    /** Phase 4 only. Optional so Phase 1-3 ledger fixtures need not set it. */
    loansById?: ReadonlyMap<string, GoalLedgerLoan>;
    /** Phase 5 only. Optional so Phase 1-4 ledger fixtures need not set it. */
    investmentsById?: ReadonlyMap<
        string,
        GoalLedgerInvestment
    >;
}

// -------------------- helpers --------------------

function round2(n: number): number {
    return (
        Math.round((n + Number.EPSILON) * 100) / 100
    );
}

function sum(values: readonly number[]): number {
    return values.reduce((a, b) => a + b, 0);
}

function isValidDate(value: unknown): value is string {
    return (
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        !Number.isNaN(Date.parse(value))
    );
}

/** Inclusive on both ends. All three are YYYY-MM-DD strings, so plain string comparison is safe. */
function inWindow(
    date: string,
    start: string,
    end: string
): boolean {
    return date >= start && date <= end;
}

const UNAVAILABLE_MESSAGES: Record<
    GoalAccountUnavailableReason,
    string
> = {
    SOURCE_MISSING:
        "The linked account no longer exists.",
    SOURCE_INACTIVE:
        "The linked account is no longer active.",
    CURRENCY_MISMATCH:
        "The linked account's currency no longer matches this goal.",
    INVALID_ACCOUNT_TYPE:
        "This account's type is no longer valid for this goal.",
};

function unavailableLink(
    link: GoalAccountLink,
    accountName: string | null,
    reason: GoalAccountUnavailableReason
): GoalAccountLinkCalcResult {
    return {
        linkId: link.id,
        accountId: link.accountId,
        accountName,
        available: false,
        unavailableReason: reason,
        balance: null,
    };
}

/** Live balance of one account: opening balance + transactions + transfers. */
function computeAccountBalance(
    accountId: string,
    account: GoalLedgerAccount,
    ledger: GoalLedgerBundle
): number {
    let balance = Number.isFinite(
        account.openingBalance
    )
        ? account.openingBalance
        : 0;

    for (const t of ledger.transactions) {
        if (t.accountId !== accountId) {
            continue;
        }
        if (t.type !== "income" && t.type !== "expense") {
            continue; // transfer rows never touch the balance here
        }
        if (!isValidDate(t.transactionDate)) {
            continue;
        }
        const amount = Number(t.amount);
        if (!Number.isFinite(amount)) {
            continue;
        }
        balance +=
            t.type === "income" ? amount : -amount;
    }

    for (const tr of ledger.transfers) {
        if (tr.deletedAt) {
            continue;
        }
        const touches =
            tr.sourceAccountId === accountId ||
            tr.destinationAccountId === accountId;
        if (!touches) {
            continue;
        }
        if (!isValidDate(tr.transactionDate)) {
            continue;
        }
        const amount = Number(tr.amount);
        if (!Number.isFinite(amount)) {
            continue;
        }
        if (tr.destinationAccountId === accountId) {
            balance += amount;
        }
        if (tr.sourceAccountId === accountId) {
            balance -= amount;
        }
    }

    return round2(balance);
}

function evaluateLink(
    link: GoalAccountLink,
    goalCurrencyId: string,
    role: GoalAccountRole,
    ledger: GoalLedgerBundle
): GoalAccountLinkCalcResult {
    const account = ledger.accountsById.get(
        link.accountId
    );

    if (!account) {
        return unavailableLink(
            link,
            null,
            "SOURCE_MISSING"
        );
    }

    if (!account.isActive) {
        return unavailableLink(
            link,
            account.name,
            "SOURCE_INACTIVE"
        );
    }

    if (account.currencyId !== goalCurrencyId) {
        return unavailableLink(
            link,
            account.name,
            "CURRENCY_MISMATCH"
        );
    }

    if (!isGoalEligibleAccountType(account.type, role)) {
        return unavailableLink(
            link,
            account.name,
            "INVALID_ACCOUNT_TYPE"
        );
    }

    const rawBalance = computeAccountBalance(
        link.accountId,
        account,
        ledger
    );

    // Mirrors planActuals.ts's evalAccount: positionValue = ASSET ?
    // balance : -balance. For a LIABILITY (e.g. credit card), a
    // purchase (expense) drives the raw balance further negative;
    // negating it turns that into a positive "amount owed".
    const balance =
        role === "LIABILITY"
            ? round2(-rawBalance)
            : rawBalance;

    return {
        linkId: link.id,
        accountId: link.accountId,
        accountName: account.name,
        available: true,
        unavailableReason: null,
        balance,
    };
}

/**
 * Computes one linked goal's current amount / progress / remaining
 * amount from its active links and the live ledger. Manual goals
 * should not be passed here - the caller decides which goals are
 * ACCOUNT_LINKED / DEBT_PAYOFF_LINKED (see GoalActualsService).
 */
export function calculateGoalActuals(
    goal: Pick<
        FinancialGoal,
        | "id"
        | "currencyId"
        | "targetAmount"
        | "goalMode"
    >,
    links: readonly GoalAccountLink[],
    ledger: GoalLedgerBundle
): GoalCalcResult {
    // Defensive default: calculateGoalActuals is only ever called by
    // GoalActualsService for goals it has already confirmed are
    // linked, so this should always resolve to a real role.
    const role: GoalAccountRole =
        roleForGoalMode(goal.goalMode) ?? "ASSET";

    const activeLinks = links.filter(
        link => link.isActive
    );

    const evaluated = activeLinks.map(link =>
        evaluateLink(
            link,
            goal.currencyId,
            role,
            ledger
        )
    );

    const balanceSum = round2(
        sum(
            evaluated
                .filter(link => link.available)
                .map(link => link.balance ?? 0)
        )
    );

    const warnings = evaluated
        .filter(link => !link.available)
        .map(
            link =>
                `${link.accountName ?? "An account"}: ${UNAVAILABLE_MESSAGES[link.unavailableReason as GoalAccountUnavailableReason]}`
        );

    if (role === "LIABILITY") {
        // outstandingDebt = current balance of linked liability
        // accounts. amountPaidOff = max(0, targetAmount -
        // outstandingDebt). progress = amountPaidOff / targetAmount,
        // clamped - progress rises as debt falls. remainingDebt =
        // max(0, outstandingDebt), independent of target (so debt
        // beyond the original target still shows in full, rather than
        // being capped at target).
        const outstandingDebt = balanceSum;

        const amountPaidOff = Math.max(
            0,
            round2(
                goal.targetAmount - outstandingDebt
            )
        );

        const progressPercentage =
            goal.targetAmount > 0
                ? Math.min(
                      100,
                      Math.max(
                          0,
                          (amountPaidOff /
                              goal.targetAmount) *
                              100
                      )
                  )
                : 0;

        const remainingDebt = Math.max(
            0,
            round2(outstandingDebt)
        );

        return {
            goalId: goal.id,
            currencyId: goal.currencyId,
            links: evaluated,
            totals: {
                currentAmount: amountPaidOff,
                remainingAmount: remainingDebt,
                progressPercentage,
                isComplete:
                    goal.targetAmount > 0 &&
                    amountPaidOff >=
                        goal.targetAmount,
                outstandingDebt,
            },
            warnings,
        };
    }

    const currentAmount = balanceSum;

    const remainingAmount = Math.max(
        0,
        round2(goal.targetAmount - currentAmount)
    );

    const progressPercentage =
        goal.targetAmount > 0
            ? Math.min(
                  100,
                  Math.max(
                      0,
                      (currentAmount /
                          goal.targetAmount) *
                          100
                  )
              )
            : 0;

    return {
        goalId: goal.id,
        currencyId: goal.currencyId,
        links: evaluated,
        totals: {
            currentAmount,
            remainingAmount,
            progressPercentage,
            isComplete:
                goal.targetAmount > 0 &&
                currentAmount >= goal.targetAmount,
        },
        warnings,
    };
}

// =====================================================================
// Phase 3 - CATEGORY_CONTRIBUTION_LINKED goals
//
// A separate, parallel calculation path - not a third branch of
// evaluateLink/calculateGoalActuals above - because the input shape is
// genuinely different (category links, not account links) and, unlike
// ACCOUNT_LINKED/DEBT_PAYOFF_LINKED, a category has no currency of its
// own: currency safety must be checked per matching TRANSACTION (via
// that transaction's account), not once per link. This keeps
// calculateGoalActuals and its Phase 1/2 behavior completely untouched.
//
// Mirrors financial-plans/services/planActuals.ts's evalCategory
// (CATEGORY + CONTRIBUTION role) exactly:
//  - exact categoryId match only, no parent/child rollup
//  - only `type === "income"` transactions count, using the absolute
//    value of the amount (so a contribution total can never be
//    negative - there is no clamp to write for that case)
//  - transfers are never consulted (they either live in the separate
//    `transfers` table, untouched here, or carry type "transfer",
//    excluded by the type check above)
//  - a transaction whose account currency differs from the goal's
//    currency is excluded, never converted, and counted toward one
//    aggregate warning (mirrors evalCategory's `crossCurrency` counter)
//
// Date window (approved Phase 3 design, no new column): from the
// goal's own createdAt through targetDate, or through "today" when no
// targetDate is set. asOf is injected by the caller (defaults to today)
// so this stays deterministic and testable, exactly like
// calculateManyPlanActuals(asOf) in Financial Plans.
// =====================================================================

export type GoalCategoryUnavailableReason =
    | "SOURCE_MISSING"
    | "SOURCE_INACTIVE"
    | "INVALID_CATEGORY_TYPE";

export interface GoalCategoryLinkCalcResult {
    linkId: string;
    categoryId: string;
    categoryName: string | null;
    available: boolean;
    unavailableReason: GoalCategoryUnavailableReason | null;
    /** Sum of matching income transactions, within the contribution window. null when unavailable. */
    contributedAmount: number | null;
}

const CATEGORY_UNAVAILABLE_MESSAGES: Record<
    GoalCategoryUnavailableReason,
    string
> = {
    SOURCE_MISSING:
        "The linked category no longer exists.",
    SOURCE_INACTIVE:
        "The linked category is no longer active.",
    INVALID_CATEGORY_TYPE:
        "This category's type is no longer valid for this goal.",
};

function unavailableCategoryLink(
    link: GoalCategoryLink,
    categoryName: string | null,
    reason: GoalCategoryUnavailableReason
): GoalCategoryLinkCalcResult {
    return {
        linkId: link.id,
        categoryId: link.categoryId,
        categoryName,
        available: false,
        unavailableReason: reason,
        contributedAmount: null,
    };
}

function evaluateCategoryLink(
    link: GoalCategoryLink,
    windowStart: string,
    windowEnd: string,
    goalCurrencyId: string,
    ledger: GoalLedgerBundle
): {
    result: GoalCategoryLinkCalcResult;
    crossCurrencySkipped: number;
} {
    const category = ledger.categoriesById?.get(
        link.categoryId
    );

    if (!category) {
        return {
            result: unavailableCategoryLink(
                link,
                null,
                "SOURCE_MISSING"
            ),
            crossCurrencySkipped: 0,
        };
    }

    if (!category.isActive) {
        return {
            result: unavailableCategoryLink(
                link,
                category.name,
                "SOURCE_INACTIVE"
            ),
            crossCurrencySkipped: 0,
        };
    }

    if (
        !isGoalEligibleCategoryType(
            category.categoryType
        )
    ) {
        return {
            result: unavailableCategoryLink(
                link,
                category.name,
                "INVALID_CATEGORY_TYPE"
            ),
            crossCurrencySkipped: 0,
        };
    }

    let total = 0;
    let crossCurrencySkipped = 0;

    for (const t of ledger.transactions) {
        if (t.categoryId !== link.categoryId) {
            continue; // exact id, no parent/child rollup
        }
        if (t.type !== "income") {
            continue; // transfers and expenses never contribute
        }
        if (!isValidDate(t.transactionDate)) {
            continue;
        }
        if (
            !inWindow(
                t.transactionDate,
                windowStart,
                windowEnd
            )
        ) {
            continue;
        }

        const account = ledger.accountsById.get(
            t.accountId
        );
        if (!account) {
            continue; // cannot verify currency - skip silently, same as an unavailable link would
        }
        if (account.currencyId !== goalCurrencyId) {
            crossCurrencySkipped += 1;
            continue; // excluded, never converted
        }

        const amount = Number(t.amount);
        if (!Number.isFinite(amount)) {
            continue;
        }

        total += Math.abs(amount);
    }

    return {
        result: {
            linkId: link.id,
            categoryId: link.categoryId,
            categoryName: category.name,
            available: true,
            unavailableReason: null,
            contributedAmount: round2(total),
        },
        crossCurrencySkipped,
    };
}

/**
 * Computes one CATEGORY_CONTRIBUTION_LINKED goal's current amount /
 * progress / remaining amount from its active category links and the
 * live ledger. Manual and account-linked goals should not be passed
 * here - the caller decides which goals are CATEGORY_CONTRIBUTION_LINKED
 * (see GoalActualsService).
 */
export function calculateCategoryContributionGoalActuals(
    goal: Pick<
        FinancialGoal,
        | "id"
        | "currencyId"
        | "targetAmount"
        | "createdAt"
        | "targetDate"
    >,
    links: readonly GoalCategoryLink[],
    ledger: GoalLedgerBundle,
    /**
     * YYYY-MM-DD, local calendar date. Defaults to today - injectable
     * for deterministic tests. Must use the same local-date convention
     * as windowStart (toISODateString), not a UTC slice of an ISO
     * string - see the windowStart comment below for why that
     * distinction matters. GoalActualsService always passes this
     * explicitly (via toISODateString(new Date())), so this default is
     * a defensive fallback for direct callers of this pure function.
     */
    asOf: string = toISODateString(new Date())
): GoalCalcResult {
    // goal.createdAt is a full ISO timestamp (new Date().toISOString()
    // in FinancialGoalService.create), so it must be converted to a
    // local calendar date the same way asOf is (toISODateString) -
    // slicing the raw ISO string would take the UTC calendar date
    // instead, which can be a day ahead of the user's local "today" in
    // timezones behind UTC and silently exclude a same-day contribution.
    const windowStart = toISODateString(
        new Date(goal.createdAt)
    );
    const windowEnd = goal.targetDate ?? asOf;

    const activeLinks = links.filter(
        link => link.isActive
    );

    const evaluatedWithSkips = activeLinks.map(link =>
        evaluateCategoryLink(
            link,
            windowStart,
            windowEnd,
            goal.currencyId,
            ledger
        )
    );

    const evaluated = evaluatedWithSkips.map(
        e => e.result
    );

    const totalCrossCurrencySkipped = sum(
        evaluatedWithSkips.map(
            e => e.crossCurrencySkipped
        )
    );

    const currentAmount = round2(
        sum(
            evaluated
                .filter(link => link.available)
                .map(
                    link =>
                        link.contributedAmount ?? 0
                )
        )
    );

    const warnings = evaluated
        .filter(link => !link.available)
        .map(
            link =>
                `${link.categoryName ?? "A category"}: ${CATEGORY_UNAVAILABLE_MESSAGES[link.unavailableReason as GoalCategoryUnavailableReason]}`
        );

    if (totalCrossCurrencySkipped > 0) {
        warnings.push(
            `${totalCrossCurrencySkipped} transaction(s) in another currency were excluded (no conversion).`
        );
    }

    const remainingAmount = Math.max(
        0,
        round2(goal.targetAmount - currentAmount)
    );

    const progressPercentage =
        goal.targetAmount > 0
            ? Math.min(
                  100,
                  Math.max(
                      0,
                      (currentAmount /
                          goal.targetAmount) *
                          100
                  )
              )
            : 0;

    return {
        goalId: goal.id,
        currencyId: goal.currencyId,
        // GoalCalcResult.links is typed for account links (Phase 1/2's
        // shape); category-link detail is intentionally not exposed
        // through this generic field to avoid a misleading cast. The UI
        // only needs totals + warnings for this mode.
        links: [],
        totals: {
            currentAmount,
            remainingAmount,
            progressPercentage,
            isComplete:
                goal.targetAmount > 0 &&
                currentAmount >= goal.targetAmount,
        },
        warnings,
    };
}

// =====================================================================
// Phase 4 - LOAN_PAYOFF_LINKED goals
//
// A separate, parallel calculation path - not a third linked-account
// role in evaluateLink/calculateGoalActuals above - because the linked
// entity is a Loan (dedicated Loans module record), not an Account.
// Mirrors financial-plans/services/planActuals.ts's evalLoan
// (LOAN·LIABILITY role) for the debt figure itself:
//  - outstandingDebt = sum of linked loans' current
//    outstandingPrincipal (the same field evalLoan reads) - no EMI /
//    payment-schedule data is read (that only backs Financial Plans'
//    LOAN·CONTRIBUTION role, explicitly out of scope here)
//  - amountPaidOff / progress / remainingDebt reuse Phase 2's exact
//    DEBT_PAYOFF_LINKED formula (see the role === "LIABILITY" branch
//    of calculateGoalActuals above)
//
// Unlike evalLoan (which keeps a CLOSED/ON_HOLD/DEFAULTED loan in the
// total and only warns - see markTerminal), a non-ACTIVE loan is
// treated as unavailable here (excluded, with a warning) - this
// matches Phase 1/2/3's own SOURCE_INACTIVE convention for Financial
// Goals, which always excludes rather than includes-with-a-warning.
// =====================================================================

export type GoalLoanUnavailableReason =
    | "SOURCE_MISSING"
    | "SOURCE_INACTIVE"
    | "CURRENCY_MISMATCH";

export interface GoalLoanLinkCalcResult {
    linkId: string;
    loanId: string;
    loanName: string | null;
    available: boolean;
    unavailableReason: GoalLoanUnavailableReason | null;
    /** Current outstandingPrincipal of the linked loan. null when unavailable. */
    outstandingPrincipal: number | null;
}

const LOAN_UNAVAILABLE_MESSAGES: Record<
    GoalLoanUnavailableReason,
    string
> = {
    SOURCE_MISSING:
        "The linked loan no longer exists.",
    SOURCE_INACTIVE:
        "The linked loan is no longer active.",
    CURRENCY_MISMATCH:
        "The linked loan's currency no longer matches this goal.",
};

function unavailableLoanLink(
    link: GoalLoanLink,
    loanName: string | null,
    reason: GoalLoanUnavailableReason
): GoalLoanLinkCalcResult {
    return {
        linkId: link.id,
        loanId: link.loanId,
        loanName,
        available: false,
        unavailableReason: reason,
        outstandingPrincipal: null,
    };
}

function evaluateLoanLink(
    link: GoalLoanLink,
    goalCurrencyId: string,
    ledger: GoalLedgerBundle
): GoalLoanLinkCalcResult {
    const loan = ledger.loansById?.get(link.loanId);

    if (!loan) {
        return unavailableLoanLink(
            link,
            null,
            "SOURCE_MISSING"
        );
    }

    if (!isGoalEligibleLoanStatus(loan.status)) {
        return unavailableLoanLink(
            link,
            loan.name,
            "SOURCE_INACTIVE"
        );
    }

    if (loan.currencyId !== goalCurrencyId) {
        return unavailableLoanLink(
            link,
            loan.name,
            "CURRENCY_MISMATCH"
        );
    }

    const principal = Number(
        loan.outstandingPrincipal
    );

    return {
        linkId: link.id,
        loanId: link.loanId,
        loanName: loan.name,
        available: true,
        unavailableReason: null,
        outstandingPrincipal: Number.isFinite(
            principal
        )
            ? round2(principal)
            : 0,
    };
}

/**
 * Computes one LOAN_PAYOFF_LINKED goal's current amount (amount paid
 * off) / progress / remaining amount from its active loan links and
 * the live ledger. Manual, account-linked, debt-payoff and
 * category-contribution goals should not be passed here - the caller
 * decides which goals are LOAN_PAYOFF_LINKED (see GoalActualsService).
 */
export function calculateLoanPayoffGoalActuals(
    goal: Pick<
        FinancialGoal,
        "id" | "currencyId" | "targetAmount"
    >,
    links: readonly GoalLoanLink[],
    ledger: GoalLedgerBundle
): GoalCalcResult {
    const activeLinks = links.filter(
        link => link.isActive
    );

    const evaluated = activeLinks.map(link =>
        evaluateLoanLink(
            link,
            goal.currencyId,
            ledger
        )
    );

    const outstandingDebt = round2(
        sum(
            evaluated
                .filter(link => link.available)
                .map(
                    link =>
                        link.outstandingPrincipal ?? 0
                )
        )
    );

    const warnings = evaluated
        .filter(link => !link.available)
        .map(
            link =>
                `${link.loanName ?? "A loan"}: ${LOAN_UNAVAILABLE_MESSAGES[link.unavailableReason as GoalLoanUnavailableReason]}`
        );

    // Same formula as Phase 2's role === "LIABILITY" branch above.
    const amountPaidOff = Math.max(
        0,
        round2(goal.targetAmount - outstandingDebt)
    );

    const progressPercentage =
        goal.targetAmount > 0
            ? Math.min(
                  100,
                  Math.max(
                      0,
                      (amountPaidOff /
                          goal.targetAmount) *
                          100
                  )
              )
            : 0;

    const remainingDebt = Math.max(
        0,
        round2(outstandingDebt)
    );

    return {
        goalId: goal.id,
        currencyId: goal.currencyId,
        // GoalCalcResult.links is typed for account links (Phase 1/2's
        // shape); loan-link detail is intentionally not exposed through
        // this generic field, same reasoning as Phase 3's category
        // links. The UI only needs totals + warnings for this mode.
        links: [],
        totals: {
            currentAmount: amountPaidOff,
            remainingAmount: remainingDebt,
            progressPercentage,
            isComplete:
                goal.targetAmount > 0 &&
                amountPaidOff >= goal.targetAmount,
            outstandingDebt,
        },
        warnings,
    };
}

// =====================================================================
// Phase 5 - INVESTMENT_LINKED goals
//
// A separate, parallel calculation path - not a fourth linked-account
// role in evaluateLink/calculateGoalActuals above - because the linked
// entity is an Investment (dedicated Investments module record), not
// an Account. Growth-shaped, like Phase 1's ASSET goals (not a payoff
// goal like Phase 2/4): currentAmount = sum of linked investments'
// current market value.
//
// Mirrors financial-plans/services/planActuals.ts's evalInvestment
// (INVESTMENT·ASSET role) for the value figure itself:
//  - currentAmount = sum of linked investments' current
//    investments.currentValue (the same field evalInvestment reads) -
//    no cost basis, unrealized gain/loss, transaction/contribution
//    data, or investment_holdings snapshots are read (those only back
//    Financial Plans' INVESTMENT·CONTRIBUTION role and the Investments
//    module's own reporting, explicitly out of scope here)
//
// Unlike evalInvestment (which keeps a CLOSED/ON_HOLD investment in
// the total and only warns - see markTerminal), a non-ACTIVE
// investment is treated as unavailable here (excluded, with a
// warning) - this matches Phase 1-4's own SOURCE_INACTIVE convention
// for Financial Goals, which always excludes rather than
// includes-with-a-warning.
//
// An investment's 1:1 mirror account (account_type = INVESTMENT) is
// never touched here - links point directly at investments.id, and
// that account type is already excluded from Phase 1/2's eligible
// account types (GOAL_SAVINGS_ACCOUNT_TYPES / GOAL_DEBT_ACCOUNT_TYPES),
// so there is no double-counting risk to guard against.
// =====================================================================

export type GoalInvestmentUnavailableReason =
    | "SOURCE_MISSING"
    | "SOURCE_INACTIVE"
    | "CURRENCY_MISMATCH";

export interface GoalInvestmentLinkCalcResult {
    linkId: string;
    investmentId: string;
    investmentName: string | null;
    available: boolean;
    unavailableReason: GoalInvestmentUnavailableReason | null;
    /** Current market value of the linked investment. null when unavailable. */
    currentValue: number | null;
}

const INVESTMENT_UNAVAILABLE_MESSAGES: Record<
    GoalInvestmentUnavailableReason,
    string
> = {
    SOURCE_MISSING:
        "The linked investment no longer exists.",
    SOURCE_INACTIVE:
        "The linked investment is no longer active.",
    CURRENCY_MISMATCH:
        "The linked investment's currency no longer matches this goal.",
};

function unavailableInvestmentLink(
    link: GoalInvestmentLink,
    investmentName: string | null,
    reason: GoalInvestmentUnavailableReason
): GoalInvestmentLinkCalcResult {
    return {
        linkId: link.id,
        investmentId: link.investmentId,
        investmentName,
        available: false,
        unavailableReason: reason,
        currentValue: null,
    };
}

function evaluateInvestmentLink(
    link: GoalInvestmentLink,
    goalCurrencyId: string,
    ledger: GoalLedgerBundle
): GoalInvestmentLinkCalcResult {
    const investment = ledger.investmentsById?.get(
        link.investmentId
    );

    if (!investment) {
        return unavailableInvestmentLink(
            link,
            null,
            "SOURCE_MISSING"
        );
    }

    if (
        !isGoalEligibleInvestmentStatus(
            investment.status
        )
    ) {
        return unavailableInvestmentLink(
            link,
            investment.name,
            "SOURCE_INACTIVE"
        );
    }

    if (investment.currencyId !== goalCurrencyId) {
        return unavailableInvestmentLink(
            link,
            investment.name,
            "CURRENCY_MISMATCH"
        );
    }

    const value = Number(investment.currentValue);

    return {
        linkId: link.id,
        investmentId: link.investmentId,
        investmentName: investment.name,
        available: true,
        unavailableReason: null,
        currentValue: Number.isFinite(value)
            ? round2(value)
            : 0,
    };
}

/**
 * Computes one INVESTMENT_LINKED goal's current amount / progress /
 * remaining amount from its active investment links and the live
 * ledger. Manual, account-linked, debt-payoff, category-contribution
 * and loan-payoff goals should not be passed here - the caller decides
 * which goals are INVESTMENT_LINKED (see GoalActualsService).
 */
export function calculateInvestmentGoalActuals(
    goal: Pick<
        FinancialGoal,
        "id" | "currencyId" | "targetAmount"
    >,
    links: readonly GoalInvestmentLink[],
    ledger: GoalLedgerBundle
): GoalCalcResult {
    const activeLinks = links.filter(
        link => link.isActive
    );

    const evaluated = activeLinks.map(link =>
        evaluateInvestmentLink(
            link,
            goal.currencyId,
            ledger
        )
    );

    const currentAmount = round2(
        sum(
            evaluated
                .filter(link => link.available)
                .map(
                    link => link.currentValue ?? 0
                )
        )
    );

    const warnings = evaluated
        .filter(link => !link.available)
        .map(
            link =>
                `${link.investmentName ?? "An investment"}: ${INVESTMENT_UNAVAILABLE_MESSAGES[link.unavailableReason as GoalInvestmentUnavailableReason]}`
        );

    const remainingAmount = Math.max(
        0,
        round2(goal.targetAmount - currentAmount)
    );

    const progressPercentage =
        goal.targetAmount > 0
            ? Math.min(
                  100,
                  Math.max(
                      0,
                      (currentAmount /
                          goal.targetAmount) *
                          100
                  )
              )
            : 0;

    return {
        goalId: goal.id,
        currencyId: goal.currencyId,
        // GoalCalcResult.links is typed for account links (Phase 1/2's
        // shape); investment-link detail is intentionally not exposed
        // through this generic field, same reasoning as Phase 3/4's
        // category/loan links. The UI only needs totals + warnings for
        // this mode.
        links: [],
        totals: {
            currentAmount,
            remainingAmount,
            progressPercentage,
            isComplete:
                goal.targetAmount > 0 &&
                currentAmount >= goal.targetAmount,
        },
        warnings,
    };
}
