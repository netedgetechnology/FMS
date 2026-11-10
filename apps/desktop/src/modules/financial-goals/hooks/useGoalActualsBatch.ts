import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import { InitialLoadTracker } from "@/core/async/InitialLoadTracker";

import { GoalActualsService } from "../services";
import type { GoalCalcResult } from "../services";

/**
 * Batched, list-level actuals for any linked goal mode (ACCOUNT_LINKED,
 * DEBT_PAYOFF_LINKED, CATEGORY_CONTRIBUTION_LINKED, LOAN_PAYOFF_LINKED,
 * INVESTMENT_LINKED). Pull-based, like usePlanActualsBatch: nothing is
 * cached, every refresh re-reads live accounts / categories / loans /
 * investments / transactions / transfers.
 */
export function useGoalActualsBatch(
    enabled: boolean = true
) {
    const service = new GoalActualsService();

    const [resultsByGoalId, setResultsByGoalId] =
        useState<Map<string, GoalCalcResult>>(
            new Map()
        );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<
        string | null
    >(null);

    // Only the first calculation shows the loading state; a refresh after
    // a mutation keeps the current figures on screen until the new ones
    // arrive (InitialLoadTracker). A failed calculation still clears them
    // and shows the error, exactly as before - figures that could not be
    // recalculated are never shown as current.
    const loadTracker = useRef(new InitialLoadTracker());

    const load = useCallback(async () => {
        if (!enabled) {
            setResultsByGoalId(new Map());
            return;
        }

        if (loadTracker.current.showsLoading()) {
            setLoading(true);
        }
        setError(null);

        try {
            setResultsByGoalId(
                await service.getAllGoalActuals()
            );
            loadTracker.current.markLoaded();
        } catch (err) {
            console.error(
                "Failed to calculate goal actuals:",
                err
            );
            setResultsByGoalId(new Map());
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to calculate goal actuals."
            );
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);

    useEffect(() => {
        void load();
    }, [load]);

    return {
        resultsByGoalId,
        loading,
        error,
        refresh: load,
    };
}
