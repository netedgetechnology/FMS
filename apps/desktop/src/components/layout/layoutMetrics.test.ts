import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
    APP_HEADER_HEIGHT_PX,
    APP_SIDEBAR_WIDTH_PX,
    getToasterPlacement,
    TOAST_SINGLE_LINE_HEIGHT_PX,
} from "./layoutMetrics";

// No component render / browser test setup exists in this repo (vitest
// runs with environment: "node"), so the global toast area is checked
// through its placement function plus the source it is wired into.

const src = path.resolve(__dirname, "../..");

const read = (relative: string) =>
    readFileSync(path.join(src, relative), "utf-8");

describe("layout metrics mirror the real shell", () => {
    it("AppSidebar is 220px wide", () => {
        expect(APP_SIDEBAR_WIDTH_PX).toBe(220);
        expect(read("components/layout/AppSidebar.tsx")).toContain(
            `w-[${APP_SIDEBAR_WIDTH_PX}px]`
        );
    });

    it("AppHeader is h-16 (64px) tall", () => {
        expect(APP_HEADER_HEIGHT_PX).toBe(64);
        expect(read("components/layout/AppHeader.tsx")).toMatch(
            /<header className="[^"]*\bh-16\b/
        );
    });

    it("page content (titles, subtitles, header actions) starts below the header", () => {
        const layout = read("components/layout/AppLayout.tsx");

        // AppHeader, then <main> - the page's PageHeader is inside it.
        expect(layout.indexOf("<AppHeader />")).toBeGreaterThan(-1);
        expect(layout.indexOf("<main")).toBeGreaterThan(
            layout.indexOf("<AppHeader />")
        );
    });
});

describe("global toast placement", () => {
    const placement = getToasterPlacement();
    const topPx = Number.parseFloat(placement.top);

    it("sits inside the header bar, above where page content begins", () => {
        expect(topPx).toBeGreaterThanOrEqual(4);
        expect(topPx + TOAST_SINGLE_LINE_HEIGHT_PX).toBeLessThanOrEqual(
            APP_HEADER_HEIGHT_PX
        );
        // Vertically centred in the bar (within a pixel of rounding).
        const bottomGap =
            APP_HEADER_HEIGHT_PX - TOAST_SINGLE_LINE_HEIGHT_PX - topPx;

        expect(Math.abs(bottomGap - topPx)).toBeLessThanOrEqual(1);
    });

    it("is centred over the content column, not the whole window", () => {
        expect(placement.centerShift).toBe(
            `${APP_SIDEBAR_WIDTH_PX / 2}px`
        );

        // Window 1400px (tauri minWidth): content column 220..1400,
        // centre 810 = 700 (window centre) + 110 (shift).
        const windowWidth = 1400;
        const toastCentre =
            windowWidth / 2 + Number.parseFloat(placement.centerShift);

        expect(toastCentre).toBe(
            APP_SIDEBAR_WIDTH_PX + (windowWidth - APP_SIDEBAR_WIDTH_PX) / 2
        );
        // The 356px toast stays clear of the sidebar.
        expect(toastCentre - 356 / 2).toBeGreaterThan(APP_SIDEBAR_WIDTH_PX);
    });

    it("the shared Toaster uses it for every toast type, top-center", () => {
        const toaster = read("components/ui/sonner.tsx");

        expect(toaster).toContain('position="top-center"');
        expect(toaster).toContain("getToasterPlacement()");
        expect(toaster).toContain("offset={{ top: placement.top }}");
        expect(toaster).toContain(
            '"--finance-toaster-center-shift": placement.centerShift'
        );
        // No per-type position overrides - success / error / warning /
        // info all share the one toaster.
        expect(toaster).not.toMatch(/position=\{/);
    });

    it("globals.css applies the content-column shift to the toaster", () => {
        expect(read("styles/globals.css")).toMatch(
            /\[data-sonner-toaster\]\[data-x-position="center"\]\s*\{\s*left:\s*calc\(50% \+ var\(--finance-toaster-center-shift, 0px\)\)/
        );
    });

    it("the Toaster is mounted once, app-wide - no page-specific toasters", () => {
        expect(read("App.tsx")).toContain("<Toaster />");
        expect(
            read("modules/accounts/pages/AccountsPage.tsx")
        ).not.toContain("<Toaster");
    });
});
