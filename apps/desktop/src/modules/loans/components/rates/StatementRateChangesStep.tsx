import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LatestRequestGuard } from "@/core/async/LatestRequestGuard";

import { InterestRateChangeService, type RateChangeContext } from "../../services/InterestRateChangeService";
import { LoanService } from "../../services/LoanService";
import { localToday } from "../../setup/historicalInstalments";
import {
    followUpProgress,
    termRateChangeInputs,
    unrecordedChangeText,
    unrecordedChanges,
    type ConfirmedRateChange,
    type ConfirmedStatementRates,
    type FollowUpStatus,
} from "../../statementImport/statementRateProposals";
import { SmallButton, StepSection, formatDisplayDate } from "../setup/setupFields";
import { InterestRateHistoryView } from "./InterestRateHistoryView";
import { RecordRateChangeDialog } from "./RecordRateChangeDialog";

// ---------------------------------------------------------------------
// Stage 4, Term Loan: after the loan is created at its original rate, the
// statement's confirmed rate changes are recorded here - in date order,
// one at a time, each through the existing Record Rate Change workflow
// (Keep EMI / Keep Tenure, the revised schedule, a confirmation, one
// atomic save with its stale check). Nothing is repriced automatically.
// The loan's SAVED history is shown apart from the statement's proposals.
//
// Pre-activation audit H1: a change is never dropped silently. "Do not
// record" asks first, per change; finishing (or closing the dialog, see
// AddLoanDialog) with unrecorded changes asks first and lists them; the
// caller is told which were left, to notify the customer afterwards.
// ---------------------------------------------------------------------

function rateText(value: number): string {
    return `${Number(value.toFixed(4))}%`;
}

export interface UnrecordedConfirmationProps {
    unrecorded: readonly ConfirmedRateChange[];
    /** What is about to happen, e.g. "Finish" or "Close". */
    action: string;
    onConfirm(): void;
    onCancel(): void;
}

/** The explicit confirmation before leaving changes unrecorded, listing each one. */
export function UnrecordedConfirmation({ unrecorded, action, onConfirm, onCancel }: UnrecordedConfirmationProps) {
    return (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950" role="alertdialog" aria-label="Rate changes not recorded" data-unrecorded-confirmation="true">
            <p className="font-semibold">
                {action} without recording {unrecorded.length} rate change(s)?
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs">
                {unrecorded.map(change => (
                    <li key={change.key} data-unrecorded={change.key}>
                        {unrecordedChangeText(change)}
                        <span className="ml-1 text-amber-800">({change.reference})</span>
                    </li>
                ))}
            </ul>
            <p className="text-xs">
                These are not saved anywhere, and the loan's current rate will not include them. You can record them later from the loan's details (Interest rate history - Record rate change).
            </p>
            <div className="flex justify-end gap-2">
                <SmallButton onClick={onCancel}>Keep recording</SmallButton>
                <SmallButton tone="danger" onClick={onConfirm}>
                    {action} and leave them unrecorded
                </SmallButton>
            </div>
        </div>
    );
}

export interface FollowUpListProps {
    changes: readonly ConfirmedRateChange[];
    statuses: Readonly<Record<string, FollowUpStatus>>;
    /** The change whose "Do not record" is awaiting its confirmation. */
    confirmingSkip: string | null;
    today: string;
    onRecord(key: string): void;
    onAskSkip(key: string): void;
    onConfirmSkip(key: string): void;
    onCancelSkip(): void;
}

/** The statement's changes and where each stands. "Do not record" only asks; the confirmation skips. */
export function FollowUpList({ changes, statuses, confirmingSkip, today, onRecord, onAskSkip, onConfirmSkip, onCancelSkip }: FollowUpListProps) {
    const progress = followUpProgress(changes, statuses);
    return (
        <ul className="space-y-2" data-rates="follow-up">
            {changes.map(change => {
                const status = statuses[change.key] ?? "PENDING";
                const isNext = progress.next?.key === change.key;
                const confirming = status === "PENDING" && isNext && confirmingSkip === change.key;
                return (
                    <li key={change.key} className="space-y-2 rounded-xl border border-slate-200 px-3 py-2" data-follow-up={change.key} data-status={status}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm text-slate-800">
                                <span className="font-medium">
                                    {rateText(change.rate)} from {formatDisplayDate(change.effectiveFrom)}
                                </span>
                                <span className="ml-2 text-xs text-slate-500">{change.reference}</span>
                                {change.effectiveFrom > today && <span className="ml-2 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">Upcoming</span>}
                            </div>
                            <div className="flex items-center gap-2">
                                {status === "RECORDED" && <span className="text-xs font-semibold text-emerald-700">Recorded</span>}
                                {status === "SKIPPED" && <span className="text-xs font-semibold text-amber-700">Not recorded</span>}
                                {status === "PENDING" && isNext && !confirming && (
                                    <>
                                        <SmallButton tone="primary" onClick={() => onRecord(change.key)}>
                                            Review and record
                                        </SmallButton>
                                        <SmallButton onClick={() => onAskSkip(change.key)}>Do not record</SmallButton>
                                    </>
                                )}
                                {status === "PENDING" && !isNext && <span className="text-xs text-slate-500">After the earlier change</span>}
                            </div>
                        </div>
                        {confirming && (
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950" data-confirm-skip={change.key}>
                                <span>
                                    Leave {unrecordedChangeText(change)} unrecorded? It is not saved anywhere, and the loan's rate will not include it.
                                </span>
                                <span className="flex gap-2">
                                    <SmallButton onClick={onCancelSkip}>Cancel</SmallButton>
                                    <SmallButton tone="danger" onClick={() => onConfirmSkip(change.key)}>
                                        Leave it unrecorded
                                    </SmallButton>
                                </span>
                            </div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

export interface StatementRateChangesStepProps {
    loanId: string;
    confirmed: ConfirmedStatementRates;
    /** Ends the follow-up: `unrecorded` are the changes left unrecorded (already confirmed by the customer). */
    onDone(unrecorded: ConfirmedRateChange[], loanName: string | null): void;
    /** Every change not recorded yet, kept current for the dialog's close guard. */
    onUnrecordedChange?(unrecorded: ConfirmedRateChange[], loanName: string | null): void;
}

export function StatementRateChangesStep({ loanId, confirmed, onDone, onUnrecordedChange }: StatementRateChangesStepProps) {
    const [context, setContext] = useState<RateChangeContext | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const [statuses, setStatuses] = useState<Record<string, FollowUpStatus>>({});
    const [open, setOpen] = useState<{ key: string; session: number } | null>(null);
    const [confirmingSkip, setConfirmingSkip] = useState<string | null>(null);
    const [confirmingFinish, setConfirmingFinish] = useState(false);
    const requests = useRef(new LatestRequestGuard());
    const inputs = useMemo(() => new Map(termRateChangeInputs(confirmed).map(item => [item.key, item.input])), [confirmed]);
    const progress = followUpProgress(confirmed.changes, statuses);
    const unrecorded = useMemo(() => unrecordedChanges(confirmed.changes, statuses), [confirmed, statuses]);
    const loanName = context?.loan.name ?? null;

    useEffect(() => {
        onUnrecordedChange?.(unrecorded, loanName);
    }, [unrecorded, loanName, onUnrecordedChange]);

    const load = useCallback(async () => {
        const request = requests.current.start();
        try {
            const loan = await new LoanService().getById(loanId);
            if (!loan) throw new Error("The new loan could not be read.");
            const next = await new InterestRateChangeService().loadContext(loan);
            if (requests.current.isStale(request)) return;
            setContext(next);
            setFailed(null);
        } catch (error) {
            if (requests.current.isStale(request)) return;
            setFailed(error instanceof Error ? error.message : String(error));
        }
    }, [loanId]);

    useEffect(() => {
        void load();
    }, [load]);

    function finish() {
        if (unrecorded.length > 0) {
            setConfirmingFinish(true);
            return;
        }
        onDone([], loanName);
    }

    if (failed) {
        return (
            <div className="space-y-3">
                <p className="text-sm text-red-600">{failed}</p>
                <UnrecordedConfirmation unrecorded={unrecorded} action="Close" onConfirm={() => onDone(unrecorded, loanName)} onCancel={() => void load()} />
            </div>
        );
    }
    if (!context) return <p className="text-sm text-slate-500">Loading the new loan...</p>;

    return (
        <div className="space-y-4" data-step="statement-rate-changes">
            <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                {context.loan.name} was created at its original rate. Now record the statement's rate changes - each is reviewed with its revised schedule before it is saved.
            </p>

            <StepSection title="Saved rate history" hint="What is saved for this loan now.">
                <InterestRateHistoryView loan={context.loan} available={context.available} history={context.history} today={localToday()} />
            </StepSection>

            <StepSection title="Rate changes from the statement" hint="Proposed - not saved until you record each one. Recorded in date order.">
                <FollowUpList
                    changes={confirmed.changes}
                    statuses={statuses}
                    confirmingSkip={confirmingSkip}
                    today={localToday()}
                    onRecord={key => {
                        setConfirmingSkip(null);
                        setConfirmingFinish(false);
                        setOpen({ key, session: Date.now() });
                    }}
                    onAskSkip={key => {
                        setConfirmingFinish(false);
                        setConfirmingSkip(key);
                    }}
                    onConfirmSkip={key => {
                        setConfirmingSkip(null);
                        setStatuses(current => ({ ...current, [key]: "SKIPPED" }));
                    }}
                    onCancelSkip={() => setConfirmingSkip(null)}
                />
            </StepSection>

            {unrecorded.length > 0 && !confirmingFinish && (
                <p className="text-xs text-amber-800" data-follow-up-warning="true">
                    {unrecorded.length} change(s) not recorded yet. They are not saved anywhere until you record them.
                </p>
            )}

            {confirmingFinish ? (
                <UnrecordedConfirmation
                    unrecorded={unrecorded}
                    action="Finish"
                    onConfirm={() => {
                        setConfirmingFinish(false);
                        onDone(unrecorded, loanName);
                    }}
                    onCancel={() => setConfirmingFinish(false)}
                />
            ) : (
                <div className="flex justify-end border-t border-slate-100 pt-4">
                    <button type="button" onClick={finish} className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800">
                        {progress.pending > 0 ? "Finish without the rest" : "Done"}
                    </button>
                </div>
            )}

            {open && (
                <RecordRateChangeDialog
                    key={open.session}
                    open
                    context={context}
                    correcting={null}
                    initialInput={inputs.get(open.key)}
                    onOpenChange={next => {
                        if (next) return;
                        // Cancelling the review leaves the change pending - never skipped.
                        setOpen(null);
                        void load();
                    }}
                    onSaved={() => setStatuses(current => ({ ...current, [open.key]: "RECORDED" }))}
                    onSaveRefused={() => void load()}
                />
            )}
        </div>
    );
}
