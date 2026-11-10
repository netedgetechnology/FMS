import { useCallback, useEffect, useRef, useState } from "react";

import {
    InitialLoadTracker,
    reportBackgroundRefreshFailure,
} from "@/core/async/InitialLoadTracker";
import { Institution } from "../types";
import { InstitutionService } from "../services/InstitutionService";

export function useInstitutions() {
    const service = new InstitutionService();

    const [institutions, setInstitutions] = useState<Institution[]>([]);
    const [loading, setLoading] = useState(true);

    // Only the first load blanks the page - see InitialLoadTracker.
    const loadTracker = useRef(new InitialLoadTracker());

    const loadInstitutions = useCallback(async () => {
        if (loadTracker.current.showsLoading()) {
            setLoading(true);
        }

        try {
            const data = await service.getAll();
            setInstitutions(data);
            loadTracker.current.markLoaded();
        } catch (error) {
            // A failed first load still fails as before; a failed refresh
            // keeps the list already shown.
            if (!loadTracker.current.hasLoaded) {
                throw error;
            }

            reportBackgroundRefreshFailure("institutions", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadInstitutions();
    }, [loadInstitutions]);

    return {
        institutions,
        loading,
        refresh: loadInstitutions,
    };
}
