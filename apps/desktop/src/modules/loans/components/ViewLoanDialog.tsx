import { useEffect, useState } from "react";
import { LoanSetupSummary } from "./setup/LoanSetupSummary";
import { InterestRateHistorySection } from "./rates/InterestRateHistorySection";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useMoneyFormatter, useDateFormatter } from "@/core/formatting";
import { useCurrencies } from "@/modules/currencies";
import { AccountService } from "@/modules/accounts/services";
import { InstitutionRepository } from "@/modules/institutions/repositories/InstitutionRepository";

import { LoanDashboardService } from "../services";
import { OverdraftService } from "../services/OverdraftService";
import {
    OVERDRAFT_USAGE_STATUS_LABELS,
    type OverdraftPosition,
} from "../services/overdraftPosition";
import { LOAN_KIND_LABELS, LoanKind, isOverdraft, type Loan } from "../types";
import type { DrawingPowerStep } from "../setup/droplineSchedule";
import { localToday } from "../setup/historicalInstalments";
import { InterestRateHistoryRepository } from "../repositories/InterestRateHistoryRepository";
import { currentLoanRate, currentRateLabel } from "../setup/interestRateHistory";
import type { InterestRateHistoryEntry } from "../types/InterestRateHistory";

export interface ViewLoanDialogProps {
    loan: Loan | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** A rate change was saved: the loan list should reload. */
    onLoanChanged?: () => void;
}

export interface LoanViewField {
    label: string;
    value: string;
}

export interface LoanViewModel {
    basicInformation: LoanViewField[];
    loanTerms: LoanViewField[];
    outstandingBalance: LoanViewField[];
    statusLabel: string;
    emiSummary: LoanViewField[] | null;
    notes: string;
}

export interface ResolvedLoanEmiSummary {
    totalRemainingEmi: number;
    nextEmi: {
        dueDate: string;
        totalAmount: number;
    } | null;
}

function titleCase(value: string): string {
    return value
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, character => character.toUpperCase());
}

function interestTypeLabel(
    interestType: Loan["interestType"]
): string {
    return interestType === "FLAT"
        ? "Flat Rate"
        : "Reducing Balance";
}

const EMPTY = "—";

/**
 * Every value the View Loan dialog displays, computed once as plain
 * data so it's unit testable without rendering the dialog. Reuses only
 * what's already stored on the loan or resolved by callers from
 * existing services (lender/linked-account names, currency label, the
 * EMI summary from LoanDashboardService.getSummary) - no calculation
 * here duplicates loan/loan-service logic; `formatMoney`/`formatDate`
 * are the app's own existing formatters, passed in so this stays pure.
 */
export function buildLoanViewModel(
    loan: Loan,
    resolved: {
        lenderName: string;
        linkedAccountName: string;
        currencyLabel: string;
        formatMoney: (value: number) => string;
        formatDate: (value: string) => string;
        emiSummary: ResolvedLoanEmiSummary | null;
        /** The current rate from the rate history (currentLoanRate); else the loan's own rate. */
        interestRateLabel?: string;
    }
): LoanViewModel {
    const {
        lenderName,
        linkedAccountName,
        currencyLabel,
        formatMoney,
        formatDate,
        emiSummary,
    } = resolved;

    return {
        basicInformation: [
            { label: "Loan Name", value: loan.name || EMPTY },
            {
                label: "Loan Type",
                value: LOAN_KIND_LABELS[LoanKind.TERM_LOAN],
            },
            {
                label: "Loan Category",
                value: loan.loanType || EMPTY,
            },
            { label: "Lender", value: lenderName || EMPTY },
            {
                label: "Loan Account Number",
                value: loan.loanAccountNumber || EMPTY,
            },
            {
                label: "Currency",
                value: currencyLabel || loan.currencyId,
            },
            {
                label: "Linked Account",
                value: linkedAccountName || EMPTY,
            },
        ],

        loanTerms: [
            {
                label: "Principal Amount",
                value: formatMoney(loan.principalAmount),
            },
            {
                label: "Interest Rate",
                value: resolved.interestRateLabel ?? `${loan.interestRate.toFixed(2)}%`,
            },
            {
                label: "Interest Type",
                value: interestTypeLabel(
                    loan.interestType
                ),
            },
            {
                label: "Tenure",
                value:
                    loan.tenureMonths == null
                        ? EMPTY
                        : `${loan.tenureMonths} months`,
            },
            {
                label: "Start Date",
                value: formatDate(loan.startDate),
            },
            {
                label: "Maturity Date",
                value: loan.maturityDate
                    ? formatDate(loan.maturityDate)
                    : EMPTY,
            },
            {
                label: "EMI Amount",
                value:
                    loan.emiAmount == null
                        ? EMPTY
                        : formatMoney(loan.emiAmount),
            },
            {
                label: "First Instalment",
                value:
                    loan.firstInstallmentAmount == null
                        ? "Same as EMI"
                        : `${formatMoney(loan.firstInstallmentAmount)} (broken-period interest)`,
            },
            {
                label: "Number of Paid Installments",
                value: String(loan.paidInstallments ?? 0),
            },
        ],

        outstandingBalance: [
            {
                label: "Outstanding Principal",
                value: formatMoney(
                    loan.outstandingPrincipal
                ),
            },
            {
                label: "Outstanding Interest",
                value: formatMoney(
                    loan.outstandingInterest
                ),
            },
        ],

        statusLabel: titleCase(loan.status),

        emiSummary: emiSummary
            ? [
                  {
                      label: "Total Remaining EMI",
                      value: formatMoney(
                          emiSummary.totalRemainingEmi
                      ),
                  },
                  {
                      label: "Next EMI Date",
                      value: emiSummary.nextEmi
                          ? formatDate(
                                emiSummary.nextEmi.dueDate
                            )
                          : EMPTY,
                  },
                  {
                      label: "Next EMI Amount",
                      value: emiSummary.nextEmi
                          ? formatMoney(
                                emiSummary.nextEmi
                                    .totalAmount
                            )
                          : EMPTY,
                  },
              ]
            : null,

        notes: loan.notes || EMPTY,
    };
}

export interface OverdraftViewModel {
    /** The three figures shown first and largest: limit, used, available. */
    headline: LoanViewField[];
    /** Every bank account linked to the OD - all feed the one position. */
    linkedAccounts: string[];
    usageStatusLabel: string;
    /** "Over limit by X" or "Over drawing power by X" - null when neither. */
    overLimitNote: string | null;
    /** What the facility was saved as: Overdraft, Cash Credit, Dropline Overdraft... */
    facilityLabel: string;
    /** A Dropline's steps by date, the one in force today marked; [] otherwise. */
    drawingPowerSchedule: { date: string; amount: string; inForce: boolean; upcoming: boolean }[];
    reviewReasons: string[];
    details: LoanViewField[];
    loanStatusLabel: string;
    notes: string;
}

/**
 * Every value the View dialog shows for an Overdraft - pure, from the
 * one derived OverdraftPosition (OverdraftService.getPosition), so the
 * dialog never computes a figure of its own.
 */
export function buildOverdraftViewModel(
    loan: Loan,
    position: OverdraftPosition,
    resolved: {
        lenderName: string;
        /** The OD's linked bank account names, in the saved order. */
        linkedAccountNames: string[];
        currencyLabel: string;
        formatMoney: (value: number) => string;
        formatDate: (value: string) => string;
        /** A Dropline's saved steps (OverdraftService.getDrawingPowerSchedule). */
        drawingPowerSchedule?: readonly DrawingPowerStep[];
        today?: string;
        /** The current rate from the rate history (currentLoanRate); else the loan's own rate. */
        interestRateLabel?: string;
    }
): OverdraftViewModel {
    const { formatMoney, formatDate } = resolved;
    const steps = [...(resolved.drawingPowerSchedule ?? [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    const today = resolved.today ?? localToday();
    // The same rule as drawingPowerOn: the latest step on or before today.
    const started = steps.filter(step => step.effectiveDate <= today);
    const inForce = started.length > 0 ? started[started.length - 1]! : null;
    const facilityLabel = loan.loanType?.trim() || "Overdraft";

    return {
        headline: [
            { label: facilityLabel === "Overdraft" ? "OD Limit" : "Sanctioned Limit", value: formatMoney(position.limit) },
            { label: "Currently Used", value: formatMoney(position.used) },
            { label: "Currently Available", value: formatMoney(position.available) },
        ],
        linkedAccounts: resolved.linkedAccountNames,
        usageStatusLabel: OVERDRAFT_USAGE_STATUS_LABELS[position.status],
        overLimitNote:
            position.overLimitBy > 0
                ? `Over limit by ${formatMoney(position.overLimitBy)}`
                : position.overDrawingPowerBy > 0
                  ? `Over drawing power by ${formatMoney(position.overDrawingPowerBy)}`
                  : null,
        facilityLabel,
        drawingPowerSchedule: steps.map(step => ({
            date: formatDate(step.effectiveDate),
            amount: formatMoney(step.drawingPower),
            inForce: step === inForce,
            upcoming: step.effectiveDate > today,
        })),
        reviewReasons: position.reviewReasons,
        details: [
            { label: "Facility Type", value: facilityLabel },
            {
                // What Available is worked out from today - a Dropline's step in
                // force, else the recorded figure (Lender Terms shows that as saved).
                label: steps.length > 0 ? "Drawing Power Today" : "Drawing Power in Use",
                value:
                    position.drawingPower !== null
                        ? formatMoney(position.drawingPower)
                        : steps.length > 0
                          ? "Before the first step - the limit applies"
                          : "Not recorded - the limit applies",
            },
            {
                label: "Utilization",
                value:
                    position.utilizationPercent === null
                        ? EMPTY
                        : `${position.utilizationPercent.toFixed(2)}%`,
            },
            { label: "Total Drawdowns", value: formatMoney(position.totalDrawdowns) },
            { label: "Total Repayments", value: formatMoney(position.totalRepayments) },
            { label: "Interest / Charges", value: formatMoney(position.totalInterestCharges) },
            {
                label: "Opening Used",
                value: loan.openingUsedAsOf
                    ? `${formatMoney(loan.openingUsed ?? 0)} as of ${formatDate(loan.openingUsedAsOf)}`
                    : formatMoney(loan.openingUsed ?? 0),
            },
            {
                label: "Interest Rate",
                value: resolved.interestRateLabel ?? `${loan.interestRate.toFixed(2)}%`,
            },
            { label: "Lender", value: resolved.lenderName || EMPTY },
            { label: "Loan Account Number", value: loan.loanAccountNumber || EMPTY },
            { label: "Start Date", value: formatDate(loan.startDate) },
            { label: "Currency", value: resolved.currencyLabel || loan.currencyId },
        ],
        loanStatusLabel: titleCase(loan.status),
        notes: loan.notes || EMPTY,
    };
}

function Section({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section className="space-y-2.5">
            <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-slate-900">
                    {title}
                </h3>

                <div className="h-px flex-1 bg-slate-100" />
            </div>

            {children}
        </section>
    );
}

function FieldGrid({ fields }: { fields: LoanViewField[] }) {
    return (
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            {fields.map(field => (
                <div
                    key={field.label}
                    className="min-w-0 space-y-1"
                >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                        {field.label}
                    </div>

                    <div className="break-words text-sm text-slate-800">
                        {field.value}
                    </div>
                </div>
            ))}
        </div>
    );
}

/**
 * Read-only loan overview - no field here is ever editable, and this
 * dialog never calls LoanService.update()/create()/delete(). All the
 * "what value goes with what label" logic lives in buildLoanViewModel
 * above (pure, unit tested); this component only resolves the display
 * names/summary it needs and renders that data.
 */
export function ViewLoanDialog({
    loan,
    open,
    onOpenChange,
    onLoanChanged,
}: ViewLoanDialogProps) {
    const formatMoney = useMoneyFormatter();
    const formatDate = useDateFormatter();
    const { currencies } = useCurrencies();

    const [lenderName, setLenderName] = useState("");
    const [linkedAccountName, setLinkedAccountName] =
        useState("");
    const [emiSummary, setEmiSummary] =
        useState<ResolvedLoanEmiSummary | null>(null);
    const [overdraftPosition, setOverdraftPosition] =
        useState<OverdraftPosition | null>(null);
    const [overdraftSteps, setOverdraftSteps] = useState<DrawingPowerStep[]>([]);
    const [overdraftAccountNames, setOverdraftAccountNames] =
        useState<string[]>([]);
    const [rateHistory, setRateHistory] = useState<InterestRateHistoryEntry[]>([]);
    // Bumped when a rate change is saved, so the current rate shown reloads.
    const [rateVersion, setRateVersion] = useState(0);
    const handleLoanChanged = () => {
        setRateVersion(version => version + 1);
        onLoanChanged?.();
    };

    useEffect(() => {
        let mounted = true;

        async function loadRelated() {
            if (!loan) {
                return;
            }

            // The current rate is derived from the live rate history (empty
            // until migration 054 is applied: the loan's own rate is shown).
            try {
                const history = await new InterestRateHistoryRepository().findByLoan(loan.id);
                if (mounted) setRateHistory(history);
            } catch (error) {
                console.error("Failed to load interest rate history for loan view:", error);
                if (mounted) setRateHistory([]);
            }

            if (loan.lenderInstitutionId) {
                try {
                    const institution =
                        await new InstitutionRepository().getById(
                            loan.lenderInstitutionId
                        );

                    if (mounted) {
                        setLenderName(
                            institution?.name ?? ""
                        );
                    }
                } catch (error) {
                    console.error(
                        "Failed to load lender for loan view:",
                        error
                    );

                    if (mounted) {
                        setLenderName("");
                    }
                }
            } else if (mounted) {
                setLenderName("");
            }

            if (loan.accountId) {
                try {
                    const account =
                        await new AccountService().getById(
                            loan.accountId
                        );

                    if (mounted) {
                        setLinkedAccountName(
                            account?.name ?? ""
                        );
                    }
                } catch (error) {
                    console.error(
                        "Failed to load linked account for loan view:",
                        error
                    );

                    if (mounted) {
                        setLinkedAccountName("");
                    }
                }
            } else if (mounted) {
                setLinkedAccountName("");
            }

            // An Overdraft has no EMI: its position is derived fresh from
            // its linked transactions every time the dialog opens.
            if (isOverdraft(loan)) {
                try {
                    const accountService = new AccountService();
                    const overdraftService = new OverdraftService();
                    const [position, steps, accounts] = await Promise.all([
                        overdraftService.getPosition(loan),
                        overdraftService.getDrawingPowerSchedule(loan),
                        Promise.all(
                            (loan.linkedAccountIds ?? []).map(id =>
                                accountService.getById(id)
                            )
                        ),
                    ]);

                    if (mounted) {
                        setOverdraftPosition(position);
                        setOverdraftSteps(steps);
                        setOverdraftAccountNames(
                            accounts.map(
                                (account, index) =>
                                    account?.name ??
                                    loan.linkedAccountIds![index]!
                            )
                        );
                    }
                } catch (error) {
                    console.error(
                        "Failed to load overdraft position:",
                        error
                    );

                    if (mounted) {
                        setOverdraftPosition(null);
                    }
                }

                return;
            }

            try {
                const summary =
                    await new LoanDashboardService().getSummary(
                        [loan]
                    );

                if (mounted) {
                    setEmiSummary({
                        totalRemainingEmi:
                            summary.totalRemainingEmi,
                        nextEmi: summary.nextEmi
                            ? {
                                  dueDate:
                                      summary.nextEmi
                                          .dueDate,
                                  totalAmount:
                                      summary.nextEmi
                                          .totalAmount,
                              }
                            : null,
                    });
                }
            } catch (error) {
                console.error(
                    "Failed to load EMI summary for loan view:",
                    error
                );

                if (mounted) {
                    setEmiSummary(null);
                }
            }
        }

        if (open) {
            void loadRelated();
        }

        return () => {
            mounted = false;
        };
    }, [loan, open, rateVersion]);

    if (!loan) {
        return null;
    }

    const currency = currencies.find(
        item => item.id === loan.currencyId
    );
    const interestRateLabel = currentRateLabel(currentLoanRate(loan, rateHistory, localToday()), formatDate);

    if (isOverdraft(loan)) {
        return (
            <OverdraftView
                loan={loan}
                open={open}
                onOpenChange={onOpenChange}
                onLoanChanged={handleLoanChanged}
                model={
                    overdraftPosition
                        ? buildOverdraftViewModel(loan, overdraftPosition, {
                              lenderName,
                              linkedAccountNames: overdraftAccountNames,
                              currencyLabel: currency
                                  ? `${currency.code} — ${currency.name}`
                                  : "",
                              formatMoney: value =>
                                  formatMoney(value, currency?.code),
                              formatDate,
                              drawingPowerSchedule: overdraftSteps,
                              interestRateLabel,
                          })
                        : null
                }
            />
        );
    }

    const viewModel = buildLoanViewModel(loan, {
        lenderName,
        linkedAccountName,
        currencyLabel: currency
            ? `${currency.code} — ${currency.name}`
            : "",
        formatMoney: value =>
            formatMoney(value, currency?.code),
        formatDate,
        emiSummary,
        interestRateLabel,
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton
                className="
                    flex
                    max-h-[calc(100vh-48px)]
                    w-[720px]
                    max-w-[calc(100vw-48px)]
                    flex-col
                    gap-0
                    overflow-hidden
                    rounded-[28px]
                    border border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="shrink-0 px-7 pb-4 pt-6">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        {loan.name}
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Read-only loan overview.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 space-y-6 overflow-y-auto border-t border-slate-100 px-7 py-5">
                    <Section title="Basic Information">
                        <FieldGrid
                            fields={
                                viewModel.basicInformation
                            }
                        />
                    </Section>

                    <Section title="Loan Terms">
                        <FieldGrid
                            fields={viewModel.loanTerms}
                        />
                    </Section>

                    <Section title="Outstanding Balance">
                        <FieldGrid
                            fields={
                                viewModel.outstandingBalance
                            }
                        />
                    </Section>

                    <Section title="Status">
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                            {viewModel.statusLabel}
                        </span>
                    </Section>

                    <LoanSetupSummary loan={loan} />

                    <InterestRateHistorySection loan={loan} onLoanChanged={handleLoanChanged} />

                    {viewModel.emiSummary && (
                        <Section title="EMI Summary">
                            <FieldGrid
                                fields={
                                    viewModel.emiSummary
                                }
                            />
                        </Section>
                    )}

                    <Section title="Notes">
                        <p className="whitespace-pre-wrap text-sm text-slate-700">
                            {viewModel.notes}
                        </p>
                    </Section>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function OverdraftView({
    loan,
    open,
    onOpenChange,
    onLoanChanged,
    model,
}: {
    loan: Loan;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onLoanChanged?: () => void;
    model: OverdraftViewModel | null;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton
                className="
                    flex
                    max-h-[calc(100vh-48px)]
                    w-[720px]
                    max-w-[calc(100vw-48px)]
                    flex-col
                    gap-0
                    overflow-hidden
                    rounded-[28px]
                    border border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="shrink-0 px-7 pb-4 pt-6">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        {loan.name}
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        {model?.facilityLabel ?? "Overdraft"} - read-only overview.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 space-y-6 overflow-y-auto border-t border-slate-100 px-7 py-5">
                    {!model ? (
                        <p className="text-sm text-slate-500">Loading overdraft...</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-3 gap-3">
                                {model.headline.map(field => (
                                    <div
                                        key={field.label}
                                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                                    >
                                        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                            {field.label}
                                        </div>
                                        <div className="mt-1 text-lg font-semibold tracking-tight text-slate-900">
                                            {field.value}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                                    {model.usageStatusLabel}
                                </span>
                                {model.overLimitNote && (
                                    <span className="text-xs font-medium text-red-600">
                                        {model.overLimitNote}
                                    </span>
                                )}
                            </div>

                            {model.reviewReasons.length > 0 && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                    {model.reviewReasons.map(reason => (
                                        <p key={reason}>{reason}</p>
                                    ))}
                                </div>
                            )}

                            <Section title="Linked Bank Accounts">
                                {model.linkedAccounts.length === 0 ? (
                                    <p className="text-sm text-slate-500">—</p>
                                ) : (
                                    <ul className="space-y-1 text-sm text-slate-800">
                                        {model.linkedAccounts.map(name => (
                                            <li key={name}>{name}</li>
                                        ))}
                                    </ul>
                                )}
                            </Section>

                            <Section title="Details">
                                <FieldGrid fields={model.details} />
                            </Section>

                            {model.drawingPowerSchedule.length > 0 && (
                                <Section title="Drawing Power Schedule">
                                    <ul data-testid="od-drawing-power-schedule" className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                                        {model.drawingPowerSchedule.map(step => (
                                            <li
                                                key={step.date}
                                                className={`flex justify-between px-3 py-1.5 ${step.inForce ? "bg-emerald-50 font-semibold text-slate-900" : step.upcoming ? "text-slate-700" : "text-slate-400"}`}
                                            >
                                                <span>From {step.date}{step.inForce ? " - in force today" : ""}</span>
                                                <span>{step.amount}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </Section>
                            )}

                            <LoanSetupSummary loan={loan} />

                            <InterestRateHistorySection loan={loan} onLoanChanged={onLoanChanged} />

                            <Section title="Status">
                                <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                                    {model.loanStatusLabel}
                                </span>
                            </Section>

                            <Section title="Notes">
                                <p className="whitespace-pre-wrap text-sm text-slate-700">
                                    {model.notes}
                                </p>
                            </Section>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
