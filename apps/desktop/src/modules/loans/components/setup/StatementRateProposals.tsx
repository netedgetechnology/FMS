import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

import {
    chronological,
    rateReviewIssues,
    type RateIssue,
    type RateLoanContext,
    type RateProposal,
    type StatementRateReview,
} from "../../statementImport/statementRateProposals";
import { ChoiceSelect, NumberField, SmallButton, StepSection, formatDisplayDate } from "./setupFields";

// ---------------------------------------------------------------------
// Statement Review: the statement's rate changes as PROPOSED history
// entries (Stage 4). Each shows its evidence - page, the statement's own
// line, how it was read - and can be corrected (date, rate, type) or left
// out. Nothing here is saved: proposals are labelled as such, apart from
// any confirmed history, and are saved only with the final confirmation.
// Without migration 054 they are listed for information only, as before.
// ---------------------------------------------------------------------

function rateText(value: number | null): string {
    return value === null ? "-" : `${Number(value.toFixed(4))}%`;
}

function issuesFor(issues: readonly RateIssue[], key: string): RateIssue[] {
    return issues.filter(issue => issue.key === key);
}

/** The rate before each included proposal on the timeline (original, then each change in date order). */
export function ratesBefore(review: StatementRateReview): Map<string, number | null> {
    const before = new Map<string, number | null>();
    let previous = review.originalRate;
    for (const proposal of chronological(review)) {
        before.set(proposal.key, previous);
        if (proposal.effectiveDate && proposal.rate !== null) previous = proposal.rate;
    }
    return before;
}

export interface StatementRateProposalsProps {
    review: StatementRateReview;
    /** False until migration 054 is applied: listed for information only. */
    available: boolean;
    /** The loan's start date / rate, when known, for the full checks. */
    context?: RateLoanContext | null;
    onChange?(key: string, change: Partial<Pick<RateProposal, "effectiveDate" | "rate" | "rateType" | "included">>): void;
    onOriginalRateChange?(rate: number | null): void;
}

export function StatementRateProposals({ review, available, context = null, onChange, onOriginalRateChange }: StatementRateProposalsProps) {
    if (review.proposals.length === 0) return null;

    if (!available) {
        return (
            <StepSection title="Interest rate history" hint="The statement's rate changes, for information only - not saved.">
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-rates="information-only">
                    Rate history is not available in this database yet (it needs database update 054), so these changes are shown for checking and are not saved with the loan.
                </p>
                <ul className="space-y-1 text-xs text-slate-600">
                    {chronological(review).map(proposal => (
                        <li key={proposal.key}>
                            {proposal.effectiveDate ? formatDisplayDate(proposal.effectiveDate) : "No date"}: {rateText(proposal.rate)}
                            {proposal.evidence.previousRate !== null ? ` (was ${rateText(proposal.evidence.previousRate)})` : ""} - page {proposal.evidence.page}
                        </li>
                    ))}
                </ul>
            </StepSection>
        );
    }

    const { blocking, warnings } = rateReviewIssues(review, context);
    const before = ratesBefore(review);
    const ordered = [...chronological(review), ...review.proposals.filter(proposal => !proposal.included)];
    const originalIssues = issuesFor(blocking, "original");

    return (
        <StepSection
            title="Interest rate history"
            hint="The statement's rate changes as proposed history entries, read from the statement - not saved yet. Check each against the statement's own line, correct it if needed, or leave it out. They are applied in date order."
        >
            <div className="space-y-3" data-rates="proposals">
                <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3" data-proposal="original">
                    <div className="w-44">
                        <label htmlFor="statement-original-rate" className="mb-1 block text-xs font-medium text-slate-600">
                            Rate from the start date (% p.a.)
                        </label>
                        <NumberField id="statement-original-rate" value={review.originalRate} onChange={value => onOriginalRateChange?.(value)} placeholder="Not stated" />
                    </div>
                    <p className="flex-1 text-xs text-slate-500">
                        {review.originalRateFrom === "STATEMENT"
                            ? "The rate before the first change, as the statement prints it. Recorded as the loan's original rate."
                            : review.originalRateFrom === "MANUAL"
                              ? "Entered by you. Recorded as the loan's original rate."
                              : "The statement does not print the rate before the first change. Enter it from your sanction letter - it is never guessed."}
                    </p>
                    {originalIssues.map(issue => (
                        <p key={issue.message} className="w-full text-xs text-red-600">
                            {issue.message}
                        </p>
                    ))}
                </div>

                {ordered.map(proposal => (
                    <ProposalRow
                        key={proposal.key}
                        proposal={proposal}
                        rateBefore={before.get(proposal.key) ?? null}
                        blocking={issuesFor(blocking, proposal.key)}
                        warnings={issuesFor(warnings, proposal.key)}
                        onChange={change => onChange?.(proposal.key, change)}
                    />
                ))}
            </div>
        </StepSection>
    );
}

function ProposalRow({
    proposal,
    rateBefore,
    blocking,
    warnings,
    onChange,
}: {
    proposal: RateProposal;
    rateBefore: number | null;
    blocking: readonly RateIssue[];
    warnings: readonly RateIssue[];
    onChange(change: Partial<Pick<RateProposal, "effectiveDate" | "rate" | "rateType" | "included">>): void;
}) {
    const { evidence } = proposal;
    const id = `statement-rate-${proposal.key}`;
    const unresolved = proposal.included && blocking.length > 0;
    const ambiguous = proposal.included && !proposal.dateConfirmed && evidence.datesInText.length > 1;

    return (
        <div
            className={`space-y-2 rounded-xl border p-3 ${!proposal.included ? "border-slate-200 bg-slate-50 opacity-70" : unresolved ? "border-amber-300 bg-amber-50/40" : "border-slate-200 bg-white"}`}
            data-proposal={proposal.key}
            data-state={!proposal.included ? "left-out" : unresolved ? "unresolved" : "ready"}
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">Proposed</span>
                    <span className="text-xs text-slate-500">
                        Page {evidence.page} · {evidence.origin === "TABLE" ? "rate table row" : "statement text"}
                        {proposal.edited ? " · corrected by you" : ""}
                    </span>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Checkbox checked={proposal.included} onCheckedChange={checked => onChange({ included: checked === true })} aria-label="Record this rate change" />
                    Record this change
                </label>
            </div>

            <blockquote className="truncate rounded-md border-l-2 border-slate-300 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-600" title={evidence.raw}>
                {evidence.raw}
            </blockquote>

            {proposal.included && (
                <div className="grid grid-cols-[1.2fr_0.9fr_0.9fr_1fr] items-end gap-3">
                    <div>
                        <label htmlFor={`${id}-date`} className="mb-1 block text-xs font-medium text-slate-600">
                            Effective from
                        </label>
                        <Input id={`${id}-date`} type="date" value={proposal.effectiveDate} onChange={event => onChange({ effectiveDate: event.target.value })} />
                    </div>
                    <div>
                        <div className="mb-1 text-xs font-medium text-slate-600">Previous rate</div>
                        <div className="h-9 text-sm leading-9 text-slate-700">
                            {rateText(rateBefore)}
                            {evidence.previousRate !== null && <span className="ml-1 text-[11px] text-slate-500">(printed {rateText(evidence.previousRate)})</span>}
                        </div>
                    </div>
                    <div>
                        <label htmlFor={`${id}-rate`} className="mb-1 block text-xs font-medium text-slate-600">
                            New rate (% p.a.)
                        </label>
                        <NumberField id={`${id}-rate`} value={proposal.rate} onChange={rate => onChange({ rate })} />
                    </div>
                    <div>
                        <label htmlFor={`${id}-type`} className="mb-1 block text-xs font-medium text-slate-600">
                            Fixed or floating
                        </label>
                        <ChoiceSelect
                            id={`${id}-type`}
                            value={proposal.rateType ?? ""}
                            options={[
                                { value: "", label: "Not stated" },
                                { value: "FIXED", label: "Fixed" },
                                { value: "FLOATING", label: "Floating" },
                            ]}
                            onChange={value => onChange({ rateType: value === "FIXED" || value === "FLOATING" ? value : null })}
                        />
                    </div>
                </div>
            )}

            {proposal.included && proposal.rateTypeFromStatement && <p className="text-[11px] text-slate-500">Rate type taken from the statement's interest type, not this line.</p>}

            {ambiguous && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700" data-ambiguous-dates="true">
                    <span>Dates on this line:</span>
                    {evidence.datesInText.map(date => (
                        <SmallButton key={date} onClick={() => onChange({ effectiveDate: date })}>
                            Use {formatDisplayDate(date)}
                        </SmallButton>
                    ))}
                </div>
            )}

            {proposal.included &&
                blocking.map(issue => (
                    <p key={issue.message} className="text-xs text-red-600" data-issue="blocking">
                        {issue.message}
                    </p>
                ))}
            {warnings.map(issue => (
                <p key={issue.message} className="text-xs text-amber-700" data-issue="warning">
                    {issue.message}
                </p>
            ))}
        </div>
    );
}

export interface StatementRateConfirmationProps {
    review: StatementRateReview;
    context: RateLoanContext;
    confirmed: boolean;
    onConfirmedChange(confirmed: boolean): void;
    /** What happens on save, for this loan type. */
    termLoan: boolean;
}

/** The separate, explicit confirmation of the rate changes, at the final save. */
export function StatementRateConfirmation({ review, context, confirmed, onConfirmedChange, termLoan }: StatementRateConfirmationProps) {
    const { blocking } = rateReviewIssues(review, context);
    const changes = chronological(review);

    // Every change left out (audit M1): nothing from the statement is
    // recorded, and the loan is saved at its own rate - said explicitly.
    if (changes.length === 0) {
        return (
            <StepSection title="Rate changes from the statement" hint="None is recorded.">
                <div className="space-y-2" data-rates="confirmation" data-rates-all-left-out="true">
                    <p className="text-xs text-slate-700">
                        You left out all {review.proposals.length} rate change(s) the statement prints. None is recorded: the loan is saved at its own rate of {rateText(context.loanRate)} from its start
                        date, as for a loan entered by hand.
                    </p>
                    <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                        <Checkbox checked={confirmed} onCheckedChange={checked => onConfirmedChange(checked === true)} />
                        <span>I have left out all of the statement's rate changes. Save the loan without them.</span>
                    </label>
                </div>
            </StepSection>
        );
    }

    return (
        <StepSection title="Rate changes from the statement" hint={termLoan ? "Recorded after the loan is created - one at a time, each with its own review." : "Recorded with the loan, in the same save. The schedule and drawing power are not recalculated."}>
            <div className="space-y-2" data-rates="confirmation">
                <ul className="space-y-0.5 text-xs text-slate-700">
                    <li>
                        Original rate from the start date{context.startDate ? ` (${formatDisplayDate(context.startDate)})` : ""}: {rateText(review.originalRate)}
                    </li>
                    {changes.map(proposal => (
                        <li key={proposal.key}>
                            {proposal.effectiveDate ? formatDisplayDate(proposal.effectiveDate) : "No date"}: {rateText(proposal.rate)}
                            {proposal.rateType ? ` · ${proposal.rateType === "FIXED" ? "Fixed" : "Floating"}` : ""}
                            {proposal.effectiveDate > context.today ? " · upcoming" : ""}
                        </li>
                    ))}
                </ul>
                {termLoan && (
                    <p className="text-xs text-slate-600">
                        The loan is created at its original rate. Next, each change is shown with Keep the EMI / Keep the tenure and its revised schedule for you to confirm. Nothing is recalculated before that.
                    </p>
                )}
                {blocking.length > 0 ? (
                    <ul className="space-y-0.5 text-xs text-red-600" data-issue="blocking">
                        {blocking.map(issue => (
                            <li key={`${issue.key}-${issue.message}`}>{issue.message}</li>
                        ))}
                    </ul>
                ) : (
                    <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                        <Checkbox checked={confirmed} onCheckedChange={checked => onConfirmedChange(checked === true)} />
                        <span>
                            I have checked the original rate and these {changes.length} rate change(s) against the statement.{" "}
                            {termLoan ? "Show them for recording after the loan is created." : "Record them with the loan."}
                        </span>
                    </label>
                )}
            </div>
        </StepSection>
    );
}
