import { useCallback, useEffect, useMemo, useState } from "react";

import { useDateFormatter } from "@/core/formatting";
import { useAccounts } from "@/modules/accounts/hooks";
import { useCategories } from "@/modules/categories/hooks";

import { CustomRuleManager } from "../components/CustomRuleManager";
import { ImportService } from "../services/ImportService";
import type {
    CreateCustomImportRuleInput,
    CustomImportRule,
} from "../types";

// ---------------------------------------------------------------------
// Imports > Import Rules: every saved Custom Import Rule, for every
// account, managed with the same CustomRuleManager as the Import Preview
// wand. Needs no active import. An unfinished Import Preview picks up
// the changes when it is resumed (see handleResumeDraft in ImportsPage);
// no transaction is ever changed here.
// ---------------------------------------------------------------------

export default function ImportRulesPage() {
    const formatDate = useDateFormatter();
    const { accounts, loading: accountsLoading } = useAccounts();
    const { categories, loading: categoriesLoading } = useCategories();

    const service = useMemo(() => new ImportService(), []);

    const [rules, setRules] = useState<CustomImportRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            setLoadError(null);
            setRules(await service.listAllCustomRules());
        } catch (err) {
            console.error("IMPORT RULES LOAD ERROR:", err);
            setLoadError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [service]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const handleCreate = async (input: CreateCustomImportRuleInput) => {
        await service.createCustomRule(input);
        await refresh();
    };

    const handleUpdate = async (
        id: string,
        input: CreateCustomImportRuleInput
    ) => {
        await service.updateCustomRule(id, input);
        await refresh();
    };

    const handleDelete = async (id: string) => {
        await service.deleteCustomRule(id);
        await refresh();
    };

    return (
        <div className="space-y-6">
            <CustomRuleManager
                rules={rules}
                accounts={accounts}
                categories={categories}
                formatDate={formatDate}
                loading={loading || accountsLoading || categoriesLoading}
                loadError={loadError}
                header={
                    <>
                        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                            Import Rules
                        </h1>
                        <p className="mt-1 text-sm text-slate-500">
                            These rules automatically modify matching
                            imported transactions: when a row's original
                            Description contains the keyword, the Payee,
                            Notes, Category or Type you set is applied to
                            imports into that account. Existing
                            transactions are never changed.
                        </p>
                    </>
                }
                onCreate={handleCreate}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
            />
        </div>
    );
}
