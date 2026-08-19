import { useCallback, useEffect, useState } from "react";

import { TransactionService } from "../services";
import { Transaction } from "../types";

export function useTransactions() {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const service = new TransactionService();
            const data = await service.getAll();

            setTransactions(data);
        } catch (err) {
            console.error("Failed to load transactions:", err);
            setError("Unable to load transactions. Please try again.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return {
        transactions,
        loading,
        error,
        refresh,
    };
}
