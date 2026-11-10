import { useMemo, useState } from "react";

import type { CsvDocument } from "@financeos/import-engine";

import type { LoanPaymentSchedule } from "../../types";
import { formatMoney } from "../../setup/loanSetupAccounting";
import {
    LENDER_SCHEDULE_FIELDS,
    compareWithEstimate,
    parseLenderScheduleCsv,
    validateLenderSchedule,
    type LenderScheduleMapping,
} from "../../setup/lenderSchedule";
import { generatedSchedulePreview, schedulePreview, termPrincipal } from "../../setup/loanSetupWizard";
import type { ScheduleMethod } from "../../setup/loanSetupTypes";
import { HistoricalInstalmentsPanel } from "./HistoricalInstalmentsPanel";
import type { StepProps } from "./SetupSteps";
import { ChoiceSelect, IssueList, SmallButton, StepSection, SummaryGrid, formatDisplayDate } from "./setupFields";

export function ScheduleTable({ schedule, limit = 12 }: { schedule: readonly LoanPaymentSchedule[]; limit?: number }) {
    const [showAll, setShowAll] = useState(false);
    const rows = showAll || schedule.length <= limit + 1 ? schedule : [...schedule.slice(0, limit), schedule[schedule.length - 1]!];

    let opening = 0;
    const openings = new Map<string, number>();
    schedule.forEach((row, index) => {
        opening = row.openingPrincipal ?? (index === 0 ? row.outstandingPrincipal + row.principalAmount : opening);
        openings.set(row.id, opening);
        opening = row.outstandingPrincipal;
    });

    return (
        <div className="space-y-1.5">
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-slate-500">
                        <tr>
                            {["#", "Due Date", "Opening", "Principal", "Interest", "EMI", "Closing", "Status"].map(header => (
                                <th key={header} className="px-2 py-1.5 text-right font-medium first:text-left [&:nth-child(2)]:text-left">
                                    {header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, index) => (
                            <tr key={row.id} className="border-t border-slate-100">
                                <td className="px-2 py-1 text-left">
                                    {!showAll && index === limit && schedule.length > limit + 1 ? "…" : ""}
                                    {row.installmentNumber}
                                </td>
                                <td className="px-2 py-1 text-left">{formatDisplayDate(row.dueDate)}</td>
                                <td className="px-2 py-1 text-right">{formatMoney(openings.get(row.id) ?? 0)}</td>
                                <td className="px-2 py-1 text-right">{formatMoney(row.principalAmount)}</td>
                                <td className="px-2 py-1 text-right">{formatMoney(row.interestAmount)}</td>
                                <td className="px-2 py-1 text-right">{formatMoney(row.totalAmount)}</td>
                                <td className="px-2 py-1 text-right">{formatMoney(row.outstandingPrincipal)}</td>
                                <td className="px-2 py-1 text-right">
                                    {row.status !== "PAID"
                                        ? "Upcoming"
                                        : row.settledBeforeFinwea
                                          ? "Settled before FinWea"
                                          : row.transactionId
                                            ? "Paid (linked)"
                                            : "Paid"}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {schedule.length > limit + 1 && (
                <SmallButton onClick={() => setShowAll(value => !value)}>{showAll ? "Show fewer" : `Show all ${schedule.length} instalments`}</SmallButton>
            )}
        </div>
    );
}

function MethodCard({ selected, title, text, onSelect }: { selected: boolean; title: string; text: string; onSelect(): void }) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={`rounded-xl border px-4 py-3 text-left transition ${selected ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:bg-slate-50"}`}
        >
            <div className="text-sm font-semibold text-slate-900">{title}</div>
            <div className="mt-0.5 text-xs text-slate-500">{text}</div>
        </button>
    );
}

export function ScheduleStep({ draft, update, issues, accounts }: StepProps) {
    const [document, setDocument] = useState<CsvDocument | null>(null);
    const [fileName, setFileName] = useState(draft.lenderSchedule?.fileName ?? "");
    const [mapping, setMapping] = useState<LenderScheduleMapping>({});
    const [readError, setReadError] = useState<string | null>(null);

    const principal = termPrincipal(draft);
    const validation = useMemo(
        () => (document ? validateLenderSchedule(document, mapping, { principalAmount: principal, startDate: draft.startDate || null }) : null),
        [document, mapping, principal, draft.startDate]
    );

    const estimate = useMemo(() => {
        try {
            return { preview: generatedSchedulePreview(draft), error: null as string | null };
        } catch (error) {
            return { preview: null, error: error instanceof Error ? error.message : String(error) };
        }
    }, [draft]);

    const saved = useMemo(() => {
        try {
            return schedulePreview(draft);
        } catch {
            return null;
        }
    }, [draft]);

    const comparison = useMemo(
        () => (validation?.rows && estimate.preview ? compareWithEstimate(validation.rows, estimate.preview.schedule) : null),
        [validation, estimate]
    );

    async function readFile(file: File) {
        setReadError(null);

        if (!/\.csv$/i.test(file.name)) {
            setReadError("Choose a CSV file. PDF and Excel schedules are not supported - save the schedule as CSV first.");
            return;
        }

        try {
            const parsed = parseLenderScheduleCsv(await file.text());
            if (parsed.document.headers.length === 0) {
                setReadError("The file is empty.");
                return;
            }
            setDocument(parsed.document);
            setMapping(parsed.mapping);
            setFileName(file.name);
            update({ lenderSchedule: null });
        } catch (error) {
            console.error("Failed to read lender schedule:", error);
            setReadError("The file could not be read as CSV.");
        }
    }

    const setMethod = (scheduleMethod: ScheduleMethod) => update({ scheduleMethod });
    const headerOptions = [{ value: "", label: "Not in file" }, ...(document?.headers ?? []).filter(Boolean).map(header => ({ value: header, label: header }))];

    return (
        <div className="space-y-4">
            <StepSection title="Repayment Schedule">
                <div className="grid grid-cols-2 gap-3">
                    <MethodCard
                        selected={draft.scheduleMethod === "GENERATED"}
                        title="Generate automatically"
                        text="FinWea builds the amortisation schedule from the terms you entered."
                        onSelect={() => setMethod("GENERATED")}
                    />
                    <MethodCard
                        selected={draft.scheduleMethod === "LENDER_CSV"}
                        title="Import lender schedule (CSV)"
                        text="Use the lender's official schedule. Its figures are saved exactly as given."
                        onSelect={() => setMethod("LENDER_CSV")}
                    />
                </div>
            </StepSection>

            {draft.scheduleMethod === "GENERATED" && (
                <StepSection title="Preview">
                    {estimate.error ? (
                        <IssueList issues={[{ field: "schedule", message: estimate.error }]} />
                    ) : (
                        estimate.preview && (
                            <>
                                <SummaryGrid
                                    items={[
                                        { label: "EMI", value: formatMoney(estimate.preview.emiAmount) },
                                        { label: "Instalments", value: estimate.preview.tenureMonths },
                                        { label: "First EMI", value: formatDisplayDate(estimate.preview.schedule[0]?.dueDate) },
                                        { label: "Last EMI", value: formatDisplayDate(estimate.preview.maturityDate) },
                                        { label: "Total interest", value: formatMoney(estimate.preview.schedule.reduce((s, r) => s + r.interestAmount, 0)) },
                                        { label: "Outstanding principal", value: formatMoney((saved ?? estimate.preview).outstandingPrincipal) },
                                    ]}
                                />
                                <ScheduleTable schedule={(saved ?? estimate.preview).schedule} />
                            </>
                        )
                    )}
                </StepSection>
            )}

            {draft.scheduleMethod === "LENDER_CSV" && (
                <StepSection
                    title="Lender Schedule (CSV)"
                    hint="Columns needed: due date, principal, interest, EMI and closing principal. Instalment number and opening principal are used when present."
                >
                    <input
                        type="file"
                        accept=".csv,text/csv"
                        className="block text-sm text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-200 file:bg-white file:px-3 file:py-1.5 file:text-sm"
                        onChange={event => {
                            const file = event.target.files?.[0];
                            if (file) void readFile(file);
                        }}
                    />
                    {fileName && <p className="text-xs text-slate-500">File: {fileName}</p>}
                    {readError && <IssueList issues={[{ field: "file", message: readError }]} />}

                    {document && (
                        <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                            {LENDER_SCHEDULE_FIELDS.map(definition => (
                                <label key={definition.field} className="space-y-1 text-xs text-slate-600">
                                    <span>
                                        {definition.label}
                                        {definition.required && <span className="text-red-500"> *</span>}
                                    </span>
                                    <ChoiceSelect
                                        id={`map-${definition.field}`}
                                        value={mapping[definition.field] ?? ""}
                                        options={headerOptions}
                                        onChange={value => {
                                            setMapping(current => ({ ...current, [definition.field]: value || undefined }));
                                            update({ lenderSchedule: null });
                                        }}
                                    />
                                </label>
                            ))}
                        </div>
                    )}

                    {validation && (
                        <div className="space-y-2">
                            <IssueList issues={validation.errors.slice(0, 15)} />
                            {validation.errors.length > 15 && <p className="text-xs text-red-600">…and {validation.errors.length - 15} more problems.</p>}
                            <IssueList issues={validation.warnings} tone="warning" />

                            {validation.summary && validation.rows && (
                                <>
                                    <SummaryGrid
                                        items={[
                                            { label: "Instalments", value: validation.summary.instalments },
                                            { label: "Regular EMI", value: formatMoney(validation.summary.regularEmi) },
                                            { label: "First due", value: formatDisplayDate(validation.summary.firstDueDate) },
                                            { label: "Total principal", value: formatMoney(validation.summary.totalPrincipal) },
                                            { label: "Total interest", value: formatMoney(validation.summary.totalInterest) },
                                            { label: "Final balance", value: formatMoney(validation.summary.finalClosingPrincipal) },
                                        ]}
                                    />

                                    {comparison && (
                                        <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                                            <div className="font-medium text-slate-800">Compared with FinWea's estimate from your terms</div>
                                            {comparison.identical ? (
                                                <p className="text-xs text-emerald-700">The lender schedule matches the estimate exactly.</p>
                                            ) : (
                                                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-600">
                                                    {comparison.explanations.map(text => (
                                                        <li key={text}>{text}</li>
                                                    ))}
                                                    <li>The lender's figures are what will be saved - none is replaced by FinWea's calculation.</li>
                                                </ul>
                                            )}
                                        </div>
                                    )}
                                    {estimate.error && <p className="text-xs text-slate-500">No estimate to compare: {estimate.error}</p>}

                                    {draft.lenderSchedule ? (
                                        <p className="text-xs font-medium text-emerald-700">This schedule will be saved with the loan.</p>
                                    ) : (
                                        <SmallButton tone="primary" onClick={() => update({ lenderSchedule: { fileName, rows: validation.rows! } })}>
                                            Use this schedule
                                        </SmallButton>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {draft.lenderSchedule && saved && <ScheduleTable schedule={saved.schedule} />}
                    {draft.lenderSchedule && draft.firstEmiDate && draft.lenderSchedule.rows[0]?.dueDate !== draft.firstEmiDate && (
                        <IssueList
                            tone="warning"
                            issues={[
                                {
                                    field: "firstEmiDate",
                                    message: `The lender's first instalment is due ${formatDisplayDate(draft.lenderSchedule.rows[0]?.dueDate)}, not the ${formatDisplayDate(draft.firstEmiDate)} you entered. The lender's date is used.`,
                                },
                            ]}
                        />
                    )}
                </StepSection>
            )}

            <IssueList issues={issues.filter(issue => issue.field === "schedule")} />

            <HistoricalInstalmentsPanel draft={draft} update={update} issues={issues} accounts={accounts} />
        </div>
    );
}
