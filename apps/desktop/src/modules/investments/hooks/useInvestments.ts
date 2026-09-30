import { useCallback, useEffect, useRef, useState } from "react";

import { LatestRequestGuard } from "@/core/async/LatestRequestGuard";
import { InvestmentService } from "../services";
import { Investment } from "../types";

export function useInvestments() {

    const service = new InvestmentService();

    const [investments, setInvestments] = useState<Investment[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Guards against a slower, still in-flight refresh overwriting state
    // with stale data after a newer refresh has already resolved - see
    // LatestRequestGuard.
    const requestGuard = useRef(new LatestRequestGuard());

    const loadInvestments = useCallback(async () => {
        const requestId = requestGuard.current.start();

        try {

            setLoading(true);
            setError(null);

            const data = await service.getAll();

            if (requestGuard.current.isStale(requestId)) {
                return;
            }

            setInvestments(data);

        } catch (err) {

            if (requestGuard.current.isStale(requestId)) {
                return;
            }

            console.error("INVESTMENTS LOAD ERROR:", err);

            const message =
                err instanceof Error
                    ? `${err.name}: ${err.message}`
                    : String(err);

            setError(message);

        } finally {

            if (!requestGuard.current.isStale(requestId)) {
                setLoading(false);
            }

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
