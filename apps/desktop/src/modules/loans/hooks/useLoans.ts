import { useCallback, useEffect, useRef, useState } from "react";

import { LatestRequestGuard } from "@/core/async/LatestRequestGuard";
import { LoanService } from "../services";
import { Loan } from "../types";

export function useLoans() {

    const service = new LoanService();

    const [loans, setLoans] = useState<Loan[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Guards against a slower, still in-flight refresh overwriting state
    // with stale data after a newer refresh has already resolved - see
    // LatestRequestGuard.
    const requestGuard = useRef(new LatestRequestGuard());

    const loadLoans = useCallback(async () => {
        const requestId = requestGuard.current.start();

        try {

            setLoading(true);
            setError(null);

            const data = await service.getAll();

            if (requestGuard.current.isStale(requestId)) {
                return;
            }

            setLoans(data);

        } catch (err) {

            if (requestGuard.current.isStale(requestId)) {
                return;
            }

            console.error("LOANS LOAD ERROR:", err);

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
        void loadLoans();
    }, [loadLoans]);

    return {
        loans,
        loading,
        error,
        refresh: loadLoans,
    };
}
