import { InstitutionRepository } from "@/modules/institutions/repositories/InstitutionRepository";
import { AccountRepository } from "@/modules/accounts/repositories/AccountRepository";
import { Account, AccountType } from "@/modules/accounts/types";
import { TransactionRepository } from "@/modules/transactions/repositories/TransactionRepository";

import { LoanRepository } from "../repositories/LoanRepository";
import { LoanPaymentScheduleRepository } from "../repositories/LoanPaymentScheduleRepository";
import { LoanSchedulePaymentRepository } from "../repositories/LoanSchedulePaymentRepository";
import { computeLoanScheduleAndBalances } from "./EMIScheduleService";
import {
    Loan,
    CreateLoanRequest,
    UpdateLoanRequest,
} from "../types";

// ---------------------------------------------------------------------
// Data-integrity rules enforced here (Loans Phase 1 - data integrity and
// deletion safety; Phase 3 - loan editing and schedule safety):
//
// Atomic creation - create() computes the loan row, its linked mirror
// account and the full EMI schedule (computeLoanScheduleAndBalances,
// pure - no DB access), then persists all of it, plus the schedule-
// reconciled accounting balances, in ONE real database transaction via
// LoanRepository.createAtomic (a dedicated Rust command - see
// src-tauri/src/loan_create.rs). If schedule generation fails for any
// reason (e.g. missing tenure), nothing is written at all; if the
// write itself fails (e.g. an unresolved Linked Account failing the
// account_id foreign key), everything rolls back on the one connection
// that ran it - no orphaned loan/account, and no dangling open
// transaction left locking the database for the next attempt. This
// replaced an earlier version that issued BEGIN/INSERT/COMMIT as
// separate `SQLiteProvider.execute()` calls (each of which checks out
// its own connection from the underlying sqlx pool independently) -
// which could not guarantee every statement landed on the same
// connection, and was the actual cause of a real "database is locked"
// / "cannot rollback - no transaction is active" / stuck-forever
// production bug.
//
// Edit-state model (Phase 3) - a loan is in exactly one of two states
// for editing purposes:
//   - No generated schedule: legacy/imported rows only (create() has
//     made this unreachable for new loans since Phase 1 - schedule
//     generation is mandatory and atomic with creation). Every term is
//     freely editable; there is nothing yet for a term change to
//     desync.
//   - Generated schedule exists (with or without payments recorded
//     against it - a payment cannot exist without a schedule row to
//     record it against, so these two cases need no separate
//     treatment): principal, interest rate, interest type, tenure,
//     start date, currency, EMI amount and maturity date are locked,
//     since the schedule was built from those exact terms and nothing
//     regenerates it (schedule regeneration remains an explicitly
//     later phase - see EMIScheduleService.generateSchedule's own
//     refusal to run a second time). Name, lender, linked account and
//     notes remain freely editable in both states - none of them are
//     assumptions the schedule or any payment depends on. Changing the
//     linked (EMI payment source) account only affects where *future*
//     payments are recorded; LoanPaymentService.processPayment reads
//     loan.accountId fresh at payment time and writes it onto the
//     transaction row itself, so past payment transactions keep their
//     own recorded account regardless of later edits here.
//
// Status - freely editable, with one guard: a loan cannot be marked
// CLOSED while it still has a nonzero outstandingPrincipal or
// outstandingInterest. Net worth's loan-liability calculation
// (DashboardService.getSummary) excludes CLOSED loans entirely, so
// allowing that transition here would silently drop real, unpaid debt
// from net worth with no correction path (outstandingPrincipal/
// outstandingInterest cannot be edited directly - update() never
// writes those columns; see the SQL in LoanRepository.update()).
// ON_HOLD and DEFAULTED carry no such side effect (net worth still
// counts them) and remain freely settable either way.
//
// Deletion (Delete Loan) - a loan can only be deleted once it has no
// recorded payments at all (ACTIVE or CLOSED makes no difference);
// with any payment history it is refused outright, directing the user
// to reverse every payment first. Once eligible, delete() removes the
// loan and its (necessarily UPCOMING-only) schedule atomically, and
// removes the linked liability account too, but only when no live
// transaction is booked on it - see delete()'s own doc comment for the
// full account-safety reasoning. It also removes any goal_loan_links
// row pointing at the deleted loan, so a goal never keeps referencing
// a loan_id that no longer resolves. See LoanPaymentService.
// reversePayment for how a payment gets removed from the ledger in
// the first place.
// ---------------------------------------------------------------------

export class LoanService {
    private readonly repository = new LoanRepository();

    private readonly institutionRepository =
        new InstitutionRepository();

    private readonly accountRepository =
        new AccountRepository();

    private readonly scheduleRepository =
        new LoanPaymentScheduleRepository();

    private readonly paymentRepository =
        new LoanSchedulePaymentRepository();

    private readonly transactionRepository =
        new TransactionRepository();

    /**
     * Every loan is backed 1:1 by a real account record
     * (account_type = LOAN) so loans appear in the unified Accounts list.
     * This mirrors the Investment <-> Account relationship.
     *
     * The account carries identity only - opening_balance stays 0. The
     * current liability is derived at read time from the loan's outstanding
     * balances and shown as a negative balance, so it never feeds
     * account-balance / net-worth aggregates (which would double-count it).
     */
    private buildLoanAccount(
        accountId: string,
        source: {
            name: string;
            currencyId: string;
            status: Loan["status"];
        },
        lenderInstitutionId: string | null,
        now: string
    ): Account {
        return {
            id: accountId,
            name: source.name,
            type: AccountType.LOAN,
            institutionId: lenderInstitutionId,
            businessEntityId: null,
            currencyId: source.currencyId,
            openingBalance: 0,
            description: "Loan liability account",
            isActive: source.status !== "CLOSED",
            createdAt: now,
            updatedAt: now,
        };
    }

    /**
     * The "Linked Account" field is a <select>, defaulted to "" when left
     * blank (LoanForm's own default, and the zod schema's `.optional()`
     * only skips a literal `undefined` - an empty string still passes
     * through as ""). `loans.account_id` has a FOREIGN KEY constraint
     * against accounts(id), and "" never resolves to a real account, so
     * an unnormalized blank selection fails the insert/update outright
     * with a foreign-key-constraint error - surfaced to the user as a
     * generic "Failed to create/update loan" (production bug: Loan
     * creation with no linked account selected).
     */
    private normalizeAccountId(
        accountId: string | null | undefined
    ): string | null {
        return accountId?.trim() || null;
    }

    private async resolveLenderInstitutionId(
        institutionName?: string | null,
        institutionId?: string | null
    ): Promise<string | null> {
        if (institutionId) {
            return institutionId;
        }

        const name = institutionName?.trim();

        if (!name) {
            return null;
        }

        const existing =
            await this.institutionRepository.getByName(name);

        if (existing) {
            return existing.id;
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        await this.institutionRepository.create({
            id,
            name,
            type: "Financial Institution",
            createdAt: now,
            updatedAt: now,
        });

        return id;
    }

    async getAll(): Promise<Loan[]> {
        return await this.repository.getAll();
    }

    async getById(id: string): Promise<Loan | null> {
        return await this.repository.getById(id);
    }

    async create(
        request: CreateLoanRequest
    ): Promise<string> {
        const now = new Date().toISOString();

        const lenderInstitutionId =
            await this.resolveLenderInstitutionId(
                request.lenderInstitutionName,
                request.lenderInstitutionId
            );

        const loanAccountId = crypto.randomUUID();

        const loan: Loan = {
            id: crypto.randomUUID(),

            accountId: this.normalizeAccountId(
                request.accountId
            ),

            loanAccountId,

            lenderInstitutionId,

            loanType: request.loanType,

            name: request.name,

            principalAmount: request.principalAmount,

            interestRate: request.interestRate,

            interestType: request.interestType,

            tenureMonths: request.tenureMonths ?? null,

            emiAmount: request.emiAmount ?? null,

            startDate: request.startDate,

            maturityDate: request.maturityDate ?? null,

            outstandingPrincipal:
                request.outstandingPrincipal,

            outstandingInterest:
                request.outstandingInterest,

            paidInstallments:
                request.paidInstallments ?? 0,

            currencyId: request.currencyId,

            status: request.status,

            notes: request.notes,

            createdAt: now,

            updatedAt: now,
        };

        const loanAccount = this.buildLoanAccount(
            loanAccountId,
            request,
            lenderInstitutionId,
            now
        );

        // Schedule generation - and the accounting-balance reconciliation
        // it drives - is pure computation (no DB access). It runs here,
        // and the loan, its mirror account, the account link, every
        // schedule installment and those reconciled balances are then
        // all persisted together in ONE real database transaction (a
        // dedicated Rust command - see LoanRepository.createAtomic).
        // This guarantees atomicity: if schedule generation fails (e.g.
        // missing tenure) nothing is persisted at all, and a genuine
        // write failure (e.g. an unresolved Linked Account) rolls back
        // everything on the one connection that ran it - never leaving
        // a dangling transaction/lock behind for the next attempt.
        const {
            schedule,
            outstandingPrincipal,
            outstandingInterest,
            status,
        } = computeLoanScheduleAndBalances(loan);

        await this.repository.createAtomic({
            loanAccount: {
                id: loanAccount.id,
                institutionId: loanAccount.institutionId,
                businessEntityId:
                    loanAccount.businessEntityId,
                currencyId: loanAccount.currencyId,
                name: loanAccount.name,
                accountType: loanAccount.type,
                description: loanAccount.description ?? null,
                isActive: loanAccount.isActive,
                createdAt: loanAccount.createdAt,
                updatedAt: loanAccount.updatedAt,
            },
            loan: {
                id: loan.id,
                accountId: loan.accountId,
                lenderInstitutionId:
                    loan.lenderInstitutionId,
                loanType: loan.loanType,
                name: loan.name,
                principalAmount: loan.principalAmount,
                interestRate: loan.interestRate,
                interestType: loan.interestType,
                tenureMonths: loan.tenureMonths,
                emiAmount: loan.emiAmount,
                startDate: loan.startDate,
                maturityDate: loan.maturityDate,
                outstandingPrincipal:
                    loan.outstandingPrincipal,
                outstandingInterest:
                    loan.outstandingInterest,
                paidInstallments: loan.paidInstallments,
                currencyId: loan.currencyId,
                status: loan.status,
                notes: loan.notes ?? null,
                createdAt: loan.createdAt,
                updatedAt: loan.updatedAt,
            },
            schedule: schedule.map(installment => ({
                id: installment.id,
                installmentNumber:
                    installment.installmentNumber,
                dueDate: installment.dueDate,
                principalAmount:
                    installment.principalAmount,
                interestAmount:
                    installment.interestAmount,
                totalAmount: installment.totalAmount,
                outstandingPrincipal:
                    installment.outstandingPrincipal,
                status: installment.status,
                paidDate: installment.paidDate,
                paidAmount: installment.paidAmount,
                transactionId: installment.transactionId,
            })),
            balances: {
                outstandingPrincipal,
                outstandingInterest,
                status,
            },
        });

        return loan.id;
    }

    async update(
        request: UpdateLoanRequest
    ): Promise<void> {
        const now = new Date().toISOString();

        const lenderInstitutionId =
            await this.resolveLenderInstitutionId(
                request.lenderInstitutionName,
                request.lenderInstitutionId
            );

        /*
         * The loan account is established once at creation and is never
         * editable through the form. Resolve the *live* linked account from
         * the database; if the link is missing (legacy / unmigrated loan) or
         * points at an account that no longer exists or was soft-deleted,
         * repair the 1:1 link rather than leaving the loan without an
         * Accounts row.
         */
        const existing = await this.repository.getById(request.id);

        if (!existing) {
            throw new Error("Loan not found.");
        }

        // Once an EMI schedule has been generated, it was built from the
        // loan's terms at that moment - principal, rate, type, tenure,
        // start date, currency, EMI amount and maturity date must all stay
        // in lockstep with it. Changing any of them here without
        // regenerating the schedule (an explicitly later phase) would
        // silently desync the two. Name, lender, linked account, notes and
        // status carry no schedule assumptions and remain freely editable.
        const existingSchedule =
            await this.scheduleRepository.getAllByLoanId(
                request.id
            );

        if (existingSchedule.length > 0) {
            const normalizeNumber = (
                value: number | null | undefined
            ): number | null => value ?? null;

            const normalizeString = (
                value: string | null | undefined
            ): string | null => value ?? null;

            const termsChanged =
                existing.principalAmount !==
                    request.principalAmount ||
                existing.interestRate !==
                    request.interestRate ||
                existing.interestType !==
                    request.interestType ||
                normalizeNumber(existing.tenureMonths) !==
                    normalizeNumber(
                        request.tenureMonths
                    ) ||
                existing.startDate !==
                    request.startDate ||
                existing.currencyId !==
                    request.currencyId ||
                normalizeNumber(existing.emiAmount) !==
                    normalizeNumber(request.emiAmount) ||
                normalizeString(existing.maturityDate) !==
                    normalizeString(
                        request.maturityDate
                    );

            if (termsChanged) {
                throw new Error(
                    "This loan's EMI schedule has already been generated, so its principal, interest rate, interest type, tenure, start date, currency, EMI amount and maturity date can't be changed. Delete and recreate the loan if these terms were entered incorrectly."
                );
            }
        }

        // Closing a loan excludes it from net worth's loan liability
        // entirely (DashboardService.getSummary) - allowing that while
        // real debt is still outstanding would silently understate net
        // worth with no way back (outstandingPrincipal/
        // outstandingInterest are never editable through this method).
        if (
            request.status === "CLOSED" &&
            existing.status !== "CLOSED" &&
            (existing.outstandingPrincipal > 0 ||
                existing.outstandingInterest > 0)
        ) {
            throw new Error(
                "This loan can't be marked Closed while it still has an outstanding principal or interest balance. Record the remaining EMI payments first, or choose On Hold or Defaulted instead."
            );
        }

        const linkedAccountId =
            existing.loanAccountId?.trim() || null;

        const linkedAccount = linkedAccountId
            ? await this.accountRepository.getById(linkedAccountId)
            : null;

        let loanAccountId = linkedAccount?.id ?? null;

        if (!loanAccountId) {
            loanAccountId = crypto.randomUUID();

            await this.accountRepository.create(
                this.buildLoanAccount(
                    loanAccountId,
                    request,
                    lenderInstitutionId,
                    now
                )
            );

            await this.repository.linkLoanAccount(
                request.id,
                loanAccountId
            );
        }

        await this.repository.update({
            ...request,
            accountId: this.normalizeAccountId(
                request.accountId
            ),
            lenderInstitutionId,
        });

        // Identity sync only - opening_balance stays 0; the liability is
        // always derived from the loan's current outstanding balances.
        await this.accountRepository.syncLinkedAccount({
            id: loanAccountId,
            name: request.name,
            currencyId: request.currencyId,
            businessEntityId: null,
            isActive: request.status !== "CLOSED",
        });
    }

    /**
     * Deletion policy (Delete Loan): a loan may be deleted only when it
     * has no recorded payments at all - ACTIVE or CLOSED makes no
     * difference. This is a hard refusal, not a partial/silent
     * cleanup: a loan with any payment history keeps every one of its
     * loan_schedule_payments rows and its schedule intact until the
     * user reverses each payment first (LoanPaymentService.
     * reversePayment). Nothing here ever deletes or alters a bank
     * transaction - a payment's linked transaction is only ever
     * touched by reversePayment(), never by this method.
     *
     * Once a loan has no payments, deleting it removes only
     * loan-owned data: its (necessarily all-UPCOMING) schedule rows
     * and the loan record itself. The linked liability account is
     * deleted too, but only when it is provably safe to: it must have
     * no live transaction booked on it (a stray transaction there
     * would mean the account is doing something beyond being this
     * loan's identity placeholder, since the account normally never
     * receives transactions - EMI payments are booked on loan.
     * accountId, the separate payment-source bank account, not on this
     * mirror account). If the account does have a transaction on it,
     * it is left in place, unlinked from the deleted loan, rather than
     * risk ever destroying real transaction history - the user can
     * manage or delete it themselves from the Accounts page once they
     * confirm what it is.
     *
     * Also cleans up goal_loan_links: any goal linked to this loan
     * (ManageGoalLoanLinksDialog) has its link to this loan removed in
     * the same transaction, so it never keeps pointing at a deleted
     * loan_id. The goal itself is never touched, and links to any
     * other loan are untouched.
     *
     * All of this - the schedule/payment cleanup, the goal-link
     * cleanup, the loan's own soft-delete and the mirror account's -
     * is persisted in ONE real database transaction via
     * LoanRepository.deleteAtomic (a dedicated Rust command - see
     * src-tauri/src/loan_delete.rs), for exactly the same reason
     * create() does: separate `SQLiteProvider.execute()` calls cannot
     * guarantee every statement lands on the same connection. That gap
     * was a real production bug here too - a delete whose statements
     * had already taken effect could still report "cannot commit - no
     * transaction is active" because the final COMMIT landed on a
     * connection with no transaction to commit.
     */
    async delete(id: string): Promise<void> {
        const loan = await this.repository.getById(id);

        if (!loan) {
            throw new Error("Loan not found.");
        }

        const payments =
            await this.paymentRepository.getAllByLoanId(id);

        if (payments.length > 0) {
            throw new Error(
                "This loan has recorded payments and can't be deleted. Reverse every payment from the loan's EMI schedule first, then try again."
            );
        }

        // Read the link before deleting, and without the deleted_at filter,
        // so a retry after a partially-failed delete still resolves the
        // same account (it can never become untraceable).
        const loanAccountId =
            await this.repository.getLinkedLoanAccountId(id);

        const accountHasTransactions = loanAccountId
            ? await this.transactionRepository.existsForAccount(
                  loanAccountId
              )
            : false;

        await this.repository.deleteAtomic({
            loanId: id,
            loanAccountId:
                loanAccountId && !accountHasTransactions
                    ? loanAccountId
                    : null,
        });
    }
}
