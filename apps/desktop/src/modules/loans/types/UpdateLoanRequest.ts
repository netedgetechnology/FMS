import type { CreateLoanRequest } from "./CreateLoanRequest";

export type UpdateLoanRequest = Omit<
    CreateLoanRequest,
    "outstandingPrincipal" | "outstandingInterest"
> & {
    id: string;
};
