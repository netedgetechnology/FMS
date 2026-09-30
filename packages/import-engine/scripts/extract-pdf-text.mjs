// Dumps a statement PDF's text exactly as the app's PDF importer sees it
// (same pdf-parse library, same getText() call), for building a PDF
// compatibility fixture - see src/tests/pdfCompatibility/README.md.
//
//   cd packages/import-engine
//   node scripts/extract-pdf-text.mjs <statement.pdf> <out.txt>
//
// The output contains real account data. Anonymise it before committing.
import { readFileSync, writeFileSync } from "node:fs";

import { PDFParse } from "pdf-parse";

const [input, output] = process.argv.slice(2);

if (!input || !output) {
    console.error(
        "Usage: node scripts/extract-pdf-text.mjs <statement.pdf> <out.txt>",
    );
    process.exit(1);
}

const parser = new PDFParse({
    data: new Uint8Array(readFileSync(input)),
});

try {
    const { text } = await parser.getText();

    writeFileSync(output, text);

    console.log(
        `Wrote ${text.length} characters to ${output}. Anonymise before committing.`,
    );
} finally {
    await parser.destroy();
}
