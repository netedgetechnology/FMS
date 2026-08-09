import { useState } from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

import { AccountForm } from "./AccountForm";
import { AccountService } from "../services";
import { AccountFormValues } from "../validation";

export interface AddAccountDialogProps {
    onSuccess?: () => Promise<void> | void;
}

export function AddAccountDialog({
    onSuccess,
}: AddAccountDialogProps) {

    const service = new AccountService();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(values: AccountFormValues) {
        try {
            setLoading(true);

            await service.create(values);
            await onSuccess?.();

            setOpen(false);
        } finally {
            setLoading(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={setOpen}
        >
            <DialogTrigger className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md active:scale-[0.98]">
                Add Account
            </DialogTrigger>

            <DialogContent
                showCloseButton
                className="
                    w-[780px]
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
                <DialogHeader className="px-7 pb-4 pt-5">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Add Account
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Add a bank account, credit card, wallet or investment account.
                    </DialogDescription>
                </DialogHeader>

                <div className="border-t border-slate-100 px-7 py-4">
                    <AccountForm
                        loading={loading}
                        submitLabel="Create Account"
                        onSubmit={handleSubmit}
                        onCancel={() => setOpen(false)}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}


