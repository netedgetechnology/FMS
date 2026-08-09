import { useCallback, useEffect, useState } from "react";
import { Institution } from "../types";
import { InstitutionService } from "../services/InstitutionService";

export function useInstitutions() {
    const service = new InstitutionService();

    const [institutions, setInstitutions] = useState<Institution[]>([]);
    const [loading, setLoading] = useState(true);

    const loadInstitutions = useCallback(async () => {
        setLoading(true);

        try {
            const data = await service.getAll();
            setInstitutions(data);
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
