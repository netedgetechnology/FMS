import type { BudgetLedgerEntry } from "./budgetSpending";

// ---------------------------------------------------------------------
// Phase 5 - Transaction Correctness
//
// ONE pure, transaction-level classifier that decides whether a ledger
// row is budget "actual spending", and for how much. calculateBudgetSpending
// calls this for every row instead of hand-rolling type / sign / EMI
// logic in the aggregation loop, and nothing downstream (UI, dashboard)
// re-implements any of it.
//
// What COUNTS as budget expense:
//  - normal bank / debit / cash expenses
//  - credit-card purchases (an "expense" on a CREDIT_CARD account is a
//    purchase; the payment that later clears the card is a separate
//    transfer, handled below)
//  - imported expenses (the `isImported` flag has no effect here)
//  - legitimate expense fees
//
// What is EXCLUDED:
//  - income (money in never adds to or reduces spending)
//  - bank transfers - `type === "transfer"` - even when they carry a
//    category and an amount (a transfer is a balance movement)
//  - credit-card bill / payment transactions:
//      * a Transfer row (separate `transfers` table) - never reaches the
//        engine at all;
//      * a `type === "transfer"` transaction, or the card-statement side
//        (`type === "income"` on the card) - dropped by the direction
//        gate below;
//      * an `type === "expense"` payment whose `cardReference` resolves
//        to a CREDIT_CARD account other than the one it is booked on -
//        dropped by the credit-card-payment rule below.
//    The original purchases on the card stay counted.
//  - investment transactions - these live in their own
//    `investment_transactions` table and never reach the engine
//  - loan principal repayment - see the EMI rule below
//
// Credit-card-payment rule:
//  A purchase is booked ON a credit-card account (accountId === that
//  card), so it never has a cardReference pointing at a *different*
//  card. A payment towards a card is booked on a bank account and, when
//  the transaction form's "Card Reference" picker was used, carries that
//  card's account id in `cardReference`. So: `type === "expense"` +
//  `cardReference` is a real CREDIT_CARD account id
//  (`context.creditCardAccountIds`) + `cardReference !== accountId` ==>
//  a card payment, excluded. No narration / payee text is inspected.
//
// Loan EMI rule:
//  A recorded EMI payment (LoanPaymentService.processPayment) is a single
//  `type === "expense"` transaction on the borrower's bank account for
//  the full instalment, linked 1:1 to a LoanPaymentSchedule row that
//  carries the principal / interest split. `context.emiInterestByTransactionId`
//  maps that transaction id to its interest portion: only the interest
//  counts as budget expense, the principal repayment never does.
//
// Known model limitations (documented, deferred to a later phase - the
// current schema cannot represent them without guessing):
//  - a credit-card bill payment that carries NO `cardReference` (e.g.
//    imported from a bank statement, or hand-entered without using the
//    "Card Reference" picker) has no structured link to the card and
//    still cannot be told apart from a real expense. A full fix needs a
//    small schema field - a nullable `transfer_account_id` /
//    counter-account on `transactions` - so every internal movement,
//    not just those tagged via the card picker, is identifiable. That
//    touches the transactions schema, form and import mapping and is
//    intentionally out of scope here.
//  - a bank debit that funds an investment (imported from a bank
//    statement, not entered through the Investments module) has no
//    field marking it as an investment contribution.
//  - refunds / reversals have no representation distinct from income.
//    A refund received as `type === "income"` is already excluded (it
//    does not inflate spending) but it cannot reduce a category's
//    spend. A negative-amount `expense` is NOT inferred to be a refund -
//    it keeps the Phase 2 `Math.abs` treatment.
// ---------------------------------------------------------------------

// Mirrors budgetSpending.ts's own numeric guard - kept local so this
// module has no runtime dependency on the aggregation engine.
function toFiniteNumber(value: unknown): number {
    const number = Number(value);

    return Number.isFinite(number) ? number : 0;
}

export interface BudgetSpendingContext {
    /**
     * transaction id -> the interest portion of a loan EMI payment.
     * When an entry's id is a key here, the row is a loan EMI payment:
     * only this interest amount is counted as budget expense; the
     * principal repayment portion is a liability movement and never
     * counts. Built from LoanPaymentSchedule rows that carry a linked
     * transaction id - see EMIScheduleService.getInterestByTransactionId.
     */
    emiInterestByTransactionId?: ReadonlyMap<string, number>;
    /**
     * Ids of every CREDIT_CARD-type account. An expense whose
     * `cardReference` is one of these (and is not the account the
     * expense itself is booked on) is a payment towards that card, not
     * spending - the purchases on the card are already counted.
     */
    creditCardAccountIds?: ReadonlySet<string>;
}

export type BudgetTransactionReason =
    | "soft-deleted"
    | "not-an-expense"
    | "credit-card-payment"
    | "loan-emi-interest"
    | "loan-emi-principal-only"
    | "expense";

export interface BudgetTransactionClassification {
    /** Whether the row contributes to budget "actual spending". */
    include: boolean;
    /**
     * The amount that counts as expense. Always 0 when `include` is
     * false. For a loan EMI this is the interest portion only.
     */
    amount: number;
    /** Why this verdict was reached. For debugging and tests only. */
    reason: BudgetTransactionReason;
}

const EXCLUDED = (
    reason: BudgetTransactionReason
): BudgetTransactionClassification => ({
    include: false,
    amount: 0,
    reason,
});

/**
 * Classify a single ledger row for budget spending. Pure: no I/O, no
 * clock, no mutation of the inputs.
 */
export function classifyBudgetTransaction(
    entry: BudgetLedgerEntry,
    context: BudgetSpendingContext = {}
): BudgetTransactionClassification {
    // Soft-deleted rows never count. getAll() already drops these; this
    // is a defensive second gate for callers passing repository rows.
    if (entry.deletedAt) {
        return EXCLUDED("soft-deleted");
    }

    // Direction gate (Phase 2 rule, unchanged). Income and transfers are
    // not spending - this is also what keeps a credit-card bill payment
    // (a transfer, or the income side on the card) and a transfer that
    // happens to carry a category / amount out of the totals.
    if (entry.type !== "expense") {
        return EXCLUDED("not-an-expense");
    }

    // Credit-card bill payment: money moved to settle a card, not a new
    // expense. Reliable, text-free signal - the row points at a real
    // CREDIT_CARD account it is not itself booked on. A purchase booked
    // on the card has accountId === that card (or no cardReference), so
    // it is never caught here.
    const cardReference = entry.cardReference ?? null;

    if (
        cardReference !== null &&
        cardReference !== entry.accountId &&
        context.creditCardAccountIds?.has(
            cardReference
        )
    ) {
        return EXCLUDED("credit-card-payment");
    }

    // Loan EMI payment: count the interest portion only.
    const emiInterest =
        entry.id != null
            ? context.emiInterestByTransactionId?.get(
                  entry.id
              )
            : undefined;

    if (emiInterest !== undefined) {
        const interest = Math.max(
            0,
            toFiniteNumber(emiInterest)
        );

        return {
            include: true,
            amount: interest,
            reason:
                interest > 0
                    ? "loan-emi-interest"
                    : "loan-emi-principal-only",
        };
    }

    // Normal expense: bank / debit / cash spend, credit-card purchase,
    // imported expense, fee - all identical here, counted at face value.
    // A negative stored amount keeps the Phase 2 Math.abs treatment; it
    // is NOT inferred to be a refund (the model has no refund concept).
    return {
        include: true,
        amount: Math.abs(
            toFiniteNumber(entry.amount)
        ),
        reason: "expense",
    };
}
