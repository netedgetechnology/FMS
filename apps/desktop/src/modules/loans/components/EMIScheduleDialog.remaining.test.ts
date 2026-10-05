import { describe, expect, it } from "vitest";

import { remainingAmount } from "./EMIScheduleDialog";

// The amount the EMI dialog pre-fills ("Complete Payment") and checks the
// typed amount against: always a clean paise value, never a float tail
// such as 82224.39000000001.
describe("EMIScheduleDialog remainingAmount", () => {
    it("after the user's Rs 68,943.00 partial payment on Rs 1,51,167.39, exactly 82,224.39 remains", () => {
        expect(151167.39 - 68943).not.toBe(82224.39); // the raw float the dialog used to show
        expect(remainingAmount({ totalAmount: 151167.39, paidAmount: 68943 })).toBe(82224.39);
    });

    it("after a completing-first payment of 82,224.39, exactly 68,943 remains", () => {
        expect(remainingAmount({ totalAmount: 151167.39, paidAmount: 82224.39 })).toBe(68943);
    });

    it("is the full EMI when nothing is paid, and never negative", () => {
        expect(remainingAmount({ totalAmount: 151167.39, paidAmount: null })).toBe(151167.39);
        expect(remainingAmount({ totalAmount: 100, paidAmount: 150 })).toBe(0);
    });

    it("a typed amount equal to what remains is not treated as exceeding it", () => {
        const remaining = remainingAmount({ totalAmount: 151167.39, paidAmount: 68943 });

        expect(Number("82224.39") > remaining).toBe(false);
    });
});
