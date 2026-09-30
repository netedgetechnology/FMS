import { describe, expect, it } from "vitest";

import { evaluateBulkTransactionDelete } from "./bulkTransactionDeleteGuard";

describe("evaluateBulkTransactionDelete", () => {
    it("allows an ordinary-only batch with no EMI-linked transactions", () => {
        const decision = evaluateBulkTransactionDelete(
            ["txn-1", "txn-2", "txn-3"],
            []
        );

        expect(decision).toEqual({
            allowed: true,
            blockedTransactionIds: [],
            message: null,
        });
    });

    it("blocks a batch containing exactly one EMI-linked transaction, with a singular message", () => {
        const decision = evaluateBulkTransactionDelete(
            ["txn-1", "txn-2", "txn-3"],
            ["txn-2"]
        );

        expect(decision.allowed).toBe(false);
        expect(decision.blockedTransactionIds).toEqual([
            "txn-2",
        ]);
        expect(decision.message).toMatch(
            /1 of the selected transaction records a loan emi payment/i
        );
        expect(decision.message).toMatch(
            /reverse the payment first/i
        );
        expect(decision.message).toMatch(
            /no transactions were deleted/i
        );
    });

    it("blocks a batch containing multiple EMI-linked transactions, with a plural message naming the count", () => {
        const decision = evaluateBulkTransactionDelete(
            ["txn-1", "txn-2", "txn-3", "txn-4"],
            ["txn-2", "txn-4"]
        );

        expect(decision.allowed).toBe(false);
        expect(
            decision.blockedTransactionIds.sort()
        ).toEqual(["txn-2", "txn-4"]);
        expect(decision.message).toMatch(
            /2 of the selected transactions record a loan emi payment/i
        );
        expect(decision.message).toMatch(
            /reverse the payments first/i
        );
    });

    it("blocks a mixed batch of ordinary and EMI-linked transactions in full - nothing is partially allowed", () => {
        const decision = evaluateBulkTransactionDelete(
            ["txn-ordinary-1", "txn-emi-1", "txn-ordinary-2"],
            ["txn-emi-1"]
        );

        expect(decision.allowed).toBe(false);
        expect(decision.blockedTransactionIds).toEqual([
            "txn-emi-1",
        ]);
    });

    it("treats an empty selection as allowed with nothing blocked", () => {
        const decision = evaluateBulkTransactionDelete(
            [],
            []
        );

        expect(decision).toEqual({
            allowed: true,
            blockedTransactionIds: [],
            message: null,
        });
    });

    it("ignores an EMI-linked id that isn't part of the current selection", () => {
        const decision = evaluateBulkTransactionDelete(
            ["txn-1", "txn-2"],
            ["txn-unrelated"]
        );

        expect(decision.allowed).toBe(true);
        expect(decision.blockedTransactionIds).toEqual(
            []
        );
    });
});
