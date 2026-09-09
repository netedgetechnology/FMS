import { describe, expect, it } from "vitest";

import {
    detectTransactionChannel,
    normalizeTransactionChannel,
} from "../normalizer/transactionChannelDetector";

describe("detectTransactionChannel", () => {
    it("detects UPI from a UPI/P2A narration", () => {
        expect(
            detectTransactionChannel(
                "UPI/P2A/621333332818/ASHVINKUMAR T DALWANI/Sent u/UCO BANK"
            )
        ).toBe("UPI");
    });

    it("detects UPI from a UPI/P2M narration", () => {
        expect(
            detectTransactionChannel(
                "UPI/P2M/621303568358/Brownico/Sent u/YES BANK LIMITED YBS"
            )
        ).toBe("UPI");
    });

    it("detects IMPS", () => {
        expect(
            detectTransactionChannel(
                "IMPS/P2A/624214557709/HardikDAcharya/X717135/STATEBANKOFINDIA"
            )
        ).toBe("IMPS");
    });

    it("detects NEFT", () => {
        expect(
            detectTransactionChannel(
                "NEFT/IN42621556482010/TATA CAPITAL LIMITED/ICICI BANK LIMITED"
            )
        ).toBe("NEFT");
    });

    it("detects RTGS", () => {
        expect(
            detectTransactionChannel(
                "RTGS/MAHBR52026080324679176/MKS CONSTRO VENTURE PR/BANK OF MAHARASHTRA"
            )
        ).toBe("RTGS");
    });

    it("detects Cash from an ATM narration", () => {
        expect(
            detectTransactionChannel(
                "ATM WDL-1234567-SOME BRANCH"
            )
        ).toBe("CASH");
    });

    it("detects Cash from a CASH narration", () => {
        expect(
            detectTransactionChannel(
                "CASH DEPOSIT AT BRANCH"
            )
        ).toBe("CASH");
    });

    it("detects Cheque from a CHQ narration", () => {
        expect(
            detectTransactionChannel(
                "CHQ PAID 000123"
            )
        ).toBe("CHEQUE");
    });

    it("detects Cheque from a CHEQUE NO narration", () => {
        expect(
            detectTransactionChannel(
                "CHEQUE NO 000456 CLEARED"
            )
        ).toBe("CHEQUE");
    });

    it("is case-insensitive", () => {
        expect(
            detectTransactionChannel("upi/p2a/1/foo")
        ).toBe("UPI");

        expect(
            detectTransactionChannel("Neft/In4262/foo")
        ).toBe("NEFT");

        expect(
            detectTransactionChannel("cheque no 12")
        ).toBe("CHEQUE");
    });

    it("returns null for unrecognized/ambiguous text rather than guessing", () => {
        expect(
            detectTransactionChannel(
                "SALARY CREDIT FROM EMPLOYER"
            )
        ).toBeNull();

        expect(
            detectTransactionChannel(
                "MISC BANK CHARGES"
            )
        ).toBeNull();
    });

    it("returns null for blank/missing text", () => {
        expect(detectTransactionChannel()).toBeNull();
        expect(
            detectTransactionChannel(null, undefined, "")
        ).toBeNull();
    });

    it("does not partial-match inside an unrelated word", () => {
        // "UPIWARD" / "SUPINE" contain "UPI" as a substring but not as a
        // whole word - must not be detected as UPI.
        expect(
            detectTransactionChannel("UPIWARDS TRANSFER TEST")
        ).toBeNull();
    });

    it("detects Credit Card from a credit card bill payment narration", () => {
        expect(
            detectTransactionChannel(
                "CREDIT CARD BILL PAYMENT - XXXX1234"
            )
        ).toBe("CREDIT_CARD");
    });

    it("is case-insensitive for Credit Card too", () => {
        expect(
            detectTransactionChannel("credit card payment received")
        ).toBe("CREDIT_CARD");
    });

    it("checks multiple text sources together (description, payee, reference)", () => {
        expect(
            detectTransactionChannel(
                "Some generic narration",
                undefined,
                "NEFT-REF-001"
            )
        ).toBe("NEFT");
    });
});

describe("normalizeTransactionChannel", () => {
    it("normalizes casing and whitespace for a known channel", () => {
        expect(
            normalizeTransactionChannel(" upi ")
        ).toBe("UPI");

        expect(
            normalizeTransactionChannel("Cheque")
        ).toBe("CHEQUE");
    });

    it("normalizes an explicit 'Credit Card' column value", () => {
        expect(
            normalizeTransactionChannel("credit_card")
        ).toBe("CREDIT_CARD");

        expect(
            normalizeTransactionChannel(" Credit_Card ")
        ).toBe("CREDIT_CARD");
    });

    it("returns null for an unrecognized explicit value rather than guessing", () => {
        expect(
            normalizeTransactionChannel("Online")
        ).toBeNull();

        expect(
            normalizeTransactionChannel("POS")
        ).toBeNull();
    });

    it("returns null for blank/missing values", () => {
        expect(
            normalizeTransactionChannel(null)
        ).toBeNull();

        expect(
            normalizeTransactionChannel("")
        ).toBeNull();
    });
});
