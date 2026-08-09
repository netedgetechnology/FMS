import { eq } from "drizzle-orm";

import { db } from "../client/database";
import { accounts } from "../schema/accounts";

import type {
    Account,
    CreateAccountRequest,
    UpdateAccountRequest,
} from "../types/account";

export class AccountRepository {

    async findAll() {

        return await db.select().from(accounts);

    }

    async findById(id: string) {

        const result = await db
            .select()
            .from(accounts)
            .where(eq(accounts.id, id));

        return result[0] ?? null;

    }

    async create(account: Account) {

        await db.insert(accounts).values(account);

        return account;

    }

    async update(account: UpdateAccountRequest) {

        const { id, ...data } = account;

        await db
            .update(accounts)
            .set(data)
            .where(eq(accounts.id, id));

        return this.findById(id);

    }

    async delete(id: string) {

        await db
            .delete(accounts)
            .where(eq(accounts.id, id));

    }

}
