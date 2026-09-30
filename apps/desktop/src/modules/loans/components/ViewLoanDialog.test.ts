import { describe, expect, it } from "vitest";

import { buildLoanViewModel } from "./ViewLoanDialog";
import type { Loan } from "../types";

// This repo has no jsdom / component-render test setup (vitest runs
// with environment: "node") - see DeletePlanComponentDialog.test.ts for
// the same convention - so the View Loan dialog's field-by-field
// display logic is exercised through the exported pure function
// (buildLoanViewModel) instead of rendering the dialog and clicking
// through it. Rendering/interaction requirements (View button present,
// clicking it opens the dialog, Close works, Edit/EMI Schedule/Delete
// unaffected) are verified by inspection of LoansPage.tsx's JSX (the
// View button and <ViewLoanDialog> are additive - the Edit/EMI
// Schedule/Delete buttons and their handlers are untouched) rather than
// by an executable test, for the same reason.

function loan(overrides: Partial<Loan> = {}): Loan {
    return {
        id: "loan-1",
        accountId: "bank-1",
        loanAccountId: "loan-acct-1",
        lenderInstitutionId: "inst-1",
        loanType: "Home Loan",
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
        currencyId: "cur-inr",
        status: "ACTIVE",
        notes: "Refinanced from a prior lender.",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

const formatMoney = (value: number) => `₹${value.toFixed(2)}`;
const formatDate = (value: string) => `[${value}]`;

function resolved(
    overrides: Partial<
        Parameters<typeof buildLoanViewModel>[1]
    > = {}
) {
    return {
        lenderName: "HDFC Bank",
        linkedAccountName: "Salary Account",
        currencyLabel: "INR — Indian Rupee",
        formatMoney,
        formatDate,
        emiSummary: null,
        ...overrides,
    };
}

function findField(
    fields: { label: string; value: string }[],
    label: string
): string | undefined {
    return fields.find(field => field.label === label)
        ?.value;
}

describe("buildLoanViewModel - Basic Information", () => {
    it("3. displays loan name, type, lender, currency and linked account", () => {
        const model = buildLoanViewModel(
            loan(),
            resolved()
        );

        expect(
            findField(model.basicInformation, "Loan Name")
        ).toBe("HDFC Home Loan");
        expect(
            findField(model.basicInformation, "Loan Type")
        ).toBe("Home Loan");
        expect(
            findField(model.basicInformation, "Lender")
        ).toBe("HDFC Bank");
        expect(
            findField(model.basicInformation, "Currency")
        ).toBe("INR — Indian Rupee");
        expect(
            findField(
                model.basicInformation,
                "Linked Account"
            )
        ).toBe("Salary Account");
    });

    it("shows a dash placeholder when lender/linked account cannot be resolved", () => {
        const model = buildLoanViewModel(
            loan({
                lenderInstitutionId: null,
                accountId: null,
            }),
            resolved({
                lenderName: "",
                linkedAccountName: "",
            })
        );

        expect(
            findField(model.basicInformation, "Lender")
        ).toBe("—");
        expect(
            findField(
                model.basicInformation,
                "Linked Account"
            )
        ).toBe("—");
    });
});

describe("buildLoanViewModel - Loan Terms", () => {
    it("3. displays principal, rate, interest type, tenure, dates, EMI and paid installments", () => {
        const model = buildLoanViewModel(
            loan(),
            resolved()
        );

        expect(
            findField(model.loanTerms, "Principal Amount")
        ).toBe("₹500000.00");
        expect(
            findField(model.loanTerms, "Interest Rate")
        ).toBe("8.50%");
        expect(
            findField(model.loanTerms, "Interest Type")
        ).toBe("Reducing Balance");
        expect(
            findField(model.loanTerms, "Tenure")
        ).toBe("24 months");
        expect(
            findField(model.loanTerms, "Start Date")
        ).toBe("[2026-01-01]");
        expect(
            findField(model.loanTerms, "Maturity Date")
        ).toBe("[2028-01-01]");
        expect(
            findField(model.loanTerms, "EMI Amount")
        ).toBe("₹22650.50");
        expect(
            findField(
                model.loanTerms,
                "Number of Paid Installments"
            )
        ).toBe("2");
    });

    it("labels a FLAT interest loan correctly", () => {
        const model = buildLoanViewModel(
            loan({ interestType: "FLAT" }),
            resolved()
        );

        expect(
            findField(model.loanTerms, "Interest Type")
        ).toBe("Flat Rate");
    });

    it("shows a dash for tenure, maturity date and EMI amount when not set", () => {
        const model = buildLoanViewModel(
            loan({
                tenureMonths: null,
                maturityDate: null,
                emiAmount: null,
            }),
            resolved()
        );

        expect(
            findField(model.loanTerms, "Tenure")
        ).toBe("—");
        expect(
            findField(model.loanTerms, "Maturity Date")
        ).toBe("—");
        expect(
            findField(model.loanTerms, "EMI Amount")
        ).toBe("—");
    });
});

describe("buildLoanViewModel - Outstanding Balance, Status and Notes", () => {
    it("3. displays outstanding principal and interest", () => {
        const model = buildLoanViewModel(
            loan(),
            resolved()
        );

        expect(
            findField(
                model.outstandingBalance,
                "Outstanding Principal"
            )
        ).toBe("₹480000.00");
        expect(
            findField(
                model.outstandingBalance,
                "Outstanding Interest"
            )
        ).toBe("₹12500.00");
    });

    it("3. title-cases the loan status", () => {
        expect(
            buildLoanViewModel(
                loan({ status: "ON_HOLD" }),
                resolved()
            ).statusLabel
        ).toBe("On Hold");

        expect(
            buildLoanViewModel(
                loan({ status: "ACTIVE" }),
                resolved()
            ).statusLabel
        ).toBe("Active");
    });

    it("3. displays notes, falling back to a dash when empty", () => {
        expect(
            buildLoanViewModel(loan(), resolved()).notes
        ).toBe("Refinanced from a prior lender.");

        expect(
            buildLoanViewModel(
                loan({ notes: undefined }),
                resolved()
            ).notes
        ).toBe("—");
    });
});

describe("buildLoanViewModel - EMI summary", () => {
    it("3. surfaces total remaining EMI, next EMI date and amount when a summary is available", () => {
        const model = buildLoanViewModel(
            loan(),
            resolved({
                emiSummary: {
                    totalRemainingEmi: 452000,
                    nextEmi: {
                        dueDate: "2026-03-01",
                        totalAmount: 22650.5,
                    },
                },
            })
        );

        expect(model.emiSummary).not.toBeNull();
        expect(
            findField(
                model.emiSummary ?? [],
                "Total Remaining EMI"
            )
        ).toBe("₹452000.00");
        expect(
            findField(
                model.emiSummary ?? [],
                "Next EMI Date"
            )
        ).toBe("[2026-03-01]");
        expect(
            findField(
                model.emiSummary ?? [],
                "Next EMI Amount"
            )
        ).toBe("₹22650.50");
    });

    it("omits the EMI summary section entirely when no summary is available (e.g. a non-ACTIVE loan)", () => {
        const model = buildLoanViewModel(
            loan({ status: "CLOSED" }),
            resolved({ emiSummary: null })
        );

        expect(model.emiSummary).toBeNull();
    });

    it("shows a dash for next EMI date/amount when there are no upcoming installments left", () => {
        const model = buildLoanViewModel(
            loan(),
            resolved({
                emiSummary: {
                    totalRemainingEmi: 0,
                    nextEmi: null,
                },
            })
        );

        expect(
            findField(
                model.emiSummary ?? [],
                "Next EMI Date"
            )
        ).toBe("—");
        expect(
            findField(
                model.emiSummary ?? [],
                "Next EMI Amount"
            )
        ).toBe("—");
    });
});

// 4. The view model is pure, label/value display data only - it has
// no concept of a submit handler, a save action or a mutable field, so
// there is nothing here that could accidentally expose editable
// controls. This is the strongest guarantee this test file can give
// that requirement without a component-render setup: the data this
// dialog renders from cannot carry an editable-control affordance.
describe("buildLoanViewModel - read-only by construction", () => {
    it("every field is a plain label/value string pair, never a control descriptor", () => {
        const model = buildLoanViewModel(
            loan(),
            resolved({
                emiSummary: {
                    totalRemainingEmi: 100,
                    nextEmi: {
                        dueDate: "2026-03-01",
                        totalAmount: 50,
                    },
                },
            })
        );

        const allFields = [
            ...model.basicInformation,
            ...model.loanTerms,
            ...model.outstandingBalance,
            ...(model.emiSummary ?? []),
        ];

        for (const field of allFields) {
            expect(typeof field.label).toBe("string");
            expect(typeof field.value).toBe("string");
        }
    });
});
