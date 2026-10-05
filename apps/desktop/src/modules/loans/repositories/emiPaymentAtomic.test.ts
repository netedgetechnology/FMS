import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { emiPaymentErrorMessage } from "../components/emiPaymentErrorMessage";

import {
    EmiPaymentSaveError,
    recordEmiPaymentAtomic,
    reverseEmiPaymentAtomic,
} from "./emiPaymentAtomic";

// ---------------------------------------------------------------------
// What the user sees when an EMI payment write fails: a business-rule
// refusal keeps its clear message; a technical database error becomes a
// friendly message (raw cause logged, never shown) - never the bare
// "Failed to process EMI payment." with the reason hidden.
// ---------------------------------------------------------------------

afterEach(() => {
    vi.restoreAllMocks();
    invoke.mockReset();
});

const request = {} as Parameters<typeof recordEmiPaymentAtomic>[0];

describe("recordEmiPaymentAtomic", () => {
    it("invokes the atomic Rust command with the request", async () => {
        invoke.mockResolvedValue(undefined);

        await recordEmiPaymentAtomic(request);

        expect(invoke).toHaveBeenCalledWith("record_emi_payment_atomic", { request });
    });

    it("a refusal from the command becomes a plain Error with the user-facing reason", async () => {
        invoke.mockRejectedValue("EMI_PAYMENT_REFUSED: This loan is closed. No further payments can be recorded.");

        const error = await recordEmiPaymentAtomic(request).catch(e => e);

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(EmiPaymentSaveError);
        expect(error.message).toBe("This loan is closed. No further payments can be recorded.");
    });

    it("a technical database error becomes a friendly message, keeping the raw cause for diagnostics", async () => {
        const raw = "error returned from database: (code: 1) cannot commit - no transaction is active";
        invoke.mockRejectedValue(raw);

        const error = await recordEmiPaymentAtomic(request).catch(e => e);

        expect(error).toBeInstanceOf(EmiPaymentSaveError);
        expect(error.message).toMatch(/could not be saved because of a technical problem\. Nothing was recorded/);
        expect(error.message).not.toContain("transaction is active");
        expect(error.technicalDetail).toBe(raw);
    });
});

describe("reverseEmiPaymentAtomic", () => {
    it("invokes the atomic reverse command and maps a refusal", async () => {
        invoke.mockRejectedValue("EMI_PAYMENT_REFUSED: This payment record was not found. It may have already been reversed.");

        const error = await reverseEmiPaymentAtomic({} as Parameters<typeof reverseEmiPaymentAtomic>[0]).catch(e => e);

        expect(invoke).toHaveBeenCalledWith("reverse_emi_payment_atomic", expect.anything());
        expect(error.message).toBe("This payment record was not found. It may have already been reversed.");
    });
});

describe("emiPaymentErrorMessage (what the EMI dialog shows)", () => {
    it("shows a refusal's own message", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        expect(emiPaymentErrorMessage(new Error("Payment amount must be greater than zero."), "Failed to process EMI payment."))
            .toBe("Payment amount must be greater than zero.");
    });

    it("shows the friendly message for a technical failure and logs the raw cause", () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        const error = new EmiPaymentSaveError("The EMI payment could not be saved because of a technical problem. Nothing was recorded - please try again.", "SQLITE raw detail");

        const shown = emiPaymentErrorMessage(error, "Failed to process EMI payment.");

        expect(shown).toMatch(/technical problem/);
        expect(shown).not.toContain("SQLITE");
        expect(logged).toHaveBeenCalledWith("Failed to process EMI payment.", "SQLITE raw detail");
    });

    it("falls back to the generic message for an unknown non-Error value, and still logs it", () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(emiPaymentErrorMessage("some raw string", "Failed to process EMI payment.")).toBe("Failed to process EMI payment.");
        expect(logged).toHaveBeenCalledWith("Failed to process EMI payment.", "some raw string");
    });
});
