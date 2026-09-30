import type { BaseFinanceScope, FinanceScope } from "../types";

// ---------------------------------------------------------------------
// Category scope - Personal, Business, or both.
//
// Stored in the existing categories.finance_scope TEXT column as one of
// "PERSONAL" | "BUSINESS" | "BOTH". Every existing row already holds
// PERSONAL or BUSINESS, which mean exactly what they always did
// (Personal-only / Business-only) - so no stored data changes. A single
// value per category means a scope can never be assigned twice, and
// validation (here, in CategoryService and in the Rust CSV-import
// command) rejects anything else, including "no scope".
//
// Scopes are edited only on the Scopes screen (CategoryScopesDialog), as
// a Personal and a Business checkbox per category; these helpers convert
// between the two shapes. New categories start Personal; CSV import can
// set any scope.
// ---------------------------------------------------------------------

export const FINANCE_SCOPE_VALUES = ["PERSONAL", "BUSINESS", "BOTH"] as const;

export const ZERO_SCOPE_MESSAGE =
    "Select at least one scope: Personal and/or Business.";

export interface FinanceScopeFlags {
    personal: boolean;
    business: boolean;
}

export function isFinanceScope(value: unknown): value is FinanceScope {
    return (
        typeof value === "string" &&
        (FINANCE_SCOPE_VALUES as readonly string[]).includes(value)
    );
}

export function financeScopeFlags(
    scope: FinanceScope | string | null | undefined
): FinanceScopeFlags {
    return {
        personal: scope === "PERSONAL" || scope === "BOTH",
        business: scope === "BUSINESS" || scope === "BOTH",
    };
}

// null = no scope ticked (invalid - a category needs at least one).
export function financeScopeFromFlags(
    flags: FinanceScopeFlags
): FinanceScope | null {
    if (flags.personal && flags.business) {
        return "BOTH";
    }
    if (flags.personal) {
        return "PERSONAL";
    }
    if (flags.business) {
        return "BUSINESS";
    }
    return null;
}

// Is a category with this scope available in the given context? A BOTH
// category is in both Personal and Business.
export function financeScopeIncludes(
    scope: FinanceScope | string | null | undefined,
    context: BaseFinanceScope
): boolean {
    const flags = financeScopeFlags(scope);

    return context === "PERSONAL" ? flags.personal : flags.business;
}

// Does `outer` cover every scope in `inner`? (e.g. a parent category must
// be available wherever its sub-category is.)
export function financeScopeCovers(
    outer: FinanceScope | string | null | undefined,
    inner: FinanceScope | string | null | undefined
): boolean {
    const outerFlags = financeScopeFlags(outer);
    const innerFlags = financeScopeFlags(inner);

    return (
        (!innerFlags.personal || outerFlags.personal) &&
        (!innerFlags.business || outerFlags.business)
    );
}

export function financeScopeLabel(scope: FinanceScope | string): string {
    switch (scope) {
        case "PERSONAL":
            return "Personal";
        case "BUSINESS":
            return "Business";
        case "BOTH":
            return "Personal + Business";
        default:
            return scope;
    }
}

export function assertValidFinanceScope(
    scope: unknown
): asserts scope is FinanceScope {
    if (!isFinanceScope(scope)) {
        throw new Error(
            scope === "" || scope === null || scope === undefined
                ? ZERO_SCOPE_MESSAGE
                : `Invalid scope "${String(scope)}". ${ZERO_SCOPE_MESSAGE}`
        );
    }
}

// CSV "scope" cell -> FinanceScope. Accepts one or both of Personal /
// Business in any case, joined by +, &, /, |, ; or a (quoted) comma -
// e.g. "Business", "personal + business", "Business;Personal" - and
// "Both". Returns null for anything else (the row is then invalid).
// A repeated scope ("Personal+Personal") is just Personal.
export function parseFinanceScopeText(raw: string): FinanceScope | null {
    const text = raw.trim().toUpperCase();

    if (text === "BOTH") {
        return "BOTH";
    }

    const parts = text
        .split(/\s*(?:\+|&|\/|\||;|,|\bAND\b)\s*/)
        .filter(part => part.length > 0);

    if (parts.length === 0) {
        return null;
    }

    const flags: FinanceScopeFlags = { personal: false, business: false };

    for (const part of parts) {
        if (part === "PERSONAL") {
            flags.personal = true;
        } else if (part === "BUSINESS") {
            flags.business = true;
        } else {
            return null;
        }
    }

    return financeScopeFromFlags(flags);
}

// The Categories page Scope filter ("ALL" | "PERSONAL" | "BUSINESS"):
// a Personal + Business category shows under both.
export function matchesFinanceScopeFilter(
    scope: FinanceScope | string,
    filter: string
): boolean {
    if (filter === "PERSONAL" || filter === "BUSINESS") {
        return financeScopeIncludes(scope, filter);
    }

    return true;
}
