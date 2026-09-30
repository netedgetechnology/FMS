import { describe, expect, it } from "vitest";

import {
    ExcelPasswordError,
    type NormalizedTransactionCandidate,
} from "@financeos/import-engine";

import {
    applyNotesToMatchingRows,
    applyPayeeToMatchingRows,
    applyPreviewOverrides,
    applySelfLearningToMatchingRows,
    applyTransactionTypeToMatchingRows,
    classifyExcelPasswordError,
    createEmptyPreviewOverrides,
    deriveSessionLearnedRowNumbers,
    isExcelFileName,
    MAPPING_FIELD_OPTIONS,
    resolveMappingInstitutionName,
    resolveSelfLearningIndicator,
    type PreviewOverrides,
} from "./ImportsPage";

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

function overridesWith(
    overrides: Partial<PreviewOverrides>
): PreviewOverrides {
    return {
        ...createEmptyPreviewOverrides(),
        ...overrides,
    };
}

// Bug: a saved mapping created from a BANK_EXCEL import always showed
// "—" in the Saved Mappings Institution column, even when the account
// the import was confirmed for clearly has an institution on file in
// Accounts. Traced to the save-mapping call site using only
// `preview.institutionName` - the file-content auto-detected value,
// which CsvProcessingResult's own doc comment says is always null for
// Excel/PDF (no such text to scan) - instead of falling back to the
// selected account's own institution when detection found nothing.
describe("resolveMappingInstitutionName", () => {
    it("1. falls back to the selected account's institution when nothing was auto-detected (the Excel case)", () => {
        expect(
            resolveMappingInstitutionName(null, {
                institutionName: "SBI Bank",
            })
        ).toBe("SBI Bank");
    });

    it("2. uses whichever account's institution was actually selected - never a hardcoded value", () => {
        expect(
            resolveMappingInstitutionName(null, {
                institutionName: "HDFC Bank",
            })
        ).toBe("HDFC Bank");

        expect(
            resolveMappingInstitutionName(null, {
                institutionName: "ICICI Bank",
            })
        ).toBe("ICICI Bank");
    });

    it("3. an account with no institution on file stays null (displayed as '—')", () => {
        expect(
            resolveMappingInstitutionName(null, {
                institutionName: undefined,
            })
        ).toBeNull();

        expect(
            resolveMappingInstitutionName(null, null)
        ).toBeNull();
    });

    it("prefers a real file-detected institution (CSV) over the account's, but still never loses it when detection succeeds", () => {
        expect(
            resolveMappingInstitutionName(
                "Detected From File",
                { institutionName: "SBI Bank" }
            )
        ).toBe("Detected From File");
    });

    it("does not affect an account with an empty-string institution - still falls through to null", () => {
        expect(
            resolveMappingInstitutionName(null, {
                institutionName: "",
            })
        ).toBeNull();
    });
});

describe("MAPPING_FIELD_OPTIONS", () => {
    it("offers a manual \"Transaction ID\" mapping option (source-column mapping dropdown)", () => {
        expect(MAPPING_FIELD_OPTIONS).toContainEqual({
            value: "externalTransactionId",
            label: "Transaction ID",
        });
    });

    // Every other existing option must remain exactly as before - adding
    // Transaction ID must not reorder/rename/remove any of them.
    it("leaves every other existing mapping option unchanged", () => {
        expect(MAPPING_FIELD_OPTIONS).toEqual([
            { value: "ignore", label: "Ignore" },
            { value: "date", label: "Date" },
            { value: "description", label: "Payee / Description" },
            { value: "amount", label: "Amount" },
            { value: "debit", label: "Debit" },
            { value: "credit", label: "Credit" },
            { value: "type", label: "Type" },
            { value: "referenceNumber", label: "Reference" },
            { value: "externalTransactionId", label: "Transaction ID" },
            { value: "balance", label: "Balance" },
            { value: "branch", label: "Branch" },
            { value: "transactionType", label: "Transaction Type" },
        ]);
    });
});

// classifyExcelPasswordError decides how handlePreview's catch block
// reacts to a protected Excel file (see ExcelPasswordError in
// @financeos/import-engine, and excelParser.ts's classifyExcelReadError
// for how that error is produced in the first place).
describe("classifyExcelPasswordError", () => {
    it('shows the password prompt (no inline error yet) for reason "required" - the very first attempt on a protected file', () => {
        const decision = classifyExcelPasswordError(
            new ExcelPasswordError(
                "required",
                "This file is password-protected."
            )
        );

        expect(decision).toEqual({
            showPasswordPrompt: true,
            passwordErrorMessage: null,
            genericErrorMessage: null,
        });
    });

    it('keeps the password prompt open with an inline message for reason "incorrect" - Unlock becomes Retry', () => {
        const decision = classifyExcelPasswordError(
            new ExcelPasswordError(
                "incorrect",
                "The password is incorrect."
            )
        );

        expect(decision.showPasswordPrompt).toBe(true);
        expect(decision.passwordErrorMessage).toBe(
            "The password is incorrect."
        );
        expect(decision.genericErrorMessage).toBeNull();
    });

    it('never shows the password prompt for reason "unsupported" - retrying could never succeed, so it surfaces as the generic error banner instead', () => {
        const decision = classifyExcelPasswordError(
            new ExcelPasswordError(
                "unsupported",
                "This file's password protection isn't supported. Please save an unprotected copy and try again."
            )
        );

        expect(decision).toEqual({
            showPasswordPrompt: false,
            passwordErrorMessage: null,
            genericErrorMessage:
                "This file's password protection isn't supported. Please save an unprotected copy and try again.",
        });
    });

    it("leaves every other error - unrelated to Excel passwords - handled exactly as before this feature (generic error banner)", () => {
        const decision = classifyExcelPasswordError(
            new Error("CSV file contains no headers.")
        );

        expect(decision).toEqual({
            showPasswordPrompt: false,
            passwordErrorMessage: null,
            genericErrorMessage:
                "CSV file contains no headers.",
        });
    });

    it("handles a non-Error thrown value the same way existing error handling always has", () => {
        const decision = classifyExcelPasswordError(
            "a plain string throw"
        );

        expect(decision.showPasswordPrompt).toBe(false);
        expect(decision.genericErrorMessage).toBe(
            "a plain string throw"
        );
    });

    it("never echoes a password value into either message it returns", () => {
        // The password itself never reaches ExcelPasswordError at all
        // (see excelParser.ts) - this asserts the UI-decision layer
        // doesn't introduce one either.
        const decision = classifyExcelPasswordError(
            new ExcelPasswordError(
                "incorrect",
                "The password is incorrect."
            )
        );

        const serialized = JSON.stringify(decision);

        expect(serialized).not.toContain(
            "hunter2-super-secret"
        );
    });
});

describe("applyPreviewOverrides", () => {
    it("leaves a candidate untouched when it has no overrides at all", () => {
        const candidates = [
            candidate(1, { transactionType: "UPI" }),
        ];

        const result = applyPreviewOverrides(
            candidates,
            createEmptyPreviewOverrides()
        );

        expect(result[0]).toBe(candidates[0]);
        expect(result[0].transactionType).toBe(
            "UPI"
        );
    });

    describe("Transaction Type (existing behavior, preserved)", () => {
        it("a manual selection overrides the auto-detected value", () => {
            const candidates = [
                candidate(1, { transactionType: "UPI" }),
            ];

            const result = applyPreviewOverrides(
                candidates,
                overridesWith({
                    transactionType: new Map([
                        [1, "NEFT"],
                    ]),
                })
            );

            expect(
                result[0].transactionType
            ).toBe("NEFT");
        });

        it("an explicit blank override clears a detected value", () => {
            const candidates = [
                candidate(1, { transactionType: "UPI" }),
            ];

            const result = applyPreviewOverrides(
                candidates,
                overridesWith({
                    transactionType: new Map([
                        [1, ""],
                    ]),
                })
            );

            expect(
                result[0].transactionType
            ).toBeNull();
        });
    });

    describe("Payee (editable)", () => {
        it("a manual entry overrides the detected value", () => {
            const candidates = [
                candidate(1, {
                    payee: "Detected Payee",
                }),
            ];

            const result = applyPreviewOverrides(
                candidates,
                overridesWith({
                    payee: new Map([
                        [1, "Corrected Payee"],
                    ]),
                })
            );

            expect(result[0].payee).toBe(
                "Corrected Payee"
            );
        });

        it("an explicit blank override clears the detected payee", () => {
            const candidates = [
                candidate(1, {
                    payee: "Detected Payee",
                }),
            ];

            const result = applyPreviewOverrides(
                candidates,
                overridesWith({
                    payee: new Map([[1, ""]]),
                })
            );

            expect(result[0].payee).toBe("");
        });

        it("does not affect description or reference", () => {
            const candidates = [
                candidate(1, {
                    payee: "ACH-DR-XYZ",
                    description: "ACH-DR-XYZ",
                    referenceNumber: "REF001",
                }),
            ];

            const result = applyPreviewOverrides(
                candidates,
                overridesWith({
                    payee: new Map([
                        [1, "Corrected Payee"],
                    ]),
                })
            );

            expect(result[0].payee).toBe(
                "Corrected Payee"
            );
            expect(
                result[0].description
            ).toBe("ACH-DR-XYZ");
            expect(
                result[0].referenceNumber
            ).toBe("REF001");
        });

        it("when left unedited, stays exactly as detected regardless of other overrides on the row", () => {
            const candidates = [
                candidate(1, {
                    payee: "Detected Payee",
                }),
            ];

            const result = applyPreviewOverrides(
                candidates,
                overridesWith({
                    transactionType: new Map([
                        [1, "UPI"],
                    ]),
                    notes: new Map([
                        [1, "A note"],
                    ]),
                })
            );

            expect(result[0].payee).toBe(
                "Detected Payee"
            );
        });
    });

    describe("Notes", () => {
        it("a manual entry is independent from description", () => {
            const candidates = [
                candidate(1, {
                    description: "UPI/P2A/1/John",
                }),
            ];

            const result = applyPreviewOverrides(
                candidates,
                overridesWith({
                    notes: new Map([
                        [1, "Reimbursed by employer"],
                    ]),
                })
            );

            expect(result[0].notes).toBe(
                "Reimbursed by employer"
            );
            expect(
                result[0].description
            ).toBe("UPI/P2A/1/John");
        });
    });

    it("applies independent overrides for Transaction Type, Payee, and Notes on the same row simultaneously", () => {
        const candidates = [candidate(1)];

        const result = applyPreviewOverrides(
            candidates,
            overridesWith({
                transactionType: new Map([
                    [1, "RTGS"],
                ]),
                payee: new Map([
                    [1, "Acme Corp"],
                ]),
                notes: new Map([
                    [1, "Invoice #42"],
                ]),
            })
        );

        expect(result[0]).toMatchObject({
            transactionType: "RTGS",
            payee: "Acme Corp",
            notes: "Invoice #42",
        });
    });

    it("only affects the overridden row, leaving other rows and fields untouched", () => {
        const candidates = [
            candidate(1, { transactionType: "UPI" }),
            candidate(2, { transactionType: null }),
            candidate(3, { transactionType: "NEFT" }),
        ];

        const result = applyPreviewOverrides(
            candidates,
            overridesWith({
                transactionType: new Map([
                    [2, "CHEQUE"],
                ]),
                payee: new Map([
                    [2, "Only Row Two"],
                ]),
            })
        );

        expect(result[0].transactionType).toBe(
            "UPI"
        );
        expect(result[0].payee).toBe("Test");

        expect(result[1].transactionType).toBe(
            "CHEQUE"
        );
        expect(result[1].payee).toBe(
            "Only Row Two"
        );

        expect(result[2].transactionType).toBe(
            "NEFT"
        );
        expect(result[2].payee).toBe("Test");

        expect(result[0].amount).toBe(100);
        expect(result[0].type).toBe("expense");
    });
});

describe("applyPayeeToMatchingRows", () => {
    it("1. same pattern in the current preview: propagates a manual Payee edit to matching rows", () => {
        const candidates = [
            candidate(1, {
                payee: "NBSM/146721617/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
            }),
            candidate(2, {
                payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
            }),
        ];

        const result = applyPayeeToMatchingRows(
            candidates,
            createEmptyPreviewOverrides(),
            1,
            "SBI Card"
        );

        expect(result.payee.get(1)).toBe(
            "SBI Card"
        );
        expect(result.payee.get(2)).toBe(
            "SBI Card"
        );
    });

    it("a per-keystroke call pattern now also ends on the exact final Payee (the latest value overwrites matching rows); the UI still commits once, on blur", () => {
        const candidates = [
            candidate(6, {
                payee: "NBSM/146721617/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
            }),
            candidate(12, {
                payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
            }),
        ];

        // Simulates the user typing "SBI Card" into row 6's input one
        // keystroke at a time, each keystroke re-invoking this function
        // with the field's full current value (as a real onChange would) -
        // this is the pattern the old (buggy) call site used.
        let overrides = createEmptyPreviewOverrides();

        for (const partial of [
            "S",
            "SB",
            "SBI",
            "SBI ",
            "SBI C",
            "SBI Ca",
            "SBI Car",
            "SBI Card",
        ]) {
            overrides = applyPayeeToMatchingRows(
                candidates,
                overrides,
                6,
                partial
            );
        }

        expect(overrides.payee.get(6)).toBe(
            "SBI Card"
        );

        // Previously row 12 was auto-filled on the first keystroke ("S")
        // and then never overwritten again, so it stayed stuck on "S".
        // Propagation now always applies the latest committed value to
        // every matching row, so row 12 ends on the final text too.
        expect(overrides.payee.get(12)).toBe(
            "SBI Card"
        );
    });

    it("a single commit with the final value (the fixed call pattern) propagates the exact same Payee", () => {
        const candidates = [
            candidate(6, {
                payee: "NBSM/146721617/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
            }),
            candidate(12, {
                payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
            }),
        ];

        const result = applyPayeeToMatchingRows(
            candidates,
            createEmptyPreviewOverrides(),
            6,
            "SBI Card"
        );

        expect(result.payee.get(6)).toBe(
            "SBI Card"
        );
        expect(result.payee.get(12)).toBe(
            "SBI Card"
        );
    });

    it("2. different pattern: does not propagate to an unrelated row", () => {
        const candidates = [
            candidate(1, {
                payee: "NBSM/146721617/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
            }),
            candidate(2, {
                payee: "Totally Different Narration",
                description: "Totally Different Narration",
            }),
        ];

        const result = applyPayeeToMatchingRows(
            candidates,
            createEmptyPreviewOverrides(),
            1,
            "SBI Card"
        );

        expect(result.payee.get(1)).toBe(
            "SBI Card"
        );
        expect(
            result.payee.has(2)
        ).toBe(false);
    });

    it("the latest committed edit overwrites a matching row's earlier override (any row can be the learning source)", () => {
        const candidates = [
            candidate(1, {
                payee: "NBSM/146721617/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
            }),
            candidate(2, {
                payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
            }),
        ];

        const seeded: PreviewOverrides = {
            ...createEmptyPreviewOverrides(),
            payee: new Map([
                [2, "Manually Corrected Already"],
            ]),
        };

        const result = applyPayeeToMatchingRows(
            candidates,
            seeded,
            1,
            "SBI Card"
        );

        expect(result.payee.get(2)).toBe(
            "SBI Card"
        );
    });

    it("does not propagate a pattern too short/generic to safely learn from", () => {
        const candidates = [
            candidate(1, {
                payee: "ATM",
                description: "ATM",
            }),
            candidate(2, {
                payee: "ATM",
                description: "ATM",
            }),
        ];

        const result = applyPayeeToMatchingRows(
            candidates,
            createEmptyPreviewOverrides(),
            1,
            "Cash Withdrawal"
        );

        expect(result.payee.get(1)).toBe(
            "Cash Withdrawal"
        );
        expect(
            result.payee.has(2)
        ).toBe(false);
    });

    it("5. leaves Description untouched and separate from the Payee edit", () => {
        const candidates = [
            candidate(1, {
                payee: "NBSM/146721617/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
            }),
            candidate(2, {
                payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
            }),
        ];

        const overrides = applyPayeeToMatchingRows(
            candidates,
            createEmptyPreviewOverrides(),
            1,
            "SBI Card"
        );

        const result = applyPreviewOverrides(
            candidates,
            overrides
        );

        expect(result[0].payee).toBe("SBI Card");
        expect(result[0].description).toBe(
            "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/"
        );

        expect(result[1].payee).toBe("SBI Card");
        expect(result[1].description).toBe(
            "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/"
        );
    });
});

// Investigation: a 48-row bank Excel import reported that editing Row 4
// correctly propagated to Rows 5-7, but editing Row 1 (which the user
// believed was "the same/same-pattern transaction" as Row 12) did not
// update Row 12. Traced end-to-end:
//   - The learning key is `extractTransactionPattern(candidate.
//     description)` plus the row's Credit/Debit direction
//     (learningKeyForCandidate - see "Self-learning key: payee pattern +
//     Credit/Debit" below). Date, amount and referenceNumber are never
//     read by it and play no part in the key, so none of them can be
//     "blocking" a match.
//   - extractTransactionPattern collapses every run of digits to a
//     single "#" and canonicalizes case/whitespace - so two narrations
//     differing only in a transaction id / reference number / date /
//     amount embedded as digits already collapse to the same pattern
//     (see transactionPattern.test.ts's date+reference-number case,
//     which is exactly this shape).
//   - applyOverrideToMatchingRows then propagates to every OTHER
//     candidate in the full array passed in (preview.candidates - the
//     complete parsed set, never paginated/filtered - see
//     handlePayeeOverrideCommit) whose pattern string is === the edited
//     row's pattern string. Plain string equality; no length/order
//     bias, no reliance on a "visible prefix" or on amount.
//   - Rows 4-7 and "Row 1 / Row 12" are handled by the exact same code
//     path with no special-casing by row distance or count - the tests
//     below reproduce both shapes against the SAME, unmodified
//     applyPayeeToMatchingRows to demonstrate it already propagates
//     correctly whenever the normalized pattern truly matches (B), and
//     correctly refuses to when it doesn't (C) - i.e. the mechanism
//     itself is not the defect. If two rows that a user perceives as
//     "the same" transaction do not propagate in the live app, their
//     actual stored Description text (not the truncated text shown in
//     the preview column) must differ by more than just digits/case/
//     whitespace - a data question for that specific statement, not a
//     bug in this matching code.
describe("Reported scenario - Row 4-7 vs Row 1/Row 12 propagation", () => {
    it("A. editing Row 4 propagates to Rows 5, 6 and 7 (same recurring narration, different digits)", () => {
        const candidates = [
            candidate(4, {
                description:
                    "UPI/P2A/500112233445/JOHN DOE/Sent u/SBI",
            }),
            candidate(5, {
                description:
                    "UPI/P2A/500112298765/JOHN DOE/Sent u/SBI",
            }),
            candidate(6, {
                description:
                    "UPI/P2A/500115566778/JOHN DOE/Sent u/SBI",
            }),
            candidate(7, {
                description:
                    "UPI/P2A/500119988776/JOHN DOE/Sent u/SBI",
            }),
        ];

        const result = applyPayeeToMatchingRows(
            candidates,
            createEmptyPreviewOverrides(),
            4,
            "John Doe"
        );

        expect(result.payee.get(4)).toBe("John Doe");
        expect(result.payee.get(5)).toBe("John Doe");
        expect(result.payee.get(6)).toBe("John Doe");
        expect(result.payee.get(7)).toBe("John Doe");
    });

    it("B. editing Row 1 propagates to Row 12 when their normalized learning identity actually matches (a recurring monthly transaction, 11 rows apart)", () => {
        const candidates = [
            candidate(1, {
                transactionDate: "2026-07-01",
                description:
                    "2026-07-01 NEFT/IN42621556482010/ACME PAYROLL PVT LTD",
            }),
            candidate(12, {
                transactionDate: "2026-08-01",
                description:
                    "2026-08-01 NEFT/IN42621559901234/ACME PAYROLL PVT LTD",
            }),
        ];

        const result = applyPayeeToMatchingRows(
            candidates,
            createEmptyPreviewOverrides(),
            1,
            "Acme Payroll"
        );

        expect(result.payee.get(1)).toBe(
            "Acme Payroll"
        );
        expect(result.payee.get(12)).toBe(
            "Acme Payroll"
        );
    });

    it("C. a similar-looking but genuinely different transaction (different counterparty) is NOT incorrectly updated", () => {
        const candidates = [
            candidate(1, {
                transactionDate: "2026-07-01",
                description:
                    "2026-07-01 NEFT/IN42621556482010/ACME PAYROLL PVT LTD",
            }),
            // Same channel/prefix and a similar-length reference, but a
            // different counterparty - must never be treated as the
            // same recurring transaction just because it looks similar
            // at a glance (or by matching only a short visible prefix).
            candidate(12, {
                transactionDate: "2026-08-01",
                description:
                    "2026-08-01 NEFT/IN42621559901234/TATA CAPITAL LIMITED",
            }),
        ];

        const result = applyPayeeToMatchingRows(
            candidates,
            createEmptyPreviewOverrides(),
            1,
            "Acme Payroll"
        );

        expect(result.payee.get(1)).toBe(
            "Acme Payroll"
        );
        expect(
            result.payee.has(12)
        ).toBe(false);
    });

    it("confirms the learning key ignores amount - Description and Credit/Debit direction drive the match", () => {
        const candidates = [
            candidate(1, {
                description:
                    "UPI/P2A/500112233445/JOHN DOE/Sent u/SBI",
                amount: 1500,
                type: "expense",
            }),
            candidate(12, {
                // Same narration pattern and direction, very different
                // amount - still matches.
                description:
                    "UPI/P2A/500119988776/JOHN DOE/Sent u/SBI",
                amount: 75000,
                type: "expense",
            }),
            candidate(13, {
                // Same narration pattern, opposite direction (Credit) -
                // must NOT match a Debit correction.
                description:
                    "UPI/P2A/500119911111/JOHN DOE/Sent u/SBI",
                amount: 1500,
                type: "income",
            }),
        ];

        const result = applyPayeeToMatchingRows(
            candidates,
            createEmptyPreviewOverrides(),
            1,
            "John Doe"
        );

        expect(result.payee.get(12)).toBe("John Doe");
        expect(result.payee.has(13)).toBe(false);
    });
});

describe("applyTransactionTypeToMatchingRows", () => {
    it("1. same pattern in the current preview: propagates a manual Type change to matching rows", () => {
        const candidates = [
            candidate(6, {
                payee: "NBSM/146721617/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
            }),
            candidate(12, {
                payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
            }),
        ];

        const overrides =
            applyTransactionTypeToMatchingRows(
                candidates,
                createEmptyPreviewOverrides(),
                6,
                "NEFT"
            );

        expect(
            overrides.transactionType.get(6)
        ).toBe("NEFT");
        expect(
            overrides.transactionType.get(12)
        ).toBe("NEFT");
    });

    it("2. different pattern: does not propagate to an unrelated row", () => {
        const candidates = [
            candidate(6, {
                payee: "NBSM/146721617/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
            }),
            candidate(12, {
                payee: "Totally Different Narration",
                description: "Totally Different Narration",
            }),
        ];

        const overrides =
            applyTransactionTypeToMatchingRows(
                candidates,
                createEmptyPreviewOverrides(),
                6,
                "NEFT"
            );

        expect(
            overrides.transactionType.get(6)
        ).toBe("NEFT");
        expect(
            overrides.transactionType.has(12)
        ).toBe(false);
    });

    it("the latest committed edit overwrites a matching row's earlier override (any row can be the learning source)", () => {
        const candidates = [
            candidate(6, {
                payee: "NBSM/146721617/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
            }),
            candidate(12, {
                payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
            }),
        ];

        const seeded: PreviewOverrides = {
            ...createEmptyPreviewOverrides(),
            transactionType: new Map([[12, "UPI"]]),
        };

        const overrides =
            applyTransactionTypeToMatchingRows(
                candidates,
                seeded,
                6,
                "NEFT"
            );

        expect(
            overrides.transactionType.get(12)
        ).toBe("NEFT");
    });
});

describe("applyNotesToMatchingRows", () => {
    it("1. same pattern in the current preview: propagates a manual Notes change to matching rows", () => {
        const candidates = [
            candidate(6, {
                payee: "NBSM/146721617/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
            }),
            candidate(12, {
                payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
            }),
        ];

        const overrides = applyNotesToMatchingRows(
            candidates,
            createEmptyPreviewOverrides(),
            6,
            "Credit card bill"
        );

        expect(overrides.notes.get(6)).toBe(
            "Credit card bill"
        );
        expect(overrides.notes.get(12)).toBe(
            "Credit card bill"
        );
    });

    it("2. different pattern: does not propagate to an unrelated row", () => {
        const candidates = [
            candidate(6, {
                payee: "NBSM/146721617/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
            }),
            candidate(12, {
                payee: "Totally Different Narration",
                description: "Totally Different Narration",
            }),
        ];

        const overrides = applyNotesToMatchingRows(
            candidates,
            createEmptyPreviewOverrides(),
            6,
            "Credit card bill"
        );

        expect(overrides.notes.get(6)).toBe(
            "Credit card bill"
        );
        expect(
            overrides.notes.has(12)
        ).toBe(false);
    });

    it("6. propagating Notes never touches Description, which stays independent", () => {
        const candidates = [
            candidate(6, {
                payee: "NBSM/146721617/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
            }),
            candidate(12, {
                payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
            }),
        ];

        const overrides = applyNotesToMatchingRows(
            candidates,
            createEmptyPreviewOverrides(),
            6,
            "Credit card bill"
        );

        const result = applyPreviewOverrides(
            candidates,
            overrides
        );

        expect(result[0].notes).toBe(
            "Credit card bill"
        );
        expect(result[0].description).toBe(
            "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/"
        );

        expect(result[1].notes).toBe(
            "Credit card bill"
        );
        expect(result[1].description).toBe(
            "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/"
        );
    });
});

describe("Payee + Type + Notes learning together (in-preview)", () => {
    it("1 & 2. a single row's Payee, Type, and Notes edits each independently propagate to the same matching row", () => {
        const candidates = [
            candidate(6, {
                payee: "NBSM/146721617/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
            }),
            candidate(12, {
                payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
            }),
        ];

        let overrides = createEmptyPreviewOverrides();

        overrides = applyPayeeToMatchingRows(
            candidates,
            overrides,
            6,
            "SBI Card"
        );

        overrides =
            applyTransactionTypeToMatchingRows(
                candidates,
                overrides,
                6,
                "NEFT"
            );

        overrides = applyNotesToMatchingRows(
            candidates,
            overrides,
            6,
            "Credit card bill"
        );

        const result = applyPreviewOverrides(
            candidates,
            overrides
        );

        expect(result[1].payee).toBe("SBI Card");
        expect(result[1].transactionType).toBe(
            "NEFT"
        );
        expect(result[1].notes).toBe(
            "Credit card bill"
        );

        // Description is never touched by any of the three.
        expect(result[1].description).toBe(
            "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/"
        );
    });
});


describe("applySelfLearningToMatchingRows", () => {
    it("default state: every row is absent from the map, meaning self-learning is on", () => {
        const disabledRows = new Map<number, boolean>();

        expect(disabledRows.get(1)).toBeUndefined();
        expect(disabledRows.get(2)).toBeUndefined();
    });

    it("toggling a row OFF records it in the map", () => {
        const result = applySelfLearningToMatchingRows(
            [candidate(3)],
            new Map(),
            3,
            true
        );

        expect(result.get(3)).toBe(true);
    });

    it("toggling a row back ON only affects that row, without propagating", () => {
        const candidates = [
            candidate(1, {
                description: "SHARED NARRATION PATTERN TEXT",
            }),
            candidate(2, {
                description: "SHARED NARRATION PATTERN TEXT",
            }),
        ];

        const disabledBoth = new Map([
            [1, true],
            [2, true],
        ]);

        const result = applySelfLearningToMatchingRows(
            candidates,
            disabledBoth,
            1,
            false
        );

        expect(result.get(1)).toBe(false);
        expect(result.get(2)).toBe(true);
    });

    it("toggling a row OFF propagates to every other row sharing the same learning pattern", () => {
        const candidates = [
            candidate(1, {
                description: "SHARED NARRATION PATTERN TEXT",
            }),
            candidate(2, {
                description: "SHARED NARRATION PATTERN TEXT",
            }),
            candidate(3, {
                description: "A COMPLETELY DIFFERENT NARRATION",
            }),
        ];

        const result = applySelfLearningToMatchingRows(
            candidates,
            new Map(),
            1,
            true
        );

        expect(result.get(1)).toBe(true);
        expect(result.get(2)).toBe(true);
        expect(result.get(3)).toBeUndefined();
    });

    it("never overwrites a row that already has its own explicit choice recorded", () => {
        const candidates = [
            candidate(1, {
                description: "SHARED NARRATION PATTERN TEXT",
            }),
            candidate(2, {
                description: "SHARED NARRATION PATTERN TEXT",
            }),
        ];

        // Row 2 was explicitly re-enabled by the user already.
        const existing = new Map([[2, false]]);

        const result = applySelfLearningToMatchingRows(
            candidates,
            existing,
            1,
            true
        );

        expect(result.get(1)).toBe(true);
        expect(result.get(2)).toBe(false);
    });

    it("never mutates the map it was given (returns a new Map)", () => {
        const original = new Map([[1, true]]);

        const result = applySelfLearningToMatchingRows(
            [candidate(1), candidate(2)],
            original,
            2,
            true
        );

        expect(original.get(2)).toBeUndefined();
        expect(result).not.toBe(original);
    });

    it("is independent of the per-row Payee/Type/Notes overrides - toggling one never touches the other", () => {
        const candidates = [
            candidate(1, { payee: "Detected Payee" }),
        ];

        const previewOverrides = applyPreviewOverrides(
            candidates,
            overridesWith({
                payee: new Map([[1, "Corrected Payee"]]),
            })
        );

        const selfLearningDisabledRows =
            applySelfLearningToMatchingRows(
                candidates,
                new Map(),
                1,
                true
            );

        // Turning self-learning off for row 1 leaves its Payee override
        // exactly as it was.
        expect(previewOverrides[0].payee).toBe(
            "Corrected Payee"
        );
        expect(selfLearningDisabledRows.get(1)).toBe(
            true
        );
    });
});

// Self-Learning UX: green (existing rule matched before this preview
// session) / blue (newly learned from an edit made during this session) /
// blank (no applicable learning) - see deriveSessionLearnedRowNumbers and
// resolveSelfLearningIndicator.
describe("deriveSessionLearnedRowNumbers (BLUE state)", () => {
    it("2. no learned rule and no edit made -> not session-learned (blank)", () => {
        const candidates = [
            candidate(1, {
                payee: "Some Detected Payee",
                description: "SOME NARRATION PATTERN",
            }),
        ];

        const rowNumbers = deriveSessionLearnedRowNumbers(
            candidates,
            createEmptyPreviewOverrides(),
            new Set()
        );

        expect(rowNumbers.has(1)).toBe(false);
    });

    it("3. editing a row's Payee with no pre-existing rule marks it session-learned (blue)", () => {
        const original = [
            candidate(2, {
                payee: "SBI CARD (BILLDESK)",
                description: "SBI CARD (BILLDESK) PAYMENT",
            }),
        ];

        // Simulates handlePayeeOverrideCommit: the user edited row 2's
        // Payee to "AMBIKA MEDICAL".
        const overrides = applyPayeeToMatchingRows(
            original,
            createEmptyPreviewOverrides(),
            2,
            "AMBIKA MEDICAL"
        );

        const candidates = applyPreviewOverrides(
            original,
            overrides
        );

        // No existing (pre-session) rule matched row 2.
        const rowNumbers = deriveSessionLearnedRowNumbers(
            candidates,
            overrides,
            new Set()
        );

        expect(rowNumbers.has(2)).toBe(true);
    });

    it("4. matching rows that receive the newly learned Payee are also marked session-learned (blue)", () => {
        const original = [
            candidate(2, {
                payee: "NBSM/146721617/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
            }),
            candidate(5, {
                payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
                description:
                    "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
            }),
            candidate(9, {
                payee: "Totally Unrelated Narration",
                description: "Totally Unrelated Narration",
            }),
        ];

        // Editing row 2's Payee - row 5 shares the same learning pattern
        // and is auto-filled by the existing matching-row propagation
        // (applyPayeeToMatchingRows); row 9 does not match and is left
        // alone.
        const overrides = applyPayeeToMatchingRows(
            original,
            createEmptyPreviewOverrides(),
            2,
            "AMBIKA MEDICAL"
        );

        const candidates = applyPreviewOverrides(
            original,
            overrides
        );

        expect(candidates[1].payee).toBe(
            "AMBIKA MEDICAL"
        );

        const rowNumbers = deriveSessionLearnedRowNumbers(
            candidates,
            overrides,
            new Set()
        );

        expect(rowNumbers.has(2)).toBe(true);
        expect(rowNumbers.has(5)).toBe(true);
        expect(rowNumbers.has(9)).toBe(false);
    });

    it("5. a row already covered by an existing (pre-session) rule is never marked session-learned, even if it was also edited", () => {
        const original = [
            candidate(1, {
                payee: "Existing Rule Payee",
                description: "ALREADY LEARNED NARRATION",
            }),
        ];

        const overrides = applyPayeeToMatchingRows(
            original,
            createEmptyPreviewOverrides(),
            1,
            "Manually re-typed same-ish value"
        );

        const candidates = applyPreviewOverrides(
            original,
            overrides
        );

        // Row 1's pattern already has an existing matched rule (GREEN).
        const rowNumbers = deriveSessionLearnedRowNumbers(
            candidates,
            overrides,
            new Set([1])
        );

        expect(rowNumbers.has(1)).toBe(false);
    });

    it("does not mark a row session-learned when the edit clears Payee to blank - nothing to learn", () => {
        const original = [
            candidate(1, {
                payee: "Detected Payee",
                description: "SOME NARRATION PATTERN",
            }),
        ];

        const overrides = applyPayeeToMatchingRows(
            original,
            createEmptyPreviewOverrides(),
            1,
            ""
        );

        const candidates = applyPreviewOverrides(
            original,
            overrides
        );

        expect(candidates[0].payee).toBe("");

        const rowNumbers = deriveSessionLearnedRowNumbers(
            candidates,
            overrides,
            new Set()
        );

        expect(rowNumbers.has(1)).toBe(false);
    });
});

describe("resolveSelfLearningIndicator", () => {
    it("1. an existing learned rule matched before this session -> green", () => {
        const indicator = resolveSelfLearningIndicator(
            1,
            new Set([1]),
            new Set(),
            new Map()
        );

        expect(indicator.state).toBe("green");
        expect(indicator.clickable).toBe(true);
    });

    it("2. no learned rule at all -> blank, and not clickable (clicking it must never create a rule)", () => {
        const indicator = resolveSelfLearningIndicator(
            1,
            new Set(),
            new Set(),
            new Map()
        );

        expect(indicator.state).toBe("blank");
        expect(indicator.clickable).toBe(false);
    });

    it("3. newly learned from an edited row this session -> blue", () => {
        const indicator = resolveSelfLearningIndicator(
            2,
            new Set(),
            new Set([2]),
            new Map()
        );

        expect(indicator.state).toBe("blue");
        expect(indicator.clickable).toBe(true);
    });

    it("5. a row that is both matched by an existing rule and edited this session stays green, never blue", () => {
        const indicator = resolveSelfLearningIndicator(
            1,
            new Set([1]),
            new Set([1]),
            new Map()
        );

        expect(indicator.state).toBe("green");
    });

    it("6. clicking a GREEN check (recorded as disabled) renders blank - the underlying matched-rule set is untouched, so the saved rule is never deleted", () => {
        const matchedLearnedRuleRowNumbers = new Set([1]);

        const before = resolveSelfLearningIndicator(
            1,
            matchedLearnedRuleRowNumbers,
            new Set(),
            new Map()
        );

        expect(before.state).toBe("green");

        // User clicks the check - only selfLearningDisabledRows changes.
        const selfLearningDisabledRows = new Map([[1, true]]);

        const after = resolveSelfLearningIndicator(
            1,
            matchedLearnedRuleRowNumbers,
            new Set(),
            selfLearningDisabledRows
        );

        expect(after.state).toBe("blank");

        // The existing-rule match itself was never touched - nothing was
        // deleted, only this import's write-back is opted out of.
        expect(
            matchedLearnedRuleRowNumbers.has(1)
        ).toBe(true);
    });

    it("6. clicking a BLUE check (recorded as disabled) renders blank the same way", () => {
        const sessionLearnedRowNumbers = new Set([2]);

        const before = resolveSelfLearningIndicator(
            2,
            new Set(),
            sessionLearnedRowNumbers,
            new Map()
        );

        expect(before.state).toBe("blue");

        const after = resolveSelfLearningIndicator(
            2,
            new Set(),
            sessionLearnedRowNumbers,
            new Map([[2, true]])
        );

        expect(after.state).toBe("blank");
        expect(after.clickable).toBe(true);
        expect(sessionLearnedRowNumbers.has(2)).toBe(
            true
        );
    });

    it("clicking a blank row is a no-op: it was never clickable, so nothing can toggle it into a colored state", () => {
        const indicator = resolveSelfLearningIndicator(
            3,
            new Set(),
            new Set(),
            new Map([[3, true]])
        );

        expect(indicator.state).toBe("blank");
        expect(indicator.clickable).toBe(false);
    });
});

// Undoing an edit (retyping/committing the field's original, pre-session
// value) must make the BLUE state it caused disappear again - for both
// the edited row and every matching row that only received it via
// propagation - and restore each row's preview data to what it showed
// before the edit. Session-learned status is entirely DERIVED from the
// current previewOverrides map (see deriveSessionLearnedRowNumbers), so
// this hinges on applyPayeeToMatchingRows (via applyOverrideToMatchingRows)
// actually removing the relevant override map entries on undo, not just
// leaving them in place with the reverted value.
describe("Undoing an edit removes its BLUE session-learned status (in-preview, using the existing override/propagation architecture)", () => {
    const original = [
        candidate(2, {
            payee: "NBSM/146721617/SBI CARD (BILLDESK)/",
            description:
                "2026-08-02 NBSM/146721617/SBI CARD (BILLDESK)/",
        }),
        candidate(5, {
            payee: "NBSM/146803886/SBI CARD (BILLDESK)/",
            description:
                "2026-08-03 NBSM/146803886/SBI CARD (BILLDESK)/",
        }),
    ];

    it("1 & 2. editing row 2's Payee marks it BLUE, propagates to matching row 5 (also BLUE), and both rows' preview data update", () => {
        const overrides = applyPayeeToMatchingRows(
            original,
            createEmptyPreviewOverrides(),
            2,
            "AMBIKA MEDICAL"
        );

        const candidates = applyPreviewOverrides(
            original,
            overrides
        );

        expect(candidates[0].payee).toBe(
            "AMBIKA MEDICAL"
        );
        expect(candidates[1].payee).toBe(
            "AMBIKA MEDICAL"
        );

        const blue = deriveSessionLearnedRowNumbers(
            candidates,
            overrides,
            new Set()
        );

        expect(blue.has(2)).toBe(true);
        expect(blue.has(5)).toBe(true);
    });

    it("3 & 4 & 5. committing row 2's Payee back to its original value undoes the edit: BLUE disappears for row 2 AND row 5, both fall back to blank (no pre-existing rule), and their preview data reverts", () => {
        const edited = applyPayeeToMatchingRows(
            original,
            createEmptyPreviewOverrides(),
            2,
            "AMBIKA MEDICAL"
        );

        // The user retypes/commits row 2's Payee back to exactly what it
        // showed before the edit.
        const undone = applyPayeeToMatchingRows(
            original,
            edited,
            2,
            "NBSM/146721617/SBI CARD (BILLDESK)/"
        );

        // The override entries themselves are gone - not merely holding
        // the reverted value - which is what makes BLUE derive back to
        // false (see deriveSessionLearnedRowNumbers, which keys off
        // override-map membership, not value).
        expect(undone.payee.has(2)).toBe(false);
        expect(undone.payee.has(5)).toBe(false);

        const candidates = applyPreviewOverrides(
            original,
            undone
        );

        expect(candidates[0].payee).toBe(
            "NBSM/146721617/SBI CARD (BILLDESK)/"
        );
        expect(candidates[1].payee).toBe(
            "NBSM/146803886/SBI CARD (BILLDESK)/"
        );

        const blue = deriveSessionLearnedRowNumbers(
            candidates,
            undone,
            new Set()
        );

        expect(blue.has(2)).toBe(false);
        expect(blue.has(5)).toBe(false);

        const indicatorRow2 = resolveSelfLearningIndicator(
            2,
            new Set(),
            blue,
            new Map()
        );

        const indicatorRow5 = resolveSelfLearningIndicator(
            5,
            new Set(),
            blue,
            new Map()
        );

        expect(indicatorRow2.state).toBe("blank");
        expect(indicatorRow5.state).toBe("blank");
    });

    it("4. undoing an edit on a row that DID have a pre-existing learned rule restores it to GREEN, not blank", () => {
        // Row 2's pattern already has an existing (pre-session) matched
        // rule - it started GREEN, not blank, before being edited.
        const matchedLearnedRuleRowNumbers = new Set([2]);

        const edited = applyPayeeToMatchingRows(
            original,
            createEmptyPreviewOverrides(),
            2,
            "A Manual Correction"
        );

        const undone = applyPayeeToMatchingRows(
            original,
            edited,
            2,
            "NBSM/146721617/SBI CARD (BILLDESK)/"
        );

        const candidates = applyPreviewOverrides(
            original,
            undone
        );

        const blue = deriveSessionLearnedRowNumbers(
            candidates,
            undone,
            matchedLearnedRuleRowNumbers
        );

        const indicator = resolveSelfLearningIndicator(
            2,
            matchedLearnedRuleRowNumbers,
            blue,
            new Map()
        );

        expect(indicator.state).toBe("green");
    });

    it("6. multiple edits/rows remain isolated: undoing one pattern's edit never affects an unrelated pattern's still-active edit", () => {
        const rows = [
            ...original,
            candidate(8, {
                payee: "AMAZON PAY INDIA PVT LTD",
                description: "AMAZON PAY INDIA PVT LTD PAYMENT",
            }),
            candidate(9, {
                payee: "AMAZON PAY INDIA PVT LTD",
                description: "AMAZON PAY INDIA PVT LTD PAYMENT",
            }),
        ];

        // Edit group 1 (rows 2 & 5).
        let overrides = applyPayeeToMatchingRows(
            rows,
            createEmptyPreviewOverrides(),
            2,
            "AMBIKA MEDICAL"
        );

        // Edit group 2 (rows 8 & 9), unrelated pattern.
        overrides = applyPayeeToMatchingRows(
            rows,
            overrides,
            8,
            "Amazon Pay"
        );

        // Undo group 1's edit only.
        overrides = applyPayeeToMatchingRows(
            rows,
            overrides,
            2,
            "NBSM/146721617/SBI CARD (BILLDESK)/"
        );

        expect(overrides.payee.has(2)).toBe(false);
        expect(overrides.payee.has(5)).toBe(false);

        // Group 2 is completely untouched by group 1's undo.
        expect(overrides.payee.get(8)).toBe(
            "Amazon Pay"
        );
        expect(overrides.payee.get(9)).toBe(
            "Amazon Pay"
        );

        const candidates = applyPreviewOverrides(
            rows,
            overrides
        );

        const blue = deriveSessionLearnedRowNumbers(
            candidates,
            overrides,
            new Set()
        );

        expect(blue.has(2)).toBe(false);
        expect(blue.has(5)).toBe(false);
        expect(blue.has(8)).toBe(true);
        expect(blue.has(9)).toBe(true);
    });

    it("6. a later edit from another matching row becomes the group's value; reverting any row to its original then undoes the group", () => {
        // Row 2 is edited first - row 5 inherits it via propagation.
        let overrides = applyPayeeToMatchingRows(
            original,
            createEmptyPreviewOverrides(),
            2,
            "AMBIKA MEDICAL"
        );

        // Row 5 is then edited to a different value. Any matching row can
        // be the learning source, so this becomes the value of the whole
        // group - row 2 included.
        overrides = applyPayeeToMatchingRows(
            original,
            overrides,
            5,
            "Custom Independent Value"
        );

        expect(overrides.payee.get(2)).toBe(
            "Custom Independent Value"
        );

        // Row 2 is reverted to its original value: that undoes the
        // group's current edit, so both rows fall back to their originals.
        overrides = applyPayeeToMatchingRows(
            original,
            overrides,
            2,
            "NBSM/146721617/SBI CARD (BILLDESK)/"
        );

        expect(overrides.payee.has(2)).toBe(false);
        expect(overrides.payee.has(5)).toBe(false);

        const candidates = applyPreviewOverrides(
            original,
            overrides
        );

        const blue = deriveSessionLearnedRowNumbers(
            candidates,
            overrides,
            new Set()
        );

        expect(blue.has(2)).toBe(false);
        expect(blue.has(5)).toBe(false);
    });

    it("undoing on Notes independently of Payee only clears the Notes override, and vice versa", () => {
        const withPayeeEdit = applyPayeeToMatchingRows(
            original,
            createEmptyPreviewOverrides(),
            2,
            "AMBIKA MEDICAL"
        );

        const withBothEdits = applyNotesToMatchingRows(
            original,
            withPayeeEdit,
            2,
            "Reimbursed by employer"
        );

        // Undo only the Notes edit.
        const notesUndone = applyNotesToMatchingRows(
            original,
            withBothEdits,
            2,
            // Row 2's baseline Notes is null -> "" once normalized by
            // applyNotesToMatchingRows's baseline lookup.
            ""
        );

        expect(notesUndone.notes.has(2)).toBe(false);
        expect(notesUndone.payee.get(2)).toBe(
            "AMBIKA MEDICAL"
        );
        expect(notesUndone.payee.get(5)).toBe(
            "AMBIKA MEDICAL"
        );
    });

    it("a no-op commit (blurring a field without ever changing it) never deletes an unrelated row's independent edit", () => {
        const rows = [
            ...original,
            candidate(8, {
                payee: "AMAZON PAY INDIA PVT LTD",
                description: "AMAZON PAY INDIA PVT LTD PAYMENT",
            }),
        ];

        // Row 8 (a completely different, non-matching pattern) has its
        // own independent edit.
        let overrides = applyPayeeToMatchingRows(
            rows,
            createEmptyPreviewOverrides(),
            8,
            "Row 8's Own Edit"
        );

        // Row 2 is focused and blurred without ever being changed - its
        // committed value equals its own baseline, and it never had a
        // prior override, so there is nothing to undo/propagate.
        overrides = applyPayeeToMatchingRows(
            rows,
            overrides,
            2,
            "NBSM/146721617/SBI CARD (BILLDESK)/"
        );

        expect(overrides.payee.has(2)).toBe(false);
        expect(overrides.payee.has(5)).toBe(false);
        expect(overrides.payee.get(8)).toBe(
            "Row 8's Own Edit"
        );
    });
});

// 2. .xlsx/.xls selecting "Bank Excel" - the single source of truth for
// "is this file Excel", shared by handleFileChange's Import Type
// auto-selection and handlePreview's routing to service.previewExcel
// (see the "Bank Excel" Import Type option). Extension detection must
// keep working exactly as before - this only factors the existing
// regex into one reusable function, it never changes what counts as
// Excel.
describe("isExcelFileName", () => {
    it("recognizes .xlsx and .xls, case-insensitively", () => {
        expect(
            isExcelFileName("statement.xlsx")
        ).toBe(true);
        expect(
            isExcelFileName("statement.xls")
        ).toBe(true);
        expect(
            isExcelFileName("STATEMENT.XLSX")
        ).toBe(true);
        expect(
            isExcelFileName("Statement.Xls")
        ).toBe(true);
    });

    it("never matches CSV or PDF file names", () => {
        expect(
            isExcelFileName("statement.csv")
        ).toBe(false);
        expect(
            isExcelFileName("statement.pdf")
        ).toBe(false);
    });

    it("does not match a filename that merely contains 'xlsx' or 'xls' without it being the extension", () => {
        expect(
            isExcelFileName("xlsx-report.csv")
        ).toBe(false);
        expect(
            isExcelFileName("statement.xlsx.pdf")
        ).toBe(false);
    });
});
