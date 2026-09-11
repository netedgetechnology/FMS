import {
    useCallback,
    useEffect,
    useState,
} from "react";

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

    const load = useCallback(async () => {
        if (!enabled) {
            setResultsByGoalId(new Map());
            return;
        }

        setLoading(true);
        setError(null);

        try {
            setResultsByGoalId(
                await service.getAllGoalActuals()
            );
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
