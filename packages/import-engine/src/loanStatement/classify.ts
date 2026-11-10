// Decides what kind of facility a statement describes from its own wording
// and structure, and reports how sure that is. Two steps: is it instalment,
// on-demand or revolving; then, for revolving, which kind. Weak evidence
// yields a lower confidence or Other/Unknown - never a forced type.
//
// Deliberately worth nothing:
//   - interest rows and repayments: every facility has them;
//   - a reference to a linked account: that describes another facility.

import type {
    ClassificationEvidence,
    Confidence,
    FacilityBase,
    FacilityType,
    LoanClassification,
} from "./types";
import { FACILITY_TYPES, FACILITY_TYPE_LABELS } from "./types";

const REVOLVING: FacilityType[] = ["OVERDRAFT", "DROPLINE_OVERDRAFT", "CASH_CREDIT"];

export interface TextLine {
    page: number;
    text: string;
}

/** First match wins, so "Dropline Overdraft" is never also an "Overdraft". */
const WORDING: Array<{ types: FacilityType[]; pattern: RegExp }> = [
    { types: ["TERM_LOAN"], pattern: /\bnon\s*-?\s*revolving\b|\bequated\s+(?:monthly\s+)?instal?lments?\b/i },
    { types: ["DROPLINE_OVERDRAFT"], pattern: /\bdrop\s*-?\s*line\b|\bDOD\b|\breducing\s+(?:od|overdraft)\b/i },
    { types: ["CASH_CREDIT"], pattern: /\bcash\s+credit\b|\bcc\s+(?:limit|a\/?c|account|facility)\b/i },
    { types: ["DEMAND_LOAN"], pattern: /\bdemand\s+loan\b|\bwcdl\b|\brepayable\s+on\s+demand\b|\bpayable\s+on\s+demand\b/i },
    { types: ["OVERDRAFT"], pattern: /\bover\s*-?\s*draft\b|\bod\s+(?:limit|a\/?c|account|facility)\b/i },
    { types: REVOLVING, pattern: /\brevolving\b/i },
    { types: ["TERM_LOAN"], pattern: /\bterm\s+loan\b|\b(?:home|personal|auto|car|vehicle|education|mortgage)\s+loan\b|\bloan\s+against\s+property\b/i },
    { types: ["TERM_LOAN"], pattern: /\bLAP\b/ },
];

const LINKED_ACCOUNT = /\b(?:linked|parent|associated|mapped)\b/i;
const MAX_HEADING_WORDS = 12;
const EXPLICIT_WEIGHT = 8;

function wordingEvidence(lines: readonly TextLine[], base: FacilityBase): ClassificationEvidence[] {
    const found = new Map<string, ClassificationEvidence>();
    const stated = [base.fields.productName, base.fields.schemeName];
    const sources: TextLine[] = [
        ...stated.flatMap(field => (typeof field?.value === "string" ? [{ page: field.sources[0]?.page ?? 1, text: field.value }] : [])),
        // Sentences are boilerplate ("we also offer term loans"); only short
        // headings and labels describe this facility.
        ...lines.filter(line => line.text.split(/\s+/).length <= MAX_HEADING_WORDS),
        // A label wrapped over several lines only exists whole on its field.
        ...Object.values(base.fields).flatMap(field =>
            (field?.provenance === "SOURCE" ? field.sources : []).map(source => ({ page: source.page, text: source.label }))
        ),
    ];

    for (const { page, text } of sources) {
        if (LINKED_ACCOUNT.test(text)) continue;

        const rule = WORDING.find(item => item.pattern.test(text));
        if (!rule) continue;

        const key = rule.types.join();
        const said = text.match(rule.pattern)![0];
        if (found.has(`${key}:${said.toLowerCase()}`)) continue;

        // More wording for the same type is shown, but only counts once.
        const alreadyCounted = [...found.keys()].some(existing => existing.startsWith(`${key}:`));

        found.set(`${key}:${said.toLowerCase()}`, {
            supports: rule.types,
            weight: alreadyCounted ? 0 : EXPLICIT_WEIGHT,
            explicit: true,
            description: `The document says "${said}".`,
            page,
            raw: text,
        });
    }

    return [...found.values()];
}

function structuralEvidence(base: FacilityBase): ClassificationEvidence[] {
    const evidence: ClassificationEvidence[] = [];
    const push = (supports: FacilityType[], weight: number, description: string, page: number | null = null, raw: string | null = null, explicit = false) =>
        evidence.push({ supports, weight, explicit, description, page, raw });
    const sourceOf = (id: keyof FacilityBase["fields"]) => base.fields[id]?.sources[0];
    const numberOf = (id: keyof FacilityBase["fields"]) => {
        const value = base.fields[id]?.value;
        return typeof value === "number" ? value : null;
    };
    const isStated = (id: keyof FacilityBase["fields"]) => base.fields[id]?.provenance === "SOURCE";
    const cite = (id: keyof FacilityBase["fields"]): [number | null, string | null] => {
        const source = sourceOf(id);
        return [source?.page ?? null, source ? `${source.label}: ${source.raw}` : null];
    };

    // Repeated borrowing after repaying is what makes a facility revolving.
    const movements = base.transactions.filter(entry => entry.kind === "DRAWDOWN" || entry.kind === "REPAYMENT");
    let redrawsAfterRepaying = 0;
    let repaid = false;
    for (const entry of movements) {
        if (entry.kind === "REPAYMENT") repaid = true;
        else if (repaid) redrawsAfterRepaying += 1;
    }

    if (base.ledgerSummary.drawdownCount >= 3 && redrawsAfterRepaying >= 1) {
        push(REVOLVING, 5, `${base.ledgerSummary.drawdownCount} separate drawdowns, ${redrawsAfterRepaying} of them after money was repaid - repaid amounts are being borrowed again.`, base.transactions[0]?.page ?? null);
    } else if (base.ledgerSummary.drawdownCount >= 4) {
        push(REVOLVING, 2, `${base.ledgerSummary.drawdownCount} separate drawdowns.`, base.transactions[0]?.page ?? null);
    }

    if (isStated("availableAmount")) push(REVOLVING, 3, "States an available / undrawn amount, which only a limit-based facility has.", ...cite("availableAmount"));
    if (isStated("drawingPower")) push(REVOLVING, 4, "States a drawing power.", ...cite("drawingPower"));
    if (/\blimit\b/i.test(sourceOf("sanctionedAmount")?.label ?? "")) push(REVOLVING, 3, "Describes the sanction as a limit.", ...cite("sanctionedAmount"));

    // A lowered limit only suggests a dropline. The type is not chosen on
    // it alone (see classifyFacility), but the customer is told.
    const sanctioned = numberOf("sanctionedAmount");
    const currentLimit = numberOf("currentLimit");
    if (sanctioned !== null && currentLimit !== null && currentLimit < sanctioned) {
        push(["DROPLINE_OVERDRAFT"], 5, `The current limit (${currentLimit}) is below the original sanction (${sanctioned}), which may mean a limit that reduces over time. The document prints no reduction schedule and does not say so.`, ...cite("currentLimit"));
    }

    const scheduled = base.limitChanges.find(change => change.nature === "SCHEDULED");
    if (scheduled) push(["DROPLINE_OVERDRAFT"], EXPLICIT_WEIGHT, "Prints a schedule of limit or drawing-power reductions.", scheduled.page, scheduled.raw, true);

    if (isStated("stockValue") || isStated("bookDebts") || isStated("stockStatementDate") || base.drawingPowerReferences.length > 0) {
        const reference = base.drawingPowerReferences[0];
        push(["CASH_CREDIT"], 6, "Refers to stock or book debts as the basis for drawing.", reference?.page ?? null, reference?.raw ?? null);
    }

    if (base.schedule.length >= 2) push(["TERM_LOAN"], 6, `Prints a repayment schedule of ${base.schedule.length} instalments.`, base.schedule[0]?.page);
    if (isStated("emiAmount")) push(["TERM_LOAN"], 5, "States an EMI / instalment amount.", ...cite("emiAmount"));

    const billed = base.transactions.filter(entry => entry.kind === "INSTALMENT_DEMAND");
    if (billed.length >= 2) push(["TERM_LOAN"], 4, `${billed.length} instalments billed in the ledger.`, billed[0]!.page);
    if (equalRegularRepayments(base)) push(["TERM_LOAN"], 3, "Repayments are equal amounts at regular intervals.", base.transactions[0]?.page ?? null);
    if (base.ledgerSummary.drawdownCount === 1) push(["TERM_LOAN", "DEMAND_LOAN"], 2, "A single disbursement.");

    return evidence;
}

function equalRegularRepayments(base: FacilityBase): boolean {
    const repayments = base.transactions.filter(entry => entry.kind === "REPAYMENT");
    if (repayments.length < 3) return false;

    const counts = new Map<number, number>();
    for (const entry of repayments) counts.set(entry.amount, (counts.get(entry.amount) ?? 0) + 1);

    return Math.max(...counts.values()) / repayments.length >= 0.7;
}

function scoreOf(evidence: readonly ClassificationEvidence[]): Record<FacilityType, number> {
    const scores = Object.fromEntries(FACILITY_TYPES.map(type => [type, 0])) as Record<FacilityType, number>;

    for (const item of evidence) {
        for (const type of item.supports) scores[type] += item.weight;
    }

    return scores;
}

/** Plain Overdraft unless the document actually distinguishes a variant. */
function revolvingVariant(evidence: readonly ClassificationEvidence[]): FacilityType {
    const only = (type: FacilityType) => evidence.filter(item => item.supports.length === 1 && item.supports[0] === type);

    if (only("DROPLINE_OVERDRAFT").some(item => item.explicit)) return "DROPLINE_OVERDRAFT";
    if (only("CASH_CREDIT").length > 0) return "CASH_CREDIT";

    return "OVERDRAFT";
}

const MINIMUM_SCORE = 4;

export function classifyFacility(base: FacilityBase, lines: readonly TextLine[]): LoanClassification {
    const evidence = [...wordingEvidence(lines, base), ...structuralEvidence(base)];
    const scores = scoreOf(evidence);
    const revolving = revolvingVariant(evidence);
    const contenders: FacilityType[] = ["TERM_LOAN", "DEMAND_LOAN", revolving];
    const ranked = [...contenders].sort((a, b) => scores[b] - scores[a]);
    const detected = ranked[0]!;
    const best = scores[detected];

    if (best < MINIMUM_SCORE) {
        return {
            detected: "OTHER_UNKNOWN",
            confidence: "LOW",
            evidence,
            conflictingEvidence: [],
            missingInformation: [],
            confirmationRequired: true,
            reasonForConfirmation: "The document does not contain enough evidence to identify the facility type.",
            scores,
        };
    }

    const margin = best - scores[ranked[1]!];
    const supporting = evidence.filter(item => item.supports.includes(detected));
    const conflictingEvidence = evidence.filter(item => !item.supports.includes(detected));
    const statedOutright = supporting.some(item => item.explicit);
    const contradictedOutright = conflictingEvidence.some(item => item.explicit);

    let confidence: Confidence = "LOW";
    if (statedOutright && best >= 10 && margin >= 5 && !contradictedOutright) confidence = "HIGH";
    else if (best >= 6 && margin >= 3) confidence = "MEDIUM";

    let reasonForConfirmation: string | null = null;
    if (margin === 0) {
        reasonForConfirmation = `The evidence does not distinguish between ${ranked.filter(type => scores[type] === best).map(type => FACILITY_TYPE_LABELS[type]).join(" and ")}.`;
    } else if (conflictingEvidence.some(item => item.supports.includes("DROPLINE_OVERDRAFT")) && detected === "OVERDRAFT") {
        reasonForConfirmation = "This may be a Dropline Overdraft, but the document neither says so nor prints a reduction schedule.";
    } else if (conflictingEvidence.length > 0) {
        reasonForConfirmation = "Part of the document points to a different facility type.";
    } else if (!statedOutright) {
        reasonForConfirmation = "The document never names the facility type; it was inferred from its structure.";
    } else if (confidence !== "HIGH") {
        reasonForConfirmation = "The evidence is not strong enough to be certain.";
    }

    return {
        detected,
        confidence,
        evidence: supporting,
        conflictingEvidence,
        missingInformation: [],
        confirmationRequired: reasonForConfirmation !== null,
        reasonForConfirmation,
        scores,
    };
}
