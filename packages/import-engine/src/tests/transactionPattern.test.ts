import { describe, expect, it } from "vitest";

import {
    extractTransactionPattern,
} from "../normalizer/transactionPattern";

describe("extractTransactionPattern", () => {
    it("collapses digit runs so repeats of the same recurring transaction share a pattern", () => {
        const a = extractTransactionPattern(
            "UPI/P2A/621333332818/ASHVINKUMAR T DALWANI/Sent u/UCO BANK"
        );

        const b = extractTransactionPattern(
            "UPI/P2A/699981234567/ASHVINKUMAR T DALWANI/Sent u/UCO BANK"
        );

        expect(a).not.toBeNull();
        expect(a).toBe(b);
    });

    it("is case-insensitive", () => {
        expect(
            extractTransactionPattern(
                "upi/p2a/123/john doe/sent u/hdfc bank"
            )
        ).toBe(
            extractTransactionPattern(
                "UPI/P2A/999/JOHN DOE/SENT U/HDFC BANK"
            )
        );
    });

    it("produces different patterns for genuinely different narrations", () => {
        const a = extractTransactionPattern(
            "UPI/P2A/1/ASHVINKUMAR T DALWANI/Sent u/UCO BANK"
        );

        const b = extractTransactionPattern(
            "NEFT/IN42621556482010/TATA CAPITAL LIMITED"
        );

        expect(a).not.toBe(b);
    });

    it("returns null for blank/missing text", () => {
        expect(extractTransactionPattern(null)).toBeNull();
        expect(extractTransactionPattern(undefined)).toBeNull();
        expect(extractTransactionPattern("")).toBeNull();
    });

    it("returns null for a pattern that is too short/generic to safely learn from", () => {
        expect(
            extractTransactionPattern("ATM 123")
        ).toBeNull();
    });

    it("collapses a leading transaction date alongside a variable transaction number", () => {
        const a = extractTransactionPattern(
            "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/"
        );

        const b = extractTransactionPattern(
            "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/"
        );

        expect(a).not.toBeNull();
        expect(a).toBe(b);
    });
});
