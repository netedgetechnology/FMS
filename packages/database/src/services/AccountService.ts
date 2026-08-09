import { randomUUID } from "node:crypto";

import { AccountRepository } from "../repositories/AccountRepository";

import type {
    Account,
    CreateAccountRequest,
    UpdateAccountRequest,
} from "../types/account";

export class AccountService {

    constructor(

        private readonly repository = new AccountRepository(),

    ) {}

    async listAccounts() {

        return this.repository.findAll();

    }

    async getAccount(id: string) {

        return this.repository.findById(id);

    }

    async createAccount(request: CreateAccountRequest) {

        const now = new Date();

        const account: Account = {

            id: randomUUID(),

            name: request.name.trim(),

            accountType: request.accountType,

            institution: request.institution ?? null,

            accountNumber: request.accountNumber ?? null,

            currency: request.currency ?? "INR",

            openingBalance: request.openingBalance ?? 0,

            currentBalance: request.openingBalance ?? 0,

            color: request.color ?? null,

            icon: request.icon ?? null,

            notes: request.notes ?? null,

            isActive: true,

            createdAt: now,

            updatedAt: now,

        };

        return this.repository.create(account);

    }

    async updateAccount(request: UpdateAccountRequest) {

        return this.repository.update(request);

    }

    async deleteAccount(id: string) {

        return this.repository.delete(id);

    }

}
