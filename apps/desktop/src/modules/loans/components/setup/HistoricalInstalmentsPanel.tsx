import { useMemo, useState } from "react";

import { LoanSetupRepository } from "../../repositories/LoanSetupRepository";
import { formatMoney } from "../../setup/loanSetupAccounting";
import {
    HISTORICAL_MATCH_WINDOW_DAYS,
    dueInstalmentCount,
    historicalSummary,
    entriesFromDraft,
    localToday,
    matchHistoricalEmiDebits,
    resizeHistorical,
    suggestHistoricalLinks,
    type HistoricalCandidate,
    type HistoricalInstalmentDraft,
} from "../../setup/historicalInstalments";
import { setupLinkedTransactionIds, unmarkedSchedulePreview } from "../../setup/loanSetupWizard";
import type { LinkedTransactionSummary } from "../../setup/loanSetupTypes";
import type { StepProps } from "./SetupSteps";
import { Field, IssueList, NumberField, SmallButton, StepSection, formatDisplayDate } from "./setupFields";

// ---------------------------------------------------------------------
// A loan that was already running: its first instalments, resolved one by
// one. FinWea only SUGGESTS existing bank debits that could be each EMI
// (same account, money out, exact amount, near the due date) - nothing is
// linked until the user presses Link (or confirms all suggestions). An
// instalment with no bank debit can be marked "Settled before FinWea":
// it is then paid with no transaction and stays labelled as such.
// ---------------------------------------------------------------------

function shiftDays(iso: string, days: number): string {
    const date = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + days));
    return date.toISOString().slice(0, 10);
}

function CandidateLine({ candidate, onLink }: { candidate: HistoricalCandidate; onLink(): void }) {
    const t = candidate.transaction;

    return (
        <div className="flex items-start justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-slate-50">
            <div className="min-w-0 text-sm">
                <div className="font-medium text-slate-800">
                    {formatDisplayDate(t.date)} · {formatMoney(t.amount)}
                </div>
                <div className="truncate text-xs text-slate-500">
                    {t.narration || t.payee}
                    {t.categoryName ? ` · ${t.categoryName}` : ""}
                </div>
                <div className="text-xs text-slate-400">{candidate.reasons.join(" · ")}</div>
            </div>
            <SmallButton onClick={onLink}>Link</SmallButton>
        </div>
    );
}

export function HistoricalInstalmentsPanel({ draft, update, issues }: StepProps) {
    const today = localToday();
    const [candidates, setCandidates] = useState<LinkedTransactionSummary[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    const schedule = useMemo(() => {
        try {
            return unmarkedSchedulePreview(draft).schedule;
        } catch {
            return null;
        }
    }, [draft]);

    const due = schedule ? dueInstalmentCount(schedule, today) : 0;
    const rows = schedule ? schedule.slice(0, draft.historical.length) : [];
    const otherLinked = setupLinkedTransactionIds(draft);
    const chosenIds = draft.historical.map(item => item.transaction?.id).filter((id): id is string => Boolean(id));

    const matches = useMemo(() => {
        if (!candidates || !draft.linkedAccountId) {
            return null;
        }

        return matchHistoricalEmiDebits(rows, candidates, {
            accountId: draft.linkedAccountId,
            loanStartDate: draft.startDate,
            today,
            loanAccountNumber: draft.loanAccountNumber,
            lenderName: draft.lenderName,
            excludeIds: otherLinked,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [candidates, draft.linkedAccountId, draft.startDate, draft.loanAccountNumber, draft.lenderName, rows.map(r => `${r.installmentNumber}|${r.dueDate}|${r.totalAmount}`).join(","), otherLinked.join(",")]);

    const suggestions = useMemo(() => {
        if (!matches) {
            return new Map<number, HistoricalCandidate>();
        }

        // Only unresolved instalments get a suggestion, never a debit that
        // is already linked to another one.
        const open = new Map([...matches].filter(([number]) => {
            const index = rows.findIndex(row => row.installmentNumber === number);
            return index >= 0 && draft.historical[index]?.resolution === null;
        }));

        return suggestHistoricalLinks(open, chosenIds);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [matches, draft.historical]);

    const summary = historicalSummary(schedule ? entriesFromDraft(schedule, draft.historical) : []);

    function setCount(value: number | null) {
        const count = Math.max(0, Math.floor(value ?? 0));
        update(current => ({ historicalCount: count, historical: resizeHistorical(current.historical, count) }));
    }

    function setItem(index: number, item: HistoricalInstalmentDraft) {
        update(current => ({
            historical: current.historical.map((existing, i) => (i === index ? item : existing)),
        }));
    }

    function confirmAllSuggestions() {
        update(current => ({
            historical: current.historical.map((existing, index) => {
                const number = rows[index]?.installmentNumber;
                const suggestion = number !== undefined ? suggestions.get(number) : undefined;
                return existing.resolution === null && suggestion
                    ? { resolution: "LINKED" as const, transaction: suggestion.transaction }
                    : existing;
            }),
        }));
    }

    async function findDebits() {
        if (!draft.linkedAccountId || rows.length === 0) {
            return;
        }

        setLoading(true);
        setLoadError(null);

        try {
            const found = await new LoanSetupRepository().findHistoricalEmiCandidates({
                accountId: draft.linkedAccountId,
                amounts: rows.map(row => row.totalAmount),
                fromDate: shiftDays(rows[0]!.dueDate.slice(0, 10), -HISTORICAL_MATCH_WINDOW_DAYS),
                toDate: shiftDays(rows[rows.length - 1]!.dueDate.slice(0, 10), HISTORICAL_MATCH_WINDOW_DAYS),
                excludeIds: otherLinked,
            });
            setCandidates(found);
        } catch (error) {
            console.error("Failed to find historical EMI debits:", error);
            setLoadError("Could not load bank transactions.");
        } finally {
            setLoading(false);
        }
    }

    const historicalIssues = issues.filter(issue => issue.field === "historical");

    return (
        <StepSection
            title="Instalments Paid Before FinWea"
            hint="Only for a loan that was already running. Each instalment is linked to its real bank debit, or marked Settled before FinWea. Nothing is marked paid from a number alone, and an instalment due after today can never be marked paid."
        >
            {!schedule ? (
                <p className="text-xs text-slate-500">Complete the schedule above first.</p>
            ) : due === 0 ? (
                <p className="text-xs text-slate-500">No instalment is due on or before today ({formatDisplayDate(today)}), so there is nothing to resolve.</p>
            ) : (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-x-5">
                        <Field
                            label="Instalments paid before FinWea"
                            htmlFor="setup-historical-count"
                            hint={`${due} instalment${due === 1 ? " is" : "s are"} due on or before today. Leave 0 for a new loan.`}
                        >
                            <NumberField id="setup-historical-count" value={draft.historicalCount} step="1" onChange={setCount} />
                        </Field>
                    </div>

                    {draft.historical.length > 0 && (
                        <>
                            <div className="flex flex-wrap items-center gap-2">
                                <SmallButton onClick={() => void findDebits()} disabled={loading || !draft.linkedAccountId}>
                                    {candidates ? "Search bank debits again" : "Find matching bank debits"}
                                </SmallButton>
                                {suggestions.size > 0 && (
                                    <SmallButton tone="primary" onClick={confirmAllSuggestions}>
                                        Confirm all {suggestions.size} suggested match{suggestions.size === 1 ? "" : "es"}
                                    </SmallButton>
                                )}
                                {loading && <span className="text-xs text-slate-500">Searching...</span>}
                                {loadError && <span className="text-xs text-red-600">{loadError}</span>}
                                {!draft.linkedAccountId && <span className="text-xs text-red-600">Choose the EMI bank account on Loan Details first.</span>}
                            </div>
                            <p className="text-xs text-slate-500">
                                Suggested debits are on the EMI account, money out, for exactly the instalment amount and within {HISTORICAL_MATCH_WINDOW_DAYS} days of the due date. A suggestion is not linked until you press Link or confirm it - check each one is really this loan's EMI.
                            </p>

                            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                                {rows.map((row, index) => {
                                    const item = draft.historical[index]!;
                                    const rowMatches = (matches?.get(row.installmentNumber) ?? []).filter(
                                        candidate => !chosenIds.includes(candidate.transaction.id)
                                    );
                                    const suggestion = suggestions.get(row.installmentNumber);

                                    return (
                                        <div key={row.id} className="space-y-1.5 px-3 py-2">
                                            <div className="flex items-center justify-between gap-3 text-sm">
                                                <span className="font-medium text-slate-800">
                                                    #{row.installmentNumber} · due {formatDisplayDate(row.dueDate)} · {formatMoney(row.totalAmount)}
                                                </span>
                                                {item.resolution === null && (
                                                    <SmallButton onClick={() => setItem(index, { resolution: "SETTLED_BEFORE_FINWEA", transaction: null })}>
                                                        Settled before FinWea
                                                    </SmallButton>
                                                )}
                                            </div>

                                            {item.resolution === "LINKED" && item.transaction && (
                                                <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-sm">
                                                    <div className="min-w-0">
                                                        <div className="font-medium text-emerald-900">
                                                            Linked: {formatDisplayDate(item.transaction.date)} · {formatMoney(item.transaction.amount)}
                                                        </div>
                                                        <div className="truncate text-xs text-emerald-800">{item.transaction.narration || item.transaction.payee}</div>
                                                    </div>
                                                    <SmallButton tone="danger" onClick={() => setItem(index, { resolution: null, transaction: null })}>
                                                        Unlink
                                                    </SmallButton>
                                                </div>
                                            )}

                                            {item.resolution === "SETTLED_BEFORE_FINWEA" && (
                                                <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-1.5 text-sm">
                                                    <div className="text-amber-900">
                                                        <div className="font-medium">Settled before FinWea</div>
                                                        <div className="text-xs">Paid with no bank transaction in FinWea. It is labelled this way everywhere, never as a linked payment.</div>
                                                    </div>
                                                    <SmallButton tone="danger" onClick={() => setItem(index, { resolution: null, transaction: null })}>
                                                        Undo
                                                    </SmallButton>
                                                </div>
                                            )}

                                            {item.resolution === null && matches && (
                                                rowMatches.length === 0 ? (
                                                    <p className="text-xs text-slate-500">No unlinked debit for exactly this amount near the due date.</p>
                                                ) : (
                                                    <div className="space-y-0.5">
                                                        {suggestion && <div className="text-xs font-medium text-slate-600">Suggested:</div>}
                                                        {[...(suggestion ? [suggestion] : []), ...rowMatches.filter(c => c !== suggestion)]
                                                            .slice(0, 4)
                                                            .map(candidate => (
                                                                <CandidateLine
                                                                    key={candidate.transaction.id}
                                                                    candidate={candidate}
                                                                    onLink={() => setItem(index, { resolution: "LINKED", transaction: candidate.transaction })}
                                                                />
                                                            ))}
                                                    </div>
                                                )
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <p className="text-xs text-slate-600">
                                Linked bank debits: <span className="font-medium">{summary.linked}</span> · Settled before FinWea:{" "}
                                <span className="font-medium">{summary.settledBeforeFinwea}</span> · Still to resolve:{" "}
                                <span className="font-medium">{summary.unresolved}</span>
                            </p>
                        </>
                    )}
                </div>
            )}

            <IssueList issues={historicalIssues} />
        </StepSection>
    );
}
