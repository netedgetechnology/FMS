import { useEffect, useState } from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { AccountForm } from "./AccountForm";
import { AccountService } from "../services";
import { AccountFormValues } from "../validation";
import { Account } from "../types";

interface EditAccountDialogProps {
    account: Account | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

export function EditAccountDialog({
    account,
    open,
    onOpenChange,
    onSuccess,
}: EditAccountDialogProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setError(null);
        }
    }, [open, account?.id]);

    if (!account) {
        return null;
    }

    async function handleSubmit(values: AccountFormValues) {
        const currentAccount = account;

        if (!currentAccount) {
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const service = new AccountService();

            await service.update({
                id: currentAccount.id,
                name: values.name,
                type: values.type,
                institutionId: currentAccount.institutionId,
                institutionName: values.institutionName,
                businessEntityId: values.businessEntityId,
                currencyId: values.currencyId,
                openingBalance: values.openingBalance,
                accountNumber: values.accountNumber,
                branchName: values.branchName,
                ifscCode: values.ifscCode,
                swiftCode: values.swiftCode,
                iban: values.iban,
                description: values.description,
                isActive: values.isActive,
            });

            await onSuccess?.();

            onOpenChange(false);
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : "Unable to update account.";

            console.error("Failed to update account:", err);
            setError(message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
        >
            <DialogContent
                showCloseButton
                className="
                    flex
                    w-[780px]
                    max-w-[calc(100vw-48px)]
                    max-h-[calc(100vh-48px)]
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
                <DialogHeader className="shrink-0 px-7 pb-4 pt-5">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Edit Account
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Update your account details.
                    </DialogDescription>
                </DialogHeader>

                {error && (
                    <div className="mx-7 mb-3 shrink-0 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                        {error}
                    </div>
                )}

                <div className="relative z-10 min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-7 py-4">
                    <AccountForm
                        key={account.id}
                        defaultValues={{
                            name: account.name,
                            type: account.type,
                            institutionName: account.institutionName ?? "",
                            businessEntityId: account.businessEntityId ?? "",
                            currencyId: account.currencyId,
                            openingBalance: account.openingBalance,
                            accountNumber: account.accountNumber ?? "",
                            branchName: account.branchName ?? "",
                            ifscCode: account.ifscCode ?? "",
                            swiftCode: account.swiftCode ?? "",
                            iban: account.iban ?? "",
                            description: account.description ?? "",
                            isActive: account.isActive,
                        }}
                        loading={loading}
                        submitLabel="Save Changes"
                        onSubmit={handleSubmit}
                        onCancel={() => onOpenChange(false)}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}


