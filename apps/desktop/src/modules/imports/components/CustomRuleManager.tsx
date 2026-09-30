import { useMemo, useState, type ReactNode } from "react";
import { Pencil, Plus, Search, Trash2, Wand2 } from "lucide-react";

import type {
    NormalizedTransactionCandidate,
    TransactionChannel,
} from "@financeos/import-engine";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Account } from "@/modules/accounts/types";
import type { Category } from "@/modules/categories/types";

import { TRANSACTION_CHANNEL_OPTIONS } from "../pages/ImportPreviewRow";
import { countCustomRuleMatches } from "../services/customImportRules";
import type {
    CreateCustomImportRuleInput,
    CustomImportRule,
} from "../types";

// ---------------------------------------------------------------------
// The one Custom Import Rules management UI: list, search, add, edit and
// delete. Used by the permanent Import Rules page (every account) and by
// the Import Preview wand dialog (scoped to the preview's account).
//
// A rule: "original Description contains KEYWORD -> set Payee / Notes /
// Category / Type" for imports into one account. Only the fields filled
// in are set; the rest keep flowing through Self-Learning. Adding,
// editing or deleting a rule never changes existing transactions or
// automatic self-learned rules.
// ---------------------------------------------------------------------

type AccountOption = Pick<Account, "id" | "name">;

export interface CustomRuleFormValues {
    accountId: string;
    keyword: string;
    payee: string;
    notes: string;
    categoryId: string;
    transactionType: TransactionChannel | "";
}

export const EMPTY_CUSTOM_RULE_FORM: CustomRuleFormValues = {
    accountId: "",
    keyword: "",
    payee: "",
    notes: "",
    categoryId: "",
    transactionType: "",
};

export function customRuleFormFromRule(
    rule: CustomImportRule
): CustomRuleFormValues {
    return {
        accountId: rule.accountId,
        keyword: rule.keyword,
        payee: rule.payee ?? "",
        notes: rule.notes ?? "",
        categoryId: rule.categoryId ?? "",
        transactionType: (rule.transactionType ?? "") as
            | TransactionChannel
            | "",
    };
}

export function customRuleInputFromForm(
    form: CustomRuleFormValues
): CreateCustomImportRuleInput {
    return {
        accountId: form.accountId,
        keyword: form.keyword,
        payee: form.payee || null,
        notes: form.notes || null,
        categoryId: form.categoryId || null,
        transactionType: form.transactionType || null,
    };
}

// Same rules as ImportService's validation, checked before saving so the
// button can be disabled.
export function canSaveCustomRuleForm(form: CustomRuleFormValues): boolean {
    return (
        form.accountId !== "" &&
        form.keyword.trim() !== "" &&
        (form.payee.trim() !== "" ||
            form.notes.trim() !== "" ||
            form.categoryId !== "" ||
            form.transactionType !== "")
    );
}

export function customRuleTypeLabel(value: string | null): string | null {
    if (!value) {
        return null;
    }

    return (
        TRANSACTION_CHANNEL_OPTIONS.find(option => option.value === value)
            ?.label ?? value
    );
}

export interface CustomRuleDisplay {
    keyword: string;
    account: string;
    payee: string | null;
    category: string | null;
    type: string | null;
    notes: string | null;
}

// What a rule looks like to the user - names, never raw ids/codes.
export function describeCustomRule(
    rule: CustomImportRule,
    accounts: readonly AccountOption[],
    categories: readonly Pick<Category, "id" | "name">[]
): CustomRuleDisplay {
    return {
        keyword: rule.keyword,
        account:
            accounts.find(account => account.id === rule.accountId)?.name ??
            "(unavailable account)",
        payee: rule.payee,
        category: rule.categoryId
            ? categories.find(category => category.id === rule.categoryId)
                  ?.name ?? "(unavailable category)"
            : null,
        type: customRuleTypeLabel(rule.transactionType),
        notes: rule.notes,
    };
}

// Search matches any shown value (keyword, account, payee, category,
// type, notes); the account filter keeps one account's rules.
export function filterCustomRules(
    rules: readonly CustomImportRule[],
    filter: { search: string; accountId: string },
    accounts: readonly AccountOption[],
    categories: readonly Pick<Category, "id" | "name">[]
): CustomImportRule[] {
    const needle = filter.search.trim().toLowerCase();

    return rules.filter(rule => {
        if (filter.accountId && rule.accountId !== filter.accountId) {
            return false;
        }

        if (!needle) {
            return true;
        }

        const shown = describeCustomRule(rule, accounts, categories);

        return Object.values(shown).some(
            value => value !== null && value.toLowerCase().includes(needle)
        );
    });
}

// SQLite CURRENT_TIMESTAMP is UTC without a zone ("2026-09-28 10:15:00").
export function parseRuleTimestamp(value: string): Date | string {
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
        ? new Date(`${value.replace(" ", "T")}Z`)
        : value;
}

export interface CustomRuleManagerProps {
    rules: readonly CustomImportRule[];
    accounts: readonly AccountOption[];
    categories: readonly Category[];
    formatDate: (value: string | Date | null | undefined) => string;
    // Import Preview: only this account's rules, and new rules are for
    // it. Null there means no account is selected yet. Leave undefined
    // for every account (Import Rules page).
    scopeAccountId?: string | null;
    // Active preview only: rule id -> rows it applies to, and the rows
    // (original Descriptions) for the form's live "matches N rows".
    appliedCountByRule?: ReadonlyMap<string, number>;
    previewCandidates?: readonly Pick<
        NormalizedTransactionCandidate,
        "description"
    >[];
    loading?: boolean;
    loadError?: string | null;
    // Title/description shown left of the Add Import Rule button.
    header?: ReactNode;
    onCreate: (input: CreateCustomImportRuleInput) => Promise<void>;
    onUpdate: (
        id: string,
        input: CreateCustomImportRuleInput
    ) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}

type Editor = { mode: "create" } | { mode: "edit"; rule: CustomImportRule };

const FIELD_CLASS =
    "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-800 outline-none transition focus:border-slate-400 disabled:bg-slate-50 disabled:text-slate-500";

const LABEL_CLASS = "mb-1 block text-xs font-medium text-slate-600";

export function CustomRuleManager({
    rules,
    accounts,
    categories,
    formatDate,
    scopeAccountId,
    appliedCountByRule,
    previewCandidates,
    loading = false,
    loadError = null,
    header,
    onCreate,
    onUpdate,
    onDelete,
}: CustomRuleManagerProps) {
    const scoped = scopeAccountId !== undefined;

    const [search, setSearch] = useState("");
    const [accountFilter, setAccountFilter] = useState("");
    const [editor, setEditor] = useState<Editor | null>(null);
    const [form, setForm] = useState(EMPTY_CUSTOM_RULE_FORM);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] =
        useState<CustomImportRule | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const accountOptions = useMemo(
        () =>
            accounts
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name)),
        [accounts]
    );

    const categoryOptions = useMemo(
        () =>
            categories
                .filter(category => category.isActive)
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name)),
        [categories]
    );

    const scopedRules = useMemo(
        () =>
            scoped
                ? rules.filter(rule => rule.accountId === scopeAccountId)
                : rules,
        [rules, scoped, scopeAccountId]
    );

    const visibleRules = useMemo(
        () =>
            filterCustomRules(
                scopedRules,
                { search, accountId: scoped ? "" : accountFilter },
                accounts,
                categories
            ),
        [scopedRules, search, scoped, accountFilter, accounts, categories]
    );

    const matchCount = useMemo(
        () =>
            previewCandidates
                ? countCustomRuleMatches(previewCandidates, form.keyword)
                : 0,
        [previewCandidates, form.keyword]
    );

    const canAdd = scoped ? Boolean(scopeAccountId) : accounts.length > 0;
    const canSave = !saving && canSaveCustomRuleForm(form);
    const showPreviewCounts = appliedCountByRule !== undefined;

    const openCreate = () => {
        setEditor({ mode: "create" });
        setForm({
            ...EMPTY_CUSTOM_RULE_FORM,
            accountId: scoped
                ? scopeAccountId ?? ""
                : accountFilter ||
                  (accountOptions.length === 1 ? accountOptions[0]!.id : ""),
        });
        setFormError(null);
    };

    const openEdit = (rule: CustomImportRule) => {
        setEditor({ mode: "edit", rule });
        setForm(customRuleFormFromRule(rule));
        setFormError(null);
    };

    const closeEditor = () => {
        setEditor(null);
        setForm(EMPTY_CUSTOM_RULE_FORM);
        setFormError(null);
    };

    const handleSave = async () => {
        if (!editor || !canSave) {
            return;
        }

        try {
            setSaving(true);
            setFormError(null);

            const input = customRuleInputFromForm(form);

            if (editor.mode === "edit") {
                await onUpdate(editor.rule.id, input);
            } else {
                await onCreate(input);
            }

            closeEditor();
        } catch (err) {
            setFormError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    const handleConfirmDelete = async () => {
        if (!pendingDelete) {
            return;
        }

        try {
            setDeleting(true);
            setDeleteError(null);

            await onDelete(pendingDelete.id);

            if (
                editor?.mode === "edit" &&
                editor.rule.id === pendingDelete.id
            ) {
                closeEditor();
            }

            setPendingDelete(null);
        } catch (err) {
            setDeleteError(err instanceof Error ? err.message : String(err));
        } finally {
            setDeleting(false);
        }
    };

    const setField = <K extends keyof CustomRuleFormValues>(
        key: K,
        value: CustomRuleFormValues[K]
    ) => setForm(previous => ({ ...previous, [key]: value }));

    return (
        <div data-testid="custom-rule-manager" className="space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">{header}</div>

                <button
                    type="button"
                    onClick={openCreate}
                    disabled={!canAdd || saving}
                    data-testid="add-import-rule"
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Plus size={16} />
                    Add Import Rule
                </button>
            </div>

            {editor && (
                <form
                    data-testid="import-rule-form"
                    onSubmit={event => {
                        event.preventDefault();
                        void handleSave();
                    }}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                    <h3 className="text-sm font-semibold text-slate-900">
                        {editor.mode === "edit"
                            ? "Edit Import Rule"
                            : "Add Import Rule"}
                    </h3>

                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label>
                            <span className={LABEL_CLASS}>Account</span>
                            <select
                                value={form.accountId}
                                onChange={event =>
                                    setField("accountId", event.target.value)
                                }
                                aria-label="Account"
                                disabled={saving || scoped}
                                className={FIELD_CLASS}
                            >
                                <option value="">Select an account</option>
                                {accountOptions.map(account => (
                                    <option key={account.id} value={account.id}>
                                        {account.name}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label>
                            <span className={LABEL_CLASS}>
                                Keyword (Description contains)
                            </span>
                            <input
                                type="text"
                                value={form.keyword}
                                onChange={event =>
                                    setField("keyword", event.target.value)
                                }
                                placeholder="e.g. LAP DOD INT"
                                aria-label="Keyword"
                                disabled={saving}
                                className={FIELD_CLASS}
                            />
                            <span
                                data-testid="custom-rule-match-count"
                                className="mt-1 block text-xs text-slate-500"
                            >
                                {previewCandidates && form.keyword.trim()
                                    ? `Matches ${matchCount} row${matchCount === 1 ? "" : "s"} in this preview.`
                                    : "Case-insensitive; extra spaces are ignored."}
                            </span>
                        </label>

                        <label>
                            <span className={LABEL_CLASS}>Payee (optional)</span>
                            <input
                                type="text"
                                value={form.payee}
                                onChange={event =>
                                    setField("payee", event.target.value)
                                }
                                aria-label="Payee"
                                disabled={saving}
                                className={FIELD_CLASS}
                            />
                        </label>

                        <label>
                            <span className={LABEL_CLASS}>Notes (optional)</span>
                            <input
                                type="text"
                                value={form.notes}
                                onChange={event =>
                                    setField("notes", event.target.value)
                                }
                                aria-label="Notes"
                                disabled={saving}
                                className={FIELD_CLASS}
                            />
                        </label>

                        <label>
                            <span className={LABEL_CLASS}>
                                Category (optional)
                            </span>
                            <select
                                value={form.categoryId}
                                onChange={event =>
                                    setField("categoryId", event.target.value)
                                }
                                aria-label="Category"
                                disabled={saving}
                                className={FIELD_CLASS}
                            >
                                <option value="">— Not set —</option>
                                {categoryOptions.map(category => (
                                    <option key={category.id} value={category.id}>
                                        {category.name}
                                    </option>
                                ))}
                                {form.categoryId &&
                                    !categoryOptions.some(
                                        category => category.id === form.categoryId
                                    ) && (
                                        <option value={form.categoryId}>
                                            (unavailable category)
                                        </option>
                                    )}
                            </select>
                        </label>

                        <label>
                            <span className={LABEL_CLASS}>Type (optional)</span>
                            <select
                                value={form.transactionType}
                                onChange={event =>
                                    setField(
                                        "transactionType",
                                        event.target.value as
                                            | TransactionChannel
                                            | ""
                                    )
                                }
                                aria-label="Type"
                                disabled={saving}
                                className={FIELD_CLASS}
                            >
                                <option value="">— Not set —</option>
                                {TRANSACTION_CHANNEL_OPTIONS.filter(
                                    option => option.value !== ""
                                ).map(option => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {formError && (
                        <p className="mt-3 text-sm text-red-600">{formError}</p>
                    )}

                    <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-xs text-slate-500">
                            Only the fields you fill in are applied. Existing
                            transactions are never changed.
                        </span>

                        <div className="flex shrink-0 justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeEditor}
                                disabled={saving}
                                className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!canSave}
                                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <Wand2 size={14} aria-hidden="true" />
                                {saving
                                    ? "Saving..."
                                    : editor.mode === "edit"
                                      ? "Save Changes"
                                      : "Add Rule"}
                            </button>
                        </div>
                    </div>
                </form>
            )}

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {scopedRules.length > 0 && (
                    <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center">
                        <label className="relative flex-1">
                            <Search
                                size={15}
                                aria-hidden="true"
                                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
                            />
                            <input
                                type="search"
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                                placeholder="Search rules"
                                aria-label="Search rules"
                                className={`${FIELD_CLASS} pl-8`}
                            />
                        </label>

                        {!scoped && (
                            <select
                                value={accountFilter}
                                onChange={event =>
                                    setAccountFilter(event.target.value)
                                }
                                aria-label="Filter by account"
                                className={`${FIELD_CLASS} sm:w-56`}
                            >
                                <option value="">All accounts</option>
                                {accountOptions.map(account => (
                                    <option key={account.id} value={account.id}>
                                        {account.name}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>
                )}

                {loading ? (
                    <div className="px-6 py-12 text-center text-sm text-slate-500">
                        Loading import rules...
                    </div>
                ) : loadError ? (
                    <div className="px-6 py-12 text-center">
                        <p className="text-sm font-medium text-red-600">
                            Failed to load import rules.
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{loadError}</p>
                    </div>
                ) : scopedRules.length === 0 ? (
                    <div
                        data-testid="import-rules-empty"
                        className="px-6 py-14 text-center"
                    >
                        <div className="text-sm font-medium text-slate-800">
                            No import rules yet
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                            {scoped && !scopeAccountId
                                ? "Select an account to add import rules for it."
                                : "Add a rule to automatically set Payee, Notes, Category or Type on matching imported transactions."}
                        </div>
                    </div>
                ) : visibleRules.length === 0 ? (
                    <div className="px-6 py-10 text-center text-sm text-slate-500">
                        No rules match your search.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table
                            data-testid="import-rules-table"
                            className="w-full min-w-[860px] text-left text-sm"
                        >
                            <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                                <tr>
                                    <th className="px-4 py-2.5">Keyword</th>
                                    <th className="px-4 py-2.5">Account</th>
                                    <th className="px-4 py-2.5">Payee</th>
                                    <th className="px-4 py-2.5">Category</th>
                                    <th className="px-4 py-2.5">Type</th>
                                    <th className="px-4 py-2.5">Notes</th>
                                    {showPreviewCounts && (
                                        <th className="px-4 py-2.5">In preview</th>
                                    )}
                                    <th className="px-4 py-2.5">Updated</th>
                                    <th className="px-4 py-2.5 text-right">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {visibleRules.map(rule => {
                                    const shown = describeCustomRule(
                                        rule,
                                        accounts,
                                        categories
                                    );
                                    const applied =
                                        appliedCountByRule?.get(rule.id) ?? 0;

                                    return (
                                        <tr
                                            key={rule.id}
                                            data-testid="import-rule-row"
                                            className="align-top text-slate-700"
                                        >
                                            <td className="px-4 py-3 font-semibold text-slate-900">
                                                “{shown.keyword}”
                                            </td>
                                            <td className="px-4 py-3">
                                                {shown.account}
                                            </td>
                                            <td className="px-4 py-3">
                                                <Value value={shown.payee} />
                                            </td>
                                            <td className="px-4 py-3">
                                                <Value value={shown.category} />
                                            </td>
                                            <td className="px-4 py-3">
                                                <Value value={shown.type} />
                                            </td>
                                            <td className="max-w-[220px] px-4 py-3 break-words">
                                                <Value value={shown.notes} />
                                            </td>
                                            {showPreviewCounts && (
                                                <td className="px-4 py-3 whitespace-nowrap text-violet-600">
                                                    {applied} row
                                                    {applied === 1 ? "" : "s"}
                                                </td>
                                            )}
                                            <td
                                                className="px-4 py-3 whitespace-nowrap text-slate-500"
                                                title={`Created ${formatDate(parseRuleTimestamp(rule.createdAt))}`}
                                            >
                                                {formatDate(
                                                    parseRuleTimestamp(
                                                        rule.updatedAt
                                                    )
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex justify-end gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => openEdit(rule)}
                                                        disabled={saving}
                                                        aria-label={`Edit import rule ${rule.keyword}`}
                                                        title="Edit rule"
                                                        className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
                                                    >
                                                        <Pencil size={15} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setDeleteError(null);
                                                            setPendingDelete(rule);
                                                        }}
                                                        aria-label={`Delete import rule ${rule.keyword}`}
                                                        title="Delete rule (existing transactions are not changed)"
                                                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                                                    >
                                                        <Trash2 size={15} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {scopedRules.length > 1 && (
                <p className="text-xs text-slate-500">
                    If several rules match a row, the most recently created one
                    wins for each field it sets.
                </p>
            )}

            <AlertDialog
                open={pendingDelete !== null}
                onOpenChange={next => {
                    if (!next && !deleting) {
                        setPendingDelete(null);
                    }
                }}
            >
                <AlertDialogContent className="data-[size=default]:sm:max-w-md">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this import rule?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {pendingDelete &&
                                `“${pendingDelete.keyword}” will no longer apply to future imports into ${describeCustomRule(pendingDelete, accounts, categories).account}. Transactions already in FinWea are not changed.`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    {deleteError && (
                        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
                            {deleteError}
                        </p>
                    )}

                    <AlertDialogFooter>
                        <AlertDialogAction
                            variant="outline"
                            disabled={deleting}
                            onClick={() => setPendingDelete(null)}
                            className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900"
                        >
                            Cancel
                        </AlertDialogAction>
                        <AlertDialogAction
                            disabled={deleting}
                            onClick={() => void handleConfirmDelete()}
                            className="h-9 rounded-lg bg-red-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-red-700"
                        >
                            {deleting ? "Deleting..." : "Delete Rule"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function Value({ value }: { value: string | null }) {
    return value ? (
        <>{value}</>
    ) : (
        <span className="text-slate-300" aria-label="Not set">
            —
        </span>
    );
}
