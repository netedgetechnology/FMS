// ---------------------------------------------------------------------
// Loans - Phase 2 (cross-module financial consistency)
//
// A loan's terms - and every payment made against it - are always in
// one fixed currency, but a user can hold several loans in different
// currencies. Summing outstandingPrincipal across those would silently
// add incompatible units (e.g. INR + USD) as if they were one number.
//
// Mirrors the pattern already established for Investments
// (resolvePrimaryInvestmentCurrencyId in modules/investments/services/
// investmentCurrencyScope.ts, itself mirroring Budgets'
// resolveBudgetCurrencyScopes): never merge currencies into one sum -
// instead resolve a single "primary" scope (default currency first,
// else alphabetical by code) to aggregate over, and let the caller
// expose that other currencies exist rather than mixing them in. When
// every loan shares one currency (the common case), this resolves to
// exactly that one currency and behaves exactly as before.
// ---------------------------------------------------------------------

export interface CurrencyScopeOption {
    id: string;
    code: string;
    isDefault: boolean;
}

/**
 * The single currency to aggregate loan totals over: the default
 * currency if any loan uses it, else the alphabetically-first currency
 * among the loans actually in use. Returns null when there are no
 * loans to scope (nothing to aggregate).
 */
export function resolvePrimaryLoanCurrencyId(
    loans: readonly { currencyId: string }[],
    currencies: readonly CurrencyScopeOption[]
): string | null {
    const byId = new Map(
        currencies.map(currency => [currency.id, currency])
    );

    const distinct = Array.from(
        new Set(loans.map(loan => loan.currencyId))
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

export interface OutstandingLoanSummary {
    outstandingPrincipal: number;
    currencyCode: string | null;
    hasOtherCurrencies: boolean;
}

/**
 * The Accounts "Loans" card's outstanding-principal figure: CLOSED
 * loans excluded (they should already be at 0, and this mirrors the
 * same exclusion DashboardService.getSummary uses for net worth's loan
 * liability), then scoped to one resolved primary currency so loans in
 * different currencies are never summed together.
 */
export function computeOutstandingLoanSummary(
    loans: readonly {
        currencyId: string;
        status: string;
        outstandingPrincipal: number;
    }[],
    currencies: readonly CurrencyScopeOption[]
): OutstandingLoanSummary {
    const openLoans = loans.filter(
        loan => loan.status !== "CLOSED"
    );

    const primaryCurrencyId = resolvePrimaryLoanCurrencyId(
        openLoans,
        currencies
    );

    const currencyCode =
        currencies.find(
            currency => currency.id === primaryCurrencyId
        )?.code ?? null;

    const hasOtherCurrencies =
        new Set(openLoans.map(loan => loan.currencyId))
            .size > 1;

    const outstandingPrincipal = openLoans
        .filter(
            loan => loan.currencyId === primaryCurrencyId
        )
        .reduce(
            (total, loan) =>
                total + Number(loan.outstandingPrincipal ?? 0),
            0
        );

    return {
        outstandingPrincipal,
        currencyCode,
        hasOtherCurrencies,
    };
}
