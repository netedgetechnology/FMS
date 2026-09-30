import { describe, expect, it } from "vitest";

import type { NormalizedTransactionCandidate } from "@financeos/import-engine";

import type { CustomImportRule } from "../types";

import {
    applyCustomImportRules,
    countCustomRuleMatches,
    customRuleFieldsForDescription,
    customRuleMatchesDescription,
} from "./customImportRules";
import {
    enrichCandidatesWithLearnedRulesDetailed,
    reapplyCustomImportRules,
    withCustomImportRules,
    type TransactionPatternRuleStore,
} from "./ImportService";
import { learningKeyForCandidate } from "./learningKey";

function row(
    rowNumber: number,
    description: string,
    overrides: Partial<NormalizedTransactionCandidate> = {}
): NormalizedTransactionCandidate {
    return {
        rowNumber,
        transactionDate: "2026-06-30",
        payee: description,
        description,
        amount: 1000 + rowNumber,
        type: "expense",
        referenceNumber: null,
        externalTransactionId: null,
        transactionType: null,
        balance: null,
        branch: null,
        counterparty: null,
        notes: null,
        categoryId: null,
        rawData: { Description: description },
        ...overrides,
    };
}

let sequence = 0;

function rule(
    keyword: string,
    fields: Partial<
        Pick<CustomImportRule, "payee" | "notes" | "categoryId" | "transactionType">
    >,
    accountId = "acct-od"
): CustomImportRule {
    sequence += 1;

    return {
        id: `rule-${sequence}`,
        accountId,
        keyword,
        payee: fields.payee ?? null,
        notes: fields.notes ?? null,
        categoryId: fields.categoryId ?? null,
        transactionType: fields.transactionType ?? null,
        createdAt: "2026-09-27 10:00:00",
        updatedAt: "2026-09-27 10:00:00",
    };
}

const DOD = rule("LAP DOD INT", {
    payee: "DOD Interest",
    notes: "Overdraft interest",
});

const statement = [
    row(1, "LAP DOD INT JUN22"),
    row(2, "LAP DOD INT July22"),
    row(3, "LAP DOD INT AUG22"),
    row(4, "IMPS/NA/XXXX0001/RRN:209112681677/SUPPLIER"),
    row(5, "NET TXN: BILLDESK SBICARD"),
];

describe("matching", () => {
    it("matches when the Description CONTAINS the keyword", () => {
        expect(
            customRuleMatchesDescription(DOD, "06-APR-2022 LAP DOD INT MAR22 000000000000")
        ).toBe(true);
    });

    it("is case-insensitive", () => {
        expect(customRuleMatchesDescription(DOD, "lap dod int jun22")).toBe(true);
        expect(
            customRuleMatchesDescription(rule("lap dod int", { payee: "x" }), "LAP DOD INT JUN22")
        ).toBe(true);
    });

    it("normalizes whitespace on both sides (runs of spaces, tabs, line breaks, NBSP)", () => {
        expect(customRuleMatchesDescription(DOD, "LAP  DOD\tINT\nJUN22")).toBe(true);
        expect(customRuleMatchesDescription(DOD, "LAP DOD INT JUN22")).toBe(true);
        expect(
            customRuleMatchesDescription(rule("  LAP   DOD  INT ", { payee: "x" }), "LAP DOD INT JUN22")
        ).toBe(true);
    });

    it("matches every suffix variation (JUN22 / July22 / AUG22) and multiple rows", () => {
        const { applications } = applyCustomImportRules(statement, [DOD]);

        expect([...applications.keys()]).toEqual([1, 2, 3]);
        expect(countCustomRuleMatches(statement, "LAP DOD INT")).toBe(3);
    });

    it("no match leaves every row as the very same object", () => {
        const noMatch = rule("SALARY CREDIT", { payee: "Employer" });
        const { candidates, applications } = applyCustomImportRules(statement, [noMatch]);

        expect(applications.size).toBe(0);
        candidates.forEach((candidate, index) =>
            expect(candidate).toBe(statement[index])
        );
        expect(countCustomRuleMatches(statement, "SALARY CREDIT")).toBe(0);
    });

    it("a blank keyword never matches anything", () => {
        expect(countCustomRuleMatches(statement, "   ")).toBe(0);
        expect(customRuleMatchesDescription(rule(" ", { payee: "x" }), "anything")).toBe(false);
    });
});

describe("application", () => {
    it("only overrides the fields the rule specifies", () => {
        const categorised = row(1, "LAP DOD INT JUN22", {
            transactionType: "NEFT",
            categoryId: "cat-bank",
        });

        const { candidates } = applyCustomImportRules([categorised], [DOD]);

        expect(candidates[0]).toEqual({
            ...categorised,
            payee: "DOD Interest",
            notes: "Overdraft interest",
            // Not specified by the rule - untouched.
            transactionType: "NEFT",
            categoryId: "cat-bank",
        });
    });

    it("never modifies the original Description (or amount, date, direction, raw data)", () => {
        const { candidates } = applyCustomImportRules(statement, [DOD]);

        candidates.forEach((candidate, index) => {
            const original = statement[index]!;

            expect(candidate.description).toBe(original.description);
            expect(candidate.rawData).toBe(original.rawData);
            expect(candidate.amount).toBe(original.amount);
            expect(candidate.type).toBe(original.type);
            expect(candidate.transactionDate).toBe(original.transactionDate);
        });
        // The input array itself is untouched too.
        expect(statement[0]!.payee).toBe("LAP DOD INT JUN22");
    });

    it("can set Category and Type", () => {
        const full = rule("LAP DOD INT", {
            categoryId: "cat-interest",
            transactionType: "NET_BANKING",
        });

        const { candidates } = applyCustomImportRules([statement[0]!], [full]);

        expect(candidates[0]).toMatchObject({
            categoryId: "cat-interest",
            transactionType: "NET_BANKING",
            // Not specified.
            payee: "LAP DOD INT JUN22",
            notes: null,
        });
    });

    it("multiple matching rules: the most recently created rule wins per field; older rules still fill fields newer ones leave unset", () => {
        const older = rule("DOD INT", {
            payee: "Old Payee",
            notes: "Old notes",
            categoryId: "cat-old",
        });
        const newer = rule("LAP DOD INT", {
            payee: "DOD Interest",
            transactionType: "NET_BANKING",
        });

        // Newest first, as CustomImportRuleRepository.listByAccount returns.
        const { candidates, applications } = applyCustomImportRules(
            [statement[0]!],
            [newer, older]
        );

        expect(candidates[0]).toMatchObject({
            payee: "DOD Interest",
            transactionType: "NET_BANKING",
            notes: "Old notes",
            categoryId: "cat-old",
        });
        expect(applications.get(1)).toEqual({
            ruleIdByField: {
                payee: newer.id,
                transactionType: newer.id,
                notes: older.id,
                categoryId: older.id,
            },
            ruleIds: [newer.id, older.id],
            keyword: "LAP DOD INT",
        });

        // Reversing the order reverses the winner - order is the only
        // precedence input, so it's deterministic.
        const reversed = applyCustomImportRules([statement[0]!], [older, newer]);
        expect(reversed.candidates[0]!.payee).toBe("Old Payee");
    });

    it("customRuleFieldsForDescription reports exactly the fields rules own on a row", () => {
        expect([...customRuleFieldsForDescription("LAP DOD INT JUN22", [DOD])].sort()).toEqual([
            "notes",
            "payee",
        ]);
        expect(customRuleFieldsForDescription("SALARY", [DOD]).size).toBe(0);
    });
});

describe("precedence with automatic Self-Learning", () => {
    // An automatic learned rule for the DOD pattern: Payee + Notes +
    // Category + Type.
    function learnedStore(): TransactionPatternRuleStore {
        const key = learningKeyForCandidate(statement[0]!)!;

        return {
            async findByAccountAndPattern(_accountId, pattern) {
                return pattern === key
                    ? {
                          counterparty: "Learned Payee",
                          type: "NEFT",
                          notes: "Learned notes",
                          categoryId: "cat-learned",
                      }
                    : null;
            },
            async upsert() {
                throw new Error("enrichment must never write");
            },
        };
    }

    it("Custom Rule > Self-Learning > imported, per specified field; unspecified fields keep Self-Learning", async () => {
        const learned = await enrichCandidatesWithLearnedRulesDetailed(
            "acct-od",
            [statement[0]!],
            learnedStore()
        );

        expect(learned.candidates[0]).toMatchObject({
            payee: "Learned Payee",
            notes: "Learned notes",
        });

        const payeeOnly = rule("LAP DOD INT", { payee: "DOD Interest" });
        const result = withCustomImportRules(learned, [payeeOnly]);

        expect(result.candidates[0]).toMatchObject({
            // Custom rule wins where it specifies a field...
            payee: "DOD Interest",
            // ...and Self-Learning still supplies everything else.
            notes: "Learned notes",
            categoryId: "cat-learned",
            transactionType: "NEFT",
            description: "LAP DOD INT JUN22",
        });
    });

    it("without any custom rule, the Self-Learning result is passed through unchanged", async () => {
        const learned = await enrichCandidatesWithLearnedRulesDetailed(
            "acct-od",
            statement,
            learnedStore()
        );

        const result = withCustomImportRules(learned, []);

        result.candidates.forEach((candidate, index) =>
            expect(candidate).toBe(learned.candidates[index])
        );
        expect([...result.matchedRowNumbers]).toEqual([
            ...learned.matchedRowNumbers,
        ]);
        expect(result.customRuleState.applications.size).toBe(0);
    });

    it("rows a custom rule applied to count as having a permanent learned rule applied", async () => {
        const learned = await enrichCandidatesWithLearnedRulesDetailed(
            "acct-od",
            statement,
            { async findByAccountAndPattern() { return null; }, async upsert() { return null; } }
        );

        const result = withCustomImportRules(learned, [DOD]);

        expect([...result.matchedRowNumbers].sort()).toEqual([1, 2, 3]);
        expect(result.customRuleState.learnedRuleRowNumbers.size).toBe(0);
    });
});

describe("re-applying to an open preview (create / delete a rule)", () => {
    it("a new rule applies immediately; deleting it restores the Self-Learning values", async () => {
        const learned = await enrichCandidatesWithLearnedRulesDetailed(
            "acct-od",
            statement,
            { async findByAccountAndPattern() { return null; }, async upsert() { return null; } }
        );

        const initial = withCustomImportRules(learned, []);
        let preview = {
            candidates: initial.candidates,
            matchedLearnedRuleRowNumbers: initial.matchedRowNumbers,
            customRuleState: initial.customRuleState,
            duplicates: new Map<number, string>(),
        };

        preview = reapplyCustomImportRules(preview, [DOD]);

        expect(preview.candidates.slice(0, 3).map(c => c.payee)).toEqual([
            "DOD Interest",
            "DOD Interest",
            "DOD Interest",
        ]);
        expect(preview.customRuleState.applications.size).toBe(3);
        // Unrelated preview state is kept.
        expect(preview.duplicates).toBeInstanceOf(Map);

        preview = reapplyCustomImportRules(preview, []);

        expect(preview.candidates.map(c => c.payee)).toEqual(
            statement.map(c => c.payee)
        );
        expect(preview.matchedLearnedRuleRowNumbers.size).toBe(0);
    });

    it("a preview without custom-rule state is returned unchanged", () => {
        const preview = {
            candidates: statement,
            matchedLearnedRuleRowNumbers: new Set<number>(),
        };

        expect(reapplyCustomImportRules(preview, [DOD])).toBe(preview);
    });
});

describe("performance", () => {
    it.each([5000, 10000])(
        "%i rows x 25 rules applies in linear time and leaves unmatched rows untouched",
        n => {
            const rows = Array.from({ length: n }, (_, i) =>
                row(
                    i + 1,
                    i % 10 === 0
                        ? `LAP DOD INT ${["JUN", "July", "AUG"][i % 3]}${22 + (i % 5)}`
                        : `UPI/DR/${4100000 + i}/MERCHANT${i % 400}/YBL/PAYMENT`
                )
            );

            const rules = [
                DOD,
                ...Array.from({ length: 24 }, (_, i) =>
                    rule(`NO SUCH KEYWORD ${i}`, { payee: `P${i}` })
                ),
            ];

            // Warm up once, then keep the best of three runs, so a one-off
            // stall from other suites running in parallel can't fail it
            // (a quadratic regression would still be far over the limit).
            applyCustomImportRules(rows, rules);

            let elapsed = Infinity;
            let result = applyCustomImportRules(rows, rules);

            for (let run = 0; run < 3; run += 1) {
                const started = performance.now();
                result = applyCustomImportRules(rows, rules);
                elapsed = Math.min(elapsed, performance.now() - started);
            }

            const { candidates, applications } = result;

            expect(applications.size).toBe(n / 10);
            expect(elapsed).toBeLessThan(500);

            let untouched = 0;
            candidates.forEach((candidate, index) => {
                if (candidate === rows[index]) {
                    untouched += 1;
                }
            });
            expect(untouched).toBe(n - n / 10);
        }
    );
});
