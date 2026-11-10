import { describe, expect, it } from "vitest";

import { computeOverdraftPosition } from "../services/overdraftPosition";
import { LoanKind, type Loan } from "../types";
import {
    OVERDRAFT_COLUMNS,
    TERM_LOAN_COLUMNS,
    buildOverdraftRow,
    loanRowActions,
    splitLoansBySection,
} from "./loansPageSections";

// No component-render setup in this repo (vitest environment: "node",
// see ViewLoanDialog.test.ts), so the Loans page's section split,
// columns, actions and Over Draft row values are tested through the
// pure functions LoansPage.tsx renders from.

function loan(overrides: Partial<Loan> = {}): Loan {
    return {
        id: "loan-1",
        accountId: "bank-1",
        loanAccountId: "loan-acct-1",
        lenderInstitutionId: "inst-1",
        loanType: "Home Loan",
        loanKind: LoanKind.TERM_LOAN,
        name: "HDFC Home Loan",
        principalAmount: 500000,
        interestRate: 8.5,
        interestType: "REDUCING",
        tenureMonths: 24,
        emiAmount: 22650.5,
        startDate: "2026-01-01",
        maturityDate: "2028-01-01",
        outstandingPrincipal: 480000,
        outstandingInterest: 12500,
        paidInstallments: 2,
        currencyId: "INR",
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function overdraft(overrides: Partial<Loan> = {}): Loan {
    return loan({
        id: "od-1",
        name: "Bank OD",
        loanType: "Overdraft",
        loanKind: LoanKind.OVERDRAFT,
        principalAmount: 0,
        outstandingPrincipal: 0,
        outstandingInterest: 0,
        tenureMonths: null,
        emiAmount: null,
        maturityDate: null,
        paidInstallments: 0,
        interestRate: 10.5,
        creditLimit: 1000000,
        openingUsed: 0,
        openingUsedAsOf: "2026-01-01",
        linkedAccountIds: ["bank-1"],
        ...overrides,
    });
}

function totals(used: number, invalidLinks = 0) {
    return {
        used,
        totalDrawdowns: Math.max(0, used),
        totalRepayments: Math.max(0, -used),
        totalInterestCharges: 0,
        invalidLinks,
    };
}

describe("splitLoansBySection", () => {
    it("puts each loan in exactly one section, keeping order", () => {
        const home = loan({ id: "t1", name: "Home" });
        const od = overdraft({ id: "o1" });
        const car = loan({ id: "t2", name: "Car" });
        const od2 = overdraft({ id: "o2" });

        const { termLoans, overdrafts } = splitLoansBySection([home, od, car, od2]);

        expect(termLoans.map(item => item.id)).toEqual(["t1", "t2"]);
        expect(overdrafts.map(item => item.id)).toEqual(["o1", "o2"]);
    });

    it("treats a loan with no loanKind as a Term Loan", () => {
        const legacy = loan({ id: "legacy", loanKind: undefined });

        expect(splitLoansBySection([legacy])).toEqual({
            termLoans: [legacy],
            overdrafts: [],
        });
    });

    it("decides by loan kind, never by the free-text Loan Category", () => {
        const labelledOd = loan({ id: "t", loanType: "Overdraft" });
        const realOd = overdraft({ id: "o", loanType: "DOD" });

        const { termLoans, overdrafts } = splitLoansBySection([labelledOd, realOd]);

        expect(termLoans.map(item => item.id)).toEqual(["t"]);
        expect(overdrafts.map(item => item.id)).toEqual(["o"]);
    });

    it("handles either section being empty", () => {
        expect(splitLoansBySection([])).toEqual({ termLoans: [], overdrafts: [] });
        expect(splitLoansBySection([overdraft()]).termLoans).toEqual([]);
        expect(splitLoansBySection([loan()]).overdrafts).toEqual([]);
    });
});

describe("section columns", () => {
    it("keeps the Term Loans columns unchanged", () => {
        expect([...TERM_LOAN_COLUMNS]).toEqual([
            "Loan",
            "Type",
            "Principal",
            "Outstanding",
            "Interest",
            "EMI",
            "Status",
            "Actions",
        ]);
    });

    it("gives the Over Draft table revolving-credit columns", () => {
        expect([...OVERDRAFT_COLUMNS]).toEqual([
            "Overdraft",
            "OD Limit",
            "Used",
            "Available",
            "Interest Rate",
            "Linked Accounts",
            "Status",
            "Actions",
        ]);
    });
});

describe("loanRowActions", () => {
    it("keeps View, Edit, EMI Schedule and Delete for a Term Loan", () => {
        expect(loanRowActions(loan())).toEqual(["VIEW", "EDIT", "EMI_SCHEDULE", "DELETE"]);
    });

    it("gives an Overdraft View, Edit and Delete (no EMI schedule)", () => {
        expect(loanRowActions(overdraft())).toEqual(["VIEW", "EDIT", "DELETE"]);
    });
});

describe("buildOverdraftRow", () => {
    const names = new Map([
        ["bank-1", "Business Current 3999"],
        ["bank-2", "Business Current 2790"],
    ]);

    it("shows the configured limit, derived used/available, rate and status", () => {
        const od = overdraft({ creditLimit: 1000000, interestRate: 10.5 });
        const row = buildOverdraftRow(
            od,
            computeOverdraftPosition(od.creditLimit, totals(250000)),
            names
        );

        expect(row).toEqual({
            limit: 1000000,
            used: 250000,
            available: 750000,
            interestRate: 10.5,
            linkedAccounts: ["Business Current 3999"],
            loanStatus: "ACTIVE",
            usageStatusLabel: "Partly Used",
            usageWarning: false,
            reviewReasons: [],
        });
    });

    it("lists every linked account, in order", () => {
        const od = overdraft({ linkedAccountIds: ["bank-2", "bank-1"] });

        expect(buildOverdraftRow(od, null, names).linkedAccounts).toEqual([
            "Business Current 2790",
            "Business Current 3999",
        ]);
    });

    it("shows an unresolved account by id rather than dropping it", () => {
        const od = overdraft({ linkedAccountIds: ["bank-1", "gone-9"] });

        expect(buildOverdraftRow(od, null, names).linkedAccounts).toEqual([
            "Business Current 3999",
            "gone-9",
        ]);
    });

    it("keeps a negative Used, its Available and Needs Review visible", () => {
        const od = overdraft({ creditLimit: 12500000 });
        const position = computeOverdraftPosition(od.creditLimit, totals(-1050000));
        const row = buildOverdraftRow(od, position, names);

        expect(row.used).toBe(-1050000);
        expect(row.available).toBe(13550000);
        expect(row.available).toBeGreaterThan(row.limit!);
        expect(row.usageStatusLabel).toBe("Needs Review");
        expect(row.usageWarning).toBe(true);
        expect(row.reviewReasons).toEqual(position.reviewReasons);
        expect(row.reviewReasons.length).toBeGreaterThan(0);
    });

    it("flags Over Limit as a warning too", () => {
        const od = overdraft({ creditLimit: 100000 });
        const row = buildOverdraftRow(
            od,
            computeOverdraftPosition(od.creditLimit, totals(150000)),
            names
        );

        expect(row.usageStatusLabel).toBe("Over Limit");
        expect(row.usageWarning).toBe(true);
        expect(row.available).toBe(0);
    });

    it("shows dashes (null), not zeros, until the position has loaded", () => {
        const row = buildOverdraftRow(overdraft(), null, names);

        expect(row.limit).toBeNull();
        expect(row.used).toBeNull();
        expect(row.available).toBeNull();
        expect(row.usageStatusLabel).toBeNull();
        expect(row.usageWarning).toBe(false);
    });
});
