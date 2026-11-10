import {
    useCallback,
    useEffect,
    useRef,
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

    // The plan whose figures are on screen: recalculating the same plan
    // (after a component change) keeps them visible until the new ones
    // arrive; another plan shows the loading state. A failed calculation
    // still clears them and shows the error, exactly as before.
    const shownPlanId = useRef<string | null>(null);

    const load = useCallback(async () => {
        if (!planId) {
            shownPlanId.current = null;
            setResult(null);
            setError(null);
            return;
        }

        if (shownPlanId.current !== planId) {
            setLoading(true);
        }
        setError(null);

        try {
            setResult(
                await service.getPlanActuals(planId)
            );
            shownPlanId.current = planId;
        } catch (err) {
            shownPlanId.current = null;
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
