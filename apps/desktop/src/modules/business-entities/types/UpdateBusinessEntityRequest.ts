export interface UpdateBusinessEntityRequest {
    id: string;

    name: string;

    legalName?: string | null;

    taxIdentifier?: string | null;

    currencyId: string;

    description?: string | null;

    isActive: boolean;
}
