import {
    useCallback,
    useEffect,
    useState,
} from "react";

import {
    BusinessEntityService,
} from "../services";

import {
    BusinessEntity,
} from "../types";

export function useBusinessEntities() {

    const service =
        new BusinessEntityService();

    const [
        businessEntities,
        setBusinessEntities,
    ] = useState<BusinessEntity[]>([]);

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState<string | null>(null);

    const loadBusinessEntities =
        useCallback(async () => {

            try {
                setLoading(true);
                setError(null);

                const data =
                    await service.getAll();

                setBusinessEntities(data);

            } catch (err) {

                console.error(
                    "BUSINESS ENTITIES LOAD ERROR:",
                    err
                );

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
        void loadBusinessEntities();
    }, [loadBusinessEntities]);

    return {
        businessEntities,
        loading,
        error,
        refresh: loadBusinessEntities,
    };
}
