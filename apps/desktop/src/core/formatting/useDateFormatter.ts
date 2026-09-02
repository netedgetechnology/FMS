import { useCallback } from "react";

import { useDisplaySettings } from "./useDisplaySettings";

export function formatDateValue(
    value: string | Date | null | undefined,
    dateFormat: string,
): string {
    if (!value) {
        return "";
    }

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = String(date.getFullYear());

    switch (dateFormat) {
        case "MM/DD/YYYY":
            return `${month}/${day}/${year}`;

        case "YYYY-MM-DD":
            return `${year}-${month}-${day}`;

        case "DD/MM/YYYY":
        default:
            return `${day}/${month}/${year}`;
    }
}

export function useDateFormatter() {
    const { dateFormat } = useDisplaySettings();

    return useCallback(
        (value: string | Date | null | undefined) =>
            formatDateValue(value, dateFormat),
        [dateFormat],
    );
}
