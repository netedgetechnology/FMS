import { useCallback, useEffect, useState } from "react";

import { InvestmentService } from "../services";
import { Investment } from "../types";

export function useInvestments() {

    const service = new InvestmentService();

    const [investments, setInvestments] = useState<Investment[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadInvestments = useCallback(async () => {

        try {

            setLoading(true);
            setError(null);

            const data = await service.getAll();

            setInvestments(data);

        } catch (err) {

            console.error("INVESTMENTS LOAD ERROR:", err);

            const message =
                err instanceof Error
                    ? `${err.name}: ${err.message}`
                    : String(err);

            setError(message);

        } finally {

            setLoading(false);

        }

    }, []);

    useEffect(() => {
        void loadInvestments();
    }, [loadInvestments]);

    return {
        investments,
        loading,
        error,
        refresh: loadInvestments,
    };
}
