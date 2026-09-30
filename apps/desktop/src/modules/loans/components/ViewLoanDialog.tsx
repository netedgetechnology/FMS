import { useEffect, useState } from "react";

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
import type { Loan } from "../types";

export interface ViewLoanDialogProps {
    loan: Loan | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
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
                value: loan.loanType || EMPTY,
            },
            { label: "Lender", value: lenderName || EMPTY },
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
                value: `${loan.interestRate.toFixed(2)}%`,
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
}: ViewLoanDialogProps) {
    const formatMoney = useMoneyFormatter();
    const formatDate = useDateFormatter();
    const { currencies } = useCurrencies();

    const [lenderName, setLenderName] = useState("");
    const [linkedAccountName, setLinkedAccountName] =
        useState("");
    const [emiSummary, setEmiSummary] =
        useState<ResolvedLoanEmiSummary | null>(null);

    useEffect(() => {
        let mounted = true;

        async function loadRelated() {
            if (!loan) {
                return;
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
    }, [loan, open]);

    if (!loan) {
        return null;
    }

    const currency = currencies.find(
        item => item.id === loan.currencyId
    );

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
