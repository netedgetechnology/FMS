import {
    useCallback,
    useEffect,
    useState,
} from "react";

import { EMIScheduleService } from "@/modules/loans/services/EMIScheduleService";

// Loads the { transaction id -> EMI interest portion } map that the
// budget spending engine (Phase 5) needs so a recorded loan EMI payment
// counts only its interest as budget expense - the principal repayment
// is a liability movement and never counts. Empty map = no recorded EMI
// payments, which leaves the engine on its plain face-value behaviour.
export function useEmiInterestByTransactionId() {
    const [
        emiInterestByTransactionId,
        setEmiInterestByTransactionId,
    ] = useState<ReadonlyMap<string, number>>(
        () => new Map()
    );

    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);

        try {
            const service = new EMIScheduleService();

            setEmiInterestByTransactionId(
                await service.getInterestByTransactionId()
            );
        } catch (error) {
            console.error(
                "Failed to load EMI interest map:",
                error
            );

            setEmiInterestByTransactionId(new Map());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    return {
        emiInterestByTransactionId,
        loading,
        refresh: load,
    };
}
