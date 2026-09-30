import { describe, expect, it } from "vitest";

import {
    isEmptyMoney,
    normalizeDirectionText,
    parseBalance,
    parseMoney,
    resolveCanonicalAmount,
} from "../normalizer/moneyNormalizer";
import { processCsv } from "../pipeline";

describe("parseMoney - one cell", () => {
    it.each([
        ["1500", 1500],
        ["1500.5", 1500.5],
        ["1,500.00", 1500],
        ["1,05,000.00", 105000],
        ["₹1,500.00", 1500],
        ["₹ 1,500.00", 1500],
        ["$99.99", 99.99],
        ["Rs. 250.00", 250],
        ["INR 250.00", 250],
        ["250.00 INR", 250],
        ["+2,500.00", 2500],
        [".50", 0.5],
    ])("%s -> %d", (raw, expected) => {
        const money = parseMoney(raw);

        expect(money.kind).toBe("value");
        expect(money.value).toBe(expected);
        expect(money.negative).toBe(false);
        expect(money.marker).toBeNull();
    });

    it.each([
        ["-500.00", -500],
        ["(500.00)", -500],
        ["500.00-", -500],
        ["-₹500.00", -500],
        ["₹-500.00", -500],
    ])("negative %s -> %d", (raw, expected) => {
        const money = parseMoney(raw);

        expect(money.value).toBe(expected);
        expect(money.magnitude).toBe(
            Math.abs(expected),
        );
        expect(money.negative).toBe(true);
    });

    it.each([
        ["500.00 Dr", "DR"],
        ["500.00Dr", "DR"],
        ["500.00 DR.", "DR"],
        ["500.00 (Dr)", "DR"],
        ["Dr 500.00", "DR"],
        ["1,500.00 Cr", "CR"],
        ["1,500.00CR", "CR"],
        ["cr 1,500.00", "CR"],
    ])("DR/CR marker %s -> %s", (raw, marker) => {
        const money = parseMoney(raw);

        expect(money.kind).toBe("value");
        expect(money.marker).toBe(marker);
        expect(money.negative).toBe(false);
    });

    it("only accepts a single-letter C/D marker when asked to", () => {
        expect(parseMoney("50.00 C").kind).toBe(
            "invalid",
        );

        const money = parseMoney("50.00 D", {
            allowSingleLetterMarker: true,
        });

        expect(money.marker).toBe("DR");
        expect(money.magnitude).toBe(50);
    });

    it.each(["-", "--", "—", "nil", "NA", "n/a"])(
        "placeholder %s is an empty cell, not a value",
        (raw) => {
            const money = parseMoney(raw);

            expect(money.kind).toBe("placeholder");
            expect(isEmptyMoney(money)).toBe(true);
        },
    );

    it("treats blank and unmarked zero as empty, but a marked zero as present", () => {
        expect(isEmptyMoney(parseMoney(""))).toBe(true);
        expect(isEmptyMoney(parseMoney("  "))).toBe(
            true,
        );
        expect(isEmptyMoney(parseMoney("0.00"))).toBe(
            true,
        );
        expect(
            isEmptyMoney(parseMoney("0.00 Dr")),
        ).toBe(false);
        expect(isEmptyMoney(parseMoney("5.00"))).toBe(
            false,
        );
    });

    it.each([
        "abc",
        "12a",
        "1.234,56",
        "(500.00",
        "0.00)",
        "CR",
    ])("rejects %s", (raw) => {
        expect(parseMoney(raw).kind).toBe("invalid");
    });

    it("requireDecimal rejects bare integers (reference numbers in free text)", () => {
        expect(
            parseMoney("111615705231", {
                requireDecimal: true,
            }).kind,
        ).toBe("invalid");

        expect(
            parseMoney("1,500.00", {
                requireDecimal: true,
            }).value,
        ).toBe(1500);
    });
});

describe("parseBalance", () => {
    it.each([
        ["12,345.00", 12345],
        ["12,345.00 Cr", 12345],
        ["12,345.00 Dr", -12345],
        ["-6,234,251.30", -6234251.3],
        ["(100.00)", -100],
        ["", null],
        ["-", null],
    ])("%s -> %s", (raw, expected) => {
        expect(parseBalance(raw)).toBe(expected);
    });
});

describe("normalizeDirectionText", () => {
    it.each([
        ["CR", "income"],
        ["Cr.", "income"],
        ["C", "income"],
        ["Credit", "income"],
        ["Deposit", "income"],
        ["DR", "expense"],
        ["dr.", "expense"],
        ["D", "expense"],
        ["Debit", "expense"],
        ["Withdrawal", "expense"],
        ["Transfer", "transfer"],
        ["", null],
        ["unknown", null],
    ])("%s -> %s", (raw, expected) => {
        expect(normalizeDirectionText(raw)).toBe(
            expected,
        );
    });
});

describe("resolveCanonicalAmount - every representation ends positive + directed", () => {
    it("1. Amount only (unsigned) -> income; signed -> expense", () => {
        expect(
            resolveCanonicalAmount({ amount: "250.00" }),
        ).toMatchObject({
            amount: 250,
            type: "income",
        });

        expect(
            resolveCanonicalAmount({ amount: "-250.00" }),
        ).toMatchObject({
            amount: 250,
            type: "expense",
        });
    });

    it("2/3. Debit + Credit (or Withdrawal + Deposit) columns", () => {
        expect(
            resolveCanonicalAmount({
                debit: "1,200.00",
                credit: "",
            }),
        ).toEqual({
            amount: 1200,
            type: "expense",
            source: "debit",
        });

        expect(
            resolveCanonicalAmount({
                debit: "",
                credit: "1,200.00",
            }),
        ).toEqual({
            amount: 1200,
            type: "income",
            source: "credit",
        });
    });

    it("4. Debit value with Credit '-' / blank / 0.00", () => {
        for (const credit of ["-", "", "0.00", "--"]) {
            expect(
                resolveCanonicalAmount({
                    debit: "750.00",
                    credit,
                }),
            ).toMatchObject({
                amount: 750,
                type: "expense",
            });
        }
    });

    it("5. Credit value with Debit '-' / blank / 0.00", () => {
        for (const debit of ["-", "", "0.00", "—"]) {
            expect(
                resolveCanonicalAmount({
                    debit,
                    credit: "750.00",
                }),
            ).toMatchObject({
                amount: 750,
                type: "income",
            });
        }
    });

    it("6. Negative Amount -> positive expense (minus, parentheses, trailing minus)", () => {
        for (const amount of [
            "-99.90",
            "(99.90)",
            "99.90-",
        ]) {
            expect(
                resolveCanonicalAmount({ amount }),
            ).toMatchObject({
                amount: 99.9,
                type: "expense",
            });
        }
    });

    it("7. DR/CR suffix on a single Amount", () => {
        expect(
            resolveCanonicalAmount({
                amount: "1,000.00 Dr",
            }),
        ).toMatchObject({
            amount: 1000,
            type: "expense",
        });

        expect(
            resolveCanonicalAmount({
                amount: "1,000.00CR",
            }),
        ).toMatchObject({
            amount: 1000,
            type: "income",
        });

        // A DR marker wins over a positive-looking value even when
        // Debit/Credit columns exist but are empty.
        expect(
            resolveCanonicalAmount({
                amount: "1,000.00 Dr",
                debit: "",
                credit: "",
                hasDebitCreditColumns: true,
            }),
        ).toMatchObject({
            amount: 1000,
            type: "expense",
        });
    });

    it("8/9/10. Currency symbols, comma grouping and decimals", () => {
        expect(
            resolveCanonicalAmount({
                debit: "₹1,05,000.75",
            }),
        ).toMatchObject({
            amount: 105000.75,
            type: "expense",
        });

        expect(
            resolveCanonicalAmount({
                credit: "$12,345.6",
            }),
        ).toMatchObject({
            amount: 12345.6,
            type: "income",
        });
    });

    it("an explicit Type column overrides column/sign inference", () => {
        expect(
            resolveCanonicalAmount({
                amount: "500.00",
                typeText: "DR",
            }),
        ).toMatchObject({ type: "expense" });

        expect(
            resolveCanonicalAmount({
                debit: "500.00",
                typeText: "Transfer",
            }),
        ).toMatchObject({ type: "transfer" });
    });

    it("never guesses a direction for an unsigned Amount on a row whose Debit/Credit columns are both empty", () => {
        expect(
            resolveCanonicalAmount({
                amount: "500.00",
                debit: "",
                credit: "-",
                hasDebitCreditColumns: true,
            }),
        ).toEqual({
            amount: 500,
            type: null,
            source: "amount",
        });
    });

    it("zero / missing amounts stay invalid rather than becoming a transaction", () => {
        expect(
            resolveCanonicalAmount({
                debit: "0.00",
                credit: "0.00",
            }),
        ).toEqual({
            amount: null,
            type: null,
            source: "none",
        });

        expect(
            resolveCanonicalAmount({ amount: "0.00" }),
        ).toMatchObject({ amount: 0, type: null });
    });
});

// Import-level: the same shared layer behind CSV/Excel column mapping.
describe("CSV/Excel import - column layouts through the full pipeline", () => {
    function canonical(content: string) {
        const result = processCsv(content);

        return {
            result,
            rows: result.candidates.map((c) => ({
                date: c.transactionDate,
                type: c.type,
                amount: c.amount,
                balance: c.balance,
                reference: c.referenceNumber,
            })),
        };
    }

    it("11/14/15. Withdrawal + Deposit with '-' placeholders, balance and reference, mixed rows", () => {
        const { result, rows } = canonical(
            [
                "Date,Narration,Ref No,Withdrawal,Deposit,Balance",
                '01/03/2026,Grocery,REF001,"₹1,450.00",-,"8,550.00"',
                '02/03/2026,Salary,REF002,-,"₹50,000.00","58,550.00"',
                '03/03/2026,Rent,REF003,"15,000.00",,"43,550.00"',
            ].join("\n"),
        );

        expect(result.validation.errors).toEqual([]);
        expect(rows).toEqual([
            {
                date: "2026-03-01",
                type: "expense",
                amount: 1450,
                balance: 8550,
                reference: "REF001",
            },
            {
                date: "2026-03-02",
                type: "income",
                amount: 50000,
                balance: 58550,
                reference: "REF002",
            },
            {
                date: "2026-03-03",
                type: "expense",
                amount: 15000,
                balance: 43550,
                reference: "REF003",
            },
        ]);
    });

    it("12/13. Different column ordering (Credit before Debit, balance first) and extra columns", () => {
        const { result, rows } = canonical(
            [
                "Balance,Branch,Credit,Debit,Description,Date,Reference",
                "900.00,HQ,,100.00,Coffee,2026-04-01,R1",
                "1900.00,HQ,1000.00,,Refund,2026-04-02,R2",
            ].join("\n"),
        );

        expect(result.validation.errors).toEqual([]);
        expect(rows).toEqual([
            {
                date: "2026-04-01",
                type: "expense",
                amount: 100,
                balance: 900,
                reference: "R1",
            },
            {
                date: "2026-04-02",
                type: "income",
                amount: 1000,
                balance: 1900,
                reference: "R2",
            },
        ]);
    });

    it("7. Amount column carrying DR/CR suffixes, and a Dr-marked (overdrawn) balance", () => {
        const { result, rows } = canonical(
            [
                "Date,Description,Amount,Balance",
                '01/05/2026,ATM,"1,500.00 Dr",500.00 Dr',
                '02/05/2026,Deposit,"2,000.00 Cr",1500.00 Cr',
            ].join("\n"),
        );

        expect(result.validation.errors).toEqual([]);
        expect(rows.map((r) => [r.type, r.amount, r.balance])).toEqual([
            ["expense", 1500, -500],
            ["income", 2000, 1500],
        ]);
    });

    it("6. Signed Amount column (minus and parentheses)", () => {
        const { rows } = canonical(
            [
                "Date,Description,Amount",
                "01/05/2026,Fee,-25.00",
                "02/05/2026,Bill,(120.50)",
                "03/05/2026,Interest,3.10",
            ].join("\n"),
        );

        expect(rows.map((r) => [r.type, r.amount])).toEqual([
            ["expense", 25],
            ["expense", 120.5],
            ["income", 3.1],
        ]);
    });

    it("an explicit Dr/Cr column drives direction for an unsigned Amount", () => {
        const { result, rows } = canonical(
            [
                "Date,Description,Amount,Dr/Cr",
                "01/05/2026,Card,500.00,DR",
                "02/05/2026,Refund,500.00,CR",
            ].join("\n"),
        );

        expect(result.validation.errors).toEqual([]);
        expect(rows.map((r) => r.type)).toEqual([
            "expense",
            "income",
        ]);
    });
});
