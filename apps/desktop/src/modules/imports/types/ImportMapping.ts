import type {
    CsvColumnMapping,
    CsvImportType,
} from "@financeos/import-engine";

export interface ImportMapping {
    id: string;
    name: string;
    institutionName: string | null;
    importType: CsvImportType;
    headerSignature: string;
    headers: string[];
    mapping: CsvColumnMapping;
    createdAt: string;
    updatedAt: string;
}

export interface SaveImportMappingRequest {
    name: string;
    institutionName: string | null;
    importType: CsvImportType;
    headerSignature: string;
    headers: string[];
    mapping: CsvColumnMapping;
}
