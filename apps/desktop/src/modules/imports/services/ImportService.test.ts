import { beforeEach, describe, expect, it } from "vitest";

import {
    detectCsvColumns,
    extractTransactionPattern,
    processCsv,
    processDocumentWithMapping,
    type CsvDocument,
    type NormalizedTransactionCandidate,
} from "@financeos/import-engine";

import type { ImportBatch, ImportMapping, ImportRow } from "../types";

import {
    enrichCandidatesWithLearnedRules,
    enrichCandidatesWithLearnedRulesDetailed,
    ImportService,
    learnRuleFromCandidate,
    type TransactionPatternRuleStore,
} from "./ImportService";

function candidate(
    rowNumber: number,
    overrides: Partial<NormalizedTransactionCandidate> = {}
): NormalizedTransactionCandidate {
    return {
        rowNumber,
        transactionDate: "2026-08-01",
        payee: "Test",
        description: "Test",
        amount: 100,
        type: "expense",
        referenceNumber: null,
        externalTransactionId: null,
        balance: null,
        branch: null,
        transactionType: null,
        counterparty: null,
        notes: null,
        rawData: {},
        ...overrides,
    };
}

// A minimal in-memory stand-in for CounterpartyRuleRepository (see
// ImportService.TransactionPatternRuleStore) - account-scoped, keyed by
// "accountId::pattern", mirroring the real repository's
// UNIQUE(account_id, pattern) rule. A null type/notes on upsert
// preserves whatever was already stored, matching
// CounterpartyRuleRepository's COALESCE behavior.
function createFakeRuleStore(): TransactionPatternRuleStore {
    const rules = new Map<
        string,
        { counterparty: string; type: string | null; notes: string | null }
    >();

    return {
        async findByAccountAndPattern(accountId, pattern) {
            return rules.get(`${accountId}::${pattern}`) ?? null;
        },

        async upsert(accountId, pattern, payee, type, notes) {
            const key = `${accountId}::${pattern}`;
            const existing = rules.get(key);

            rules.set(key, {
                counterparty: payee,
                type: type ?? existing?.type ?? null,
                notes: notes ?? existing?.notes ?? null,
            });

            return null;
        },
    };
}

describe("Transaction pattern learning (account-scoped, reusing the counterparty_rules store)", () => {
    it("1. import -> user edits Payee/Type/Notes -> learned -> (transaction deleted, unrelated to learning) -> re-import applies all three learned values automatically, no manual re-entry", async () => {
        const store = createFakeRuleStore();

        // The original import: user corrects the raw, auto-detected
        // row by hand (this is what executeCandidates learns from -
        // see learnRuleFromCandidate's call site in executeCandidates).
        const editedOriginalRow = candidate(1, {
            payee: "SBI Card",
            description:
                "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
            transactionType: "NEFT",
            notes: "Credit card bill",
        });

        await learnRuleFromCandidate(
            "account-1",
            editedOriginalRow,
            store
        );

        // Deleting the resulting transaction is a TransactionRepository
        // concern (see TransactionRepository.test.ts, "8. learned rules
        // survive transaction deletion") - it never touches this rule
        // store, so re-importing afterward still finds it.
        const reimportedRow = candidate(1, {
            payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
            description:
                "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
            transactionType: null,
            notes: null,
        });

        const enriched =
            await enrichCandidatesWithLearnedRules(
                "account-1",
                [reimportedRow],
                store
            );

        expect(enriched[0].payee).toBe("SBI Card");
        expect(enriched[0].transactionType).toBe(
            "NEFT"
        );
        expect(enriched[0].notes).toBe(
            "Credit card bill"
        );
    });

    it("2. the same pattern arriving with its own already-populated Payee/Type/Notes still gets overwritten by the learned rule", async () => {
        const store = createFakeRuleStore();

        await learnRuleFromCandidate(
            "account-1",
            candidate(1, {
                payee: "SBI Card",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
                transactionType: "NEFT",
                notes: "Credit card bill",
            }),
            store
        );

        // A different statement, same pattern - already carries its
        // own (non-blank, possibly different) Payee/Type/Notes from raw
        // parsing/detection rather than nulls.
        const otherStatementRow = candidate(1, {
            payee: "NBSM/146900555/SBI CARD (BILLDESK)/",
            description:
                "2026-09-01 NBSM/146900555/SBI CARD (BILLDESK)/",
            transactionType: "UPI",
            notes: "auto note",
        });

        const enriched =
            await enrichCandidatesWithLearnedRules(
                "account-1",
                [otherStatementRow],
                store
            );

        expect(enriched[0].payee).toBe("SBI Card");
        expect(enriched[0].transactionType).toBe(
            "NEFT"
        );
        expect(enriched[0].notes).toBe(
            "Credit card bill"
        );
    });

    it("3. a Payee + Type + Notes learned in one import are all reused on the next import into the same account", async () => {
        const store = createFakeRuleStore();

        await learnRuleFromCandidate(
            "account-1",
            candidate(1, {
                payee: "SBI Card",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
                transactionType: "NEFT",
                notes: "Credit card bill",
            }),
            store
        );

        const nextImportCandidates = [
            candidate(1, {
                payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
                transactionType: null,
                notes: null,
            }),
        ];

        const enriched =
            await enrichCandidatesWithLearnedRules(
                "account-1",
                nextImportCandidates,
                store
            );

        expect(enriched[0].payee).toBe("SBI Card");
        expect(enriched[0].transactionType).toBe(
            "NEFT"
        );
        expect(enriched[0].notes).toBe(
            "Credit card bill"
        );
    });

    it("4. a rule learned for one account is never reused for the same pattern in a different account", async () => {
        const store = createFakeRuleStore();

        await learnRuleFromCandidate(
            "account-1",
            candidate(1, {
                payee: "SBI Card",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
                transactionType: "NEFT",
                notes: "Credit card bill",
            }),
            store
        );

        const otherAccountCandidates = [
            candidate(1, {
                payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
                transactionType: "UPI",
                notes: null,
            }),
        ];

        const enriched =
            await enrichCandidatesWithLearnedRules(
                "account-2",
                otherAccountCandidates,
                store
            );

        // Untouched - falls back to whatever was parsed/detected for
        // this account, never account-1's learned values.
        expect(enriched[0].payee).toBe(
            "NBSM/146803886/SBI CARD (BILLDESK)/"
        );
        expect(enriched[0].transactionType).toBe(
            "UPI"
        );
        expect(enriched[0].notes).toBeNull();
    });

    it("5. falls back to the existing DR/CR-independent Type detection when no Type has been learned yet", async () => {
        const store = createFakeRuleStore();

        // Learns only a Payee for this pattern - no Type, no Notes.
        await learnRuleFromCandidate(
            "account-1",
            candidate(1, {
                payee: "SBI Card",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
                transactionType: null,
                notes: null,
            }),
            store
        );

        const enriched =
            await enrichCandidatesWithLearnedRules(
                "account-1",
                [
                    candidate(1, {
                        payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                        description:
                            "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
                        // Already auto-detected by the existing
                        // channel-detection logic, independent of
                        // learning.
                        transactionType: "NEFT",
                        type: "expense",
                    }),
                ],
                store
            );

        expect(enriched[0].payee).toBe("SBI Card");
        // No learned Type yet - the existing auto-detected Type is kept
        // as the fallback, not cleared.
        expect(enriched[0].transactionType).toBe(
            "NEFT"
        );
        // DR/CR (income/expense) is a wholly separate field from
        // learning and is never touched by enrichment.
        expect(enriched[0].type).toBe("expense");
    });

    it("6. enrichment changes Payee/Type/Notes but leaves Description independent and untouched", async () => {
        const store = createFakeRuleStore();

        await learnRuleFromCandidate(
            "account-1",
            candidate(1, {
                payee: "SBI Card",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
                transactionType: "NEFT",
                notes: "Credit card bill",
            }),
            store
        );

        const enriched =
            await enrichCandidatesWithLearnedRules(
                "account-1",
                [
                    candidate(1, {
                        payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                        description:
                            "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
                    }),
                ],
                store
            );

        expect(enriched[0].payee).toBe("SBI Card");
        expect(enriched[0].notes).toBe(
            "Credit card bill"
        );
        expect(enriched[0].description).toBe(
            "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/"
        );
    });

    it("does not learn from a blank Payee, even with a Type/Notes present", async () => {
        const store = createFakeRuleStore();

        await learnRuleFromCandidate(
            "account-1",
            candidate(1, {
                payee: "",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
                transactionType: "NEFT",
                notes: "Credit card bill",
            }),
            store
        );

        const enriched =
            await enrichCandidatesWithLearnedRules(
                "account-1",
                [
                    candidate(1, {
                        payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                        description:
                            "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
                    }),
                ],
                store
            );

        expect(enriched[0].payee).toBe(
            "NBSM/146803886/SBI CARD (BILLDESK)/"
        );
        expect(enriched[0].transactionType).toBeNull();
        expect(enriched[0].notes).toBeNull();
    });

    it("does not learn from a narration too short/generic to safely learn from", async () => {
        const store = createFakeRuleStore();

        await learnRuleFromCandidate(
            "account-1",
            candidate(1, {
                payee: "Cash",
                description: "ATM",
                transactionType: "CASH",
            }),
            store
        );

        const enriched =
            await enrichCandidatesWithLearnedRules(
                "account-1",
                [candidate(1, { payee: "ATM", description: "ATM" })],
                store
            );

        expect(enriched[0].payee).toBe("ATM");
        expect(enriched[0].transactionType).toBeNull();
    });

    it("a later re-confirmation with a blank Type/Notes does not erase a previously-learned value", async () => {
        const store = createFakeRuleStore();

        await learnRuleFromCandidate(
            "account-1",
            candidate(1, {
                payee: "SBI Card",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
                transactionType: "NEFT",
                notes: "Credit card bill",
            }),
            store
        );

        // A later transaction for the same pattern happens to have no
        // Type/Notes of its own - learning from it must not blank out
        // the rule's already-learned Type/Notes.
        await learnRuleFromCandidate(
            "account-1",
            candidate(2, {
                payee: "SBI Card",
                description:
                    "2026-08-04 NBSM/146900000/SBI CARD (BILLDESK)/",
                transactionType: null,
                notes: null,
            }),
            store
        );

        const enriched =
            await enrichCandidatesWithLearnedRules(
                "account-1",
                [
                    candidate(3, {
                        payee: "NBSM/147000000/SBI CARD (BILLDESK)/",
                        description:
                            "2026-08-05 NBSM/147000000/SBI CARD (BILLDESK)/",
                    }),
                ],
                store
            );

        expect(enriched[0].transactionType).toBe(
            "NEFT"
        );
        expect(enriched[0].notes).toBe(
            "Credit card bill"
        );
    });
});

function makeCandidates(count: number): NormalizedTransactionCandidate[] {
    return Array.from({ length: count }, (_, i) =>
        candidate(i + 1, {
            payee: `Payee ${i + 1}`,
            description: `Description ${i + 1} narration text`,
            transactionType: null,
            notes: null,
        })
    );
}

describe("executeCandidates resilience - a learning failure must not abort the batch", () => {
    let batchRow: ImportBatch;
    const importRows = new Map<string, ImportRow>();

    const batchRepository = {
        async getById() {
            return batchRow;
        },
        async create() {},
        async update(
            request: Partial<ImportBatch> & { id: string }
        ) {
            batchRow = {
                ...batchRow,
                ...request,
            } as ImportBatch;
        },
    };

    const rowRepository = {
        async getByBatchId() {
            return Array.from(importRows.values());
        },
        async create(row: ImportRow) {
            importRows.set(row.id, row);
        },
        async update(
            request: Partial<ImportRow> & { id: string }
        ) {
            const existing = importRows.get(request.id);
            if (existing) {
                importRows.set(request.id, {
                    ...existing,
                    ...request,
                });
            }
        },
    };

    beforeEach(() => {
        importRows.clear();

        batchRow = {
            id: "batch-1",
            accountId: "account-1",
            importType: "BANK_CSV",
            sourceFileName: "statement.csv",
            status: "PENDING",
            totalRows: 0,
            importedRows: 0,
            duplicateRows: 0,
            failedRows: 0,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
        } as ImportBatch;
    });

    it("a rule-store upsert failure on one row is logged and skipped - every other row still imports and the batch still completes", async () => {
        const service = new ImportService();

        Object.defineProperty(service, "batchRepository", {
            value: batchRepository,
        });
        Object.defineProperty(service, "rowRepository", {
            value: rowRepository,
        });

        Object.defineProperty(
            service,
            "transactionRepository",
            {
                value: {
                    async findDuplicate() {
                        return null;
                    },
                },
            }
        );

        const createdIds: string[] = [];

        Object.defineProperty(
            service,
            "transactionService",
            {
                value: {
                    async create() {
                        const id = `txn-${createdIds.length + 1}`;
                        createdIds.push(id);
                        return id;
                    },
                },
            }
        );

        let upsertCallCount = 0;

        Object.defineProperty(
            service,
            "counterpartyRuleRepository",
            {
                value: {
                    async findByAccountAndPattern() {
                        return null;
                    },
                    async upsert() {
                        upsertCallCount += 1;
                        if (upsertCallCount === 2) {
                            throw new Error(
                                "SIMULATED: counterparty_rules upsert failed"
                            );
                        }
                        return null;
                    },
                },
            }
        );

        const candidates = makeCandidates(5);

        const result = await service.executeCandidates(
            "batch-1",
            candidates
        );

        // All 5 rows still imported - the one learning failure (row 2)
        // never aborted the loop or failed that row's transaction
        // import.
        expect(createdIds.length).toBe(5);
        expect(result.importedRows).toBe(5);
        expect(result.failedRows).toBe(0);
        expect(result.status).toBe("COMPLETED");
    });
});

// Regression coverage for a real bug: the Transactions list (TransactionTable)
// was reading `transaction.referenceNumber` for the line under Payee instead
// of `transaction.originalNarration`. Since banks commonly leave a "-"
// placeholder in the reference/cheque column (see
// TransactionRepository.isPlaceholderReference), imported rows displayed "-"
// there instead of their real narration - even though the narration was
// already being parsed and stored correctly the whole way through. This
// traces a narration end-to-end - real Axis CSV -> candidate.description ->
// Payee edited -> Payee learned -> a future import's candidate -> the
// executed transaction's stored `original_narration` - proving Description
// is never lost or replaced by Payee, learning, or Reference Number.
describe("End-to-end: an imported narration survives Payee edits/learning into the stored transaction", () => {
    it("CSV narration -> candidate.description -> edited/learned Payee -> executed transaction still has the original narration in original_narration", async () => {
        // 1. A real Axis-style export: "Transaction Particulars" is the
        // narration (-> description); "Cheque Number" is a distinct column
        // that happens to carry the bank's own "-" placeholder for a
        // non-cheque transaction - proving description and referenceNumber
        // are parsed as two genuinely independent fields, never one derived
        // from the other.
        const { candidates } = processCsv(
            [
                "Tran Date,Transaction Particulars,Amount(INR),DR|CR,Cheque Number",
                "01-08-2026,Test Reference,500.00,DR,-",
            ].join("\n")
        );

        const [rawCandidate] = candidates;

        expect(rawCandidate.description).toBe(
            "Test Reference"
        );
        expect(rawCandidate.referenceNumber).toBe(
            "-"
        );

        // 2. The user edits Payee in the preview - Description must not move.
        const payeeEdited: NormalizedTransactionCandidate =
            {
                ...rawCandidate,
                payee: "SBI Credit Card",
            };

        expect(payeeEdited.description).toBe(
            "Test Reference"
        );

        // 3. That correction gets learned for the account...
        const store = createFakeRuleStore();

        await learnRuleFromCandidate(
            "account-1",
            payeeEdited,
            store
        );

        // ...and a *future* import of the same narration pattern has its
        // Payee auto-filled from the learned rule while keeping its own,
        // independently-parsed Description.
        const nextImportCandidate: NormalizedTransactionCandidate =
            {
                ...rawCandidate,
                rowNumber: 2,
            };

        const [enriched] =
            await enrichCandidatesWithLearnedRules(
                "account-1",
                [nextImportCandidate],
                store
            );

        expect(enriched.payee).toBe(
            "SBI Credit Card"
        );
        expect(enriched.description).toBe(
            "Test Reference"
        );

        // 4. Executing the import must persist that same Description as the
        // transaction's `originalNarration` - the exact field the
        // Transactions list (TransactionTable) now displays under Payee.
        let batchRow: ImportBatch = {
            id: "batch-1",
            accountId: "account-1",
            importType: "BANK_CSV",
            sourceFileName: "axis-statement.csv",
            status: "PENDING",
            totalRows: 0,
            importedRows: 0,
            duplicateRows: 0,
            failedRows: 0,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
        };

        const importRows = new Map<string, ImportRow>();

        const createRequests: Array<
            Record<string, unknown>
        > = [];

        const service = new ImportService();

        Object.defineProperty(
            service,
            "batchRepository",
            {
                value: {
                    async getById() {
                        return batchRow;
                    },
                    async create() {},
                    async update(
                        request: Partial<ImportBatch> & {
                            id: string;
                        }
                    ) {
                        batchRow = {
                            ...batchRow,
                            ...request,
                        } as ImportBatch;
                    },
                },
            }
        );

        Object.defineProperty(
            service,
            "rowRepository",
            {
                value: {
                    async getByBatchId() {
                        return Array.from(
                            importRows.values()
                        );
                    },
                    async create(row: ImportRow) {
                        importRows.set(row.id, row);
                        return row;
                    },
                    async update(
                        request: Partial<ImportRow> & {
                            id: string;
                        }
                    ) {
                        const existing =
                            importRows.get(request.id);

                        if (existing) {
                            importRows.set(request.id, {
                                ...existing,
                                ...request,
                            });
                        }
                    },
                },
            }
        );

        Object.defineProperty(
            service,
            "transactionRepository",
            {
                value: {
                    async findDuplicate() {
                        return null;
                    },
                },
            }
        );

        Object.defineProperty(
            service,
            "transactionService",
            {
                value: {
                    async create(
                        request: Record<string, unknown>
                    ) {
                        createRequests.push(request);
                        return "txn-1";
                    },
                },
            }
        );

        Object.defineProperty(
            service,
            "counterpartyRuleRepository",
            {
                value: store,
            }
        );

        const result =
            await service.executeCandidates(
                "batch-1",
                [enriched]
            );

        expect(result.importedRows).toBe(1);
        expect(result.status).toBe("COMPLETED");

        expect(createRequests[0].payee).toBe(
            "SBI Credit Card"
        );
        expect(
            createRequests[0].originalNarration
        ).toBe("Test Reference");

        // Reference Number stays completely independent - the bank's "-"
        // placeholder is stored as-is and never leaks into Description.
        expect(
            createRequests[0].referenceNumber
        ).toBe("-");
    });
});

// Regression coverage for the Transactions page's "Mapping Name" filter
// (TransactionsPage.tsx): reuses the existing, previously-unset
// `sourceStatement` column rather than a new field, so a transaction's
// Mapping Name must round-trip exactly through executeCandidates/
// importCandidates with no effect on any other field.
describe("Mapping Name (sourceStatement) persistence on import", () => {
    function makeFakes() {
        let batchRow: ImportBatch = {
            id: "batch-1",
            accountId: "account-1",
            importType: "BANK_CSV",
            sourceFileName: "axis-statement.csv",
            status: "PENDING",
            totalRows: 0,
            importedRows: 0,
            duplicateRows: 0,
            failedRows: 0,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
        };

        const importRows = new Map<string, ImportRow>();
        const createRequests: Array<Record<string, unknown>> = [];

        const service = new ImportService();

        Object.defineProperty(service, "batchRepository", {
            value: {
                async getById() {
                    return batchRow;
                },
                async create() {},
                async update(
                    request: Partial<ImportBatch> & { id: string }
                ) {
                    batchRow = {
                        ...batchRow,
                        ...request,
                    } as ImportBatch;
                },
            },
        });

        Object.defineProperty(service, "rowRepository", {
            value: {
                async getByBatchId() {
                    return Array.from(importRows.values());
                },
                async create(row: ImportRow) {
                    importRows.set(row.id, row);
                    return row;
                },
                async update(
                    request: Partial<ImportRow> & { id: string }
                ) {
                    const existing = importRows.get(request.id);

                    if (existing) {
                        importRows.set(request.id, {
                            ...existing,
                            ...request,
                        });
                    }
                },
            },
        });

        Object.defineProperty(service, "transactionRepository", {
            value: {
                async findDuplicate() {
                    return null;
                },
            },
        });

        Object.defineProperty(service, "transactionService", {
            value: {
                async create(request: Record<string, unknown>) {
                    createRequests.push(request);
                    return `txn-${createRequests.length}`;
                },
            },
        });

        Object.defineProperty(
            service,
            "counterpartyRuleRepository",
            { value: createFakeRuleStore() }
        );

        return { service, createRequests };
    }

    it("stamps the created transaction with the Mapping Name used for the import", async () => {
        const { service, createRequests } = makeFakes();

        await service.executeCandidates(
            "batch-1",
            [candidate(1, { payee: "Limestone Networks" })],
            "Axisbank"
        );

        expect(createRequests[0].sourceStatement).toBe(
            "Axisbank"
        );
        // No side effect on unrelated fields.
        expect(createRequests[0].payee).toBe(
            "Limestone Networks"
        );
    });

    it("leaves sourceStatement unset when no Mapping Name is passed (e.g. a failed-mapping-save import)", async () => {
        const { service, createRequests } = makeFakes();

        await service.executeCandidates(
            "batch-1",
            [candidate(1)]
        );

        expect(
            createRequests[0].sourceStatement
        ).toBeUndefined();
    });

    it("importCandidates threads the Mapping Name through to the created transaction", async () => {
        const { service, createRequests } = makeFakes();

        await service.importCandidates(
            "account-1",
            "axis-statement.csv",
            "BANK_CSV",
            [candidate(1)],
            "Axisbank"
        );

        expect(createRequests[0].sourceStatement).toBe(
            "Axisbank"
        );
    });
});

// Transaction ID (externalTransactionId) - a manual-only mapping option
// (see "Transaction ID" in ImportsPage's MAPPING_FIELD_OPTIONS) - must
// round-trip through executeCandidates into the created transaction's
// externalTransactionId, with no effect on referenceNumber or duplicate
// detection.
describe("Transaction ID (externalTransactionId) mapping persistence on import", () => {
    function makeFakes(
        findDuplicate: () => Promise<string | null> = async () => null
    ) {
        let batchRow: ImportBatch = {
            id: "batch-1",
            accountId: "account-1",
            importType: "BANK_CSV",
            sourceFileName: "axis-statement.csv",
            status: "PENDING",
            totalRows: 0,
            importedRows: 0,
            duplicateRows: 0,
            failedRows: 0,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
        };

        const importRows = new Map<string, ImportRow>();
        const createRequests: Array<Record<string, unknown>> = [];
        const findDuplicateCalls: Array<Record<string, unknown>> = [];

        const service = new ImportService();

        Object.defineProperty(service, "batchRepository", {
            value: {
                async getById() {
                    return batchRow;
                },
                async create() {},
                async update(
                    request: Partial<ImportBatch> & { id: string }
                ) {
                    batchRow = {
                        ...batchRow,
                        ...request,
                    } as ImportBatch;
                },
            },
        });

        Object.defineProperty(service, "rowRepository", {
            value: {
                async getByBatchId() {
                    return Array.from(importRows.values());
                },
                async create(row: ImportRow) {
                    importRows.set(row.id, row);
                    return row;
                },
                async update(
                    request: Partial<ImportRow> & { id: string }
                ) {
                    const existing = importRows.get(request.id);

                    if (existing) {
                        importRows.set(request.id, {
                            ...existing,
                            ...request,
                        });
                    }
                },
            },
        });

        Object.defineProperty(service, "transactionRepository", {
            value: {
                async findDuplicate(
                    accountId: string,
                    transactionDate: string,
                    type: string,
                    amount: number,
                    referenceNumber: string | null,
                    payee: string,
                    description: string
                ) {
                    findDuplicateCalls.push({
                        accountId,
                        transactionDate,
                        type,
                        amount,
                        referenceNumber,
                        payee,
                        description,
                    });

                    return findDuplicate();
                },
            },
        });

        Object.defineProperty(service, "transactionService", {
            value: {
                async create(request: Record<string, unknown>) {
                    createRequests.push(request);
                    return `txn-${createRequests.length}`;
                },
            },
        });

        Object.defineProperty(
            service,
            "counterpartyRuleRepository",
            { value: createFakeRuleStore() }
        );

        return { service, createRequests, findDuplicateCalls };
    }

    it("passes a mapped Transaction ID through to the created transaction's externalTransactionId", async () => {
        const { service, createRequests } = makeFakes();

        await service.executeCandidates(
            "batch-1",
            [
                candidate(1, {
                    externalTransactionId: "TXN12345",
                }),
            ]
        );

        expect(
            createRequests[0].externalTransactionId
        ).toBe("TXN12345");
    });

    it("leaves externalTransactionId undefined on the created transaction when Transaction ID is not mapped (unmapped -> null candidate -> undefined request)", async () => {
        const { service, createRequests } = makeFakes();

        await service.executeCandidates(
            "batch-1",
            [candidate(1)]
        );

        expect(
            createRequests[0].externalTransactionId
        ).toBeUndefined();
    });

    it("does not affect referenceNumber - both can be mapped independently and are passed through unchanged", async () => {
        const { service, createRequests } = makeFakes();

        await service.executeCandidates(
            "batch-1",
            [
                candidate(1, {
                    referenceNumber: "REF001",
                    externalTransactionId: "TXN12345",
                }),
            ]
        );

        expect(createRequests[0].referenceNumber).toBe(
            "REF001"
        );
        expect(
            createRequests[0].externalTransactionId
        ).toBe("TXN12345");
    });

    it("does not affect duplicate detection - findDuplicate is called with the same arguments regardless of externalTransactionId", async () => {
        const { service, findDuplicateCalls } = makeFakes();

        await service.executeCandidates(
            "batch-1",
            [
                candidate(1, {
                    referenceNumber: "REF001",
                    externalTransactionId: "TXN12345",
                }),
            ]
        );

        // findDuplicate's signature (accountId, transactionDate, type,
        // amount, referenceNumber, payee, description) never receives
        // externalTransactionId at all.
        expect(findDuplicateCalls[0]).not.toHaveProperty(
            "externalTransactionId"
        );
        expect(
            findDuplicateCalls[0].referenceNumber
        ).toBe("REF001");
    });

    it("a duplicate is still detected/skipped exactly as before, independent of externalTransactionId", async () => {
        const { service, createRequests } = makeFakes(
            async () => "existing-txn-id"
        );

        const result = await service.executeCandidates(
            "batch-1",
            [
                candidate(1, {
                    externalTransactionId: "TXN12345",
                }),
            ]
        );

        expect(createRequests).toHaveLength(0);
        expect(result.duplicateRows).toBe(1);
    });
});

// 5. The Transactions page's "Bank Account" filter relies entirely on
// Transaction.accountId - already the existing, reliable source-account
// reference (see the transactions table's NOT NULL account_id column,
// migration 003). Every transaction created via an import is stamped
// with the batch's account, exactly like sourceStatement above - no new
// field, no schema change.
describe("Imported transactions retain the source Bank Account reference (Transaction.accountId)", () => {
    function makeFakes(accountId: string) {
        let batchRow: ImportBatch = {
            id: "batch-1",
            accountId,
            importType: "BANK_CSV",
            sourceFileName: "axis-statement.csv",
            status: "PENDING",
            totalRows: 0,
            importedRows: 0,
            duplicateRows: 0,
            failedRows: 0,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
        };

        const importRows = new Map<string, ImportRow>();
        const createRequests: Array<Record<string, unknown>> = [];

        const service = new ImportService();

        Object.defineProperty(service, "batchRepository", {
            value: {
                async getById() {
                    return batchRow;
                },
                async create() {},
                async update(
                    request: Partial<ImportBatch> & { id: string }
                ) {
                    batchRow = {
                        ...batchRow,
                        ...request,
                    } as ImportBatch;
                },
            },
        });

        Object.defineProperty(service, "rowRepository", {
            value: {
                async getByBatchId() {
                    return Array.from(importRows.values());
                },
                async create(row: ImportRow) {
                    importRows.set(row.id, row);
                    return row;
                },
                async update(
                    request: Partial<ImportRow> & { id: string }
                ) {
                    const existing = importRows.get(request.id);

                    if (existing) {
                        importRows.set(request.id, {
                            ...existing,
                            ...request,
                        });
                    }
                },
            },
        });

        Object.defineProperty(service, "transactionRepository", {
            value: {
                async findDuplicate() {
                    return null;
                },
            },
        });

        Object.defineProperty(service, "transactionService", {
            value: {
                async create(request: Record<string, unknown>) {
                    createRequests.push(request);
                    return `txn-${createRequests.length}`;
                },
            },
        });

        Object.defineProperty(
            service,
            "counterpartyRuleRepository",
            { value: createFakeRuleStore() }
        );

        return { service, createRequests };
    }

    it("stamps every imported transaction with the import batch's account_id", async () => {
        const { service, createRequests } = makeFakes(
            "savings-account-1"
        );

        await service.executeCandidates("batch-1", [
            candidate(1, { payee: "Limestone Networks" }),
            candidate(2, { payee: "Electricity Board" }),
        ]);

        expect(createRequests).toHaveLength(2);
        expect(createRequests[0].accountId).toBe(
            "savings-account-1"
        );
        expect(createRequests[1].accountId).toBe(
            "savings-account-1"
        );
    });

    it("a different account's import stamps its own account_id, never mixed up with another account", async () => {
        const { service, createRequests } = makeFakes(
            "current-account-2"
        );

        await service.executeCandidates("batch-1", [
            candidate(1),
        ]);

        expect(createRequests[0].accountId).toBe(
            "current-account-2"
        );
        expect(createRequests[0].accountId).not.toBe(
            "savings-account-1"
        );
    });

    it("executeCandidates refuses to import when the batch has no account - accountId can never end up missing/null on a created transaction", async () => {
        const { service } = makeFakes(
            null as unknown as string
        );

        await expect(
            service.executeCandidates("batch-1", [
                candidate(1),
            ])
        ).rejects.toThrow(
            "An account is required to import transactions."
        );
    });
});

// Regression coverage for the Import Preview's per-row Self-Learning
// toggle (ImportsPage's toggleSelfLearningRow / handleToggleSelfLearning):
// a row present in the disabled-rows set must not have
// learnRuleFromCandidate called for it during executeCandidates, while
// every other row (and the toggled row's own duplicate/import outcome)
// stays exactly as before.
describe("Per-row Self-Learning toggle", () => {
    function makeFakes() {
        let batchRow: ImportBatch = {
            id: "batch-1",
            accountId: "account-1",
            importType: "BANK_CSV",
            sourceFileName: "axis-statement.csv",
            status: "PENDING",
            totalRows: 0,
            importedRows: 0,
            duplicateRows: 0,
            failedRows: 0,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
        };

        const importRows = new Map<string, ImportRow>();
        const createRequests: Array<Record<string, unknown>> = [];
        const store = createFakeRuleStore();

        const service = new ImportService();

        Object.defineProperty(service, "batchRepository", {
            value: {
                async getById() {
                    return batchRow;
                },
                async create() {},
                async update(
                    request: Partial<ImportBatch> & { id: string }
                ) {
                    batchRow = {
                        ...batchRow,
                        ...request,
                    } as ImportBatch;
                },
            },
        });

        Object.defineProperty(service, "rowRepository", {
            value: {
                async getByBatchId() {
                    return Array.from(importRows.values());
                },
                async create(row: ImportRow) {
                    importRows.set(row.id, row);
                    return row;
                },
                async update(
                    request: Partial<ImportRow> & { id: string }
                ) {
                    const existing = importRows.get(request.id);

                    if (existing) {
                        importRows.set(request.id, {
                            ...existing,
                            ...request,
                        });
                    }
                },
            },
        });

        Object.defineProperty(service, "transactionRepository", {
            value: {
                async findDuplicate() {
                    return null;
                },
            },
        });

        Object.defineProperty(service, "transactionService", {
            value: {
                async create(request: Record<string, unknown>) {
                    createRequests.push(request);
                    return `txn-${createRequests.length}`;
                },
            },
        });

        Object.defineProperty(
            service,
            "counterpartyRuleRepository",
            { value: store }
        );

        return { service, createRequests, store };
    }

    it("default (no disabled-rows argument) preserves existing behavior - every row still learns", async () => {
        const { service, store } = makeFakes();

        const description = "SBI CARD BILLDESK PAYMENT";

        await service.executeCandidates("batch-1", [
            candidate(1, {
                payee: "SBI Card",
                description,
            }),
        ]);

        const rule = await store.findByAccountAndPattern(
            "account-1",
            description
        );

        expect(rule?.counterparty).toBe("SBI Card");
    });

    it("a row toggled OFF does not write/refresh a learned rule for that row", async () => {
        const { service, store } = makeFakes();

        const pattern = "TEST REFERENCE NARRATION";

        await service.executeCandidates(
            "batch-1",
            [
                candidate(1, {
                    payee: "Limestone Networks",
                    description: pattern,
                }),
            ],
            null,
            new Set([1])
        );

        const rule = await store.findByAccountAndPattern(
            "account-1",
            pattern
        );

        expect(rule).toBeNull();
    });

    it("toggling one row off never affects learning for other rows in the same import", async () => {
        const { service, store } = makeFakes();

        await service.executeCandidates(
            "batch-1",
            [
                candidate(1, {
                    payee: "Off Row Payee",
                    description: "OFF ROW NARRATION TEXT",
                }),
                candidate(2, {
                    payee: "On Row Payee",
                    description: "ON ROW NARRATION TEXT",
                }),
            ],
            null,
            new Set([1])
        );

        const offRule = await store.findByAccountAndPattern(
            "account-1",
            "OFF ROW NARRATION TEXT"
        );
        const onRule = await store.findByAccountAndPattern(
            "account-1",
            "ON ROW NARRATION TEXT"
        );

        expect(offRule).toBeNull();
        expect(onRule?.counterparty).toBe("On Row Payee");
    });

    it("toggling a row back ON (removed from the disabled set) restores normal learning for it", async () => {
        const { service, store } = makeFakes();

        const description = "RESTORED LEARNING NARRATION";

        await service.executeCandidates(
            "batch-1",
            [
                candidate(1, {
                    payee: "Restored Payee",
                    description,
                }),
            ],
            null,
            new Set() // row 1 not present - self-learning is on
        );

        const rule = await store.findByAccountAndPattern(
            "account-1",
            description
        );

        expect(rule?.counterparty).toBe("Restored Payee");
    });

    it("does not delete or disable an existing learned rule - it only skips writing a new one for this import", async () => {
        const { service, store } = makeFakes();

        const description = "EXISTING RULE NARRATION TEXT";

        // A rule already exists for this pattern from an earlier import.
        await store.upsert(
            "account-1",
            description,
            "Originally Learned Payee",
            null,
            null
        );

        await service.executeCandidates(
            "batch-1",
            [
                candidate(1, {
                    payee: "Different Payee This Time",
                    description,
                }),
            ],
            null,
            new Set([1])
        );

        const rule = await store.findByAccountAndPattern(
            "account-1",
            description
        );

        // Still exactly what it was before - never erased or overwritten.
        expect(rule?.counterparty).toBe(
            "Originally Learned Payee"
        );
    });

    it("the toggle only controls writing a rule - reading/applying an existing rule during enrichment is unaffected", async () => {
        const store = createFakeRuleStore();
        const description = "APPLIED DURING ENRICHMENT TEXT";

        await store.upsert(
            "account-1",
            description,
            "Learned Payee",
            null,
            null
        );

        // enrichCandidatesWithLearnedRules has no concept of the
        // Self-Learning toggle at all - it always applies an existing
        // rule, exactly as before this feature existed.
        const [enriched] = await enrichCandidatesWithLearnedRules(
            "account-1",
            [
                candidate(1, {
                    payee: "Raw Detected Payee",
                    description,
                }),
            ],
            store
        );

        expect(enriched.payee).toBe("Learned Payee");
    });
});

// Regression coverage for the Import Preview's Self-Learning indicator
// showing green ✓ on every row regardless of whether a rule actually
// existed. matchedRowNumbers (from enrichCandidatesWithLearnedRulesDetailed)
// is the single source of truth ImportsPage.tsx now reads for that icon -
// captured directly from the same lookup enrichCandidatesWithLearnedRules
// already performs, never a separately re-derived match.
describe("enrichCandidatesWithLearnedRulesDetailed - matchedRowNumbers as the source of truth for the Self-Learning indicator", () => {
    it("1. a row whose pattern has an existing learned rule is reported as matched (-> ✓)", async () => {
        const store = createFakeRuleStore();
        const description = "LIMESTONE NETWORKS HOSTING FEE";

        await store.upsert(
            "account-1",
            description,
            "Limestone Networks",
            null,
            null
        );

        const result = await enrichCandidatesWithLearnedRulesDetailed(
            "account-1",
            [candidate(1, { description })],
            store
        );

        expect(result.matchedRowNumbers.has(1)).toBe(true);
        expect(result.candidates[0].payee).toBe(
            "Limestone Networks"
        );
    });

    it("2. a row whose pattern has no existing learned rule is reported as not matched (-> ✕), even though it's otherwise perfectly eligible to be learned", async () => {
        const store = createFakeRuleStore();

        const result = await enrichCandidatesWithLearnedRulesDetailed(
            "account-1",
            [
                candidate(1, {
                    payee: "Some Payee",
                    description: "NO RULE HAS EVER BEEN LEARNED FOR THIS",
                }),
            ],
            store
        );

        expect(result.matchedRowNumbers.has(1)).toBe(false);
        // The candidate itself is untouched - no rule means no enrichment.
        expect(result.candidates[0].payee).toBe("Some Payee");
    });

    it("a row with no learning pattern at all (blank/too-short narration) is never reported as matched", async () => {
        const store = createFakeRuleStore();

        const result = await enrichCandidatesWithLearnedRulesDetailed(
            "account-1",
            [candidate(1, { description: "" })],
            store
        );

        expect(result.matchedRowNumbers.has(1)).toBe(false);
    });

    it("3. a matched row that gets toggled off for this import still shows as not-learning at execution (✓ -> ✕), without touching the saved rule", async () => {
        const store = createFakeRuleStore();
        const description = "SBI CARD BILLDESK PAYMENT";

        await store.upsert(
            "account-1",
            description,
            "SBI Card",
            null,
            null
        );

        // Preview-time: the row is reported as matched.
        const { candidates, matchedRowNumbers } =
            await enrichCandidatesWithLearnedRulesDetailed(
                "account-1",
                [candidate(1, { description })],
                store
            );

        expect(matchedRowNumbers.has(1)).toBe(true);

        // Import-time: the user toggled row 1's Self-Learning off, so
        // executeCandidates must not write/refresh the rule for it.
        let batchRow: ImportBatch = {
            id: "batch-1",
            accountId: "account-1",
            importType: "BANK_CSV",
            sourceFileName: "statement.csv",
            status: "PENDING",
            totalRows: 0,
            importedRows: 0,
            duplicateRows: 0,
            failedRows: 0,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
        };

        const importRows = new Map<string, ImportRow>();
        const service = new ImportService();

        Object.defineProperty(service, "batchRepository", {
            value: {
                async getById() {
                    return batchRow;
                },
                async create() {},
                async update(
                    request: Partial<ImportBatch> & { id: string }
                ) {
                    batchRow = {
                        ...batchRow,
                        ...request,
                    } as ImportBatch;
                },
            },
        });

        Object.defineProperty(service, "rowRepository", {
            value: {
                async getByBatchId() {
                    return Array.from(importRows.values());
                },
                async create(row: ImportRow) {
                    importRows.set(row.id, row);
                    return row;
                },
                async update(
                    request: Partial<ImportRow> & { id: string }
                ) {
                    const existing = importRows.get(request.id);

                    if (existing) {
                        importRows.set(request.id, {
                            ...existing,
                            ...request,
                        });
                    }
                },
            },
        });

        Object.defineProperty(service, "transactionRepository", {
            value: {
                async findDuplicate() {
                    return null;
                },
            },
        });

        Object.defineProperty(service, "transactionService", {
            value: {
                async create() {
                    return "txn-1";
                },
            },
        });

        Object.defineProperty(
            service,
            "counterpartyRuleRepository",
            { value: store }
        );

        // A further manual correction at import time - if the toggle
        // didn't prevent learning, this would overwrite the saved rule.
        const candidatesForImport = [
            {
                ...candidates[0],
                payee: "Different Payee At Import Time",
            },
        ];

        await service.executeCandidates(
            "batch-1",
            candidatesForImport,
            null,
            new Set([1])
        );

        // 4. The saved rule is exactly what it was before - the toggle
        // never modified or deleted it, despite the different final Payee
        // above.
        const ruleAfter = await store.findByAccountAndPattern(
            "account-1",
            description
        );

        expect(ruleAfter?.counterparty).toBe("SBI Card");
    });
});

// Self-Learning UX requirement: a rule newly learned from an in-preview
// edit (BLUE in ImportsPage - see deriveSessionLearnedRowNumbers in
// ImportsPage.test.ts) must never be written to the database during
// preview/enrichment - only an actual Import (executeCandidates, via
// learnRuleFromCandidate) may persist it.
describe("A session-learned (BLUE) rule is persisted only when Import is executed", () => {
    it("previewing/enriching an eligible row never upserts - only executeCandidates does, and only once Import runs", async () => {
        let upsertCalls = 0;

        const store: TransactionPatternRuleStore = {
            async findByAccountAndPattern() {
                // No pre-existing rule - this row is BLUE-eligible, not
                // GREEN.
                return null;
            },
            async upsert() {
                upsertCalls += 1;
                return null;
            },
        };

        const editedRow = candidate(2, {
            payee: "AMBIKA MEDICAL",
            description: "AMBIKA MEDICAL STORE PAYMENT",
        });

        // Preview-time: this is exactly what ImportsPage's handlePreview /
        // handleMappingChange call, and re-runs on every render via
        // previewCandidates - it must never write anything, even though
        // the row is now eligible to be learned.
        const preview =
            await enrichCandidatesWithLearnedRulesDetailed(
                "account-1",
                [editedRow],
                store
            );

        expect(preview.matchedRowNumbers.has(2)).toBe(
            false
        );
        expect(upsertCalls).toBe(0);

        // Import-time: only now does the final, user-edited row get
        // persisted.
        let batchRow: ImportBatch = {
            id: "batch-1",
            accountId: "account-1",
            importType: "BANK_CSV",
            sourceFileName: "statement.csv",
            status: "PENDING",
            totalRows: 0,
            importedRows: 0,
            duplicateRows: 0,
            failedRows: 0,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
        };

        const importRows = new Map<string, ImportRow>();
        const service = new ImportService();

        Object.defineProperty(service, "batchRepository", {
            value: {
                async getById() {
                    return batchRow;
                },
                async create() {},
                async update(
                    request: Partial<ImportBatch> & { id: string }
                ) {
                    batchRow = {
                        ...batchRow,
                        ...request,
                    } as ImportBatch;
                },
            },
        });

        Object.defineProperty(service, "rowRepository", {
            value: {
                async getByBatchId() {
                    return Array.from(importRows.values());
                },
                async create(row: ImportRow) {
                    importRows.set(row.id, row);
                    return row;
                },
                async update(
                    request: Partial<ImportRow> & { id: string }
                ) {
                    const existing = importRows.get(request.id);

                    if (existing) {
                        importRows.set(request.id, {
                            ...existing,
                            ...request,
                        });
                    }
                },
            },
        });

        Object.defineProperty(service, "transactionRepository", {
            value: {
                async findDuplicate() {
                    return null;
                },
            },
        });

        Object.defineProperty(service, "transactionService", {
            value: {
                async create() {
                    return "txn-1";
                },
            },
        });

        Object.defineProperty(
            service,
            "counterpartyRuleRepository",
            { value: store }
        );

        await service.executeCandidates(
            "batch-1",
            [editedRow]
        );

        expect(upsertCalls).toBe(1);
    });
});

// The Import Preview header's "clear all self-learned rules" action (see
// ImportsPage's clearRulesDialogOpen/handleClearAllLearnedRules). This
// only exercises ImportService.clearAllLearnedRules and its effect on
// enrichment - the confirmation gate itself lives entirely in the UI
// (the header tick only opens the dialog; only AlertDialogAction's
// onClick ever calls this method - AlertDialogCancel has no handler
// wired to it at all), so "confirmation required" / "Cancel does not
// clear" are exercised here as: nothing in the rule store changes unless
// this method is actually invoked.
describe("ImportService.clearAllLearnedRules (Import Preview 'clear all self-learned rules' header action)", () => {
    function createFakeRuleStoreWithDeleteAll() {
        const rules = new Map<
            string,
            { counterparty: string; type: string | null; notes: string | null }
        >();

        return {
            rules,

            async findByAccountAndPattern(
                accountId: string,
                pattern: string
            ) {
                return (
                    rules.get(`${accountId}::${pattern}`) ??
                    null
                );
            },

            async upsert(
                accountId: string,
                pattern: string,
                payee: string,
                type: string | null = null,
                notes: string | null = null
            ) {
                const key = `${accountId}::${pattern}`;
                const existing = rules.get(key);

                rules.set(key, {
                    counterparty: payee,
                    type: type ?? existing?.type ?? null,
                    notes: notes ?? existing?.notes ?? null,
                });

                return null;
            },

            // The actual behavior under test: an unscoped delete of
            // every rule, exactly like CounterpartyRuleRepository.
            // deleteAll's `DELETE FROM counterparty_rules` (no WHERE).
            async deleteAll() {
                rules.clear();
            },
        };
    }

    it("1. before confirmation: nothing calls clearAllLearnedRules, so the store is untouched (models the dialog being open, or Cancel, doing nothing)", async () => {
        const store = createFakeRuleStoreWithDeleteAll();

        await store.upsert(
            "account-1",
            "SOME PATTERN",
            "Some Payee"
        );

        // Simulates the header tick being clicked (opens the dialog)
        // and/or Cancel being clicked - neither of which, in the real
        // component, ever calls the service. Nothing here invokes
        // clearAllLearnedRules.
        expect(store.rules.size).toBe(1);
    });

    it("2. confirming deletes every persisted rule, across every account (not scoped to one account)", async () => {
        const store = createFakeRuleStoreWithDeleteAll();

        await store.upsert(
            "account-1",
            "ECS/TCFLA#/TATA CAPITAL LIMITED",
            "Tata Capital  Limited"
        );

        await store.upsert(
            "account-2",
            "SOME OTHER PATTERN",
            "Some Other Payee"
        );

        expect(store.rules.size).toBe(2);

        const service = new ImportService();

        Object.defineProperty(
            service,
            "counterpartyRuleRepository",
            { value: store }
        );

        await service.clearAllLearnedRules();

        expect(store.rules.size).toBe(0);
    });

    it("3. after clearing, a row that previously matched (GREEN) no longer matches - the existing, unmodified matching logic simply finds nothing", async () => {
        const store = createFakeRuleStoreWithDeleteAll();
        const description = "ECS/TCFLA0272000014487022/Tata Capital  Limited";

        await store.upsert(
            "account-1",
            extractTransactionPattern(description)!,
            "Tata Capital  Limited",
            "EMANDATE",
            "This is EMI of TATA Capital term loan"
        );

        const beforeClear =
            await enrichCandidatesWithLearnedRulesDetailed(
                "account-1",
                [candidate(1, { description })],
                store
            );

        expect(
            beforeClear.matchedRowNumbers.has(1)
        ).toBe(true);
        expect(beforeClear.candidates[0].payee).toBe(
            "Tata Capital  Limited"
        );

        const service = new ImportService();

        Object.defineProperty(
            service,
            "counterpartyRuleRepository",
            { value: store }
        );

        await service.clearAllLearnedRules();

        const afterClear =
            await enrichCandidatesWithLearnedRulesDetailed(
                "account-1",
                [candidate(1, { description })],
                store
            );

        expect(
            afterClear.matchedRowNumbers.has(1)
        ).toBe(false);
        // No rule left to enrich from - the row falls back to its raw,
        // unenriched Payee (still whatever candidate() defaults to).
        expect(afterClear.candidates[0].payee).toBe(
            candidate(1, { description }).payee
        );
    });
});

// Excel (.xlsx/.xls) import - only the file-parsing layer differs from
// CSV (see @financeos/import-engine's parseExcel/processExcel, which
// already reuses detectCsvColumns/normalizeCsvRows exactly like
// processCsv via pipeline.ts's shared processDocument helper - see
// packages/import-engine/src/tests/excelParser.test.ts for parser-level
// coverage of that). These tests exercise the same CsvDocument shape
// parseExcel produces through ImportService.previewWithMapping - the
// SAME method ImportsPage calls for an Excel file whenever a saved
// mapping is auto-matched (see handlePreview), and structurally
// identical to previewExcel's own enrichment/duplicate wiring (three
// lines, only the parser call differs - see previewExcel/previewCsv
// above) - proving Excel-sourced data flows through the exact same
// column-detection, self-learning, and duplicate-detection pipeline as
// CSV, with zero special-casing anywhere in ImportService.
describe("Excel import reuses the exact same universal pipeline as CSV", () => {
    // What packages/import-engine's parseExcel would produce for a
    // common "Date, Description, Debit, Credit, Reference" bank layout -
    // see excelParser.test.ts's createWorkbook fixture.
    const excelBankStatementDocument: CsvDocument = {
        headers: [
            "Date",
            "Description",
            "Debit",
            "Credit",
            "Reference",
        ],
        rows: [
            {
                rowNumber: 2,
                values: [
                    "2026-08-01",
                    "Coffee Shop",
                    "250",
                    "",
                    "REF001",
                ],
            },
            {
                rowNumber: 3,
                values: [
                    "2026-08-02",
                    "Salary",
                    "",
                    "50000",
                    "REF002",
                ],
            },
        ],
    };

    it("1. auto-detects columns for a common bank layout (Date/Description/Debit/Credit) exactly like CSV's detectCsvColumns", () => {
        const detection = detectCsvColumns(
            excelBankStatementDocument
        );

        expect(detection.mapping.date).toBe("Date");
        expect(detection.mapping.description).toBe(
            "Description"
        );
        expect(detection.mapping.debit).toBe("Debit");
        expect(detection.mapping.credit).toBe("Credit");
        expect(
            detection.mapping.referenceNumber
        ).toBe("Reference");
    });

    it("supports a single-Amount-column layout (no Debit/Credit split) via the same detection logic as CSV", () => {
        const document: CsvDocument = {
            headers: ["Date", "Description", "Amount"],
            rows: [
                {
                    rowNumber: 2,
                    values: [
                        "2026-08-03",
                        "Test",
                        "100",
                    ],
                },
            ],
        };

        const detection = detectCsvColumns(document);

        expect(detection.mapping.amount).toBe(
            "Amount"
        );
        expect(
            detection.mapping.debit
        ).toBeUndefined();
        expect(
            detection.mapping.credit
        ).toBeUndefined();
    });

    it("2. applies self-learning enrichment to Excel-sourced candidates identically to CSV (GREEN match)", async () => {
        const store = createFakeRuleStore();

        await store.upsert(
            "account-1",
            extractTransactionPattern("Coffee Shop")!,
            "Coffee Shop Ltd",
            "UPI",
            "Morning coffee"
        );

        const service = new ImportService();

        Object.defineProperty(
            service,
            "counterpartyRuleRepository",
            { value: store }
        );

        Object.defineProperty(
            service,
            "transactionService",
            {
                value: {
                    async findDuplicate() {
                        return null;
                    },
                },
            }
        );

        const detection = detectCsvColumns(
            excelBankStatementDocument
        );

        const result =
            await service.previewWithMapping(
                "account-1",
                excelBankStatementDocument,
                detection.mapping,
                "BANK_CSV"
            );

        expect(
            result.matchedLearnedRuleRowNumbers.has(2)
        ).toBe(true);
        expect(result.candidates[0].payee).toBe(
            "Coffee Shop Ltd"
        );
        expect(result.candidates[0].notes).toBe(
            "Morning coffee"
        );
        // Row 3 ("Salary") has no learned rule - untouched, exactly like
        // an unmatched CSV row.
        expect(
            result.matchedLearnedRuleRowNumbers.has(3)
        ).toBe(false);
    });

    it("3. detects duplicates for Excel-sourced candidates identically to CSV", async () => {
        const service = new ImportService();

        Object.defineProperty(
            service,
            "counterpartyRuleRepository",
            { value: createFakeRuleStore() }
        );

        Object.defineProperty(
            service,
            "transactionService",
            {
                value: {
                    async findDuplicate(
                        _accountId: string,
                        transactionDate: string
                    ) {
                        return transactionDate ===
                            "2026-08-01"
                            ? { id: "existing-txn-1" }
                            : null;
                    },
                },
            }
        );

        const detection = detectCsvColumns(
            excelBankStatementDocument
        );

        const result =
            await service.previewWithMapping(
                "account-1",
                excelBankStatementDocument,
                detection.mapping,
                "BANK_CSV"
            );

        expect(result.duplicates.get(2)).toBe(
            "existing-txn-1"
        );
        expect(
            result.duplicates.has(3)
        ).toBe(false);
    });
});

// 5. End-to-end: an Excel-derived candidate list is imported through
// executeCandidates - the same "transaction-creation pipeline used by
// CSV" (executeCandidates has no notion of source file format at all;
// it only ever sees NormalizedTransactionCandidate[] - see
// importCandidates/executeCandidates above).
describe("Excel-sourced import creates transactions through the exact same pipeline as CSV", () => {
    function makeFakes(accountId: string) {
        let batchRow: ImportBatch = {
            id: "batch-1",
            accountId,
            importType: "BANK_CSV",
            sourceFileName: "axis-statement.xlsx",
            status: "PENDING",
            totalRows: 0,
            importedRows: 0,
            duplicateRows: 0,
            failedRows: 0,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
        };

        const importRows = new Map<string, ImportRow>();
        const createRequests: Array<Record<string, unknown>> = [];
        const store = createFakeRuleStore();

        const service = new ImportService();

        Object.defineProperty(service, "batchRepository", {
            value: {
                async getById() {
                    return batchRow;
                },
                async create() {},
                async update(
                    request: Partial<ImportBatch> & { id: string }
                ) {
                    batchRow = {
                        ...batchRow,
                        ...request,
                    } as ImportBatch;
                },
            },
        });

        Object.defineProperty(service, "rowRepository", {
            value: {
                async getByBatchId() {
                    return Array.from(importRows.values());
                },
                async create(row: ImportRow) {
                    importRows.set(row.id, row);
                    return row;
                },
                async update(
                    request: Partial<ImportRow> & { id: string }
                ) {
                    const existing = importRows.get(request.id);

                    if (existing) {
                        importRows.set(request.id, {
                            ...existing,
                            ...request,
                        });
                    }
                },
            },
        });

        Object.defineProperty(service, "transactionRepository", {
            value: {
                async findDuplicate() {
                    return null;
                },
            },
        });

        Object.defineProperty(service, "transactionService", {
            value: {
                async create(request: Record<string, unknown>) {
                    createRequests.push(request);
                    return `txn-${createRequests.length}`;
                },
            },
        });

        Object.defineProperty(
            service,
            "counterpartyRuleRepository",
            { value: store }
        );

        return { service, createRequests, store };
    }

    it("persists accountId, Mapping Name, and learns a rule from an Excel-derived candidate list - identical to a CSV import", async () => {
        const document: CsvDocument = {
            headers: [
                "Date",
                "Description",
                "Debit",
                "Credit",
                "Reference",
            ],
            rows: [
                {
                    rowNumber: 2,
                    values: [
                        "2026-08-01",
                        "Coffee Shop",
                        "250",
                        "",
                        "REF001",
                    ],
                },
            ],
        };

        const detection = detectCsvColumns(document);

        const { candidates } =
            processDocumentWithMapping(
                document,
                detection.mapping,
                "BANK_CSV"
            );

        const { service, createRequests, store } =
            makeFakes("savings-account-1");

        await service.executeCandidates(
            "batch-1",
            candidates,
            "Axis Bank (Excel)"
        );

        expect(createRequests).toHaveLength(1);
        expect(createRequests[0].accountId).toBe(
            "savings-account-1"
        );
        expect(
            createRequests[0].sourceStatement
        ).toBe("Axis Bank (Excel)");
        expect(createRequests[0].payee).toBe(
            "Coffee Shop"
        );
        expect(createRequests[0].amount).toBe(250);
        expect(createRequests[0].type).toBe(
            "expense"
        );

        // Self-learning: a rule was persisted for this Excel-sourced
        // row's pattern, exactly as a CSV import would.
        const rule =
            await store.findByAccountAndPattern(
                "savings-account-1",
                extractTransactionPattern(
                    "Coffee Shop"
                )!
            );

        expect(rule?.counterparty).toBe(
            "Coffee Shop"
        );
    });
});

function makeMapping(
    overrides: Partial<ImportMapping> = {}
): ImportMapping {
    return {
        id: "mapping-1",
        name: "Axisbank",
        institutionName: "Axis Bank",
        importType: "BANK_CSV",
        headerSignature: "sig-1",
        headers: ["Date", "Description", "Amount"],
        mapping: {
            date: "Date",
            description: "Description",
            amount: "Amount",
        },
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        ...overrides,
    };
}

// Renaming a Saved Mapping (see ImportsPage's "Saved Mappings" section)
// must change only its name - never its column mapping/rules/
// headerSignature - and must keep every already-imported transaction's
// Mapping Name (source_statement) in sync, since that field is free
// text stamped at import time, not a foreign key to import_mappings
// (see ImportService.renameMapping / TransactionRepository.
// renameSourceStatement).
describe("ImportService.renameMapping", () => {
    function makeFakes(initialMappings: ImportMapping[]) {
        const mappingsById = new Map(
            initialMappings.map(mapping => [
                mapping.id,
                mapping,
            ])
        );

        const renameSourceStatementCalls: Array<{
            oldName: string;
            newName: string;
        }> = [];

        const service = new ImportService();

        Object.defineProperty(service, "mappingRepository", {
            value: {
                async findById(id: string) {
                    return mappingsById.get(id) ?? null;
                },
                async getAll() {
                    return Array.from(
                        mappingsById.values()
                    );
                },
                async rename(id: string, name: string) {
                    const existing =
                        mappingsById.get(id);

                    if (!existing) {
                        throw new Error(
                            "Import mapping not found."
                        );
                    }

                    const renamed = {
                        ...existing,
                        name,
                        updatedAt:
                            "2026-09-08T00:00:00.000Z",
                    };

                    mappingsById.set(id, renamed);

                    return renamed;
                },
            },
        });

        Object.defineProperty(
            service,
            "transactionRepository",
            {
                value: {
                    async renameSourceStatement(
                        oldName: string,
                        newName: string
                    ) {
                        renameSourceStatementCalls.push({
                            oldName,
                            newName,
                        });
                    },
                },
            }
        );

        return {
            service,
            mappingsById,
            renameSourceStatementCalls,
        };
    }

    it("renames only the mapping's name - column mapping/rules/headerSignature/headers are untouched", async () => {
        const mapping = makeMapping();
        const { service, mappingsById } =
            makeFakes([mapping]);

        const renamed = await service.renameMapping(
            "mapping-1",
            "Axis Bank - Savings"
        );

        expect(renamed.name).toBe(
            "Axis Bank - Savings"
        );
        expect(renamed.mapping).toEqual(
            mapping.mapping
        );
        expect(renamed.headerSignature).toBe(
            mapping.headerSignature
        );
        expect(renamed.headers).toEqual(
            mapping.headers
        );
        expect(renamed.importType).toBe(
            mapping.importType
        );

        expect(
            mappingsById.get("mapping-1")?.name
        ).toBe("Axis Bank - Savings");
    });

    it("updates every existing transaction's Mapping Name (sourceStatement) created from the renamed mapping", async () => {
        const mapping = makeMapping();
        const { service, renameSourceStatementCalls } =
            makeFakes([mapping]);

        await service.renameMapping(
            "mapping-1",
            "Axis Bank - Savings"
        );

        expect(
            renameSourceStatementCalls
        ).toEqual([
            {
                oldName: "Axisbank",
                newName: "Axis Bank - Savings",
            },
        ]);
    });

    it("rejects an empty/whitespace-only name and does not persist a rename or touch any transaction", async () => {
        const mapping = makeMapping();
        const {
            service,
            renameSourceStatementCalls,
            mappingsById,
        } = makeFakes([mapping]);

        await expect(
            service.renameMapping("mapping-1", "   ")
        ).rejects.toThrow(
            "Mapping name cannot be empty."
        );

        expect(
            mappingsById.get("mapping-1")?.name
        ).toBe("Axisbank");
        expect(
            renameSourceStatementCalls
        ).toHaveLength(0);
    });

    it("trims surrounding whitespace before saving", async () => {
        const mapping = makeMapping();
        const { service } = makeFakes([mapping]);

        const renamed = await service.renameMapping(
            "mapping-1",
            "  Axis Bank  "
        );

        expect(renamed.name).toBe("Axis Bank");
    });

    it("is a no-op on transactions when the trimmed name is unchanged from the mapping's current name", async () => {
        const mapping = makeMapping();
        const { service, renameSourceStatementCalls } =
            makeFakes([mapping]);

        await service.renameMapping(
            "mapping-1",
            "Axisbank"
        );

        expect(
            renameSourceStatementCalls
        ).toHaveLength(0);
    });

    it("throws when the mapping id does not exist, without touching any transaction", async () => {
        const { service, renameSourceStatementCalls } =
            makeFakes([]);

        await expect(
            service.renameMapping(
                "missing-id",
                "New Name"
            )
        ).rejects.toThrow(
            "Import mapping not found."
        );

        expect(
            renameSourceStatementCalls
        ).toHaveLength(0);
    });
});

describe("ImportService.listMappings", () => {
    it("returns every saved mapping from the repository", async () => {
        const mappingA = makeMapping({
            id: "mapping-1",
            name: "Axisbank",
        });

        const mappingB = makeMapping({
            id: "mapping-2",
            name: "HDFC Bank",
        });

        const service = new ImportService();

        Object.defineProperty(
            service,
            "mappingRepository",
            {
                value: {
                    async getAll() {
                        return [mappingA, mappingB];
                    },
                },
            }
        );

        const result = await service.listMappings();

        expect(result).toEqual([
            mappingA,
            mappingB,
        ]);
    });
});
