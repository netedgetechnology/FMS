import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { useDisplaySettings } from "@/core/formatting/useDisplaySettings";
import { AccountService } from "@/modules/accounts/services";
import type { Account } from "@/modules/accounts/types";
import { useCurrencies } from "@/modules/currencies";

import { LoanService } from "../../services/LoanService";
import { disbursementNet, expenseAmounts, formatMoney } from "../../setup/loanSetupAccounting";
import { EXPENSE_SETTLEMENT_LABELS, INTEREST_METHOD_LABELS, type InterestMethod, type LoanSetupDraft, type SetupIssue } from "../../setup/loanSetupTypes";
import { draftToCreateRequest, setupLinkedTransactionIds } from "../../setup/loanSetupWizard";
import {
    applyCompletionChange,
    emptyStatementCompletion,
    setChargeCompletion,
    setDisbursementCompletion,
    statementLoanDraft,
    statementSaveIssues,
    type ChargeCompletion,
    type StatementCompletion,
} from "../../statementImport/statementLoanSetup";
import type { StatementReviewState } from "../../statementImport/statementReview";
import { confirmedStatementRates, hasRateProposals, rateReviewIssues, type ConfirmedStatementRates, type RateLoanContext } from "../../statementImport/statementRateProposals";
import { localToday } from "../../setup/historicalInstalments";
import { LoanKind, type CreateLoanRequest } from "../../types";

import { ReviewStep } from "./ReviewStep";
import { ScheduleStep } from "./ScheduleStep";
import { bankAccountOptions } from "./SetupSteps";
import { TransactionLinkPicker } from "./TransactionLinkPicker";
import { ChoiceSelect, Field, IssueList, NumberField, StepSection, formatDisplayDate, issueFor } from "./setupFields";
import { StatementRateConfirmation } from "./StatementRateProposals";

// ---------------------------------------------------------------------
// The end of Statement Review for a Term Loan: what the statement cannot
// say (name, bank accounts, links, schedule source, past instalments), the
// Statement Check and accounting preview, one confirmation and the save.
// It replaces the second pass through the Add Loan wizard: every figure
// above stays on the review, and nothing is asked twice. Nothing is
// written until "Confirm and Add Loan"; the save is the wizard's own
// atomic one (LoanService.create -> create_loan_atomic).
// ---------------------------------------------------------------------

export interface StatementLoanSetupProps {
    review: StatementReviewState;
    saving: boolean;
    /**
     * `rateChanges`: the statement's confirmed rate changes. The loan is
     * created WITHOUT them (at its original rate); they are recorded next,
     * one by one, through the reviewed Record Rate Change workflow.
     */
    onSave(request: CreateLoanRequest, rateChanges?: ConfirmedStatementRates | null): Promise<void> | void;
    onBack(): void;
    /** Migration 054 applied: the statement's rate changes can be recorded. */
    rateHistoryAvailable?: boolean;
}

export function StatementLoanSetup({ review, saving, onSave, onBack, rateHistoryAvailable = false }: StatementLoanSetupProps) {
    const { currencies } = useCurrencies();
    const { defaultCurrency } = useDisplaySettings();
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [existingLoans, setExistingLoans] = useState<Array<{ name: string; loanAccountNumber?: string | null }>>([]);
    const [completion, setCompletion] = useState<StatementCompletion>(emptyStatementCompletion);
    const [attempted, setAttempted] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    // A separate, explicit tick for the statement's rate changes; any
    // correction to them clears it.
    const [ratesConfirmed, setRatesConfirmed] = useState(false);
    useEffect(() => setRatesConfirmed(false), [review.rates]);

    useEffect(() => {
        let mounted = true;
        new AccountService()
            .getAll()
            .then(result => mounted && setAccounts(result))
            .catch(error => console.error("Failed to load accounts for the statement import:", error));
        new LoanService()
            .getAll()
            .then(result => mounted && setExistingLoans(result))
            .catch(error => console.error("Failed to load loans for the statement import:", error));
        return () => {
            mounted = false;
        };
    }, []);

    const loan = useMemo(() => {
        try {
            return statementLoanDraft(review, completion);
        } catch (error) {
            return { status: "BLOCKED" as const, blockers: [error instanceof Error ? error.message : String(error)] };
        }
    }, [review, completion]);

    const draft = loan.status === "READY" ? loan.draft : null;
    const currencyCode = loan.status === "READY" ? loan.result.currencyCode : null;
    const showRates = rateHistoryAvailable && hasRateProposals(review.rates);
    const rateContext: RateLoanContext | null = draft ? { loanKind: LoanKind.TERM_LOAN, startDate: draft.startDate || null, loanRate: draft.interestRate, today: localToday() } : null;
    const ratesReady = !showRates || (ratesConfirmed && rateContext !== null && rateReviewIssues(review.rates, rateContext).blocking.length === 0);

    // The statement's currency, else the Settings default, once loaded.
    useEffect(() => {
        if (completion.currencyId) return;
        const fallback =
            currencies.find(currency => currency.code === currencyCode)?.id ??
            currencies.find(currency => currency.code === defaultCurrency)?.id;
        if (fallback) setCompletion(current => (current.currencyId ? current : { ...current, currencyId: fallback }));
    }, [currencies, currencyCode, defaultCurrency, completion.currencyId]);

    const issues: SetupIssue[] = useMemo(() => (attempted && draft ? statementSaveIssues(draft, existingLoans) : []), [attempted, draft, existingLoans]);

    if (loan.status === "BLOCKED" || !draft) {
        return (
            <div className="space-y-4">
                <IssueList tone="warning" issues={(loan.status === "BLOCKED" ? loan.blockers : []).map(message => ({ field: "blocker", message }))} />
                <Footer saving={saving} canSave={false} onBack={onBack} onSave={() => undefined} />
            </div>
        );
    }

    function change(next: StatementCompletion) {
        setSaveError(null);
        setConfirmed(false);
        setCompletion(next);
    }

    // The reused schedule / historical components change the draft; only
    // the completion's own keys are taken from what they send.
    function update(changeOrFn: Partial<LoanSetupDraft> | ((current: LoanSetupDraft) => Partial<LoanSetupDraft>)) {
        const patch = typeof changeOrFn === "function" ? changeOrFn(draft!) : changeOrFn;
        change(applyCompletionChange(completion, patch));
    }

    // Links are kept by each row's stable key, so removing or adding a row on
    // the review never moves a bank transaction to another disbursement.
    function setDisbursement(key: string, value: StatementCompletion["disbursements"][string]) {
        change(setDisbursementCompletion(completion, key, value));
    }

    function setCharge(key: string, value: ChargeCompletion) {
        change(setChargeCompletion(completion, key, value));
    }

    async function save() {
        setAttempted(true);
        if (!confirmed || statementSaveIssues(draft!, existingLoans).length > 0) return;

        if (!ratesReady) return;

        let request: CreateLoanRequest;
        let rateChanges: ConfirmedStatementRates | null = null;
        try {
            request = draftToCreateRequest(draft!);
            if (showRates) rateChanges = confirmedStatementRates(review.rates, rateContext!, review.fileName);
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : String(error));
            return;
        }

        await onSave(request, rateChanges);
    }

    const error = (field: string) => issueFor(issues, field);
    const linkedIds = setupLinkedTransactionIds(draft);

    return (
        <div className="space-y-4">
            {loan.result.notes.length > 0 && (
                <div className="space-y-1 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                    {loan.result.notes.map(note => (
                        <p key={note}>{note}</p>
                    ))}
                </div>
            )}

            <StepSection
                title="Needed by FinWea"
                hint="Not in the lender statement - FinWea needs these to set up the loan. Every figure above comes from the statement and is corrected there."
            >
                <div className="grid grid-cols-2 gap-x-5 gap-y-3">
                    <Field label="Loan Name" htmlFor="statement-setup-name" required error={error("name")}>
                        <Input id="statement-setup-name" value={completion.name} placeholder="e.g. Office property loan" onChange={event => change({ ...completion, name: event.target.value })} />
                    </Field>
                    <Field label="Loan Category" htmlFor="statement-setup-category" required error={error("loanCategory")} hint="Your own label. Filled from the statement's product, if it gives one.">
                        <Input id="statement-setup-category" value={draft.loanCategory} onChange={event => change({ ...completion, loanCategory: event.target.value })} />
                    </Field>
                    <Field label="Currency" htmlFor="statement-setup-currency" required error={error("currencyId")}>
                        <ChoiceSelect
                            id="statement-setup-currency"
                            value={draft.currencyId}
                            options={currencies.map(currency => ({ value: currency.id, label: `${currency.code} - ${currency.name}` }))}
                            onChange={value => change({ ...completion, currencyId: value })}
                        />
                    </Field>
                    <Field label="Interest Calculation Method" htmlFor="statement-setup-method">
                        <ChoiceSelect
                            id="statement-setup-method"
                            value={draft.interestMethod}
                            options={(Object.keys(INTEREST_METHOD_LABELS) as InterestMethod[]).map(method => ({ value: method, label: INTEREST_METHOD_LABELS[method] }))}
                            onChange={value => change({ ...completion, interestMethod: value as InterestMethod })}
                        />
                    </Field>
                    <Field label="EMI Debit Bank Account" htmlFor="statement-setup-bank" required error={error("linkedAccountId")} className="col-span-2">
                        <ChoiceSelect
                            id="statement-setup-bank"
                            value={draft.linkedAccountId}
                            options={bankAccountOptions(accounts, [draft.linkedAccountId])}
                            onChange={value => change({ ...completion, linkedAccountId: value })}
                            placeholder="Select account"
                        />
                    </Field>
                </div>

                {draft.disbursements.map((row, index) => {
                    const prefix = `disbursements.${index}`;
                    const net = disbursementNet(Number(row.grossAmount ?? 0), Number(row.deductionsAmount ?? 0));
                    const own = row.transaction?.id;

                    return (
                        <div key={row.key} className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3">
                            <div className="text-xs font-medium text-slate-700">
                                Disbursement {index + 1}: {row.date ? formatDisplayDate(row.date) : "date not stated"} · net {formatMoney(net)} credited to the bank
                            </div>
                            <Field label="Credited To Account" htmlFor={`statement-setup-${prefix}-account`} required error={error(`${prefix}.destinationAccountId`)}>
                                <ChoiceSelect
                                    id={`statement-setup-${prefix}-account`}
                                    value={row.destinationAccountId}
                                    options={bankAccountOptions(accounts, [row.destinationAccountId])}
                                    onChange={value =>
                                        setDisbursement(row.key, { destinationAccountId: value, transaction: row.transaction?.accountId === value ? row.transaction : null })
                                    }
                                    placeholder="Select account"
                                />
                            </Field>
                            <div>
                                <div className="mb-1 text-xs font-medium text-slate-600">Bank credit (optional)</div>
                                <TransactionLinkPicker
                                    accountId={row.destinationAccountId}
                                    side="IN"
                                    amount={net > 0 ? net : null}
                                    aroundDate={row.date}
                                    value={row.transaction}
                                    excludeIds={linkedIds.filter(id => id !== own)}
                                    role="DISBURSEMENT"
                                    what={`disbursement ${index + 1}`}
                                    onChange={transaction => setDisbursement(row.key, { destinationAccountId: row.destinationAccountId, transaction })}
                                />
                                {error(`${prefix}.transaction`) && <p className="mt-1 text-xs text-red-600">{error(`${prefix}.transaction`)}</p>}
                            </div>
                        </div>
                    );
                })}

                {draft.expenses.length > 0 && (
                    <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-700">
                            How each charge was paid. A deducted charge was kept by the lender (no bank debit); a charge paid separately can be linked to its existing bank debit.
                        </div>
                        {draft.expenses.map((expense, index) => {
                            const prefix = `expenses.${index}`;
                            const { total } = expenseAmounts(expense);
                            const separately = expense.settlement === "PAID_SEPARATELY";
                            const own = expense.transaction?.id;
                            const settlements = draft.disbursements.length > 0 ? (["DEDUCTED_FROM_DISBURSEMENT", "PAID_SEPARATELY"] as const) : (["PAID_SEPARATELY"] as const);

                            return (
                                <div key={expense.key} className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3">
                                    <div className="grid grid-cols-2 items-end gap-x-5 gap-y-2.5">
                                        <div className="text-xs text-slate-700">
                                            <span className="font-medium">{expense.description || "Charge"}</span> · {formatMoney(total)}
                                        </div>
                                        <Field label="Paid How" htmlFor={`statement-setup-${prefix}-settlement`}>
                                            <ChoiceSelect
                                                id={`statement-setup-${prefix}-settlement`}
                                                value={expense.settlement}
                                                options={settlements.map(value => ({ value, label: EXPENSE_SETTLEMENT_LABELS[value] }))}
                                                onChange={value =>
                                                    setCharge(expense.key, {
                                                        settlement: value === "PAID_SEPARATELY" ? "PAID_SEPARATELY" : "DEDUCTED_FROM_DISBURSEMENT",
                                                        paymentAccountId: expense.paymentAccountId,
                                                        transaction: value === "PAID_SEPARATELY" ? expense.transaction : null,
                                                    })
                                                }
                                            />
                                        </Field>
                                    </div>
                                    {separately && (
                                        <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
                                            <Field label="Paid From Account" htmlFor={`statement-setup-${prefix}-account`} error={error(`${prefix}.paymentAccountId`)}>
                                                <ChoiceSelect
                                                    id={`statement-setup-${prefix}-account`}
                                                    value={expense.paymentAccountId}
                                                    options={bankAccountOptions(accounts, [expense.paymentAccountId])}
                                                    onChange={value =>
                                                        setCharge(expense.key, {
                                                            settlement: "PAID_SEPARATELY",
                                                            paymentAccountId: value,
                                                            transaction: expense.transaction?.accountId === value ? expense.transaction : null,
                                                        })
                                                    }
                                                    placeholder="Select account"
                                                />
                                            </Field>
                                            <div className="col-span-2">
                                                <div className="mb-1 text-xs font-medium text-slate-600">Bank debit (optional)</div>
                                                <TransactionLinkPicker
                                                    accountId={expense.paymentAccountId}
                                                    side="OUT"
                                                    amount={total > 0 ? total : null}
                                                    aroundDate={expense.expenseDate}
                                                    value={expense.transaction}
                                                    excludeIds={linkedIds.filter(id => id !== own)}
                                                    role="EXPENSE"
                                                    what={`expense ${index + 1}`}
                                                    onChange={transaction => setCharge(expense.key, { settlement: "PAID_SEPARATELY", paymentAccountId: expense.paymentAccountId, transaction })}
                                                />
                                                {error(`${prefix}.transaction`) && <p className="mt-1 text-xs text-red-600">{error(`${prefix}.transaction`)}</p>}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </StepSection>

            <AdditionalLoanDetails completion={completion} issues={issues} onChange={change} />

            <ScheduleStep draft={draft} update={update} issues={issues} accounts={accounts} />

            {showRates && rateContext && (
                <StatementRateConfirmation review={review.rates} context={rateContext} confirmed={ratesConfirmed} onConfirmedChange={setRatesConfirmed} termLoan />
            )}

            <ReviewStep
                draft={draft}
                accounts={accounts}
                issues={issues}
                confirmed={confirmed}
                onConfirmedChange={setConfirmed}
                statementFacts={loan.result.statementFacts}
                // The review above and the schedule section already show every term.
                showSummary={false}
            />

            {saveError && <IssueList issues={[{ field: "save", message: saveError }]} />}

            <Footer saving={saving} canSave={confirmed && ratesReady} onBack={onBack} onSave={() => void save()} />
        </div>
    );
}

/** Optional details no statement gives; collapsed until opened. */
function AdditionalLoanDetails({ completion, issues, onChange }: { completion: StatementCompletion; issues: readonly SetupIssue[]; onChange(next: StatementCompletion): void }) {
    const error = (field: string) => issueFor(issues, field);
    const filled = [completion.purpose.trim() || null, completion.paymentDay, completion.gracePeriodMonths, completion.balloonAmount, completion.firstInstallmentAmount].filter(value => value !== null).length;
    // Opens by itself when one of its values stops the save.
    const hasError = ["paymentDay", "balloonAmount"].some(field => Boolean(error(field)));

    return (
        <details open={hasError || undefined} className="group rounded-2xl border border-slate-200 bg-slate-50">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
                <span>
                    <span className="block text-[15px] font-semibold leading-6 text-slate-900">Additional Loan Details</span>
                    <span className="block text-xs leading-5 text-slate-500">
                        Optional. Not in the lender statement - add them only if your sanction letter gives them.{filled > 0 ? ` ${filled} filled in.` : ""}
                    </span>
                </span>
                <span className="text-xs font-medium text-slate-500 group-open:hidden">Show</span>
                <span className="hidden text-xs font-medium text-slate-500 group-open:inline">Hide</span>
            </summary>
            <div className="grid grid-cols-2 gap-x-5 gap-y-3 px-5 pb-5">
                <Field label="Loan Purpose" htmlFor="statement-setup-purpose">
                    <Input id="statement-setup-purpose" value={completion.purpose} placeholder="e.g. Working capital" onChange={event => onChange({ ...completion, purpose: event.target.value })} />
                </Field>
                <Field label="Payment Day of Month" htmlFor="statement-setup-payment-day" error={error("paymentDay")} hint="Leave blank to use the first EMI date's day.">
                    <NumberField id="statement-setup-payment-day" value={completion.paymentDay} step="1" min="1" onChange={value => onChange({ ...completion, paymentDay: value })} />
                </Field>
                <Field label="Grace Period (months)" htmlFor="statement-setup-grace" hint="Recorded for reference. The first EMI date already reflects it.">
                    <NumberField id="statement-setup-grace" value={completion.gracePeriodMonths} step="1" min="0" onChange={value => onChange({ ...completion, gracePeriodMonths: value })} />
                </Field>
                <Field label="Balloon / Final Payment" htmlFor="statement-setup-balloon" error={error("balloonAmount")} hint="Reducing balance only - paid with the last instalment.">
                    <NumberField id="statement-setup-balloon" value={completion.balloonAmount} onChange={value => onChange({ ...completion, balloonAmount: value })} />
                </Field>
                <Field
                    label="Broken-period First Instalment"
                    htmlFor="statement-setup-bpi"
                    hint="Interest-only first instalment before the regular EMIs. Leave blank if the first EMI is regular."
                    className="col-span-2"
                >
                    <NumberField id="statement-setup-bpi" value={completion.firstInstallmentAmount} onChange={value => onChange({ ...completion, firstInstallmentAmount: value })} />
                </Field>
            </div>
        </details>
    );
}

function Footer({ saving, canSave, onBack, onSave }: { saving: boolean; canSave: boolean; onBack(): void; onSave(): void }) {
    return (
        <div className="flex justify-between gap-3 border-t border-slate-100 pt-4">
            <button type="button" disabled={saving} onClick={onBack} className="h-10 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
                Cancel review
            </button>
            <button
                type="button"
                disabled={saving || !canSave}
                onClick={onSave}
                className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {saving ? "Saving..." : "Confirm and Add Loan"}
            </button>
        </div>
    );
}
