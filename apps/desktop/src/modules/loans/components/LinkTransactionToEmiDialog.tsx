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
    type TransactionLinkOptions,
} from "../services/LoanTransactionLinkService";
import { emiPaymentErrorMessage } from "./emiPaymentErrorMessage";

// ---------------------------------------------------------------------
// Transactions -> Link to Loan EMI: records an EXISTING transaction as a
// loan EMI payment (see LoanTransactionLinkService). The transaction is
// kept exactly as it is - no new one is created. Whether its amount is a
// full payment, a partial one, or the lender's full instalment for less
// than the calculated EMI is always the user's explicit choice.
// ---------------------------------------------------------------------

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
        setConfirmedNotDuplicate(false);

        new LoanTransactionLinkService()
            .getLinkOptions(transaction.id)
            .then(loaded => {
                if (cancelled) {
                    return;
                }

                setOptions(loaded);

                const initialLoan =
                    loaded.loans.find(loan => loan.loanId === loaded.suggestedLoanId) ??
                    (loaded.loans.length === 1 ? loaded.loans[0] : undefined);

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

    const needsDuplicateConfirmation =
        (loan?.possibleDuplicates.length ?? 0) > 0;

    const canSave =
        !saving &&
        !!options &&
        !options.refusal &&
        !!loan &&
        !!installment &&
        !!mode &&
        installment.modes.includes(mode) &&
        (!needsDuplicateConfirmation || confirmedNotDuplicate);

    async function handleLink() {
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
                className="
                    w-[560px]
                    max-w-[calc(100vw-48px)]
                    rounded-[24px]
                    border
                    border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="px-7 pb-4 pt-6">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Link to Loan EMI
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm leading-6 text-slate-500">
                        Record this existing transaction as a loan EMI
                        payment. No new transaction is created - this one
                        is kept exactly as it is.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 px-7 pb-6">
                    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="flex items-baseline justify-between gap-4">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-slate-800">
                                    {transaction.payee || "—"}
                                </div>
                                {transaction.originalNarration && (
                                    <div
                                        className="mt-0.5 truncate text-[11px] text-slate-400"
                                        title={transaction.originalNarration}
                                    >
                                        {transaction.originalNarration}
                                    </div>
                                )}
                            </div>
                            <div className="shrink-0 text-right">
                                <div className="text-sm font-semibold text-slate-900">
                                    {money(amount)}
                                </div>
                                <div className="text-xs text-slate-500">
                                    {formatDate(transaction.transactionDate)}
                                </div>
                            </div>
                        </div>
                    </div>

                    {loadError && (
                        <p className="text-sm text-red-600">{loadError}</p>
                    )}

                    {!options && !loadError && (
                        <p className="text-sm text-slate-500">Loading loans...</p>
                    )}

                    {options?.refusal && (
                        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
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
                                    <SelectTrigger id="linkEmiLoan" className="w-full">
                                        <SelectValue placeholder="Select loan">
                                            {loan?.loanName ?? "Select loan"}
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
                                    </SelectContent>
                                </Select>
                            </div>

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
                                            <SelectTrigger id="linkEmiInstallment" className="w-full">
                                                <SelectValue placeholder="Select instalment">
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
                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
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

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-7 py-5">
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
                        {saving ? "Linking..." : "Link Payment"}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
