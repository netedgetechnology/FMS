import { describe, expect, it } from "vitest";

import { LoanPaymentStatus, type LoanPaymentSchedule } from "../types";
import {
    dueInstalmentCount,
    historicalInstalmentIssues,
    historicalSummary,
    localToday,
    markHistoricalInstalments,
    matchHistoricalEmiDebits,
    paidInstalmentCount,
    resizeHistorical,
    suggestHistoricalLinks,
    type HistoricalEntry,
} from "./historicalInstalments";
import type { LinkedTransactionSummary } from "./loanSetupTypes";

const BANK = "acct-3999";
const TODAY = "2026-11-04";

function row(installmentNumber: number, dueDate: string, totalAmount = 8_290.49): LoanPaymentSchedule {
    return {
        id: `s${installmentNumber}`,
        loanId: "loan",
        installmentNumber,
        dueDate,
        principalAmount: 2_000,
        interestAmount: totalAmount - 2_000,
        totalAmount,
        outstandingPrincipal: 750_000 - 2_000 * installmentNumber,
        status: LoanPaymentStatus.UPCOMING,
        paidDate: null,
        paidAmount: null,
        transactionId: null,
    };
}

const SCHEDULE = [
    row(1, "2026-03-05"),
    row(2, "2026-04-05"),
    row(3, "2026-05-05"),
    row(4, "2026-11-05"), // after TODAY
];

function debit(id: string, date: string, amount = 8_290.49, extra: Partial<LinkedTransactionSummary> = {}): LinkedTransactionSummary {
    return {
        id,
        date,
        amount,
        accountId: BANK,
        accountName: "Netedge 3999",
        side: "OUT",
        payee: "Payee",
        narration: null,
        categoryName: null,
        categoryType: null,
        ...extra,
    };
}

const CONTEXT = { today: TODAY, accountId: BANK, loanStartDate: "2026-02-05" };

function linked(installmentNumber: number, transaction: LinkedTransactionSummary): HistoricalEntry {
    return { installmentNumber, resolution: "LINKED", transaction };
}

function settled(installmentNumber: number): HistoricalEntry {
    return { installmentNumber, resolution: "SETTLED_BEFORE_FINWEA", transaction: null };
}

describe("historical instalments - which can be historical", () => {
    it("counts only the instalments due on or before today", () => {
        expect(dueInstalmentCount(SCHEDULE, TODAY)).toBe(3);
        expect(dueInstalmentCount(SCHEDULE, "2026-11-05")).toBe(4);
        expect(dueInstalmentCount(SCHEDULE, "2026-03-04")).toBe(0);
    });

    it("uses the local calendar date for today", () => {
        expect(localToday(new Date(2026, 10, 4, 23, 59))).toBe("2026-11-04");
    });

    it("resizes the draft list, keeping resolved entries and adding unresolved ones", () => {
        const resolved = { resolution: "SETTLED_BEFORE_FINWEA" as const, transaction: null };
        expect(resizeHistorical([resolved], 3)).toEqual([resolved, { resolution: null, transaction: null }, { resolution: null, transaction: null }]);
        expect(resizeHistorical([resolved, resolved], 1)).toEqual([resolved]);
    });
});

describe("historical instalments - validation", () => {
    it("accepts linked debits and explicit settlements for past instalments", () => {
        const entries = [linked(1, debit("t1", "2026-03-05")), settled(2), linked(3, debit("t3", "2026-05-06"))];
        expect(historicalInstalmentIssues(SCHEDULE, entries, CONTEXT)).toEqual([]);
    });

    it("rejects an instalment due after today, even as Settled before FinWea", () => {
        const entries = [settled(1), settled(2), settled(3), settled(4)];
        expect(historicalInstalmentIssues(SCHEDULE, entries, CONTEXT).map(i => i.message)).toEqual([
            "Instalment #4 is due on 2026-11-05, after today - a future instalment cannot be marked paid.",
        ]);
    });

    it("requires every historical instalment to be resolved - nothing is assumed", () => {
        const issues = historicalInstalmentIssues(SCHEDULE, [{ installmentNumber: 1, resolution: null, transaction: null }], CONTEXT);
        expect(issues.map(i => i.message)).toEqual(['Instalment #1: link its bank debit, or mark it "Settled before FinWea".']);
    });

    it("rejects one bank transaction for two instalments, or one already used by the setup", () => {
        const t = debit("t1", "2026-03-05");
        expect(historicalInstalmentIssues(SCHEDULE, [linked(1, t), linked(2, t)], CONTEXT).map(i => i.message).join(" ")).toMatch(
            /instalment #2 is already used/
        );
        expect(
            historicalInstalmentIssues(SCHEDULE, [linked(1, t)], { ...CONTEXT, otherLinkedIds: ["t1"] }).map(i => i.message).join(" ")
        ).toMatch(/already used by another instalment or by this loan's setup/);
    });

    it("rejects a debit of a different amount (no tolerance), on another account, money in, after today or before the loan", () => {
        const check = (t: LinkedTransactionSummary) => historicalInstalmentIssues(SCHEDULE, [linked(1, t)], CONTEXT).map(i => i.message).join(" ");

        expect(check(debit("a", "2026-03-05", 8_291))).toMatch(/is for 8,291.00, not the instalment's 8,290.49/);
        expect(check(debit("b", "2026-03-05", 8_290.49, { accountId: "acct-2790" }))).toMatch(/not on the loan's EMI account/);
        expect(check(debit("c", "2026-03-05", 8_290.49, { side: "IN" }))).toMatch(/not money paid out/);
        expect(check(debit("d", "2026-11-10"))).toMatch(/dated after today/);
        expect(check(debit("e", "2026-01-31"))).toMatch(/dated before the loan started/);
    });

    it("requires the historical instalments to be the first ones, in order", () => {
        expect(historicalInstalmentIssues(SCHEDULE, [settled(2)], CONTEXT).map(i => i.message)).toEqual([
            "Historical instalments must be the first instalments of the schedule, in order.",
        ]);
    });

    it("a settled instalment cannot also carry a transaction", () => {
        const entry: HistoricalEntry = { installmentNumber: 1, resolution: "SETTLED_BEFORE_FINWEA", transaction: debit("t", "2026-03-05") };
        expect(historicalInstalmentIssues(SCHEDULE, [entry], CONTEXT).map(i => i.message).join(" ")).toMatch(/cannot also be linked/);
    });
});

describe("historical instalments - marking and counting", () => {
    it("marks a linked instalment paid on its transaction's date, and a settled one with the flag and no transaction", () => {
        const marked = markHistoricalInstalments(SCHEDULE, [linked(1, debit("t1", "2026-03-06")), settled(2)]);

        expect(marked[0]).toMatchObject({ status: "PAID", paidDate: "2026-03-06", paidAmount: 8_290.49, transactionId: "t1", settledBeforeFinwea: false });
        expect(marked[1]).toMatchObject({ status: "PAID", paidDate: "2026-04-05", paidAmount: 8_290.49, transactionId: null, settledBeforeFinwea: true });
        expect(marked[2]).toMatchObject({ status: "UPCOMING", transactionId: null, settledBeforeFinwea: false });
        // The input schedule is never changed.
        expect(SCHEDULE[0]!.status).toBe("UPCOMING");
    });

    it("stops at the first unresolved entry, so PAID rows are always the leading ones", () => {
        const marked = markHistoricalInstalments(SCHEDULE, [settled(1), { installmentNumber: 2, resolution: null, transaction: null }, settled(3)]);
        expect(marked.map(r => r.status)).toEqual(["PAID", "UPCOMING", "UPCOMING", "UPCOMING"]);
        expect(paidInstalmentCount(marked)).toBe(1);
    });

    it("counts linked payments and declared settlements separately", () => {
        expect(
            historicalSummary([linked(1, debit("t1", "2026-03-05")), settled(2), { installmentNumber: 3, resolution: null, transaction: null }])
        ).toEqual({ linked: 1, settledBeforeFinwea: 1, unresolved: 1 });
    });
});

describe("historical instalments - matching existing bank debits", () => {
    const CANDIDATES = [
        debit("mar-on-time", "2026-03-05"),
        debit("apr-late", "2026-04-09"),
        debit("apr-with-number", "2026-04-12", 8_290.49, { narration: "ACH/ECS TXLNA0999000000000017" }),
        debit("apr-lender", "2026-04-05", 8_290.49, { narration: "NACH TATA CAPITAL LTD" }),
        debit("rounded", "2026-05-05", 8_291),
        debit("too-far", "2026-05-20"),
        debit("credit", "2026-05-05", 8_290.49, { side: "IN" }),
        debit("other-account", "2026-05-05", 8_290.49, { accountId: "acct-2790" }),
    ];
    const MATCH = { accountId: BANK, loanStartDate: "2026-02-05", today: TODAY, loanAccountNumber: "TXLNA0999000000000017", lenderName: "TATA Capital" };

    it("offers exact-amount debits on the EMI account within the window, best first", () => {
        const matches = matchHistoricalEmiDebits(SCHEDULE.slice(0, 3), CANDIDATES, MATCH);

        expect(matches.get(1)!.map(c => c.transaction.id)).toEqual(["mar-on-time"]);
        // Loan number in the narration first, then the lender's name, then the nearest date.
        expect(matches.get(2)!.map(c => c.transaction.id)).toEqual(["apr-with-number", "apr-lender", "apr-late"]);
        expect(matches.get(2)![1]!.reasons).toContain("Narration names the lender");
        expect(matches.get(2)![2]!.reasons).toContain("4 days after the due date");
        // 8,291 (no tolerance), 15 days late, a credit and another account are never offered.
        expect(matches.get(3)).toEqual([]);
    });

    it("never offers a transaction excluded by the setup", () => {
        const matches = matchHistoricalEmiDebits(SCHEDULE.slice(0, 1), CANDIDATES, { ...MATCH, excludeIds: ["mar-on-time"] });
        expect(matches.get(1)).toEqual([]);
    });

    it("suggests one debit per instalment and never the same debit twice", () => {
        const same = [debit("only", "2026-03-31")];
        const schedule = [row(1, "2026-03-27"), row(2, "2026-04-03")];
        const matches = matchHistoricalEmiDebits(schedule, same, MATCH);

        expect(matches.get(1)!.map(c => c.transaction.id)).toEqual(["only"]);
        expect(matches.get(2)!.map(c => c.transaction.id)).toEqual(["only"]);

        const suggestions = suggestHistoricalLinks(matches);
        expect([...suggestions.entries()].map(([n, c]) => [n, c.transaction.id])).toEqual([[1, "only"]]);
        // Already chosen elsewhere: not suggested again.
        expect(suggestHistoricalLinks(matches, ["only"]).size).toBe(0);
    });
});
