import { useState } from "react";

import { formatMoney } from "../../setup/loanSetupAccounting";
import type { ProtectionReason, RateChangeProposal } from "../../setup/rateChangeProposal";
import type { RateChangeInput, RateChangeMode } from "../../services/InterestRateChangeService";
import { IssueList, SmallButton, StepSection, SummaryGrid, formatDisplayDate } from "../setup/setupFields";

// ---------------------------------------------------------------------
// What will be saved, for the user to check before confirming: the
// Stage 2 proposal (old vs proposed future instalments, EMI / tenure
// impact, interest totals, protected instalments, warnings) - or, when
// only the rate history is recorded, that the schedule is not changed.
// ---------------------------------------------------------------------

const REASON_LABELS: Record<ProtectionReason, string> = {
    PAID: "paid",
    PARTIAL: "partly paid",
    TRANSACTION_LINKED: "linked to a bank transaction",
    PAYMENT_RECORDED: "payment recorded",
    SETTLED_BEFORE_FINWEA: "settled before FinWea",
};

const OPTION_LABELS = {
    PRESERVE_EMI: "Keep the EMI - the number of instalments changes",
    PRESERVE_TENURE: "Keep the tenure - the EMI changes",
} as const;

const METHOD_LABELS = {
    MONTHLY_RATE: "Reducing balance - monthly rate (rate / 12)",
    ACTUAL_365: "Reducing balance - actual days / 365",
} as const;

function rate(value: number): string {
    return `${Number(value.toFixed(4))}%`;
}

export interface RateChangeReviewProps {
    input: RateChangeInput;
    mode: RateChangeMode;
    proposal: RateChangeProposal | null;
    warnings: string[];
    /**
     * The rate in force just before the change (prepareRateChange's oldRate:
     * the confirmed history, else the loan's own terms) - shown for every
     * change, repriced or recorded only. Null: no earlier rate is known.
     */
    oldRate: number | null;
    /**
     * A loan with no history: the original rate recorded first, from its
     * own terms, in the same save; `replaced` when this change supersedes it.
     */
    baseline?: { rate: number; effectiveFrom: string; replaced: boolean } | null;
}

export function RateChangeReview({ input, mode, proposal, warnings, oldRate, baseline = null }: RateChangeReviewProps) {
    const [showAll, setShowAll] = useState(false);

    return (
        <div className="space-y-4" data-review="rate-change">
            {baseline && (
                <StepSection title="Original rate">
                    <p className="text-sm text-slate-700" data-review-baseline="true">
                        Recorded first, in the same save: {rate(baseline.rate)} from {formatDisplayDate(baseline.effectiveFrom)}, the rate stored in this loan's terms (no earlier history exists).
                        {baseline.replaced ? " It is then marked corrected and replaced by the new rate below, with your reason." : ""}
                    </p>
                </StepSection>
            )}
            <StepSection title={input.correcting ? "Correction" : "Rate change"}>
                <SummaryGrid
                    items={[
                        { label: input.correcting ? "Replaces" : "Old rate", value: input.correcting ? `${rate(input.correcting.rate)} from ${formatDisplayDate(input.correcting.effectiveFrom)}` : oldRate === null ? "Not known" : rate(oldRate) },
                        { label: "New rate", value: input.rate === null ? "-" : rate(input.rate) },
                        { label: "Effective from", value: formatDisplayDate(input.effectiveFrom) },
                        ...(input.correcting ? [{ label: "Reason", value: input.correctionReason }] : []),
                    ]}
                />
            </StepSection>

            {!proposal ? (
                <StepSection title="Repayment schedule">
                    <p className="text-sm text-slate-700" data-schedule="unchanged">
                        The repayment schedule is not changed: only the rate history is recorded.
                        {mode.kind === "RECORD_ONLY" ? ` ${mode.reason}` : " This correction changes neither the rate nor its date."}
                    </p>
                </StepSection>
            ) : (
                <>
                    <StepSection title="Impact" hint={`${METHOD_LABELS[proposal.calculationMethod]}. ${OPTION_LABELS[proposal.option]}.`}>
                        <SummaryGrid
                            items={[
                                { label: "Recalculated from", value: `Instalment ${proposal.recalculatedFromInstalment}` },
                                { label: "Starting principal", value: formatMoney(proposal.startingPrincipal) },
                                { label: "EMI", value: `${formatMoney(proposal.currentEmi)} -> ${proposal.proposedEmis.map(formatMoney).join(", then ")}` },
                                { label: "Instalments left", value: `${proposal.currentRemainingInstalments} -> ${proposal.proposedRemainingInstalments}` },
                                { label: "Interest still to pay", value: `${formatMoney(proposal.totals.currentInterest)} -> ${formatMoney(proposal.totals.proposedInterest)}` },
                                {
                                    label: "Final instalment",
                                    value: `#${proposal.finalAdjustment.installmentNumber}: ${formatMoney(proposal.finalAdjustment.finalTotal)} (${proposal.finalAdjustment.difference >= 0 ? "+" : ""}${formatMoney(proposal.finalAdjustment.difference)} vs EMI)`,
                                },
                            ]}
                        />
                    </StepSection>

                    <StepSection title="Protected instalments" hint="Never changed: they stay exactly as recorded.">
                        {proposal.protectedInstalments.length === 0 ? (
                            <p className="text-xs text-slate-500">None - no instalment is paid, linked or settled yet.</p>
                        ) : (
                            <p className="text-xs text-slate-700" data-protected={proposal.protectedInstalments.length}>
                                {proposal.protectedInstalments.length} instalment(s):{" "}
                                {proposal.protectedInstalments.map(item => `#${item.row.installmentNumber} (${item.reasons.map(reason => REASON_LABELS[reason]).join(", ")})`).join("; ")}
                                {proposal.unchangedInstalments.length > 0 ? `. Also unchanged: #${proposal.unchangedInstalments.map(row => row.installmentNumber).join(", #")} (before the new rate applies).` : ""}
                            </p>
                        )}
                    </StepSection>

                    <StepSection title="Current and proposed instalments">
                        <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
                            <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                                    <tr>
                                        {["#", "Due", "Current EMI", "Current interest", "Proposed EMI", "Interest", "Principal", "Closing", "Rates"].map(header => (
                                            <th key={header} className="px-2 py-1.5 text-left font-medium">
                                                {header}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {(showAll ? proposal.proposedInstalments : proposal.proposedInstalments.slice(0, 12)).map(row => {
                                        const current = proposal.currentFutureInstalments.find(item => item.installmentNumber === row.installmentNumber);
                                        return (
                                            <tr key={row.installmentNumber} className="border-t border-slate-100">
                                                <td className="px-2 py-1">{row.installmentNumber}</td>
                                                <td className="px-2 py-1">{formatDisplayDate(row.dueDate)}</td>
                                                <td className="px-2 py-1">{current ? formatMoney(current.totalAmount) : "(new)"}</td>
                                                <td className="px-2 py-1">{current ? formatMoney(current.interestAmount) : "-"}</td>
                                                <td className="px-2 py-1 font-semibold text-slate-900">{formatMoney(row.totalAmount)}</td>
                                                <td className="px-2 py-1">{formatMoney(row.interestAmount)}</td>
                                                <td className="px-2 py-1">{formatMoney(row.principalAmount)}</td>
                                                <td className="px-2 py-1">{formatMoney(row.outstandingPrincipal)}</td>
                                                <td className="px-2 py-1 text-slate-500">{row.segments.map(segment => `${rate(segment.rate)} x ${segment.days}d`).join(" + ")}</td>
                                            </tr>
                                        );
                                    })}
                                    {proposal.currentFutureInstalments
                                        .filter(row => !proposal.proposedInstalments.some(item => item.installmentNumber === row.installmentNumber))
                                        .map(row => (
                                            <tr key={`removed-${row.installmentNumber}`} className="border-t border-slate-100 text-slate-400">
                                                <td className="px-2 py-1">{row.installmentNumber}</td>
                                                <td className="px-2 py-1">{formatDisplayDate(row.dueDate)}</td>
                                                <td className="px-2 py-1">{formatMoney(row.totalAmount)}</td>
                                                <td className="px-2 py-1">{formatMoney(row.interestAmount)}</td>
                                                <td className="px-2 py-1" colSpan={5}>
                                                    (no longer needed)
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                        {proposal.proposedInstalments.length > 12 && (
                            <SmallButton onClick={() => setShowAll(value => !value)}>{showAll ? "Show fewer" : `Show all ${proposal.proposedInstalments.length} instalments`}</SmallButton>
                        )}
                    </StepSection>
                </>
            )}

            {warnings.length > 0 && <IssueList tone="warning" issues={warnings.map(message => ({ field: "warning", message }))} />}
        </div>
    );
}
