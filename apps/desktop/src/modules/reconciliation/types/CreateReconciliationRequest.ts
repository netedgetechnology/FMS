export interface CreateReconciliationRequest {

    accountId: string;

    statementDate: string;

    statementBalance: number;

    notes?: string | null;

}
