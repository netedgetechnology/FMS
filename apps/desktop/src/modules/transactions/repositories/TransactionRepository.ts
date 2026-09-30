import { transferDirectionForType } from "@/core/accounting/transferClassification";
import { Repository } from "@/core/database/engine/Repository";

import {
    Transaction,
    UpdateTransactionRequest,
} from "../types";

// A reference/cheque number that carries no real identifying
// information - a blank/whitespace-only value, or one of the common
// "not applicable" placeholders banks put in that column (e.g. Axis
// Bank leaves "-" for most non-cheque rows). Never a genuine
// transaction identifier, so it must never be used to match two
// transactions as duplicates of each other.
export function isPlaceholderReference(
    value: string | null | undefined
): boolean {
    if (!value) {
        return true;
    }

    const normalized = value.trim().toUpperCase();

    if (normalized === "") {
        return true;
    }

    if (/^-+$/.test(normalized)) {
        return true;
    }

    return (
        normalized === "NA" ||
        normalized === "N/A"
    );
}

export class TransactionRepository extends Repository {

    private readonly selectFields = `
        id,
        account_id AS accountId,
        category_id AS categoryId,
        subcategory_id AS subcategoryId,
        payee,
        counterparty,
        branch,
        type,
        transfer_direction AS transferDirection,
        amount,
        transaction_date AS transactionDate,
        reference_number AS referenceNumber,
        notes,
        tags,
        status,
        payment_method AS paymentMethod,
        upi_reference AS upiReference,
        bank_transaction_reference AS bankTransactionReference,
        card_reference AS cardReference,
        transaction_type AS transactionType,
        reconciled,
        reconciled_at AS reconciledAt,
        is_imported AS isImported,
        source_statement AS sourceStatement,
        external_transaction_id AS externalTransactionId,
        original_narration AS originalNarration,
        created_at AS createdAt,
        updated_at AS updatedAt
    `;

    async getAll(): Promise<Transaction[]> {
        return await this.select<Transaction>(
            `
            SELECT
                ${this.selectFields}
            FROM transactions
            WHERE deleted_at IS NULL
            ORDER BY transaction_date DESC,
                     created_at DESC
            `
        );
    }

    /**
     * Whether any live (non-soft-deleted) transaction is booked on
     * this account - used to decide whether a loan's linked liability
     * account is safe to remove alongside the loan itself
     * (LoanService.delete(), Loans - Delete Loan). An account with any
     * real transaction on it is never deleted automatically.
     */
    async existsForAccount(
        accountId: string
    ): Promise<boolean> {
        const rows = await this.select<{ id: string }>(
            `
            SELECT id
            FROM transactions
            WHERE account_id = ?
              AND deleted_at IS NULL
            LIMIT 1
            `,
            [accountId]
        );

        return rows.length > 0;
    }

    async getById(id: string): Promise<Transaction | null> {
        const rows = await this.select<Transaction>(
            `
            SELECT
                ${this.selectFields}
            FROM transactions
            WHERE id = ?
              AND deleted_at IS NULL
            `,
            [id]
        );

        return rows[0] ?? null;
    }

    async create(transaction: Transaction): Promise<void> {
        await this.execute(
            `
            INSERT INTO transactions
            (
                id,
                account_id,
                category_id,
                subcategory_id,
                payee,
                counterparty,
                branch,
                type,
                transfer_direction,
                amount,
                transaction_date,
                reference_number,
                notes,
                tags,
                status,
                payment_method,
                upi_reference,
                bank_transaction_reference,
                card_reference,
                transaction_type,
                reconciled,
                reconciled_at,
                is_imported,
                source_statement,
                external_transaction_id,
                original_narration,
                created_at,
                updated_at
            )
            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                transaction.id,
                transaction.accountId,
                transaction.categoryId,
                transaction.subcategoryId,
                transaction.payee,
                transaction.counterparty,
                transaction.branch,
                transaction.type,
                // One source of direction: only a transfer stores one -
                // an income/expense row's direction IS its type.
                transaction.type === "transfer"
                    ? transaction.transferDirection ?? null
                    : null,
                transaction.amount,
                transaction.transactionDate,
                transaction.referenceNumber,
                transaction.notes,
                transaction.tags,
                transaction.status,
                transaction.paymentMethod,
                transaction.upiReference,
                transaction.bankTransactionReference,
                transaction.cardReference,
                transaction.transactionType,
                transaction.reconciled ? 1 : 0,
                transaction.reconciledAt,
                transaction.isImported ? 1 : 0,
                transaction.sourceStatement,
                transaction.externalTransactionId,
                transaction.originalNarration,
                transaction.createdAt,
                transaction.updatedAt,
            ]
        );
    }

    async update(
        transaction: UpdateTransactionRequest
    ): Promise<void> {
        await this.execute(
            `
            UPDATE transactions
            SET
                account_id = ?,
                category_id = ?,
                subcategory_id = ?,
                payee = ?,
                counterparty = ?,
                branch = ?,
                type = ?,
                transfer_direction = ?,
                amount = ?,
                transaction_date = ?,
                reference_number = ?,
                notes = ?,
                tags = ?,
                status = ?,
                payment_method = ?,
                upi_reference = ?,
                bank_transaction_reference = ?,
                card_reference = ?,
                transaction_type = ?,
                reconciled = ?,
                reconciled_at = ?,
                is_imported = ?,
                source_statement = ?,
                external_transaction_id = ?,
                original_narration = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [
                transaction.accountId,
                transaction.categoryId,
                transaction.subcategoryId ?? null,
                transaction.payee,
                transaction.counterparty ?? null,
                transaction.branch ?? null,
                transaction.type,
                // One source of direction - see create().
                transaction.type === "transfer"
                    ? transaction.transferDirection ?? null
                    : null,
                transaction.amount,
                transaction.transactionDate,
                transaction.referenceNumber ?? null,
                transaction.notes ?? null,
                transaction.tags ?? null,
                transaction.status ?? "CLEARED",
                transaction.paymentMethod ?? null,
                transaction.upiReference ?? null,
                transaction.bankTransactionReference ?? null,
                transaction.cardReference ?? null,
                transaction.transactionType ?? null,
                transaction.reconciled ? 1 : 0,
                transaction.reconciledAt ?? null,
                transaction.isImported ? 1 : 0,
                transaction.sourceStatement ?? null,
                transaction.externalTransactionId ?? null,
                transaction.originalNarration ?? null,
                transaction.id,
            ]
        );
    }

    // A transaction is a duplicate only when it's for the same account,
    // same date, same type, and same amount (never touched or relaxed -
    // a stored transfer counts as the Debit/Credit side its
    // transfer_direction represents, so a row later re-classified as a
    // Transfer is still recognised on re-import -
    // this is what actually distinguishes one transaction from
    // another), AND its identity is then confirmed by a priority/
    // fallback chain - never by treating Payee, narration, and
    // reference as three independent, equally-weighted signals (Payee
    // in particular is often a short/generic label - and, since the
    // account-scoped Payee/Type/Notes learning feature deliberately
    // gives many genuinely different transactions sharing a narration
    // pattern the *same* Payee, trusting it alone would make same-day/
    // same-amount/same-payee transactions falsely collapse into
    // "duplicates" and silently vanish on import):
    //
    //   1. A matching *real* reference number (both sides non-
    //      placeholder - see isPlaceholderReference) is sufficient on
    //      its own; a bank-assigned reference/UTR is effectively a
    //      unique transaction id.
    //   2. Otherwise, when the incoming transaction has real narration
    //      text, that narration must match - Payee is never consulted
    //      while usable narration exists to check instead.
    //   3. Only when the incoming transaction has no narration text at
    //      all does Payee serve as the fallback identity signal.
    //
    // A blank/placeholder reference never participates in matching, on
    // either side - so many genuinely different transactions that all
    // happen to share a bank's "no reference" placeholder can never
    // collapse into duplicates of each other. Soft-deleted transactions
    // (deleted_at IS NOT NULL) never participate at all.
    //
    // `excludeTransactionIds` never changes the matching rules above -
    // it only removes specific transactions from the pool being matched
    // against. Statement import (ImportService.executeCandidates) passes
    // the transactions its own batch has created so far, so a row is
    // only ever compared with transactions that existed BEFORE that
    // import started - two legitimately identical rows on one statement
    // (same date/amount/narration/reference) must both import, while a
    // re-import of an already-imported statement is still caught.
    async findDuplicate(
        accountId: string,
        transactionDate: string,
        type: string,
        amount: number,
        referenceNumber: string | null,
        payee: string,
        description: string,
        excludeTransactionIds?: ReadonlySet<string>
    ): Promise<Transaction | null> {
        const hasExclusions =
            excludeTransactionIds !== undefined &&
            excludeTransactionIds.size > 0;

        const hasReference =
            !isPlaceholderReference(referenceNumber);

        const hasNarration =
            description.trim().length > 0;

        const matches =
            await this.select<Transaction>(
                `
                SELECT
                    ${this.selectFields}
                FROM transactions
                WHERE account_id = ?
                  AND transaction_date = ?
                  AND (
                      type = ?
                      OR (type = 'transfer' AND transfer_direction = ?)
                  )
                  AND amount = ?
                  AND deleted_at IS NULL
                  AND (
                      (
                          ? = 1
                          AND reference_number IS NOT NULL
                          AND TRIM(reference_number) <> ''
                          AND UPPER(TRIM(reference_number))
                              NOT IN ('NA', 'N/A')
                          AND TRIM(TRIM(reference_number), '-') <> ''
                          AND LOWER(TRIM(reference_number)) =
                              LOWER(TRIM(?))
                      )
                      OR
                      (
                          ? = 1
                          AND LOWER(TRIM(original_narration)) =
                              LOWER(TRIM(?))
                      )
                      OR
                      (
                          ? = 0
                          AND ? <> ''
                          AND LOWER(TRIM(payee)) =
                              LOWER(TRIM(?))
                      )
                  )
                ${hasExclusions ? "" : "LIMIT 1"}
                `,
                [
                    accountId,
                    transactionDate,
                    type,
                    transferDirectionForType(type),
                    amount,
                    hasReference ? 1 : 0,
                    referenceNumber,
                    hasNarration ? 1 : 0,
                    description,
                    hasNarration ? 1 : 0,
                    payee,
                    payee,
                ]
            );

        // Filtered here rather than via a bound `id NOT IN (...)` list,
        // which a large statement (1000+ rows) would push past SQLite's
        // bound-parameter limit. The candidate set is already narrowed to
        // one account/date/amount/direction, so it is always tiny.
        if (hasExclusions) {
            return (
                matches.find(
                    match => !excludeTransactionIds!.has(match.id)
                ) ?? null
            );
        }

        return matches[0] ?? null;
    }

    /**
     * A lighter-weight duplicate check for the manual Add Transaction
     * flow (AddTransactionDialog) - separate from findDuplicate() above,
     * which statement import de-duplication (ImportService) relies on
     * and which this must never affect.
     *
     * findDuplicate()'s narration/reference-first priority cascade is
     * correct for imports, where bank narration is the strongest
     * identity signal available - but it produces false negatives for
     * manual entry. A non-empty incoming Description forces a
     * narration-only comparison against the existing row's narration
     * and ignores an otherwise-matching payee entirely; two manually
     * entered transactions that are identical in every way a user would
     * call "the same transaction" (account, category, type, amount,
     * date, payee) can differ only in whether/what Description text was
     * typed and findDuplicate() would then never flag them.
     *
     * This instead matches on the fields that actually define "the same
     * transaction" for manual entry: account, category (including both
     * being uncategorized), type, amount, date and payee. Notes,
     * Description and Reference Number never gate the match - a
     * legitimate second transaction with a different note is still a
     * different transaction, but this check exists to catch the
     * accidental double-click/double-submit case, not to distinguish
     * genuinely different entries by their free-text fields.
     */
    async findManualDuplicate(
        accountId: string,
        categoryId: string | null,
        transactionDate: string,
        type: string,
        amount: number,
        payee: string
    ): Promise<Transaction | null> {
        const matches =
            await this.select<Transaction>(
                `
                SELECT
                    ${this.selectFields}
                FROM transactions
                WHERE account_id = ?
                  AND transaction_date = ?
                  AND (
                      type = ?
                      OR (type = 'transfer' AND transfer_direction = ?)
                  )
                  AND amount = ?
                  AND deleted_at IS NULL
                  AND (
                      (category_id IS NULL AND ? IS NULL)
                      OR category_id = ?
                  )
                  AND LOWER(TRIM(payee)) = LOWER(TRIM(?))
                LIMIT 1
                `,
                [
                    accountId,
                    transactionDate,
                    type,
                    transferDirectionForType(type),
                    amount,
                    categoryId,
                    categoryId,
                    payee,
                ]
            );

        return matches[0] ?? null;
    }

    async delete(id: string): Promise<void> {
        await this.execute(
            `
            UPDATE transactions
            SET deleted_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
            [id]
        );
    }

    // The live (non-deleted) transactions among `ids`, in one query. The
    // ids travel as a single JSON array bind (json_each), so there's no
    // bound-parameter limit however many are selected.
    async getByIds(
        ids: readonly string[]
    ): Promise<Transaction[]> {
        return await this.select<Transaction>(
            `
            SELECT
                ${this.selectFields}
            FROM transactions
            WHERE id IN (SELECT value FROM json_each(?))
              AND deleted_at IS NULL
            `,
            [JSON.stringify(ids)]
        );
    }

    // Bulk "Change Category": sets category_id (and updated_at) on every
    // given live transaction in ONE statement - SQLite applies a single
    // UPDATE atomically, so either every row changes or none does.
    // `makeTransfer` (a TRANSFER category): the same statement also sets
    // type = 'transfer' and keeps each row's money direction in
    // transfer_direction (expense -> OUT, income -> IN; an existing
    // transfer keeps its own) - so category and type can never be left
    // half-updated. Nothing else is touched: amount, account, dates,
    // payee, sub-category, reconciliation state stay exactly as they are.
    // Deleted transactions are never updated.
    async updateCategoryForIds(
        ids: readonly string[],
        categoryId: string,
        makeTransfer = false
    ): Promise<void> {
        await this.execute(
            makeTransfer
                ? `
            UPDATE transactions
            SET
                category_id = ?,
                transfer_direction = CASE type
                    WHEN 'expense' THEN 'OUT'
                    WHEN 'income' THEN 'IN'
                    ELSE transfer_direction
                END,
                type = 'transfer',
                updated_at = CURRENT_TIMESTAMP
            WHERE id IN (SELECT value FROM json_each(?))
              AND deleted_at IS NULL
            `
                : `
            UPDATE transactions
            SET
                category_id = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id IN (SELECT value FROM json_each(?))
              AND deleted_at IS NULL
            `,
            [categoryId, JSON.stringify(ids)]
        );
    }

    // Bulk "Move to Account": reassigns every given live transaction to
    // `accountId` in ONE statement - SQLite applies a single UPDATE
    // atomically, so either every row moves or none does. Only account_id
    // (and updated_at) change: id, type/direction, amount, dates, payee,
    // category, notes, references, reconciliation state and import
    // linkage stay exactly as they are. Rows already in `accountId` and
    // deleted transactions are left alone.
    async moveToAccountForIds(
        ids: readonly string[],
        accountId: string
    ): Promise<void> {
        await this.execute(
            `
            UPDATE transactions
            SET
                account_id = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id IN (SELECT value FROM json_each(?))
              AND deleted_at IS NULL
              AND account_id <> ?
            `,
            [accountId, JSON.stringify(ids), accountId]
        );
    }

    // Keeps every already-imported transaction's Mapping Name
    // (source_statement) in sync when a Saved Mapping is renamed (see
    // ImportService.renameMapping) - matched by the mapping's exact prior
    // name, since source_statement stores that name as free text, not a
    // foreign key to import_mappings. Never touches any other field.
    async renameSourceStatement(
        oldName: string,
        newName: string
    ): Promise<void> {
        await this.execute(
            `
            UPDATE transactions
            SET source_statement = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE source_statement = ?
              AND deleted_at IS NULL
            `,
            [newName, oldName]
        );
    }
}
