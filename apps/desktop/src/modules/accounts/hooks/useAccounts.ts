import { useCallback, useEffect, useState } from "react";
import { AccountService } from "../services";
import { Account } from "../types";

export function useAccounts() {

    const service = new AccountService();

    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadAccounts = useCallback(async () => {

        try {

            setLoading(true);
            setError(null);

            const data = await service.getAll();

            setAccounts(data);

        } catch (err) {

            console.error("ACCOUNTS LOAD ERROR:", err);

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
        void loadAccounts();
    }, [loadAccounts]);

    return {
        accounts,
        loading,
        error,
        refresh: loadAccounts,
    };
}

