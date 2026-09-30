import { useMoneyFormatter } from "@/core/formatting";
import { getErrorMessage } from "@/core/errors";
import {
    CreditCard,
    Eye,
    HandCoins,
    Landmark,
    Plus,
    TrendingUp,
    Wallet,
    WalletCards,
} from "lucide-react";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import {
    EmptyState,
    PageHeader,
} from "@/components/common";

import {
    AccountTable,
    AddAccountDialog,
    EditAccountDialog,
    ViewAccountDialog,
} from "../components";

import { AddInvestmentDialog } from "@/modules/investments/components";
import { useInvestments } from "@/modules/investments/hooks";
import {
    AddLoanDialog,
    EditLoanDialog,
    EMIScheduleDialog,
} from "@/modules/loans/components";
import {
    LoanService,
    computeOutstandingLoanSummary,
} from "@/modules/loans/services";
import type { Loan } from "@/modules/loans/types";
import { useCurrencies } from "@/modules/currencies";
import { useTransactions } from "@/modules/transactions/hooks";

import {
    BANK_ACCOUNT_TYPE_OPTIONS,
    CREDIT_CARD_TYPE_OPTIONS,
} from "../constants";
import { useAccounts } from "../hooks";
import { useLoans } from "@/modules/loans/hooks";
import {
    AccountService,
    isUnlinkedLoanAccount,
} from "../services";
import { Account } from "../types";
import { AccountType } from "../types/AccountType";
import { computeAccountCurrentBalances } from "../utils";
export default function AccountsPage() {
    const formatMoney = useMoneyFormatter();

    const {
        accounts,
        loading,
        error,
        refresh,
    } = useAccounts();
    const { loans, refresh: refreshLoans } = useLoans();
    const { investments: investmentRecords } =
        useInvestments();
    const { currencies } = useCurrencies();
    const { transactions } = useTransactions();

    // Delete Account - transaction deletion protection. Lets the delete
    // click short-circuit with an immediate, specific toast (mirrors the
    // investment-linked check right below) instead of opening the confirm
    // dialog only to have AccountService.delete() reject it a click
    // later. The service enforces the same guard independently, so this
    // is a UX fast path, not the source of truth.
    const accountIdsWithTransactions = useMemo(() => {
        const ids = new Set<string>();

        for (const transaction of transactions) {
            ids.add(transaction.accountId);
        }

        return ids;
    }, [transactions]);

    // The account's stored opening_balance is a snapshot, not a running
    // balance - every income/expense transaction posted against it
    // since must be added on top to show what the account is actually
    // worth today (see computeAccountCurrentBalances). This is the same
    // formula the Dashboard's Accounts Summary already uses, so the two
    // pages can't disagree about an account's balance again.
    const accountBalances = useMemo(
        () => computeAccountCurrentBalances(accounts, transactions),
        [accounts, transactions]
    );
    const [viewingAccount, setViewingAccount] = useState<Account | null>(null);
    const [editingAccount, setEditingAccount] = useState<Account | null>(null);
    const [selectedAccountFilter, setSelectedAccountFilter] = useState<
        | "BANK"
        | "CASH_WALLET"
        | AccountType.CREDIT_CARD
        | AccountType.INVESTMENT
        | AccountType.LOAN
        | null
    >(null);
    const [searchQuery, setSearchQuery] = useState("");

const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);
const [deleting, setDeleting] = useState(false);

    // A loan is shown in Accounts through its 1:1 LOAN account. View / Edit /
    // Delete on that row route into the existing Loans flows, not the account
    // dialogs, so the loan stays the source of truth.
    const [viewingLoan, setViewingLoan] = useState<Loan | null>(null);
    const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
    const [deletingLoan, setDeletingLoan] = useState<Loan | null>(null);
    const [deletingLoanBusy, setDeletingLoanBusy] = useState(false);

    const loanByAccountId = useMemo(() => {
        const map = new Map<string, Loan>();

        for (const loan of loans) {
            if (loan.loanAccountId) {
                map.set(loan.loanAccountId, loan);
            }
        }

        return map;
    }, [loans]);

    // An investment is shown in Accounts through its 1:1 INVESTMENT
    // account, the same as a loan above. Unlike a loan, deleting that
    // mirror account does not delete the investment - it just orphans
    // it (invisible under Accounts until the investment is next
    // edited, which self-heals the link - see InvestmentService.update).
    // Block the delete here instead and point the user at the
    // Investments page, where deleting the investment itself also
    // cleans up its transactions/holdings and this mirror account.
    const investmentByAccountId = useMemo(() => {
        const map = new Map<
            string,
            (typeof investmentRecords)[number]
        >();

        for (const investment of investmentRecords) {
            if (investment.accountId) {
                map.set(
                    investment.accountId,
                    investment
                );
            }
        }

        return map;
    }, [investmentRecords]);

    function handleViewAccount(account: Account) {
        const loan = loanByAccountId.get(account.id);

        if (loan) {
            setViewingLoan(loan);
            return;
        }

        setViewingAccount(account);
    }

    function handleEditAccount(account: Account) {
        const loan = loanByAccountId.get(account.id);

        if (loan) {
            setEditingLoan(loan);
            return;
        }

        setEditingAccount(account);
    }

    function handleDeleteAccount(account: Account) {
        const loan = loanByAccountId.get(account.id);

        if (loan) {
            setDeletingLoan(loan);
            return;
        }

        const investment = investmentByAccountId.get(
            account.id
        );

        if (investment) {
            toast.error(
                "This account is linked to an investment. Delete or manage it from the Investments page instead."
            );
            return;
        }

        if (accountIdsWithTransactions.has(account.id)) {
            toast.error(
                "This account has transactions linked to it and can't be deleted. Delete or reassign its transactions first, or keep the account for your records."
            );
            return;
        }

        setDeletingAccount(account);
    }

    async function confirmDeleteLoan() {
        if (!deletingLoan || deletingLoanBusy) {
            return;
        }

        setDeletingLoanBusy(true);

        try {
            await new LoanService().delete(deletingLoan.id);
            await Promise.all([refresh(), refreshLoans()]);

            toast.success("Loan deleted successfully.");
            setDeletingLoan(null);
        } catch (error) {
            console.error("Failed to delete loan:", error);
            toast.error(
                getErrorMessage(
                    error,
                    "Unable to delete the loan. Please try again."
                )
            );
        } finally {
            setDeletingLoanBusy(false);
        }
    }

    async function confirmDeleteAccount() {
        if (!deletingAccount || deleting) {
            return;
        }

        setDeleting(true);

        try {
            const service = new AccountService();
            await service.delete(deletingAccount.id);
            await refresh();

            toast.success("Account deleted successfully.");
            setDeletingAccount(null);
        } catch (error) {
            console.error("Failed to delete account:", error);
            toast.error(
                getErrorMessage(
                    error,
                    "Unable to delete the account. Please try again."
                )
            );
        } finally {
            setDeleting(false);
        }
    }
    const bankAccounts = accounts.filter(
        account =>
            account.type === AccountType.SAVINGS ||
            account.type === AccountType.CURRENT
    ).length;

    const activeBankAccounts = accounts.filter(
        account =>
            account.isActive &&
            (account.type === AccountType.SAVINGS ||
                account.type === AccountType.CURRENT)
    ).length;


    const creditCards = accounts.filter(
        account => account.type === AccountType.CREDIT_CARD
    ).length;

const investments = accounts.filter(
    account => account.type === AccountType.INVESTMENT
).length;

const cashAccounts = accounts.filter(
    account => account.type === AccountType.CASH
).length;

const walletAccounts = accounts.filter(
    account => account.type === AccountType.WALLET
).length;

const totalLoans = loans.length;

// CLOSED loans excluded and scoped to one resolved primary currency -
// see computeOutstandingLoanSummary. Summing loans in different
// currencies as one number would be meaningless; when every loan
// shares one currency (the common case) this behaves exactly as
// before (Loans Phase 2).
const {
    outstandingPrincipal: outstandingLoanPrincipal,
    currencyCode: loanCurrencyCode,
    hasOtherCurrencies: hasOtherLoanCurrencies,
} = computeOutstandingLoanSummary(loans, currencies);


    const accountsByType =
    selectedAccountFilter === null
        ? accounts
        : selectedAccountFilter === "BANK"
            ? accounts.filter(
                account =>
                    account.type === AccountType.SAVINGS ||
                    account.type === AccountType.CURRENT
            )
        : selectedAccountFilter === "CASH_WALLET"
            ? accounts.filter(
                account =>
                    account.type === AccountType.CASH ||
                    account.type === AccountType.WALLET
            )
            : accounts.filter(
                account => account.type === selectedAccountFilter
            );

    const search = searchQuery.trim().toLowerCase();

    const filteredAccounts = search
        ? accountsByType.filter(account =>
            [
                account.name,
                account.accountNumber,
                account.institutionName,
            ].some(field =>
                field?.toLowerCase().includes(search)
            )
        )
        : accountsByType;

const totalBalance = accounts.reduce(
        (total, account) =>
            account.type === AccountType.INVESTMENT ||
            account.type === AccountType.LOAN
                ? total
                : total + (accountBalances.get(account.id) ?? 0),
        0
    );


    const formattedBalance = formatMoney(totalBalance);


    return (
        <div className="min-h-full bg-slate-50">

            <div className="w-full space-y-6">

                <PageHeader
                    title="Accounts"
                    subtitle="Manage your bank accounts, cards, wallets and investments."
                    actions={
                        <AddAccountDialog
                            title="Add Account(s)"
                            onSuccess={refresh}
                        />
                    }
                />


                            <section className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-6">
<div className="relative flex h-[156px] flex-col overflow-hidden rounded-3xl bg-white px-5 py-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
        <div className="flex items-start justify-between">
            <div>
                <div className="text-caption font-medium text-slate-500">
                    Total Balance
                </div>
                <div className="mt-3 text-card-value amount leading-none tracking-[-0.02em] text-[#0F172A]">
                    {formattedBalance}
                </div>
            </div>

            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EEF4FF] shadow-sm">
                <Wallet size={20} className="text-[#2563EB]" />
            </div>
        </div>
    </div>
<div className="relative flex h-[156px] flex-col overflow-hidden rounded-3xl bg-white px-5 py-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
        <div className="flex items-start justify-between">
            <div>
                <div className="text-caption font-medium text-slate-500">
                    Bank Accounts
                </div>

                <div className="mt-3 text-card-value leading-none tracking-[-0.02em] text-[#0F172A]">
                    {bankAccounts}
                </div>

                <div className="mt-4 text-small text-slate-400">
                    {activeBankAccounts} active accounts
                </div>
            </div>

            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#ECFDF3] shadow-sm">
                <Landmark size={20} className="text-[#16A34A]" />
            </div>
        </div>

        <div className="absolute inset-x-5 bottom-2 flex items-center justify-end gap-2">
            <button
                type="button"
                onClick={() => setSelectedAccountFilter("BANK")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
                <Eye size={14} />
            </button>

            <AddAccountDialog
                typeOptions={BANK_ACCOUNT_TYPE_OPTIONS}
                title="Add Bank Accounts"
                description="Add a savings or current / checking account."
                onSuccess={refresh}
                trigger={
                    <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                        title="Add bank account"
                        aria-label="Add bank account"
                    >
                        <Plus size={16} />
                    </button>
                }
            />
        </div>
    </div>
<div className="relative flex h-[156px] flex-col overflow-hidden rounded-3xl bg-white px-5 py-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
        <div className="flex items-start justify-between">
            <div>
                <div className="text-caption font-medium text-slate-500">
                    Cash & Wallets
                </div>

                <div className="mt-3 text-card-value leading-none tracking-[-0.02em] text-[#0F172A]">
                    {cashAccounts + walletAccounts}
                </div>

                <div className="mt-4 whitespace-nowrap text-small text-slate-400">
                    Cash: {cashAccounts} · Wallets: {walletAccounts}
                </div>
            </div>

            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#ECFDF5] shadow-sm">
                <WalletCards size={20} className="text-[#059669]" />
            </div>
        </div>

        <div className="absolute inset-x-5 bottom-2 flex items-center justify-end gap-2">
            <button
                type="button"
                onClick={() => setSelectedAccountFilter("CASH_WALLET")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                title="View cash and wallet accounts"
                aria-label="View cash and wallet accounts"
            >
                <Eye size={14} />
            </button>

            <AddAccountDialog
                defaultValues={{ type: AccountType.CASH }}
                title="Add Cash & Wallets"
                description="Add a cash or wallet account."
                onSuccess={refresh}
                trigger={
                    <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                        title="Add cash account"
                        aria-label="Add cash account"
                    >
                        <Plus size={16} />
                    </button>
                }
            />
        </div>
    </div>

<div className="relative flex h-[156px] flex-col overflow-hidden rounded-3xl bg-white px-5 py-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
        <div className="flex items-start justify-between">
            <div>
                <div className="text-caption font-medium text-slate-500">
                    Credit Cards
                </div>

                <div className="mt-3 text-card-value leading-none tracking-[-0.02em] text-[#0F172A]">
                    {creditCards}
                </div>

                <div className="mt-4 text-small text-slate-400">
                    Active financial accounts
                </div>
            </div>

            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#F3E8FF] shadow-sm">
                <CreditCard size={20} className="text-[#7C3AED]" />
            </div>
        </div>

        <div className="absolute inset-x-5 bottom-2 flex items-center justify-end gap-2">
            <button
                type="button"
                onClick={() => setSelectedAccountFilter(AccountType.CREDIT_CARD)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
                <Eye size={14} />
            </button>

            <AddAccountDialog
                typeOptions={CREDIT_CARD_TYPE_OPTIONS}
                title="Add Credit Card Accounts"
                description="Add a credit card account."
                onSuccess={refresh}
                trigger={
                    <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                        title="Add credit card"
                        aria-label="Add credit card"
                    >
                        <Plus size={16} />
                    </button>
                }
            />
        </div>
    </div>
<div className="relative flex h-[156px] flex-col overflow-hidden rounded-3xl bg-white px-5 py-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
        <div className="flex items-start justify-between">
            <div>
                <div className="text-caption font-medium text-slate-500">
                    Investments
                </div>

                <div className="mt-3 text-card-value leading-none tracking-[-0.02em] text-[#0F172A]">
                    {investments}
                </div>

                <div className="mt-4 text-small text-slate-400">
                    Investment accounts
                </div>
            </div>

            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#EFF6FF] shadow-sm">
                <TrendingUp size={20} className="text-[#2563EB]" />
            </div>
        </div>

        <div className="absolute inset-x-5 bottom-2 flex items-center justify-end gap-2">
            <button
                type="button"
                onClick={() => setSelectedAccountFilter(AccountType.INVESTMENT)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
                <Eye size={14} />
            </button>

            <AddInvestmentDialog
                onSuccess={refresh}
                title="Add Investment Account"
                description="Add an investment account. It will appear in both Investments and Accounts."
                trigger={
                    <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                        title="Add investment account"
                        aria-label="Add investment account"
                    >
                        <Plus size={16} />
                    </button>
                }
            />
        </div>
    </div>
<div className="relative flex h-[156px] flex-col overflow-hidden rounded-3xl bg-white px-5 py-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
        <div className="flex items-start justify-between">
            <div>
                <div className="text-caption font-medium text-slate-500">
                    Loans
                </div>

                <div className="mt-3 text-card-value leading-none tracking-[-0.02em] text-[#0F172A]">
                    {totalLoans}
                </div>

                <div
                    className="mt-4 text-small text-slate-400"
                    title={
                        hasOtherLoanCurrencies
                            ? `Showing ${
                                  loanCurrencyCode ??
                                  "the primary currency"
                              } loans only - other currencies are excluded from this total to avoid mixing currencies.`
                            : undefined
                    }
                >
                    {formatMoney(outstandingLoanPrincipal)}{" "}
                    outstanding
                    {hasOtherLoanCurrencies && loanCurrencyCode
                        ? ` (${loanCurrencyCode})`
                        : ""}
                </div>
            </div>

            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#FEF3C7] shadow-sm">
                <HandCoins size={20} className="text-[#D97706]" />
            </div>
        </div>

        <div className="absolute inset-x-5 bottom-2 flex items-center justify-end gap-2">
            <button
                type="button"
                onClick={() => setSelectedAccountFilter(AccountType.LOAN)}
                title="View loan accounts"
                aria-label="View loan accounts"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
                <Eye size={14} />
            </button>

            <AddLoanDialog
                onSuccess={async () => {
                    await Promise.all([refresh(), refreshLoans()]);
                }}
                trigger={
                    <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                        title="Add loan"
                        aria-label="Add loan"
                    >
                        <Plus size={16} />
                    </button>
                }
            />
        </div>
    </div>

</section>


                <section className="rounded-[28px] border border-slate-100 bg-white p-7 shadow-sm transition-all duration-200">

                {selectedAccountFilter !== null && (
                    <div className="mb-5 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                        <div className="text-sm font-medium text-slate-600">
                            Showing filtered accounts
                        </div>

                        <button
                            type="button"
                            onClick={() => setSelectedAccountFilter(null)}
                            className="text-xs font-semibold text-slate-500 transition-colors hover:text-slate-900"
                        >
                            Show All
                        </button>
                    </div>
                )}

                    <div className="mb-6 flex items-start justify-between">

                        <div>
                            <h2 className="text-[22px] font-bold text-slate-900">
                                Accounts
                            </h2>

                            <p className="mt-1 text-[15px] text-slate-500">
                                All your financial accounts in one place.
                            </p>
                        </div>


                        <div
                            className="
                                flex
                                h-11
                                w-[315px]
                                items-center
                                rounded-2xl
                                border
                                border-slate-200
                                bg-slate-50
                                px-4
                                transition-all
                                duration-200
                                focus-within:border-slate-300
                                focus-within:bg-white
                                focus-within:shadow-sm
                            "
                        >
                            <input
                                type="search"
                                placeholder="Search accounts..."
                                value={searchQuery}
                                onChange={event =>
                                    setSearchQuery(event.target.value)
                                }
                                className="
                                    w-full
                                    bg-transparent
                                    text-sm
                                    text-slate-700
                                    outline-none
                                    placeholder:text-slate-400
                                "
                            />
                        </div>

                    </div>


                    {loading && (
                        <div className="flex min-h-[240px] items-center justify-center">
                            <p className="text-sm text-slate-400">
                                Loading accounts...
                            </p>
                        </div>
                    )}


                    {!loading && error && (
                        <div className="flex min-h-[240px] items-center justify-center">
                            <p className="text-sm text-red-500">
                                {error}
                            </p>
                        </div>
                    )}


                    {!loading &&
                        !error &&
                        accounts.length === 0 && (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12">
                                <EmptyState
                                    title="No accounts yet"
                                    description="Add your first bank account, credit card, wallet or investment account to start managing your finances."
                                />
                            </div>
                        )}


                    {!loading &&
                        !error &&
                        accounts.length > 0 && (
                            <div
                                className="
                                    overflow-hidden
                                    rounded-2xl
                                    border
                                    border-slate-100
                                    [&_tbody_tr]:transition-colors
                                    [&_tbody_tr:hover]:bg-slate-50
                                "
                            >
                                <AccountTable
                                accounts={filteredAccounts}
                                balances={accountBalances}
                                onView={handleViewAccount}
                                onEdit={handleEditAccount}
                                onDelete={handleDeleteAccount}
                                isUnlinkedLoanAccount={account =>
                                    isUnlinkedLoanAccount(
                                        account,
                                        loanByAccountId
                                    )
                                }
                            />
                            </div>
                        )}

                </section>

            </div>

                <ViewAccountDialog
                account={viewingAccount}
                balance={
                    viewingAccount
                        ? accountBalances.get(viewingAccount.id)
                        : undefined
                }
                open={viewingAccount !== null}
                onOpenChange={open => {
                    if (!open) {
                        setViewingAccount(null);
                    }
                }}
            />

            <EditAccountDialog
                account={editingAccount}
                open={editingAccount !== null}
                onOpenChange={open => {
                    if (!open) {
                        setEditingAccount(null);
                    }
                }}
                onSuccess={async () => {
                    setEditingAccount(null);
                    await refresh();
                }}
            />
            <AlertDialog
            open={deletingAccount !== null}
            onOpenChange={open => {
                if (!open && !deleting) {
                    setDeletingAccount(null);
                }
            }}
        >
            <AlertDialogContent
    className="max-w-md gap-0 overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-xl ring-0"
>
    <AlertDialogHeader className="px-6 pt-6 pb-5">
        <AlertDialogTitle className="text-base font-semibold text-slate-900">
            Delete Account?
        </AlertDialogTitle>

        <AlertDialogDescription className="mt-2 text-sm leading-6 text-slate-500">
            Are you sure you want to delete
            <span className="font-medium text-slate-800">
                {" "}{deletingAccount?.name}
            </span>
            ?
            <br />
            This action cannot be undone.
        </AlertDialogDescription>
    </AlertDialogHeader>

    <AlertDialogFooter className="border-0 bg-slate-50 px-6 py-4">
        <AlertDialogCancel
            disabled={deleting}
            className="h-9 rounded-lg border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900"
        >
            Cancel
        </AlertDialogCancel>

        <AlertDialogAction
            disabled={deleting}
            onClick={confirmDeleteAccount}
            className="h-9 rounded-lg bg-red-600 px-4 text-sm font-medium text-white shadow-none hover:bg-red-700"
        >
            {deleting ? "Deleting..." : "Delete Account"}
        </AlertDialogAction>
    </AlertDialogFooter>
</AlertDialogContent>
        </AlertDialog>

        <EditLoanDialog
            loan={editingLoan}
            open={editingLoan !== null}
            onOpenChange={open => {
                if (!open) {
                    setEditingLoan(null);
                }
            }}
            onSuccess={async () => {
                setEditingLoan(null);
                await Promise.all([refresh(), refreshLoans()]);
            }}
        />

        <EMIScheduleDialog
            loan={viewingLoan}
            open={viewingLoan !== null}
            onOpenChange={open => {
                if (!open) {
                    setViewingLoan(null);
                }
            }}
            onSuccess={async () => {
                await Promise.all([refresh(), refreshLoans()]);
            }}
        />

        <AlertDialog
            open={deletingLoan !== null}
            onOpenChange={open => {
                if (!open && !deletingLoanBusy) {
                    setDeletingLoan(null);
                }
            }}
        >
            <AlertDialogContent
                className="max-w-md gap-0 overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-xl ring-0"
            >
                <AlertDialogHeader className="px-6 pt-6 pb-5">
                    <AlertDialogTitle className="text-base font-semibold text-slate-900">
                        Delete Loan?
                    </AlertDialogTitle>

                    <AlertDialogDescription className="mt-2 text-sm leading-6 text-slate-500">
                        Are you sure you want to delete
                        <span className="font-medium text-slate-800">
                            {" "}{deletingLoan?.name}
                        </span>
                        ? It will be permanently removed from your Loans
                        records. This action cannot be undone.
                        <br />
                        <br />
                        If this loan has any recorded EMI payments, every
                        one of them must be reversed from the loan&apos;s
                        EMI schedule first - deletion is blocked while any
                        payment history remains.
                        <br />
                        <br />
                        Linked bank transactions are never deleted by this
                        action.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter className="border-0 bg-slate-50 px-6 py-4">
                    <AlertDialogCancel
                        disabled={deletingLoanBusy}
                        className="h-9 rounded-lg border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-900"
                    >
                        Cancel
                    </AlertDialogCancel>

                    <AlertDialogAction
                        disabled={deletingLoanBusy}
                        onClick={confirmDeleteLoan}
                        className="h-9 rounded-lg bg-red-600 px-4 text-sm font-medium text-white shadow-none hover:bg-red-700"
                    >
                        {deletingLoanBusy ? "Deleting..." : "Delete Loan"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
</div>
    );
}

