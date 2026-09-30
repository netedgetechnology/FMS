import { useCallback, useEffect, useRef, useState } from "react";

import { LatestRequestGuard } from "@/core/async/LatestRequestGuard";
import { CategoryContextMappingService } from "../services";
import { CategoryContextMapping } from "../types";

export function useCategoryContextMappings() {
    const service = new CategoryContextMappingService();

    const [mappings, setMappings] = useState<CategoryContextMapping[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Guards against a slower, still in-flight refresh overwriting state
    // with stale data after a newer refresh has already resolved - see
    // LatestRequestGuard.
    const requestGuard = useRef(new LatestRequestGuard());

    const loadMappings = useCallback(async () => {
        const requestId = requestGuard.current.start();

        try {
            setLoading(true);
            setError(null);

            const data = await service.getAll();

            if (requestGuard.current.isStale(requestId)) {
                return;
            }

            setMappings(data);
        } catch (err) {
            if (requestGuard.current.isStale(requestId)) {
                return;
            }

            console.error("CATEGORY CONTEXT MAPPINGS LOAD ERROR:", err);

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
        void loadMappings();
    }, [loadMappings]);

    return {
        mappings,
        loading,
        error,
        refresh: loadMappings,
    };
}
