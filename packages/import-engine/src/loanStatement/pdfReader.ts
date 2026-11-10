// Reads a PDF into positioned text for the statement engine. Local only: the
// file goes to pdf.js in this process and nowhere else. Uses pdf.js's public
// API, at the same version as the worker shipped in the app.

import { getDocument, GlobalWorkerOptions, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { documentFromItems, type RawTextItem, type StatementDocument } from "./layout";

interface PdfTextItem {
    str?: string;
    transform?: number[];
    width?: number;
    height?: number;
}

export type ReadStatementResult =
    | { status: "OK"; document: StatementDocument }
    | { status: "PASSWORD_REQUIRED" | "PASSWORD_INCORRECT" };

const IMAGE_OPERATORS: ReadonlySet<number> = new Set([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
]);

export async function readStatementPdf(content: ArrayBuffer | Uint8Array, password?: string): Promise<ReadStatementResult> {
    if (typeof window !== "undefined") {
        GlobalWorkerOptions.workerSrc = new URL("/pdf.worker.mjs", window.location.origin).toString();
    }

    // pdf.js takes ownership of the buffer it is given, so it gets a copy.
    const data = (content instanceof Uint8Array ? content : new Uint8Array(content)).slice();
    const task = getDocument({ data, ...(password ? { password } : {}), isEvalSupported: false, verbosity: 0 });

    try {
        const handle = await task.promise;
        const pages: RawTextItem[][] = [];
        const imageOnlyPages: number[] = [];

        for (let pageNumber = 1; pageNumber <= handle.numPages; pageNumber += 1) {
            const page = await handle.getPage(pageNumber);
            const { items } = await page.getTextContent();
            const textItems = (items as PdfTextItem[]).flatMap(item => {
                if (!item.str?.trim() || !item.transform) return [];

                return [{
                    x: item.transform[4]!,
                    y: item.transform[5]!,
                    width: item.width ?? 0,
                    height: item.height || Math.abs(item.transform[3]!) || 10,
                    text: item.str,
                }];
            });

            if (textItems.length === 0) {
                const { fnArray } = await page.getOperatorList();
                if (fnArray.some(operator => IMAGE_OPERATORS.has(operator))) imageOnlyPages.push(pageNumber);
            }

            pages.push(textItems);
        }

        return { status: "OK", document: { ...documentFromItems(pages), imageOnlyPages } };
    } catch (error) {
        const failure = error as { name?: string; code?: number } | null;

        if (failure?.name === "PasswordException") {
            return { status: failure.code === 2 ? "PASSWORD_INCORRECT" : "PASSWORD_REQUIRED" };
        }

        throw error;
    } finally {
        await task.destroy();
    }
}
