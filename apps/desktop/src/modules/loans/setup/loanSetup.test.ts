import { describe, expect, it } from "vitest";

import { EMIScheduleGenerator } from "../services/EMIScheduleGenerator";
import { LoanKind } from "../types/LoanKind";
import {
    buildAccountingEntries,
    disbursementNet,
    expenseAmounts,
    gstAmountFor,
    linkedTransactionCategoryWarning,
    linkedTransactionRefusal,
    summarizeSetup,
    validateSetupDetails,
} from "./loanSetupAccounting";
import {
    checkLenderScheduleRows,
    compareWithEstimate,
    parseLenderScheduleCsv,
    validateLenderSchedule,
} from "./lenderSchedule";
import {
    draftToCreateRequest,
    draftToDetails,
    duplicateLoanIssues,
    emptyLoanSetupDraft,
    generatedSchedulePreview,
    newDisbursementDraft,
    newExpenseDraft,
    schedulePreview,
    stepsFor,
    suggestedFirstEmiDate,
    validateStep,
} from "./loanSetupWizard";
import type {
    InitialExpenseDetails,
    LinkedTransactionSummary,
    LoanDisbursementDetails,
    LoanSetupDraft,
} from "./loanSetupTypes";

const generator = new EMIScheduleGenerator();

function credit(overrides: Partial<LinkedTransactionSummary> = {}): LinkedTransactionSummary {
    return {
        id: "txn-credit",
        date: "2026-02-12",
        amount: 712_182,
        accountId: "bank",
        accountName: "Netedge 3999",
        side: "IN",
        payee: "TATA CAPITAL",
        narration: "NEFT/TATA CAPITAL LIMITED",
        categoryName: "Loan Principal Drawdown",
        categoryType: "TRANSFER",
        ...overrides,
    };
}

function disbursement(overrides: Partial<LoanDisbursementDetails> = {}): LoanDisbursementDetails {
    return {
        date: "2026-02-12",
        grossAmount: 750_000,
        deductionsAmount: 37_818,
        netAmount: 712_182,
        destinationAccountId: "bank",
        reference: null,
        transactionId: null,
        ...overrides,
    };
}

function expense(overrides: Partial<InitialExpenseDetails> = {}): InitialExpenseDetails {
    return {
        expenseType: "PROCESSING_FEE",
        description: null,
        expenseDate: "2026-02-12",
        baseAmount: 32_049.15,
        gstRate: 18,
        gstAmount: 5_768.85,
        totalAmount: 37_818,
        settlement: "DEDUCTED_FROM_DISBURSEMENT",
        disbursementIndex: 0,
        paymentMethod: null,
        paymentAccountId: null,
        transactionReference: null,
        transactionId: null,
        ...overrides,
    };
}

const TERM = { loanKind: LoanKind.TERM_LOAN, sanctionedAmount: 750_000, sanctionDate: null };

// ------------------------------------------------------------ accounting

describe("GST and initial expense amounts", () => {
    it("calculates GST at the rate, to the paisa, and the total as base + GST", () => {
        expect(gstAmountFor(9_000, 18)).toBe(1_620);
        expect(gstAmountFor(32_049.15, 18)).toBe(5_768.85);
        expect(expenseAmounts({ baseAmount: 9_000, gstRate: 18, gstAmount: null })).toEqual({ base: 9_000, gst: 1_620, total: 10_620 });
    });

    it("uses a typed GST amount when no rate is given, and 0 GST when neither is", () => {
        expect(expenseAmounts({ baseAmount: 5_000, gstRate: null, gstAmount: 412.5 })).toEqual({ base: 5_000, gst: 412.5, total: 5_412.5 });
        expect(expenseAmounts({ baseAmount: 590, gstRate: null, gstAmount: null })).toEqual({ base: 590, gst: 0, total: 590 });
    });
});

describe("disbursement accounting", () => {
    it("net received = gross - lender deductions; liability stays the gross amount", () => {
        expect(disbursementNet(750_000, 37_818)).toBe(712_182);

        const totals = summarizeSetup({ disbursements: [disbursement()], expenses: [expense()] });
        expect(totals).toMatchObject({ grossDisbursed: 750_000, totalDeductions: 37_818, netReceived: 712_182, expensesDeducted: 37_818, expensesPaidSeparately: 0 });
    });

    it("accepts a single disbursement whose deductions are fully itemised", () => {
        expect(validateSetupDetails({ disbursements: [disbursement()], expenses: [expense()] }, TERM)).toEqual([]);
    });

    it("refuses deductions that are not itemised as deducted expenses", () => {
        const issues = validateSetupDetails({ disbursements: [disbursement()], expenses: [] }, TERM);
        expect(issues.map(i => i.message).join(" ")).toMatch(/deducted 37,818.00\. Add those charges/);
    });

    it("refuses deducted expenses that do not match the deductions exactly - no tolerance", () => {
        const issues = validateSetupDetails(
            { disbursements: [disbursement()], expenses: [expense({ baseAmount: 32_049.14, gstAmount: 5_768.85, totalAmount: 37_817.99 })] },
            TERM
        );
        expect(issues.map(i => i.message).join(" ")).toMatch(/deductions are 37,818.00, but the expenses deducted from it total 37,817.99/);
    });

    it("supports multiple staged disbursements, each with its own deductions", () => {
        const stages = [
            disbursement({ date: "2026-02-12", grossAmount: 500_000, deductionsAmount: 11_800, netAmount: 488_200 }),
            disbursement({ date: "2026-04-10", grossAmount: 250_000, deductionsAmount: 0, netAmount: 250_000 }),
        ];
        const fee = expense({ baseAmount: 10_000, gstAmount: 1_800, totalAmount: 11_800, disbursementIndex: 0 });

        expect(validateSetupDetails({ disbursements: stages, expenses: [fee] }, TERM)).toEqual([]);
        expect(summarizeSetup({ disbursements: stages, expenses: [fee] })).toMatchObject({ grossDisbursed: 750_000, netReceived: 738_200, totalDeductions: 11_800 });

        // ...but never more than was sanctioned.
        const over = validateSetupDetails({ disbursements: [...stages, disbursement({ grossAmount: 1, deductionsAmount: 0, netAmount: 1 })], expenses: [fee] }, TERM);
        expect(over.map(i => i.message).join(" ")).toMatch(/more than the sanctioned amount/);
    });

    it("refuses a net amount that is not gross less deductions, and a disbursement before sanction", () => {
        const issues = validateSetupDetails(
            { disbursements: [disbursement({ netAmount: 712_183, date: "2026-01-01" })], expenses: [expense()] },
            { ...TERM, sanctionDate: "2026-02-01" }
        );
        const text = issues.map(i => i.message).join(" ");
        expect(text).toMatch(/net amount must be gross less deductions/);
        expect(text).toMatch(/before the sanction date/);
    });
});

describe("initial expenses - settlement rules", () => {
    it("allows several expenses, deducted and separately paid together", () => {
        const paid = expense({
            expenseType: "LEGAL_CHARGES",
            settlement: "PAID_SEPARATELY",
            disbursementIndex: null,
            baseAmount: 9_000,
            gstAmount: 1_620,
            totalAmount: 10_620,
            paymentAccountId: "bank",
            transactionId: "txn-fee",
        });
        const stamp = expense({ expenseType: "STAMP_DUTY", settlement: "PAID_SEPARATELY", disbursementIndex: null, baseAmount: 500, gstRate: null, gstAmount: 0, totalAmount: 500 });

        expect(validateSetupDetails({ disbursements: [disbursement()], expenses: [expense(), paid, stamp] }, TERM)).toEqual([]);
        expect(summarizeSetup({ disbursements: [disbursement()], expenses: [expense(), paid, stamp] })).toMatchObject({
            expensesTotal: 48_938,
            expensesDeducted: 37_818,
            expensesPaidSeparately: 11_120,
            gstTotal: 7_388.85,
        });
    });

    it("never links a deducted (or OD-charged) expense to a bank transaction", () => {
        const issues = validateSetupDetails({ disbursements: [disbursement()], expenses: [expense({ transactionId: "txn-fee" })] }, TERM);
        expect(issues.map(i => i.message).join(" ")).toMatch(/cannot be linked to a bank transaction/);
    });

    it("refuses the same bank transaction twice", () => {
        const one = expense({ settlement: "PAID_SEPARATELY", disbursementIndex: null, transactionId: "txn-fee", baseAmount: 100, gstRate: null, gstAmount: 0, totalAmount: 100 });
        const issues = validateSetupDetails({ disbursements: [], expenses: [one, { ...one }] }, { ...TERM, sanctionedAmount: null });
        expect(issues.map(i => i.message).join(" ")).toMatch(/same bank transaction is linked twice/);
    });

    it("an overdraft has no disbursement to deduct from; a term loan has no OD charge", () => {
        const od = validateSetupDetails(
            { disbursements: [], expenses: [expense({ disbursementIndex: null })] },
            { loanKind: LoanKind.OVERDRAFT, sanctionedAmount: null, sanctionDate: null }
        );
        expect(od.map(i => i.message).join(" ")).toMatch(/no disbursement to deduct from/);

        const term = validateSetupDetails(
            { disbursements: [], expenses: [expense({ settlement: "CHARGED_TO_LOAN_ACCOUNT", disbursementIndex: null })] },
            { ...TERM, sanctionedAmount: null }
        );
        expect(term.map(i => i.message).join(" ")).toMatch(/Deducted from disbursement/);
    });
});

describe("existing bank transaction linking", () => {
    it("accepts exactly the right account, direction and amount", () => {
        expect(linkedTransactionRefusal(credit(), { side: "IN", accountId: "bank", amount: 712_182, what: "disbursement 1" })).toBeNull();
    });

    it("refuses another account, the wrong direction, and a different amount (no tolerance)", () => {
        expect(linkedTransactionRefusal(credit({ accountId: "other" }), { side: "IN", accountId: "bank", amount: 712_182, what: "d" })).toMatch(/different bank account/);
        expect(linkedTransactionRefusal(credit({ side: "OUT" }), { side: "IN", accountId: "bank", amount: 712_182, what: "d" })).toMatch(/not money received/);
        expect(linkedTransactionRefusal(credit({ amount: 712_182.01 }), { side: "IN", accountId: "bank", amount: 712_182, what: "d" })).toMatch(/7,12,182.01, not 7,12,182.00/);
    });

    it("warns - never changes - when the disbursement credit is categorised as income", () => {
        expect(linkedTransactionCategoryWarning(credit({ categoryName: "Other Income", categoryType: "INCOME" }), "DISBURSEMENT", "disbursement 1")).toMatch(/count the loan money as income/);
        expect(linkedTransactionCategoryWarning(credit(), "DISBURSEMENT", "disbursement 1")).toBeNull();
    });
});

describe("accounting entry preview", () => {
    const names = (id: string | null) => (id === "bank" ? "Netedge 3999" : "No bank account");

    it("books the gross liability, the net bank receipt and the lender deductions in one balanced entry", () => {
        const entries = buildAccountingEntries({
            loanName: "TATA Capital Term",
            loanKind: LoanKind.TERM_LOAN,
            startDate: "2026-02-12",
            principalAmount: 750_000,
            openingUsed: null,
            openingUsedAsOf: null,
            disbursements: [disbursement({ transactionId: "txn-credit" })],
            expenses: [expense()],
            accountName: names,
            transactionLabel: () => "12/02/2026 7,12,182.00",
        });

        expect(entries).toHaveLength(1);
        const [entry] = entries;
        expect(entry!.lines).toEqual([
            { account: "Netedge 3999", debit: 712_182, credit: null },
            { account: "Loan expense - Processing Fee (incl. GST)", debit: 37_818, credit: null },
            { account: "TATA Capital Term - loan liability", debit: null, credit: 750_000 },
        ]);
        const debits = entry!.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
        const credits = entry!.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
        expect(debits).toBe(credits);
        expect(entry!.bankEffect).toMatch(/existing bank credit .* No new transaction is created/);
    });

    it("an OD's opening used balance is a liability with no bank transaction", () => {
        const entries = buildAccountingEntries({
            loanName: "TATA Capital (OD)",
            loanKind: LoanKind.OVERDRAFT,
            startDate: "2026-01-31",
            principalAmount: null,
            openingUsed: 6_150_000,
            openingUsedAsOf: "2026-02-28",
            disbursements: [],
            expenses: [expense({ settlement: "PAID_SEPARATELY", disbursementIndex: null, paymentAccountId: "bank" })],
            accountName: names,
            transactionLabel: id => id,
        });

        expect(entries[0]).toMatchObject({ date: "2026-02-28", title: "Opening used balance" });
        expect(entries[0]!.bankEffect).toMatch(/No bank transaction/);
        expect(entries[1]!.bankEffect).toMatch(/Not linked to a bank debit. No bank transaction is created/);
    });
});

// --------------------------------------------------- schedule generation

describe("schedule generation with the lender's actual first EMI date", () => {
    it("puts instalment 1 on the first EMI date - not one month after the start date", () => {
        const schedule = generator.generate({
            loanId: "l",
            principalAmount: 750_000,
            interestRate: 10.5,
            interestType: "REDUCING",
            tenureMonths: 180,
            startDate: "2026-02-05",
            firstEmiDate: "2026-03-05",
        });

        expect(schedule[0]).toMatchObject({ installmentNumber: 1, dueDate: "2026-03-05", interestAmount: 6_562.50, principalAmount: 1_727.99, totalAmount: 8_290.49 });
        expect(schedule[7]!.dueDate).toBe("2026-10-05");
        expect(schedule[7]!.outstandingPrincipal).toBe(735_745.23);
        expect(schedule).toHaveLength(180);
        expect(schedule[179]!.outstandingPrincipal).toBe(0);
    });

    it("splits every EMI into interest on the opening balance and principal", () => {
        const schedule = generator.generate({ loanId: "l", principalAmount: 100_000, interestRate: 12, interestType: "REDUCING", tenureMonths: 12, startDate: "2026-01-01", firstEmiDate: "2026-02-01" });
        let opening = 100_000;
        for (const row of schedule) {
            expect(row.interestAmount).toBe(Math.round(opening * 0.01 * 100) / 100);
            expect(Math.round((row.principalAmount + row.interestAmount) * 100) / 100).toBe(row.totalAmount);
            opening = row.outstandingPrincipal;
        }
        expect(opening).toBe(0);
    });

    it("keeps instalments on the payment day, clamped to short months", () => {
        const schedule = generator.generate({ loanId: "l", principalAmount: 50_000, interestRate: 9, interestType: "REDUCING", tenureMonths: 4, startDate: "2026-01-10", firstEmiDate: "2026-01-31", paymentDay: 31 });
        expect(schedule.map(row => row.dueDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    });

    it("refuses a first EMI date before the start date", () => {
        expect(() => generator.generate({ loanId: "l", principalAmount: 1_000, interestRate: 9, interestType: "REDUCING", tenureMonths: 2, startDate: "2026-03-05", firstEmiDate: "2026-03-01" })).toThrow(/before the loan start date/);
    });

    it("sizes the EMI to leave a balloon, which the last instalment clears", () => {
        const plain = generator.generate({ loanId: "l", principalAmount: 100_000, interestRate: 12, interestType: "REDUCING", tenureMonths: 12, startDate: "2026-01-01" });
        const balloon = generator.generate({ loanId: "l", principalAmount: 100_000, interestRate: 12, interestType: "REDUCING", tenureMonths: 12, startDate: "2026-01-01", balloonAmount: 20_000 });

        expect(balloon[0]!.totalAmount).toBeLessThan(plain[0]!.totalAmount);
        expect(balloon[10]!.outstandingPrincipal).toBeGreaterThan(20_000);
        expect(balloon[11]!.totalAmount).toBeGreaterThan(20_000);
        expect(balloon[11]!.outstandingPrincipal).toBe(0);
        expect(Math.round(balloon.reduce((s, r) => s + r.principalAmount, 0) * 100) / 100).toBe(100_000);
    });

    it("charges actual days / 365 from disbursement to the first EMI, then between due dates", () => {
        const schedule = generator.generate({
            loanId: "l",
            principalAmount: 100_000,
            interestRate: 12,
            interestType: "REDUCING",
            tenureMonths: 12,
            startDate: "2026-01-15",
            firstEmiDate: "2026-03-05",
            interestCalculationMethod: "ACTUAL_365",
        });

        // 15 Jan -> 5 Mar = 49 days; 5 Mar -> 5 Apr = 31 days.
        expect(schedule[0]!.interestAmount).toBe(1_610.96);
        expect(schedule[1]!.interestAmount).toBe(Math.round(schedule[0]!.outstandingPrincipal * 0.12 * 31 / 365 * 100) / 100);
        expect(schedule[11]!.outstandingPrincipal).toBe(0);
    });

    it("without the new options the schedule is exactly the legacy one", () => {
        const legacy = generator.generate({ loanId: "l", principalAmount: 10_000, interestRate: 12, interestType: "REDUCING", tenureMonths: 12, startDate: "2026-09-20" });
        expect(legacy[0]!.dueDate).toBe("2026-10-20");
        expect(legacy[0]!.totalAmount).toBe(888.49);
    });
});

// ------------------------------------------------------ lender CSV import

function scheduleCsv(rows: Array<Array<string | number>>, header = "Instalment No,Due Date,Opening Balance,EMI,Principal,Interest,Closing Balance"): string {
    return [header, ...rows.map(r => r.join(","))].join("\n");
}

const VALID_ROWS: Array<Array<string | number>> = [
    [1, "05/03/2026", "30000.00", "10200.00", "9900.00", "300.00", "20100.00"],
    [2, "05/04/2026", "20100.00", "10200.00", "9999.00", "201.00", "10101.00"],
    [3, "05/05/2026", "10101.00", "10202.01", "10101.00", "101.01", "0.00"],
];

function importCsv(csv: string, principalAmount: number | null = 30_000) {
    const parsed = parseLenderScheduleCsv(csv);
    return validateLenderSchedule(parsed.document, parsed.mapping, { principalAmount, startDate: "2026-02-05" });
}

describe("lender schedule CSV import", () => {
    it("imports a valid official schedule with the lender's figures unchanged", () => {
        const result = importCsv(scheduleCsv(VALID_ROWS));

        expect(result.errors).toEqual([]);
        expect(result.rows).toEqual([
            { installmentNumber: 1, dueDate: "2026-03-05", openingPrincipal: 30_000, principal: 9_900, interest: 300, emi: 10_200, closingPrincipal: 20_100 },
            { installmentNumber: 2, dueDate: "2026-04-05", openingPrincipal: 20_100, principal: 9_999, interest: 201, emi: 10_200, closingPrincipal: 10_101 },
            { installmentNumber: 3, dueDate: "2026-05-05", openingPrincipal: 10_101, principal: 10_101, interest: 101.01, emi: 10_202.01, closingPrincipal: 0 },
        ]);
        expect(result.summary).toMatchObject({ instalments: 3, totalPrincipal: 30_000, totalInterest: 602.01, regularEmi: 10_200, finalClosingPrincipal: 0 });
    });

    it("works without an opening column (opening = previous closing) and skips a totals row", () => {
        const csv = scheduleCsv(
            [...VALID_ROWS.map(r => [r[0], r[1], r[3], r[4], r[5], r[6]]), ["Total", "", "30602.01", "30000.00", "602.01", ""]],
            "Instalment No,Due Date,EMI,Principal,Interest,Closing Balance"
        );
        const result = importCsv(csv);

        expect(result.errors).toEqual([]);
        expect(result.rows!.map(r => r.openingPrincipal)).toEqual([30_000, 20_100, 10_101]);
        expect(result.warnings.map(w => w.message).join(" ")).toMatch(/totals row and was left out/);
    });

    it("rejects missing dates, duplicate instalments and invalid amounts", () => {
        const result = importCsv(
            scheduleCsv([
                [1, "", "30000.00", "10200.00", "9900.00", "300.00", "20100.00"],
                [1, "05/04/2026", "20100.00", "abc", "9999.00", "201.00", "10101.00"],
            ])
        );

        expect(result.rows).toBeNull();
        const text = result.errors.map(e => e.message).join(" | ");
        expect(text).toMatch(/due date is missing or not a valid date/);
        expect(text).toMatch(/instalment 1 appears twice/);
        expect(text).toMatch(/EMI is missing or not a number/);
    });

    it("rejects broken opening/closing continuity and EMI != principal + interest", () => {
        const broken = VALID_ROWS.map(r => [...r]);
        broken[1]![2] = "20000.00"; // opens below the previous closing
        broken[2]![3] = "10203.00"; // EMI does not equal principal + interest

        const text = importCsv(scheduleCsv(broken)).errors.map(e => e.message).join(" | ");
        expect(text).toMatch(/Instalment 2: opens at 20,000.00, but instalment 1 closed at 20,100.00/);
        expect(text).toMatch(/Instalment 3: principal 10,101.00 \+ interest 101.01 = 10,202.01, not the EMI 10,203.00/);
    });

    it("rejects a schedule that does not open at the loan principal or does not end at 0", () => {
        expect(importCsv(scheduleCsv(VALID_ROWS), 31_000).errors.map(e => e.message).join(" ")).toMatch(/opens at 30,000.00, but the loan principal is 31,000.00/);

        const unfinished = scheduleCsv(VALID_ROWS.slice(0, 2));
        expect(importCsv(unfinished, 30_000).errors.map(e => e.message).join(" ")).toMatch(/ends with 10,101.00 still outstanding/);
    });

    it("rejects a schedule with a required column it cannot find", () => {
        const result = importCsv("Instalment No,Due Date,EMI,Principal\n1,05/03/2026,100,90");
        expect(result.errors.map(e => e.field)).toEqual(expect.arrayContaining(["mapping.interest", "mapping.outstandingPrincipal"]));
    });

    it("re-checks rows on save, including a missing instalment number in the sequence", () => {
        const rows = importCsv(scheduleCsv(VALID_ROWS)).rows!;
        const gap = [rows[0]!, { ...rows[2]!, installmentNumber: 4 }];
        expect(checkLenderScheduleRows(gap, { principalAmount: 30_000, startDate: null }).errors.map(e => e.message).join(" ")).toMatch(/instalment 2 is missing/);
    });
});

describe("schedule reconciliation - lender vs FinWea estimate", () => {
    it("reports identical when the estimate reproduces the lender schedule", () => {
        const estimate = generator.generate({ loanId: "l", principalAmount: 10_000, interestRate: 12, interestType: "REDUCING", tenureMonths: 3, startDate: "2026-01-05", firstEmiDate: "2026-02-05" });
        const lender = estimate.map(row => ({
            installmentNumber: row.installmentNumber,
            dueDate: row.dueDate,
            openingPrincipal: 0,
            principal: row.principalAmount,
            interest: row.interestAmount,
            emi: row.totalAmount,
            closingPrincipal: row.outstandingPrincipal,
        }));
        expect(compareWithEstimate(lender, estimate)).toMatchObject({ identical: true, explanations: [] });
    });

    it("explains a rounded-up EMI and the interest it changes", () => {
        const estimate = generator.generate({ loanId: "l", principalAmount: 750_000, interestRate: 10.5, interestType: "REDUCING", tenureMonths: 180, startDate: "2026-02-05", firstEmiDate: "2026-03-05" });
        const lenderSchedule = generator.generate({ loanId: "l", principalAmount: 750_000, interestRate: 10.5, interestType: "REDUCING", tenureMonths: 180, startDate: "2026-02-05", firstEmiDate: "2026-03-05", emiAmount: 8_291 });
        const lender = lenderSchedule.map(row => ({ installmentNumber: row.installmentNumber, dueDate: row.dueDate, openingPrincipal: 0, principal: row.principalAmount, interest: row.interestAmount, emi: row.totalAmount, closingPrincipal: row.outstandingPrincipal }));

        const comparison = compareWithEstimate(lender, estimate);
        expect(comparison.identical).toBe(false);
        expect(comparison.lenderEmi).toBe(8_291);
        expect(comparison.estimateEmi).toBe(8_290.49);
        expect(comparison.explanations.join(" ")).toMatch(/lender's regular EMI is 8,291.00; the entered rate and tenure give 8,290.49/);
    });
});

// ---------------------------------------------------------------- wizard

function termDraft(): LoanSetupDraft {
    const draft = emptyLoanSetupDraft(LoanKind.TERM_LOAN, "INR");
    Object.assign(draft, {
        name: "TATA Capital Term",
        lenderName: "TATA Capital",
        loanAccountNumber: "TXLNA0999000000000017",
        loanCategory: "Term Loan",
        sanctionedAmount: 750_000,
        interestRate: 10.5,
        startDate: "2026-02-05",
        linkedAccountId: "bank",
        tenureMonths: 180,
        firstEmiDate: "2026-03-05",
    });
    return draft;
}

describe("Add Loan wizard", () => {
    it("adapts its steps to the loan type", () => {
        expect(stepsFor(LoanKind.TERM_LOAN)).toEqual(["basics", "disbursement", "expenses", "repayment", "schedule", "review"]);
        expect(stepsFor(LoanKind.OVERDRAFT)).toEqual(["basics", "overdraft", "expenses", "review"]);
    });

    it("requires the actual first EMI date and never assumes it equals the start date", () => {
        const draft = termDraft();
        draft.firstEmiDate = "";
        expect(validateStep(draft, "repayment").map(i => i.field)).toContain("firstEmiDate");
        expect(suggestedFirstEmiDate("2026-02-05", 0)).toBe("2026-03-05");
        expect(suggestedFirstEmiDate("2026-01-31", 2)).toBe("2026-04-30");
    });

    it("builds a term loan whose principal is the gross disbursed and whose first EMI is the entered date", () => {
        const draft = termDraft();
        draft.disbursements = [{ ...newDisbursementDraft(draft), grossAmount: 750_000, deductionsAmount: 37_818, date: "2026-02-05", transaction: credit({ date: "2026-02-05" }) }];
        draft.expenses = [{ ...newExpenseDraft(draft), baseAmount: 32_049.15, gstRate: 18 }];

        for (const step of stepsFor(LoanKind.TERM_LOAN)) {
            expect(validateStep(draft, step)).toEqual([]);
        }

        const request = draftToCreateRequest(draft);
        expect(request).toMatchObject({
            loanKind: LoanKind.TERM_LOAN,
            principalAmount: 750_000,
            tenureMonths: 180,
            emiAmount: 8_290.49,
            maturityDate: "2041-02-05",
            outstandingPrincipal: 750_000,
            loanAccountNumber: "TXLNA0999000000000017",
        });
        expect(request.setup).toMatchObject({
            firstEmiDate: "2026-03-05",
            scheduleSource: "GENERATED",
            interestCalculationMethod: "MONTHLY_RATE",
            disbursements: [{ grossAmount: 750_000, deductionsAmount: 37_818, netAmount: 712_182, transactionId: "txn-credit" }],
            expenses: [{ expenseType: "PROCESSING_FEE", totalAmount: 37_818, settlement: "DEDUCTED_FROM_DISBURSEMENT", disbursementIndex: 0 }],
        });
        expect(generatedSchedulePreview(draft).schedule[0]!.dueDate).toBe("2026-03-05");
    });

    it("blocks a linked credit that does not match the net amount", () => {
        const draft = termDraft();
        draft.disbursements = [{ ...newDisbursementDraft(draft), grossAmount: 750_000, deductionsAmount: 0, transaction: credit() }];
        expect(validateStep(draft, "disbursement").map(i => i.message).join(" ")).toMatch(/7,12,182.00, not 7,50,000.00/);
    });

    it("saves the imported lender schedule as the schedule, authoritative over the entered terms", () => {
        const draft = termDraft();
        draft.principalAmount = 30_000;
        draft.sanctionedAmount = 30_000;
        draft.tenureMonths = 3;
        draft.scheduleMethod = "LENDER_CSV";
        draft.lenderSchedule = { fileName: "tata.csv", rows: importCsv(scheduleCsv(VALID_ROWS)).rows! };

        expect(validateStep(draft, "schedule")).toEqual([]);
        const preview = schedulePreview(draft);
        expect(preview.schedule.map(r => [r.dueDate, r.totalAmount, r.openingPrincipal])).toEqual([
            ["2026-03-05", 10_200, 30_000],
            ["2026-04-05", 10_200, 20_100],
            ["2026-05-05", 10_202.01, 10_101],
        ]);

        const request = draftToCreateRequest(draft);
        expect(request).toMatchObject({ emiAmount: 10_200, tenureMonths: 3, maturityDate: "2026-05-05" });
        expect(request.setup).toMatchObject({ scheduleSource: "LENDER_CSV", firstEmiDate: "2026-03-05" });
        expect(request.setup!.lenderSchedule).toHaveLength(3);
    });

    it("builds an overdraft with drawing power and no EMI schedule", () => {
        const draft = emptyLoanSetupDraft(LoanKind.OVERDRAFT, "INR");
        Object.assign(draft, {
            name: "TATA Capital (OD)",
            loanAccountNumber: "0099000123",
            interestRate: 10.5,
            startDate: "2026-01-31",
            creditLimit: 12_500_000,
            drawingPower: 12_000_000,
            openingUsed: 6_150_000,
            openingUsedAsOf: "2026-02-28",
            odAccountIds: ["bank"],
        });

        for (const step of stepsFor(LoanKind.OVERDRAFT)) {
            expect(validateStep(draft, step)).toEqual([]);
        }

        const request = draftToCreateRequest(draft);
        expect(request).toMatchObject({ loanKind: LoanKind.OVERDRAFT, principalAmount: 0, tenureMonths: null, emiAmount: null, creditLimit: 12_500_000, openingUsed: 6_150_000 });
        expect(request.setup).toMatchObject({ drawingPower: 12_000_000, scheduleSource: null, firstEmiDate: null, disbursements: [] });
        expect(draftToDetails({ ...draft, drawingPower: 16_000_000 }).drawingPower).toBe(16_000_000);
        expect(validateStep({ ...draft, drawingPower: 16_000_000 }, "overdraft").map(i => i.message)).toContain("Drawing power cannot be more than the sanctioned limit.");
    });
});

describe("Add Loan - the same Term Loan twice", () => {
    const existing = [
        { name: "Synthetic LAP", loanAccountNumber: "XLOAN0000000000000001" },
        { name: "Closed and deleted", loanAccountNumber: "XLOAN0000000000000009", deletedAt: "2026-10-01" },
    ];
    const draftWith = (loanAccountNumber: string, kind = LoanKind.TERM_LOAN) => ({ ...emptyLoanSetupDraft(kind), loanAccountNumber });

    it("flags a lender account number a live loan already has, ignoring case and spaces", () => {
        const issues = duplicateLoanIssues(draftWith("  xloan0000000000000001 "), existing);

        expect(issues).toHaveLength(1);
        expect(issues[0]!.field).toBe("loanAccountNumber");
        expect(issues[0]!.message).toMatch(/already exists \("Synthetic LAP"\)/);
    });

    it("does not flag a deleted loan's number, a blank number, a new number or an Overdraft", () => {
        expect(duplicateLoanIssues(draftWith("XLOAN0000000000000009"), existing)).toEqual([]);
        expect(duplicateLoanIssues(draftWith(""), existing)).toEqual([]);
        expect(duplicateLoanIssues(draftWith("XLOAN0000000000000002"), existing)).toEqual([]);
        expect(duplicateLoanIssues(draftWith("XLOAN0000000000000001", LoanKind.OVERDRAFT), existing)).toEqual([]);
    });
});
