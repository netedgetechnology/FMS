import {
    integer,
    real,
    sqliteTable,
    text,
} from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {

    id: text("id").primaryKey(),

    name: text("name").notNull(),

    accountType: text("account_type").notNull(),

    institution: text("institution"),

    accountNumber: text("account_number"),

    currency: text("currency")
        .notNull()
        .default("INR"),

    openingBalance: real("opening_balance")
        .notNull()
        .default(0),

    currentBalance: real("current_balance")
        .notNull()
        .default(0),

    color: text("color"),

    icon: text("icon"),

    notes: text("notes"),

    isActive: integer("is_active", {
        mode: "boolean",
    })
        .notNull()
        .default(true),

    createdAt: integer("created_at", {
        mode: "timestamp_ms",
    }).notNull(),

    updatedAt: integer("updated_at", {
        mode: "timestamp_ms",
    }).notNull(),

});
