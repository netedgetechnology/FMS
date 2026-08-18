export interface BusinessEntity {
    id: string;

    name: string;

    legalName: string | null;

    taxIdentifier: string | null;

    currencyId: string;

    description: string | null;

    isActive: boolean;

    createdAt: string;

    updatedAt: string;
}
