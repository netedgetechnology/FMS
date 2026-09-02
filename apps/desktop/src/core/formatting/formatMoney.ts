export type MoneyFormatOptions = {
    currency?: string;
    showDecimals?: boolean;
    locale?: string;
};

export function formatMoney(
    value: number,
    options: MoneyFormatOptions = {},
): string {
    const {
        currency = "INR",
        showDecimals = true,
        locale = "en-IN",
    } = options;

    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: showDecimals ? 2 : 0,
        maximumFractionDigits: showDecimals ? 2 : 0,
    }).format(Number.isFinite(value) ? value : 0);
}
