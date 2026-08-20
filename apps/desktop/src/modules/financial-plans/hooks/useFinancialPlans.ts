import {
    useCallback,
    useEffect,
    useState,
} from "react";

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

    const loadPlans = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const data = await service.getAll();
            setPlans(data);
        } catch (error) {
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
