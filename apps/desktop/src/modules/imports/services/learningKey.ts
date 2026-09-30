import {
    extractTransactionPattern,
    type NormalizedTransactionCandidate,
} from "@financeos/import-engine";

// ---------------------------------------------------------------------
// Self-learning identity for an import row.
//
// A row's learning key is its normalized Description pattern (see
// extractTransactionPattern - digits collapsed, case/whitespace
// canonicalized) PLUS its transaction direction (Credit / Debit):
//
//     "<DIRECTION>|<PATTERN>"   e.g. "CREDIT|NEFT/IN#/ABC LTD"
//
// so a correction taught on an ABC LTD Credit row only ever applies to
// other ABC LTD Credit rows - never to ABC LTD Debit rows, and vice
// versa. The same key is used by BOTH the in-preview propagation
// (ImportsPage's applyOverrideToMatchingRows) and the persistent,
// account-scoped learned rules (ImportService's
// enrichCandidatesWithLearnedRules / learnRuleFromCandidate, stored in
// counterparty_rules.pattern), so the two can never disagree.
//
// (Only a genuine correction ever writes a rule - see
// learnRuleFromCorrection.)
//
// Amount, date and reference number are deliberately NOT part of the
// key. Description only, never Payee: Payee is user-editable (and is
// overwritten by a learned rule during enrichment), so it can't be a
// stable identity. A row with no usable Description has no key (null) -
// nothing is learned or propagated for it, exactly as before.
//
// Direction comes from the candidate's normalized `type` (the importer
// stores amounts as positive numbers, and puts the direction here):
// "income" = Credit, "expense" = Debit. A "transfer" row or a row whose
// direction couldn't be determined only matches rows of that same kind -
// it is never merged into Credit or Debit.
// ---------------------------------------------------------------------

export type LearningDirection =
    | "CREDIT"
    | "DEBIT"
    | "TRANSFER"
    | "UNKNOWN";

export function learningDirectionForType(
    type: NormalizedTransactionCandidate["type"]
): LearningDirection {
    switch (type) {
        case "income":
            return "CREDIT";
        case "expense":
            return "DEBIT";
        case "transfer":
            return "TRANSFER";
        default:
            return "UNKNOWN";
    }
}

function normalizedText(value: string | null | undefined): string {
    return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// Whether a Payee is just a bank narration of this row's kind rather than
// a name someone chose: blank, the row's own narration, or ANY narration
// with the same pattern (see extractTransactionPattern) - so a sibling
// row's narration that differs only by its reference number / digits is
// still raw, never a learned Payee.
export function isRawNarrationPayee(
    payee: string | null | undefined,
    description: string | null | undefined
): boolean {
    const normalizedPayee = normalizedText(payee);

    if (normalizedPayee === "") {
        return true;
    }

    if (normalizedPayee === normalizedText(description)) {
        return true;
    }

    const payeePattern = extractTransactionPattern(payee);

    return (
        payeePattern !== null &&
        payeePattern === extractTransactionPattern(description)
    );
}

// Whether a row's (or rule's) values teach anything beyond the bank's own
// narration: a Payee that isn't a raw narration (see isRawNarrationPayee),
// Notes, or a Category. A row nobody corrected - Payee still a narration,
// no notes, no category - has nothing to learn, and a rule holding only
// that is not a learned rule to show as such.
export function carriesLearnedValues(values: {
    payee?: string | null;
    description?: string | null;
    notes?: string | null;
    categoryId?: string | null;
}): boolean {
    return (
        !isRawNarrationPayee(values.payee, values.description) ||
        normalizedText(values.notes) !== "" ||
        !!values.categoryId
    );
}

// The learnable fields of a row / rule / saved transaction.
export interface LearnableValues {
    payee?: string | null;
    transactionType?: string | null;
    notes?: string | null;
    categoryId?: string | null;
}

// Whether applying a stored rule to a row actually changes it with a
// learned value - the Self-Learning indicator's "existing learned rule
// applied" (GREEN) test: a real (non-narration) Payee, Notes, a
// Category, or a Type different from the row's own detected Type. A
// rule holding only a narration and the row's own detected Type applies
// nothing learned.
export function ruleAppliesLearnedValues(
    rule: LearnableValues,
    candidate: {
        description?: string | null;
        transactionType?: string | null;
    }
): boolean {
    return (
        carriesLearnedValues({
            payee: rule.payee,
            description: candidate.description,
            notes: rule.notes,
            categoryId: rule.categoryId,
        }) ||
        (!!rule.transactionType &&
            rule.transactionType !==
                (candidate.transactionType ?? null))
    );
}

// Whether the final values differ from their baseline (what the row /
// transaction held before anyone touched it) by a genuine correction: a
// new non-narration Payee, a new Type, new non-blank Notes or a new
// Category. Clearing a value, or changing Payee back to a narration, is
// not a learnable correction.
export function hasGenuineCorrection(
    values: LearnableValues & { description?: string | null },
    baseline: LearnableValues
): boolean {
    const payeeCorrected =
        !isRawNarrationPayee(values.payee, values.description) &&
        normalizedText(values.payee) !== normalizedText(baseline.payee);

    const typeCorrected =
        !!values.transactionType &&
        values.transactionType !== (baseline.transactionType ?? null);

    const notesCorrected =
        normalizedText(values.notes) !== "" &&
        normalizedText(values.notes) !== normalizedText(baseline.notes);

    const categoryCorrected =
        !!values.categoryId &&
        values.categoryId !== (baseline.categoryId ?? null);

    return (
        payeeCorrected ||
        typeCorrected ||
        notesCorrected ||
        categoryCorrected
    );
}

// The minimal rule store both learning entry points write through (the
// Import commit and Transactions -> Edit) - structurally satisfied by
// CounterpartyRuleRepository.
export interface LearnedRuleStore {
    findByAccountAndPattern(
        accountId: string,
        pattern: string
    ): Promise<{
        counterparty: string;
        type: string | null;
        notes: string | null;
        categoryId?: string | null;
    } | null>;

    upsert(
        accountId: string,
        pattern: string,
        payee: string,
        type: string | null,
        notes: string | null,
        categoryId?: string | null
    ): Promise<unknown>;
}

// The single write path for self-learning. Creates or updates the
// account + key rule ONLY for a genuine correction of `values` against
// `baseline`. With no baseline supplied, the baseline is what the
// existing rule would already apply (or, with no rule, the untouched
// narration) - so re-importing a row that merely had a rule applied,
// or a row nobody corrected, never writes anything. A raw-narration
// Payee never overwrites a rule's learned Payee (a new rule stores it
// only as a placeholder, which enrichment never applies - see
// isRawNarrationPayee). Returns whether a rule was written.
//
// `excludedFields`: fields owned by a user-defined Custom Import Rule for
// this row (see customImportRules.ts). They are never treated as a
// correction and never written to the automatic rule - a custom rule's
// value must not turn into an automatic learned value. Other fields learn
// exactly as before; with no exclusions this behaves as it always did.
export async function learnRuleFromCorrection(
    store: LearnedRuleStore,
    accountId: string,
    pattern: string,
    values: LearnableValues & { description?: string | null },
    baseline?: LearnableValues,
    excludedFields?: ReadonlySet<keyof LearnableValues>
): Promise<boolean> {
    // A blank Payee never teaches anything (unchanged behavior).
    if (!values.payee?.trim()) {
        return false;
    }

    const existing =
        await store.findByAccountAndPattern(
            accountId,
            pattern
        );

    const effectiveBaseline: LearnableValues =
        baseline ??
        (existing
            ? {
                payee: existing.counterparty,
                transactionType:
                    existing.type ?? values.transactionType,
                notes: existing.notes,
                categoryId: existing.categoryId ?? null,
            }
            : {
                payee: values.description,
                transactionType: values.transactionType,
                notes: null,
                categoryId: null,
            });

    const excluded = (field: keyof LearnableValues) =>
        excludedFields?.has(field) ?? false;

    const considered: LearnableValues & { description?: string | null } =
        excludedFields && excludedFields.size > 0
            ? {
                description: values.description,
                payee: excluded("payee")
                    ? effectiveBaseline.payee
                    : values.payee,
                transactionType: excluded("transactionType")
                    ? effectiveBaseline.transactionType
                    : values.transactionType,
                notes: excluded("notes")
                    ? effectiveBaseline.notes
                    : values.notes,
                categoryId: excluded("categoryId")
                    ? effectiveBaseline.categoryId
                    : values.categoryId,
            }
            : values;

    if (!hasGenuineCorrection(considered, effectiveBaseline)) {
        return false;
    }

    // An excluded Payee keeps the existing learned Payee, or stores the
    // raw narration as the placeholder a new rule always starts from
    // (never applied by enrichment - see isRawNarrationPayee). Excluded
    // Type/Notes/Category pass null, which upsert treats as "keep".
    const payee = excluded("payee")
        ? existing?.counterparty ??
          (values.description ?? values.payee).trim()
        : !isRawNarrationPayee(values.payee, values.description)
            ? values.payee.trim()
            : existing?.counterparty ?? values.payee.trim();

    await store.upsert(
        accountId,
        pattern,
        payee,
        excluded("transactionType")
            ? null
            : values.transactionType ?? null,
        excluded("notes") ? null : values.notes?.trim() || null,
        excluded("categoryId") ? null : values.categoryId || null
    );

    return true;
}

export function learningKeyForCandidate(
    candidate: Pick<
        NormalizedTransactionCandidate,
        "description" | "type"
    >
): string | null {
    const pattern = extractTransactionPattern(
        candidate.description
    );

    if (!pattern) {
        return null;
    }

    return `${learningDirectionForType(candidate.type)}|${pattern}`;
}
