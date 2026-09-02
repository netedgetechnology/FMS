import { useCallback } from "react";

import { formatMoney } from "./formatMoney";
import { useDisplaySettings } from "./useDisplaySettings";

export function useMoneyFormatter() {
    const { showDecimals, defaultCurrency } = useDisplaySettings();

    return useCallback(
        (
            value: number,
            currency: string = defaultCurrency,
            locale: string = "en-IN",
        ) =>
            formatMoney(value, {
                currency,
                locale,
                showDecimals,
            }),
        [showDecimals, defaultCurrency],
    );
}

