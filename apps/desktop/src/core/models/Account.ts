export type AccountType =
  | "BANK"
  | "CASH"
  | "CREDIT_CARD"
  | "LOAN"
  | "INVESTMENT"
  | "WALLET";

export interface Account {
  id: number;
  name: string;
  accountType: AccountType;
  institutionId: number | null;
  accountNumber: string | null;
  currencyCode: string;
  openingBalance: number;
  currentBalance: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
