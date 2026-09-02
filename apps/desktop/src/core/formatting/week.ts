export type FirstDayOfWeek = "Monday" | "Sunday";

export function normalizeFirstDayOfWeek(
    value: string | null | undefined,
): FirstDayOfWeek {
    return value === "Sunday" ? "Sunday" : "Monday";
}

export function getWeekDayIndex(
    date: Date,
    firstDay: FirstDayOfWeek = "Monday",
): number {
    const day = date.getDay();

    if (firstDay === "Sunday") {
        return day;
    }

    return day === 0 ? 6 : day - 1;
}

export function startOfWeek(
    date: Date,
    firstDay: FirstDayOfWeek = "Monday",
): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);

    result.setDate(
        result.getDate() - getWeekDayIndex(result, firstDay),
    );

    return result;
}

export function endOfWeek(
    date: Date,
    firstDay: FirstDayOfWeek = "Monday",
): Date {
    const result = startOfWeek(date, firstDay);
    result.setDate(result.getDate() + 6);
    result.setHours(23, 59, 59, 999);

    return result;
}
