export type MoneyFormatOptions = {
    currency?: string;
    showDecimals?: boolean;
    locale?: string;
};

// Extracts just the currency symbol (e.g. "₹", "$", "€") for a 3-letter
// currency code, via the same Intl.NumberFormat currency formatting
// formatMoney already uses - never a hardcoded currency->symbol map.
// "narrowSymbol" avoids locale-disambiguated forms like "US$"/"A$", so
// USD and AUD both resolve to a plain "$", matching every other
// currency this returns just its bare symbol.
export function getCurrencySymbol(
    currency: string = "INR",
    locale: string = "en-IN",
): string {
    const part = new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
    })
        .formatToParts(0)
        .find(({ type }) => type === "currency");

    return part?.value ?? currency;
}

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
