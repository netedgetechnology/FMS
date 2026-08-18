import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import {
    BusinessEntity,
} from "../types";

export interface ViewBusinessEntityDialogProps {
    entity: BusinessEntity | null;

    open: boolean;

    onOpenChange(
        open: boolean
    ): void;
}

export function ViewBusinessEntityDialog({
    entity,
    open,
    onOpenChange,
}: ViewBusinessEntityDialogProps) {
    if (!entity) {
        return null;
    }

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
        >
            <DialogContent
                showCloseButton
                className="
                    w-[620px]
                    max-w-[calc(100vw-48px)]
                    rounded-[28px]
                    border
                    border-slate-100
                    bg-white
                    p-0
                    shadow-lg
                "
            >
                <DialogHeader className="px-7 pb-5 pt-6">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                        Business Entity Details
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        View the details of this business entity.
                    </DialogDescription>
                </DialogHeader>

                <div className="border-t border-slate-100 px-7 py-6">
                    <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">

                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                Business Entity
                            </div>

                            <div className="mt-1.5 text-sm font-medium text-slate-800">
                                {entity.name}
                            </div>
                        </div>

                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                Status
                            </div>

                            <div className="mt-1.5">
                                <span
                                    className={
                                        entity.isActive
                                            ? "inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                                            : "inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500"
                                    }
                                >
                                    {entity.isActive
                                        ? "Active"
                                        : "Inactive"}
                                </span>
                            </div>
                        </div>

                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                Legal Name
                            </div>

                            <div className="mt-1.5 text-sm text-slate-700">
                                {entity.legalName || "—"}
                            </div>
                        </div>

                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                Tax Identifier
                            </div>

                            <div className="mt-1.5 text-sm text-slate-700">
                                {entity.taxIdentifier || "—"}
                            </div>
                        </div>

                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                Currency
                            </div>

                            <div className="mt-1.5 text-sm text-slate-700">
                                {entity.currencyId}
                            </div>
                        </div>

                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                Entity ID
                            </div>

                            <div className="mt-1.5 break-all text-xs text-slate-500">
                                {entity.id}
                            </div>
                        </div>

                        <div className="sm:col-span-2">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                                Description
                            </div>

                            <div className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                                {entity.description || "—"}
                            </div>
                        </div>

                    </div>
                </div>

                <div className="border-t border-slate-100 px-7 py-4">
                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={() =>
                                onOpenChange(false)
                            }
                            className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
