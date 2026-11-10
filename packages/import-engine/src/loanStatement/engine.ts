// ---------------------------------------------------------------------
// Universal loan statement analysis.
//
//   positioned text -> tables + labelled facts -> one or more facilities
//     -> classification -> type-specific view -> conflicts and gaps
//
// Pure: it reads a document and returns a description of it. It knows
// nothing about FinWea's database, loans, transactions or accounting.
// ---------------------------------------------------------------------

import { classifyFacility, type TextLine } from "./classify";
import { buildExtension, missingFor } from "./extensions";
import { extractCandidates, type FieldCandidate } from "./keyValues";
import type { StatementDocument, StatementLine } from "./layout";
import {
    buildCharges,
    buildDisbursements,
    buildLedger,
    buildLimitSchedule,
    buildRateTable,
    buildSchedule,
    buildSummaryTotals,
    bookingsFrom,
    EMPTY_SUMMARY,
    revisionsFromText,
} from "./ledger";
import { selectProfile, type LenderProfile } from "./profiles";
import { detectTables, type StatementTable } from "./tables";
import type {
    Confidence,
    ConflictItem,
    ExtractedField,
    FacilityBase,
    FacilityExtraction,
    FieldGroup,
    FieldId,
    FieldKind,
    FieldMap,
    FieldValue,
    LoanStatementAnalysis,
    SourceRef,
} from "./types";
import { FIELD_GROUPS } from "./types";
import { parseDateValue, inferDateContext, roundMoney, type DateContext } from "./values";
import { chargeCategory, FIELD_DEFINITIONS, type FieldDefinition } from "./vocabulary";

export interface AnalyseOptions {
    profiles?: readonly LenderProfile[];
}

const DERIVED_FIELD_META: Partial<Record<FieldId, { group: FieldGroup; kind: FieldKind }>> = {
    openingUtilised: { group: "outstanding", kind: "money" },
    openingUtilisedDate: { group: "outstanding", kind: "date" },
    currentUtilised: { group: "outstanding", kind: "money" },
    reductionFrequency: { group: "limits", kind: "text" },
};

function metaFor(id: FieldId): { group: FieldGroup; kind: FieldKind } {
    const definition = FIELD_DEFINITIONS.find(item => item.id === id);

    return definition ? { group: definition.group, kind: definition.kind } : DERIVED_FIELD_META[id]!;
}

function emptyField(id: FieldId): ExtractedField {
    return { id, kind: metaFor(id).kind, value: null, status: "NOT_IN_DOCUMENT", provenance: null, confidence: null, verification: null, sources: [], alternatives: [], note: null };
}

function fieldFromCandidates(id: FieldId, candidates: readonly FieldCandidate[]): ExtractedField {
    const byValue = new Map<FieldValue, FieldCandidate[]>();

    for (const candidate of candidates) {
        const key = typeof candidate.value === "string" ? candidate.value.toUpperCase() : candidate.value;
        byValue.set(key, [...(byValue.get(key) ?? []), candidate]);
    }

    const sourceRefs = (items: readonly FieldCandidate[]): SourceRef[] =>
        items.map(item => ({ page: item.page, label: item.label, raw: item.raw }));

    if (byValue.size > 1) {
        return {
            ...emptyField(id),
            status: "CONFLICT",
            verification: "CONFLICT",
            sources: sourceRefs(candidates),
            alternatives: [...byValue.values()].map(items => ({ value: items[0]!.value, sources: sourceRefs(items) })),
        };
    }

    const confidence: Confidence = candidates.every(item => item.viaHeading) ? "MEDIUM" : "HIGH";

    return {
        ...emptyField(id),
        value: candidates[0]!.value,
        status: "FOUND",
        provenance: "SOURCE",
        confidence,
        verification: "UNVERIFIED",
        sources: sourceRefs(candidates),
    };
}

function calculatedField(id: FieldId, value: FieldValue, note: string, sources: SourceRef[]): ExtractedField {
    return { ...emptyField(id), value, status: "FOUND", provenance: "CALCULATED", confidence: "MEDIUM", verification: "UNVERIFIED", sources, note };
}

function reportedField(id: FieldId, value: FieldValue, confidence: Confidence, source: SourceRef): ExtractedField {
    return { ...emptyField(id), value, status: "FOUND", provenance: "SOURCE", confidence, verification: "UNVERIFIED", sources: [source] };
}

function lineText(line: StatementLine): string {
    return line.cells.map(cell => cell.text).join(" ");
}

// ------------------------------------------------------------ facilities

interface Segment {
    from: number;
    to: number;
}

const SECTION_HEADING = /facility|statement|account (summary|details)|loan (details|summary)|\b(od|cc|term loan|overdraft|cash credit|demand loan)\b/i;

function segmentFacilities(
    lines: readonly StatementLine[],
    candidates: readonly FieldCandidate[],
    tables: readonly StatementTable[]
): Segment[] {
    const whole: Segment = { from: -Infinity, to: Infinity };
    const firstSeen = new Map<FieldValue, number>();

    for (const candidate of candidates) {
        if (candidate.definition.id === "loanAccountNumber" && !firstSeen.has(candidate.value)) {
            firstSeen.set(candidate.value, candidate.order);
        }
    }

    if (firstSeen.size < 2) return [whole];

    const starts = [...firstSeen.values()].sort((a, b) => a - b).map(order => {
        const line = lines.findIndex(item => item.order === order);
        let start = order;

        for (let index = line - 1; index >= Math.max(0, line - 3); index -= 1) {
            const text = lineText(lines[index]!);
            if (SECTION_HEADING.test(text) && text.split(/\s+/).length <= 8) start = lines[index]!.order;
        }

        return start;
    });

    const segments = starts.map((from, index) => ({ from, to: index + 1 < starts.length ? starts[index + 1]! - 1 : Infinity }));

    // A second account number with nothing of its own is a conflict on one
    // facility, not a second facility.
    const substantial = segments.every(segment => {
        const facts = candidates.filter(c => c.order >= segment.from && c.order <= segment.to && c.definition.group !== "identifiers").length;
        const ownTable = tables.some(table => table.headerOrder >= segment.from && table.headerOrder <= segment.to);

        return ownTable || facts >= 2;
    });

    if (!substantial) return [whole];

    segments[0]!.from = -Infinity;

    return segments;
}

const LEGAL_ENTITY = /^([A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,6}\s+(?:Bank|Limited|Ltd\.?|Finance|Financial Services|Co-?operative Bank))\b\.?$/i;
const LENDER_ANCHOR = /corporate identity|\bcin\b|registered office|regd\.? office/i;

/** The lender is the legal entity printed beside its registration details. */
function detectLender(lines: readonly StatementLine[], customerName: FieldValue | null | undefined): ExtractedField {
    const customer = typeof customerName === "string" ? customerName.toUpperCase() : null;
    const isEntity = (text: string) => LEGAL_ENTITY.test(text) && text.toUpperCase() !== customer;

    for (let index = 0; index < lines.length; index += 1) {
        if (!LENDER_ANCHOR.test(lineText(lines[index]!))) continue;

        for (let offset = -2; offset <= 2; offset += 1) {
            const line = lines[index + offset];
            const text = line && lineText(line).trim();
            if (line && text && isEntity(text)) {
                return reportedField("lenderName", text, "MEDIUM", { page: line.page, label: "Legal entity near registration details", raw: text });
            }
        }
    }

    const firstPage = lines.filter(line => line.page === 1).slice(0, 8);
    for (const line of firstPage) {
        const text = lineText(line).trim();
        if (isEntity(text)) {
            const repeated = new Set(lines.filter(other => lineText(other).trim() === text).map(other => other.page)).size > 1;

            return reportedField("lenderName", text, repeated ? "MEDIUM" : "LOW", { page: line.page, label: "Statement heading", raw: text });
        }
    }

    return emptyField("lenderName");
}

/** Statements often open with the borrower's unlabelled name and address. */
function detectBorrower(lines: readonly StatementLine[]): ExtractedField | null {
    const firstPage = lines.filter(line => line.page === 1);

    for (let index = 0; index < firstPage.length; index += 1) {
        if (!/\bpin\s*code\b|^email\b|\bpincode\b/i.test(lineText(firstPage[index]!))) continue;

        let top = index;
        while (top > 0) {
            const above = firstPage[top - 1]!;
            const current = firstPage[top]!;
            if (above.cells.length !== 1 || Math.abs(above.cells[0]!.x - current.cells[0]!.x) > 3 || above.y - current.y > current.cells[0]!.height * 2) break;
            top -= 1;
        }

        const name = lineText(firstPage[top]!).trim();
        if (top < index && /^[A-Za-z][A-Za-z .&'-]{2,60}$/.test(name)) {
            return reportedField("customerName", name, "LOW", { page: 1, label: "Top of the address block", raw: name });
        }
    }

    return null;
}

const PERIOD = /(?:statement\s+period|period|from)\s*:?\s*(.+?)\s+(?:to|till|until|-)\s+(.+)$/i;

function statementPeriod(lines: readonly TextLine[], dates: DateContext): { from: string; to: string; line: TextLine } | null {
    for (const line of lines) {
        const matched = PERIOD.exec(line.text);
        if (!matched) continue;

        const from = parseDateValue(matched[1]!, dates);
        const to = parseDateValue(matched[2]!, dates);
        if (from && to) return { from, to, line };
    }

    return null;
}

const STOCK_REFERENCE = /\bstock statement\b|\bbook debts?\b|\bhypothecation of (?:stocks?|book)\b|\bdrawing power\b.*\b(?:stock|debtors|receivables)\b/i;

function buildBase(
    id: string,
    segment: Segment,
    allLines: readonly StatementLine[],
    allCandidates: readonly FieldCandidate[],
    preface: readonly FieldCandidate[],
    allTables: readonly StatementTable[],
    dates: DateContext
): { base: FacilityBase; textLines: TextLine[] } {
    const inSegment = (order: number) => order >= segment.from && order <= segment.to;
    const candidates = [...allCandidates.filter(c => inSegment(c.order)), ...preface];
    const tables = allTables.filter(table => inSegment(table.headerOrder));
    const consumed = new Set(tables.flatMap(table => [...table.consumed]));
    const lines = allLines.filter(line => inSegment(line.order) && !consumed.has(line));
    const textLines: TextLine[] = lines.map(line => ({ page: line.page, text: lineText(line) }));
    // Numbered lists were not understood as tables, but their rows may still
    // state a rate or limit change in words.
    const genericRows = tables.filter(table => table.kind === "GENERIC").flatMap(table => [...table.consumed]);
    const revisionLines: TextLine[] = [...textLines, ...genericRows.map(line => ({ page: line.page, text: lineText(line) }))];

    const fields: FieldMap = {};
    const byId = new Map<FieldId, FieldCandidate[]>();
    for (const candidate of candidates) {
        byId.set(candidate.definition.id, [...(byId.get(candidate.definition.id) ?? []), candidate]);
    }
    for (const [fieldId, items] of byId) fields[fieldId] = fieldFromCandidates(fieldId, items);

    if (!fields.customerName) {
        const borrower = detectBorrower(allLines);
        if (borrower) fields.customerName = borrower;
    }

    if (!fields.lenderName) fields.lenderName = detectLender(allLines as StatementLine[], fields.customerName?.value);

    const period = statementPeriod(textLines, dates);
    if (period) {
        const source = [{ page: period.line.page, label: "Statement period", raw: period.line.text }];
        fields.statementFrom ??= { ...emptyField("statementFrom"), value: period.from, status: "FOUND", provenance: "SOURCE", confidence: "HIGH", verification: "UNVERIFIED", sources: source };
        fields.statementTo ??= { ...emptyField("statementTo"), value: period.to, status: "FOUND", provenance: "SOURCE", confidence: "HIGH", verification: "UNVERIFIED", sources: source };
    }

    const ledger = buildLedger(tables);
    const { rows: schedule, problems: scheduleProblems } = buildSchedule(tables);
    const revisions = revisionsFromText(revisionLines, dates);

    const base: FacilityBase = {
        id,
        pages: [...new Set(allLines.filter(line => inSegment(line.order)).map(line => line.page))],
        fields,
        groups: {} as FacilityBase["groups"],
        transactions: ledger?.entries ?? [],
        ledgerCheck: ledger?.check ?? null,
        ledgerSummary: ledger?.summary ?? { ...EMPTY_SUMMARY },
        schedule,
        scheduleProblems,
        disbursements: buildDisbursements(tables),
        charges: buildCharges(tables),
        rateHistory: [...buildRateTable(tables), ...revisions.rates],
        limitChanges: [...buildLimitSchedule(tables), ...revisions.limits],
        drawingPowerReferences: textLines.filter(line => STOCK_REFERENCE.test(line.text)).map(line => ({ page: line.page, raw: line.text })),
        conflicts: [],
    };

    mergeBookings(base);
    applySummaryTotals(base, buildSummaryTotals(tables));
    applyRateHistory(base);
    addCalculatedFields(base);
    applyCrossChecks(base);
    base.groups = groupFields(base.fields);
    base.conflicts = findConflicts(base);

    return { base, textLines };
}

function groupFields(fields: FieldMap): FacilityBase["groups"] {
    const groups = Object.fromEntries(FIELD_GROUPS.map(group => [group, {}])) as FacilityBase["groups"];

    for (const definition of [...FIELD_DEFINITIONS, ...Object.keys(DERIVED_FIELD_META).map(id => ({ id: id as FieldId, group: DERIVED_FIELD_META[id as FieldId]!.group }))] as Array<Pick<FieldDefinition, "id" | "group">>) {
        groups[definition.group][definition.id] = fields[definition.id] ?? emptyField(definition.id);
    }

    return groups;
}

function isInstalmentLedger(base: FacilityBase): boolean {
    return base.schedule.length > 0 || base.transactions.some(entry => entry.kind === "INSTALMENT_DEMAND");
}

/** Gross, withheld and paid-out amounts the ledger shows for each disbursement. */
function mergeBookings(base: FacilityBase): void {
    const bookings = bookingsFrom(base.transactions);
    const { fields } = base;

    for (const booking of bookings) {
        const row = base.disbursements.find(item => item.gross === booking.gross && (item.net === null || item.net === booking.net));

        if (row) {
            row.net ??= booking.net;
            row.deductions ??= booking.deductions;
            row.reference ??= booking.reference;
        } else {
            base.disbursements.push({ date: booking.date, gross: booking.gross, net: booking.net, deductions: booking.deductions, reference: booking.reference, provenance: "SOURCE", page: booking.page });
        }
    }

    const withheld = base.transactions.filter(entry => entry.isDeduction);
    if (base.charges.length === 0) {
        base.charges = withheld.map(entry => ({ name: entry.description.replace(/^.*?disbursal\s+/i, "").trim() || entry.description, date: entry.date, amount: entry.amount, category: chargeCategory(entry.description.replace(/^.*?disbursal\s+/i, "")), page: entry.page }));
    }

    const total = withheld.reduce((sum, entry) => sum + entry.amount, 0);
    const net = bookings.reduce((sum, booking) => sum + (booking.net ?? 0), 0);
    const source: SourceRef | null = withheld[0] ? { page: withheld[0].page, label: "Disbursement rows of the ledger", raw: `${withheld.length} deductions` } : null;

    if (source && !fields.netDisbursed && bookings.length > 0 && bookings.every(booking => booking.net !== null)) {
        fields.netDisbursed = reportedField("netDisbursed", roundMoney(net), "HIGH", { ...source, raw: String(net) });
    }
    if (source && !fields.totalDeductions && withheld.length > 0) {
        fields.totalDeductions = calculatedField("totalDeductions", roundMoney(total), "Sum of the deductions listed in the ledger.", [source]);
    }
}

function applySummaryTotals(base: FacilityBase, totals: ReturnType<typeof buildSummaryTotals>): void {
    if (totals.principalRepaid && !base.fields.principalRepaidTotal) {
        base.fields.principalRepaidTotal = reportedField("principalRepaidTotal", totals.principalRepaid.amount, "HIGH", { page: totals.principalRepaid.page, label: totals.principalRepaid.label, raw: String(totals.principalRepaid.amount) });
    }
    if (totals.interestPaid && !base.fields.interestPaidTotal) {
        base.fields.interestPaidTotal = reportedField("interestPaidTotal", totals.interestPaid.amount, "HIGH", { page: totals.interestPaid.page, label: totals.interestPaid.label, raw: String(totals.interestPaid.amount) });
    }
}

/**
 * A printed rate change says which rate came first. The headline rate is
 * then the current one, and the earlier rate is the original.
 */
function applyRateHistory(base: FacilityBase): void {
    const changes = base.rateHistory.filter(change => change.previousRate !== null);
    if (changes.length === 0) return;

    const sorted = [...changes].sort((a, b) => (a.effectiveDate ?? "").localeCompare(b.effectiveDate ?? ""));
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const { fields } = base;
    const stated = fields.interestRate;

    if (!fields.currentInterestRate && stated?.status === "FOUND" && stated.value === last.rate) {
        fields.currentInterestRate = { ...stated, id: "currentInterestRate" };
    } else if (!fields.currentInterestRate) {
        fields.currentInterestRate = reportedField("currentInterestRate", last.rate, "MEDIUM", { page: last.page, label: "Rate change narration", raw: last.raw });
    }

    fields.interestRate = reportedField("interestRate", first.previousRate!, "HIGH", { page: first.page, label: "Rate change narration (rate before the change)", raw: first.raw });
}

/** Fills only what the document leaves blank, and always says it was worked out. */
function addCalculatedFields(base: FacilityBase): void {
    const { fields, ledgerCheck, schedule, disbursements } = base;
    const absent = (id: FieldId) => !fields[id] || fields[id]!.status === "NOT_IN_DOCUMENT";
    const ledgerSource: SourceRef[] = base.transactions[0]
        ? [{ page: base.transactions[0].page, label: "Statement ledger", raw: `${base.transactions.length} rows` }]
        : [];

    if (ledgerCheck && !isInstalmentLedger(base)) {
        if (absent("openingUtilised") && ledgerCheck.opening !== null && ledgerCheck.mismatches === 0) {
            if (ledgerCheck.openingProvenance === "SOURCE") {
                fields.openingUtilised = { ...calculatedField("openingUtilised", ledgerCheck.opening, "", ledgerSource), provenance: "SOURCE", confidence: "HIGH", note: null };
            } else {
                fields.openingUtilised = calculatedField("openingUtilised", ledgerCheck.opening, "The balance on the first statement row with that row's movement reversed.", ledgerSource);
            }
        }
        if (absent("openingUtilisedDate") && ledgerCheck.openingDate && ledgerCheck.mismatches === 0) {
            fields.openingUtilisedDate = ledgerCheck.openingProvenance === "SOURCE"
                ? { ...calculatedField("openingUtilisedDate", ledgerCheck.openingDate, "", ledgerSource), provenance: "SOURCE", confidence: "HIGH", note: null }
                : calculatedField("openingUtilisedDate", ledgerCheck.openingDate, "The day before the first statement row.", ledgerSource);
        }
        if (absent("currentUtilised") && ledgerCheck.closing !== null && ledgerCheck.mismatches === 0) {
            fields.currentUtilised = calculatedField("currentUtilised", ledgerCheck.closing, "The balance after the last statement row.", ledgerSource);
        }
    }

    if (schedule.length > 0) {
        const source: SourceRef[] = [{ page: schedule[0]!.page, label: "Repayment schedule", raw: `${schedule.length} rows` }];

        if (absent("firstInstalmentDate")) fields.firstInstalmentDate = calculatedField("firstInstalmentDate", schedule[0]!.dueDate, "The first due date in the printed schedule.", source);
        if (absent("tenureMonths")) fields.tenureMonths = calculatedField("tenureMonths", schedule.length, "The number of rows in the printed schedule.", source);
        if (absent("maturityDate")) fields.maturityDate = calculatedField("maturityDate", schedule[schedule.length - 1]!.dueDate, "The last due date in the printed schedule.", source);

        const emis = schedule.map(row => row.emi).filter((emi): emi is number => emi !== null);
        if (absent("emiAmount") && emis.length > 0) {
            const counts = new Map<number, number>();
            emis.forEach(emi => counts.set(emi, (counts.get(emi) ?? 0) + 1));
            const regular = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
            fields.emiAmount = calculatedField("emiAmount", regular, "The most common instalment in the printed schedule.", source);
        }
    }

    if (disbursements.length > 0) {
        const source: SourceRef[] = [{ page: disbursements[0]!.page, label: "Disbursement table", raw: `${disbursements.length} rows` }];
        const sum = (pick: (row: FacilityBase["disbursements"][number]) => number | null) => {
            const values = disbursements.map(pick);
            return values.every(value => value !== null) ? roundMoney((values as number[]).reduce((a, b) => a + b, 0)) : null;
        };
        const gross = sum(row => row.gross);
        const net = sum(row => row.net);

        if (absent("grossDisbursed") && gross !== null) fields.grossDisbursed = calculatedField("grossDisbursed", gross, "Sum of the disbursement table.", source);
        if (absent("netDisbursed") && net !== null) fields.netDisbursed = calculatedField("netDisbursed", net, "Sum of the disbursement table.", source);
        if (absent("disbursementDate") && disbursements[0]!.date) {
            fields.disbursementDate = disbursements.length === 1
                ? reportedField("disbursementDate", disbursements[0]!.date, "HIGH", source[0]!)
                : calculatedField("disbursementDate", disbursements[0]!.date, "The first disbursement's date.", source);
        }
    }

    const scheduled = base.limitChanges.filter(change => change.nature === "SCHEDULED");
    if (absent("reductionFrequency") && scheduled.length >= 3) {
        const frequency = reductionFrequency(scheduled.map(change => change.effectiveDate));
        if (frequency) {
            fields.reductionFrequency = calculatedField("reductionFrequency", frequency, "From the spacing of the printed reduction dates.", [{ page: scheduled[0]!.page, label: "Reduction schedule", raw: `${scheduled.length} rows` }]);
        }
    }
    if (absent("initialDrawingPower") && scheduled[0]) {
        fields.initialDrawingPower = calculatedField("initialDrawingPower", scheduled[0].amount, "The first amount in the printed reduction schedule.", [{ page: scheduled[0].page, label: "Reduction schedule", raw: scheduled[0].raw }]);
    }
}

function reductionFrequency(dates: ReadonlyArray<string | null>): string | null {
    if (dates.some(date => date === null)) return null;

    const months = (dates as string[]).map(date => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)));
    const gaps = new Set(months.slice(1).map((month, index) => month - months[index]!));
    if (gaps.size !== 1) return null;

    const names: Record<number, string> = { 1: "Monthly", 3: "Quarterly", 6: "Half-yearly", 12: "Yearly" };

    return names[[...gaps][0]!] ?? null;
}

/** Marks figures the document's own arithmetic confirms. */
function applyCrossChecks(base: FacilityBase): void {
    const confirm = (...ids: FieldId[]) => {
        for (const id of ids) {
            const field = base.fields[id];
            if (field?.status === "FOUND") field.verification = "CROSS_CHECKED";
        }
    };
    const agrees = (left: number | null, right: number | null) => left !== null && right !== null && Math.abs(left - right) <= 0.01;
    const n = (id: FieldId) => money(base, id);
    const sumOf = (...values: Array<number | null>) => (values.every(value => value !== null) ? roundMoney((values as number[]).reduce((a, b) => a + b, 0)) : null);
    const lent = n("grossDisbursed") ?? n("sanctionedAmount");

    if (lent !== null && n("principalRepaidTotal") !== null && agrees(lent - n("principalRepaidTotal")!, n("outstandingPrincipal"))) {
        confirm("grossDisbursed", "principalRepaidTotal", "outstandingPrincipal");
    }
    if (agrees(sumOf(n("principalRepaidTotal"), n("interestPaidTotal")), n("instalmentsPaidAmount"))) {
        confirm("principalRepaidTotal", "interestPaidTotal", "instalmentsPaidAmount");
    }
    if (agrees(sumOf(n("netDisbursed"), n("totalDeductions")), n("grossDisbursed"))) {
        confirm("netDisbursed", "totalDeductions", "grossDisbursed");
    }
    if (n("emiAmount") !== null && n("instalmentsPaid") !== null && agrees(n("emiAmount")! * n("instalmentsPaid")!, n("instalmentsPaidAmount"))) {
        confirm("emiAmount", "instalmentsPaid", "instalmentsPaidAmount");
    }
    if (agrees(sumOf(n("outstandingPrincipal"), n("accruedInterest") ?? 0, n("chargesDue") ?? 0, n("penalInterest") ?? 0), n("totalOutstanding"))) {
        confirm("outstandingPrincipal", "accruedInterest", "totalOutstanding");
    }

    const closing = base.ledgerCheck?.mismatches === 0 && !isInstalmentLedger(base) ? base.ledgerCheck.closing : null;
    if (agrees(closing, n("outstandingPrincipal"))) confirm("outstandingPrincipal");
    if (agrees(closing, n("totalOutstanding"))) confirm("totalOutstanding");
}

// ------------------------------------------------------------- conflicts

function money(base: FacilityBase, id: FieldId): number | null {
    const value = base.fields[id]?.status === "FOUND" ? base.fields[id]!.value : null;

    return typeof value === "number" ? value : null;
}

function firstSource(base: FacilityBase, id: FieldId): number | null {
    return base.fields[id]?.sources[0]?.page ?? null;
}

function findConflicts(base: FacilityBase): ConflictItem[] {
    const conflicts: ConflictItem[] = [];

    for (const field of Object.values(base.fields)) {
        if (field?.status !== "CONFLICT") continue;

        conflicts.push({
            fieldId: field.id,
            message: "The document states different values. Choose the correct one.",
            values: field.alternatives.map(item => ({
                label: item.sources[0]?.label ?? "",
                value: item.value,
                page: item.sources[0]?.page ?? null,
            })),
        });
    }

    // An instalment ledger's balance is dues billed and unpaid, not the loan.
    const closing = base.ledgerCheck?.mismatches === 0 && !isInstalmentLedger(base) ? base.ledgerCheck.closing : null;
    const total = money(base, "totalOutstanding");
    const principal = money(base, "outstandingPrincipal");
    const reported = principal ?? total;

    if (closing !== null && reported !== null && Math.abs(closing - reported) > 0.01) {
        const id = principal !== null ? "outstandingPrincipal" : "totalOutstanding";
        conflicts.push({
            fieldId: id,
            message: "The summary figure does not equal the balance after the last statement row.",
            values: [
                { label: "Summary", value: reported, page: firstSource(base, id) },
                { label: "Last ledger balance", value: closing, page: base.transactions[base.transactions.length - 1]?.page ?? null },
            ],
        });
    }

    const pieces = [principal, money(base, "accruedInterest"), money(base, "chargesDue"), money(base, "penalInterest")];
    if (total !== null && principal !== null && Math.abs(pieces.reduce<number>((sum, part) => sum + (part ?? 0), 0) - total) > 0.01) {
        conflicts.push({
            fieldId: "totalOutstanding",
            message: "The total outstanding does not equal principal, interest and charges added together.",
            values: [
                { label: "Stated total", value: total, page: firstSource(base, "totalOutstanding") },
                { label: "Sum of the parts", value: roundMoney(pieces.reduce<number>((sum, part) => sum + (part ?? 0), 0)), page: null },
            ],
        });
    }

    const available = money(base, "availableAmount");
    const used = money(base, "currentUtilised") ?? principal ?? total ?? closing;
    if (available !== null && used !== null) {
        const limits: Array<[string, number]> = [];
        for (const [label, id] of [["Drawing power", "drawingPower"], ["Current limit", "currentLimit"], ["Sanctioned amount", "sanctionedAmount"]] as const) {
            const limit = money(base, id);
            if (limit !== null) limits.push([label, limit]);
        }

        if (limits.length > 0 && !limits.some(([, limit]) => Math.abs(limit - used - available) <= 0.01)) {
            conflicts.push({
                fieldId: "availableAmount",
                message: "The stated available amount does not equal any stated limit less the utilised balance.",
                values: [
                    { label: "Stated available amount", value: available, page: firstSource(base, "availableAmount") },
                    ...limits.map(([label, limit]) => ({ label: `${label} less utilised`, value: roundMoney(limit - used), page: null })),
                ],
            });
        }
    }

    if (base.ledgerCheck && base.ledgerCheck.mismatches > 0) {
        const rows = base.transactions.filter(entry => entry.chainStatus === "MISMATCH");
        conflicts.push({
            fieldId: null,
            message: `${base.ledgerCheck.mismatches} of ${base.ledgerCheck.checkedRows} statement rows do not agree with the running balance. Figures calculated from the ledger were not filled in.`,
            values: rows.slice(0, 5).map(entry => ({ label: `${entry.date} ${entry.description}`.trim(), value: entry.balance ?? entry.amount, page: entry.page })),
        });
    }

    const gross = money(base, "grossDisbursed");
    const sanctioned = money(base, "sanctionedAmount");
    if (gross !== null && sanctioned !== null && gross > sanctioned + 0.01 && base.ledgerSummary.repaymentCount === 0) {
        conflicts.push({
            fieldId: "grossDisbursed",
            message: "The amount disbursed is more than the amount sanctioned.",
            values: [
                { label: "Disbursed", value: gross, page: firstSource(base, "grossDisbursed") },
                { label: "Sanctioned", value: sanctioned, page: firstSource(base, "sanctionedAmount") },
            ],
        });
    }

    return conflicts;
}

function overallConfidence(facility: Omit<FacilityExtraction, "extractionConfidence">): Confidence {
    const unreadable = facility.ledgerCheck !== null && facility.ledgerCheck.checkedRows > 0 && facility.ledgerCheck.mismatches > 0;
    const hasFieldConflicts = facility.conflicts.some(conflict => conflict.fieldId !== null && facility.fields[conflict.fieldId]?.status === "CONFLICT");

    if (unreadable || facility.classification.confidence === "LOW") return "LOW";
    if (hasFieldConflicts || facility.conflicts.length > 0 || facility.classification.confidence === "MEDIUM" || facility.missing.length > 3) return "MEDIUM";

    return "HIGH";
}

// ------------------------------------------------------------------ main

export function analyseLoanStatement(document: StatementDocument, options: AnalyseOptions = {}): LoanStatementAnalysis {
    const empty = (status: LoanStatementAnalysis["status"], warnings: string[]): LoanStatementAnalysis => ({
        status,
        pageCount: document.pageCount,
        imageOnlyPages: document.imageOnlyPages ?? [],
        profileId: null,
        facilities: [],
        warnings,
    });

    const imageOnlyPages = document.imageOnlyPages ?? [];

    if (document.lines.length === 0) {
        return imageOnlyPages.length > 0
            ? { ...empty("SCANNED", ["This PDF is a scanned image. FinWea cannot read scanned documents (text recognition is not available), so nothing was extracted. Please obtain a digital copy from your lender or enter the details by hand."]), imageOnlyPages }
            : empty("NO_TEXT_LAYER", ["This PDF contains no readable text, so nothing was extracted."]);
    }

    const profile = selectProfile(document, options.profiles ?? []);
    const definitions = FIELD_DEFINITIONS.map(definition => {
        const extra = profile?.labelAliases?.[definition.id];
        return extra ? { ...definition, patterns: [...definition.patterns, ...extra] } : definition;
    });

    const dates = inferDateContext(document.lines.flatMap(line => line.cells.map(cell => cell.text)));
    const tables = detectTables(document.lines, dates);
    const consumed = new Set(tables.flatMap(table => [...table.consumed]));
    const labelLines = document.lines.filter(line => !consumed.has(line));
    const allCandidates = extractCandidates(labelLines, definitions, dates);
    const namedAccount = allCandidates.some(c => c.definition.id === "loanAccountNumber" && !c.weak);
    const candidates = namedAccount ? allCandidates.filter(c => !c.weak) : allCandidates;
    const segments = segmentFacilities(labelLines, candidates, tables);

    // Who the statement is for and who issued it apply to every facility in it.
    const firstAccount = Math.min(...candidates.filter(c => c.definition.id === "loanAccountNumber").map(c => c.order));
    const preface = segments.length > 1
        ? candidates.filter(c => c.order < firstAccount && (c.definition.id === "customerName" || c.definition.id === "lenderName"))
        : [];

    const facilities = segments.map((segment, index): FacilityExtraction => {
        const { base: generic, textLines } = buildBase(
            `facility-${index + 1}`,
            segment,
            document.lines,
            candidates,
            index === 0 ? [] : preface,
            tables,
            dates
        );

        const base = profile?.refine ? profile.refine(generic, document) : generic;
        const detected = classifyFacility(base, textLines);
        const missing = missingFor(base, detected.detected);
        const classification = { ...detected, missingInformation: missing };
        const partial = {
            ...base,
            classification,
            extension: buildExtension(base, classification.detected),
            missing,
        };

        return { ...partial, extractionConfidence: overallConfidence(partial) };
    });

    const substantive = facilities.filter(facility =>
        facility.transactions.length > 0 ||
        facility.schedule.length > 0 ||
        Object.values(facility.fields).some(field => field?.status !== "NOT_IN_DOCUMENT" && field?.id !== "lenderName")
    );

    if (substantive.length === 0) {
        return empty("NO_FACILITY_FOUND", ["No loan details or statement rows were recognised in this document."]);
    }

    return {
        status: "OK",
        pageCount: document.pageCount,
        imageOnlyPages,
        profileId: profile?.id ?? null,
        facilities: substantive,
        warnings: imageOnlyPages.length > 0
            ? [`Page(s) ${imageOnlyPages.join(", ")} are scanned images and were not read, so details on them are missing.`]
            : [],
    };
}
