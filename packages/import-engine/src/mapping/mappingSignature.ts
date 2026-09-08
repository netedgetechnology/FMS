// A stable, order-insensitive fingerprint of a source file's column
// structure, used to recognize "this is the same statement format I've
// seen before" so a previously-confirmed column mapping can be reused.
//
// Deliberately based on structure alone (headers + import type), never on
// the detected institution name - two different statement layouts from
// the same bank must never collide, and a coincidental header overlap
// between two different institutions is vanishingly unlikely.
function normalizeHeaderForSignature(
    header: string
): string {
    return header
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

export function computeHeaderSignature(
    headers: string[],
    importType: string
): string {
    const normalized = headers
        .map(normalizeHeaderForSignature)
        .filter(header => header.length > 0)
        .sort();

    return `${importType}::${normalized.join("|")}`;
}
