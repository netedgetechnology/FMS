import { describe, expect, it } from "vitest";

import {
    EMI_DIALOG_HORIZONTAL_CHROME_PX,
    EMI_DIALOG_MIN_WIDTH_PX,
    EMI_DIALOG_SCREEN_MARGIN_PX,
    emiDialogLayout,
} from "./emiScheduleLayout";

// The EMI Schedule dialog is sized to its table - never a fixed width,
// never wider than the window, never a horizontal scrollbar.
describe("emiDialogLayout", () => {
    it("fits the dialog exactly to a table that fits the window", () => {
        expect(emiDialogLayout(1180, 1536)).toEqual({ width: 1180 + EMI_DIALOG_HORIZONTAL_CHROME_PX, fits: true });
    });

    it("rounds a fractional table width up, so the last column is never shaved", () => {
        expect(emiDialogLayout(1180.4, 1536).width).toBe(1181 + EMI_DIALOG_HORIZONTAL_CHROME_PX);
    });

    it("never shrinks below the minimum for a short table", () => {
        expect(emiDialogLayout(400, 1536)).toEqual({ width: EMI_DIALOG_MIN_WIDTH_PX, fits: true });
    });

    it("caps at the window minus a margin on each side, and reports that the table does not fit", () => {
        expect(emiDialogLayout(1500, 1400)).toEqual({ width: 1400 - 2 * EMI_DIALOG_SCREEN_MARGIN_PX, fits: false });
    });

    it("never exceeds the window even when it is narrower than the minimum", () => {
        expect(emiDialogLayout(400, 700).width).toBe(700 - 2 * EMI_DIALOG_SCREEN_MARGIN_PX);
    });
});
