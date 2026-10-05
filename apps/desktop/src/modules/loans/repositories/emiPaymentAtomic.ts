import { invoke } from "@tauri-apps/api/core";

import type { Transaction } from "@/modules/transactions/types";

import type { LoanSchedulePayment } from "../types";

// ---------------------------------------------------------------------
// Atomic EMI payment writes - see src-tauri/src/loan_payment.rs for why
// these cannot go through SQLiteProvider's beginTransaction()/execute()/
// commit() (that sequence lands BEGIN, the writes and COMMIT on different
// pooled connections: the writes auto-commit and COMMIT fails).
// ---------------------------------------------------------------------

// Must match loan_payment.rs's GUARD_PREFIX.
const REFUSAL_PREFIX = "EMI_PAYMENT_REFUSED: ";

export interface EmiScheduleState {
    id: string;
    status: string;
    paidDate: string | null;
    paidAmount: number | null;
    transactionId: string | null;
}

export interface EmiLoanBalances {
    id: string;
    outstandingPrincipal: number;
    outstandingInterest: number;
    status: string;
}

export interface RecordEmiPaymentRequest {
    transaction: Transaction;
    payment: Omit<LoanSchedulePayment, "createdAt">;
    schedule: EmiScheduleState;
    loan: EmiLoanBalances;
}

export interface ReverseEmiPaymentRequest {
    paymentId: string;
    // The payment's bank transaction to soft-delete; null when it no
    // longer exists.
    transactionId: string | null;
    schedule: EmiScheduleState;
    loan: EmiLoanBalances;
}

/**
 * A technical failure while saving an EMI payment change (a database or
 * IPC error) - as opposed to a business-rule refusal, which is a plain
 * Error with a user-facing message. Nothing was saved either way (the
 * write is atomic). `message` is safe to show the user; `technicalDetail`
 * is the raw cause, for the console/diagnostics only.
 */
export class EmiPaymentSaveError extends Error {
    readonly technicalDetail: string;

    constructor(message: string, technicalDetail: string) {
        super(message);
        this.name = "EmiPaymentSaveError";
        this.technicalDetail = technicalDetail;
    }
}

function toError(raw: unknown, technicalMessage: string): Error {
    const text =
        raw instanceof Error
            ? raw.message
            : typeof raw === "string"
                ? raw
                : String(raw);

    if (text.startsWith(REFUSAL_PREFIX)) {
        return new Error(text.slice(REFUSAL_PREFIX.length));
    }

    return new EmiPaymentSaveError(technicalMessage, text);
}

export async function recordEmiPaymentAtomic(
    request: RecordEmiPaymentRequest
): Promise<void> {
    try {
        await invoke("record_emi_payment_atomic", { request });
    } catch (error) {
        throw toError(
            error,
            "The EMI payment could not be saved because of a technical problem. Nothing was recorded - please try again."
        );
    }
}

export async function reverseEmiPaymentAtomic(
    request: ReverseEmiPaymentRequest
): Promise<void> {
    try {
        await invoke("reverse_emi_payment_atomic", { request });
    } catch (error) {
        throw toError(
            error,
            "The EMI payment could not be reversed because of a technical problem. Nothing was changed - please try again."
        );
    }
}
