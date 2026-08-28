export interface UpdateDocumentRequest {
    id: string;
    name: string;
    documentType: string;
    description?: string | null;
    relatedEntityType?: string | null;
    relatedEntityId?: string | null;
}
