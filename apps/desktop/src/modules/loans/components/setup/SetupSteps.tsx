import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Account } from "@/modules/accounts/types";
import type { Currency } from "@/modules/currencies/types";
import { activePaymentTypeOptions, usePaymentTypes } from "@/modules/payment-types";

import { computeOverdraftPosition } from "../../services/overdraftPosition";
import { LOAN_KIND_LABELS, LoanKind } from "../../types";
import { disbursementNet, expenseAmounts, formatMoney } from "../../setup/loanSetupAccounting";
import {
    EXPENSE_SETTLEMENT_LABELS,
    INITIAL_EXPENSE_TYPES,
    INITIAL_EXPENSE_TYPE_LABELS,
    INTEREST_METHOD_LABELS,
    type DisbursementDraft,
    type ExpenseSettlement,
    type InitialExpenseDraft,
    type InterestMethod,
    type LoanSetupDraft,
    type SetupIssue,
} from "../../setup/loanSetupTypes";
import { draftDrawingPower, newDisbursementDraft, newExpenseDraft, newKey, suggestedFirstEmiDate, termPrincipal } from "../../setup/loanSetupWizard";
import { DROPLINE_OVERDRAFT_ENABLED } from "../../setup/droplineSchedule";
import { NON_PAYMENT_ACCOUNT_TYPES, accountOptionLabel } from "../LoanForm";
import { TransactionLinkPicker } from "./TransactionLinkPicker";
import { ChoiceSelect, Field, NumberField, SmallButton, StepSection, SummaryGrid, issueFor } from "./setupFields";

export interface StepProps {
    draft: LoanSetupDraft;
    update(change: Partial<LoanSetupDraft> | ((draft: LoanSetupDraft) => Partial<LoanSetupDraft>)): void;
    issues: readonly SetupIssue[];
    accounts: readonly Account[];
}

export function bankAccountOptions(accounts: readonly Account[], keep: readonly string[] = []) {
    return accounts
        .filter(account => !NON_PAYMENT_ACCOUNT_TYPES.has(account.type) || keep.includes(account.id))
        .map(account => ({ value: account.id, label: accountOptionLabel(account) }));
}

const STATUS_OPTIONS = [
    { value: "ACTIVE", label: "Active" },
    { value: "ON_HOLD", label: "On Hold" },
    { value: "DEFAULTED", label: "Defaulted" },
    { value: "CLOSED", label: "Closed" },
];

// ------------------------------------------------------------- A. basics

export function BasicsStep({
    draft,
    update,
    issues,
    accounts,
    currencies,
    onKindChange,
    kindLocked = false,
}: StepProps & { currencies: readonly Currency[]; onKindChange(kind: LoanKind): void; kindLocked?: boolean }) {
    const isOd = draft.loanKind === LoanKind.OVERDRAFT;
    const error = (field: string) => issueFor(issues, field);

    return (
        <div className="space-y-4">
            <StepSection title="Loan Type">
                <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
                    <Field label="Loan Type" htmlFor="setup-kind" required hint={kindLocked ? "Confirmed from the lender statement. To change it, cancel and start again." : undefined}>
                        <ChoiceSelect
                            id="setup-kind"
                            disabled={kindLocked}
                            value={draft.loanKind}
                            options={[LoanKind.TERM_LOAN, LoanKind.OVERDRAFT].map(kind => ({ value: kind, label: LOAN_KIND_LABELS[kind] }))}
                            onChange={value => onKindChange(value === LoanKind.OVERDRAFT ? LoanKind.OVERDRAFT : LoanKind.TERM_LOAN)}
                        />
                    </Field>
                    <Field label="Loan Category" htmlFor="setup-category" required={!isOd} error={error("loanCategory")} hint="Your own label, e.g. Home Loan or Business Loan.">
                        <Input id="setup-category" value={draft.loanCategory} placeholder={isOd ? "Overdraft" : "e.g. Business Loan"} onChange={e => update({ loanCategory: e.target.value })} />
                    </Field>
                </div>
            </StepSection>

            <StepSection title="Basic Loan Details">
                <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
                    <Field label="Loan Name" htmlFor="setup-name" required error={error("name")}>
                        <Input id="setup-name" value={draft.name} placeholder={isOd ? "e.g. TATA Capital (OD)" : "e.g. TATA Capital Term"} onChange={e => update({ name: e.target.value })} />
                    </Field>
                    <Field label="Lender" htmlFor="setup-lender">
                        <Input id="setup-lender" value={draft.lenderName} placeholder="e.g. TATA Capital" onChange={e => update({ lenderName: e.target.value })} />
                    </Field>
                    <Field label="Loan Account Number" htmlFor="setup-account-number">
                        <Input id="setup-account-number" value={draft.loanAccountNumber} autoComplete="off" spellCheck={false} onChange={e => update({ loanAccountNumber: e.target.value })} />
                    </Field>
                    <Field label="Loan Purpose" htmlFor="setup-purpose">
                        <Input id="setup-purpose" value={draft.purpose} placeholder="e.g. Working capital" onChange={e => update({ purpose: e.target.value })} />
                    </Field>
                    <Field label="Currency" htmlFor="setup-currency" required error={error("currencyId")}>
                        <ChoiceSelect
                            id="setup-currency"
                            value={draft.currencyId}
                            options={currencies.map(currency => ({ value: currency.id, label: `${currency.code} - ${currency.name}` }))}
                            onChange={value => update({ currencyId: value })}
                        />
                    </Field>
                    {!isOd && (
                        <Field label="Sanctioned Amount" htmlFor="setup-sanctioned" error={error("sanctionedAmount")}>
                            <NumberField id="setup-sanctioned" value={draft.sanctionedAmount} onChange={value => update({ sanctionedAmount: value })} />
                        </Field>
                    )}
                    <Field label="Interest Rate (% per year)" htmlFor="setup-rate" required error={error("interestRate")}>
                        <NumberField id="setup-rate" value={draft.interestRate} onChange={value => update({ interestRate: value })} placeholder="e.g. 10.50" />
                    </Field>
                    <Field label="Fixed or Floating" htmlFor="setup-rate-type">
                        <ChoiceSelect
                            id="setup-rate-type"
                            value={draft.rateType}
                            options={[{ value: "FIXED", label: "Fixed" }, { value: "FLOATING", label: "Floating" }]}
                            onChange={value => update({ rateType: value === "FLOATING" ? "FLOATING" : "FIXED" })}
                        />
                    </Field>
                    {!isOd && (
                        <Field label="Interest Calculation Method" htmlFor="setup-method" className="col-span-2">
                            <ChoiceSelect
                                id="setup-method"
                                value={draft.interestMethod}
                                options={(Object.keys(INTEREST_METHOD_LABELS) as InterestMethod[]).map(method => ({ value: method, label: INTEREST_METHOD_LABELS[method] }))}
                                onChange={value => update({ interestMethod: value as InterestMethod })}
                            />
                        </Field>
                    )}
                    <Field label="Sanction Date" htmlFor="setup-sanction-date" error={error("sanctionDate")}>
                        <Input id="setup-sanction-date" type="date" value={draft.sanctionDate} onChange={e => update({ sanctionDate: e.target.value })} />
                    </Field>
                    <Field label="Loan Start Date" htmlFor="setup-start" required error={error("startDate")} hint={isOd ? undefined : "The disbursement date - interest runs from here."}>
                        <Input
                            id="setup-start"
                            type="date"
                            value={draft.startDate}
                            onChange={e => {
                                const startDate = e.target.value;
                                // Opening Used As Of follows the start date until set.
                                update(current => ({
                                    startDate,
                                    openingUsedAsOf: !current.openingUsedAsOf || current.openingUsedAsOf === current.startDate ? startDate : current.openingUsedAsOf,
                                }));
                            }}
                        />
                    </Field>
                    {!isOd && (
                        <Field label="EMI Debit Bank Account" htmlFor="setup-bank" required error={error("linkedAccountId")} className="col-span-2">
                            <ChoiceSelect
                                id="setup-bank"
                                value={draft.linkedAccountId}
                                options={bankAccountOptions(accounts, [draft.linkedAccountId])}
                                onChange={value => update({ linkedAccountId: value })}
                                placeholder="Select account"
                            />
                        </Field>
                    )}
                    <Field label="Loan Status" htmlFor="setup-status">
                        <ChoiceSelect
                            id="setup-status"
                            value={draft.status}
                            options={STATUS_OPTIONS}
                            onChange={value => update({ status: value as LoanSetupDraft["status"] })}
                        />
                    </Field>
                </div>
            </StepSection>

            <StepSection title="Notes">
                <Textarea id="setup-notes" rows={2} value={draft.notes} placeholder="Optional notes" onChange={e => update({ notes: e.target.value })} />
            </StepSection>
        </div>
    );
}

// ------------------------------------------------------- B. disbursement

export function DisbursementStep({ draft, update, issues, accounts }: StepProps) {
    const linkedIds = (except: string) =>
        [...draft.disbursements.filter(d => d.key !== except).map(d => d.transaction?.id), ...draft.expenses.map(e => e.transaction?.id)].filter(
            (id): id is string => Boolean(id)
        );

    const change = (key: string, patch: Partial<DisbursementDraft>) =>
        update(current => ({ disbursements: current.disbursements.map(d => (d.key === key ? { ...d, ...patch } : d)) }));

    const gross = termPrincipal(draft);
    const deductions = draft.disbursements.reduce((sum, d) => sum + Number(d.deductionsAmount ?? 0), 0);

    return (
        <div className="space-y-4">
            <StepSection
                title="Disbursement"
                hint="What the lender released. The loan liability is the GROSS amount; the bank received the NET amount after the lender's deductions. Add one row per stage if the loan was released in parts."
            >
                {draft.disbursements.length === 0 && (
                    <div className="space-y-2 rounded-lg border border-dashed border-slate-200 px-3 py-3">
                        <p className="text-sm text-slate-600">
                            No disbursement recorded. Add it to account for the net bank credit and lender deductions - or enter the loan principal below to skip this.
                        </p>
                        <div className="grid grid-cols-2 gap-x-5">
                            <Field label="Loan Principal" htmlFor="setup-principal" error={issueFor(issues, "principalAmount")}>
                                <NumberField id="setup-principal" value={draft.principalAmount} onChange={value => update({ principalAmount: value })} />
                            </Field>
                        </div>
                    </div>
                )}

                {draft.disbursements.map((d, index) => {
                    const net = disbursementNet(Number(d.grossAmount ?? 0), Number(d.deductionsAmount ?? 0));
                    const prefix = `disbursements.${index}`;

                    return (
                        <div key={d.key} className="space-y-2.5 rounded-xl border border-slate-200 px-4 py-3">
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-semibold text-slate-800">Disbursement {index + 1}</div>
                                <SmallButton
                                    tone="danger"
                                    onClick={() =>
                                        update(current => ({
                                            disbursements: current.disbursements.filter(row => row.key !== d.key),
                                            // Expenses deducted from it become unassigned (the user must re-assign).
                                            expenses: current.expenses.map(e => (e.disbursementKey === d.key ? { ...e, disbursementKey: null } : e)),
                                        }))
                                    }
                                >
                                    Remove
                                </SmallButton>
                            </div>
                            <div className="grid grid-cols-3 gap-x-4 gap-y-2.5">
                                <Field label="Date" htmlFor={`${prefix}-date`} required error={issueFor(issues, `${prefix}.date`)}>
                                    <Input id={`${prefix}-date`} type="date" value={d.date} onChange={e => change(d.key, { date: e.target.value })} />
                                </Field>
                                <Field label="Gross Amount" htmlFor={`${prefix}-gross`} required error={issueFor(issues, `${prefix}.grossAmount`)}>
                                    <NumberField id={`${prefix}-gross`} value={d.grossAmount} onChange={value => change(d.key, { grossAmount: value })} />
                                </Field>
                                <Field label="Lender Deductions" htmlFor={`${prefix}-deductions`} error={issueFor(issues, `${prefix}.deductionsAmount`)} hint="Itemise them in Initial Expenses.">
                                    <NumberField id={`${prefix}-deductions`} value={d.deductionsAmount} onChange={value => change(d.key, { deductionsAmount: value })} />
                                </Field>
                                <Field label="Net Credited to Bank" htmlFor={`${prefix}-net`}>
                                    <Input id={`${prefix}-net`} value={formatMoney(net)} disabled />
                                </Field>
                                <Field label="Destination Account" htmlFor={`${prefix}-account`} required error={issueFor(issues, `${prefix}.destinationAccountId`)} className="col-span-2">
                                    <ChoiceSelect
                                        id={`${prefix}-account`}
                                        value={d.destinationAccountId}
                                        options={bankAccountOptions(accounts, [d.destinationAccountId])}
                                        onChange={value => change(d.key, { destinationAccountId: value, transaction: d.transaction?.accountId === value ? d.transaction : null })}
                                        placeholder="Select account"
                                    />
                                </Field>
                                <Field label="Reference / Narration" htmlFor={`${prefix}-ref`} className="col-span-3">
                                    <Input id={`${prefix}-ref`} value={d.reference} placeholder="e.g. NEFT UTR" onChange={e => change(d.key, { reference: e.target.value })} />
                                </Field>
                            </div>
                            <div>
                                <div className="mb-1 text-xs font-medium text-slate-600">Bank credit</div>
                                <TransactionLinkPicker
                                    accountId={d.destinationAccountId}
                                    side="IN"
                                    amount={net > 0 ? net : null}
                                    aroundDate={d.date}
                                    value={d.transaction}
                                    excludeIds={linkedIds(d.key)}
                                    role="DISBURSEMENT"
                                    what={`disbursement ${index + 1}`}
                                    onChange={transaction => change(d.key, { transaction })}
                                />
                                {issueFor(issues, `${prefix}.transaction`) && (
                                    <p className="mt-1 text-xs text-red-600">{issueFor(issues, `${prefix}.transaction`)}</p>
                                )}
                            </div>
                        </div>
                    );
                })}

                <div className="flex items-center justify-between">
                    <SmallButton onClick={() => update(current => ({ disbursements: [...current.disbursements, newDisbursementDraft(current)] }))}>
                        + Add disbursement
                    </SmallButton>
                </div>

                {issueFor(issues, "disbursements") && <p className="text-xs text-red-600">{issueFor(issues, "disbursements")}</p>}

                {draft.disbursements.length > 0 && (
                    <SummaryGrid
                        items={[
                            { label: "Gross (loan liability)", value: formatMoney(gross) },
                            { label: "Lender deductions", value: formatMoney(deductions) },
                            { label: "Net to bank", value: formatMoney(gross - deductions) },
                        ]}
                    />
                )}
            </StepSection>
        </div>
    );
}

// -------------------------------------------------- C. initial expenses

const GST_RATE_OPTIONS = [
    { value: "", label: "No rate (enter GST)" },
    { value: "0", label: "0%" },
    { value: "5", label: "5%" },
    { value: "12", label: "12%" },
    { value: "18", label: "18%" },
    { value: "28", label: "28%" },
];

export function ExpensesStep({ draft, update, issues, accounts }: StepProps) {
    const isOd = draft.loanKind === LoanKind.OVERDRAFT;
    const { paymentTypes } = usePaymentTypes();
    const paymentOptions = [{ value: "", label: "Not recorded" }, ...activePaymentTypeOptions(paymentTypes)];
    const settlements: ExpenseSettlement[] = isOd
        ? ["PAID_SEPARATELY", "CHARGED_TO_LOAN_ACCOUNT"]
        : draft.disbursements.length > 0
          ? ["DEDUCTED_FROM_DISBURSEMENT", "PAID_SEPARATELY"]
          : ["PAID_SEPARATELY"];
    const linkedIds = (except: string) =>
        [...draft.disbursements.map(d => d.transaction?.id), ...draft.expenses.filter(e => e.key !== except).map(e => e.transaction?.id)].filter(
            (id): id is string => Boolean(id)
        );
    const change = (key: string, patch: Partial<InitialExpenseDraft>) =>
        update(current => ({ expenses: current.expenses.map(e => (e.key === key ? { ...e, ...patch } : e)) }));
    const bankAccounts = isOd ? accounts.filter(a => draft.odAccountIds.includes(a.id) || !NON_PAYMENT_ACCOUNT_TYPES.has(a.type)) : accounts;
    const totals = draft.expenses.reduce((sum, e) => sum + expenseAmounts(e).total, 0);
    const expenseIssues = issues.filter(i => i.field.startsWith("expenses") || i.field.startsWith("disbursements") || i.field === "transactions");

    return (
        <div className="space-y-4">
            <StepSection
                title="Initial Loan Expenses"
                hint={
                    isOd
                        ? "Charges for setting up the overdraft. Paid separately = link the existing bank debit. Charged to the loan account = debited by the lender to the OD; it is recorded only and does not change the used amount."
                        : "Charges for taking the loan. Deducted from disbursement = the lender kept it (no bank debit). Paid separately = you paid it - link the existing bank debit. Nothing creates a new transaction."
                }
            >
                {draft.expenses.length === 0 && <p className="text-sm text-slate-500">No initial expenses. Add processing fees, GST, insurance and other charges here.</p>}

                {draft.expenses.map((e, index) => {
                    const prefix = `expenses.${index}`;
                    const { gst, total } = expenseAmounts(e);
                    const settlement = settlements.includes(e.settlement) ? e.settlement : settlements[0]!;

                    return (
                        <div key={e.key} className="space-y-2.5 rounded-xl border border-slate-200 px-4 py-3">
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-semibold text-slate-800">Expense {index + 1}</div>
                                <SmallButton tone="danger" onClick={() => update(current => ({ expenses: current.expenses.filter(row => row.key !== e.key) }))}>
                                    Remove
                                </SmallButton>
                            </div>
                            <div className="grid grid-cols-3 gap-x-4 gap-y-2.5">
                                <Field label="Expense Type" htmlFor={`${prefix}-type`} required>
                                    <ChoiceSelect
                                        id={`${prefix}-type`}
                                        value={e.expenseType}
                                        options={INITIAL_EXPENSE_TYPES.map(type => ({ value: type, label: INITIAL_EXPENSE_TYPE_LABELS[type] }))}
                                        onChange={value => change(e.key, { expenseType: value as InitialExpenseDraft["expenseType"], gstRate: value === "GST" || value === "STAMP_DUTY" ? null : e.gstRate })}
                                    />
                                </Field>
                                <Field label="Description" htmlFor={`${prefix}-desc`} className="col-span-2">
                                    <Input id={`${prefix}-desc`} value={e.description} onChange={ev => change(e.key, { description: ev.target.value })} />
                                </Field>
                                <Field label="Date" htmlFor={`${prefix}-date`} required error={issueFor(issues, `${prefix}.expenseDate`)}>
                                    <Input id={`${prefix}-date`} type="date" value={e.expenseDate} onChange={ev => change(e.key, { expenseDate: ev.target.value })} />
                                </Field>
                                <Field label="Base Amount" htmlFor={`${prefix}-base`} required error={issueFor(issues, `${prefix}.baseAmount`)}>
                                    <NumberField id={`${prefix}-base`} value={e.baseAmount} onChange={value => change(e.key, { baseAmount: value })} />
                                </Field>
                                <Field label="GST Rate" htmlFor={`${prefix}-gst-rate`} error={issueFor(issues, `${prefix}.gstRate`)}>
                                    <ChoiceSelect
                                        id={`${prefix}-gst-rate`}
                                        value={e.gstRate === null ? "" : String(e.gstRate)}
                                        options={GST_RATE_OPTIONS}
                                        onChange={value => change(e.key, { gstRate: value === "" ? null : Number(value) })}
                                    />
                                </Field>
                                <Field label="GST Amount" htmlFor={`${prefix}-gst`}>
                                    {e.gstRate === null ? (
                                        <NumberField id={`${prefix}-gst`} value={e.gstAmount} onChange={value => change(e.key, { gstAmount: value })} />
                                    ) : (
                                        <Input id={`${prefix}-gst`} value={formatMoney(gst)} disabled />
                                    )}
                                </Field>
                                <Field label="Total" htmlFor={`${prefix}-total`}>
                                    <Input id={`${prefix}-total`} value={formatMoney(total)} disabled />
                                </Field>
                                <Field label="Settlement" htmlFor={`${prefix}-settlement`} error={issueFor(issues, `${prefix}.settlement`)}>
                                    <ChoiceSelect
                                        id={`${prefix}-settlement`}
                                        value={settlement}
                                        options={settlements.map(value => ({ value, label: EXPENSE_SETTLEMENT_LABELS[value] }))}
                                        onChange={value =>
                                            change(e.key, {
                                                settlement: value as ExpenseSettlement,
                                                transaction: value === "PAID_SEPARATELY" ? e.transaction : null,
                                                disbursementKey: value === "DEDUCTED_FROM_DISBURSEMENT" ? e.disbursementKey ?? draft.disbursements[0]?.key ?? null : null,
                                            })
                                        }
                                    />
                                </Field>

                                {settlement === "DEDUCTED_FROM_DISBURSEMENT" && (
                                    <Field label="Deducted From" htmlFor={`${prefix}-disb`} error={issueFor(issues, `${prefix}.disbursementIndex`)} className="col-span-2">
                                        <ChoiceSelect
                                            id={`${prefix}-disb`}
                                            value={e.disbursementKey ?? ""}
                                            options={draft.disbursements.map((d, i) => ({ value: d.key, label: `Disbursement ${i + 1}${d.date ? ` (${d.date})` : ""}` }))}
                                            onChange={value => change(e.key, { disbursementKey: value || null })}
                                        />
                                    </Field>
                                )}

                                {settlement === "PAID_SEPARATELY" && (
                                    <>
                                        <Field label="Payment Method" htmlFor={`${prefix}-method`}>
                                            <ChoiceSelect id={`${prefix}-method`} value={e.paymentMethod} options={paymentOptions} onChange={value => change(e.key, { paymentMethod: value })} />
                                        </Field>
                                        <Field label="Paid From" htmlFor={`${prefix}-account`}>
                                            <ChoiceSelect
                                                id={`${prefix}-account`}
                                                value={e.paymentAccountId}
                                                options={bankAccountOptions(bankAccounts, [e.paymentAccountId])}
                                                onChange={value => change(e.key, { paymentAccountId: value, transaction: e.transaction?.accountId === value ? e.transaction : null })}
                                                placeholder="Select account"
                                            />
                                        </Field>
                                        <Field label="Transaction Reference" htmlFor={`${prefix}-ref`}>
                                            <Input id={`${prefix}-ref`} value={e.transactionReference} onChange={ev => change(e.key, { transactionReference: ev.target.value })} />
                                        </Field>
                                        <div className="col-span-3">
                                            <div className="mb-1 text-xs font-medium text-slate-600">Bank debit</div>
                                            <TransactionLinkPicker
                                                accountId={e.paymentAccountId}
                                                side="OUT"
                                                amount={total > 0 ? total : null}
                                                aroundDate={e.expenseDate}
                                                value={e.transaction}
                                                excludeIds={linkedIds(e.key)}
                                                role="EXPENSE"
                                                what={`expense ${index + 1}`}
                                                onChange={transaction => change(e.key, { transaction })}
                                            />
                                            {issueFor(issues, `${prefix}.transaction`) && (
                                                <p className="mt-1 text-xs text-red-600">{issueFor(issues, `${prefix}.transaction`)}</p>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}

                <SmallButton onClick={() => update(current => ({ expenses: [...current.expenses, newExpenseDraft(current)] }))}>+ Add expense</SmallButton>

                {expenseIssues.filter(i => !i.field.includes(".")).length > 0 && (
                    <p className="text-xs text-red-600">{expenseIssues.filter(i => !i.field.includes("."))[0]!.message}</p>
                )}

                {draft.expenses.length > 0 && <SummaryGrid items={[{ label: "Total initial expenses", value: formatMoney(totals) }]} />}
            </StepSection>
        </div>
    );
}

// ------------------------------------------------------- D. repayment

export function RepaymentStep({ draft, update, issues }: StepProps) {
    const error = (field: string) => issueFor(issues, field);
    const suggestion = suggestedFirstEmiDate(draft.startDate, draft.gracePeriodMonths);

    return (
        <div className="space-y-4">
            <StepSection title="Repayment" hint="Enter the lender's terms. The first EMI date comes from your sanction letter or repayment schedule - it is never assumed from the start date.">
                <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
                    <Field label="Repayment Frequency" htmlFor="setup-frequency">
                        <ChoiceSelect id="setup-frequency" value="MONTHLY" options={[{ value: "MONTHLY", label: "Monthly" }]} onChange={() => undefined} />
                    </Field>
                    <Field label="Tenure / Number of Instalments (months)" htmlFor="setup-tenure" required error={error("tenureMonths")}>
                        <NumberField id="setup-tenure" value={draft.tenureMonths} step="1" min="1" onChange={value => update({ tenureMonths: value })} />
                    </Field>
                    <Field label="EMI Amount" htmlFor="setup-emi" error={error("emiAmount")} hint="Leave blank to calculate it. Enter the lender's EMI (e.g. 8,291) if it is rounded.">
                        <NumberField id="setup-emi" value={draft.emiAmount} onChange={value => update({ emiAmount: value })} placeholder="Calculated" />
                    </Field>
                    <Field label="First EMI Due Date" htmlFor="setup-first-emi" required error={error("firstEmiDate")} hint={!draft.firstEmiDate && suggestion ? `Usually ${suggestion} - check your schedule.` : undefined}>
                        <Input id="setup-first-emi" type="date" value={draft.firstEmiDate} onChange={e => update({ firstEmiDate: e.target.value })} />
                    </Field>
                    <Field label="Payment Day of Month" htmlFor="setup-payment-day" error={error("paymentDay")} hint="Defaults to the first EMI date's day.">
                        <NumberField id="setup-payment-day" value={draft.paymentDay} step="1" min="1" onChange={value => update({ paymentDay: value })} />
                    </Field>
                    <Field label="Grace Period (months)" htmlFor="setup-grace" hint="Recorded for reference. The first EMI date already reflects it.">
                        <NumberField id="setup-grace" value={draft.gracePeriodMonths} step="1" min="0" onChange={value => update({ gracePeriodMonths: value })} />
                    </Field>
                    <Field label="Balloon / Final Payment" htmlFor="setup-balloon" error={error("balloonAmount")} hint="Reducing balance only - paid with the last instalment.">
                        <NumberField id="setup-balloon" value={draft.balloonAmount} onChange={value => update({ balloonAmount: value })} />
                    </Field>
                    <Field label="Broken-period First Instalment (optional)" htmlFor="setup-bpi" hint="Interest-only first instalment before the regular EMIs. Leave blank if the first EMI is regular.">
                        <NumberField id="setup-bpi" value={draft.firstInstallmentAmount} onChange={value => update({ firstInstallmentAmount: value })} />
                    </Field>
                </div>
                <p className="text-xs text-slate-500">
                    Loan already running? Instalments paid before FinWea are resolved one by one on the Schedule step - each linked to its real bank debit, or marked "Settled before FinWea".
                </p>
            </StepSection>
        </div>
    );
}

// ------------------------------------------------------- F. overdraft

export function OverdraftStep({ draft, update, issues, accounts }: StepProps) {
    const error = (field: string) => issueFor(issues, field);
    const preview =
        Number(draft.creditLimit) > 0 && (draft.openingUsed ?? 0) >= 0
            ? computeOverdraftPosition(
                  draft.creditLimit,
                  { used: draft.openingUsed ?? 0, totalDrawdowns: 0, totalRepayments: 0, totalInterestCharges: 0, invalidLinks: 0 },
                  draftDrawingPower(draft)
              )
            : null;
    const options = bankAccountOptions(accounts, draft.odAccountIds);
    const steps = draft.drawingPowerSchedule;
    const changeStep = (key: string, change: Partial<(typeof steps)[number]>) =>
        update(current => ({ drawingPowerSchedule: current.drawingPowerSchedule.map(step => (step.key === key ? { ...step, ...change } : step)) }));

    return (
        <div className="space-y-4">
            <StepSection
                title={draft.loanCategory.trim() || "Overdraft"}
                hint="An overdraft has no EMI schedule. Its used amount starts at the opening balance and then follows the drawdowns and repayments you link. The opening balance is never entered as a bank transaction."
            >
                <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
                    <Field label="Sanctioned Limit" htmlFor="setup-limit" required error={error("creditLimit")}>
                        <NumberField id="setup-limit" value={draft.creditLimit} onChange={value => update({ creditLimit: value })} />
                    </Field>
                    {!draft.dropline && (
                        <Field label="Drawing Power (optional)" htmlFor="setup-dp" error={error("drawingPower")} hint="When the lender allows less than the full limit.">
                            <NumberField id="setup-dp" value={draft.drawingPower} onChange={value => update({ drawingPower: value })} placeholder="Same as limit" />
                        </Field>
                    )}
                    <Field label="Opening Used Balance" htmlFor="setup-opening" required error={error("openingUsed")} hint="From the lender statement - principal outstanding on that date.">
                        <NumberField id="setup-opening" value={draft.openingUsed} onChange={value => update({ openingUsed: value })} />
                    </Field>
                    <Field label="Opening Balance Date" htmlFor="setup-opening-date" required error={error("openingUsedAsOf")} hint="Only transactions after this date change the used amount.">
                        <Input id="setup-opening-date" type="date" value={draft.openingUsedAsOf} onChange={e => update({ openingUsedAsOf: e.target.value })} />
                    </Field>
                    <Field label="Linked Bank Accounts" htmlFor="setup-od-accounts" required error={error("odAccountIds")} className="col-span-2">
                        <div id="setup-od-accounts" className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 px-3 py-2">
                            {options.map(option => (
                                <label key={option.value} className="flex cursor-pointer items-center gap-2 py-1 text-sm text-slate-700">
                                    <Checkbox
                                        checked={draft.odAccountIds.includes(option.value)}
                                        onCheckedChange={checked =>
                                            update(current => ({
                                                odAccountIds:
                                                    checked === true
                                                        ? [...current.odAccountIds.filter(id => id !== option.value), option.value]
                                                        : current.odAccountIds.filter(id => id !== option.value),
                                            }))
                                        }
                                    />
                                    {option.label}
                                </label>
                            ))}
                        </div>
                    </Field>
                </div>

                {(DROPLINE_OVERDRAFT_ENABLED || draft.dropline) && (
                    <div className="space-y-2 rounded-xl border border-slate-200 px-3 py-2.5">
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                            <Checkbox checked={draft.dropline} onCheckedChange={checked => update({ dropline: checked === true })} />
                            Dropline Overdraft - the drawing power falls on set dates
                        </label>
                        {draft.dropline && (
                            <>
                                {steps.map((step, index) => (
                                    <div key={step.key} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                                        <Field label={`Step ${index + 1} from`} htmlFor={`dp-date-${step.key}`} error={error(`drawingPowerSchedule.${index}`)}>
                                            <Input id={`dp-date-${step.key}`} type="date" value={step.effectiveDate} onChange={e => changeStep(step.key, { effectiveDate: e.target.value })} />
                                        </Field>
                                        <Field label="Drawing Power" htmlFor={`dp-amount-${step.key}`}>
                                            <NumberField id={`dp-amount-${step.key}`} value={step.drawingPower} onChange={value => changeStep(step.key, { drawingPower: value })} />
                                        </Field>
                                        <SmallButton tone="danger" onClick={() => update(current => ({ drawingPowerSchedule: current.drawingPowerSchedule.filter(item => item.key !== step.key) }))}>Remove</SmallButton>
                                    </div>
                                ))}
                                <SmallButton onClick={() => update(current => ({ drawingPowerSchedule: [...current.drawingPowerSchedule, { key: newKey(), effectiveDate: "", drawingPower: null }] }))}>Add step</SmallButton>
                                {error("drawingPowerSchedule") && <p className="text-xs text-red-600">{error("drawingPowerSchedule")}</p>}
                            </>
                        )}
                    </div>
                )}

                {preview && (
                    <SummaryGrid
                        items={[
                            { label: "Used", value: formatMoney(preview.used) },
                            { label: "Available", value: formatMoney(preview.available) },
                            { label: "Utilisation", value: `${preview.utilizationPercent?.toFixed(2)}%` },
                        ]}
                    />
                )}
                <p className="text-xs text-slate-500">
                    After saving, link drawdowns, principal repayments and interest charges from Transactions (the loan icon). Limit and drawing power revisions are made in Edit.
                </p>
            </StepSection>
        </div>
    );
}
