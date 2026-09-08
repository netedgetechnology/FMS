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
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    async findDuplicate(
        accountId: string,
        transactionDate: string,
        type: string,
        amount: number,
        referenceNumber: string | null,
        payee: string,
        description: string
    ): Promise<Transaction | null> {
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
                  AND type = ?
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
                LIMIT 1
                `,
                [
                    accountId,
                    transactionDate,
                    type,
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
