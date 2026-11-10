import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    formatMoney,
    useDateFormatter,
    useDisplaySettings,
} from "@/core/formatting";
import type { Transaction } from "@/modules/transactions/types";

import {
    LoanTransactionLinkService,
    type LoanLinkMode,
    type LoanLinkTarget,
    type TransactionLinkOptions,
} from "../services/LoanTransactionLinkService";
import { OVERDRAFT_ENTRY_KIND_LABELS, OverdraftEntryKind } from "../types";
import { emiPaymentErrorMessage } from "./emiPaymentErrorMessage";

// ---------------------------------------------------------------------
// Transactions -> Link to Loan EMI: records an EXISTING transaction as a
// loan EMI payment (see LoanTransactionLinkService). The transaction is
// kept exactly as it is - no new one is created. Whether its amount is a
// full payment, a partial one, or the lender's full instalment for less
// than the calculated EMI is always the user's explicit choice.
//
// The same dialog links a transaction to an Overdraft (Link to Overdraft):
// there the user says only what it is - a Drawdown, a Repayment or an
// Interest / Charge. No EMI, no instalment.
// ---------------------------------------------------------------------

/**
 * Which workflow the dialog shows - the user's choice when made, else the
 * transaction's account (see LoanLinkTarget). An Overdraft transaction is
 * never shown as a Term Loan EMI.
 */
export function linkDialogWorkflow(
    target: LoanLinkTarget | null,
    selected: "loan" | "overdraft" | null
): LoanLinkTarget {
    if (selected === "overdraft") {
        return "OVERDRAFT";
    }

    if (selected === "loan") {
        return "EMI";
    }

    return target ?? "ANY";
}

export const LINK_DIALOG_TITLES: Record<LoanLinkTarget, string> = {
    EMI: "Link to Loan EMI",
    OVERDRAFT: "Link to Overdraft",
    ANY: "Link to Loan",
};

/**
 * Whether Link is enabled for an Overdraft: nothing refuses the
 * transaction (already linked, category, account, direction, the Opening
 * Used As Of date ...) and the user has chosen a kind its direction
 * allows. Never chosen for them.
 */
export function canLinkOverdraftChoice(state: {
    saving: boolean;
    options: Pick<TransactionLinkOptions, "refusal"> | null;
    overdraft: { refusal: string | null; kinds: readonly OverdraftEntryKind[] } | null;
    entryKind: OverdraftEntryKind | null;
}): boolean {
    return (
        !state.saving &&
        !!state.options &&
        !state.options.refusal &&
        !!state.overdraft &&
        !state.overdraft.refusal &&
        !!state.entryKind &&
        state.overdraft.kinds.includes(state.entryKind)
    );
}

/** Whether Link Payment is enabled for a Term Loan EMI instalment. */
export function canLinkEmiChoice(state: {
    saving: boolean;
    options: Pick<TransactionLinkOptions, "refusal"> | null;
    loanSelected: boolean;
    installment: { modes: readonly LoanLinkMode[] } | null;
    mode: LoanLinkMode | null;
    needsDuplicateConfirmation: boolean;
    confirmedNotDuplicate: boolean;
}): boolean {
    return (
        !state.saving &&
        !!state.options &&
        !state.options.refusal &&
        state.loanSelected &&
        !!state.installment &&
        !!state.mode &&
        state.installment.modes.includes(state.mode) &&
        (!state.needsDuplicateConfirmation || state.confirmedNotDuplicate)
    );
}

/**
 * The dialog's layout. A flex column bounded by the viewport: header and
 * buttons stay put, only the body scrolls - vertically, never sideways.
 * Every row is min-w-0 and long text (a bank narration is often one
 * unbroken 100-character token) wraps anywhere, so nothing can widen the
 * dialog past its own width.
 */
export const LINK_DIALOG_LAYOUT = {
    content:
        "flex w-[560px] max-w-[calc(100vw-48px)] max-h-[calc(100vh-48px)] flex-col gap-0 overflow-hidden rounded-[24px] border border-slate-100 bg-white p-0 shadow-lg",
    header: "min-w-0 shrink-0 px-7 pb-4 pr-14 pt-6",
    body: "min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-7 pb-6",
    footer: "flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-7 py-5",
    notice: "min-w-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 [overflow-wrap:anywhere]",
    selectTrigger: "w-full min-w-0",
    selectText: "min-w-0 truncate",
} as const;

/** The transaction being linked - stays inside the dialog whatever its text. */
export function LinkTransactionSummary({
    payee,
    narration,
    amount,
    date,
}: {
    payee: string;
    narration: string | null;
    amount: string;
    date: string;
}) {
    return (
        <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-800 [overflow-wrap:anywhere]">
                        {payee || "�"}
                    </div>
                    {narration && (
                        <div
                            className="mt-0.5 line-clamp-3 text-[11px] leading-4 text-slate-400 [overflow-wrap:anywhere]"
                            title={narration}
                        >
                            {narration}
                        </div>
                    )}
                </div>
                <div className="shrink-0 text-right">
                    <div className="whitespace-nowrap text-sm font-semibold text-slate-900">
                        {amount}
                    </div>
                    <div className="whitespace-nowrap text-xs text-slate-500">
                        {date}
                    </div>
                </div>
            </div>
        </div>
    );
}

export interface LinkTransactionToEmiDialogProps {
    transaction: Transaction | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

export function LinkTransactionToEmiDialog({
    transaction,
    open,
    onOpenChange,
    onSuccess,
}: LinkTransactionToEmiDialogProps) {
    const formatDate = useDateFormatter();
    const { defaultCurrency } = useDisplaySettings();

    // Always to the paisa here - the whole point is to see a difference
    // such as 0.39 that a whole-rupee display would hide.
    const money = (value: number) =>
        formatMoney(value, {
            currency: defaultCurrency,
            locale: "en-IN",
            showDecimals: true,
        });

    const [options, setOptions] = useState<TransactionLinkOptions | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loanId, setLoanId] = useState("");
    const [scheduleId, setScheduleId] = useState("");
    const [mode, setMode] = useState<LoanLinkMode | null>(null);
    const [entryKind, setEntryKind] = useState<OverdraftEntryKind | null>(null);
    const [confirmedNotDuplicate, setConfirmedNotDuplicate] = useState(false);
    const [saving, setSaving] = useState(false);

    // Blocks a second click before the disabled state has rendered.
    const inFlight = useRef(false);

    useEffect(() => {
        if (!open || !transaction) {
            return;
        }

        let cancelled = false;

        setOptions(null);
        setLoadError(null);
        setLoanId("");
        setScheduleId("");
        setMode(null);
        setEntryKind(null);
        setConfirmedNotDuplicate(false);

        new LoanTransactionLinkService()
            .getLinkOptions(transaction.id)
            .then(loaded => {
                if (cancelled) {
                    return;
                }

                setOptions(loaded);

                const choices = [...loaded.loans, ...loaded.overdrafts];
                const initialLoan =
                    choices.find(loan => loan.loanId === loaded.suggestedLoanId) ??
                    (choices.length === 1 ? choices[0] : undefined);

                if (initialLoan) {
                    setLoanId(initialLoan.loanId);
                }
            })
            .catch(error => {
                if (!cancelled) {
                    setLoadError(
                        emiPaymentErrorMessage(
                            error,
                            "The loans for this transaction could not be loaded."
                        )
                    );
                }
            });

        return () => {
            cancelled = true;
        };
    }, [open, transaction]);

    const loan = options?.loans.find(item => item.loanId === loanId) ?? null;
    const overdraft =
        options?.overdrafts.find(item => item.loanId === loanId) ?? null;

    // A newly chosen overdraft: the kind is preselected only when this
    // transaction's direction allows just one (a credit is a drawdown).
    useEffect(() => {
        setEntryKind(
            overdraft?.kinds.length === 1 ? overdraft.kinds[0]! : null
        );
    }, [overdraft]);

    // A newly chosen loan starts on its earliest instalment this amount
    // fits, and every choice of how it counts is made again.
    useEffect(() => {
        const first =
            loan?.installments.find(item => item.modes.length > 0) ??
            loan?.installments[0];

        setScheduleId(first?.scheduleId ?? "");
        setConfirmedNotDuplicate(false);
    }, [loan]);

    const installment =
        loan?.installments.find(item => item.scheduleId === scheduleId) ?? null;

    useEffect(() => {
        setMode(
            installment?.modes.length === 1 ? installment.modes[0]! : null
        );
    }, [installment]);

    const amount = transaction?.amount ?? 0;
    const difference = installment
        ? Math.round((installment.remaining - amount) * 100) / 100
        : 0;

    const modeLabels: Record<LoanLinkMode, { title: string; detail: string }> = {
        full: {
            title: "Full payment",
            detail: installment
                ? `Pays instalment #${installment.installmentNumber} in full.`
                : "",
        },
        partial: {
            title: "Partial payment",
            detail: installment
                ? `Instalment #${installment.installmentNumber} stays Partial, with ${money(difference)} still due.`
                : "",
        },
        settle: {
            title: "Lender's full instalment",
            detail: installment
                ? `The lender's actual EMI is this amount. Instalment #${installment.installmentNumber} is marked Paid: scheduled ${money(installment.remaining)}, paid ${money(amount)} - the ${money(difference)} difference stays recorded on it. Future statement debits like this one, for this same amount, are settled the same way.`
                : "",
        },
    };

    const kindLabels: Record<OverdraftEntryKind, string> = {
        [OverdraftEntryKind.DRAWDOWN]: `Money taken from the overdraft. The used amount goes up by ${money(amount)}.`,
        [OverdraftEntryKind.REPAYMENT]: `Money paid back to the overdraft. The used amount goes down by ${money(amount)}.`,
        [OverdraftEntryKind.INTEREST_CHARGE]: "Interest or a bank charge on the overdraft. Shown separately - the used amount does not change.",
    };

    const workflow = linkDialogWorkflow(
        options?.target ?? null,
        overdraft ? "overdraft" : loan ? "loan" : null
    );
    const title = LINK_DIALOG_TITLES[workflow];

    const needsDuplicateConfirmation =
        (loan?.possibleDuplicates.length ?? 0) > 0;

    const canSaveOverdraft = canLinkOverdraftChoice({
        saving,
        options,
        overdraft,
        entryKind,
    });

    const canSave =
        canSaveOverdraft ||
        canLinkEmiChoice({
            saving,
            options,
            loanSelected: !!loan,
            installment,
            mode,
            needsDuplicateConfirmation,
            confirmedNotDuplicate,
        });

    async function handleLinkOverdraft() {
        if (!canSaveOverdraft || !transaction || !overdraft || !entryKind || inFlight.current) {
            return;
        }

        inFlight.current = true;

        try {
            setSaving(true);

            await new LoanTransactionLinkService().linkOverdraft({
                transactionId: transaction.id,
                loanId: overdraft.loanId,
                entryKind,
            });

            toast.success(
                `Linked to ${overdraft.loanName} as a ${OVERDRAFT_ENTRY_KIND_LABELS[entryKind].toLowerCase()}.`
            );

            await onSuccess?.();
            onOpenChange(false);
        } catch (error) {
            toast.error(
                emiPaymentErrorMessage(
                    error,
                    "The transaction could not be linked to the overdraft."
                )
            );
        } finally {
            inFlight.current = false;
            setSaving(false);
        }
    }

    async function handleLink() {
        if (overdraft) {
            await handleLinkOverdraft();
            return;
        }

        if (!canSave || !transaction || !mode || inFlight.current) {
            return;
        }

        inFlight.current = true;

        try {
            setSaving(true);

            const result = await new LoanTransactionLinkService().link({
                transactionId: transaction.id,
                loanId,
                scheduleId,
                mode,
            });

            toast.success(
                `Linked to ${result.loan.name}, instalment #${result.schedule.installmentNumber} (${
                    result.schedule.status === "PAID" ? "Paid" : "Partial"
                }).`
            );

            await onSuccess?.();
            onOpenChange(false);
        } catch (error) {
            toast.error(
                emiPaymentErrorMessage(
                    error,
                    "The transaction could not be linked to the loan EMI."
                )
            );
        } finally {
            inFlight.current = false;
            setSaving(false);
        }
    }

    if (!transaction) {
        return null;
    }

    return (
        <Dialog
            open={open}
            onOpenChange={next => {
                if (!saving) {
                    onOpenChange(next);
                }
            }}
        >
            <DialogContent
                showCloseButton={!saving}
                className={LINK_DIALOG_LAYOUT.content}
            >
                <DialogHeader className={LINK_DIALOG_LAYOUT.header}>
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        {title}
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm leading-6 text-slate-500">
                        {workflow === "OVERDRAFT"
                            ? "Record this existing transaction as an overdraft movement - a drawdown, a repayment or an interest / charge."
                            : workflow === "EMI"
                              ? "Record this existing transaction as a loan EMI payment."
                              : "Record this existing transaction as a loan EMI payment or an overdraft movement."}{" "}
                        No new transaction is created - this one is kept
                        exactly as it is.
                    </DialogDescription>
                </DialogHeader>

                <div className={LINK_DIALOG_LAYOUT.body}>
                    <LinkTransactionSummary
                        payee={transaction.payee}
                        narration={transaction.originalNarration ?? null}
                        amount={money(amount)}
                        date={formatDate(transaction.transactionDate)}
                    />

                    {loadError && (
                        <p className="text-sm text-red-600">{loadError}</p>
                    )}

                    {!options && !loadError && (
                        <p className="text-sm text-slate-500">Loading loans...</p>
                    )}

                    {options?.refusal && (
                        <p className={LINK_DIALOG_LAYOUT.notice}>
                            {options.refusal}
                        </p>
                    )}

                    {options && !options.refusal && (
                        <>
                            <div>
                                <label
                                    htmlFor="linkEmiLoan"
                                    className="mb-2 block text-sm font-medium text-slate-700"
                                >
                                    Loan
                                </label>
                                <Select
                                    value={loanId}
                                    onValueChange={value => setLoanId(value ?? "")}
                                    disabled={saving}
                                >
                                    <SelectTrigger id="linkEmiLoan" className={LINK_DIALOG_LAYOUT.selectTrigger}>
                                        <SelectValue placeholder="Select loan" className={LINK_DIALOG_LAYOUT.selectText}>
                                            {loan?.loanName ??
                                                (overdraft
                                                    ? `${overdraft.loanName} (Overdraft)`
                                                    : "Select loan")}
                                        </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {options.loans.map(item => (
                                            <SelectItem
                                                key={item.loanId}
                                                value={item.loanId}
                                                label={item.loanName}
                                            >
                                                {item.loanName}
                                            </SelectItem>
                                        ))}
                                        {options.overdrafts.map(item => (
                                            <SelectItem
                                                key={item.loanId}
                                                value={item.loanId}
                                                label={`${item.loanName} (Overdraft)`}
                                            >
                                                {item.loanName} (Overdraft)
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {overdraft?.refusal && (
                                <p className={LINK_DIALOG_LAYOUT.notice}>
                                    {overdraft.refusal}
                                </p>
                            )}

                            {overdraft && !overdraft.refusal && (
                                <fieldset>
                                    <legend className="mb-2 block text-sm font-medium text-slate-700">
                                        This transaction is
                                    </legend>
                                    <div className="space-y-2">
                                        {overdraft.kinds.map(option => (
                                            <label
                                                key={option}
                                                className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 ${
                                                    entryKind === option
                                                        ? "border-slate-900 bg-slate-50"
                                                        : "border-slate-200"
                                                }`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="linkOverdraftKind"
                                                    value={option}
                                                    checked={entryKind === option}
                                                    onChange={() => setEntryKind(option)}
                                                    disabled={saving}
                                                    className="mt-1"
                                                />
                                                <span>
                                                    <span className="block text-sm font-medium text-slate-800">
                                                        {OVERDRAFT_ENTRY_KIND_LABELS[option]}
                                                    </span>
                                                    <span className="block text-xs leading-5 text-slate-500">
                                                        {kindLabels[option]}
                                                    </span>
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </fieldset>
                            )}

                            {loan && (
                                <div>
                                    <label
                                        htmlFor="linkEmiInstallment"
                                        className="mb-2 block text-sm font-medium text-slate-700"
                                    >
                                        EMI instalment
                                    </label>
                                    {loan.installments.length === 0 ? (
                                        <p className="text-sm text-slate-500">
                                            This loan has no unpaid instalment.
                                        </p>
                                    ) : (
                                        <Select
                                            value={scheduleId}
                                            onValueChange={value => setScheduleId(value ?? "")}
                                            disabled={saving}
                                        >
                                            <SelectTrigger id="linkEmiInstallment" className={LINK_DIALOG_LAYOUT.selectTrigger}>
                                                <SelectValue placeholder="Select instalment" className={LINK_DIALOG_LAYOUT.selectText}>
                                                    {installment
                                                        ? `#${installment.installmentNumber} · due ${formatDate(installment.dueDate)} · ${money(installment.remaining)} remaining`
                                                        : "Select instalment"}
                                                </SelectValue>
                                            </SelectTrigger>
                                            <SelectContent>
                                                {loan.installments.map(item => {
                                                    const text = `#${item.installmentNumber} · due ${formatDate(item.dueDate)} · ${money(item.remaining)} remaining`;

                                                    return (
                                                        <SelectItem
                                                            key={item.scheduleId}
                                                            value={item.scheduleId}
                                                            label={text}
                                                        >
                                                            {text}
                                                        </SelectItem>
                                                    );
                                                })}
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>
                            )}

                            {installment && installment.modes.length === 0 && (
                                <p className="text-sm text-amber-700">
                                    {money(amount)} is more than the{" "}
                                    {money(installment.remaining)} remaining on
                                    this instalment, so it can't be linked to
                                    it.
                                </p>
                            )}

                            {installment && installment.modes.length > 0 && (
                                <fieldset>
                                    <legend className="mb-2 block text-sm font-medium text-slate-700">
                                        This transaction is
                                    </legend>
                                    <div className="space-y-2">
                                        {installment.modes.map(option => (
                                            <label
                                                key={option}
                                                className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 ${
                                                    mode === option
                                                        ? "border-slate-900 bg-slate-50"
                                                        : "border-slate-200"
                                                }`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="linkEmiMode"
                                                    value={option}
                                                    checked={mode === option}
                                                    onChange={() => setMode(option)}
                                                    disabled={saving}
                                                    className="mt-1"
                                                />
                                                <span>
                                                    <span className="block text-sm font-medium text-slate-800">
                                                        {modeLabels[option].title}
                                                    </span>
                                                    <span className="block text-xs leading-5 text-slate-500">
                                                        {modeLabels[option].detail}
                                                    </span>
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </fieldset>
                            )}

                            {needsDuplicateConfirmation && loan && (
                                <div className={LINK_DIALOG_LAYOUT.notice}>
                                    {loan.possibleDuplicates.map(text => (
                                        <p key={text}>{text}</p>
                                    ))}
                                    <p className="mt-1">
                                        If that is this same payment, reverse it
                                        from the loan's EMI Schedule instead of
                                        linking this one, or it will be counted
                                        twice.
                                    </p>
                                    <label className="mt-2 flex items-center gap-2">
                                        <Checkbox
                                            checked={confirmedNotDuplicate}
                                            onCheckedChange={checked =>
                                                setConfirmedNotDuplicate(checked === true)
                                            }
                                            disabled={saving}
                                            className="border border-amber-400 bg-white"
                                        />
                                        This is a different payment
                                    </label>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className={LINK_DIALOG_LAYOUT.footer}>
                    <button
                        type="button"
                        disabled={saving}
                        onClick={() => onOpenChange(false)}
                        className="h-9 rounded-lg border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        disabled={!canSave}
                        onClick={handleLink}
                        className="h-9 cursor-pointer rounded-lg bg-slate-900 px-5 text-sm font-medium text-white shadow-sm transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {saving ? "Linking..." : workflow === "OVERDRAFT" ? "Link" : "Link Payment"}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
