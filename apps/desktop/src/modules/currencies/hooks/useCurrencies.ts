import { useCallback, useEffect, useRef, useState } from "react";

import {
    InitialLoadTracker,
    reportBackgroundRefreshFailure,
} from "@/core/async/InitialLoadTracker";
import { Currency } from "../types";
import { CurrencyService } from "../services/CurrencyService";

export function useCurrencies() {
    const service = new CurrencyService();

    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [loading, setLoading] = useState(true);

    // Only the first load blanks the page - see InitialLoadTracker.
    const loadTracker = useRef(new InitialLoadTracker());

    const loadCurrencies = useCallback(async () => {
        if (loadTracker.current.showsLoading()) {
            setLoading(true);
        }

        try {
            const data = await service.getAll();
            setCurrencies(data);
            loadTracker.current.markLoaded();
        } catch (error) {
            // A failed first load still fails as before; a failed refresh
            // keeps the list already shown.
            if (!loadTracker.current.hasLoaded) {
                throw error;
            }

            reportBackgroundRefreshFailure("currencies", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadCurrencies();
    }, [loadCurrencies]);

    return {
        currencies,
        loading,
        refresh: loadCurrencies,
    };
}
