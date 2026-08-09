import { useCallback, useEffect, useState } from "react";
import { Currency } from "../types";
import { CurrencyService } from "../services/CurrencyService";

export function useCurrencies() {
    const service = new CurrencyService();

    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [loading, setLoading] = useState(true);

    const loadCurrencies = useCallback(async () => {
        setLoading(true);

        try {
            const data = await service.getAll();
            setCurrencies(data);
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
