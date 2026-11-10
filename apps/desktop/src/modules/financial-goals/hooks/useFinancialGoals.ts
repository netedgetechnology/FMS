import { useCallback, useEffect, useRef, useState } from "react";

import {
    InitialLoadTracker,
    reportBackgroundRefreshFailure,
} from "@/core/async/InitialLoadTracker";

import {
    FinancialGoalService,
} from "../services";

import type {
    FinancialGoal,
    CreateFinancialGoalRequest,
    UpdateFinancialGoalRequest,
} from "../types";

export function useFinancialGoals() {
    const service = new FinancialGoalService();

    const [goals, setGoals] = useState<FinancialGoal[]>([]);
    const [loading, setLoading] = useState(true);

    // Only the first load blanks the page - see InitialLoadTracker.
    const loadTracker = useRef(new InitialLoadTracker());

    const loadGoals = useCallback(async () => {
        if (loadTracker.current.showsLoading()) {
            setLoading(true);
        }

        try {
            const data = await service.getAll();
            setGoals(data);
            loadTracker.current.markLoaded();
        } catch (error) {
            // A failed first load still fails as before; a failed refresh
            // keeps the goals already shown.
            if (!loadTracker.current.hasLoaded) {
                throw error;
            }

            reportBackgroundRefreshFailure("financial goals", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadGoals();
    }, [loadGoals]);

    const createGoal = useCallback(
        async (request: CreateFinancialGoalRequest) => {
            await service.create(request);
            await loadGoals();
        },
        [loadGoals]
    );

    const updateGoal = useCallback(
        async (request: UpdateFinancialGoalRequest) => {
            await service.update(request);
            await loadGoals();
        },
        [loadGoals]
    );

    const deleteGoal = useCallback(
        async (id: string) => {
            await service.delete(id);
            await loadGoals();
        },
        [loadGoals]
    );

    return {
        goals,
        loading,
        refresh: loadGoals,
        createGoal,
        updateGoal,
        deleteGoal,
    };
}
