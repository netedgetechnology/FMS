import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import { reportBackgroundRefreshFailure } from "@/core/async/InitialLoadTracker";

import { FinancialPlanComponentService } from "../services";
import type { FinancialPlanComponentView } from "../types";

/**
 * Loads the resolved component views for one plan. `planId = null`
 * clears the list (used when the manage dialog is closed).
 */
export function usePlanComponents(
    planId: string | null
) {
    const service = new FinancialPlanComponentService();

    const [components, setComponents] = useState<
        FinancialPlanComponentView[]
    >([]);

    const [loading, setLoading] = useState(false);

    const [error, setError] = useState<string | null>(
        null
    );

    // The plan whose components are on screen. Only the first load for a
    // plan blanks the list; a refresh after adding / editing / removing a
    // component keeps it visible (see InitialLoadTracker).
    const loadedPlanId = useRef<string | null>(null);

    const load = useCallback(async () => {
        if (!planId) {
            loadedPlanId.current = null;
            setComponents([]);
            return;
        }

        const isRefresh = loadedPlanId.current === planId;

        if (!isRefresh) {
            setLoading(true);
        }
        setError(null);

        try {
            const data =
                await service.listForPlan(planId);

            setComponents(data);
            loadedPlanId.current = planId;
        } catch (err) {
            // Components already shown stay; only a failed first load
            // shows the error.
            if (isRefresh) {
                reportBackgroundRefreshFailure("plan components", err);
                return;
            }

            console.error(
                "Failed to load plan components:",
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to load plan components."
            );
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [planId]);

    useEffect(() => {
        void load();
    }, [load]);

    return {
        components,
        loading,
        error,
        refresh: load,
    };
}
