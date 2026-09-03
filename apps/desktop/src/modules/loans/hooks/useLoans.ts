import { useCallback, useEffect, useState } from "react";

import { LoanService } from "../services";
import { Loan } from "../types";

export function useLoans() {

    const service = new LoanService();

    const [loans, setLoans] = useState<Loan[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadLoans = useCallback(async () => {

        try {

            setLoading(true);
            setError(null);

            const data = await service.getAll();

            setLoans(data);

        } catch (err) {

            console.error("LOANS LOAD ERROR:", err);

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
        void loadLoans();
    }, [loadLoans]);

    return {
        loans,
        loading,
        error,
        refresh: loadLoans,
    };
}
