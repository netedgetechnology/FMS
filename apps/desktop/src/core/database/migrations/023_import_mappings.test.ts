import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { ImportMappingsMigration } from "./023_import_mappings";

function createDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    for (const statement of ImportMappingsMigration.sql
        .split(";")
        .map(part => part.trim())
        .filter(part => part.length > 0)) {
        db.exec(statement);
    }

    return db;
}

interface SaveMappingInput {
    id: string;
    name: string;
    institutionName: string | null;
    importType: string;
    headerSignature: string;
    headers: string[];
    mapping: Record<string, string>;
}

// Mirrors ImportMappingRepository.upsert's SQL (same UNIQUE-on-signature
// upsert), without going through the Tauri-backed Repository layer.
function saveMapping(
    db: DatabaseSync,
    input: SaveMappingInput
): void {
    db.prepare(
        `
        INSERT INTO import_mappings
        (id, name, institution_name, import_type, header_signature, headers, mapping, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(header_signature) DO UPDATE SET
            name = excluded.name,
            institution_name = excluded.institution_name,
            import_type = excluded.import_type,
            headers = excluded.headers,
            mapping = excluded.mapping,
            updated_at = CURRENT_TIMESTAMP
        `
    ).run(
        input.id,
        input.name,
        input.institutionName,
        input.importType,
        input.headerSignature,
        JSON.stringify(input.headers),
        JSON.stringify(input.mapping)
    );
}

function findBySignature(
    db: DatabaseSync,
    headerSignature: string
): Record<string, unknown> | undefined {
    return db
        .prepare(
            `SELECT * FROM import_mappings WHERE header_signature = ?`
        )
        .get(headerSignature) as
        | Record<string, unknown>
        | undefined;
}

describe("migration 023 - import mappings", () => {
    it("is registered with version 23", () => {
        expect(
            ImportMappingsMigration.version
        ).toBe(23);
    });

    it("saves a mapping and finds it again by header signature", () => {
        const db = createDb();

        saveMapping(db, {
            id: "map-1",
            name: "Axis Bank",
            institutionName: "Axis Bank",
            importType: "BANK_CSV",
            headerSignature:
                "BANK_CSV::amount(inr)|dr|cr|transaction particulars|tran date",
            headers: [
                "Tran Date",
                "Transaction Particulars",
                "Amount(INR)",
                "DR|CR",
            ],
            mapping: {
                date: "Tran Date",
                description:
                    "Transaction Particulars",
                amount: "Amount(INR)",
                type: "DR|CR",
                // "CHQNO" deliberately not present here - it was mapped
                // to Ignore and must stay that way.
            },
        });

        const found = findBySignature(
            db,
            "BANK_CSV::amount(inr)|dr|cr|transaction particulars|tran date"
        );

        expect(found).toBeTruthy();
        expect(found?.name).toBe("Axis Bank");
        expect(found?.institution_name).toBe(
            "Axis Bank"
        );

        const savedMapping = JSON.parse(
            found?.mapping as string
        );

        expect(savedMapping).toEqual({
            date: "Tran Date",
            description:
                "Transaction Particulars",
            amount: "Amount(INR)",
            type: "DR|CR",
        });

        // The ignored column never appears anywhere in the saved
        // mapping, so reusing it can never accidentally pull CHQNO in.
        expect(
            Object.values(savedMapping)
        ).not.toContain("CHQNO");
    });

    it("preserves a Branch → Branch mapping through save and reuse", () => {
        const db = createDb();

        const signature =
            "BANK_CSV::amount|branch name|date|description";

        saveMapping(db, {
            id: "map-branch",
            name: "Axis Bank",
            institutionName: "Axis Bank",
            importType: "BANK_CSV",
            headerSignature: signature,
            headers: [
                "Date",
                "Description",
                "Amount",
                "Branch Name",
            ],
            mapping: {
                date: "Date",
                description: "Description",
                amount: "Amount",
                branch: "Branch Name",
            },
        });

        const found = findBySignature(
            db,
            signature
        );

        const savedMapping = JSON.parse(
            found?.mapping as string
        );

        expect(savedMapping.branch).toBe(
            "Branch Name"
        );

        // Reusing it for a future file with the same header structure
        // must keep Branch mapped to Branch - not silently drop it or
        // fold it into description/reference.
        expect(savedMapping).toEqual({
            date: "Date",
            description: "Description",
            amount: "Amount",
            branch: "Branch Name",
        });
    });

    it("does not match a different header structure to an unrelated saved mapping", () => {
        const db = createDb();

        saveMapping(db, {
            id: "map-axis-savings",
            name: "Axis Bank Savings",
            institutionName: "Axis Bank",
            importType: "BANK_CSV",
            headerSignature: "BANK_CSV::a|b|c",
            headers: ["A", "B", "C"],
            mapping: { date: "A" },
        });

        saveMapping(db, {
            id: "map-axis-credit-card",
            name: "Axis Bank Credit Card",
            institutionName: "Axis Bank",
            importType: "BANK_CSV",
            headerSignature: "BANK_CSV::x|y|z",
            headers: ["X", "Y", "Z"],
            mapping: { date: "X" },
        });

        // A statement whose structure only matches the credit-card
        // signature must never return the savings-account mapping, even
        // though both are "Axis Bank".
        const match = findBySignature(
            db,
            "BANK_CSV::x|y|z"
        );

        expect(match?.name).toBe(
            "Axis Bank Credit Card"
        );

        expect(
            findBySignature(
                db,
                "BANK_CSV::does-not-exist"
            )
        ).toBeUndefined();
    });

    it("refreshes (not duplicates) the saved mapping when the same header structure is confirmed again", () => {
        const db = createDb();

        const signature = "BANK_CSV::a|b|c";

        saveMapping(db, {
            id: "map-1",
            name: "Axis Bank",
            institutionName: "Axis Bank",
            importType: "BANK_CSV",
            headerSignature: signature,
            headers: ["A", "B", "C"],
            mapping: { date: "A" },
        });

        // User re-imports a similar statement, edits the mapping name
        // and a field, and confirms again.
        saveMapping(db, {
            id: "map-1",
            name: "Axis Bank Savings",
            institutionName: "Axis Bank",
            importType: "BANK_CSV",
            headerSignature: signature,
            headers: ["A", "B", "C"],
            mapping: { date: "A", amount: "B" },
        });

        const count = db
            .prepare(
                `SELECT COUNT(*) AS n FROM import_mappings WHERE header_signature = ?`
            )
            .get(signature) as { n: number };

        expect(count.n).toBe(1);

        const found = findBySignature(
            db,
            signature
        );

        expect(found?.name).toBe(
            "Axis Bank Savings"
        );

        expect(
            JSON.parse(found?.mapping as string)
        ).toEqual({ date: "A", amount: "B" });
    });
});
