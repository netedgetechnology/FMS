import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { db } from "../client/database";

export function runMigrations() {

    migrate(db, {

        migrationsFolder: "./packages/database/src/migrations",

    });

}
