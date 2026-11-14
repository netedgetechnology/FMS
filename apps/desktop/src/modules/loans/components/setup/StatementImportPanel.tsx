import { useMemo, useRef, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
    FACILITY_TYPES,
    FACILITY_TYPE_LABELS,
    analyseLoanStatement,
    readStatementPdf,
    type FacilityExtraction,
    type FacilityType,
    type FieldId,
    type FieldValue,
    type LedgerEntry,
    type LoanStatementAnalysis,
} from "@financeos/import-engine";

import { getErrorMessage } from "@/core/errors";

import { formatMoney } from "../../setup/loanSetupAccounting";
import {
    chooseAlternative,
    createReviewState,
    editField,
    reconciliationFindings,
    removeCharge,
    removeDisbursement,
    missingForSelection,
    reviewBlockers,
    reviewSections,
    routeForType,
    selectType,
    selectedExtension,
    setConfirmed,
    typeLabel,
    updateCharge,
    updateDisbursement,
    type ReviewField,
    type StatementReviewState,
} from "../../statementImport/statementReview";
import { reviewToDraft, type StatementDraftResult } from "../../statementImport/statementToDraft";
import { savesDirectly } from "../../statementImport/statementLoanSetup";
import type { CreateLoanRequest } from "../../types";
import { ChoiceSelect, Field, IssueList, NumberField, SmallButton, StepSection, SummaryGrid, formatDisplayDate } from "./setupFields";
import { StatementLoanSetup } from "./StatementLoanSetup";
import { StatementRateProposals } from "./StatementRateProposals";
import { editOriginalRate, editRateProposal } from "../../statementImport/statementReview";
import { hasRateProposals, rateReviewIssues, type ConfirmedStatementRates } from "../../statementImport/statementRateProposals";

// ---------------------------------------------------------------------
// Add Loan from a lender statement: read, classify and show the customer
// everything with its source. A Term Loan is completed and saved from this
// review itself (StatementLoanSetup - the one confirmation, the atomic
// save); other routes (Overdraft) still hand a draft to the Add Loan
// wizard. Nothing is written before that final confirmation.
// ---------------------------------------------------------------------

export interface StatementImportPanelProps {
    onContinue(result: StatementDraftResult, fileName: string): void;
    onCancel(): void;
    /**
     * Term Loan: save straight from the review (no second pass through the
     * wizard). `rateChanges`: the statement's confirmed rate changes, to be
     * recorded after creation through the reviewed Record Rate Change workflow.
     */
    onSaveTermLoan?(request: CreateLoanRequest, rateChanges?: ConfirmedStatementRates | null): Promise<void> | void;
    saving?: boolean;
    /**
     * Interest rate history (migration 054) is available, so the statement's
     * rate changes can be corrected and saved. Decided by the caller: this
     * panel reads nothing from the database.
     */
    rateHistoryAvailable?: boolean;
}

const PROVENANCE_STYLES = {
    SOURCE: ["From statement", "bg-emerald-50 text-emerald-700"],
    CALCULATED: ["Calculated", "bg-sky-50 text-sky-700"],
    MANUAL: ["Entered by you", "bg-violet-50 text-violet-700"],
} as const;

function FieldBadge({ field }: { field: ReviewField }) {
    if (field.status === "CONFLICT") return <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">Conflicting values</span>;
    if (field.status === "NOT_IN_DOCUMENT" || !field.provenance) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Not in document</span>;

    const [label, style] = PROVENANCE_STYLES[field.provenance];

    return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style}`}>{label}</span>;
}

function sourceText(field: ReviewField): string {
    const source = field.sources[0];
    const where = source ? `Page ${source.page}: "${source.label}"` : "";
    const checks = field.verification === "CROSS_CHECKED" ? "agrees with other figures in the statement" : field.provenance === "SOURCE" && field.confidence ? `${field.confidence.toLowerCase()} confidence` : "";

    return [field.note, where, checks].filter(Boolean).join(" - ");
}

function displayValue(value: FieldValue, kind: ReviewField["kind"]): string {
    if (kind === "money" && typeof value === "number") return formatMoney(value);
    if (kind === "date" && typeof value === "string") return formatDisplayDate(value);
    return String(value);
}

function FieldEditor({ field, onChange }: { field: ReviewField; onChange(value: FieldValue | null): void }) {
    const id = `statement-${field.id}`;

    if (field.kind === "money" || field.kind === "rate" || field.kind === "months" || field.kind === "count") {
        return <NumberField id={id} value={typeof field.value === "number" ? field.value : null} onChange={onChange} step={field.kind === "months" || field.kind === "count" ? "1" : "0.01"} />;
    }

    return <Input id={id} type={field.kind === "date" ? "date" : "text"} value={typeof field.value === "string" ? field.value : ""} onChange={event => onChange(event.target.value)} />;
}

function ReviewFieldRow({ field, onChange, onChoose }: { field: ReviewField; onChange(value: FieldValue | null): void; onChoose(index: number): void }) {
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
                <label htmlFor={`statement-${field.id}`} className="text-xs font-medium text-slate-700">
                    {field.label}
                </label>
                <FieldBadge field={field} />
            </div>
            {field.status === "CONFLICT" ? (
                <div className="space-y-1 rounded-lg border border-red-100 bg-red-50/50 p-2">
                    {field.alternatives.map((alternative, index) => (
                        <button key={index} type="button" onClick={() => onChoose(index)} className="flex w-full justify-between rounded-md bg-white px-2 py-1 text-left text-xs ring-1 ring-red-100 hover:bg-red-50">
                            <span className="font-medium text-slate-900">{displayValue(alternative.value, field.kind)}</span>
                            <span className="text-slate-500">Page {alternative.sources[0]?.page}: {alternative.sources[0]?.label}</span>
                        </button>
                    ))}
                </div>
            ) : (
                <FieldEditor field={field} onChange={onChange} />
            )}
            {sourceText(field) && <p className="text-[11px] text-slate-400">{sourceText(field)}</p>}
        </div>
    );
}

function ClassificationPanel({ state, onSelect }: { state: StatementReviewState; onSelect(type: FacilityType): void }) {
    const { classification } = state.facility;

    return (
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Detected loan type</div>
                    <div className="text-lg font-semibold text-slate-900">{typeLabel(classification.detected)}</div>
                    {typeof state.fields.lenderName.value === "string" && <div className="text-xs text-slate-600">{state.fields.lenderName.value}</div>}
                </div>
                <div className="text-xs font-medium text-slate-600">Confidence: {classification.confidence}</div>
            </div>

            {classification.evidence.length > 0 && (
                <div>
                    <div className="text-xs font-semibold text-slate-700">Why</div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-600">
                        {classification.evidence.map((item, index) => (
                            <li key={index}>
                                {item.description}
                                {item.page ? ` (page ${item.page})` : ""}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {classification.conflictingEvidence.length > 0 && (
                <div>
                    <div className="text-xs font-semibold text-amber-800">Conflicting evidence</div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-800">
                        {classification.conflictingEvidence.map((item, index) => (
                            <li key={index}>
                                {item.description}
                                {item.page ? ` (page ${item.page})` : ""}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {classification.reasonForConfirmation && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    Please confirm the type: {classification.reasonForConfirmation}
                </p>
            )}

            <Field label="Confirmed loan type" htmlFor="statement-type" required>
                <ChoiceSelect
                    id="statement-type"
                    value={state.selectedType ?? ""}
                    placeholder="Choose the loan type"
                    options={FACILITY_TYPES.map(type => ({ value: type, label: FACILITY_TYPE_LABELS[type] }))}
                    onChange={value => onSelect(value as FacilityType)}
                />
            </Field>
        </section>
    );
}

const ENTRY_LABELS: Record<LedgerEntry["kind"], string> = {
    OPENING_BALANCE: "Opening balance",
    DRAWDOWN: "Drawdown",
    INSTALMENT_DEMAND: "Instalment due",
    INTEREST_CHARGE: "Interest charged",
    OTHER_CHARGE: "Charge",
    REPAYMENT: "Repayment",
    INTEREST_PAYMENT: "Interest payment",
    DISBURSEMENT_PAYOUT: "Paid out to borrower",
    REVERSAL: "Reversal",
    BOUNCED: "Bounced",
    UNCLASSIFIED: "Unclassified",
};

function LedgerPreview({ facility }: { facility: FacilityExtraction }) {
    const [showAll, setShowAll] = useState(false);
    const { ledgerSummary: summary, ledgerCheck: check, transactions } = facility;

    if (transactions.length === 0) return null;

    const rows = showAll ? transactions : transactions.slice(-8);

    return (
        <StepSection title="Statement activity" hint="For your review only. Statement rows are never saved as transactions; existing bank transactions are linked separately.">
            <SummaryGrid
                items={[
                    { label: "Rows read", value: transactions.length },
                    { label: "Balance checks", value: check ? `${check.checkedRows - check.mismatches} of ${check.checkedRows} agree` : "-" },
                    { label: "Drawdowns", value: `${summary.drawdownCount} / ${formatMoney(summary.drawdownTotal)}` },
                    // Repayment receipts are whole EMIs / payments (principal and
                    // interest together) - not the principal repaid.
                    { label: "Total repayments", value: `${summary.repaymentCount} / ${formatMoney(summary.repaymentTotal)}` },
                    { label: "Interest charged", value: formatMoney(summary.interestChargedTotal) },
                    { label: "Interest paid", value: formatMoney(summary.interestPaidTotal) },
                    { label: "Other charges", value: formatMoney(summary.otherChargesTotal) },
                    { label: "Unclassified rows", value: summary.unclassifiedCount },
                ]}
            />
            <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-slate-500">
                        <tr>
                            {["Date", "Description", "Type", "Amount", "Balance", "Page"].map(header => (
                                <th key={header} className="px-2 py-1.5 text-left font-medium">{header}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((entry, index) => (
                            <tr key={index} className={`border-t border-slate-100 ${entry.chainStatus === "MISMATCH" ? "bg-red-50" : ""}`}>
                                <td className="whitespace-nowrap px-2 py-1">{formatDisplayDate(entry.date)}</td>
                                <td className="px-2 py-1">{entry.description}</td>
                                <td className="whitespace-nowrap px-2 py-1">{ENTRY_LABELS[entry.kind]}{entry.kindProvenance === "CALCULATED" ? " (calculated)" : ""}{entry.isDeduction ? " - deducted" : ""}</td>
                                <td className="whitespace-nowrap px-2 py-1">{formatMoney(entry.amount)} {entry.side === "DEBIT" ? "Dr" : entry.side === "CREDIT" ? "Cr" : ""}</td>
                                <td className="whitespace-nowrap px-2 py-1">{entry.balance === null ? "-" : formatMoney(entry.balance)}</td>
                                <td className="px-2 py-1">{entry.page}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {transactions.length > 8 && <SmallButton onClick={() => setShowAll(value => !value)}>{showAll ? "Show last 8" : `Show all ${transactions.length} rows`}</SmallButton>}
        </StepSection>
    );
}

function ExtensionPreview({ state }: { state: StatementReviewState }) {
    const extension = selectedExtension(state);
    if (!extension) return null;

    if (extension.type === "TERM_LOAN" && extension.schedule.length > 0) {
        return (
            <StepSection title="Official repayment schedule">
                <p className="text-xs text-slate-600">
                    {extension.schedule.length} instalments from {formatDisplayDate(extension.schedule[0]!.dueDate)} to {formatDisplayDate(extension.schedule[extension.schedule.length - 1]!.dueDate)}. It is shown for checking only; import the lender's CSV under Repayment Schedule to use a lender schedule.
                </p>
            </StepSection>
        );
    }

    if (extension.type === "DROPLINE_OVERDRAFT" && extension.reductionSchedule.length > 0) {
        return (
            <StepSection title="Drawing-power reduction schedule">
                <ul className="space-y-0.5 text-xs text-slate-600">
                    {extension.reductionSchedule.map((change, index) => (
                        <li key={index}>{change.effectiveDate ? formatDisplayDate(change.effectiveDate) : "No date"}: {formatMoney(change.amount)}</li>
                    ))}
                </ul>
            </StepSection>
        );
    }

    if ((extension.type === "OVERDRAFT" || extension.type === "CASH_CREDIT") && extension.limitChanges.length > 0) {
        return (
            <StepSection title="Limit and drawing-power revisions">
                <ul className="space-y-0.5 text-xs text-slate-600">
                    {extension.limitChanges.map((change, index) => (
                        <li key={index}>{change.effectiveDate ? formatDisplayDate(change.effectiveDate) : "No date"}: {formatMoney(change.amount)} ({change.subject === "LIMIT" ? "limit" : "drawing power"})</li>
                    ))}
                </ul>
            </StepSection>
        );
    }

    return null;
}

export function ReviewView({
    state,
    setState,
    onContinue,
    onBack,
    warnings = [],
    onSaveTermLoan,
    saving = false,
    rateHistoryAvailable = false,
}: {
    state: StatementReviewState;
    setState(next: StatementReviewState): void;
    onContinue(): void;
    onBack(): void;
    warnings?: readonly string[];
    onSaveTermLoan?(request: CreateLoanRequest, rateChanges?: ConfirmedStatementRates | null): Promise<void> | void;
    saving?: boolean;
    /** Migration 054 applied: rate changes can be corrected and saved. */
    rateHistoryAvailable?: boolean;
}) {
    const route = state.selectedType ? routeForType(state.selectedType, state.droplineEnabled) : null;
    const missing = missingForSelection(state);
    const sections = reviewSections(state);
    const findings = reconciliationFindings(state);
    // Unresolved proposed rate changes stop Continue (only when they can be saved).
    const rateBlocking = rateHistoryAvailable && hasRateProposals(state.rates) ? rateReviewIssues(state.rates).blocking : [];
    const blockers = [
        ...reviewBlockers(state),
        ...(rateBlocking.length > 0 ? [`${rateBlocking.length} issue(s) in the interest rate changes need your attention - resolve or leave out each one marked above.`] : []),
    ];
    const isWizardRoute = route?.kind === "WIZARD";
    // A Term Loan is completed and saved right here, below the review.
    const direct = Boolean(onSaveTermLoan) && savesDirectly(state);

    return (
        <div className="space-y-4">
            <ClassificationPanel state={state} onSelect={type => setState(selectType(state, type))} />

            {warnings.length > 0 && <IssueList tone="warning" issues={warnings.map(message => ({ field: "warning", message }))} />}

            {missing.length > 0 && (
                <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                    <span className="font-semibold text-slate-800">Not stated in this document: </span>
                    {missing.join(", ")}. Nothing has been assumed for these.
                </p>
            )}

            {route?.kind === "UNSUPPORTED" && (
                <section className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <div className="font-semibold">{typeLabel(state.selectedType!)} is not supported in FinWea yet</div>
                    <p className="text-xs">{route.reason}</p>
                    {route.minimumExtension.length > 0 && (
                        <div>
                            <div className="text-xs font-semibold">Minimum work needed</div>
                            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                                {route.minimumExtension.map(item => <li key={item}>{item}</li>)}
                            </ul>
                        </div>
                    )}
                    <p className="text-xs">It has not been saved as another loan type. You can still review what was read below.</p>
                </section>
            )}

            {route?.kind === "WIZARD" && route.limitations.length > 0 && <IssueList tone="warning" issues={route.limitations.map(message => ({ field: "limit", message }))} />}

            {findings.length > 0 && (
                <section className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="text-sm font-semibold text-amber-900">Figures that do not agree</div>
                    {findings.map((finding, index) => (
                        <div key={index} className="text-xs text-amber-900">
                            <p className="font-medium">{finding.message}</p>
                            <ul className="mt-0.5 list-disc pl-4">
                                {finding.values.map((value, valueIndex) => (
                                    <li key={valueIndex}>
                                        {value.label}: {typeof value.value === "number" ? formatMoney(value.value) : value.value}
                                        {value.page ? ` (page ${value.page})` : ""}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </section>
            )}

            {sections.map(section => (
                <StepSection key={section.title} title={section.title}>
                    <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                        {section.fieldIds.map((id: FieldId) => (
                            <ReviewFieldRow
                                key={id}
                                field={state.fields[id]}
                                onChange={value => setState(editField(state, id, value))}
                                onChoose={index => setState(chooseAlternative(state, id, state.fields[id].alternatives[index]!))}
                            />
                        ))}
                    </div>
                </StepSection>
            ))}

            {state.disbursements.length > 0 && (
                <StepSection title="Disbursement history">
                    {state.disbursements.map(row => (
                        <div key={row.key} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                            <Input type="date" value={row.date ?? ""} aria-label="Disbursement date" onChange={event => setState(updateDisbursement(state, row.key, { date: event.target.value || null }))} />
                            <NumberField id={`gross-${row.key}`} value={row.gross} placeholder="Gross" onChange={gross => setState(updateDisbursement(state, row.key, { gross }))} />
                            <NumberField id={`deductions-${row.key}`} value={row.deductions} placeholder="Deductions" onChange={deductions => setState(updateDisbursement(state, row.key, { deductions }))} />
                            <SmallButton tone="danger" onClick={() => setState(removeDisbursement(state, row.key))}>Remove</SmallButton>
                        </div>
                    ))}
                </StepSection>
            )}

            {state.charges.length > 0 && (
                <StepSection title="Charges and expenses">
                    {state.charges.map(row => (
                        <div key={row.key} className="grid grid-cols-[2fr_1fr_auto] items-center gap-2">
                            <Input value={row.name} aria-label="Charge" onChange={event => setState(updateCharge(state, row.key, { name: event.target.value }))} />
                            <NumberField id={`charge-${row.key}`} value={row.amount} onChange={amount => setState(updateCharge(state, row.key, { amount: amount ?? 0 }))} />
                            <SmallButton tone="danger" onClick={() => setState(removeCharge(state, row.key))}>Remove</SmallButton>
                        </div>
                    ))}
                </StepSection>
            )}

            <StatementRateProposals
                review={state.rates}
                available={rateHistoryAvailable}
                onChange={(key, change) => setState(editRateProposal(state, key, change))}
                onOriginalRateChange={rate => setState(editOriginalRate(state, rate))}
            />
            <ExtensionPreview state={state} />
            <LedgerPreview facility={state.facility} />

            {direct && onSaveTermLoan && <StatementLoanSetup review={state} saving={saving} onSave={onSaveTermLoan} onBack={onBack} rateHistoryAvailable={rateHistoryAvailable} />}

            {isWizardRoute && !direct && (
                <label className="flex items-start gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700">
                    <Checkbox checked={state.confirmed} onCheckedChange={checked => setState(setConfirmed(state, checked === true))} />
                    <span>I have checked the loan type and these details. Use them to fill the Add Loan form, where I can still change them. Nothing is saved yet.</span>
                </label>
            )}

            {!direct && blockers.length > 0 && <IssueList tone="warning" issues={blockers.map(message => ({ field: "blocker", message }))} />}

            {!direct && (
                <div className="flex justify-between gap-3 border-t border-slate-100 pt-4">
                    <button type="button" onClick={onBack} className="h-10 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Cancel review</button>
                    <button type="button" disabled={blockers.length > 0} onClick={onContinue} className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                        Continue to Add Loan
                    </button>
                </div>
            )}
        </div>
    );
}

export function StatementImportPanel({ onContinue, onCancel, onSaveTermLoan, saving = false, rateHistoryAvailable = false }: StatementImportPanelProps) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [password, setPassword] = useState("");
    const [needsPassword, setNeedsPassword] = useState(false);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [analysis, setAnalysis] = useState<LoanStatementAnalysis | null>(null);
    const [review, setReview] = useState<StatementReviewState | null>(null);

    const multiple = useMemo(() => (analysis && analysis.facilities.length > 1 ? analysis.facilities : null), [analysis]);

    async function analyse(selected: File, secret: string) {
        setBusy(true);
        setProblem(null);
        setAnalysis(null);
        setReview(null);

        try {
            const read = await readStatementPdf(await selected.arrayBuffer(), secret || undefined);

            if (read.status !== "OK") {
                setNeedsPassword(true);
                setProblem(read.status === "PASSWORD_INCORRECT" ? "That password did not open the PDF." : null);
                return;
            }

            setNeedsPassword(false);

            const result = analyseLoanStatement(read.document);
            setAnalysis(result);

            if (result.status !== "OK") {
                setProblem(result.warnings[0] ?? "Nothing could be read from this document.");
            } else if (result.facilities.length === 1) {
                setReview(createReviewState(result.facilities[0]!, selected.name));
            }
        } catch (error) {
            setProblem(getErrorMessage(error, "This PDF could not be read."));
        } finally {
            setBusy(false);
        }
    }

    if (review) {
        return (
            <ReviewView
                state={review}
                warnings={analysis?.warnings ?? []}
                setState={setReview}
                onSaveTermLoan={onSaveTermLoan}
                saving={saving}
                rateHistoryAvailable={rateHistoryAvailable}
                onBack={() => (multiple ? setReview(null) : (setReview(null), setAnalysis(null)))}
                onContinue={() => {
                    try {
                        const result = reviewToDraft(review);
                        // Without rate history nothing about rates is carried on (as before).
                        onContinue({ ...result, rateHistory: rateHistoryAvailable ? result.rateHistory : null }, review.fileName);
                    } catch (error) {
                        setProblem(getErrorMessage(error, "The review is not complete."));
                    }
                }}
            />
        );
    }

    if (multiple) {
        return (
            <div className="space-y-3">
                <p className="text-sm text-slate-600">This PDF contains {multiple.length} accounts. Each is set up separately - choose one to review.</p>
                {multiple.map(facility => (
                    <button key={facility.id} type="button" onClick={() => setReview(createReviewState(facility, file?.name ?? "statement.pdf"))} className="flex w-full justify-between rounded-xl border border-slate-200 px-4 py-3 text-left text-sm transition hover:bg-slate-50">
                        <span className="font-medium text-slate-900">{String(facility.fields.loanAccountNumber?.value ?? "Account not stated")}</span>
                        <span className="text-slate-500">{typeLabel(facility.classification.detected)} - {facility.classification.confidence} confidence - page {facility.pages[0]}</span>
                    </button>
                ))}
                <button type="button" onClick={onCancel} className="h-10 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Cancel</button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-600">
                Choose the PDF statement from your lender. FinWea reads the facility type and details for you to check - nothing is saved from this step.
            </p>

            <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                disabled={busy}
                className="block w-full text-sm text-slate-600 file:mr-3 file:h-9 file:rounded-lg file:border-0 file:bg-slate-900 file:px-4 file:text-sm file:font-medium file:text-white"
                onChange={event => {
                    const selected = event.target.files?.[0] ?? null;
                    setFile(selected);
                    setPassword("");
                    setNeedsPassword(false);
                    if (selected) void analyse(selected, "");
                }}
            />

            {needsPassword && file && (
                <div className="flex items-end gap-2">
                    <Field label="PDF password" htmlFor="statement-password" className="flex-1">
                        <Input id="statement-password" type="password" value={password} autoComplete="off" onChange={event => setPassword(event.target.value)} />
                    </Field>
                    <SmallButton tone="primary" disabled={!password || busy} onClick={() => void analyse(file, password)}>Open</SmallButton>
                </div>
            )}

            {busy && <p className="text-sm text-slate-500">Reading the statement...</p>}
            {problem && <IssueList issues={[{ field: "statement", message: problem }]} />}

            <div className="flex justify-start border-t border-slate-100 pt-4">
                <button type="button" onClick={onCancel} className="h-10 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Back to manual entry</button>
            </div>
        </div>
    );
}
