import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import {
    InitialLoadTracker,
    reportBackgroundRefreshFailure,
} from "@/core/async/InitialLoadTracker";

import {
    FinancialPlanService,
} from "../services";

import type {
    FinancialPlan,
} from "../types";

export function useFinancialPlans() {
    const service = new FinancialPlanService();

    const [plans, setPlans] =
        useState<FinancialPlan[]>([]);

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState<string | null>(null);

    // Only the first load blanks the page - see InitialLoadTracker.
    const loadTracker = useRef(new InitialLoadTracker());

    const loadPlans = useCallback(async () => {
        if (loadTracker.current.showsLoading()) {
            setLoading(true);
        }
        setError(null);

        try {
            const data = await service.getAll();
            setPlans(data);
            loadTracker.current.markLoaded();
        } catch (error) {
            // Plans already shown stay; only a failed first load shows the error.
            if (loadTracker.current.hasLoaded) {
                reportBackgroundRefreshFailure("financial plans", error);
                return;
            }

            console.error(
                "Failed to load financial plans:",
                error
            );

            setError(
                error instanceof Error
                    ? error.message
                    : "Failed to load financial plans."
            );
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadPlans();
    }, [loadPlans]);

    return {
        plans,
        loading,
        error,
        refresh: loadPlans,
    };
}
