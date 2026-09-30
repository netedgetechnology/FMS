import {
    parseCsv,
    parseExcel,
    parsePdf,
    parsePdfText,
    getExcelSheetNames,
    type PdfParseResult,
} from "./parser";

import {
    extractPdfTransactions,
    rowText,
} from "./parser/pdfTransactionExtractor";

import {
    detectCsvColumns,
} from "./parser/columnDetector";

import {
    detectInstitutionName,
} from "./parser/institutionDetector";

import {
    normalizeCsvRows,
    type CsvImportType,
} from "./normalizer/csvNormalizer";

import {
    detectLoanScheduleColumns,
} from "./parser/loanColumnDetector";

import {
    normalizeLoanScheduleRows,
} from "./normalizer/loanScheduleNormalizer";

import {
    reconcileBalanceChain,
    validateCandidates,
    validateLoanScheduleCandidates,
    type BalanceReconciliationResult,
} from "./validation";

import type {
    CsvColumnMapping,
    CsvDocument,
    ImportValidationResult,
    NormalizedTransactionCandidate,
    LoanScheduleColumnMapping,
    NormalizedLoanScheduleCandidate,
} from "./types";

export interface CsvProcessingResult {
    document: CsvDocument;
    mapping: CsvColumnMapping;
    candidates: NormalizedTransactionCandidate[];
    validation: ImportValidationResult;
    // Best-effort institution/bank name detected from the file's own
    // non-transaction text (see detectInstitutionName). null when
    // undetectable, or when the source format has no such text to scan
    // (Excel/PDF) - never a guess, and never required to be accurate; the
    // UI always lets the user confirm/edit it.
    institutionName: string | null;
}

export interface LoanScheduleCsvProcessingResult {
    document: CsvDocument;
    mapping: LoanScheduleColumnMapping;
    candidates: NormalizedLoanScheduleCandidate[];
    validation: ImportValidationResult;
    missingRequiredFields: string[];
    ambiguousFields: string[];
}

export interface CsvPreviewResult
    extends CsvProcessingResult {
    duplicates: Map<number, string>;
}

export interface ExcelProcessingResult
    extends CsvProcessingResult {
    sheetName: string;
}

export interface PdfProcessingResult
    extends CsvProcessingResult {
    transactionLines: ReturnType<
        typeof extractPdfTransactions
    >["transactionLines"];
    // The statement's own running-balance arithmetic checked against
    // every candidate's amount + direction (see reconcileBalanceChain).
    // Diagnostic only - it never changes a candidate.
    balanceReconciliation: BalanceReconciliationResult;
}

export function processCsv(
    content: string,
    importType: CsvImportType = "BANK_CSV",
): CsvProcessingResult {
    const document = parseCsv(content);

    const result = processDocument(
        document,
        importType,
    );

    return {
        ...result,
        institutionName:
            detectInstitutionName(content),
    };
}

export function processLoanScheduleCsv(
    content: string,
): LoanScheduleCsvProcessingResult {
    const document = parseCsv(content);

    const detection =
        detectLoanScheduleColumns(document);

    const candidates =
        normalizeLoanScheduleRows(
            document,
            detection.mapping,
        );

    const validation =
        validateLoanScheduleCandidates(
            candidates,
        );

    return {
        document,
        mapping: detection.mapping,
        candidates,
        validation,
        missingRequiredFields:
            detection.missingRequiredFields,
        ambiguousFields:
            detection.ambiguousFields,
    };
}

export function processExcel(
    content: ArrayBuffer,
    sheetName?: string,
    importType: CsvImportType = "BANK_CSV",
    password?: string,
): ExcelProcessingResult {
    const selectedSheet =
        sheetName ??
        getFirstExcelSheetName(content, password);

    const document = parseExcel(
        content,
        {
            sheetName: selectedSheet,
            password,
        },
    );

    const result =
        processDocument(
            document,
            importType,
        );

    return {
        ...result,
        sheetName: selectedSheet,
    };
}

export async function processPdf(
    content: ArrayBuffer,
    importType: CsvImportType = "BANK_CSV",
): Promise<PdfProcessingResult> {
    return processParsedPdf(
        await parsePdf(content),
        importType,
    );
}

// processPdf for text pdf-parse already extracted - the same pipeline
// from extraction onward, with no PDF binary involved. Used by the PDF
// compatibility fixtures (tests/pdfCompatibility).
export function processPdfText(
    text: string,
    importType: CsvImportType = "BANK_CSV",
): PdfProcessingResult {
    return processParsedPdf(
        parsePdfText(text),
        importType,
    );
}

function processParsedPdf(
    parsed: PdfParseResult,
    importType: CsvImportType,
): PdfProcessingResult {

    // pdfParser.ts's own structural extraction already fully parsed
    // this document into the canonical bank-transaction shape when
    // parsed.structured is true - the generic second pass
    // (extractPdfTransactions, meant for header-row detection and
    // continuation-line reconstruction on arbitrary tabular PDF text)
    // is unnecessary there, and its own weaker heuristics have been
    // shown to silently corrupt already-correct data when they
    // disagree with pdfParser.ts's (e.g. a 2-digit-year date it
    // doesn't recognise, treated as non-dated continuation text - see
    // the SBI Credit Card PDF investigation). It is still needed, and
    // still runs, for a document pdfParser.ts could not structure
    // itself (parsed.structured === false).
    const extracted = parsed.structured
        ? {
              document: parsed.document,
              transactionLines:
                  parsed.document.rows.map(
                      (row) => ({
                          rowNumber:
                              row.rowNumber,
                          text: rowText(row),
                      }),
                  ),
          }
        : extractPdfTransactions(
              parsed.document,
          );

    const result =
        processDocument(
            extracted.document,
            importType,
        );

    return {
        ...result,
        transactionLines:
            extracted.transactionLines,
        balanceReconciliation:
            reconcileBalanceChain(
                result.candidates,
            ),
    };
}

function getFirstExcelSheetName(
    content: ArrayBuffer,
    password?: string,
): string {
    const sheetNames =
        getExcelSheetNames(content, password);

    if (sheetNames.length === 0) {
        throw new Error(
            "The Excel workbook does not contain any sheets.",
        );
    }

    return sheetNames[0];
}

function processDocument(
    document: CsvDocument,
    importType: CsvImportType,
): CsvProcessingResult {
    const detection =
        detectCsvColumns(document);

    return processDocumentWithMapping(
        document,
        detection.mapping,
        importType,
    );
}

// Re-normalizes an already-parsed document against a (possibly
// user-edited) column mapping, without re-reading or re-parsing the
// source file. Used by the "Detected Mapping" UI to let a user correct an
// uncertain auto-detected mapping and immediately see the resulting
// candidates/validation.
export function processDocumentWithMapping(
    document: CsvDocument,
    mapping: CsvColumnMapping,
    importType: CsvImportType = "BANK_CSV",
): CsvProcessingResult {
    const candidates =
        normalizeCsvRows(
            document.rows,
            mapping,
            document.headers,
            importType,
        );

    const validation =
        validateCandidates(candidates);

    return {
        document,
        mapping,
        candidates,
        validation,
        institutionName: null,
    };
}
