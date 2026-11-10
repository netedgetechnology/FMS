import { InstitutionRepository } from "@/modules/institutions/repositories/InstitutionRepository";
import { TransactionRepository } from "@/modules/transactions/repositories/TransactionRepository";
import type { Transaction } from "@/modules/transactions/types";

import { LoanRepository } from "../repositories/LoanRepository";
import { LoanSchedulePaymentRepository } from "../repositories/LoanSchedulePaymentRepository";
import { OverdraftTransactionLinkRepository } from "../repositories/OverdraftTransactionLinkRepository";
import {
    OVERDRAFT_ENTRY_KIND_LABELS,
    isOverdraft,
    type Loan,
    type OverdraftEntryKind,
    type OverdraftLinkSource,
    type OverdraftTransactionLink,
} from "../types";
import { computeOverdraftPosition, type OverdraftPosition } from "./overdraftPosition";
import { DrawingPowerScheduleRepository } from "../repositories/DrawingPowerScheduleRepository";
import { DROPLINE_OVERDRAFT_ENABLED, drawingPowerOn, type DrawingPowerStep } from "../setup/droplineSchedule";
import { localToday } from "../setup/historicalInstalments";
import type { OverdraftMatchState } from "./overdraftImportMatching";
import { kindFitsDirection, overdraftLinkRefusal } from "./overdraftRules";
import {
    NOT_LOAN_CATEGORY_REASON,
    isLoanLinkEligible,
    loadLoanLinkCategoryIds,
} from "./loanLinkEligibility";

// ---------------------------------------------------------------------
// Overdraft (OD) operations. An OD has no EMI schedule: its movements are
// EXISTING transactions linked to it (overdraft_transaction_links) - no
// second transaction is ever created. Linking and unlinking each write
// exactly one row in one statement. The used / available amounts are
// never stored: they are derived from the live transactions every time
// (OVERDRAFT_POSITIONS_SQL + computeOverdraftPosition).
// ---------------------------------------------------------------------

export class OverdraftService {
    private readonly loanRepository = new LoanRepository();

    private readonly linkRepository = new OverdraftTransactionLinkRepository();

    private readonly paymentRepository = new LoanSchedulePaymentRepository();

    private readonly transactionRepository = new TransactionRepository();

    private readonly institutionRepository = new InstitutionRepository();

    /** The OD's current position, freshly derived from its live transactions. */
    async getPosition(loan: Loan): Promise<OverdraftPosition> {
        const totals = (await this.linkRepository.getTotals(loan.id)) ?? {
            used: loan.openingUsed ?? 0,
            totalDrawdowns: 0,
            totalRepayments: 0,
            totalInterestCharges: 0,
            invalidLinks: 0,
        };

        return computeOverdraftPosition(loan.creditLimit, totals, await this.drawingPowerNow(loan));
    }

    /** A dropline's drawing power is the step in force today; otherwise the stored figure. */
    private async drawingPowerNow(loan: Loan): Promise<number | null | undefined> {
        if (!DROPLINE_OVERDRAFT_ENABLED) return loan.drawingPower;

        const steps = await this.getDrawingPowerSchedule(loan);

        return steps.length > 0 ? drawingPowerOn(steps, localToday()) : loan.drawingPower;
    }

    /**
     * A Dropline Overdraft's dated drawing-power steps, by date; [] for any
     * other overdraft - and always [] until migration 053 is applied, so
     * the table that does not exist yet is never queried.
     */
    async getDrawingPowerSchedule(loan: Loan): Promise<DrawingPowerStep[]> {
        if (!DROPLINE_OVERDRAFT_ENABLED || !isOverdraft(loan)) return [];

        return new DrawingPowerScheduleRepository().findByLoan(loan.id);
    }

    async getLinkByTransactionId(
        transactionId: string
    ): Promise<OverdraftTransactionLink | null> {
        return await this.linkRepository.getByTransactionId(transactionId);
    }

    async getLinkedTransactionIds(): Promise<string[]> {
        return await this.linkRepository.getAllTransactionIds();
    }

    async hasLinks(loanId: string): Promise<boolean> {
        return (await this.linkRepository.getAllByLoanId(loanId)).length > 0;
    }

    /**
     * Links an existing transaction to an OD as the given kind. Refused,
     * with nothing written, when it does not fit (wrong account,
     * direction, date ...) or is already linked - to an OD or as a loan
     * EMI payment.
     */
    async link(request: {
        transactionId: string;
        loanId: string;
        entryKind: OverdraftEntryKind;
        source?: OverdraftLinkSource;
    }): Promise<{ loan: Loan; link: OverdraftTransactionLink }> {
        const [transaction, loan] = await Promise.all([
            this.transactionRepository.getById(request.transactionId),
            this.loanRepository.getById(request.loanId),
        ]);

        if (!transaction) {
            throw new Error("The transaction was not found.");
        }

        if (!loan) {
            throw new Error("The overdraft was not found.");
        }

        const refusal =
            (await this.alreadyLinkedRefusal(transaction.id)) ??
            (isLoanLinkEligible(transaction, await loadLoanLinkCategoryIds())
                ? null
                : NOT_LOAN_CATEGORY_REASON) ??
            overdraftLinkRefusal(transaction, loan);

        if (refusal) {
            throw new Error(refusal);
        }

        if (!kindFitsDirection(request.entryKind, transaction)) {
            throw new Error(
                `A ${transaction.type === "income" || transaction.transferDirection === "IN" ? "money-in" : "money-out"} transaction can't be an overdraft ${OVERDRAFT_ENTRY_KIND_LABELS[request.entryKind].toLowerCase()}.`
            );
        }

        await this.linkRepository.insert({
            id: crypto.randomUUID(),
            loanId: loan.id,
            transactionId: transaction.id,
            entryKind: request.entryKind,
            linkSource: request.source ?? "MANUAL",
        });

        // The insert writes nothing when the transaction became a loan EMI
        // payment meanwhile - confirm what is really stored.
        const link = await this.linkRepository.getByTransactionId(transaction.id);

        if (!link || link.loanId !== loan.id) {
            throw new Error(
                (await this.alreadyLinkedRefusal(transaction.id)) ??
                    "The transaction could not be linked to the overdraft."
            );
        }

        return { loan, link };
    }

    /** Unlink: removes only the link - the transaction is kept exactly as it is. */
    async unlink(transactionId: string): Promise<void> {
        const link = await this.linkRepository.getByTransactionId(transactionId);

        if (!link) {
            throw new Error("This transaction is not linked to an overdraft any more.");
        }

        await this.linkRepository.deleteByTransactionId(transactionId);
    }

    /** Why this transaction is already taken, or null. */
    async alreadyLinkedRefusal(transactionId: string): Promise<string | null> {
        const [payment, link] = await Promise.all([
            this.paymentRepository.getByTransactionId(transactionId),
            this.linkRepository.getByTransactionId(transactionId),
        ]);

        if (payment) {
            const loan = await this.loanRepository.getById(payment.loanId);

            return `This transaction is already recorded as a payment of ${loan?.name ?? "a loan"}.`;
        }

        if (link) {
            const loan = await this.loanRepository.getById(link.loanId);

            return `This transaction is already linked to ${loan?.name ?? "an overdraft"}.`;
        }

        return null;
    }

    /** Everything the OD import matcher needs about one overdraft. */
    async loadMatchState(loan: Loan): Promise<OverdraftMatchState> {
        const [links, lender] = await Promise.all([
            this.linkRepository.getAllByLoanId(loan.id),
            loan.lenderInstitutionId
                ? this.institutionRepository.getById(loan.lenderInstitutionId)
                : Promise.resolve(null),
        ]);

        const transactions = new Map<string, Transaction>(
            (
                await this.transactionRepository.getByIds(
                    links.map(link => link.transactionId)
                )
            ).map(transaction => [transaction.id, transaction])
        );

        return {
            loan,
            lenderName: lender?.name ?? null,
            links: links.map(link => ({
                ...link,
                transaction: transactions.get(link.transactionId) ?? null,
            })),
        };
    }

    async getOverdrafts(): Promise<Loan[]> {
        return (await this.loanRepository.getAll()).filter(isOverdraft);
    }
}
