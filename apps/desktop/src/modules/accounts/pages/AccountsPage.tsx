import { useMoneyFormatter } from "@/core/formatting";
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
import {
    AddLoanDialog,
    EditLoanDialog,
    EMIScheduleDialog,
} from "@/modules/loans/components";
import { LoanService } from "@/modules/loans/services";
import type { Loan } from "@/modules/loans/types";

import {
    BANK_ACCOUNT_TYPE_OPTIONS,
    CREDIT_CARD_TYPE_OPTIONS,
} from "../constants";
import { useAccounts } from "../hooks";
import { useLoans } from "@/modules/loans/hooks";
import { AccountService } from "../services";
import { Account } from "../types";
import { AccountType } from "../types/AccountType";
export default function AccountsPage() {
    const formatMoney = useMoneyFormatter();

    const {
        accounts,
        loading,
        error,
        refresh,
    } = useAccounts();
    const { loans, refresh: refreshLoans } = useLoans();
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
            toast.error("Unable to delete the loan. Please try again.");
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
            toast.error("Unable to delete the account. Please try again.");
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

const outstandingLoanPrincipal = loans.reduce(
    (total, loan) => total + Number(loan.outstandingPrincipal ?? 0),
    0
);


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
                : total + Number(account.openingBalance ?? 0),
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

                <div className="mt-4 text-small text-slate-400">
                    {formatMoney(outstandingLoanPrincipal)} outstanding
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
                                onView={handleViewAccount}
                                onEdit={handleEditAccount}
                                onDelete={handleDeleteAccount}
                            />
                            </div>
                        )}

                </section>

            </div>

                <ViewAccountDialog
                account={viewingAccount}
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
                        ?
                        <br />
                        This removes the loan, its EMI schedule and its
                        Accounts entry. This action cannot be undone.
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

