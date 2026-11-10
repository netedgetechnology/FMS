import { balanceSide } from "@/core/accounting/transferClassification";

import type { Loan, OverdraftTransactionLink } from "../types";
import { OVERDRAFT_ENTRY_KIND_LABELS, OverdraftEntryKind, overdraftAccountIds } from "../types";
import { LoanStatus } from "../types/LoanStatus";
import {
    sameSignature,
    transactionNamesLoan,
    type LoanMatchTransaction,
} from "./loanImportMatching";
import { kindFitsDirection, overdraftLinkRefusal } from "./overdraftRules";

// ---------------------------------------------------------------------
// Automatic Overdraft matching for imported statement transactions - the
// pure decision (LoanImportPaymentService loads the state and applies it).
// An OD is never sent through EMI matching: there is no schedule, no
// instalment and no expected amount - the actual transaction amount is
// what moves the OD.
//
// LEARNED ONLY. A transaction is linked to an OD automatically only when
// it has the same payment signature as a transaction the USER linked to
// that OD by hand (Transactions -> Link to Loan): the same direction and
// narration pattern (the Self-Learning key) and no conflicting payment
// type, payee or counterparty - exactly the Term Loan signature
// (sameSignature). The account side of that signature is the OD's set of
// linked bank accounts: a pattern taught on one of them is recognised on
// any of them (one OD facility used through several accounts), never on
// an account the OD is not linked to. The amount is never part of it: it
// does not say which OD a transaction belongs to. The kind (Drawdown /
// Repayment / Interest-Charge) is the one the user chose for that pattern.
//
// Sent to review instead (never guessed):
//   - more than one OD has learned the pattern;
//   - the pattern was linked as more than one kind;
//   - the transaction only NAMES an OD or its lender, with no learned
//     pattern yet (a name is not enough to pick an OD);
//   - it would not count (e.g. on or before the opening used date).
// Anything else is not an OD movement: "none".
// ---------------------------------------------------------------------

export interface OverdraftMatchTransaction extends LoanMatchTransaction {
    transferDirection?: string | null;
}

export interface OverdraftMatchLink extends OverdraftTransactionLink {
    /** The link's live transaction - null when it no longer exists or is deleted. */
    transaction: OverdraftMatchTransaction | null;
}

export interface OverdraftMatchState {
    loan: Loan;
    lenderName: string | null;
    links: OverdraftMatchLink[];
}

export type OverdraftImportDecision =
    | { kind: "apply"; loanId: string; entryKind: OverdraftEntryKind }
    | { kind: "review"; loanIds: string[]; reason: string }
    | { kind: "none" };

/**
 * The transaction as its money side: a Transfer In counts as a credit
 * (income) and a Transfer Out as a debit (expense) - for the learned
 * signature only, never saved. OD principal movements are transfers (a
 * Loan Principal Drawdown / Repayment category), and their pattern must
 * still be recognised; a transfer with no direction has no side (null).
 */
function asMoneySide<T extends OverdraftMatchTransaction>(transaction: T): T | null {
    const side = balanceSide({
        type: transaction.type,
        transferDirection: transaction.transferDirection ?? null,
    });

    return side ? { ...transaction, type: side } : null;
}

/** The user's own links of this OD whose transaction has the same signature. */
function learnedLinks(
    transaction: OverdraftMatchTransaction,
    state: OverdraftMatchState
): OverdraftMatchLink[] {
    const accounts = overdraftAccountIds(state.loan);

    return state.links.filter(link => {
        const linked = link.transaction ? asMoneySide(link.transaction) : null;

        return (
            link.linkSource === "MANUAL" &&
            linked !== null &&
            linked.id !== transaction.id &&
            accounts.includes(linked.accountId) &&
            kindFitsDirection(link.entryKind, transaction) &&
            // Either of the OD's accounts stands for the facility.
            sameSignature(transaction, { ...linked, accountId: transaction.accountId })
        );
    });
}

function namesOverdraft(
    transaction: OverdraftMatchTransaction,
    state: OverdraftMatchState
): boolean {
    return transactionNamesLoan(transaction, {
        loan: state.loan,
        lenderName: state.lenderName,
        schedule: [],
        payments: [],
    });
}

export function decideOverdraftForTransaction(
    rawTransaction: OverdraftMatchTransaction,
    overdrafts: readonly OverdraftMatchState[]
): OverdraftImportDecision {
    // The learning key exists only for a money side (credit / debit): an
    // Income / Expense, or a Transfer In / Out taken as its side.
    const transaction = asMoneySide(rawTransaction);

    if (!transaction || !(transaction.amount > 0)) {
        return { kind: "none" };
    }

    const eligible = overdrafts.filter(
        state =>
            state.loan.status !== LoanStatus.CLOSED &&
            overdraftAccountIds(state.loan).includes(transaction.accountId)
    );

    const learned = eligible
        .map(state => ({ state, links: learnedLinks(transaction, state) }))
        .filter(item => item.links.length > 0);

    if (learned.length > 1) {
        return {
            kind: "review",
            loanIds: learned.map(item => item.state.loan.id),
            reason: `It matches more than one overdraft (${learned
                .map(item => item.state.loan.name)
                .join(", ")}), so it was not linked to any. Use Link to Loan to choose.`,
        };
    }

    if (learned.length === 1) {
        const { state, links } = learned[0]!;
        const learnedKinds = new Set(links.map(link => link.entryKind));
        // Fixed order, so the message never depends on link order.
        const kinds = Object.values(OverdraftEntryKind).filter(kind =>
            learnedKinds.has(kind)
        );

        if (kinds.length > 1) {
            return {
                kind: "review",
                loanIds: [state.loan.id],
                reason: `Transactions like this were linked to ${state.loan.name} as ${kinds
                    .map(kind => OVERDRAFT_ENTRY_KIND_LABELS[kind])
                    .join(" and as ")}, so it is not clear which this one is. Use Link to Loan to choose.`,
            };
        }

        const refusal = overdraftLinkRefusal(transaction, state.loan);

        if (refusal) {
            return { kind: "review", loanIds: [state.loan.id], reason: refusal };
        }

        return { kind: "apply", loanId: state.loan.id, entryKind: kinds[0]! };
    }

    const named = eligible.filter(state => namesOverdraft(transaction, state));

    if (named.length > 0) {
        return {
            kind: "review",
            loanIds: named.map(state => state.loan.id),
            reason: `It looks like it may be for ${named
                .map(state => state.loan.name)
                .join(" or ")}, but no transaction like it has been linked yet. If it is, use Link to Loan - future ones like it will then be linked automatically.`,
        };
    }

    return { kind: "none" };
}
