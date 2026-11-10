import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { migrations } from "@/core/database/migrations/registry";

import { LoanRepository } from "./LoanRepository";
import type { Loan } from "../types";

// ---------------------------------------------------------------------
// Loan Account Number (migration 050) through the REAL LoanRepository
// SQL - create, getById, getAll, update - against an in-memory database
// built from every app migration. Only SQLiteProvider is stubbed.
// ---------------------------------------------------------------------

const sqlite = { db: null as DatabaseSync | null };

vi.mock("@/core/database/engine/SQLiteProvider", () => ({
    SQLiteProvider: {
        getInstance: () => ({
            async select(sql: string, binds: unknown[] = []) {
                return sqlite.db!.prepare(sql).all(...(binds as never[]));
            },
            async execute(sql: string, binds: unknown[] = []) {
                sqlite.db!.prepare(sql).run(...(binds as never[]));
            },
            async beginTransaction() {},
            async commit() {},
            async rollback() {},
        }),
    },
}));

function run(db: DatabaseSync, sql: string): void {
    for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) {
        if (!/^PRAGMA\s+foreign_keys\s*=\s*ON\s*$/i.test(statement)) {
            db.exec(statement);
        }
    }
}

function loan(overrides: Partial<Loan> = {}): Loan {
    return {
        id: "loan-1",
        accountId: null,
        loanAccountId: null,
        lenderInstitutionId: null,
        loanType: "Term Loan",
        name: "Tata Capital Term Loan",
        principalAmount: 500000,
        interestRate: 10.5,
        interestType: "REDUCING",
        tenureMonths: 60,
        emiAmount: 8291,
        startDate: "2026-03-05",
        maturityDate: "2031-03-05",
        outstandingPrincipal: 500000,
        outstandingInterest: 0,
        paidInstallments: 0,
        currencyId: "cur-inr",
        status: "ACTIVE",
        createdAt: "2026-10-16T00:00:00.000Z",
        updatedAt: "2026-10-16T00:00:00.000Z",
        ...overrides,
    };
}

describe("LoanRepository - Loan Account Number", () => {
    beforeEach(() => {
        sqlite.db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });

        for (const migration of migrations) {
            run(sqlite.db, migration.sql);
        }
    });

    it("saves and loads a loan's account number exactly as text, leading zeros kept", async () => {
        const repository = new LoanRepository();

        await repository.create(loan({ loanAccountNumber: "0099000123" }));

        const saved = await repository.getById("loan-1");
        expect(saved?.loanAccountNumber).toBe("0099000123");

        const stored = sqlite.db!
            .prepare(`SELECT typeof(loan_account_number) AS kind FROM loans WHERE id = 'loan-1'`)
            .get() as { kind: string };
        expect(stored.kind).toBe("text");
    });

    it("keeps letters, hyphens and slashes as typed", async () => {
        const repository = new LoanRepository();

        await repository.create(loan({ loanAccountNumber: "TXLNA-0999/000000000017" }));

        expect((await repository.getById("loan-1"))?.loanAccountNumber).toBe(
            "TXLNA-0999/000000000017"
        );
    });

    it("still loads a loan saved without an account number (NULL)", async () => {
        const repository = new LoanRepository();

        await repository.create(loan({ loanAccountNumber: undefined }));

        const byId = await repository.getById("loan-1");
        const all = await repository.getAll();

        expect(byId?.loanAccountNumber).toBeNull();
        expect(byId?.name).toBe("Tata Capital Term Loan");
        expect(all.map(item => item.loanAccountNumber)).toEqual([null]);
    });

    it("an edit sets, changes and clears the number, touching nothing else", async () => {
        const repository = new LoanRepository();
        await repository.create(loan());
        const before = await repository.getById("loan-1");

        const edit = (loanAccountNumber: string | null) =>
            repository.update({ ...before!, loanAccountNumber, lenderInstitutionId: null });

        await edit("XLNA0999000000000017");
        expect((await repository.getById("loan-1"))?.loanAccountNumber).toBe(
            "XLNA0999000000000017"
        );

        await edit("00123");
        expect((await repository.getById("loan-1"))?.loanAccountNumber).toBe("00123");

        await edit(null);
        const after = await repository.getById("loan-1");
        expect(after?.loanAccountNumber).toBeNull();

        const { updatedAt: _a, loanAccountNumber: _b, ...restBefore } = before!;
        const { updatedAt: _c, loanAccountNumber: _d, ...restAfter } = after!;
        expect(restAfter).toEqual(restBefore);
    });
});
