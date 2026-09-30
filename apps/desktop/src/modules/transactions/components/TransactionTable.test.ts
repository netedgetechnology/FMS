import { describe, expect, it } from "vitest";

import type { Transaction } from "../types";

import { getStatusLabel } from "./TransactionTable";

describe("getStatusLabel", () => {
    it("displays PENDING as 'Pending'", () => {
        expect(getStatusLabel("PENDING")).toBe("Pending");
    });

    it("displays CLEARED as 'Cleared'", () => {
        expect(getStatusLabel("CLEARED")).toBe("Cleared");
    });

    it("falls back to the raw stored status for any value not in the label map", () => {
        expect(
            getStatusLabel("SOMETHING_NEW" as Transaction["status"])
        ).toBe("SOMETHING_NEW");
    });
});
