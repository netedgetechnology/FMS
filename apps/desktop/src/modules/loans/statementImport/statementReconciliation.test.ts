import { describe, expect, it } from "vitest";

import { LoanPaymentStatus, type LoanPaymentSchedule } from "../types";
import { compareWithStatement, type StatementFacts } from "./statementReconciliation";

// A synthetic 3-instalment loan of 30,000: 10,000 principal per instalment.
function schedule(): LoanPaymentSchedule[] {
    return [1, 2, 3].map(n => ({
        id: `s${n}`,
        loanId: "loan",
        installmentNumber: n,
        dueDate: `2026-0${n + 2}-05`,
        principalAmount: 10_000,
        interestAmount: 100,
        totalAmount: 10_100,
        outstandingPrincipal: 30_000 - n * 10_000,
        status: LoanPaymentStatus.UPCOMING,
        paidDate: null,
        paidAmount: null,
        transactionId: null,
    })) as LoanPaymentSchedule[];
}

const facts = (change: Partial<StatementFacts> = {}): StatementFacts => ({
    fileName: "s.pdf",
    asOf: "2026-04-30",
    grossDisbursed: 30_000,
    emiAmount: 10_100,
    instalmentsPaid: 2,
    principalRepaidTotal: 20_000,
    outstandingPrincipal: 10_000,
    ...change,
});

const byId = (checks: ReturnType<typeof compareWithStatement>) => Object.fromEntries(checks.map(check => [check.id, check]));

describe("statement position compared with the loan to be saved", () => {
    it("agrees on every figure when the schedule matches the lender", () => {
        const checks = compareWithStatement(facts(), { principal: 30_000, schedule: schedule(), resolved: 2 });

        expect(checks.map(check => [check.id, check.agrees])).toEqual([
            ["principal", true],
            ["emi", true],
            ["instalmentsDue", true],
            ["instalmentsResolved", true],
            ["principalRepaid", true],
            ["outstanding", true],
        ]);
        expect(checks.every(check => check.explanation === null)).toBe(true);
    });

    it("reports a principal, EMI and outstanding difference to the paisa, with no tolerance", () => {
        const checks = byId(compareWithStatement(facts({ grossDisbursed: 30_000.01, emiAmount: 10_100.01, outstandingPrincipal: 10_000.01 }), { principal: 30_000, schedule: schedule(), resolved: 2 }));

        expect(checks.principal!.agrees).toBe(false);
        expect(checks.emi!.agrees).toBe(false);
        expect(checks.emi!.explanation).toMatch(/exactly/);
        expect(checks.outstanding!.agrees).toBe(false);
        expect(checks.outstanding!.explanation).toMatch(/Neither figure is changed/);
    });

    it("explains a schedule running a month off the lender's", () => {
        const checks = byId(compareWithStatement(facts({ instalmentsPaid: 1 }), { principal: 30_000, schedule: schedule(), resolved: 1 }));

        expect(checks.instalmentsDue).toMatchObject({ statement: "1 paid", finwea: "2 due", agrees: false });
        expect(checks.instalmentsDue!.explanation).toMatch(/first EMI date/);
    });

    it("says how many paid instalments are left unrecorded rather than marking them paid", () => {
        const checks = byId(compareWithStatement(facts(), { principal: 30_000, schedule: schedule(), resolved: 0 }));

        expect(checks.instalmentsResolved!.agrees).toBe(false);
        expect(checks.instalmentsResolved!.explanation).toMatch(/^2 instalment\(s\) the statement shows paid are not linked/);
        // Historical instalments are resolved in the review's own section.
        expect(checks.instalmentsResolved!.explanation).toMatch(/under Instalments Paid Before FinWea/);
        expect(checks.instalmentsResolved!.explanation).not.toMatch(/ step/);

        const over = byId(compareWithStatement(facts(), { principal: 30_000, schedule: schedule(), resolved: 3 }));
        expect(over.instalmentsResolved!.explanation).toMatch(/under Instalments Paid Before FinWea/);
    });

    describe("advice follows where the schedule came from", () => {
        // Every figure the schedule drives differs from the statement.
        const differing = facts({ emiAmount: 10_100.01, instalmentsPaid: 1, principalRepaidTotal: 9_999, outstandingPrincipal: 20_001 });
        const differences = (scheduleSource?: "GENERATED" | "LENDER_CSV") =>
            compareWithStatement(differing, { principal: 30_000, schedule: schedule(), resolved: 1, scheduleSource }).filter(check => !check.agrees);

        it("with FinWea's generated schedule, suggests the lender's CSV schedule", () => {
            const checks = differences("GENERATED");

            expect(checks.map(check => check.id)).toEqual(["emi", "instalmentsDue", "principalRepaid", "outstanding"]);
            expect(byId(checks).emi!.explanation).toMatch(/import the lender's CSV schedule/);
            expect(byId(checks).principalRepaid!.explanation).toMatch(/Importing the lender's CSV schedule/);
            expect(byId(checks).outstanding!.explanation).toMatch(/import the lender's CSV schedule/);
            // Unchanged default: no source given is the generated schedule.
            expect(differences()).toEqual(checks);
        });

        it("with the lender's CSV already imported, never suggests importing it again", () => {
            const checks = differences("LENDER_CSV");

            expect(checks.map(check => check.id)).toEqual(["emi", "instalmentsDue", "principalRepaid", "outstanding"]);
            for (const check of checks) {
                expect(check.explanation).not.toMatch(/import/i);
                expect(check.explanation).toMatch(/lender's CSV schedule/);
            }
            expect(byId(checks).emi!.explanation).toMatch(/latest schedule/);
            expect(byId(checks).instalmentsDue!.explanation).toMatch(/latest version/);
            expect(byId(checks).principalRepaid!.explanation).toMatch(/Neither figure is changed/);
            expect(byId(checks).outstanding!.explanation).toMatch(/differs from the statement's by/);
        });

        it("the figures compared are the same whichever the source", () => {
            const strip = (scheduleSource: "GENERATED" | "LENDER_CSV") =>
                compareWithStatement(differing, { principal: 30_000, schedule: schedule(), resolved: 1, scheduleSource }).map(({ explanation: _e, ...rest }) => rest);

            expect(strip("LENDER_CSV")).toEqual(strip("GENERATED"));
        });
    });

    it("labels dates DD/MM/YYYY, as everywhere else in FinWea", () => {
        const checks = byId(compareWithStatement(facts(), { principal: 30_000, schedule: schedule(), resolved: 2 }));

        expect(checks.outstanding!.label).toBe("Outstanding principal as of 30/04/2026");
        expect(checks.instalmentsDue!.label).toBe("Instalments as of 30/04/2026");
        expect(checks.principalRepaid!.label).toBe("Principal repaid as of 30/04/2026");
    });

    it("with no statement date, compares the position after the instalments it counts paid", () => {
        const checks = byId(compareWithStatement(facts({ asOf: null }), { principal: 30_000, schedule: schedule(), resolved: 2 }));

        expect(checks.instalmentsDue).toBeUndefined();
        expect(checks.outstanding).toMatchObject({ label: "Outstanding principal after 2 instalment(s)", agrees: true });
    });

    it("compares only what the statement states", () => {
        const empty = facts({ grossDisbursed: null, emiAmount: null, instalmentsPaid: null, principalRepaidTotal: null, outstandingPrincipal: null, asOf: null });

        expect(compareWithStatement(empty, { principal: 30_000, schedule: schedule(), resolved: 0 })).toEqual([]);
    });
});
