import { initializeDatabase } from "./core/database/bootstrap";
import { verifyDatabaseSchema } from "./core/database/engine/SchemaVerification";

initializeDatabase()
    .then(async () => {
        console.info("FinanceOS database initialized.");
        await verifyDatabaseSchema();
    })
    .catch(error => {
        console.error("Database initialization failed:", error);
    });
