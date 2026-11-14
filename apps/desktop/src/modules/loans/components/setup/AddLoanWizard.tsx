import { useEffect, useMemo, useState } from "react";

import { useCurrencies } from "@/modules/currencies";
import { useDisplaySettings } from "@/core/formatting/useDisplaySettings";
import { AccountService } from "@/modules/accounts/services";
import { LoanService } from "../../services/LoanService";
import type { Account } from "@/modules/accounts/types";

import { LoanKind, type CreateLoanRequest } from "../../types";
import {
    SETUP_STEP_LABELS,
    draftToCreateRequest,
    duplicateLoanIssues,
    emptyLoanSetupDraft,
    stepsFor,
    validateStep,
    type SetupStep,
} from "../../setup/loanSetupWizard";
import type { LoanSetupDraft, SetupIssue } from "../../setup/loanSetupTypes";
import { BasicsStep, DisbursementStep, ExpensesStep, OverdraftStep, RepaymentStep } from "./SetupSteps";
import { ReviewStep } from "./ReviewStep";
import { ScheduleStep } from "./ScheduleStep";
import { IssueList } from "./setupFields";
import type { StatementFacts } from "../../statementImport/statementReconciliation";
import {
    hasRateProposals,
    overdraftStatementRateHistoryFor,
    rateReviewIssues,
    type RateLoanContext,
    type StatementRateReview,
} from "../../statementImport/statementRateProposals";
import { localToday } from "../../setup/historicalInstalments";
import { StatementRateConfirmation } from "./StatementRateProposals";

// ---------------------------------------------------------------------
// Add Loan - the complete setup, one step at a time. The steps adapt to
// the Loan Type (Term Loan / Overdraft). Nothing is saved until the user
// confirms on Review; then the loan, its schedule, disbursements and
// initial expenses are written together in one database transaction.
// ---------------------------------------------------------------------

export interface AddLoanWizardProps {
    loading: boolean;
    initialDraft?: Partial<LoanSetupDraft>;
    /** The Loan Type was confirmed from a lender statement: it cannot be switched here. */
    kindLocked?: boolean;
    /** The currency a lender statement states, when FinWea has it. */
    preferredCurrencyCode?: string | null;
    /** A Term Loan filled from a lender statement: its figures, checked on Review. */
    statementFacts?: StatementFacts | null;
    /**
     * Overdraft / Cash Credit / Dropline filled from a lender statement: its
     * rate changes as reviewed there (Stage 4). Confirmed with their own
     * tick on Review and saved with the loan; null when there are none or
     * rate history is not available.
     */
    statementRates?: { review: StatementRateReview; fileName: string } | null;
    onSubmit(request: CreateLoanRequest): Promise<void> | void;
    onCancel(): void;
}

/** Fields the user typed that survive switching between Term Loan and OD. */
const SHARED_FIELDS = [
    "name",
    "lenderName",
    "loanAccountNumber",
    "purpose",
    "currencyId",
    "interestRate",
    "rateType",
    "sanctionDate",
    "startDate",
    "status",
    "notes",
] as const satisfies ReadonlyArray<keyof LoanSetupDraft>;

function issuesFor(draft: LoanSetupDraft, step: SetupStep, existingLoans: Parameters<typeof duplicateLoanIssues>[1]): SetupIssue[] {
    return [...validateStep(draft, step), ...(step === "basics" || step === "review" ? duplicateLoanIssues(draft, existingLoans) : [])];
}

export function AddLoanWizard({ loading, initialDraft, kindLocked = false, preferredCurrencyCode = null, statementFacts = null, statementRates = null, onSubmit, onCancel }: AddLoanWizardProps) {
    const { currencies } = useCurrencies();
    const { defaultCurrency } = useDisplaySettings();
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [draft, setDraft] = useState<LoanSetupDraft>(() => ({
        ...emptyLoanSetupDraft(initialDraft?.loanKind ?? LoanKind.TERM_LOAN),
        ...initialDraft,
    }));
    const [stepIndex, setStepIndex] = useState(0);
    const [attempted, setAttempted] = useState<Set<SetupStep>>(new Set());
    const [confirmed, setConfirmed] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [existingLoans, setExistingLoans] = useState<Array<{ name: string; loanAccountNumber?: string | null }>>([]);
    const [ratesConfirmed, setRatesConfirmed] = useState(false);

    // Only an Overdraft-kind loan saves a statement's rate changes with itself
    // (a statement Term Loan is saved from Statement Review, never here).
    const showRates = Boolean(statementRates && draft.loanKind === LoanKind.OVERDRAFT && hasRateProposals(statementRates.review));
    const rateContext: RateLoanContext = { loanKind: LoanKind.OVERDRAFT, startDate: draft.startDate || null, loanRate: draft.interestRate, today: localToday() };
    const ratesReady = !showRates || (ratesConfirmed && rateReviewIssues(statementRates!.review, rateContext).blocking.length === 0);

    const steps = stepsFor(draft.loanKind);
    const step = steps[Math.min(stepIndex, steps.length - 1)]!;

    useEffect(() => {
        let mounted = true;
        new AccountService()
            .getAll()
            .then(result => mounted && setAccounts(result))
            .catch(error => console.error("Failed to load accounts for Add Loan:", error));
        new LoanService()
            .getAll()
            .then(result => mounted && setExistingLoans(result))
            .catch(error => console.error("Failed to load loans for Add Loan:", error));
        return () => {
            mounted = false;
        };
    }, []);

    // The Settings default currency, once the list has loaded.
    useEffect(() => {
        if (draft.currencyId) return;
        const fallback =
            currencies.find(currency => currency.code === preferredCurrencyCode)?.id ??
            currencies.find(currency => currency.code === defaultCurrency)?.id;
        if (fallback) setDraft(current => (current.currencyId ? current : { ...current, currencyId: fallback }));
    }, [currencies, defaultCurrency, draft.currencyId, preferredCurrencyCode]);

    // Problems are shown once the user has tried to leave the step, and
    // then follow every change so they disappear as they are fixed.
    // Plus, on Basic Details and Review, a loan that already exists.
    const stepIssues = (at: SetupStep): SetupIssue[] => issuesFor(draft, at, existingLoans);
    const issues: SetupIssue[] = useMemo(() => (attempted.has(step) ? issuesFor(draft, step, existingLoans) : []), [attempted, draft, step, existingLoans]);

    function update(change: Partial<LoanSetupDraft> | ((draft: LoanSetupDraft) => Partial<LoanSetupDraft>)) {
        setSaveError(null);
        setConfirmed(false);
        setRatesConfirmed(false);
        setDraft(current => ({ ...current, ...(typeof change === "function" ? change(current) : change) }));
    }

    function changeKind(kind: LoanKind) {
        if (kind === draft.loanKind) return;
        setDraft(current => {
            const next = emptyLoanSetupDraft(kind, current.currencyId);
            for (const field of SHARED_FIELDS) {
                (next as unknown as Record<string, unknown>)[field] = current[field];
            }
            next.openingUsedAsOf = current.startDate;
            return next;
        });
        setStepIndex(0);
        setAttempted(new Set());
        setConfirmed(false);
    }

    function goNext() {
        setAttempted(current => new Set(current).add(step));
        if (stepIssues(step).length === 0) {
            setStepIndex(index => Math.min(index + 1, steps.length - 1));
        }
    }

    async function save() {
        setAttempted(current => new Set(current).add("review"));
        if (stepIssues("review").length > 0 || !confirmed || !ratesReady) return;

        let request: CreateLoanRequest;
        try {
            request = draftToCreateRequest(draft);
            // Every change left out: nothing from the statement is sent (M1).
            const history = showRates ? overdraftStatementRateHistoryFor(statementRates!.review, rateContext, statementRates!.fileName) : null;
            if (history) request = { ...request, statementRateHistory: history };
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : String(error));
            return;
        }

        await onSubmit(request);
    }

    const stepProps = { draft, update, issues, accounts };

    return (
        <div className="space-y-4">
            <ol className="flex flex-wrap gap-1.5">
                {steps.map((item, index) => (
                    <li key={item}>
                        <button
                            type="button"
                            disabled={loading || index > stepIndex}
                            onClick={() => setStepIndex(index)}
                            className={`h-7 rounded-full px-3 text-xs font-medium transition ${
                                index === stepIndex
                                    ? "bg-slate-900 text-white"
                                    : index < stepIndex
                                      ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                      : "bg-white text-slate-400 ring-1 ring-slate-200"
                            }`}
                        >
                            {index + 1}. {SETUP_STEP_LABELS[item]}
                        </button>
                    </li>
                ))}
            </ol>

            {step === "basics" && <BasicsStep {...stepProps} currencies={currencies} onKindChange={changeKind} kindLocked={kindLocked} />}
            {step === "disbursement" && <DisbursementStep {...stepProps} />}
            {step === "expenses" && <ExpensesStep {...stepProps} />}
            {step === "repayment" && <RepaymentStep {...stepProps} />}
            {step === "schedule" && <ScheduleStep {...stepProps} />}
            {step === "overdraft" && <OverdraftStep {...stepProps} />}
            {step === "review" && showRates && (
                <StatementRateConfirmation review={statementRates!.review} context={rateContext} confirmed={ratesConfirmed} onConfirmedChange={setRatesConfirmed} termLoan={false} />
            )}
            {step === "review" && <ReviewStep draft={draft} accounts={accounts} issues={issues} confirmed={confirmed} onConfirmedChange={setConfirmed} statementFacts={statementFacts} />}

            {step !== "review" && issues.length > 0 && <IssueList issues={issues} />}
            {saveError && <IssueList issues={[{ field: "save", message: saveError }]} />}

            <div className="flex justify-between gap-3 border-t border-slate-100 pt-4">
                <button
                    type="button"
                    disabled={loading}
                    onClick={onCancel}
                    className="h-10 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                    Cancel
                </button>
                <div className="flex gap-3">
                    {stepIndex > 0 && (
                        <button
                            type="button"
                            disabled={loading}
                            onClick={() => setStepIndex(index => Math.max(0, index - 1))}
                            className="h-10 rounded-xl border border-slate-200 px-5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                        >
                            Back
                        </button>
                    )}
                    {step === "review" ? (
                        <button
                            type="button"
                            disabled={loading || !confirmed || !ratesReady}
                            onClick={() => void save()}
                            className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {loading ? "Saving..." : draft.loanKind === LoanKind.OVERDRAFT ? "Create Overdraft" : "Create Loan"}
                        </button>
                    ) : (
                        <button
                            type="button"
                            disabled={loading}
                            onClick={goNext}
                            className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
                        >
                            Next
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
