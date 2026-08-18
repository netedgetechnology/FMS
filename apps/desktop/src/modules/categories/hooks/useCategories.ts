import { useCallback, useEffect, useState } from "react";

import { CategoryService } from "../services";
import { Category } from "../types";

export function useCategories() {
    const service = new CategoryService();

    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadCategories = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const data = await service.getAll();

            setCategories(data);
        } catch (err) {
            console.error("CATEGORIES LOAD ERROR:", err);

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
        void loadCategories();
    }, [loadCategories]);

    return {
        categories,
        loading,
        error,
        refresh: loadCategories,
    };
}
