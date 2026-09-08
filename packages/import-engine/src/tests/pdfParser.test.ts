import { describe, expect, it } from "vitest";

import { parsePdf } from "../parser/pdfParser";

describe("PDF parser", () => {
    it("exports parsePdf", () => {
        expect(parsePdf).toBeTypeOf("function");
    });

    it("rejects invalid PDF content", async () => {
        const content =
            new TextEncoder().encode(
                "not a pdf",
            ).buffer;

        await expect(
            parsePdf(content),
        ).rejects.toBeDefined();
    });
});
