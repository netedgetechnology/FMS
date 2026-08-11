import { CreateLoanRequest } from "./CreateLoanRequest";

export interface UpdateLoanRequest extends CreateLoanRequest {
    id: string;
}
