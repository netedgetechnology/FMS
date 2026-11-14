import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { currentLoanRate } from "../../setup/interestRateHistory";
import { INTEREST_RATE_SOURCE_LABELS, type InterestRateHistoryEntry } from "../../types/InterestRateHistory";
import type { Loan } from "../../types";
import { SmallButton, formatDisplayDate } from "../setup/setupFields";

// ---------------------------------------------------------------------
// Loan details: Interest Rate History (presentational - the data is
// loaded by InterestRateHistorySection). Confirmed history is shown as
// such; a rate that only comes from the loan's own terms, or a database
// without rate history yet, is labelled as that - never as history.
// ---------------------------------------------------------------------

export interface InterestRateHistoryViewProps {
    loan: Loan;
    /** False until migration 054 is applied. */
    available: boolean;
    /** Live and superseded entries. */
    history: InterestRateHistoryEntry[];
    today: string;
    /** Why changes cannot be recorded, when they cannot. */
    recordBlockedReason?: string | null;
    onRecord?(): void;
    onCorrect?(entry: InterestRateHistoryEntry): void;
}

function rateText(rate: number): string {
    return `${Number(rate.toFixed(4))}%`;
}

function changeText(entry: InterestRateHistoryEntry): string {
    if (entry.previousRate === null) return "-";
    const difference = Number((entry.rate - entry.previousRate).toFixed(4));
    return `${difference > 0 ? "+" : ""}${difference} pp`;
}

/**
 * The Source cell, compact: the source on one line, then its rate type and
 * the instalment it repriced from on a short second line ("Floating · from
 * #16"); `full` is the whole description, for the cell's tooltip.
 */
export function sourceDetails(entry: Pick<InterestRateHistoryEntry, "source" | "rateType" | "appliedFromInstalment">): { label: string; detail: string | null; full: string } {
    const label = INTEREST_RATE_SOURCE_LABELS[entry.source];
    const type = entry.rateType ? typeText(entry.rateType) : null;
    const detail = [type, entry.appliedFromInstalment ? `from #${entry.appliedFromInstalment}` : null].filter(Boolean).join(" · ") || null;
    const full = [label, type, entry.appliedFromInstalment ? `repriced from instalment ${entry.appliedFromInstalment}` : null].filter(Boolean).join(" · ");
    return { label, detail, full };
}

/** Reference, attached document and notes in one line (truncated on screen, complete in the tooltip); null when there are none. */
export function referenceText(entry: Pick<InterestRateHistoryEntry, "reference" | "documentId" | "notes">): string | null {
    return [entry.reference, entry.documentId ? "Document attached" : null, entry.notes].filter(Boolean).join(" · ") || null;
}

function typeText(type: InterestRateHistoryEntry["rateType"] | undefined | null): string {
    return type === "FLOATING" ? "Floating" : type === "FIXED" ? "Fixed" : "Type not stated";
}

export function InterestRateHistoryView({ loan, available, history, today, recordBlockedReason = null, onRecord, onCorrect }: InterestRateHistoryViewProps) {
    const live = history.filter(entry => entry.supersededAt === null);
    const superseded = history.filter(entry => entry.supersededAt !== null);
    // One rule (setup/interestRateHistory): the live entry in force today,
    // else the loan's own terms when it has no history. Never the stored
    // loans.interest_rate for a loan with history (it can lag an upcoming date).
    const inForce = currentLoanRate(loan, history, today);
    const current = inForce.basis === "HISTORY" ? inForce.entry : null;
    const byId = new Map(history.map(entry => [entry.id, entry]));

    const chart = [
        ...live.map(entry => ({ date: entry.effectiveFrom, rate: entry.rate })),
        ...(live.length > 0 && live[live.length - 1]!.effectiveFrom < today ? [{ date: today, rate: current?.rate ?? live[live.length - 1]!.rate }] : []),
    ];

    return (
        <section className="space-y-3" data-section="interest-rate-history">
            <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-slate-900">Interest Rate History</h3>
                <div className="h-px flex-1 bg-slate-100" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Current interest rate</div>
                    {inForce.entry ? (
                        <div className="text-base font-semibold text-slate-900" data-current-basis={inForce.basis}>
                            {rateText(inForce.rate)}{" "}
                            <span className="text-sm font-medium text-slate-500">
                                · {typeText(inForce.rateType)} · {inForce.basis === "NOT_STARTED" ? "the first rate, " : ""}from {formatDisplayDate(inForce.entry.effectiveFrom)}
                            </span>
                        </div>
                    ) : (
                        <div className="text-base font-semibold text-slate-900">
                            {rateText(loan.interestRate)} <span className="text-sm font-medium text-slate-500">· {typeText(loan.rateType)} · from the loan's terms (no confirmed history)</span>
                        </div>
                    )}
                </div>
                {inForce.upcoming.length > 0 && (
                    <div className="w-full text-xs text-sky-800" data-upcoming={inForce.upcoming.length}>
                        Upcoming: {inForce.upcoming.map(entry => `${rateText(entry.rate)} from ${formatDisplayDate(entry.effectiveFrom)}`).join(", ")}. Not in force until its date.
                    </div>
                )}
                {onRecord && (
                    <SmallButton tone="primary" disabled={Boolean(recordBlockedReason)} onClick={onRecord}>
                        Record rate change
                    </SmallButton>
                )}
            </div>

            {recordBlockedReason && <p className="text-xs text-slate-500">{recordBlockedReason}</p>}

            {!available ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-state="unavailable">
                    Rate history is not available in this database yet: it needs a database update (migration 054) that has not been applied. The rate above comes from the loan's terms; no historical rates are known.
                </p>
            ) : live.length === 0 ? (
                <p className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600" data-state="empty">
                    No rate history is recorded for this loan. Earlier rates are not known. When the first change is recorded, the rate above is saved as the original rate from the loan's start date.
                </p>
            ) : (
                <>
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-xs" data-table="rate-history">
                            <thead className="bg-slate-50 text-slate-500">
                                <tr>
                                    {["From", "Until", "Rate", "Change", "Source", "Ref. / notes", ""].map(header => (
                                        <th key={header} className="whitespace-nowrap px-2 py-1.5 text-left font-medium">
                                            {header}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {live.map(entry => {
                                    const source = sourceDetails(entry);
                                    const reference = referenceText(entry);
                                    return (
                                        <tr key={entry.id} className="border-t border-slate-100 align-top" data-entry={entry.id}>
                                            <td className="whitespace-nowrap px-2 py-1.5">{formatDisplayDate(entry.effectiveFrom)}</td>
                                            <td className="whitespace-nowrap px-2 py-1.5">{entry.effectiveUntil ? formatDisplayDate(entry.effectiveUntil) : "-"}</td>
                                            <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-slate-900">
                                                {rateText(entry.rate)}
                                                {current?.id === entry.id && (
                                                    <span className="mt-0.5 block w-fit rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700" data-current="true">
                                                        Current
                                                    </span>
                                                )}
                                                {entry.effectiveFrom > today && <span className="mt-0.5 block w-fit rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">Upcoming</span>}
                                            </td>
                                            <td className="whitespace-nowrap px-2 py-1.5" data-change="true">
                                                <div>{changeText(entry)}</div>
                                                {entry.previousRate !== null && <div className="text-[11px] text-slate-500">from {rateText(entry.previousRate)}</div>}
                                            </td>
                                            <td className="px-2 py-1.5" title={source.full} data-source={entry.source}>
                                                <div className="whitespace-nowrap">{source.label}</div>
                                                {source.detail && <div className="whitespace-nowrap text-[11px] text-slate-500">{source.detail}</div>}
                                            </td>
                                            <td className="w-full max-w-0 px-2 py-1.5 text-slate-600" title={reference ?? undefined} data-reference="true">
                                                <div className="truncate">{reference ?? "-"}</div>
                                            </td>
                                            <td className="whitespace-nowrap px-2 py-1.5 text-right">
                                                {onCorrect && !recordBlockedReason && <SmallButton onClick={() => onCorrect(entry)}>Correct</SmallButton>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {chart.length > 1 && (
                        <div className="h-40 w-full rounded-lg border border-slate-200 px-2 pt-2" data-chart="rate-trend">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chart}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                    <XAxis dataKey="date" tickFormatter={formatDisplayDate} tick={{ fontSize: 10 }} />
                                    <YAxis domain={["auto", "auto"]} tickFormatter={value => `${value}%`} tick={{ fontSize: 10 }} width={44} />
                                    <Tooltip formatter={value => [`${value}%`, "Rate"]} labelFormatter={label => formatDisplayDate(String(label))} />
                                    <Line type="stepAfter" dataKey="rate" stroke="#0f172a" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </>
            )}

            {superseded.length > 0 && (
                <div className="space-y-1" data-section="corrections">
                    <div className="text-xs font-semibold text-slate-700">Correction history</div>
                    <ul className="space-y-1 text-xs text-slate-600">
                        {superseded.map(entry => {
                            const replacement = entry.supersededBy ? byId.get(entry.supersededBy) : undefined;
                            return (
                                <li key={entry.id} className="rounded-lg border border-slate-100 px-3 py-1.5">
                                    <span className="line-through">
                                        {rateText(entry.rate)} from {formatDisplayDate(entry.effectiveFrom)}
                                    </span>{" "}
                                    ({INTEREST_RATE_SOURCE_LABELS[entry.source]}) - replaced{entry.supersededAt ? ` on ${formatDisplayDate(entry.supersededAt)}` : ""}
                                    {replacement ? ` by ${rateText(replacement.rate)} from ${formatDisplayDate(replacement.effectiveFrom)}` : ""}. Reason: {entry.correctionReason}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </section>
    );
}
