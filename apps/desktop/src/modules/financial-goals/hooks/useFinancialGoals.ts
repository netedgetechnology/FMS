import { useCallback, useEffect, useState } from "react";

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

    const loadGoals = useCallback(async () => {
        setLoading(true);

        try {
            const data = await service.getAll();
            setGoals(data);
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
