export interface Transaction {
  id: number;
  accountId: number;
  categoryId: number | null;
  payeeId: number | null;
  amount: number;
  transactionDate: string;
  description: string | null;
  referenceNumber: string | null;
  status: "PENDING" | "CLEARED";
  createdAt: string;
  updatedAt: string;
}
