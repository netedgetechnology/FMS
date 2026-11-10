import { DROPLINE_OVERDRAFT_ENABLED, droplineScheduleIssues } from "../setup/droplineSchedule";
import { InstitutionRepository } from "@/modules/institutions/repositories/InstitutionRepository";
import { AccountRepository } from "@/modules/accounts/repositories/AccountRepository";
import { Account, AccountType } from "@/modules/accounts/types";
import { TransactionRepository } from "@/modules/transactions/repositories/TransactionRepository";

import { LoanRepository } from "../repositories/LoanRepository";
import { LoanPaymentScheduleRepository } from "../repositories/LoanPaymentScheduleRepository";
import { LoanSchedulePaymentRepository } from "../repositories/LoanSchedulePaymentRepository";
import { LoanSetupRepository } from "../repositories/LoanSetupRepository";
import type { CreateLoanAtomicRequest } from "../repositories/LoanRepository";
import { balancesFromSchedule, computeLoanScheduleAndBalances } from "./EMIScheduleService";
import {
    linkedTransactionRefusal,
    validateSetupDetails,
} from "../setup/loanSetupAccounting";
import { checkLenderScheduleRows } from "../setup/lenderSchedule";
import { lenderRowsToSchedule } from "../setup/loanSetupWizard";
import {
    entriesFromDetails,
    historicalInstalmentIssues,
    localToday,
    markHistoricalInstalments,
    paidInstalmentCount,
    type HistoricalEntry,
} from "../setup/historicalInstalments";
import type { LoanSetupDetails } from "../setup/loanSetupTypes";
import { OverdraftService } from "./OverdraftService";
import {
    Loan,
    LoanKind,
    LoanPaymentSchedule,
    CreateLoanRequest,
    UpdateLoanRequest,
    isOverdraft,
} from "../types";
import { normalizeLoanAccountNumber } from "../validation/loanSchema";

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

    private readonly overdraftService = new OverdraftService();

    private readonly setupRepository = new LoanSetupRepository();

    /**
     * The Add Loan setup, checked before anything is written: its own
     * accounting rules (validateSetupDetails), and every linked bank
     * transaction - it must still exist, be live, not be used by anything
     * else, and fit exactly (account, direction, amount). The Rust command
     * checks the same again inside the write transaction.
     */
    private async verifySetup(
        setup: LoanSetupDetails,
        context: {
            loanKind: LoanKind;
            sanctionedAmount: number | null;
            sanctionDate: string | null;
        }
    ): Promise<void> {
        const issues = validateSetupDetails(setup, context);

        if (issues.length > 0) {
            throw new Error(issues[0]!.message);
        }

        const wanted = [
            ...setup.disbursements.map((d, index) => ({
                id: d.transactionId,
                side: "IN" as const,
                accountId: d.destinationAccountId,
                amount: d.netAmount,
                what: `disbursement ${index + 1}`,
            })),
            ...setup.expenses.map((e, index) => ({
                id: e.transactionId,
                side: "OUT" as const,
                accountId: e.paymentAccountId,
                amount: e.totalAmount,
                what: `expense ${index + 1}`,
            })),
        ].filter((item): item is typeof item & { id: string } => Boolean(item.id));

        if (wanted.length === 0) {
            return;
        }

        const found = new Map(
            (await this.setupRepository.getTransactionsForLinking(wanted.map(item => item.id))).map(
                transaction => [transaction.id, transaction]
            )
        );

        for (const item of wanted) {
            const transaction = found.get(item.id);

            if (!transaction || transaction.deleted) {
                throw new Error(`The bank transaction linked to ${item.what} no longer exists.`);
            }

            if (transaction.claimedBy) {
                throw new Error(
                    `The bank transaction linked to ${item.what} is already used by ${transaction.claimedBy}.`
                );
            }

            const refusal = linkedTransactionRefusal(transaction, item);

            if (refusal) {
                throw new Error(refusal);
            }
        }
    }

    /** The setup as the Rust command stores it, with fresh row ids. */
    private atomicSetup(
        setup: LoanSetupDetails
    ): NonNullable<CreateLoanAtomicRequest["setup"]> {
        const disbursementIds = setup.disbursements.map(() => crypto.randomUUID());

        return {
            loanPurpose: setup.loanPurpose,
            rateType: setup.rateType,
            interestCalculationMethod: setup.interestCalculationMethod,
            sanctionDate: setup.sanctionDate,
            sanctionedAmount: setup.sanctionedAmount,
            firstEmiDate: setup.firstEmiDate,
            repaymentFrequency: setup.repaymentFrequency,
            paymentDay: setup.paymentDay,
            gracePeriodMonths: setup.gracePeriodMonths,
            balloonAmount: setup.balloonAmount,
            scheduleSource: setup.scheduleSource,
            drawingPower: setup.drawingPower,
            ...(setup.drawingPowerSchedule?.length
                ? { drawingPowerSchedule: setup.drawingPowerSchedule.map(step => ({ id: crypto.randomUUID(), ...step })) }
                : {}),
            disbursements: setup.disbursements.map((d, index) => ({
                id: disbursementIds[index]!,
                sequence: index + 1,
                disbursementDate: d.date,
                grossAmount: d.grossAmount,
                deductionsAmount: d.deductionsAmount,
                netAmount: d.netAmount,
                destinationAccountId: d.destinationAccountId,
                reference: d.reference,
                transactionId: d.transactionId,
            })),
            expenses: setup.expenses.map(e => ({
                id: crypto.randomUUID(),
                expenseType: e.expenseType,
                description: e.description,
                expenseDate: e.expenseDate,
                baseAmount: e.baseAmount,
                gstRate: e.gstRate,
                gstAmount: e.gstAmount,
                totalAmount: e.totalAmount,
                settlement: e.settlement,
                disbursementId:
                    e.disbursementIndex !== null ? disbursementIds[e.disbursementIndex] ?? null : null,
                paymentMethod: e.paymentMethod,
                paymentAccountId: e.paymentAccountId,
                transactionReference: e.transactionReference,
                transactionId: e.transactionId,
            })),
        };
    }

    /** A setup refusal from the Rust command, as the plain message it carries. */
    private async createAtomicWithSetup(request: CreateLoanAtomicRequest): Promise<void> {
        try {
            await this.repository.createAtomic(request);
        } catch (error) {
            const match = String(error instanceof Error ? error.message : error).match(
                /LOAN_SETUP_REFUSED: (.*)$/s
            );

            throw match ? new Error(match[1]) : error;
        }
    }

    /**
     * An Overdraft's own terms, checked before anything is written. Its
     * used / available amounts are never stored - see OverdraftService.
     */
    private overdraftTerms(request: {
        creditLimit?: number | null;
        openingUsed?: number | null;
        openingUsedAsOf?: string | null;
        linkedAccountIds?: string[] | null;
    }): {
        creditLimit: number;
        openingUsed: number;
        openingUsedAsOf: string;
        accountIds: string[];
    } {
        const creditLimit = Number(request.creditLimit);
        const openingUsed = Number(request.openingUsed ?? 0);
        const openingUsedAsOf = request.openingUsedAsOf?.trim() ?? "";

        if (!Number.isFinite(creditLimit) || creditLimit <= 0) {
            throw new Error("The OD limit must be greater than 0.");
        }

        if (!Number.isFinite(openingUsed) || openingUsed < 0) {
            throw new Error("The opening used amount cannot be negative.");
        }

        if (!/^\d{4}-\d{2}-\d{2}/.test(openingUsedAsOf)) {
            throw new Error("Enter the date the opening used amount is as of.");
        }

        // OD movements are recognised on these accounts only - without one
        // nothing could ever be linked or matched.
        const accountIds = [
            ...new Set(
                (request.linkedAccountIds ?? [])
                    .map(id => this.normalizeAccountId(id))
                    .filter((id): id is string => id !== null)
            ),
        ];

        if (accountIds.length === 0) {
            throw new Error("Choose at least one bank account this overdraft is linked to.");
        }

        return {
            creditLimit,
            openingUsed,
            openingUsedAsOf: openingUsedAsOf.slice(0, 10),
            accountIds,
        };
    }

    /**
     * The Term Loan columns an Overdraft does not use - fixed values, so
     * nothing EMI-related (schedule, principal, tenure) is ever read from
     * an OD. Its limit lives only in credit_limit.
     */
    private static readonly OVERDRAFT_TERM_FIELDS = {
        principalAmount: 0,
        interestType: "REDUCING" as const,
        tenureMonths: null,
        emiAmount: null,
        firstInstallmentAmount: null,
        maturityDate: null,
        paidInstallments: 0,
    };

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
        if (isOverdraft(request)) {
            return await this.createOverdraft(request);
        }

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

            loanAccountNumber: normalizeLoanAccountNumber(
                request.loanAccountNumber
            ),

            principalAmount: request.principalAmount,

            interestRate: request.interestRate,

            interestType: request.interestType,

            tenureMonths: request.tenureMonths ?? null,

            emiAmount: request.emiAmount ?? null,

            firstInstallmentAmount:
                request.firstInstallmentAmount && request.firstInstallmentAmount > 0
                    ? request.firstInstallmentAmount
                    : null,

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

            firstEmiDate: request.setup?.firstEmiDate ?? null,

            paymentDay: request.setup?.paymentDay ?? null,

            balloonAmount: request.setup?.balloonAmount ?? null,

            interestCalculationMethod:
                request.setup?.interestCalculationMethod ?? null,
        };

        const setup = request.setup ?? null;

        if (setup) {
            await this.verifySetup(setup, {
                loanKind: LoanKind.TERM_LOAN,
                sanctionedAmount: setup.sanctionedAmount,
                sanctionDate: setup.sanctionDate,
            });

            if (setup.disbursements.length > 0) {
                const gross = setup.disbursements.reduce((sum, d) => sum + d.grossAmount, 0);

                if (Math.abs(gross - loan.principalAmount) >= 0.005) {
                    throw new Error(
                        "The loan principal must equal the gross amount disbursed."
                    );
                }
            }
        }

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
        // The lender's official schedule, when imported, is stored exactly as
        // given (after the same checks the import step ran); otherwise
        // FinWea generates it from the terms.
        let lenderSchedule = null;

        if (setup?.lenderSchedule) {
            const checked = checkLenderScheduleRows(setup.lenderSchedule, {
                principalAmount: loan.principalAmount,
                startDate: loan.startDate,
            });

            if (!checked.rows) {
                throw new Error(
                    checked.errors[0]?.message ??
                        "The lender schedule could not be used."
                );
            }

            lenderSchedule = lenderRowsToSchedule(loan.id, checked.rows);
        }

        // Every instalment starts UPCOMING. The historical ones (a loan that
        // was already running) are marked PAID only as the user resolved
        // them, one by one: linked to an existing bank debit, or explicitly
        // "Settled before FinWea". create_loan_atomic checks the same again.
        const unmarked = lenderSchedule ?? computeLoanScheduleAndBalances(loan).schedule;
        const historical = await this.verifiedHistoricalEntries(
            unmarked,
            setup,
            request.paidInstallments ?? 0,
            loan
        );
        const markedSchedule = markHistoricalInstalments(unmarked, historical);
        const {
            schedule,
            outstandingPrincipal,
            outstandingInterest,
            status,
        } = balancesFromSchedule(markedSchedule, loan.principalAmount, loan.status);

        // Derived from the schedule - never a typed-in count.
        loan.paidInstallments = paidInstalmentCount(schedule);

        await this.createAtomicWithSetup({
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
                loanAccountNumber: loan.loanAccountNumber ?? null,
                principalAmount: loan.principalAmount,
                interestRate: loan.interestRate,
                interestType: loan.interestType,
                tenureMonths: loan.tenureMonths,
                emiAmount: loan.emiAmount,
                firstInstallmentAmount: loan.firstInstallmentAmount ?? null,
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
                openingPrincipal: installment.openingPrincipal ?? null,
                settledBeforeFinwea: installment.settledBeforeFinwea === true,
            })),
            historicalPayments: schedule
                .filter(installment => installment.status === "PAID" && !installment.settledBeforeFinwea)
                .map(installment => ({
                    id: crypto.randomUUID(),
                    scheduleId: installment.id,
                    transactionId: installment.transactionId!,
                })),
            balances: {
                outstandingPrincipal,
                outstandingInterest,
                status,
            },
            setup: setup ? this.atomicSetup(setup) : undefined,
        });

        return loan.id;
    }

    /**
     * The historical instalments of a loan that was already running, checked
     * against the unmarked schedule and - for a linked one - against the
     * bank transaction as it is in the database now (live, unclaimed, money
     * out, on the loan's EMI account, exactly the instalment amount, not
     * dated in the future). A bare paid-instalment count is refused: each
     * instalment must be resolved on its own.
     */
    private async verifiedHistoricalEntries(
        schedule: LoanPaymentSchedule[],
        setup: LoanSetupDetails | null,
        requestedPaidCount: number,
        loan: Pick<Loan, "accountId" | "startDate">
    ): Promise<HistoricalEntry[]> {
        const details = setup?.historicalInstalments ?? [];

        if (requestedPaidCount !== 0 && requestedPaidCount !== details.length) {
            throw new Error(
                "Instalments paid before FinWea can't be entered as a count. Link each one to its bank debit, or mark it \"Settled before FinWea\", in Add Loan."
            );
        }

        if (details.length === 0) {
            return [];
        }

        const entries = entriesFromDetails(details);
        const linkedIds = entries
            .map(entry => entry.transaction?.id)
            .filter((id): id is string => Boolean(id));
        const stored = new Map(
            (await this.setupRepository.getTransactionsForLinking(linkedIds)).map(
                transaction => [transaction.id, transaction]
            )
        );

        // The database's own figures, not what the screen remembered.
        const current: HistoricalEntry[] = entries.map(entry => {
            if (!entry.transaction) {
                return entry;
            }

            const transaction = stored.get(entry.transaction.id);

            if (!transaction || transaction.deleted) {
                throw new Error(`The bank transaction linked to instalment #${entry.installmentNumber} no longer exists.`);
            }

            if (transaction.claimedBy) {
                throw new Error(
                    `The bank transaction linked to instalment #${entry.installmentNumber} is already used by ${transaction.claimedBy}.`
                );
            }

            return { ...entry, transaction };
        });

        const issues = historicalInstalmentIssues(schedule, current, {
            today: localToday(),
            accountId: loan.accountId,
            loanStartDate: loan.startDate,
            otherLinkedIds: [
                ...(setup?.disbursements ?? []).map(d => d.transactionId),
                ...(setup?.expenses ?? []).map(e => e.transactionId),
            ].filter((id): id is string => Boolean(id)),
        });

        if (issues.length > 0) {
            throw new Error(issues[0]!.message);
        }

        return current;
    }

    /**
     * An Overdraft: the loan row, its mirror account and the account link
     * in the same single atomic write as a Term Loan - with no EMI
     * schedule. Its used amount starts as the opening used amount and is
     * derived from then on (OVERDRAFT_POSITIONS_SQL); the stored
     * outstanding columns are 0 and never read for an OD.
     */
    private async createOverdraft(
        request: CreateLoanRequest
    ): Promise<string> {
        const terms = this.overdraftTerms(request);
        const now = new Date().toISOString();

        const lenderInstitutionId =
            await this.resolveLenderInstitutionId(
                request.lenderInstitutionName,
                request.lenderInstitutionId
            );

        const loanId = crypto.randomUUID();
        const loanAccountId = crypto.randomUUID();
        const loanAccount = this.buildLoanAccount(
            loanAccountId,
            request,
            lenderInstitutionId,
            now
        );
        const fields = LoanService.OVERDRAFT_TERM_FIELDS;
        const setup = request.setup ?? null;

        if (setup) {
            await this.verifySetup(setup, {
                loanKind: LoanKind.OVERDRAFT,
                sanctionedAmount: null,
                sanctionDate: setup.sanctionDate,
            });

            if (setup.drawingPowerSchedule?.length && !DROPLINE_OVERDRAFT_ENABLED) {
                throw new Error("Dropline Overdraft needs a database update that has not been applied.");
            }

            const drawingPower = setup.drawingPower;

            if (drawingPower !== null && drawingPower !== undefined) {
                if (!Number.isFinite(drawingPower) || drawingPower < 0) {
                    throw new Error("Drawing power cannot be negative.");
                }

                if (drawingPower > terms.creditLimit) {
                    throw new Error("Drawing power cannot be more than the sanctioned limit.");
                }
            }
        }

        await this.createAtomicWithSetup({
            loanAccount: {
                id: loanAccount.id,
                institutionId: loanAccount.institutionId,
                businessEntityId: loanAccount.businessEntityId,
                currencyId: loanAccount.currencyId,
                name: loanAccount.name,
                accountType: loanAccount.type,
                description: loanAccount.description ?? null,
                isActive: loanAccount.isActive,
                createdAt: loanAccount.createdAt,
                updatedAt: loanAccount.updatedAt,
            },
            loan: {
                id: loanId,
                // The first linked account, for code that reads one account;
                // the OD itself uses overdraft_accounts (terms.accountIds).
                accountId: terms.accountIds[0]!,
                lenderInstitutionId,
                loanType: request.loanType?.trim() || "Overdraft",
                name: request.name,
                loanAccountNumber: normalizeLoanAccountNumber(request.loanAccountNumber),
                principalAmount: fields.principalAmount,
                interestRate: request.interestRate ?? 0,
                interestType: fields.interestType,
                tenureMonths: fields.tenureMonths,
                emiAmount: fields.emiAmount,
                firstInstallmentAmount: fields.firstInstallmentAmount,
                startDate: request.startDate,
                maturityDate: fields.maturityDate,
                outstandingPrincipal: 0,
                outstandingInterest: 0,
                paidInstallments: fields.paidInstallments,
                currencyId: request.currencyId,
                status: request.status,
                notes: request.notes ?? null,
                createdAt: now,
                updatedAt: now,
            },
            overdraft: terms,
            schedule: [],
            balances: {
                outstandingPrincipal: 0,
                outstandingInterest: 0,
                status: request.status,
            },
            setup: setup ? this.atomicSetup(setup) : undefined,
        });

        return loanId;
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

        // The paid-instalment count comes from the EMI schedule itself; an
        // edit can never move it on its own (it would no longer describe the
        // schedule). Not sent (undefined / null) = unchanged.
        if (
            request.paidInstallments !== undefined &&
            request.paidInstallments !== null &&
            request.paidInstallments !== existing.paidInstallments
        ) {
            throw new Error(
                "The number of paid instalments comes from the EMI schedule and can't be edited. Record, link or reverse EMI payments from the EMI schedule instead."
            );
        }

        // A caller that doesn't send it (undefined) keeps the saved number;
        // a blank one clears it.
        const loanAccountNumber =
            request.loanAccountNumber === undefined
                ? existing.loanAccountNumber ?? null
                : normalizeLoanAccountNumber(request.loanAccountNumber);

        // The Loan Type never changes through an edit. For an Overdraft the
        // Term Loan columns keep their fixed values, and it can't be closed
        // while any of the limit is still used.
        let overdraftTerms: ReturnType<LoanService["overdraftTerms"]> | null = null;

        if (isOverdraft(existing)) {
            const terms = this.overdraftTerms(request);
            overdraftTerms = terms;

            // A Dropline's steps are replaced as a whole, checked by the same
            // rules as at setup; Rust checks them again in its transaction.
            if (request.drawingPowerSchedule !== undefined) {
                if (!DROPLINE_OVERDRAFT_ENABLED) {
                    throw new Error("Drawing-power steps need database update 053, which has not been applied.");
                }

                const issue = droplineScheduleIssues(
                    request.drawingPowerSchedule.map((step, index) => ({ key: String(index), ...step })),
                    terms.creditLimit
                )[0];

                if (issue) {
                    throw new Error(issue.message);
                }
            }

            if (request.status === "CLOSED" && existing.status !== "CLOSED") {
                const position = await this.overdraftService.getPosition(existing);

                if (position.used > 0) {
                    throw new Error(
                        "This overdraft can't be marked Closed while part of its limit is still used. Link the repayments first, or choose On Hold instead."
                    );
                }
            }

            request = {
                ...request,
                ...LoanService.OVERDRAFT_TERM_FIELDS,
                ...terms,
                loanKind: LoanKind.OVERDRAFT,
            };
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
                // undefined (a caller that doesn't send it) means "unchanged".
                (request.firstInstallmentAmount !== undefined &&
                    normalizeNumber(existing.firstInstallmentAmount) !==
                        normalizeNumber(request.firstInstallmentAmount)) ||
                normalizeString(existing.maturityDate) !==
                    normalizeString(
                        request.maturityDate
                    );

            if (termsChanged) {
                throw new Error(
                    "This loan's EMI schedule has already been generated, so its principal, interest rate, interest type, tenure, start date, currency, EMI amount, first instalment and maturity date can't be changed. Delete and recreate the loan if these terms were entered incorrectly."
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

        if (overdraftTerms) {
            // The OD's terms and its whole set of linked bank accounts, in
            // one atomic write (src-tauri/src/overdraft_update.rs).
            try {
                await this.repository.updateOverdraftAtomic({
                    loanId: request.id,
                    name: request.name,
                    loanAccountNumber,
                    lenderInstitutionId,
                    currencyId: request.currencyId,
                    interestRate: request.interestRate ?? 0,
                    startDate: request.startDate,
                    status: request.status,
                    notes: request.notes ?? null,
                    creditLimit: overdraftTerms.creditLimit,
                    openingUsed: overdraftTerms.openingUsed,
                    openingUsedAsOf: overdraftTerms.openingUsedAsOf,
                    accountIds: overdraftTerms.accountIds,
                    // A drawing power revision, only when the caller sent one.
                    // A Dropline has none: its steps are sent instead.
                    updateDrawingPower:
                        request.drawingPowerSchedule === undefined && request.drawingPower !== undefined,
                    drawingPower: request.drawingPower ?? null,
                    ...(request.drawingPowerSchedule !== undefined
                        ? {
                              updateDrawingPowerSchedule: true,
                              drawingPowerSchedule: request.drawingPowerSchedule.map(step => ({
                                  id: crypto.randomUUID(),
                                  effectiveDate: step.effectiveDate,
                                  drawingPower: step.drawingPower,
                              })),
                          }
                        : {}),
                });
            } catch (error) {
                // A Tauri refusal is a plain string - show the user its message.
                throw error instanceof Error
                    ? error
                    : new Error(String(error).replace(/^OVERDRAFT_UPDATE_REFUSED: /, ""));
            }
        } else {
            await this.repository.update({
                ...request,
                loanAccountNumber,
                accountId: this.normalizeAccountId(
                    request.accountId
                ),
                lenderInstitutionId,
            });
        }

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

        // Same rule for an Overdraft: its linked transactions are its
        // history. Unlinking never touches a transaction.
        if (isOverdraft(loan) && (await this.overdraftService.hasLinks(id))) {
            throw new Error(
                "This overdraft has linked transactions and can't be deleted. Unlink them first (Transactions, the green loan icon, Unlink), then try again."
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

        // The checks above give a fast, friendly answer; delete_loan_atomic
        // repeats every one of them (and the financial-plan check) inside
        // the delete's own transaction, so a stale read can never let a
        // protected loan through. Its refusal is shown as plain text.
        try {
            await this.repository.deleteAtomic({
                loanId: id,
                loanAccountId:
                    loanAccountId && !accountHasTransactions
                        ? loanAccountId
                        : null,
            });
        } catch (error) {
            const match = String(error instanceof Error ? error.message : error).match(
                /LOAN_DELETE_REFUSED: (.*)$/s
            );

            throw match ? new Error(match[1]) : error;
        }
    }
}
