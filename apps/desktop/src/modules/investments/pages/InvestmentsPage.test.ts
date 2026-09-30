import { describe, expect, it } from "vitest";

import { getInvestmentSymbolDisplay } from "./InvestmentsPage";

// Regression test: an investment created without a Symbol used to render
// as mojibake ("â€”") in the table instead of a clean em dash. The fallback
// is display-only - it must never be written back as the stored symbol -
// so it's exercised here as a pure function rather than a save round-trip.

describe("getInvestmentSymbolDisplay", () => {
    it("renders a clean em dash when the symbol is null", () => {
        expect(getInvestmentSymbolDisplay(null)).toBe(
            "—"
        );
    });

    it("renders a clean em dash when the symbol is an empty string", () => {
        expect(getInvestmentSymbolDisplay("")).toBe(
            "—"
        );
    });

    it("renders a clean em dash when the symbol is undefined", () => {
        expect(
            getInvestmentSymbolDisplay(undefined)
        ).toBe("—");
    });

    it("never renders the mojibake byte sequence", () => {
        expect(getInvestmentSymbolDisplay(null)).not.toBe(
            "â€”"
        );
    });

    it("renders a real symbol unchanged", () => {
        expect(
            getInvestmentSymbolDisplay("AAPL")
        ).toBe("AAPL");
    });
});
