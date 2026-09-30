// A persisted, unfinished Import Preview (migration 042) - see
// services/importDraft.ts for what the two JSON payloads hold.

// Everything needed to offer recovery ("Unfinished Import Found") without
// reading the large preview payload.
export interface ImportDraftSummary {
    id: string;
    formatVersion: number;
    accountId: string;
    importType: string;
    fileName: string;
    rowCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface ImportDraftRecord extends ImportDraftSummary {
    previewJson: string;
    stateJson: string;
}
