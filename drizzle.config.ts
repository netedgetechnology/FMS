import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "sqlite",
    schema: "./packages/database/src/schema/*",
    out: "./packages/database/src/migrations",
    dbCredentials: {
        url: "./database/financeos.db",
    },
});

