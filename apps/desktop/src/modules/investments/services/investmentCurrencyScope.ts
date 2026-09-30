// ---------------------------------------------------------------------
// Investments - Phase 6 (mixed-currency portfolio totals)
//
// Every investment's transactions are in a single fixed currency (the
// currency-change guard in InvestmentService.update() ensures that),
// but a portfolio can span several investments in different
// currencies. Summing currentValue/totalCost/etc. across those would
// silently add incompatible units (e.g. INR + USD) as if they were
// one number.
//
// Mirrors the pattern already established for Budgets
// (resolveBudgetCurrencyScopes in modules/budgets/services/
// budgetReportView.ts): never merge currencies into one sum - instead
// resolve a single "primary" scope (default currency first, else
// alphabetical by code) to aggregate over, and let the caller expose
// that other currencies exist rather than mixing them in. When every
// investment shares one currency (the common case), this resolves to
// exactly that one currency and behaves exactly as before.
// ---------------------------------------------------------------------

export interface CurrencyScopeOption {
    id: string;
    code: string;
    isDefault: boolean;
}

/**
 * The single currency to aggregate investment totals over: the
 * default currency if any investment uses it, else the
 * alphabetically-first currency among the investments actually in
 * use. Returns null when there are no investments to scope (nothing
 * to aggregate).
 */
export function resolvePrimaryInvestmentCurrencyId(
    investments: readonly { currencyId: string }[],
    currencies: readonly CurrencyScopeOption[]
): string | null {
    const byId = new Map(
        currencies.map(currency => [currency.id, currency])
    );

    const distinct = Array.from(
        new Set(
            investments.map(
                investment => investment.currencyId
            )
        )
    );

    if (distinct.length === 0) {
        return null;
    }

    const sorted = distinct.sort((a, b) => {
        const left = byId.get(a);
        const right = byId.get(b);

        if (left?.isDefault && !right?.isDefault) {
            return -1;
        }

        if (right?.isDefault && !left?.isDefault) {
            return 1;
        }

        return (left?.code ?? a).localeCompare(
            right?.code ?? b
        );
    });

    return sorted[0];
}
