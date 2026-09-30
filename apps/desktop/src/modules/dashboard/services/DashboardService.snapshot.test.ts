import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { AccountType } from "@/modules/accounts/types";
import {
    InvestmentStatus,
    InvestmentTransactionType,
    type InvestmentTransaction,
} from "@/modules/investments/types";

import {
    computeAccountBalances,
    computeBalanceSnapshot,
    computeCashFlowSeries,
    computeInvestmentValue,
    computeLoanLiability,
    DashboardService,
    formatBalanceAsOfLabel,
    resolveBalanceAsOf,
    type SnapshotInvestment,
    type SnapshotLoan,
    type SnapshotLoanPayment,
    type SnapshotTransaction,
} from "./DashboardService";
import { computeAccountTransactionDeltas } from "@/modules/accounts/utils";

// ---------------------------------------------------------------------
// Dashboard Bank Balance / Net Worth AS OF the selected period's end
// date D - rebuilt from the existing account / loan / investment models.
// ---------------------------------------------------------------------

vi.mock("@/core/database/engine/SQLiteProvider", () => ({
    SQLiteProvider: {
        getInstance: () => ({
            select: async () => [],
            execute: async () => undefined,
        }),
    },
}));

const TODAY = "2026-09-26";

function account(id: string, type: AccountType, openingBalance: number) {
    return { id, name: id, type, openingBalance };
}

function txn(
    accountId: string,
    transactionDate: string,
    type: "income" | "expense" | "transfer",
    amount: number,
    transferDirection: "IN" | "OUT" | null = null
): SnapshotTransaction {
    return { accountId, transactionDate, type, amount, transferDirection };
}

const accounts = [
    account("hdfc", AccountType.SAVINGS, 10_000),
    account("axis", AccountType.CURRENT, 5_000),
    account("cash", AccountType.CASH, 1_000),
    account("card", AccountType.CREDIT_CARD, 0),
];

const transactions: SnapshotTransaction[] = [
    txn("hdfc", "2026-07-15", "income", 2_000), // before the period
    txn("hdfc", "2026-08-10", "expense", 500), // within August
    txn("axis", "2026-08-31", "income", 300), // exactly on D = 31 Aug
    txn("hdfc", "2026-09-05", "expense", 4_000), // after D
    txn("card", "2026-08-20", "expense", 700), // card spend within August
    // Transfer HDFC -> Axis on 20 Aug (OUT / IN legs).
    txn("hdfc", "2026-08-20", "transfer", 1_000, "OUT"),
    txn("axis", "2026-08-20", "transfer", 1_000, "IN"),
    txn("cash", "2026-09-10", "expense", 200), // after D
];

const noLoans: SnapshotLoan[] = [];
const noPayments: SnapshotLoanPayment[] = [];
const noInvestments: SnapshotInvestment[] = [];

function snapshot(asOf: string | null, extra: Partial<Parameters<typeof computeBalanceSnapshot>[0]> = {}) {
    return computeBalanceSnapshot({
        accounts,
        transactions,
        loans: noLoans,
        loanPayments: noPayments,
        investments: noInvestments,
        investmentTransactions: [],
        asOf,
        ...extra,
    });
}

describe("resolveBalanceAsOf - which periods are historical", () => {
    it("a period ending in the past is a snapshot as of its end date (month, year, custom, cross-year)", () => {
        expect(resolveBalanceAsOf({ start: "2026-08-01", end: "2026-08-31" }, TODAY)).toBe("2026-08-31"); // month
        expect(resolveBalanceAsOf({ start: "2025-01-01", end: "2025-12-31" }, TODAY)).toBe("2025-12-31"); // year
        expect(resolveBalanceAsOf({ start: "2026-03-14", end: "2026-05-02" }, TODAY)).toBe("2026-05-02"); // custom
        expect(resolveBalanceAsOf({ start: "2025-11-15", end: "2026-02-10" }, TODAY)).toBe("2026-02-10"); // cross-year
    });

    it("a period ending today (or later) uses the current figures", () => {
        expect(resolveBalanceAsOf({ start: "2026-08-28", end: TODAY }, TODAY)).toBeNull();
        expect(resolveBalanceAsOf({ start: "2026-09-01", end: "2026-09-30" }, TODAY)).toBeNull();
    });

    it("labels a historical snapshot 'As of DD Mon YYYY' and the current figures not at all", () => {
        expect(formatBalanceAsOfLabel("2026-08-31")).toBe("As of 31 Aug 2026");
        expect(formatBalanceAsOfLabel("2025-01-05")).toBe("As of 05 Jan 2025");
        expect(formatBalanceAsOfLabel(null)).toBeNull();
    });
});

describe("historical Bank Balance", () => {
    it("opening balance + transactions before and within the period, including the end date, excluding later ones", () => {
        const result = snapshot("2026-08-31");

        // HDFC 10,000 + 2,000 (Jul) - 500 (Aug) - 1,000 (transfer out); Sep -4,000 excluded.
        // Axis 5,000 + 300 (on D) + 1,000 (transfer in).
        expect(result.accounts.find(a => a.id === "hdfc")?.amount).toBe(10_500);
        expect(result.accounts.find(a => a.id === "axis")?.amount).toBe(6_300);
        expect(result.bankBalance).toBe(16_800);
        // Cash's 10 Sep expense is after D.
        expect(result.cashOnHand).toBe(1_000);
    });

    it("the day before the end-date transaction excludes it", () => {
        expect(snapshot("2026-08-30").accounts.find(a => a.id === "axis")?.amount).toBe(6_000);
    });

    it("before any activity it is just the opening balances", () => {
        expect(snapshot("2026-01-01").bankBalance).toBe(15_000);
    });

    it("a transfer moves both accounts' balances but leaves the bank total unchanged, and is not income/expense", () => {
        expect(snapshot("2026-08-19").bankBalance - snapshot("2026-08-20").bankBalance).toBe(0);
        expect(snapshot("2026-08-20").accounts.find(a => a.id === "hdfc")?.amount).toBe(10_500);

        const cashFlow = computeCashFlowSeries(
            transactions.map((t, i) => ({ ...t, id: `t${i}` })),
            { start: "2026-08-20", end: "2026-08-20" }
        );
        // Only the card expense counts; the transfer legs don't.
        expect(cashFlow).toEqual([expect.objectContaining({ income: 0, expense: 700 })]);
    });

    it("the current snapshot is exactly the existing current Bank Balance (every transaction, any date)", () => {
        const existing = computeAccountBalances(accounts, computeAccountTransactionDeltas(transactions));
        const current = snapshot(null);

        expect(current.bankBalance).toBe(existing.bankBalance);
        expect(current.cashOnHand).toBe(existing.cashOnHand);
        expect(current.accounts).toEqual(existing.accounts);
        // As of the latest transaction date it matches too.
        expect(snapshot("2026-09-10").bankBalance).toBe(existing.bankBalance);
    });
});

// ---------------------------------------------------------------------
// Loans - existing loan model: outstanding now + payments after D added
// back by their stored allocation (as LoanPaymentService.reversePayment).
// ---------------------------------------------------------------------

const loans: SnapshotLoan[] = [
    { id: "home", status: "ACTIVE", startDate: "2025-01-01", outstandingPrincipal: 800_000, outstandingInterest: 20_000 },
    { id: "car", status: "CLOSED", startDate: "2024-06-01", outstandingPrincipal: 0, outstandingInterest: 0 },
    { id: "new", status: "ACTIVE", startDate: "2026-09-01", outstandingPrincipal: 100_000, outstandingInterest: 0 },
];

const payments: SnapshotLoanPayment[] = [
    { loanId: "home", paymentDate: "2026-08-05", principalAmount: 9_000, interestAmount: 6_000 }, // before D
    { loanId: "home", paymentDate: "2026-08-31", principalAmount: 9_100, interestAmount: 5_900 }, // on D
    { loanId: "home", paymentDate: "2026-09-05", principalAmount: 9_200, interestAmount: 5_800 }, // after D
    { loanId: "car", paymentDate: "2026-09-02", principalAmount: 50_000, interestAmount: 500 }, // closed after D
];

describe("historical loan liability (existing loan model)", () => {
    it("current liability is unchanged: non-CLOSED outstanding principal + interest", () => {
        expect(computeLoanLiability(loans, payments, null)).toBe(820_000 + 100_000);
    });

    it("as of D adds back payments dated after D (not on or before D), skips loans started after D, and restores a later-closed loan", () => {
        // home: 820,000 + 15,000 (5 Sep) ; car: 0 + 50,500 ; new: starts 1 Sep -> 0
        expect(computeLoanLiability(loans, payments, "2026-08-31")).toBe(835_000 + 50_500);
    });

    it("once all its payments are on/before D, a closed loan owes nothing", () => {
        expect(computeLoanLiability(loans, payments, "2026-09-10")).toBe(820_000 + 100_000);
    });
});

// ---------------------------------------------------------------------
// Investments - existing model: ledger replay (InvestmentPortfolioCalculator)
// valued like currentValue (quantity x currentPrice).
// ---------------------------------------------------------------------

function inv(
    investmentId: string,
    transactionDate: string,
    transactionType: InvestmentTransactionType,
    quantity: number,
    price: number
): InvestmentTransaction {
    return {
        id: `${investmentId}-${transactionDate}-${transactionType}`, investmentId, transactionType, transactionDate,
        quantity, price, amount: quantity * price, fees: 0, taxes: 0, referenceNumber: null,
        createdAt: `${transactionDate}T10:00:00Z`, updatedAt: "",
    };
}

const investments: SnapshotInvestment[] = [
    // Ledger: 10 on 1 Jul, +5 on 31 Aug, -3 on 10 Sep -> 12 now at 150.
    { id: "fund", status: InvestmentStatus.ACTIVE, currentValue: 1_800, currentPrice: 150, purchaseDate: "2026-07-01", createdAt: "2026-07-01T00:00:00Z" },
    // No ledger: counted from its purchase date.
    { id: "gold", status: InvestmentStatus.ACTIVE, currentValue: 2_500, currentPrice: 2_500, purchaseDate: "2026-08-15", createdAt: "2026-08-15T00:00:00Z" },
    // Closed: never in net worth (as before).
    { id: "old", status: InvestmentStatus.CLOSED, currentValue: 999, currentPrice: 1, purchaseDate: "2025-01-01", createdAt: "2025-01-01T00:00:00Z" },
];

const investmentLedger = [
    inv("fund", "2026-07-01", InvestmentTransactionType.BUY, 10, 100),
    inv("fund", "2026-08-31", InvestmentTransactionType.BUY, 5, 120),
    inv("fund", "2026-09-10", InvestmentTransactionType.SELL, 3, 140),
];

describe("historical investment value (existing investment model)", () => {
    it("current value is unchanged: every non-CLOSED investment's currentValue", () => {
        expect(computeInvestmentValue(investments, investmentLedger, null)).toBe(4_300);
    });

    it("as of D replays the ledger up to and including D, valued at quantity x currentPrice", () => {
        // fund: 15 units x 150 ; gold bought 15 Aug -> 2,500
        expect(computeInvestmentValue(investments, investmentLedger, "2026-08-31")).toBe(15 * 150 + 2_500);
        // Before the 31 Aug buy and before gold's purchase.
        expect(computeInvestmentValue(investments, investmentLedger, "2026-08-10")).toBe(10 * 150);
        // Before anything was held.
        expect(computeInvestmentValue(investments, investmentLedger, "2026-06-30")).toBe(0);
    });

    it("as of the latest ledger date it equals the current value", () => {
        expect(computeInvestmentValue(investments, investmentLedger, "2026-09-10")).toBe(4_300);
    });
});

describe("historical and current Net Worth", () => {
    const full = { loans, loanPayments: payments, investments, investmentTransactions: investmentLedger };

    it("current Net Worth is exactly the existing formula: accounts (card debt subtracted) - loans + investments", () => {
        const existing = computeAccountBalances(accounts, computeAccountTransactionDeltas(transactions));
        const existingNetWorth = existing.accountsNetWorth - 920_000 + 4_300;

        expect(snapshot(null, full).netWorth).toBe(existingNetWorth);
    });

    it("as of D combines the account, loan and investment snapshots", () => {
        const result = snapshot("2026-08-31", full);
        // Accounts: bank 16,800 + cash 1,000 - card 700 ; loans 885,500 ; investments 4,750.
        expect(result.accountsNetWorth).toBe(17_100);
        expect(result.loanLiability).toBe(885_500);
        expect(result.investmentValue).toBe(4_750);
        expect(result.netWorth).toBe(17_100 - 885_500 + 4_750);
    });
});

// ---------------------------------------------------------------------
// getSummary wiring, with every data source stubbed.
// ---------------------------------------------------------------------

function stubbedService(fetchLog: string[]) {
    const service = new DashboardService();
    const stub = (name: string, value: object) => Object.defineProperty(service, name, { value });

    stub("accountService", {
        getAll: async () => accounts.map(a => ({ ...a, isActive: true, currencyId: "inr" })),
    });
    stub("transactionService", {
        getAll: async () => transactions.map((t, i) => ({
            ...t, id: `t${i}`, status: "CLEARED", payee: "P", categoryId: null, subcategoryId: null,
        })),
    });
    stub("loanService", { getAll: async () => loans });
    stub("budgetService", { getAll: async () => [] });
    stub("goalService", { getAll: async () => [] });
    stub("investmentService", {
        getAll: async () => investments.map(i => ({ ...i, currencyId: "inr", investmentType: "Fund" })),
    });
    stub("categoryService", { getAll: async () => [] });
    stub("institutionService", { getAll: async () => [] });
    stub("currencyService", { getAll: async () => [{ id: "inr", code: "INR", isDefault: true }] });
    stub("emiScheduleService", { getInterestByTransactionId: async () => new Map() });
    stub("loanPaymentScheduleRepository", { getAllByLoanId: async () => [] });
    stub("loanSchedulePaymentRepository", {
        getAll: async () => { fetchLog.push("loanPayments"); return payments; },
    });
    stub("investmentTransactionRepository", {
        getAll: async () => { fetchLog.push("investmentTransactions"); return investmentLedger; },
    });

    return service;
}

describe("DashboardService.getSummary", () => {
    it("a past period reports Bank Balance / Net Worth as of its end date, with Income/Expenses for the period", async () => {
        const fetchLog: string[] = [];
        const summary = await stubbedService(fetchLog).getSummary({ start: "2026-08-01", end: "2026-08-31" });

        expect(summary.balanceAsOf).toBe("2026-08-31");
        expect(summary.bankBalance).toBe(16_800);
        expect(summary.cashOnHand).toBe(1_000);
        expect(summary.netWorth).toBe(17_100 - 885_500 + 4_750);
        // August income/expense: +300 income ; 500 + 700 expense (transfer legs excluded).
        expect(summary.income).toBe(300);
        expect(summary.expenses).toBe(1_200);
        // The Accounts Summary card keeps today's balances.
        expect(summary.accounts.find(a => a.id === "hdfc")?.amount).toBe(6_500);
        // One bulk query each - no per-loan / per-investment queries.
        expect(fetchLog.sort()).toEqual(["investmentTransactions", "loanPayments"]);
    });

    it("a cross-year past period works the same way", async () => {
        const summary = await stubbedService([]).getSummary({ start: "2025-12-01", end: "2026-01-31" });

        expect(summary.balanceAsOf).toBe("2026-01-31");
        expect(summary.bankBalance).toBe(15_000);
    });

    it("a period ending today keeps the exact current figures and skips the historical queries", async () => {
        const fetchLog: string[] = [];
        const today = new Date();
        const end = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const summary = await stubbedService(fetchLog).getSummary({ start: "2026-01-01", end });

        const existing = computeAccountBalances(accounts, computeAccountTransactionDeltas(transactions));
        expect(summary.balanceAsOf).toBeNull();
        expect(summary.bankBalance).toBe(existing.bankBalance);
        expect(summary.netWorth).toBe(existing.accountsNetWorth - 920_000 + 4_300);
        expect(fetchLog).toEqual([]);
    });
});

describe("Dashboard UI", () => {
    const source = readFileSync(path.resolve(__dirname, "../Dashboard.tsx"), "utf-8");
    const card = readFileSync(path.resolve(__dirname, "../components/cards/DashboardStatCard.tsx"), "utf-8");

    it("shows the 'As of' label under Bank Balance and Net Worth only for historical periods", () => {
        expect(source).toContain("formatBalanceAsOfLabel(\n        dashboardSummary.balanceAsOf\n    )".replace(/\n/g, source.includes("\r\n") ? "\r\n" : "\n"));
        expect(source).toContain("asOfLabel={balanceAsOfLabel}");
        expect(source).toContain("caption={balanceAsOfLabel}");
        expect(card).toContain('{caption ?? "Current period"}');
    });
});
