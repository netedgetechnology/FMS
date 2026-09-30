import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import { CATEGORY_TYPE_OPTIONS } from "../constants";
import { CategoryService } from "../services";
import { Category } from "../types";
import {
    filterScopeCategories,
    financeScopeFlags,
    initialScopeDrafts,
    runSaveCategoryScopes,
    scopeChanges,
    scopeManagedCategories,
    ScopeDrafts,
    ScopeKey,
    toggleScopeDraft,
    ZERO_SCOPE_MESSAGE,
    zeroScopeIds,
} from "../utils";

// The Scopes screen - the only place a category's Personal / Business
// scope is managed. See utils/categoryScopes.ts for the rules.

interface CategoryScopesDialogProps {
    /** The page's loaded (non-deleted) categories. */
    categories: Category[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
}

const TYPE_FILTER_LABEL: Record<string, string> = {
    ALL: "All Types",
    ...Object.fromEntries(
        CATEGORY_TYPE_OPTIONS.map(option => [option.value, option.label])
    ),
};

const SCOPE_FILTER_LABEL: Record<string, string> = {
    ALL: "All Scopes",
    PERSONAL: "Personal",
    BUSINESS: "Business",
};

const SCOPE_COLUMNS: { key: ScopeKey; label: string }[] = [
    { key: "personal", label: "Personal" },
    { key: "business", label: "Business" },
];

export function CategoryScopesDialog({
    categories,
    open,
    onOpenChange,
    onSuccess,
}: CategoryScopesDialogProps) {
    const managed = useMemo(
        () => scopeManagedCategories(categories),
        [categories]
    );

    const [drafts, setDrafts] = useState<ScopeDrafts>({});
    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState("ALL");
    const [scopeFilter, setScopeFilter] = useState("ALL");
    const [saving, setSaving] = useState(false);

    // Blocks a second click before the disabled state has rendered.
    const inFlight = useRef(false);

    // Each time the screen opens: start from the saved scopes, no
    // filters. (Closing without saving just drops the drafts.)
    useEffect(() => {
        if (open) {
            setDrafts(initialScopeDrafts(managed));
            setSearch("");
            setTypeFilter("ALL");
            setScopeFilter("ALL");
        }
        // Only on open - a background refresh must not wipe edits.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const visible = filterScopeCategories(managed, {
        search,
        typeFilter,
        scopeFilter,
    });

    const changes = scopeChanges(managed, drafts);
    const changedIds = new Set(changes.map(change => change.id));
    const zeroIds = new Set(zeroScopeIds(drafts));

    function close() {
        if (!saving) {
            onOpenChange(false);
        }
    }

    async function handleSave() {
        if (
            changes.length === 0 ||
            zeroIds.size > 0 ||
            inFlight.current
        ) {
            return;
        }

        inFlight.current = true;

        try {
            setSaving(true);

            const outcome = await runSaveCategoryScopes(
                new CategoryService(),
                changes,
                toast
            );

            if (outcome.saved) {
                await onSuccess?.();
                onOpenChange(false);
            }
        } finally {
            inFlight.current = false;
            setSaving(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={nextOpen => {
                if (!nextOpen) {
                    close();
                }
            }}
        >
            <DialogContent
                showCloseButton={!saving}
                className="
                    flex
                    w-[760px]
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
                        Category Scopes
                    </DialogTitle>

                    <DialogDescription className="mt-1 text-sm text-slate-500">
                        Choose where each category is available: Personal,
                        Business, or both. Every category needs at least
                        one. Nothing is saved until you click Save Changes.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex shrink-0 flex-col gap-3 border-t border-slate-100 px-7 py-4 sm:flex-row sm:items-center">
                    <div className="relative min-w-0 flex-1">
                        <Search
                            size={16}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                        />

                        <Input
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                            placeholder="Search categories..."
                            aria-label="Search categories"
                            className="pl-9"
                        />
                    </div>

                    <Select
                        value={typeFilter}
                        onValueChange={value => setTypeFilter(value ?? "ALL")}
                    >
                        <SelectTrigger className="w-full sm:w-[150px]">
                            <SelectValue placeholder="Type">
                                {TYPE_FILTER_LABEL[typeFilter] ?? "All Types"}
                            </SelectValue>
                        </SelectTrigger>

                        <SelectContent>
                            {Object.entries(TYPE_FILTER_LABEL).map(
                                ([value, label]) => (
                                    <SelectItem key={value} value={value}>
                                        {label}
                                    </SelectItem>
                                )
                            )}
                        </SelectContent>
                    </Select>

                    <Select
                        value={scopeFilter}
                        onValueChange={value => setScopeFilter(value ?? "ALL")}
                    >
                        <SelectTrigger className="w-full sm:w-[150px]">
                            <SelectValue placeholder="Scope">
                                {SCOPE_FILTER_LABEL[scopeFilter] ?? "All Scopes"}
                            </SelectValue>
                        </SelectTrigger>

                        <SelectContent>
                            {Object.entries(SCOPE_FILTER_LABEL).map(
                                ([value, label]) => (
                                    <SelectItem key={value} value={value}>
                                        {label}
                                    </SelectItem>
                                )
                            )}
                        </SelectContent>
                    </Select>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100">
                    {visible.length === 0 ? (
                        <div className="px-4 py-12 text-center text-sm text-slate-500">
                            {managed.length === 0
                                ? "No active categories."
                                : "No categories match your search."}
                        </div>
                    ) : (
                        <CategoryScopesTable
                            categories={visible}
                            drafts={drafts}
                            changedIds={changedIds}
                            zeroIds={zeroIds}
                            disabled={saving}
                            onToggle={(id, key) =>
                                setDrafts(previous =>
                                    toggleScopeDraft(previous, id, key)
                                )
                            }
                        />
                    )}
                </div>

                <div className="flex shrink-0 flex-col gap-3 border-t border-slate-100 px-7 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-slate-500">
                        {zeroIds.size > 0 ? (
                            <span className="text-red-600">
                                {zeroIds.size}{" "}
                                {zeroIds.size === 1 ? "category has" : "categories have"}{" "}
                                no scope. Tick Personal or Business to save.
                            </span>
                        ) : changes.length > 0 ? (
                            `${changes.length} ${
                                changes.length === 1 ? "category" : "categories"
                            } changed`
                        ) : (
                            "No changes"
                        )}
                    </div>

                    <div className="flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={close}
                            disabled={saving}
                            className="h-9 rounded-lg border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
                        >
                            Cancel
                        </button>

                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={
                                saving ||
                                changes.length === 0 ||
                                zeroIds.size > 0
                            }
                            className="h-9 cursor-pointer rounded-lg bg-slate-900 px-5 text-sm font-medium text-white shadow-sm transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving ? "Saving..." : "Save Changes"}
                        </button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// The Category Name | Personal | Business table. Each checkbox sits
// inside its <label>, so clicking the box or the word toggles it.
export function CategoryScopesTable({
    categories,
    drafts,
    changedIds,
    zeroIds,
    disabled = false,
    onToggle,
}: {
    categories: readonly Category[];
    drafts: ScopeDrafts;
    changedIds: ReadonlySet<string>;
    zeroIds: ReadonlySet<string>;
    disabled?: boolean;
    onToggle: (id: string, key: ScopeKey) => void;
}) {
    const headClass =
        "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500";

    return (
        <table className="w-full text-left">
            <thead className="sticky top-0 z-10 bg-white">
                <tr className="border-b border-slate-100">
                    <th className={`${headClass} pl-7`}>
                        Category Name
                    </th>
                    {SCOPE_COLUMNS.map(column => (
                        <th
                            key={column.key}
                            className={`${headClass} w-[140px]`}
                        >
                            {column.label}
                        </th>
                    ))}
                </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
                {categories.map(category => {
                    // Saved scope until the drafts are set.
                    const flags =
                        drafts[category.id] ??
                        financeScopeFlags(category.financeScope);
                    const hasNoScope = zeroIds.has(category.id);

                    return (
                        <tr
                            key={category.id}
                            data-category-id={category.id}
                            className={
                                hasNoScope
                                    ? "bg-red-50/60"
                                    : "transition-colors hover:bg-slate-50/70"
                            }
                        >
                            <td className="px-4 py-2.5 pl-7">
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                                    {category.name}

                                    {changedIds.has(category.id) && (
                                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                            Changed
                                        </span>
                                    )}
                                </div>

                                {hasNoScope && (
                                    <div
                                        role="alert"
                                        className="mt-0.5 text-xs text-red-600"
                                    >
                                        {ZERO_SCOPE_MESSAGE}
                                    </div>
                                )}
                            </td>

                            {SCOPE_COLUMNS.map(column => (
                                <td
                                    key={column.key}
                                    className="px-4 py-2.5"
                                >
                                    {/* The whole label - box and
                                        text - toggles it. */}
                                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                                        <Checkbox
                                            checked={flags[column.key]}
                                            disabled={disabled}
                                            onCheckedChange={() =>
                                                onToggle(category.id, column.key)
                                            }
                                            aria-label={`${column.label} - ${category.name}`}
                                            className="border border-slate-400 bg-white"
                                        />
                                        {column.label}
                                    </label>
                                </td>
                            ))}
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}
