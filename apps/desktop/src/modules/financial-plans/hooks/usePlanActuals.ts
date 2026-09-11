import {
    useCallback,
    useEffect,
    useState,
} from "react";

import { PlanActualsService } from "../services";
import type { PlanCalcResult } from "../services";

/**
 * Loads the live, recomputed actuals for one plan (Phase 3-5 engine).
 * `planId = null` clears the result - used when the View dialog closes.
 * Pull-based: every call re-derives from source data, nothing is cached.
 */
export function usePlanActuals(planId: string | null) {
    const service = new PlanActualsService();

    const [result, setResult] =
        useState<PlanCalcResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(
        null
    );

    const load = useCallback(async () => {
        if (!planId) {
            setResult(null);
            setError(null);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            setResult(
                await service.getPlanActuals(planId)
            );
        } catch (err) {
            console.error(
                "Failed to calculate plan actuals:",
                err
            );
            setResult(null);
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to calculate plan actuals."
            );
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [planId]);

    useEffect(() => {
        void load();
    }, [load]);

    return { result, loading, error, refresh: load };
}
