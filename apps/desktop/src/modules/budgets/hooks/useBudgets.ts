import {
    useCallback,
    useEffect,
    useState,
} from "react";

import {
    BudgetService,
} from "../services";

import type {
    Budget,
} from "../types";

export function useBudgets() {
    const service = new BudgetService();

    const [budgets, setBudgets] =
        useState<Budget[]>([]);

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState<string | null>(null);

    const loadBudgets = useCallback(
        async () => {
            setLoading(true);
            setError(null);

            try {
                const data =
                    await service.getAll();

                setBudgets(data);
            } catch (err) {
                console.error(
                    "Failed to load budgets:",
                    err
                );

                setError(
                    err instanceof Error
                        ? err.message
                        : "Failed to load budgets."
                );
            } finally {
                setLoading(false);
            }
        },
        []
    );

    useEffect(() => {
        void loadBudgets();
    }, [loadBudgets]);

    return {
        budgets,
        loading,
        error,
        refresh: loadBudgets,
    };
}
