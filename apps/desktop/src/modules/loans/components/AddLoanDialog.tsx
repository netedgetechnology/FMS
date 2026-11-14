import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

import { getErrorMessage } from "@/core/errors";

import { AddLoanWizard } from "./setup/AddLoanWizard";
import { StatementImportPanel } from "./setup/StatementImportPanel";
import { StatementRateChangesStep, UnrecordedConfirmation } from "./rates/StatementRateChangesStep";
import { unrecordedNotice, type ConfirmedRateChange, type ConfirmedStatementRates } from "../statementImport/statementRateProposals";
import { InterestRateHistoryRepository } from "../repositories/InterestRateHistoryRepository";
import type { StatementDraftResult } from "../statementImport/statementToDraft";
import { LoanService } from "../services";
import { LoanKind, type CreateLoanRequest } from "../types";
import type { LoanFormValues } from "../validation";
import type { LoanSetupDraft } from "../setup/loanSetupTypes";

export interface AddLoanDialogProps {
    onSuccess?: () => Promise<void> | void;
    /** Optional prefill (kept for callers of the older single-form dialog). */
    defaultValues?: Partial<LoanFormValues>;
    trigger?: ReactElement;
}

/** An older LoanForm prefill, as the setup wizard's draft. */
function draftFromDefaults(values: Partial<LoanFormValues> | undefined): Partial<LoanSetupDraft> | undefined {
    if (!values) return undefined;

    const draft: Partial<LoanSetupDraft> = {};
    if (values.name !== undefined) draft.name = values.name;
    if (values.loanType !== undefined) draft.loanCategory = values.loanType;
    if (values.lenderInstitutionName) draft.lenderName = values.lenderInstitutionName;
    if (values.loanAccountNumber) draft.loanAccountNumber = values.loanAccountNumber;
    if (values.accountId) draft.linkedAccountId = values.accountId;
    if (values.currencyId) draft.currencyId = values.currencyId;
    if (values.principalAmount) draft.principalAmount = values.principalAmount;
    if (values.interestRate !== undefined) draft.interestRate = values.interestRate;
    if (values.interestType === "FLAT") draft.interestMethod = "FLAT";
    if (values.tenureMonths) draft.tenureMonths = values.tenureMonths;
    if (values.startDate) draft.startDate = values.startDate;
    return draft;
}

export type SubmitLoanCreateResult =
    | { success: true; loanId: string }
    | { success: false; message: string };

/**
 * The create-and-report-outcome logic behind the dialog's Save button,
 * pulled out of the component so it is unit testable without a jsdom /
 * component-render setup (this repo has none - see
 * DeletePlanComponentDialog.test.ts for the same convention). Always
 * *resolves* - on both success and failure - so a caller's own
 * try/finally (here, the dialog's `setLoading(false)`) is guaranteed
 * to run and the "Saving..." state can never hang indefinitely on this
 * function's account.
 *
 * A Tauri invoke() rejection (every SQL/Rust command, including the
 * loan-create transaction) is a plain string, never an Error instance
 * - see getErrorMessage's own doc comment. Routing through it here is
 * what surfaces the real cause (e.g. an actual foreign-key or
 * database-locked failure) instead of a generic message.
 */
export async function submitLoanCreate(
    service: Pick<LoanService, "create">,
    values: CreateLoanRequest,
    onSuccess: (() => Promise<void> | void) | undefined
): Promise<SubmitLoanCreateResult> {
    try {
        const loanId = await service.create(values);
        await onSuccess?.();

        return { success: true, loanId };
    } catch (error) {
        console.error("Failed to create loan:", error);

        return {
            success: false,
            message: getErrorMessage(
                error,
                "Failed to create loan. Please try again."
            ),
        };
    }
}

export function AddLoanDialog({
    onSuccess,
    defaultValues,
    trigger,
}: AddLoanDialogProps) {
    const service = new LoanService();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // A fresh wizard every time the dialog opens.
    const [session, setSession] = useState(0);
    const [mode, setMode] = useState<"manual" | "statement">("manual");
    const [fromStatement, setFromStatement] = useState<(StatementDraftResult & { fileName: string }) | null>(null);
    // Stage 4: a statement Term Loan just created, whose confirmed rate
    // changes are recorded next through the reviewed workflow.
    const [rateFollowUp, setRateFollowUp] = useState<{ loanId: string; confirmed: ConfirmedStatementRates } | null>(null);
    // Audit H1: the follow-up's changes not recorded yet, and a close
    // (X / Escape / outside click / Cancel) waiting for its confirmation.
    const [unrecorded, setUnrecorded] = useState<{ changes: ConfirmedRateChange[]; loanName: string | null }>({ changes: [], loanName: null });
    const [closeRequested, setCloseRequested] = useState(false);
    const trackUnrecorded = useCallback((changes: ConfirmedRateChange[], loanName: string | null) => setUnrecorded({ changes, loanName }), []);
    // Whether a statement's rate changes can be saved (migration 054 applied).
    // Until then they are shown for information only and nothing changes.
    const [rateHistoryAvailable, setRateHistoryAvailable] = useState(false);

    useEffect(() => {
        if (!open) return;
        let mounted = true;
        new InterestRateHistoryRepository()
            .isAvailable()
            .then(available => mounted && setRateHistoryAvailable(available))
            .catch(error => {
                console.error("Failed to check interest rate history:", error);
                if (mounted) setRateHistoryAvailable(false);
            });
        return () => {
            mounted = false;
        };
    }, [open]);

    function handleOpenChange(next: boolean) {
        if (next) {
            setError(null);
            setMode("manual");
            setFromStatement(null);
            setRateFollowUp(null);
            setUnrecorded({ changes: [], loanName: null });
            setCloseRequested(false);
            setSession(value => value + 1);
        } else if (rateFollowUp) {
            // Never close past unrecorded statement rate changes silently.
            if (unrecorded.changes.length > 0) {
                setCloseRequested(true);
                return;
            }
            finishFollowUp([], unrecorded.loanName);
            return;
        }

        setOpen(next);
    }

    /** Ends the Term follow-up; changes left unrecorded are announced until dismissed. */
    function finishFollowUp(left: readonly ConfirmedRateChange[], loanName: string | null) {
        setCloseRequested(false);
        setRateFollowUp(null);
        setUnrecorded({ changes: [], loanName: null });
        setOpen(false);
        void onSuccess?.();
        const notice = unrecordedNotice(loanName, left);
        if (notice) toast.warning(notice, { duration: Infinity, action: { label: "OK", onClick: () => undefined } });
    }

    async function handleSubmit(values: CreateLoanRequest, rateChanges: ConfirmedStatementRates | null = null) {
        setLoading(true);
        setError(null);

        try {
            const result = await submitLoanCreate(
                service,
                values,
                onSuccess
            );

            if (result.success) {
                toast.success(
                    values.loanKind === LoanKind.OVERDRAFT
                        ? "Overdraft created successfully."
                        : "Loan created successfully."
                );
                if (rateChanges && rateChanges.changes.length > 0) {
                    setUnrecorded({ changes: rateChanges.changes, loanName: values.name || null });
                    setCloseRequested(false);
                    setRateFollowUp({ loanId: result.loanId, confirmed: rateChanges });
                } else {
                    setOpen(false);
                }
            } else {
                setError(result.message);
                toast.error(result.message);
            }
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={handleOpenChange}
        >
            <DialogTrigger
                render={
                    trigger ?? (
                        <button
                            type="button"
                            className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md active:scale-[0.98]"
                        >
                            Add Loan
                        </button>
                    )
                }
            >
                Add Loan
            </DialogTrigger>

            <DialogContent
                showCloseButton
                className="
                    w-[920px]
                    max-w-[calc(100vw-48px)]
                    gap-0
                    overflow-hidden
                    rounded-[28px]
                    border border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="px-7 pb-4 pt-5">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Add Loan
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Set up the loan completely: its terms, how it was
                        disbursed, what it cost and its repayment schedule.
                        Nothing is saved until you confirm on Review.
                    </DialogDescription>
                </DialogHeader>

                {error && (
                    <div className="mx-7 mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                        {error}
                    </div>
                )}

                <div className="max-h-[calc(100vh-180px)] space-y-4 overflow-y-auto border-t border-slate-100 px-7 py-5">
                    {rateFollowUp && closeRequested && unrecorded.changes.length > 0 && (
                        <UnrecordedConfirmation
                            unrecorded={unrecorded.changes}
                            action="Close"
                            onConfirm={() => finishFollowUp(unrecorded.changes, unrecorded.loanName)}
                            onCancel={() => setCloseRequested(false)}
                        />
                    )}
                    {rateFollowUp ? (
                        <StatementRateChangesStep
                            loanId={rateFollowUp.loanId}
                            confirmed={rateFollowUp.confirmed}
                            onUnrecordedChange={trackUnrecorded}
                            onDone={finishFollowUp}
                        />
                    ) : mode === "statement" ? (
                        <StatementImportPanel
                            onCancel={() => setMode("manual")}
                            // A Term Loan is saved straight from the review.
                            onSaveTermLoan={handleSubmit}
                            saving={loading}
                            rateHistoryAvailable={rateHistoryAvailable}
                            onContinue={(result, fileName) => {
                                setFromStatement({ ...result, fileName });
                                setSession(value => value + 1);
                                setMode("manual");
                            }}
                        />
                    ) : (
                        <>
                            {fromStatement ? (
                                <div className="space-y-1 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                                    <p className="font-medium">
                                        Filled from {fromStatement.fileName}. Check every step; anything the statement did not give is left blank.
                                    </p>
                                    {fromStatement.notes.map(note => (
                                        <p key={note}>{note}</p>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2">
                                    <span className="text-xs text-slate-600">
                                        Have a statement from your lender?
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setMode("statement")}
                                        className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                                    >
                                        Fill from Statement
                                    </button>
                                </div>
                            )}
                            <AddLoanWizard
                                key={session}
                                loading={loading}
                                initialDraft={fromStatement?.draft ?? draftFromDefaults(defaultValues)}
                                kindLocked={fromStatement !== null}
                                preferredCurrencyCode={fromStatement?.currencyCode ?? null}
                                statementFacts={fromStatement?.statementFacts ?? null}
                                statementRates={fromStatement?.rateHistory ? { review: fromStatement.rateHistory, fileName: fromStatement.fileName } : null}
                                onSubmit={request => handleSubmit(request)}
                                onCancel={() => setOpen(false)}
                            />
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

