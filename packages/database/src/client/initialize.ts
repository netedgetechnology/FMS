import { runMigrations } from "../migrations/runner";

let initialized = false;

export function initializeDatabase() {

    if (initialized) {

        return;

    }

    runMigrations();

    initialized = true;

}
