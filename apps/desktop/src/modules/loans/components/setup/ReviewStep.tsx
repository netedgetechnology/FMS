import { useMemo } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import type { Account } from "@/modules/accounts/types";

import { computeOverdraftPosition } from "../../services/overdraftPosition";
import { LOAN_KIND_LABELS, LoanKind } from "../../types";
import {
    buildAccountingEntries,
    formatMoney,
    linkedTransactionCategoryWarning,
    summarizeSetup,
} from "../../setup/loanSetupAccounting";
import { INTEREST_METHOD_LABELS, type LoanSetupDraft, type SetupIssue } from "../../setup/loanSetupTypes";
import { draftDrawingPower, draftToDetails, schedulePreview, termPrincipal } from "../../setup/loanSetupWizard";
import { entriesFromDetails, historicalSummary } from "../../setup/historicalInstalments";
import { ScheduleTable } from "./ScheduleStep";
import { IssueList, StepSection, SummaryGrid, formatDisplayDate } from "./setupFields";

export function ReviewStep({
    draft,
    accounts,
    issues,
    confirmed,
    onConfirmedChange,
}: {
    draft: LoanSetupDraft;
    accounts: readonly Account[];
    issues: readonly SetupIssue[];
    confirmed: boolean;
    onConfirmedChange(value: boolean): void;
}) {
    const isOd = draft.loanKind === LoanKind.OVERDRAFT;
    const details = useMemo(() => draftToDetails(draft), [draft]);
    const totals = summarizeSetup(details);
    const historical = historicalSummary(entriesFromDetails(details.historicalInstalments ?? []));
    const accountName = (id: string | null) => accounts.find(account => account.id === id)?.name ?? "No bank account";

    const preview = useMemo(() => {
        if (isOd) return { value: null, error: null };
        try {
            return { value: schedulePreview(draft), error: null };
        } catch (error) {
            return { value: null, error: error instanceof Error ? error.message : String(error) };
        }
    }, [draft, isOd]);

    const transactions = new Map(
        [...draft.disbursements.map(d => d.transaction), ...draft.expenses.map(e => e.transaction)]
            .filter((t): t is NonNullable<typeof t> => Boolean(t))
            .map(t => [t.id, t])
    );

    const entries = buildAccountingEntries({
        loanName: draft.name,
        loanKind: draft.loanKind,
        startDate: draft.startDate,
        principalAmount: isOd ? null : termPrincipal(draft),
        openingUsed: draft.openingUsed,
        openingUsedAsOf: draft.openingUsedAsOf || null,
        disbursements: details.disbursements,
        expenses: details.expenses,
        accountName,
        transactionLabel: id => {
            const t = transactions.get(id);
            return t ? `of ${formatDisplayDate(t.date)} for ${formatMoney(t.amount)}` : id;
        },
    });

    const warnings: SetupIssue[] = [];
    draft.disbursements.forEach((d, index) => {
        const warning = d.transaction && linkedTransactionCategoryWarning(d.transaction, "DISBURSEMENT", `disbursement ${index + 1}`);
        if (warning) warnings.push({ field: `d${index}`, message: warning });
    });
    draft.expenses.forEach((e, index) => {
        const warning = e.transaction && linkedTransactionCategoryWarning(e.transaction, "EXPENSE", `expense ${index + 1}`);
        if (warning) warnings.push({ field: `e${index}`, message: warning });
    });
    if (totals.expensesDeducted > 0 || totals.expensesChargedToLoan > 0) {
        warnings.push({
            field: "reports",
            message: `${formatMoney(totals.expensesDeducted + totals.expensesChargedToLoan)} of initial expenses had no bank debit (kept by the lender). They are recorded on this loan only and do not appear in transaction-based expense reports, so nothing is counted twice.`,
        });
    }
    if (historical.settledBeforeFinwea > 0) {
        warnings.push({
            field: "settledBeforeFinwea",
            message: `${historical.settledBeforeFinwea} instalment${historical.settledBeforeFinwea === 1 ? " is" : "s are"} declared "Settled before FinWea": marked paid with no bank transaction and no payment record, and labelled that way - never as a linked payment.`,
        });
    }
    const unlinkedPaid = details.expenses.filter(e => e.settlement === "PAID_SEPARATELY" && !e.transactionId).length;
    if (unlinkedPaid > 0) {
        warnings.push({
            field: "unlinked",
            message: `${unlinkedPaid} separately paid expense${unlinkedPaid === 1 ? " is" : "s are"} not linked to a bank debit. No transaction is created for ${unlinkedPaid === 1 ? "it" : "them"}; if the payment is in a bank statement, link it so it is accounted once.`,
        });
    }

    const odPosition =
        isOd && Number(draft.creditLimit) > 0
            ? computeOverdraftPosition(
                  draft.creditLimit,
                  { used: draft.openingUsed ?? 0, totalDrawdowns: 0, totalRepayments: 0, totalInterestCharges: 0, invalidLinks: 0 },
                  draftDrawingPower(draft)
              )
            : null;

    return (
        <div className="space-y-4">
            <IssueList issues={issues} />

            <StepSection title={`${LOAN_KIND_LABELS[draft.loanKind]} - ${draft.name || "Unnamed"}`}>
                {isOd ? (
                    <SummaryGrid
                        items={[
                            { label: "Sanctioned limit", value: formatMoney(Number(draft.creditLimit ?? 0)) },
                            { label: "Drawing power", value: draft.drawingPower === null ? "Same as limit" : formatMoney(draft.drawingPower) },
                            { label: "Opening used", value: formatMoney(Number(draft.openingUsed ?? 0)) },
                            { label: "Opening date", value: formatDisplayDate(draft.openingUsedAsOf) },
                            { label: "Available", value: odPosition ? formatMoney(odPosition.available) : "-" },
                            { label: "Interest rate", value: `${draft.interestRate ?? 0}% ${draft.rateType === "FLOATING" ? "floating" : "fixed"}` },
                            { label: "Linked accounts", value: draft.odAccountIds.map(id => accountName(id)).join(", ") || "-" },
                            { label: "Initial expenses", value: formatMoney(totals.expensesTotal) },
                            { label: "Account number", value: draft.loanAccountNumber || "-" },
                        ]}
                    />
                ) : (
                    <SummaryGrid
                        items={[
                            { label: "Sanctioned", value: draft.sanctionedAmount ? formatMoney(draft.sanctionedAmount) : "-" },
                            { label: "Gross disbursed", value: formatMoney(totals.grossDisbursed || termPrincipal(draft)) },
                            { label: "Lender deductions", value: formatMoney(totals.totalDeductions) },
                            { label: "Net received", value: details.disbursements.length ? formatMoney(totals.netReceived) : "-" },
                            { label: "Initial expenses", value: formatMoney(totals.expensesTotal) },
                            { label: "Interest", value: `${draft.interestRate ?? 0}% ${draft.rateType === "FLOATING" ? "floating" : "fixed"}` },
                            { label: "Method", value: INTEREST_METHOD_LABELS[draft.interestMethod] },
                            { label: "Tenure", value: preview.value ? `${preview.value.tenureMonths} months` : "-" },
                            { label: "EMI", value: preview.value ? formatMoney(preview.value.emiAmount) : "-" },
                            { label: "First EMI", value: formatDisplayDate(preview.value?.schedule[0]?.dueDate) },
                            { label: "Opening principal", value: formatMoney(termPrincipal(draft)) },
                            { label: "Projected outstanding", value: preview.value ? formatMoney(preview.value.outstandingPrincipal) : "-" },
                            { label: "Schedule", value: draft.scheduleMethod === "LENDER_CSV" ? "Lender CSV" : "Generated" },
                            { label: "Historical EMIs linked", value: historical.linked },
                            { label: "Settled before FinWea", value: historical.settledBeforeFinwea },
                            { label: "EMI account", value: accountName(draft.linkedAccountId || null) },
                            { label: "Account number", value: draft.loanAccountNumber || "-" },
                        ]}
                    />
                )}
            </StepSection>

            {!isOd && (
                <StepSection title="Repayment Schedule">
                    {preview.error ? <IssueList issues={[{ field: "schedule", message: preview.error }]} /> : preview.value && <ScheduleTable schedule={preview.value.schedule} limit={6} />}
                </StepSection>
            )}

            <StepSection title="Accounting Entries" hint="What this setup records. None of these lines creates a bank transaction - existing bank transactions are only linked.">
                {entries.length === 0 ? (
                    <p className="text-sm text-slate-500">No opening entries.</p>
                ) : (
                    <div className="space-y-2">
                        {entries.map((entry, index) => (
                            <div key={`${entry.title}-${index}`} className="rounded-lg border border-slate-200">
                                <div className="flex justify-between border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs">
                                    <span className="font-medium text-slate-800">{entry.title}</span>
                                    <span className="text-slate-500">{formatDisplayDate(entry.date)}</span>
                                </div>
                                <table className="w-full text-xs">
                                    <thead className="text-slate-400">
                                        <tr>
                                            <th className="px-3 py-1 text-left font-medium">Account</th>
                                            <th className="px-3 py-1 text-right font-medium">Debit</th>
                                            <th className="px-3 py-1 text-right font-medium">Credit</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {entry.lines.map((line, lineIndex) => (
                                            <tr key={lineIndex} className="border-t border-slate-50">
                                                <td className="px-3 py-1 text-slate-700">{line.account}</td>
                                                <td className="px-3 py-1 text-right">{line.debit !== null ? formatMoney(line.debit) : ""}</td>
                                                <td className="px-3 py-1 text-right">{line.credit !== null ? formatMoney(line.credit) : ""}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <p className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-500">{entry.bankEffect}</p>
                            </div>
                        ))}
                    </div>
                )}
            </StepSection>

            <IssueList issues={warnings} tone="warning" />

            <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                <Checkbox checked={confirmed} onCheckedChange={checked => onConfirmedChange(checked === true)} />
                <span>I have checked these details against my sanction letter and statements. Save the loan and its setup.</span>
            </label>
        </div>
    );
}
