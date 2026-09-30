import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    processCsv,
    type NormalizedTransactionCandidate,
} from "@financeos/import-engine";

import { ImportDraftsMigration } from "@/core/database/migrations/042_import_drafts";

import { ImportDraftRepository } from "../repositories/ImportDraftRepository";
import {
    withCustomImportRules,
    type CsvPreviewResultWithLearning,
} from "../services/ImportService";
import type {
    CustomImportRule,
    ImportBatch,
    ImportDraftRecord,
} from "../types";

import {
    applyCategoryToMatchingRows,
    applyNotesToMatchingRows,
    applyPayeeToMatchingRows,
    applyPreviewOverrides,
    applySelfLearningToMatchingRows,
    applyTransactionTypeToMatchingRows,
    countImportProgress,
    createEmptyPreviewOverrides,
    deriveSessionLearnedRowNumbers,
    resolveSelfLearningIndicator,
} from "./ImportsPage";
import {
    applyBalanceAmount,
    applyBalanceDirection,
    detectBalanceMismatches,
    reviewBalanceCorrections,
    toggleBalanceSkip,
} from "./importBalanceReview";
import {
    IMPORT_DRAFT_FORMAT_VERSION,
    ImportDraftAutoSaver,
    ImportDraftError,
    encodeDraftPreview,
    encodeDraftState,
    importCommitted,
    parseImportDraft,
    requiresDraftReplacementConfirmation,
    runImportWithDraft,
    summarizeSnapshot,
    type ImportDraftPreview,
    type ImportDraftSnapshot,
    type ImportDraftState,
} from "./importDraft";

// ---------------------------------------------------------------------
// Import Draft / Auto-Recovery. Drafts are persisted through the real
// ImportDraftRepository SQL against a real SQLite database (node:sqlite,
// in memory, created by the real migration 042) - the same path the app
// takes, minus the Tauri bridge.
// ---------------------------------------------------------------------

function createDatabase(): DatabaseSync {
    const db = new DatabaseSync(":memory:");

    for (const statement of ImportDraftsMigration.sql
        .split(";")
        .map(part => part.trim())
        .filter(Boolean)) {
        db.exec(statement);
    }

    return db;
}

// The two calls Repository makes on SQLiteProvider, backed by node:sqlite.
function createRepository(db: DatabaseSync): ImportDraftRepository {
    const repository = new ImportDraftRepository();

    Object.defineProperty(repository, "database", {
        value: {
            async execute(sql: string, params: unknown[] = []) {
                db.prepare(sql).run(...(params as never[]));
            },
            async select(sql: string, params: unknown[] = []) {
                return db.prepare(sql).all(...(params as never[]));
            },
        },
    });

    return repository;
}

function draftCount(db: DatabaseSync): number {
    return (
        db.prepare("SELECT COUNT(*) AS n FROM import_drafts").get() as {
            n: number;
        }
    ).n;
}

// A real statement (through the real import-engine normalization): a
// handful of recurring merchants, debit/credit columns, a running
// balance, and ONE deliberately wrong balance to exercise corrections.
const MERCHANTS = ["SWIGGY", "ZOMATO", "AMAZON", "UBER", "FLIPKART", "NETFLIX", "SALARY", "RENT"];
const BROKEN_BALANCE_ROW_INDEX = 6;

function makeStatementCsv(rows: number): string {
    const lines = ["Date,Description,Debit,Credit,Balance,Reference"];
    let balance = 1_000_000;

    for (let i = 0; i < rows; i++) {
        const merchant = MERCHANTS[i % MERCHANTS.length]!;
        const credit = merchant === "SALARY";
        const amount = 100 + (i % 37);

        balance += credit ? amount : -amount;

        const printedBalance =
            i === BROKEN_BALANCE_ROW_INDEX ? balance + 50 : balance;

        const day = String((i % 28) + 1).padStart(2, "0");

        lines.push(
            [
                `${day}/08/2026`,
                `UPI/${credit ? "CR" : "DR"}/${410000 + i}/${merchant}/YBL/REF${i}`,
                credit ? "" : amount.toFixed(2),
                credit ? amount.toFixed(2) : "",
                printedBalance.toFixed(2),
                `REF${i}`,
            ].join(",")
        );
    }

    return lines.join("\n");
}

const customRules: CustomImportRule[] = [
    {
        id: "rule-netflix",
        accountId: "acct-1",
        keyword: "NETFLIX",
        payee: "Netflix",
        notes: "Subscription",
        categoryId: "cat-entertainment",
        transactionType: "UPI",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
    },
];

// Mirrors ImportService.previewCsv: normalization, then Self-Learning
// (here: rows of one merchant "learned"), then Custom Import Rules, then
// duplicates.
function makePreview(rows: number): CsvPreviewResultWithLearning {
    const processed = processCsv(makeStatementCsv(rows), "BANK_CSV");

    const learnedRows = new Set<number>();
    const learnedCandidates = processed.candidates.map(candidate => {
        if (!candidate.description.includes("/UBER/")) {
            return candidate;
        }

        learnedRows.add(candidate.rowNumber);

        return { ...candidate, payee: "Uber", categoryId: "cat-travel" };
    });

    const withRules = withCustomImportRules(
        { candidates: learnedCandidates, matchedRowNumbers: learnedRows },
        customRules
    );

    return {
        ...processed,
        candidates: withRules.candidates,
        duplicates: new Map([
            [processed.candidates[1]!.rowNumber, "txn-existing-1"],
        ]),
        matchedLearnedRuleRowNumbers: withRules.matchedRowNumbers,
        customRuleState: withRules.customRuleState,
    };
}

function rowOf(
    preview: ImportDraftPreview,
    merchant: string,
    nth = 0
): NormalizedTransactionCandidate {
    const rows = preview.candidates.filter(candidate =>
        candidate.description.includes(`/${merchant}/`)
    );

    return rows[nth]!;
}

// Everything a user could have done to a preview: Payee / Type / Notes /
// Category edits (with matching-row propagation), a Self-Learning
// opt-out, a balance correction, a skipped row, a scope and mapping name.
function makeEditedState(preview: ImportDraftPreview): ImportDraftState {
    const base = preview.candidates;
    let overrides = createEmptyPreviewOverrides();

    overrides = applyPayeeToMatchingRows(
        base,
        overrides,
        rowOf(preview, "SWIGGY").rowNumber,
        "Swiggy Food"
    );
    overrides = applyTransactionTypeToMatchingRows(
        base,
        overrides,
        rowOf(preview, "ZOMATO").rowNumber,
        "IMPS"
    );
    overrides = applyNotesToMatchingRows(
        base,
        overrides,
        rowOf(preview, "AMAZON").rowNumber,
        "Household"
    );
    overrides = applyCategoryToMatchingRows(
        base,
        overrides,
        rowOf(preview, "FLIPKART").rowNumber,
        "cat-shopping"
    );

    const broken = base[BROKEN_BALANCE_ROW_INDEX]!;
    overrides = applyBalanceAmount(
        overrides,
        base,
        broken.rowNumber,
        (broken.amount ?? 0) + 50
    );
    overrides = applyBalanceDirection(
        overrides,
        base,
        broken.rowNumber,
        broken.type === "income" ? "expense" : "income"
    );
    overrides = toggleBalanceSkip(overrides, rowOf(preview, "RENT").rowNumber);

    return {
        accountId: "acct-1",
        importType: "BANK_CSV",
        file: {
            name: "statement-aug.csv",
            size: 123_456,
            lastModified: 1_790_000_000_000,
            fingerprint: "ab".repeat(32),
        },
        mappingName: "HDFC Savings",
        matchedMapping: {
            id: "map-1",
            name: "HDFC Savings",
            institutionName: "HDFC Bank",
            importType: "BANK_CSV",
            headerSignature: "sig",
            headers: preview.document.headers,
            mapping: preview.mapping,
            createdAt: "2026-09-01T00:00:00.000Z",
            updatedAt: "2026-09-01T00:00:00.000Z",
        } as unknown as ImportDraftState["matchedMapping"],
        overrides,
        selfLearningDisabledRows: applySelfLearningToMatchingRows(
            base,
            new Map(),
            rowOf(preview, "UBER").rowNumber,
            true
        ),
        categoryScope: "BUSINESS",
        showAffectedRowsOnly: true,
    };
}

function makeSnapshot(rows: number): ImportDraftSnapshot {
    const preview = makePreview(rows);

    return {
        id: "draft-1",
        createdAt: "2026-09-28T09:00:00.000Z",
        preview,
        state: makeEditedState(preview),
    };
}

// What the Import Preview screen is derived from - the same functions,
// in the same order, as ImportsPage.
function deriveScreen(preview: ImportDraftPreview, state: ImportDraftState) {
    const candidates = applyPreviewOverrides(preview.candidates, state.overrides);
    const sessionLearned = deriveSessionLearnedRowNumbers(
        candidates,
        state.overrides,
        preview.matchedLearnedRuleRowNumbers
    );
    const review = reviewBalanceCorrections(
        detectBalanceMismatches(preview.candidates),
        candidates,
        state.overrides.skipped
    );

    return {
        candidates,
        progress: countImportProgress(
            preview.candidates,
            preview.matchedLearnedRuleRowNumbers,
            sessionLearned,
            state.selfLearningDisabledRows,
            state.overrides
        ),
        indicators: candidates.map(candidate =>
            resolveSelfLearningIndicator(
                candidate.rowNumber,
                preview.matchedLearnedRuleRowNumbers,
                sessionLearned,
                state.selfLearningDisabledRows
            )
        ),
        balanceRows: Array.from(review.rows.entries()).map(
            ([rowNumber, row]) => [rowNumber, row.status]
        ),
        unresolvedBalanceRows: Array.from(review.unresolvedRowNumbers),
        customRuleKeywords: candidates.map(
            candidate =>
                preview.customRuleState?.applications.get(candidate.rowNumber)
                    ?.keyword ?? null
        ),
    };
}

// Saves a snapshot through the auto-saver (as the page does), then
// "reloads": a brand-new repository/saver reads it back the way the
// page's recovery does - summary first, then the full draft.
async function saveAndReload(snapshot: ImportDraftSnapshot) {
    const db = createDatabase();
    const saver = new ImportDraftAutoSaver(createRepository(db));

    saver.schedule(snapshot);
    await saver.flush();

    const afterReload = createRepository(db);
    const summary = await afterReload.getSummary();
    const record = await afterReload.load(summary!.id);

    return { db, summary: summary!, restored: parseImportDraft(record!) };
}

describe("Import draft - creation and restore", () => {
    it("creates a draft with its metadata on the first save", async () => {
        const snapshot = makeSnapshot(40);
        const { db, summary } = await saveAndReload(snapshot);

        expect(draftCount(db)).toBe(1);
        expect(summary).toMatchObject({
            id: "draft-1",
            formatVersion: IMPORT_DRAFT_FORMAT_VERSION,
            accountId: "acct-1",
            importType: "BANK_CSV",
            fileName: "statement-aug.csv",
            rowCount: 40,
            createdAt: "2026-09-28T09:00:00.000Z",
        });
    });

    it("restores a 1,400-row draft exactly - rows, edits and derived screen", async () => {
        const snapshot = makeSnapshot(1_400);
        const { summary, restored } = await saveAndReload(snapshot);

        expect(summary.rowCount).toBe(1_400);
        expect(restored.preview.candidates).toHaveLength(1_400);

        // The complete normalized preview, Maps/Sets included.
        expect(restored.preview).toEqual(snapshot.preview);
        expect(restored.preview.duplicates).toBeInstanceOf(Map);
        expect(restored.preview.matchedLearnedRuleRowNumbers).toBeInstanceOf(Set);
        expect(restored.state).toEqual(snapshot.state);

        // Same screen: rows as shown, counters, indicators, balance review.
        expect(deriveScreen(restored.preview, restored.state)).toEqual(
            deriveScreen(snapshot.preview, snapshot.state)
        );
    });

    it("restores account, import type, mapping, mapping name, scope and file", async () => {
        const snapshot = makeSnapshot(60);
        const { restored } = await saveAndReload(snapshot);

        expect(restored.state.accountId).toBe("acct-1");
        expect(restored.state.importType).toBe("BANK_CSV");
        expect(restored.preview.mapping).toEqual(snapshot.preview.mapping);
        expect(restored.preview.document.headers).toEqual(
            snapshot.preview.document.headers
        );
        expect(restored.state.mappingName).toBe("HDFC Savings");
        expect(restored.state.matchedMapping).toEqual(snapshot.state.matchedMapping);
        expect(restored.state.categoryScope).toBe("BUSINESS");
        expect(restored.state.showAffectedRowsOnly).toBe(true);
        expect(restored.state.file).toEqual(snapshot.state.file);
    });

    it("restores manual Payee / Type / Notes / Category edits (incl. propagated rows)", async () => {
        const snapshot = makeSnapshot(200);
        const { restored } = await saveAndReload(snapshot);
        const rows = applyPreviewOverrides(
            restored.preview.candidates,
            restored.state.overrides
        );

        const by = (merchant: string) =>
            rows.filter(row => row.description.includes(`/${merchant}/`));

        expect(by("SWIGGY").every(row => row.payee === "Swiggy Food")).toBe(true);
        expect(by("ZOMATO").every(row => row.transactionType === "IMPS")).toBe(true);
        expect(by("AMAZON").every(row => row.notes === "Household")).toBe(true);
        expect(by("FLIPKART").every(row => row.categoryId === "cat-shopping")).toBe(true);
        expect(restored.state.overrides.payee.size).toBe(
            snapshot.state.overrides.payee.size
        );
        expect(restored.state.overrides.payee.size).toBeGreaterThan(1);
    });

    it("restores balance corrections and skipped rows", async () => {
        const snapshot = makeSnapshot(80);
        const { restored } = await saveAndReload(snapshot);
        const broken = snapshot.preview.candidates[BROKEN_BALANCE_ROW_INDEX]!;

        expect(restored.state.overrides.amount.get(broken.rowNumber)).toBe(
            (broken.amount ?? 0) + 50
        );
        expect(restored.state.overrides.direction.get(broken.rowNumber)).toBe(
            snapshot.state.overrides.direction.get(broken.rowNumber)
        );
        expect(restored.state.overrides.skipped).toEqual(
            snapshot.state.overrides.skipped
        );
        expect(restored.state.overrides.skipped.size).toBe(1);

        // The mismatch was detected, and its review is unchanged.
        expect(detectBalanceMismatches(snapshot.preview.candidates).size).toBeGreaterThan(0);
        expect(deriveScreen(restored.preview, restored.state).balanceRows).toEqual(
            deriveScreen(snapshot.preview, snapshot.state).balanceRows
        );
    });

    it("restores learned (GREEN), custom-rule and session-learned (BLUE) indicators and Self-Learning opt-outs", async () => {
        const snapshot = makeSnapshot(120);
        const { restored } = await saveAndReload(snapshot);

        expect(restored.preview.matchedLearnedRuleRowNumbers).toEqual(
            snapshot.preview.matchedLearnedRuleRowNumbers
        );
        expect(restored.preview.customRuleState!.applications).toEqual(
            snapshot.preview.customRuleState!.applications
        );
        expect(restored.preview.customRuleState!.learnedRuleRowNumbers).toEqual(
            snapshot.preview.customRuleState!.learnedRuleRowNumbers
        );
        expect(restored.preview.customRuleState!.candidatesBeforeCustomRules).toEqual(
            snapshot.preview.customRuleState!.candidatesBeforeCustomRules
        );
        expect(restored.state.selfLearningDisabledRows).toEqual(
            snapshot.state.selfLearningDisabledRows
        );

        const before = deriveScreen(snapshot.preview, snapshot.state);
        const after = deriveScreen(restored.preview, restored.state);

        expect(after.indicators).toEqual(before.indicators);
        expect(after.customRuleKeywords).toEqual(before.customRuleKeywords);
        expect(after.progress).toEqual(before.progress);
        expect(before.indicators.some(i => i.state === "green")).toBe(true);
        expect(before.indicators.some(i => i.state === "blue")).toBe(true);
        expect(before.customRuleKeywords).toContain("NETFLIX");
    });

    it("keeps the original/raw Description unchanged after recovery", async () => {
        const snapshot = makeSnapshot(100);
        const { restored } = await saveAndReload(snapshot);
        const shown = applyPreviewOverrides(
            restored.preview.candidates,
            restored.state.overrides
        );

        restored.preview.candidates.forEach((candidate, index) => {
            const original = snapshot.preview.candidates[index]!;

            expect(candidate.description).toBe(original.description);
            expect(candidate.rawData).toEqual(original.rawData);
            // A Payee edit never touches the Description.
            expect(shown[index]!.description).toBe(original.description);
        });

        expect(restored.preview.document.rows).toEqual(
            snapshot.preview.document.rows
        );
    });
});

describe("Import draft - debounced auto-save", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("coalesces a burst of edits into one write after the quiet period", async () => {
        const db = createDatabase();
        const repository = createRepository(db);
        const saveFull = vi.spyOn(repository, "saveFull");
        const saveState = vi.spyOn(repository, "saveState");
        const statuses: string[] = [];
        const saver = new ImportDraftAutoSaver(repository, {
            debounceMs: 800,
            onStatus: status => statuses.push(status.kind),
        });
        const snapshot = makeSnapshot(50);

        saver.schedule(snapshot);
        await vi.advanceTimersByTimeAsync(0);
        expect(saveFull).not.toHaveBeenCalled();
        expect(saver.hasUnsavedChanges()).toBe(true);

        await vi.advanceTimersByTimeAsync(800);
        expect(saveFull).toHaveBeenCalledTimes(1);
        expect(draftCount(db)).toBe(1);

        // Twenty quick edits, 100ms apart: nothing is written until they stop.
        let overrides = snapshot.state.overrides;

        for (let i = 0; i < 20; i++) {
            overrides = applyNotesToMatchingRows(
                snapshot.preview.candidates,
                overrides,
                snapshot.preview.candidates[10]!.rowNumber,
                `note ${i}`
            );
            saver.schedule({
                ...snapshot,
                state: { ...snapshot.state, overrides },
            });
            await vi.advanceTimersByTimeAsync(100);
        }

        expect(saveState).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(800);

        // One small state write - the preview is never rewritten for an edit.
        expect(saveState).toHaveBeenCalledTimes(1);
        expect(saveFull).toHaveBeenCalledTimes(1);
        expect(saver.hasUnsavedChanges()).toBe(false);

        const restored = parseImportDraft(
            (await repository.load("draft-1"))!
        );
        expect(
            restored.state.overrides.notes.get(
                snapshot.preview.candidates[10]!.rowNumber
            )
        ).toBe("note 19");

        expect(statuses).toEqual(["saving", "saved", "saving", "saved"]);
    });

    it("continuous edits are still written within maxWait", async () => {
        const repository = createRepository(createDatabase());
        const saveFull = vi.spyOn(repository, "saveFull");
        const saver = new ImportDraftAutoSaver(repository, {
            debounceMs: 800,
            maxWaitMs: 3000,
        });
        const snapshot = makeSnapshot(20);

        for (let i = 0; i < 40; i++) {
            saver.schedule({ ...snapshot, state: { ...snapshot.state, mappingName: `m${i}` } });
            await vi.advanceTimersByTimeAsync(200);
        }

        expect(saveFull).toHaveBeenCalled();
    });

    it("rewrites the preview payload only when the preview itself changes", async () => {
        const repository = createRepository(createDatabase());
        const saver = new ImportDraftAutoSaver(repository);
        const snapshot = makeSnapshot(30);

        saver.schedule(snapshot);
        await saver.flush();
        saver.schedule({ ...snapshot, state: { ...snapshot.state, categoryScope: "PERSONAL" } });
        await saver.flush();
        // Identical state: nothing written at all.
        saver.schedule({ ...snapshot, state: { ...snapshot.state, categoryScope: "PERSONAL" } });
        await saver.flush();
        // A new preview object (e.g. a mapping change): full rewrite.
        saver.schedule({ ...snapshot, preview: { ...snapshot.preview } });
        await saver.flush();

        expect(saver.fullWrites).toBe(2);
        expect(saver.stateWrites).toBe(1);
    });

    it("a failed write is reported and retried, never lost", async () => {
        const db = createDatabase();
        const repository = createRepository(db);
        const statuses: string[] = [];
        const saver = new ImportDraftAutoSaver(repository, {
            retryMs: 1000,
            onStatus: status => statuses.push(status.kind),
        });
        const spy = vi
            .spyOn(repository, "saveFull")
            .mockRejectedValueOnce(new Error("database is locked"));
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        saver.schedule(makeSnapshot(10));
        await saver.flush();

        expect(statuses).toContain("error");
        expect(draftCount(db)).toBe(0);
        expect(saver.hasUnsavedChanges()).toBe(true);

        await vi.advanceTimersByTimeAsync(1000);

        expect(spy).toHaveBeenCalledTimes(2);
        expect(draftCount(db)).toBe(1);
        expect(statuses[statuses.length - 1]).toBe("saved");
        error.mockRestore();
    });
});

describe("Import draft - lifecycle", () => {
    function batch(status: ImportBatch["status"]): ImportBatch {
        return {
            id: "batch-1",
            accountId: "acct-1",
            importType: "BANK_CSV",
            sourceFileName: "statement-aug.csv",
            status,
            totalRows: 10,
            importedRows: status === "FAILED" ? 0 : 10,
            duplicateRows: 0,
            failedRows: status === "FAILED" ? 10 : 0,
            createdAt: "2026-09-28T00:00:00.000Z",
            updatedAt: "2026-09-28T00:00:00.000Z",
        };
    }

    async function savedDraft() {
        const db = createDatabase();
        const repository = createRepository(db);
        const saver = new ImportDraftAutoSaver(repository);
        const snapshot = makeSnapshot(25);

        saver.schedule(snapshot);
        await saver.flush();

        return { db, repository, saver, snapshot };
    }

    it("a successful import removes the draft - only after it committed", async () => {
        const { db, repository, saver } = await savedDraft();
        let draftsDuringImport = -1;

        const result = await runImportWithDraft({
            draftId: "draft-1",
            saver,
            store: repository,
            runImport: async () => {
                draftsDuringImport = draftCount(db);
                return batch("COMPLETED");
            },
        });

        expect(draftsDuringImport).toBe(1);
        expect(result.draftCleared).toBe(true);
        expect(draftCount(db)).toBe(0);
        expect(importCommitted("COMPLETED_WITH_ERRORS")).toBe(true);
    });

    it("a failed import keeps the draft (thrown error or FAILED status)", async () => {
        const { db, repository, saver } = await savedDraft();

        await expect(
            runImportWithDraft({
                draftId: "draft-1",
                saver,
                store: repository,
                runImport: async () => {
                    throw new Error("2 rows do not match the statement's running balance");
                },
            })
        ).rejects.toThrow("running balance");
        expect(draftCount(db)).toBe(1);

        const failed = await runImportWithDraft({
            draftId: "draft-1",
            saver,
            store: repository,
            runImport: async () => batch("FAILED"),
        });
        expect(failed.draftCleared).toBe(false);
        expect(draftCount(db)).toBe(1);
    });

    it("pending edits are saved before the import runs, and never re-create a removed draft", async () => {
        const { db, repository, saver, snapshot } = await savedDraft();

        saver.schedule({ ...snapshot, state: { ...snapshot.state, mappingName: "Final name" } });

        await runImportWithDraft({
            draftId: "draft-1",
            saver,
            store: repository,
            runImport: async () => {
                const stored = parseImportDraft((await repository.load("draft-1"))!);
                expect(stored.state.mappingName).toBe("Final name");
                return batch("COMPLETED");
            },
        });

        await saver.flush();
        expect(draftCount(db)).toBe(0);
    });

    it("discard removes the draft and drops its pending save", async () => {
        const { db, repository, saver, snapshot } = await savedDraft();

        saver.schedule({ ...snapshot, state: { ...snapshot.state, mappingName: "x" } });
        await saver.forget("draft-1");
        await repository.delete("draft-1");
        await saver.flush();

        expect(draftCount(db)).toBe(0);
        expect(await repository.getSummary()).toBeNull();
    });

    it("starting another import never silently destroys an existing draft", async () => {
        const { db, repository } = await savedDraft();
        const summary = await repository.getSummary();

        // A saved draft (e.g. found after reload) or the active one - both
        // require explicit confirmation before a new preview.
        expect(
            requiresDraftReplacementConfirmation({
                storedDraft: summary,
                activeDraftId: null,
                replacementConfirmed: false,
            })
        ).toBe(true);
        expect(
            requiresDraftReplacementConfirmation({
                storedDraft: null,
                activeDraftId: "draft-1",
                replacementConfirmed: false,
            })
        ).toBe(true);
        expect(
            requiresDraftReplacementConfirmation({
                storedDraft: summary,
                activeDraftId: "draft-1",
                replacementConfirmed: true,
            })
        ).toBe(false);
        expect(
            requiresDraftReplacementConfirmation({
                storedDraft: null,
                activeDraftId: null,
                replacementConfirmed: false,
            })
        ).toBe(false);

        // Closing the preview / selecting another file schedules nothing,
        // so the stored draft is untouched.
        expect(draftCount(db)).toBe(1);

        // Only once confirmed does the new draft's first save replace it.
        const saver = new ImportDraftAutoSaver(repository);
        saver.schedule({ ...makeSnapshot(12), id: "draft-2" });
        await saver.flush();

        expect(draftCount(db)).toBe(1);
        expect((await repository.getSummary())!.id).toBe("draft-2");
    });
});

describe("Import draft - corrupted or incompatible drafts", () => {
    function goodRecord(): ImportDraftRecord {
        const snapshot = makeSnapshot(12);

        return {
            ...summarizeSnapshot(snapshot, "2026-09-28T10:00:00.000Z"),
            previewJson: JSON.stringify(encodeDraftPreview(snapshot.preview)),
            stateJson: JSON.stringify(encodeDraftState(snapshot.state)),
        };
    }

    const cases: Array<[string, (record: ImportDraftRecord) => ImportDraftRecord]> = [
        ["truncated preview JSON", r => ({ ...r, previewJson: r.previewJson.slice(0, 200) })],
        ["truncated state JSON", r => ({ ...r, stateJson: r.stateJson.slice(0, 50) })],
        ["another format version", r => ({ ...r, formatVersion: 999 })],
        ["preview not an object", r => ({ ...r, previewJson: "[]" })],
        ["rows missing", r => {
            const preview = JSON.parse(r.previewJson);
            delete preview.candidates;
            return { ...r, previewJson: JSON.stringify(preview) };
        }],
        ["invalid row", r => {
            const preview = JSON.parse(r.previewJson);
            preview.candidates[3] = { rowNumber: "x" };
            return { ...r, previewJson: JSON.stringify(preview) };
        }],
        ["row count mismatch", r => ({ ...r, rowCount: r.rowCount + 1 })],
        ["unknown import type", r => {
            const state = JSON.parse(r.stateJson);
            state.importType = "SOMETHING";
            return { ...r, stateJson: JSON.stringify(state) };
        }],
        ["bad override entry", r => {
            const state = JSON.parse(r.stateJson);
            state.overrides.payee = [[1]];
            return { ...r, stateJson: JSON.stringify(state) };
        }],
        ["missing account", r => {
            const state = JSON.parse(r.stateJson);
            delete state.accountId;
            return { ...r, stateJson: JSON.stringify(state) };
        }],
    ];

    it.each(cases)("%s -> ImportDraftError, never a crash", (_, corrupt) => {
        expect(() => parseImportDraft(corrupt(goodRecord()))).toThrow(
            ImportDraftError
        );
    });

    it("the untouched record restores fine", () => {
        expect(() => parseImportDraft(goodRecord())).not.toThrow();
    });
});

describe("Import draft - large previews", () => {
    for (const rows of [5_000, 10_000]) {
        it(`${rows.toLocaleString("en-US")} rows: full save, edit save and restore stay fast`, async () => {
            const snapshot = makeSnapshot(rows);

            // Many edits spread over the whole statement.
            let overrides = snapshot.state.overrides;
            const categoryId = new Map(overrides.categoryId);
            const notes = new Map(overrides.notes);

            snapshot.preview.candidates.forEach((candidate, index) => {
                if (index % 2 === 0) {
                    categoryId.set(candidate.rowNumber, `cat-${index % 90}`);
                    notes.set(candidate.rowNumber, `note ${index}`);
                }
            });
            overrides = { ...overrides, categoryId, notes };

            const edited = { ...snapshot, state: { ...snapshot.state, overrides } };
            const db = createDatabase();
            const repository = createRepository(db);
            const saver = new ImportDraftAutoSaver(repository);

            let started = performance.now();
            saver.schedule(edited);
            await saver.flush();
            const fullSaveMs = performance.now() - started;

            // A further single-row edit: only the state payload is written.
            const next = {
                ...edited,
                state: {
                    ...edited.state,
                    overrides: applyPayeeToMatchingRows(
                        edited.preview.candidates,
                        edited.state.overrides,
                        edited.preview.candidates[3]!.rowNumber,
                        "Edited payee"
                    ),
                },
            };
            started = performance.now();
            saver.schedule(next);
            await saver.flush();
            const editSaveMs = performance.now() - started;

            // Reload + restore.
            started = performance.now();
            const reloaded = createRepository(db);
            const record = (await reloaded.load((await reloaded.getSummary())!.id))!;
            const restored = parseImportDraft(record);
            const restoreMs = performance.now() - started;

            expect(saver.fullWrites).toBe(1);
            expect(saver.stateWrites).toBe(1);
            expect(restored.preview.candidates).toHaveLength(rows);
            expect(restored.state).toEqual(next.state);
            expect(restored.preview).toEqual(edited.preview);

            const previewMb = record.previewJson.length / 1_048_576;
            const stateKb = record.stateJson.length / 1024;

            console.info(
                `[import-draft perf] ${rows} rows: full save ${fullSaveMs.toFixed(0)}ms, ` +
                    `edit save ${editSaveMs.toFixed(0)}ms, restore ${restoreMs.toFixed(0)}ms, ` +
                    `preview ${previewMb.toFixed(1)}MB, state ${stateKb.toFixed(0)}KB`
            );

            // Generous bounds (CI noise) - typical numbers are far lower.
            expect(fullSaveMs).toBeLessThan(rows === 10_000 ? 4000 : 2500);
            expect(editSaveMs).toBeLessThan(500);
            expect(restoreMs).toBeLessThan(rows === 10_000 ? 4000 : 2500);
        }, 30_000);
    }
});
