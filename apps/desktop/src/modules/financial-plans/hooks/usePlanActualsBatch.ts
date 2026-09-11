import {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";

import { PlanActualsService } from "../services";
import type { PlanCalcResult } from "../services";

/**
 * Batched, list-level plan actuals. Calls PlanActualsService.getAllPlanActuals()
 * ONCE - the LedgerBundle (transactions / transfers / accounts / referenced
 * sources) is assembled a single time and reused for every plan - rather
 * than opening a full source fetch per row. Pull-based: nothing is cached.
 */
export function usePlanActualsBatch(
    enabled: boolean = true
) {
    const service = new PlanActualsService();

    const [results, setResults] = useState<
        PlanCalcResult[]
    >([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(
        null
    );

    const load = useCallback(async () => {
        if (!enabled) {
            setResults([]);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            setResults(
                await service.getAllPlanActuals()
            );
        } catch (err) {
            console.error(
                "Failed to calculate plan actuals:",
                err
            );
            setResults([]);
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to calculate plan actuals."
            );
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);

    useEffect(() => {
        void load();
    }, [load]);

    const resultsByPlanId = useMemo(
        () =>
            new Map(
                results.map(result => [
                    result.planId,
                    result,
                ])
            ),
        [results]
    );

    return {
        results,
        resultsByPlanId,
        loading,
        error,
        refresh: load,
    };
}
