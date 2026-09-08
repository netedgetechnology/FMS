import { describe, expect, it } from "vitest";

import { processPdf } from "../pipeline";

describe("PDF bank statement pipeline", () => {
    it("exports processPdf", () => {
        expect(processPdf).toBeTypeOf("function");
    });

    it("rejects invalid PDF content", async () => {
        const invalidPdf = new TextEncoder().encode(
            "not a real pdf",
        ).buffer;

        await expect(
            processPdf(invalidPdf),
        ).rejects.toThrow();
    });
});
