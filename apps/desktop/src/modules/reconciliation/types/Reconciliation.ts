import type { ReconciliationStatus } from "./ReconciliationStatus";

export interface Reconciliation {

    id: string;

    accountId: string;

    statementDate: string;

    statementBalance: number;

    systemBalance: number;

    difference: number;

    status: ReconciliationStatus;

    notes: string | null;

    reconciledAt: string | null;

    createdAt: string;

    updatedAt: string;

}

