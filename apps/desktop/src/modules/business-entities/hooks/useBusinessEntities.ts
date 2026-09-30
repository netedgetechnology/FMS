import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import { LatestRequestGuard } from "@/core/async/LatestRequestGuard";

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

    // Guards against a slower, still in-flight refresh overwriting state
    // with stale data after a newer refresh has already resolved - see
    // LatestRequestGuard.
    const requestGuard = useRef(new LatestRequestGuard());

    const loadBusinessEntities =
        useCallback(async () => {
            const requestId = requestGuard.current.start();

            try {
                setLoading(true);
                setError(null);

                const data =
                    await service.getAll();

                if (requestGuard.current.isStale(requestId)) {
                    return;
                }

                setBusinessEntities(data);

            } catch (err) {

                if (requestGuard.current.isStale(requestId)) {
                    return;
                }

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
                if (!requestGuard.current.isStale(requestId)) {
                    setLoading(false);
                }
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
