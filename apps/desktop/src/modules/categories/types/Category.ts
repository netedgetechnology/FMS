import {
    CategoryTransferDirection,
    CategoryType,
    FinanceScope,
} from ".";

export interface Category {
    id: string;

    parentId: string | null;

    name: string;

    categoryType: CategoryType;

    /**
     * TRANSFER categories only: the direction a transfer in this category
     * goes - "IN" (money into the account) or "OUT" (money out of it).
     * null = used both ways (e.g. Bank Transfer); always null for an
     * Income / Expense category. Optional for hand-built objects.
     */
    transferDirection?: CategoryTransferDirection | null;

    financeScope: FinanceScope;

    businessEntityId: string | null;

    description: string | null;

    isActive: boolean;

    createdAt: string;

    updatedAt: string;
}
