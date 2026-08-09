export type CategoryType = "INCOME" | "EXPENSE" | "TRANSFER";

export interface Category {
  id: number;
  parentId: number | null;
  name: string;
  type: CategoryType;
  color: string | null;
  icon: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}
