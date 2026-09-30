import { Link } from "react-router-dom";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import type { Account } from "@/modules/accounts/types";
import type { Category } from "@/modules/categories/types";

import { CustomRuleManager } from "../components/CustomRuleManager";
import type {
    CreateCustomImportRuleInput,
    CustomImportRule,
} from "../types";

// ---------------------------------------------------------------------
// The Import Preview wand: the same rule management as the Import Rules
// page (CustomRuleManager), scoped to the selected account and showing
// how many preview rows each rule applies to. Changes are re-applied to
// the open preview by the page (reapplyCustomImportRules).
// ---------------------------------------------------------------------

export interface CustomRulesDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    accountId: string | null;
    accountName: string | null;
    accounts: readonly Pick<Account, "id" | "name">[];
    rules: readonly CustomImportRule[];
    // The current preview's rows (original Descriptions) - for the live
    // "matches N rows" count. Empty when no preview is loaded.
    previewCandidates: readonly Pick<
        NormalizedTransactionCandidate,
        "description"
    >[];
    // rule id -> rows it currently applies to in the preview.
    appliedCountByRule: ReadonlyMap<string, number>;
    categories: readonly Category[];
    formatDate: (value: string | Date | null | undefined) => string;
    onCreate: (input: CreateCustomImportRuleInput) => Promise<void>;
    onUpdate: (
        id: string,
        input: CreateCustomImportRuleInput
    ) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}

export function CustomRulesDialog({
    open,
    onOpenChange,
    accountId,
    accountName,
    accounts,
    rules,
    previewCandidates,
    appliedCountByRule,
    categories,
    formatDate,
    onCreate,
    onUpdate,
    onDelete,
}: CustomRulesDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-5xl">
                <DialogHeader className="px-7 pt-6">
                    <DialogTitle>Import Rules</DialogTitle>
                    <p className="text-sm text-slate-500">
                        {accountName
                            ? `For ${accountName}. When a row's original Description contains the keyword, the fields you fill in are set on this preview and on every future import into this account.`
                            : "Select an account first."}
                    </p>
                </DialogHeader>

                <div className="max-h-[70vh] overflow-y-auto px-7 pb-7">
                    <CustomRuleManager
                        rules={rules}
                        accounts={accounts}
                        categories={categories}
                        formatDate={formatDate}
                        scopeAccountId={accountId}
                        appliedCountByRule={appliedCountByRule}
                        previewCandidates={previewCandidates}
                        header={
                            <Link
                                to="/imports/rules"
                                className="text-sm font-medium text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline"
                            >
                                View all Import Rules
                            </Link>
                        }
                        onCreate={onCreate}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}
