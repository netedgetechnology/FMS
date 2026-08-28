export interface Document {
    id: string;
    name: string;
    documentType: string;
    filePath: string;
    fileSize: number;
    mimeType: string | null;
    checksum: string | null;
    relatedEntityType: string | null;
    relatedEntityId: string | null;
    description: string | null;
    createdAt: string;
    updatedAt: string;
}
