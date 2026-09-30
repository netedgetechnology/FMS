import { CategoryRepository } from "../repositories";

import { assertValidFinanceScope } from "../utils/financeScope";

import {
    Category,
    CreateCategoryRequest,
    FinanceScope,
    UpdateCategoryRequest,
} from "../types";

import type { CategoryCsvRow } from "./categoryCsvImport";

// The one place a new Category record (id, trimming, defaults,
// timestamps) is built - shared by create() and the CSV import so both
// generate categories identically.
export function buildCategoryRecord(
    request: CreateCategoryRequest,
    now: string = new Date().toISOString()
): Category {
    assertValidFinanceScope(request.financeScope);

    return {
        id: crypto.randomUUID(),

        parentId:
            request.parentId?.trim() || null,

        name:
            request.name.trim(),

        categoryType:
            request.categoryType,

        financeScope:
            request.financeScope,

        businessEntityId:
            request.businessEntityId?.trim() || null,

        description:
            request.description?.trim() || null,

        isActive:
            request.isActive ?? true,

        createdAt:
            now,

        updatedAt:
            now,
    };
}

export interface CategoryCsvImportResult {
    imported: number;
    /** Duplicates found in the preview plus any the database refused. */
    skippedDuplicates: number;
    invalid: number;
}

export class CategoryService {

    private readonly repository =
        new CategoryRepository();

    async getAll(): Promise<Category[]> {
        return await this.repository.getAll();
    }

    async getById(
        id: string
    ): Promise<Category | null> {
        return await this.repository.getById(id);
    }

    async getByParentId(
        parentId: string | null
    ): Promise<Category[]> {
        return await this.repository.getByParentId(
            parentId
        );
    }

    async create(
        request: CreateCategoryRequest
    ): Promise<string> {

        const category = buildCategoryRecord(
            request
        );

        await this.repository.create(
            category
        );

        return category.id;
    }

    // Creates the VALID rows of a CSV preview (see parseCategoryCsv) in a
    // single atomic database transaction - all or nothing. Duplicate and
    // invalid rows are never written. Existing categories are never
    // updated: the database command re-checks every name against the
    // current categories inside the same transaction and skips any that
    // now already exist (e.g. created since the preview), counting them
    // as duplicates.
    async importCsvRows(
        rows: readonly CategoryCsvRow[]
    ): Promise<CategoryCsvImportResult> {
        const now = new Date().toISOString();

        const records = rows
            .filter(row => row.status === "valid")
            .map(row =>
                buildCategoryRecord(
                    {
                        name: row.name,
                        categoryType:
                            row.type as Category["categoryType"],
                        // Personal, Business or BOTH - Personal when the
                        // file has no scope column (see parseCategoryCsv).
                        // buildCategoryRecord re-validates it.
                        financeScope:
                            row.scope as Category["financeScope"],
                        // The Category form's own defaults for fields
                        // the CSV doesn't carry.
                        parentId: null,
                        businessEntityId: null,
                        description: row.description,
                        isActive: true,
                    },
                    now
                )
            );

        const previewDuplicates = rows.filter(
            row => row.status === "duplicate"
        ).length;

        const invalid = rows.filter(
            row => row.status === "invalid"
        ).length;

        if (records.length === 0) {
            return {
                imported: 0,
                skippedDuplicates: previewDuplicates,
                invalid,
            };
        }

        const outcome =
            await this.repository.createManyAtomic(records);

        return {
            imported: outcome.inserted,
            skippedDuplicates:
                previewDuplicates + outcome.skippedDuplicates,
            invalid,
        };
    }

    async update(
        request: UpdateCategoryRequest
    ): Promise<void> {

        await this.repository.update({
            ...request,

            parentId:
                request.parentId?.trim() || null,

            name:
                request.name.trim(),

            businessEntityId:
                request.businessEntityId?.trim() || null,

            description:
                request.description?.trim() || null,
        });
    }

    // Scopes screen "Save Changes" - all-or-nothing (one UPDATE
    // statement). Each change sets that category to Personal-only,
    // Business-only or both (BOTH); only the scope changes - name, type,
    // description, parent, business entity and status stay exactly as
    // they are. Every scope is validated before anything is written, so a
    // single invalid (e.g. zero-scope) change writes nothing at all.
    async updateScopes(
        changes: readonly { id: string; financeScope: FinanceScope }[]
    ): Promise<void> {

        const ids = new Set<string>();

        for (const change of changes) {
            assertValidFinanceScope(change.financeScope);

            if (ids.has(change.id)) {
                throw new Error(
                    `Category ${change.id} has more than one scope change.`
                );
            }

            ids.add(change.id);
        }

        if (changes.length === 0) {
            return;
        }

        await this.repository.updateScopes(
            changes.map(change => ({
                id: change.id,
                financeScope: change.financeScope,
            }))
        );
    }

    async delete(
        id: string
    ): Promise<void> {

        await this.repository.delete(id);
    }
}
