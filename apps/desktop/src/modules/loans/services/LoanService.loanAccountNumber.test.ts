import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoanService } from "./LoanService";
import type { Loan, UpdateLoanRequest } from "../types";
import {
    loanSchema,
    normalizeLoanAccountNumber,
    overdraftRequestFromValues,
    overdraftSchema,
} from "../validation";

// ---------------------------------------------------------------------
// Loan Account Number (migration 050): trimmed text, null when blank,
// never a number - through the form schema, LoanService.create and
// LoanService.update. It is plain metadata: editable even after an EMI
// schedule exists.
// ---------------------------------------------------------------------

function loan(overrides: Partial<Loan> = {}): Loan {
    return {
        id: "loan-1",
        accountId: "bank-1",
        loanAccountId: "loan-acct-1",
        lenderInstitutionId: null,
        loanType: "Term Loan",
        name: "Tata Capital Term Loan",
        loanAccountNumber: "0099000123",
        principalAmount: 100000,
        interestRate: 10,
        interestType: "REDUCING",
        tenureMonths: 12,
        emiAmount: 8792,
        startDate: "2026-01-01",
        maturityDate: "2027-01-01",
        outstandingPrincipal: 100000,
        outstandingInterest: 5000,
        paidInstallments: 0,
        currencyId: "cur-inr",
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function updateRequest(overrides: Partial<UpdateLoanRequest> = {}): UpdateLoanRequest {
    return {
        id: "loan-1",
        accountId: "bank-1",
        loanType: "Term Loan",
        name: "Tata Capital Term Loan",
        principalAmount: 100000,
        interestRate: 10,
        interestType: "REDUCING",
        tenureMonths: 12,
        emiAmount: 8792,
        startDate: "2026-01-01",
        maturityDate: "2027-01-01",
        paidInstallments: 0,
        currencyId: "cur-inr",
        status: "ACTIVE",
        ...overrides,
    };
}

describe("normalizeLoanAccountNumber", () => {
    it.each([
        ["  0099000123  ", "0099000123"],
        ["XLNA0999000000000017", "XLNA0999000000000017"],
        ["TCFLA-0272/0001", "TCFLA-0272/0001"],
        ["", null],
        ["   ", null],
        [null, null],
        [undefined, null],
    ])("%j -> %j", (input, expected) => {
        expect(normalizeLoanAccountNumber(input)).toBe(expected);
    });
});

describe("form schemas", () => {
    const termValues = {
        name: "Tata Capital Term Loan",
        loanType: "Term Loan",
        currencyId: "cur-inr",
        principalAmount: 100000,
        interestRate: 10,
        interestType: "REDUCING",
        startDate: "2026-01-01",
        outstandingPrincipal: 100000,
        outstandingInterest: 0,
        status: "ACTIVE",
    };

    it("the Loan form trims the number and keeps it a string with its leading zeros", () => {
        const parsed = loanSchema.parse({ ...termValues, loanAccountNumber: "  0099000123 " });

        expect(parsed.loanAccountNumber).toBe("0099000123");
    });

    it("the field is optional", () => {
        expect(loanSchema.safeParse(termValues).success).toBe(true);
        expect(loanSchema.safeParse({ ...termValues, loanAccountNumber: "" }).success).toBe(true);
    });

    it("rejects an unreasonably long number", () => {
        const result = loanSchema.safeParse({ ...termValues, loanAccountNumber: "9".repeat(65) });

        expect(result.success).toBe(false);
    });

    it("the Overdraft form passes it through to the request, blank as null", () => {
        const odValues = {
            name: "TATA Capital (OD)",
            accountIds: ["bank-1"],
            currencyId: "cur-inr",
            creditLimit: 12500000,
            openingUsed: 0,
            openingUsedAsOf: "2026-02-28",
            startDate: "2026-01-31",
            status: "ACTIVE",
        };

        expect(
            overdraftRequestFromValues(
                overdraftSchema.parse({ ...odValues, loanAccountNumber: " 0099000123 " })
            ).loanAccountNumber
        ).toBe("0099000123");
        expect(
            overdraftRequestFromValues(overdraftSchema.parse({ ...odValues, loanAccountNumber: "" }))
                .loanAccountNumber
        ).toBeNull();
    });
});

describe("LoanService.create - Loan Account Number", () => {
    const repository = { createAtomic: vi.fn() };
    const institutionRepository = { getByName: vi.fn(), create: vi.fn() };

    function createService(): LoanService {
        const service = new LoanService();
        Object.defineProperty(service, "repository", { value: repository });
        Object.defineProperty(service, "institutionRepository", { value: institutionRepository });
        return service;
    }

    const request = {
        loanType: "Term Loan",
        name: "Tata Capital Term Loan",
        principalAmount: 100000,
        interestRate: 10,
        interestType: "REDUCING" as const,
        tenureMonths: 12,
        startDate: "2026-01-01",
        outstandingPrincipal: 100000,
        outstandingInterest: 5000,
        paidInstallments: 0,
        currencyId: "cur-inr",
        status: "ACTIVE" as const,
    };

    const savedNumber = () =>
        (repository.createAtomic.mock.calls[0][0] as { loan: { loanAccountNumber: unknown } }).loan
            .loanAccountNumber;

    beforeEach(() => {
        vi.clearAllMocks();
        repository.createAtomic.mockResolvedValue(undefined);
        institutionRepository.getByName.mockResolvedValue(null);
        institutionRepository.create.mockResolvedValue(undefined);
    });

    it("creates a loan with its account number, trimmed, leading zeros kept", async () => {
        await createService().create({ ...request, loanAccountNumber: "  0099000123 " });

        expect(savedNumber()).toBe("0099000123");
    });

    it("stores null when none is entered", async () => {
        await createService().create({ ...request, loanAccountNumber: "   " });
        expect(savedNumber()).toBeNull();

        vi.clearAllMocks();
        repository.createAtomic.mockResolvedValue(undefined);
        await createService().create(request);
        expect(savedNumber()).toBeNull();
    });
});

describe("LoanService.update - Loan Account Number", () => {
    const repository = { getById: vi.fn(), update: vi.fn(), linkLoanAccount: vi.fn() };
    const accountRepository = { getById: vi.fn(), create: vi.fn(), syncLinkedAccount: vi.fn() };
    const scheduleRepository = { getAllByLoanId: vi.fn() };
    const institutionRepository = { getByName: vi.fn(), create: vi.fn() };

    function createService(): LoanService {
        const service = new LoanService();
        Object.defineProperty(service, "repository", { value: repository });
        Object.defineProperty(service, "accountRepository", { value: accountRepository });
        Object.defineProperty(service, "scheduleRepository", { value: scheduleRepository });
        Object.defineProperty(service, "institutionRepository", { value: institutionRepository });
        return service;
    }

    const savedNumber = () =>
        (repository.update.mock.calls[0][0] as { loanAccountNumber: unknown }).loanAccountNumber;

    beforeEach(() => {
        vi.clearAllMocks();
        repository.getById.mockResolvedValue(loan());
        repository.update.mockResolvedValue(undefined);
        accountRepository.getById.mockResolvedValue({ id: "loan-acct-1" });
        accountRepository.syncLinkedAccount.mockResolvedValue(undefined);
        // A generated schedule: the number is metadata, so it stays editable.
        scheduleRepository.getAllByLoanId.mockResolvedValue([{ id: "sch-1" }]);
        institutionRepository.getByName.mockResolvedValue(null);
        institutionRepository.create.mockResolvedValue(undefined);
    });

    it("changes the number, even once an EMI schedule exists", async () => {
        await createService().update(updateRequest({ loanAccountNumber: " XLNA0999000000000017 " }));

        expect(savedNumber()).toBe("XLNA0999000000000017");
    });

    it("clears it when the field is blanked or sent as null", async () => {
        await createService().update(updateRequest({ loanAccountNumber: "" }));
        expect(savedNumber()).toBeNull();

        vi.clearAllMocks();
        repository.getById.mockResolvedValue(loan());
        scheduleRepository.getAllByLoanId.mockResolvedValue([]);
        accountRepository.getById.mockResolvedValue({ id: "loan-acct-1" });
        await createService().update(updateRequest({ loanAccountNumber: null }));
        expect(savedNumber()).toBeNull();
    });

    it("keeps the saved number when a caller doesn't send the field", async () => {
        await createService().update(updateRequest());

        expect(savedNumber()).toBe("0099000123");
    });

    it("edits a loan saved before the field existed", async () => {
        repository.getById.mockResolvedValue(loan({ loanAccountNumber: null }));

        await createService().update(updateRequest({ name: "Renamed" }));

        expect(savedNumber()).toBeNull();
        expect((repository.update.mock.calls[0][0] as { name: string }).name).toBe("Renamed");
    });
});
