import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Category } from "../types";

import { parseCategoryCsv } from "./categoryCsvImport";
import { buildCategoryRecord, CategoryService } from "./CategoryService";

// CategoryService.importCsvRows with the repository replaced: checks
// exactly what reaches the (atomic) database write.

describe("CategoryService.importCsvRows", () => {
    const repository = {
        createManyAtomic: vi.fn(),
    };

    function createService(): CategoryService {
        const service = new CategoryService();

        Object.defineProperty(service, "repository", {
            value: repository,
        });

        return service;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        repository.createManyAtomic.mockImplementation(
            async (records: Category[]) => ({
                inserted: records.length,
                skippedDuplicates: 0,
            })
        );
    });

    it("sends only valid rows, with the Category form's defaults, in one atomic call", async () => {
        const preview = parseCategoryCsv(
            [
                "name,type,description",
                "Sales Revenue,income,Revenue from sales",
                "bank charges,EXPENSE,",
                ",EXPENSE,",
                "Consulting,Fees,",
                '"Travel, Local",EXPENSE,',
            ].join("\n"),
            [{ name: "Bank Charges" }]
        );

        const result = await createService().importCsvRows(preview.rows);

        expect(repository.createManyAtomic).toHaveBeenCalledTimes(1);

        const records: Category[] =
            repository.createManyAtomic.mock.calls[0][0];

        expect(records).toHaveLength(2);
        expect(records.map(record => record.name)).toEqual([
            "Sales Revenue",
            "Travel, Local",
        ]);
        expect(records[0]).toMatchObject({
            parentId: null,
            categoryType: "INCOME",
            financeScope: "PERSONAL",
            businessEntityId: null,
            description: "Revenue from sales",
            isActive: true,
        });
        expect(records[1].description).toBeNull();

        // One timestamp for the whole import, distinct ids.
        expect(records[0].createdAt).toBe(records[1].createdAt);
        expect(records[0].updatedAt).toBe(records[0].createdAt);
        expect(new Set(records.map(record => record.id)).size).toBe(2);

        expect(result).toEqual({
            imported: 2,
            skippedDuplicates: 1,
            invalid: 2,
        });
    });

    it("makes no database call when nothing is valid", async () => {
        const preview = parseCategoryCsv(
            ["name,type", "Rent,EXPENSE", ",EXPENSE"].join("\n"),
            [{ name: "rent" }]
        );

        const result = await createService().importCsvRows(preview.rows);

        expect(repository.createManyAtomic).not.toHaveBeenCalled();
        expect(result).toEqual({
            imported: 0,
            skippedDuplicates: 1,
            invalid: 1,
        });
    });

    it("adds names the database refused as duplicates (created after the preview)", async () => {
        repository.createManyAtomic.mockResolvedValue({
            inserted: 1,
            skippedDuplicates: 1,
        });

        const preview = parseCategoryCsv(
            ["name,type", "Rent,EXPENSE", "Salary,INCOME", "salary,INCOME"].join("\n"),
            []
        );

        expect(await createService().importCsvRows(preview.rows)).toEqual({
            imported: 1,
            skippedDuplicates: 2,
            invalid: 0,
        });
    });

    it("imports 100+ categories in a single atomic call", async () => {
        const lines = ["name,type,description"];

        for (let index = 1; index <= 150; index++) {
            lines.push(`Bulk ${index},EXPENSE,`);
        }

        const preview = parseCategoryCsv(lines.join("\n"), []);
        const result = await createService().importCsvRows(preview.rows);

        expect(repository.createManyAtomic).toHaveBeenCalledTimes(1);
        expect(repository.createManyAtomic.mock.calls[0][0]).toHaveLength(150);
        expect(result.imported).toBe(150);
    });

    it("passes UTF-8 names through unchanged", async () => {
        const preview = parseCategoryCsv(
            ["name,type", "Café & Restaurants,EXPENSE", "किराना,EXPENSE"].join("\n"),
            []
        );

        await createService().importCsvRows(preview.rows);

        expect(
            repository.createManyAtomic.mock.calls[0][0].map(
                (record: Category) => record.name
            )
        ).toEqual(["Café & Restaurants", "किराना"]);
    });

    it("propagates a failed (rolled back) import unchanged", async () => {
        repository.createManyAtomic.mockRejectedValue(
            "error returned from database: (code: 5) database is locked"
        );

        const preview = parseCategoryCsv("name,type\nRent,EXPENSE", []);

        await expect(
            createService().importCsvRows(preview.rows)
        ).rejects.toBe(
            "error returned from database: (code: 5) database is locked"
        );
    });
});

describe("buildCategoryRecord", () => {
    it("builds records the same way create() does", () => {
        const record = buildCategoryRecord(
            {
                name: "  Salary  ",
                categoryType: "INCOME",
                financeScope: "PERSONAL",
                parentId: "  ",
                businessEntityId: null,
                description: "  ",
            },
            "2026-09-25T00:00:00.000Z"
        );

        expect(record).toMatchObject({
            name: "Salary",
            parentId: null,
            description: null,
            isActive: true,
            createdAt: "2026-09-25T00:00:00.000Z",
            updatedAt: "2026-09-25T00:00:00.000Z",
        });
        expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    });
});
