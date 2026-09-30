import { useCallback, useEffect, useRef, useState } from "react";
import { LatestRequestGuard } from "@/core/async/LatestRequestGuard";
import { AccountService } from "../services";
import { Account } from "../types";

export function useAccounts() {

    const service = new AccountService();

    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Guards against a slower, still in-flight refresh (e.g. this page's
    // initial load, delayed by database contention) overwriting state with
    // stale data after a newer refresh - such as the one triggered right
    // after a delete - has already resolved and shown the correct list.
    const requestGuard = useRef(new LatestRequestGuard());

    const loadAccounts = useCallback(async () => {
        const requestId = requestGuard.current.start();

        try {

            setLoading(true);
            setError(null);

            const data = await service.getAll();

            if (requestGuard.current.isStale(requestId)) {
                return;
            }

            setAccounts(data);

        } catch (err) {

            if (requestGuard.current.isStale(requestId)) {
                return;
            }

            console.error("ACCOUNTS LOAD ERROR:", err);

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
        void loadAccounts();
    }, [loadAccounts]);

    return {
        accounts,
        loading,
        error,
        refresh: loadAccounts,
    };
}

