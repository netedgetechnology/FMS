import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { Category } from "../types";

interface ViewCategoryDialogProps {
    category: Category | null;
    categories: Category[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function formatType(value: string): string {
    return value
        .toLowerCase()
        .replace("_", " ")
        .replace(/\b\w/g, char => char.toUpperCase());
}

function Detail({
    label,
    value,
}: {
    label: string;
    value?: string | null;
}) {
    return (
        <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-slate-400">
                {label}
            </div>

            <div className="mt-1.5 break-words text-sm font-medium text-slate-800">
                {value || "—"}
            </div>
        </div>
    );
}

export function ViewCategoryDialog({
    category,
    categories,
    open,
    onOpenChange,
}: ViewCategoryDialogProps) {
    if (!category) {
        return null;
    }

    const parent = category.parentId
        ? categories.find(item => item.id === category.parentId)
        : null;

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
                    border-0
                    bg-white
                    p-0
                    shadow-xl
                    ring-0
                "
            >
                <DialogHeader className="px-7 pb-5 pt-6">
                    <div className="pr-8">
                        <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                            {category.name}
                        </DialogTitle>

                        <DialogDescription className="mt-1.5 text-sm text-slate-500">
                            Category details and information
                        </DialogDescription>
                    </div>
                </DialogHeader>

                <div className="space-y-5 bg-white px-7 pb-7">
                    <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-2xl bg-slate-50 px-5 py-4">
                            <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-slate-400">
                                Type
                            </div>

                            <div className="mt-2 text-sm font-semibold text-slate-900">
                                {formatType(category.categoryType)}
                            </div>
                        </div>

                        <div className="rounded-2xl bg-slate-50 px-5 py-4">
                            <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-slate-400">
                                Scope
                            </div>

                            <div className="mt-2 text-sm font-semibold text-slate-900">
                                {category.financeScope === "PERSONAL"
                                    ? "Personal"
                                    : "Business"}
                            </div>
                        </div>

                        <div className="rounded-2xl bg-slate-50 px-5 py-4">
                            <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-slate-400">
                                Status
                            </div>

                            <div className="mt-2">
                                <span
                                    className={
                                        category.isActive
                                            ? "inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                                            : "inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
                                    }
                                >
                                    {category.isActive
                                        ? "Active"
                                        : "Inactive"}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-slate-100 bg-white p-5">
                        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                            <Detail
                                label="Parent Category"
                                value={parent?.name}
                            />

                            <Detail
                                label="Business Entity"
                                value={category.businessEntityId}
                            />

                            <Detail
                                label="Created"
                                value={category.createdAt}
                            />

                            <Detail
                                label="Updated"
                                value={category.updatedAt}
                            />
                        </div>
                    </div>

                    {category.description && (
                        <div className="border-t border-slate-100 pt-5">
                            <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-slate-400">
                                Description
                            </div>

                            <p className="mt-2 text-sm leading-6 text-slate-600">
                                {category.description}
                            </p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
