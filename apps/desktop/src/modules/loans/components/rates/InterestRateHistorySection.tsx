import { useCallback, useEffect, useRef, useState } from "react";

import { LatestRequestGuard } from "@/core/async/LatestRequestGuard";

import { InterestRateChangeService, type RateChangeContext } from "../../services/InterestRateChangeService";
import { localToday } from "../../setup/historicalInstalments";
import type { InterestRateHistoryEntry } from "../../types/InterestRateHistory";
import type { Loan } from "../../types";
import { InterestRateHistoryView } from "./InterestRateHistoryView";
import { RecordRateChangeDialog } from "./RecordRateChangeDialog";

/**
 * Loan details: the rate history, and recording / correcting a rate change.
 * After each save the context (loan, schedule, history) is reloaded from the
 * database, so further changes and corrections can be made without closing
 * the loan; only the latest reload is ever shown (a slower, earlier one
 * never overwrites it).
 */
export function InterestRateHistorySection({ loan, onLoanChanged }: { loan: Loan; onLoanChanged?(): void }) {
    const [context, setContext] = useState<RateChangeContext | null>(null);
    const [failed, setFailed] = useState(false);
    const [dialog, setDialog] = useState<{ correcting: InterestRateHistoryEntry | null; session: number } | null>(null);
    const requests = useRef(new LatestRequestGuard());

    const load = useCallback(async () => {
        const request = requests.current.start();
        try {
            const next = await new InterestRateChangeService().loadContext(loan);
            if (requests.current.isStale(request)) return;
            setContext(next);
            setFailed(false);
        } catch (error) {
            if (requests.current.isStale(request)) return;
            console.error("Failed to load interest rate history:", error);
            setFailed(true);
        }
    }, [loan]);

    useEffect(() => {
        void load();
    }, [load]);

    if (failed) return <p className="text-xs text-red-600">The interest rate history could not be loaded.</p>;
    if (!context) return null;

    return (
        <>
            <InterestRateHistoryView
                loan={context.loan}
                available={context.available}
                history={context.history}
                today={localToday()}
                recordBlockedReason={context.available ? null : "Rate changes can be recorded once the database update (migration 054) is applied."}
                onRecord={() => setDialog({ correcting: null, session: Date.now() })}
                onCorrect={entry => setDialog({ correcting: entry, session: Date.now() })}
            />
            {dialog && (
                <RecordRateChangeDialog
                    key={dialog.session}
                    open
                    context={context}
                    correcting={dialog.correcting}
                    onOpenChange={open => {
                        if (open) return;
                        setDialog(null);
                        // Closed (saved or cancelled): the next change starts from the loan as it now is.
                        void load();
                    }}
                    onSaved={() => onLoanChanged?.()}
                    onSaveRefused={() => void load()}
                />
            )}
        </>
    );
}
