import { useEffect, useMemo, useState } from "react";

import { useCurrencies } from "@/modules/currencies";
import { useDisplaySettings } from "@/core/formatting/useDisplaySettings";
import { AccountService } from "@/modules/accounts/services";
import type { Account } from "@/modules/accounts/types";

import { LoanKind, type CreateLoanRequest } from "../../types";
import {
    SETUP_STEP_LABELS,
    draftToCreateRequest,
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

export function AddLoanWizard({ loading, initialDraft, kindLocked = false, preferredCurrencyCode = null, onSubmit, onCancel }: AddLoanWizardProps) {
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

    const steps = stepsFor(draft.loanKind);
    const step = steps[Math.min(stepIndex, steps.length - 1)]!;

    useEffect(() => {
        let mounted = true;
        new AccountService()
            .getAll()
            .then(result => mounted && setAccounts(result))
            .catch(error => console.error("Failed to load accounts for Add Loan:", error));
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
    const issues: SetupIssue[] = useMemo(() => (attempted.has(step) ? validateStep(draft, step) : []), [attempted, draft, step]);

    function update(change: Partial<LoanSetupDraft> | ((draft: LoanSetupDraft) => Partial<LoanSetupDraft>)) {
        setSaveError(null);
        setConfirmed(false);
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
        if (validateStep(draft, step).length === 0) {
            setStepIndex(index => Math.min(index + 1, steps.length - 1));
        }
    }

    async function save() {
        setAttempted(current => new Set(current).add("review"));
        if (validateStep(draft, "review").length > 0 || !confirmed) return;

        let request: CreateLoanRequest;
        try {
            request = draftToCreateRequest(draft);
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
            {step === "review" && <ReviewStep draft={draft} accounts={accounts} issues={issues} confirmed={confirmed} onConfirmedChange={setConfirmed} />}

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
                            disabled={loading || !confirmed}
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
