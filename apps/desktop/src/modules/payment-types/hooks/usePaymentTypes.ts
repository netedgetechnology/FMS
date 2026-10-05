import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

import { LatestRequestGuard } from "@/core/async/LatestRequestGuard";

import { PaymentTypeService } from "../services";
import type { PaymentType } from "../types";
import { activePaymentTypeOptions } from "../utils";

// Every mounted usePaymentTypes() reloads when the master list changes
// (Settings -> Payment Types calls notifyPaymentTypesChanged after each
// add/rename/activate/deactivate), so an already-open selector picks up a
// new type without a remount.
const listeners = new Set<() => void>();

export function notifyPaymentTypesChanged(): void {
    for (const listener of listeners) {
        listener();
    }
}

// Called on every notifyPaymentTypesChanged(); returns an unsubscribe.
export function subscribePaymentTypesChanged(
    listener: () => void
): () => void {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

export function usePaymentTypes() {

    const [paymentTypes, setPaymentTypes] =
        useState<PaymentType[]>([]);

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState<string | null>(null);

    // See LatestRequestGuard - a slower stale load never overwrites a
    // newer one.
    const requestGuard = useRef(new LatestRequestGuard());

    const loadPaymentTypes =
        useCallback(async () => {
            const requestId = requestGuard.current.start();

            try {
                setLoading(true);
                setError(null);

                const data =
                    await new PaymentTypeService().getAll();

                if (requestGuard.current.isStale(requestId)) {
                    return;
                }

                setPaymentTypes(data);

            } catch (err) {

                if (requestGuard.current.isStale(requestId)) {
                    return;
                }

                console.error(
                    "PAYMENT TYPES LOAD ERROR:",
                    err
                );

                setError(
                    err instanceof Error
                        ? `${err.name}: ${err.message}`
                        : String(err)
                );

            } finally {
                if (!requestGuard.current.isStale(requestId)) {
                    setLoading(false);
                }
            }

        }, []);

    useEffect(() => {
        void loadPaymentTypes();

        return subscribePaymentTypesChanged(() => {
            void loadPaymentTypes();
        });
    }, [loadPaymentTypes]);

    // Stable between loads, so memoized selectors (Import Preview rows)
    // only re-render when the list actually changes.
    const activeOptions = useMemo(
        () => activePaymentTypeOptions(paymentTypes),
        [paymentTypes]
    );

    return {
        paymentTypes,
        activeOptions,
        loading,
        error,
        refresh: loadPaymentTypes,
    };
}
