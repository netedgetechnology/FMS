import { SQLiteProvider } from "./SQLiteProvider";

export abstract class Repository {
    protected readonly database = SQLiteProvider.getInstance();

    protected async execute(
        sql: string,
        bindValues: unknown[] = []
    ): Promise<void> {
        await this.database.execute(sql, bindValues);
    }

    protected async select<TResult extends object>(
        sql: string,
        bindValues: unknown[] = []
    ): Promise<TResult[]> {
        return await this.database.select<TResult>(
            sql,
            bindValues
        );
    }
}
