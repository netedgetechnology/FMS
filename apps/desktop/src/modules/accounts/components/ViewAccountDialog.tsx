import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { Account } from "../types";

interface ViewAccountDialogProps {
    account: Account | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function formatType(type: string): string {
    return type
        .toLowerCase()
        .replace("_", " ")
        .replace(/\b\w/g, char => char.toUpperCase());
}

function formatCurrency(amount: number, currency: string): string {
    try {
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency,
            maximumFractionDigits: 2,
        }).format(amount);
    } catch {
        return `${currency} ${amount.toFixed(2)}`;
    }
}

function Detail({
    label,
    value,
}: {
    label: string;
    value?: string | null;
}) {
    return (
        <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-slate-400">
                {label}
            </div>
            <div className="mt-1 text-sm font-medium text-slate-700">
                {value || "—"}
            </div>
        </div>
    );
}

export function ViewAccountDialog({
    account,
    open,
    onOpenChange,
}: ViewAccountDialogProps) {
    if (!account) {
        return null;
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton
                className="
                    w-[680px]
                    max-w-[calc(100vw-48px)]
                    gap-0
                    overflow-hidden
                    rounded-[28px]
                    border border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="px-7 pb-5 pt-6">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        {account.name}
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Account details
                    </DialogDescription>
                </DialogHeader>

                <div className="border-t border-slate-100 px-7 py-6">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                        <Detail
                            label="Account Type"
                            value={formatType(account.type)}
                        />

                        <Detail
                            label="Institution"
                            value={account.institutionName}
                        />

                        <Detail
                            label="Currency"
                            value={account.currencyId}
                        />

                        <Detail
                            label="Balance"
                            value={formatCurrency(
                                Number(account.openingBalance ?? 0),
                                account.currencyId
                            )}
                        />

                        <Detail
                            label="Account Number"
                            value={account.accountNumber || null}
                        />

                        <Detail
                            label="Status"
                            value={account.isActive ? "Active" : "Inactive"}
                        />

                        <Detail
                            label="Branch"
                            value={account.branchName}
                        />

                        <Detail
                            label="IFSC"
                            value={account.ifscCode}
                        />

                        <Detail
                            label="SWIFT"
                            value={account.swiftCode}
                        />

                        <Detail
                            label="IBAN"
                            value={account.iban}
                        />
                    </div>

                    {account.description && (
                        <div className="mt-6 border-t border-slate-100 pt-5">
                            <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-slate-400">
                                Description
                            </div>

                            <p className="mt-1.5 text-sm leading-6 text-slate-600">
                                {account.description}
                            </p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}



