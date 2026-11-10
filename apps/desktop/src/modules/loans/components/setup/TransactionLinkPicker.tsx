import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";

import { LoanSetupRepository } from "../../repositories/LoanSetupRepository";
import { formatMoney, linkedTransactionCategoryWarning } from "../../setup/loanSetupAccounting";
import type { LinkedTransactionSummary, MoneySide } from "../../setup/loanSetupTypes";
import { SmallButton, formatDisplayDate } from "./setupFields";

// ---------------------------------------------------------------------
// Links a disbursement / initial expense to an EXISTING bank transaction.
// Only live, unclaimed transactions on the chosen account, moving money
// the right way, are offered - for exactly the amount by default (no
// tolerance). Choosing one never changes or creates a transaction.
// ---------------------------------------------------------------------

export function TransactionLinkPicker({
    accountId,
    side,
    amount,
    aroundDate,
    value,
    excludeIds,
    role,
    what,
    onChange,
}: {
    accountId: string;
    side: MoneySide;
    amount: number | null;
    aroundDate: string;
    value: LinkedTransactionSummary | null;
    /** Transactions already chosen elsewhere in this setup. */
    excludeIds: readonly string[];
    role: "DISBURSEMENT" | "EXPENSE";
    what: string;
    onChange(value: LinkedTransactionSummary | null): void;
}) {
    const [open, setOpen] = useState(false);
    const [exactAmount, setExactAmount] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [candidates, setCandidates] = useState<LinkedTransactionSummary[]>([]);

    async function search(exact: boolean) {
        if (!accountId) {
            setError("Choose the bank account first.");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const rows = await new LoanSetupRepository().findLinkCandidates({
                accountId,
                side,
                amount: exact ? amount : null,
                aroundDate: aroundDate || null,
                excludeIds,
            });
            setCandidates(rows);
        } catch (searchError) {
            console.error("Failed to find bank transactions:", searchError);
            setError("Could not load bank transactions.");
        } finally {
            setLoading(false);
        }
    }

    if (value) {
        const warning = linkedTransactionCategoryWarning(value, role, what);

        return (
            <div className="space-y-1.5 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="font-medium text-emerald-900">
                            Linked: {formatDisplayDate(value.date)} · {formatMoney(value.amount)} · {value.side === "IN" ? "credit" : "debit"}
                        </div>
                        <div className="truncate text-xs text-emerald-800">
                            {value.narration || value.payee}
                            {value.categoryName ? ` · ${value.categoryName}` : ""}
                        </div>
                    </div>
                    <SmallButton tone="danger" onClick={() => onChange(null)}>
                        Unlink
                    </SmallButton>
                </div>
                <p className="text-xs text-emerald-800">The existing transaction is used as it is - nothing new is created.</p>
                {warning && <p className="text-xs text-amber-700">{warning}</p>}
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {!open ? (
                <SmallButton
                    onClick={() => {
                        setOpen(true);
                        void search(exactAmount);
                    }}
                >
                    Link existing bank transaction
                </SmallButton>
            ) : (
                <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-xs text-slate-600">
                            <Checkbox
                                checked={exactAmount}
                                onCheckedChange={checked => {
                                    const next = checked === true;
                                    setExactAmount(next);
                                    void search(next);
                                }}
                            />
                            Exactly {amount !== null ? formatMoney(amount) : "the amount"} only
                        </label>
                        <SmallButton onClick={() => setOpen(false)}>Close</SmallButton>
                    </div>

                    {loading && <p className="text-xs text-slate-500">Loading...</p>}
                    {error && <p className="text-xs text-red-600">{error}</p>}
                    {!loading && !error && candidates.length === 0 && (
                        <p className="text-xs text-slate-500">
                            No unlinked {side === "IN" ? "credit" : "debit"} found on this account
                            {exactAmount && amount !== null ? ` for exactly ${formatMoney(amount)}` : ""}.
                        </p>
                    )}

                    <ul className="max-h-48 space-y-1 overflow-y-auto">
                        {candidates.map(candidate => (
                            <li key={candidate.id}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onChange(candidate);
                                        setOpen(false);
                                    }}
                                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                                >
                                    <span className="min-w-0">
                                        <span className="font-medium text-slate-800">
                                            {formatDisplayDate(candidate.date)} · {formatMoney(candidate.amount)}
                                        </span>
                                        <span className="block truncate text-xs text-slate-500">
                                            {candidate.narration || candidate.payee}
                                            {candidate.categoryName ? ` · ${candidate.categoryName}` : ""}
                                        </span>
                                    </span>
                                    <span className="text-xs text-slate-400">Choose</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
