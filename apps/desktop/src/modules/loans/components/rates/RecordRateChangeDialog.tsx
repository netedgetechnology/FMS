import { useState } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
    InterestRateChangeService,
    RATE_CHANGE_SOURCES,
    isDetailsOnlyCorrection,
    prepareRateChange,
    rateChangeMode,
    replacesRecordedRate,
    type PreparedRateChange,
    type RateChangeContext,
    type RateChangeInput,
    type RateChangeIssue,
} from "../../services/InterestRateChangeService";
import type { RecalculationOption } from "../../setup/rateChangeProposal";
import { resolveRateBaseline } from "../../setup/interestRateHistory";
import { INTEREST_RATE_SOURCE_LABELS, type InterestRateHistoryEntry } from "../../types/InterestRateHistory";
import { ChoiceSelect, Field, IssueList, NumberField, formatDisplayDate } from "../setup/setupFields";
import { RateChangeReview } from "./RateChangeReview";

// ---------------------------------------------------------------------
// Record (or correct) a rate change: enter it -> review exactly what will
// be saved -> confirm -> one atomic save. Cancel at any point saves
// nothing. The success toast appears only once the save has succeeded.
// ---------------------------------------------------------------------

export function emptyRateChangeInput(context: RateChangeContext, correcting: InterestRateHistoryEntry | null = null): RateChangeInput {
    return {
        rate: correcting ? correcting.rate : null,
        effectiveFrom: correcting ? correcting.effectiveFrom : "",
        rateType: correcting ? correcting.rateType : context.loan.rateType ?? null,
        source: correcting && correcting.source !== "INITIAL" ? correcting.source : "LENDER_NOTICE",
        reference: correcting?.reference ?? "",
        notes: correcting?.notes ?? "",
        option: null,
        correcting,
        correctionReason: "",
    };
}

export interface RateChangeFormProps {
    context: RateChangeContext;
    input: RateChangeInput;
    issues: readonly RateChangeIssue[];
    onChange(input: RateChangeInput): void;
}

/** The form itself (presentational). */
export function RateChangeForm({ context, input, issues, onChange }: RateChangeFormProps) {
    const mode = rateChangeMode(context.loan, context.schedule);
    const error = (field: RateChangeIssue["field"]) => issues.find(issue => issue.field === field)?.message;
    const correctsInitial = input.correcting?.source === "INITIAL";
    const replacing = replacesRecordedRate(context, input);
    const asksOption = mode.kind === "REPRICE" && !isDetailsOnlyCorrection(input);
    const baseline = context.available ? resolveRateBaseline(context.loan, context.history) : null;

    return (
        <div className="space-y-4" data-form="rate-change">
            {mode.kind === "RECORD_ONLY" && (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700" data-mode="record-only">
                    {mode.reason}
                </p>
            )}
            {baseline?.kind === "LOAN_TERMS" && (
                <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900" data-baseline="loan-terms">
                    This loan has no rate history yet. With this change, its recorded rate ({baseline.rate}%) is saved as its original rate from its start date ({formatDisplayDate(baseline.effectiveFrom)}) - taken from the loan's own terms; no earlier rates are known.
                    {replacing ? " A rate from the start date replaces that recorded rate: it is kept in the correction history, with your reason." : ""}
                </p>
            )}
            <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                <Field label="New Rate (% per year)" htmlFor="rate-change-rate" required error={error("rate")}>
                    <NumberField id="rate-change-rate" value={input.rate} onChange={rate => onChange({ ...input, rate })} placeholder="e.g. 10.75" />
                </Field>
                <Field label="Effective From" htmlFor="rate-change-date" required error={error("effectiveFrom")} hint={correctsInitial ? "The original rate applies from the loan's start date." : undefined}>
                    <Input id="rate-change-date" type="date" value={input.effectiveFrom} disabled={correctsInitial} onChange={event => onChange({ ...input, effectiveFrom: event.target.value })} />
                </Field>
                <Field label="Fixed or Floating" htmlFor="rate-change-type">
                    <ChoiceSelect
                        id="rate-change-type"
                        value={input.rateType ?? ""}
                        options={[
                            { value: "", label: "Not stated" },
                            { value: "FIXED", label: "Fixed" },
                            { value: "FLOATING", label: "Floating" },
                        ]}
                        onChange={value => onChange({ ...input, rateType: value === "FIXED" || value === "FLOATING" ? value : null })}
                    />
                </Field>
                {!correctsInitial && !replacing && (
                    <Field label="Source" htmlFor="rate-change-source" required error={error("source")}>
                        <ChoiceSelect
                            id="rate-change-source"
                            value={input.source}
                            options={RATE_CHANGE_SOURCES.map(source => ({ value: source, label: INTEREST_RATE_SOURCE_LABELS[source] }))}
                            onChange={value => onChange({ ...input, source: value as RateChangeInput["source"] })}
                        />
                    </Field>
                )}
                <Field label="Reference" htmlFor="rate-change-reference" hint="e.g. the lender notice's reference.">
                    <Input id="rate-change-reference" value={input.reference} onChange={event => onChange({ ...input, reference: event.target.value })} />
                </Field>
                <Field label="Notes" htmlFor="rate-change-notes" className="col-span-2">
                    <Textarea id="rate-change-notes" value={input.notes} rows={2} onChange={event => onChange({ ...input, notes: event.target.value })} />
                </Field>
                {(input.correcting || replacing) && (
                    <Field label="Reason for the Correction" htmlFor="rate-change-reason" required error={error("correctionReason")} className="col-span-2">
                        <Input id="rate-change-reason" value={input.correctionReason} onChange={event => onChange({ ...input, correctionReason: event.target.value })} />
                    </Field>
                )}
                {asksOption && (
                    <Field label="How to Recalculate" htmlFor="rate-change-option" required error={error("option")} className="col-span-2" hint="Instalments already paid, linked or settled are never changed.">
                        <ChoiceSelect
                            id="rate-change-option"
                            value={input.option ?? ""}
                            placeholder="Choose"
                            options={[
                                { value: "PRESERVE_EMI", label: "Keep the EMI - the number of instalments changes" },
                                { value: "PRESERVE_TENURE", label: "Keep the tenure - the EMI changes" },
                            ]}
                            onChange={value => onChange({ ...input, option: (value || null) as RecalculationOption | null })}
                        />
                    </Field>
                )}
            </div>
            {issues.some(issue => issue.field === "change") && <IssueList issues={issues.filter(issue => issue.field === "change")} />}
        </div>
    );
}

/**
 * The confirmed save: nothing is sent unless the change is READY and the
 * user ticked the confirmation; the success toast is shown only after the
 * atomic save has succeeded. Never throws - a failure comes back as its
 * message, with no toast.
 */
export async function saveConfirmedRateChange(
    prepared: PreparedRateChange | null,
    confirmed: boolean,
    service: Pick<InterestRateChangeService, "save">,
    notify: (message: string) => void,
    correcting: boolean
): Promise<{ saved: boolean; error: string | null }> {
    if (prepared?.status !== "READY" || !confirmed) return { saved: false, error: null };

    try {
        await service.save(prepared.request);
    } catch (error) {
        return { saved: false, error: error instanceof Error ? error.message : String(error) };
    }

    notify(correcting ? "Interest rate corrected." : "Interest rate change saved.");
    return { saved: true, error: null };
}

export interface RecordRateChangeDialogProps {
    open: boolean;
    context: RateChangeContext;
    correcting: InterestRateHistoryEntry | null;
    onOpenChange(open: boolean): void;
    onSaved(): void;
    /**
     * A save was refused or failed (e.g. the loan changed meanwhile): the
     * owner reloads the context, so Back -> Review prepares the change
     * again from the loan as it now is (the stale check is untouched).
     */
    onSaveRefused?(): void;
    /**
     * Prefilled values (Stage 4: a change confirmed from a lender statement -
     * its date, rate, type, source, reference and the statement line). The
     * customer still chooses how to recalculate, reviews and confirms.
     */
    initialInput?: Partial<RateChangeInput>;
}

export function RecordRateChangeDialog({ open, context, correcting, onOpenChange, onSaved, onSaveRefused, initialInput }: RecordRateChangeDialogProps) {
    const [input, setInput] = useState<RateChangeInput>(() => ({ ...emptyRateChangeInput(context, correcting), ...(correcting ? {} : initialInput) }));
    const [prepared, setPrepared] = useState<PreparedRateChange | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const ready = prepared?.status === "READY" ? prepared : null;
    const issues = prepared?.status === "BLOCKED" ? prepared.issues : [];

    function change(next: RateChangeInput) {
        setInput(next);
        setPrepared(null);
        setConfirmed(false);
        setSaveError(null);
    }

    async function save() {
        setSaving(true);
        setSaveError(null);
        const outcome = await saveConfirmedRateChange(prepared, confirmed, new InterestRateChangeService(), message => toast.success(message), Boolean(input.correcting));
        setSaving(false);
        if (outcome.saved) {
            onSaved();
            onOpenChange(false);
        } else {
            setSaveError(outcome.error);
            if (outcome.error) onSaveRefused?.();
        }
    }

    return (
        <Dialog open={open} onOpenChange={next => !saving && onOpenChange(next)}>
            <DialogContent showCloseButton className="w-[880px] max-w-[calc(100vw-48px)] gap-0 overflow-hidden rounded-[28px] border border-slate-100 bg-white p-0 shadow-lg">
                <DialogHeader className="px-7 pb-4 pt-5">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">{correcting ? "Correct Interest Rate" : "Record Interest Rate Change"}</DialogTitle>
                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        {context.loan.name}. Nothing is saved until you review the result and confirm it.
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-[calc(100vh-200px)] space-y-4 overflow-y-auto border-t border-slate-100 px-7 py-5">
                    {!ready ? (
                        <RateChangeForm context={context} input={input} issues={issues} onChange={change} />
                    ) : (
                        <>
                            <RateChangeReview
                                input={input}
                                mode={ready.mode}
                                proposal={ready.proposal}
                                warnings={ready.warnings}
                                oldRate={ready.oldRate}
                                baseline={
                                    ready.request.initialEntry
                                        ? {
                                              rate: ready.request.initialEntry.rate,
                                              effectiveFrom: ready.request.initialEntry.effectiveFrom,
                                              replaced: ready.request.supersedes?.id === ready.request.initialEntry.id,
                                          }
                                        : null
                                }
                            />
                            <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                                <Checkbox checked={confirmed} onCheckedChange={checked => setConfirmed(checked === true)} />
                                <span>I have checked this {ready.proposal ? "rate change and the revised schedule" : "rate change"}. Save it.</span>
                            </label>
                        </>
                    )}

                    {saveError && <IssueList issues={[{ field: "save", message: saveError }]} />}

                    <div className="flex justify-between gap-3 border-t border-slate-100 pt-4">
                        <button
                            type="button"
                            disabled={saving}
                            onClick={() => onOpenChange(false)}
                            className="h-10 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <div className="flex gap-3">
                            {ready && (
                                <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => setPrepared(null)}
                                    className="h-10 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                                >
                                    Back
                                </button>
                            )}
                            {!ready ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        // A new review (e.g. re-prepared after a refused save) needs a new confirmation.
                                        setPrepared(prepareRateChange(context, input));
                                        setConfirmed(false);
                                    }}
                                    className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                                >
                                    Review
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    disabled={saving || !confirmed}
                                    onClick={() => void save()}
                                    className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {saving ? "Saving..." : "Confirm and Save"}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
