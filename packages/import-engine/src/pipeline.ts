import {
    parseCsv,
} from "./parser";

import {
    detectCsvColumns,
} from "./parser/columnDetector";

import {
    normalizeCsvRows,
    type CsvImportType,
} from "./normalizer/csvNormalizer";

import {
    validateCandidates,
} from "./validation";

import type {
    CsvColumnMapping,
    CsvDocument,
    ImportValidationResult,
    NormalizedTransactionCandidate,
} from "./types";

export interface CsvProcessingResult {
    document: CsvDocument;
    mapping: CsvColumnMapping;
    candidates: NormalizedTransactionCandidate[];
    validation: ImportValidationResult;
}

export interface CsvPreviewResult
    extends CsvProcessingResult {
    duplicates: Map<number, string>;
}


export function processCsv(
    content: string,
    importType: CsvImportType = "BANK_CSV"
): CsvProcessingResult {
    const document =
        parseCsv(content);

    const detection =
        detectCsvColumns(document);

    const candidates =
        normalizeCsvRows(
            document.rows,
            detection.mapping,
            document.headers,
            importType
        );

    const validation =
        validateCandidates(candidates);

    return {
        document,
        mapping: detection.mapping,
        candidates,
        validation,
    };
}

