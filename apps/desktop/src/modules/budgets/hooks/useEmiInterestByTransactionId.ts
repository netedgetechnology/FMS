import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import { InitialLoadTracker } from "@/core/async/InitialLoadTracker";

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

    // Only the first calculation shows the loading state; a refresh after
    // a mutation keeps the current figures on screen until the new ones
    // arrive (InitialLoadTracker). A failed calculation still clears them
    // and shows the error, exactly as before - figures that could not be
    // recalculated are never shown as current.
    const loadTracker = useRef(new InitialLoadTracker());

    const load = useCallback(async () => {
        if (loadTracker.current.showsLoading()) {
            setLoading(true);
        }

        try {
            const service = new EMIScheduleService();

            setEmiInterestByTransactionId(
                await service.getInterestByTransactionId()
            );
            loadTracker.current.markLoaded();
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
