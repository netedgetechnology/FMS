import {
    useCallback,
    useEffect,
    useState,
} from "react";

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

    const load = useCallback(async () => {
        if (!planId) {
            setComponents([]);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const data =
                await service.listForPlan(planId);

            setComponents(data);
        } catch (err) {
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
