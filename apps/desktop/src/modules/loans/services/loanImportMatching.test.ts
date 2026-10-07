import { describe, expect, it } from "vitest";

import { describeLoanImportPayments } from "@/modules/imports/pages/importLoanPaymentMessage";

import type { Loan, LoanPaymentSchedule } from "../types";
import { LoanPaymentStatus } from "../types/LoanPaymentStatus";
import {
    decideLoanPaymentForTransaction,
    sameSignature,
    transactionIdentifiesLoan,
    type LoanMatchState,
    type LoanMatchTransaction,
} from "./loanImportMatching";

function state(name: string, lenderName: string | null, overrides: Partial<Loan> = {}): LoanMatchState {
    const schedule: LoanPaymentSchedule[] = [1, 2].map(n => ({
        id: `sch-${n}`, loanId: "loan-1", installmentNumber: n, dueDate: `2026-0${n + 1}-05`,
        principalAmount: 800, interestAmount: 200, totalAmount: 1000, outstandingPrincipal: 0,
        status: LoanPaymentStatus.UPCOMING, paidDate: null, paidAmount: null, transactionId: null,
    }));

    return {
        loan: { id: "loan-1", name, accountId: "bank", status: "ACTIVE", ...overrides } as Loan,
        lenderName,
        schedule,
        payments: [],
    };
}

function debit(text: Partial<LoanMatchTransaction>): LoanMatchTransaction {
    return { id: "t", accountId: "bank", type: "expense", amount: 1000, transactionDate: "2026-02-05", payee: "", ...text };
}

describe("transactionIdentifiesLoan", () => {
    it("needs every distinctive word of the loan's or lender's name", () => {
        const loan = state("Home Loan", "Aster Housing Finance");

        expect(transactionIdentifiesLoan(debit({ payee: "Aster Housing Finance Ltd" }), loan)).toBe(true);
        expect(transactionIdentifiesLoan(debit({ originalNarration: "NACH/ASTERHFL/0042" }), loan)).toBe(true);
        expect(transactionIdentifiesLoan(debit({ payee: "Housing Finance Co" }), loan)).toBe(false);
    });

    it("a loan named only with generic words, and no lender, never matches by name", () => {
        const loan = state("Home Loan", null);

        expect(transactionIdentifiesLoan(debit({ payee: "Home Loan EMI" }), loan)).toBe(false);
    });

    it("a short word must be a whole word, not part of another", () => {
        const loan = state("HL", "BOB");

        expect(transactionIdentifiesLoan(debit({ originalNarration: "UPI BOBBY STORES" }), loan)).toBe(false);
        expect(transactionIdentifiesLoan(debit({ originalNarration: "NACH BOB LOAN 123" }), loan)).toBe(true);
    });
});

describe("decideLoanPaymentForTransaction", () => {
    it("ignores a closed loan and a loan paid from another account", () => {
        expect(decideLoanPaymentForTransaction(debit({ payee: "Aster" }), [state("Aster", null, { status: "CLOSED" })])).toEqual({ kind: "none" });
        expect(decideLoanPaymentForTransaction(debit({ payee: "Aster" }), [state("Aster", null, { accountId: "other" })])).toEqual({ kind: "none" });
    });

    it("pays the earliest unpaid instalment, never a later one past a partly paid one", () => {
        const loan = state("Aster", null);
        loan.schedule[0]!.status = LoanPaymentStatus.PARTIAL;
        loan.payments = [{
            id: "p", loanId: "loan-1", scheduleId: "sch-1", transactionId: "x", paymentDate: "2026-02-01",
            amount: 600, principalAmount: 400, interestAmount: 200, createdAt: "", transactionLinked: true, settlesInstallment: false,
            transaction: null,
        }];

        expect(decideLoanPaymentForTransaction(debit({ payee: "Aster", amount: 400 }), [loan]))
            .toMatchObject({ kind: "apply", scheduleId: "sch-1", fullyPaysInstallment: true });
        expect(decideLoanPaymentForTransaction(debit({ payee: "Aster", amount: 1000 }), [loan]))
            .toMatchObject({ kind: "review", reason: expect.stringContaining("400.00 remaining") });
    });
});

// The lender's real debit (1,51,167) vs the calculated EMI (1,51,167.39),
// with a narration that does not name the loan or the lender.
const EMI = 151167.39;
const DEBIT = 151167;

function lenderLoan(id = "loan-1", name = "Northwind Capital"): LoanMatchState {
    const schedule: LoanPaymentSchedule[] = [1, 2, 3, 4, 5].map(n => ({
        id: `${id}-sch-${n}`, loanId: id, installmentNumber: n, dueDate: `2026-0${n + 4}-05`,
        principalAmount: 29000, interestAmount: EMI - 29000, totalAmount: EMI, outstandingPrincipal: 0,
        status: LoanPaymentStatus.UPCOMING, paidDate: null, paidAmount: null, transactionId: null,
    }));

    return {
        loan: { id, name, accountId: "bank", status: "ACTIVE" } as Loan,
        lenderName: name,
        schedule,
        payments: [],
    };
}

function achDebit(date: string, reference: string, overrides: Partial<LoanMatchTransaction> = {}): LoanMatchTransaction {
    return {
        id: `t-${date}`, accountId: "bank", type: "expense", amount: DEBIT, transactionDate: date,
        payee: "NW Finance (Term)", transactionType: "EMANDATE",
        originalNarration: `ACH-DR-TP ACH NWCAPFINL-${reference}-UTIB001504`, ...overrides,
    };
}

// What a hand link (or an earlier automatic match) leaves in the ledger.
function linkTo(state: LoanMatchState, n: number, transaction: LoanMatchTransaction, settles: boolean): void {
    const schedule = state.schedule[n - 1]!;
    schedule.status = settles || transaction.amount >= schedule.totalAmount ? LoanPaymentStatus.PAID : LoanPaymentStatus.PARTIAL;
    schedule.paidAmount = transaction.amount;
    state.payments.push({
        id: `pay-${n}`, loanId: state.loan.id, scheduleId: schedule.id, transactionId: transaction.id,
        paymentDate: transaction.transactionDate, amount: transaction.amount, principalAmount: 0, interestAmount: 0,
        createdAt: "", transactionLinked: true, settlesInstallment: settles,
        transaction: { ...transaction, isImported: true },
    });
}

describe("learned loan association (from linked transactions)", () => {
    it("before any link, a narration that does not name the loan is not matched", () => {
        const loan = lenderLoan();
        expect(decideLoanPaymentForTransaction(achDebit("2026-06-05", "2227538664", { payee: "" }), [loan]))
            .toEqual({ kind: "none" });
    });

    it("first debit linked by hand as the lender's full instalment -> the next ones settle the same way automatically", () => {
        const loan = lenderLoan();
        linkTo(loan, 1, achDebit("2026-05-05", "2195056320"), true);

        const next = decideLoanPaymentForTransaction(achDebit("2026-06-05", "2260466417", { payee: "" }), [loan]);
        expect(next).toEqual({
            kind: "apply", loanId: "loan-1", scheduleId: "loan-1-sch-2", installmentNumber: 2,
            amount: DEBIT, fullyPaysInstallment: true, settlesInstallment: true,
        });

        linkTo(loan, 2, achDebit("2026-06-05", "2260466417"), true);
        expect(decideLoanPaymentForTransaction(achDebit("2026-07-05", "2293071249"), [loan]))
            .toMatchObject({ kind: "apply", installmentNumber: 3, settlesInstallment: true });
    });

    it("a link made as a PARTIAL payment teaches the loan, never a settlement", () => {
        const loan = lenderLoan();
        linkTo(loan, 1, achDebit("2026-05-05", "1"), false);

        // The next debit is identified, but 1,51,167 is not the 0.39 left on
        // instalment 1, so the user decides.
        expect(decideLoanPaymentForTransaction(achDebit("2026-06-05", "2"), [loan]))
            .toMatchObject({ kind: "review", loanIds: ["loan-1"] });
    });

    it("never assumes a small difference is rounding: without a settlement the user made, it is left for review", () => {
        const loan = lenderLoan();
        linkTo(loan, 1, achDebit("2026-05-05", "1", { amount: EMI }), false);

        expect(decideLoanPaymentForTransaction(achDebit("2026-06-05", "2"), [loan]))
            .toMatchObject({ kind: "review", reason: expect.stringContaining("1,51,167.00, not the 1,51,167.39") });
    });

    it("a settlement is only repeated for the same amount, against an instalment of the same scheduled amount", () => {
        const loan = lenderLoan();
        linkTo(loan, 1, achDebit("2026-05-05", "1"), true);

        expect(decideLoanPaymentForTransaction(achDebit("2026-06-05", "2", { amount: 151100 }), [loan]))
            .toMatchObject({ kind: "review" });

        loan.schedule[1]!.totalAmount = 151180.12; // e.g. a changed rate or an adjusted EMI
        expect(decideLoanPaymentForTransaction(achDebit("2026-06-05", "2"), [loan]))
            .toMatchObject({ kind: "review" });
    });

    it("the amount alone never identifies the loan - another narration pattern is not the learned payment", () => {
        const loan = lenderLoan();
        linkTo(loan, 1, achDebit("2026-05-05", "1"), true);

        expect(decideLoanPaymentForTransaction(
            achDebit("2026-06-05", "2", { payee: "", originalNarration: "UPI/123456/SOMEONE ELSE/OKAXIS" }), [loan]
        )).toEqual({ kind: "none" });
    });

    it("a conflicting account, direction, payment type, payee or counterparty breaks the learned signature", () => {
        const loan = lenderLoan();
        linkTo(loan, 1, achDebit("2026-05-05", "1", { counterparty: "NW Finance" }), true);
        const learned = loan.payments[0]!.transaction!;
        const next = achDebit("2026-06-05", "2");

        expect(sameSignature(next, learned)).toBe(true);
        expect(sameSignature({ ...next, accountId: "other" }, learned)).toBe(false);
        expect(sameSignature({ ...next, type: "income" }, learned)).toBe(false);
        expect(sameSignature({ ...next, transactionType: "NEFT" }, learned)).toBe(false);
        expect(sameSignature({ ...next, payee: "Someone Else" }, learned)).toBe(false);
        expect(sameSignature({ ...next, counterparty: "Another Lender" }, learned)).toBe(false);
        // Missing on one side is no evidence either way.
        expect(sameSignature({ ...next, payee: "", transactionType: null }, learned)).toBe(true);
    });

    it("two loans that both learned the same pattern -> review, never a guess", () => {
        const first = lenderLoan("loan-1", "Loan One");
        const second = lenderLoan("loan-2", "Loan Two");
        linkTo(first, 1, achDebit("2026-05-05", "1"), true);
        linkTo(second, 1, achDebit("2026-05-06", "2"), true);

        expect(decideLoanPaymentForTransaction(achDebit("2026-06-05", "3", { payee: "" }), [first, second]))
            .toMatchObject({ kind: "review", loanIds: ["loan-1", "loan-2"] });
    });

    it("never skips an earlier unpaid EMI: a later month's debit goes to review naming the earlier EMI", () => {
        const loan = lenderLoan();
        linkTo(loan, 1, achDebit("2026-05-05", "1"), true);

        // EMI #2 (due 2026-06-05) is still unpaid - its debit and the
        // following ones were never linked - and this is September's debit,
        // which is for EMI #5.
        expect(decideLoanPaymentForTransaction(achDebit("2026-09-05", "4"), [loan])).toEqual({
            kind: "review",
            loanIds: ["loan-1"],
            reason: "Earlier EMI #2 (due 2026-06-05) is still unpaid and must be reviewed before this payment can be automatically matched to EMI #5.",
        });
    });

    it("the very next month is no exception: one unpaid EMI in between is enough to stop it", () => {
        const loan = lenderLoan();
        linkTo(loan, 1, achDebit("2026-05-05", "1"), true);

        // July's debit is for EMI #3, but EMI #2 (June) was never paid.
        expect(decideLoanPaymentForTransaction(achDebit("2026-07-05", "3"), [loan]))
            .toMatchObject({ kind: "review", reason: expect.stringContaining("Earlier EMI #2") });
    });

    it("a PARTIAL earlier EMI also blocks the next month's debit", () => {
        const loan = lenderLoan();
        linkTo(loan, 1, achDebit("2026-05-05", "1"), false); // 0.39 still due on #1

        expect(decideLoanPaymentForTransaction(achDebit("2026-06-05", "2", { amount: EMI }), [loan]))
            .toMatchObject({ kind: "review", reason: expect.stringContaining("Earlier EMI #1") });
    });

    it("the debit for the earliest unpaid EMI is matched, a few days early or late", () => {
        const loan = lenderLoan();
        linkTo(loan, 1, achDebit("2026-05-05", "1"), true);

        for (const date of ["2026-06-01", "2026-06-05", "2026-06-12"]) {
            expect(decideLoanPaymentForTransaction(achDebit(date, "2"), [loan]))
                .toMatchObject({ kind: "apply", installmentNumber: 2 });
        }
    });

    it("a debit nearest an EMI that is already paid is not pushed onto the next one", () => {
        const loan = lenderLoan();
        linkTo(loan, 1, achDebit("2026-05-05", "1"), true);

        expect(decideLoanPaymentForTransaction(achDebit("2026-05-08", "9001"), [loan]))
            .toMatchObject({ kind: "review", reason: expect.stringContaining("EMI #1, due on 2026-05-05, is already paid") });
    });

    it("a debit with no EMI due anywhere near it goes to review", () => {
        const loan = lenderLoan(); // EMIs due 2026-05-05 .. 2026-09-05
        linkTo(loan, 1, achDebit("2026-05-05", "1"), true);

        expect(decideLoanPaymentForTransaction(achDebit("2027-03-05", "9002"), [loan]))
            .toMatchObject({ kind: "review", reason: expect.stringContaining("No EMI of this loan is due around this date") });
    });
});

describe("describeLoanImportPayments", () => {
    it("says nothing when the import had no loan payments", () => {
        expect(describeLoanImportPayments(undefined)).toBe("");
        expect(describeLoanImportPayments({ applied: [], needsReview: [] })).toBe("");
    });

    it("lists what was applied and what was left for checking", () => {
        const text = describeLoanImportPayments({
            applied: [{ transactionId: "t1", loanId: "l", loanName: "Aster", installmentNumber: 2, amount: 1000, installmentStatus: "PAID" }],
            needsReview: [{ transactionId: "t2", transactionDate: "2026-03-05", amount: 151167, loanNames: ["Aster"], reason: "Too much." }],
        });

        expect(text).toContain("1 loan EMI payment was applied automatically (Aster instalment 2).");
        expect(text).toContain("1 loan payment needs your attention.");
        expect(text).not.toContain("Too much.");
    });
});
