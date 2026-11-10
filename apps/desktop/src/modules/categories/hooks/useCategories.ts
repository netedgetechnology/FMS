import { useCallback, useEffect, useRef, useState } from "react";

import { LatestRequestGuard } from "@/core/async/LatestRequestGuard";
import {
    InitialLoadTracker,
    reportBackgroundRefreshFailure,
} from "@/core/async/InitialLoadTracker";
import { CategoryService } from "../services";
import { Category } from "../types";

export function useCategories() {
    const service = new CategoryService();

    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Guards against a slower, still in-flight refresh overwriting state
    // with stale data after a newer refresh has already resolved - see
    // LatestRequestGuard.
    const requestGuard = useRef(new LatestRequestGuard());

    // Only the first load blanks the page - see InitialLoadTracker.
    const loadTracker = useRef(new InitialLoadTracker());

    const loadCategories = useCallback(async () => {
        const requestId = requestGuard.current.start();

        try {
            if (loadTracker.current.showsLoading()) {
                setLoading(true);
            }
            setError(null);

            const data = await service.getAll();

            if (requestGuard.current.isStale(requestId)) {
                return;
            }

            setCategories(data);
            loadTracker.current.markLoaded();
        } catch (err) {
            if (requestGuard.current.isStale(requestId)) {
                return;
            }

            console.error("CATEGORIES LOAD ERROR:", err);

            const message =
                err instanceof Error
                    ? `${err.name}: ${err.message}`
                    : String(err);

            // Rows already shown stay; only a failed first load shows the error.
            if (loadTracker.current.hasLoaded) {
                reportBackgroundRefreshFailure("categories", err);
            } else {
                setError(message);
            }
        } finally {
            if (!requestGuard.current.isStale(requestId)) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        void loadCategories();
    }, [loadCategories]);

    return {
        categories,
        loading,
        error,
        refresh: loadCategories,
    };
}
