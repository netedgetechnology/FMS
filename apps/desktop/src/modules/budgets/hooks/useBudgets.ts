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

    // Only the first load blanks the page - see InitialLoadTracker.
    const loadTracker = useRef(new InitialLoadTracker());

    const loadBudgets = useCallback(
        async () => {
            if (loadTracker.current.showsLoading()) {
                setLoading(true);
            }
            setError(null);

            try {
                const data =
                    await service.getAll();

                setBudgets(data);
                loadTracker.current.markLoaded();
            } catch (err) {
                // Rows already shown stay; only a failed first load shows the error.
                if (loadTracker.current.hasLoaded) {
                    reportBackgroundRefreshFailure("budgets", err);
                    return;
                }

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
