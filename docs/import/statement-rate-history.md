# Interest Rate History - Stage 4: lender-statement rate changes

Status: implemented on `feat/accounts-cards-loans`, uncommitted. Migration 054
(`loan_interest_rate_history`) stays **unregistered**: in the normal app the
table does not exist, so everything below is inert there and the statement
import behaves exactly as before (see "Without migration 054").

## A. Audit (what existed)

| Piece | Where | What it does |
|---|---|---|
| Rate extraction | `packages/import-engine/src/loanStatement/ledger.ts` `buildRateTable`, `revisionsFromText` | `RateChange { effectiveDate \| null, rate, previousRate \| null, page, raw }` from a RATES table and from narration ("ROI revised to 9.25% w.e.f. ...", "rate changed from 10.5% to 10.75%"). No per-row confidence and no rate type. |
| Headline rates | `engine.ts` `applyRateHistory` | With a printed change: `interestRate` = the first change's previous rate (original), `currentInterestRate` = the last change's rate. |
| Review | `statementImport/statementReview.ts`, `StatementImportPanel.tsx` | `facility.rateHistory` was **display-only** (date, rate, page). |
| Term Loan save | `StatementLoanSetup.tsx` -> `LoanService.create` -> `create_loan_atomic` | Saved straight from Statement Review. Draft rate = the **original** rate, so FinWea's schedule is generated from it. `create_loan_atomic` writes the INITIAL history row (loan rate, start date) when the table exists. |
| OD / CC / DOD save | Review -> `reviewToDraft` -> prefilled Add Loan wizard -> `LoanService.create` -> `create_loan_atomic` | Draft rate = the **current** rate. |
| Rate change | `record_rate_change_atomic` (Stage 3) + `RecordRateChangeDialog` | The reviewed Keep EMI / Keep Tenure workflow (record-only for OD/CC/DOD, lender CSV, flat, balloon); stale check; corrections supersede. |

Statement import only ever **creates** a loan (a statement for an existing
loan is refused as a duplicate), so "the relevant loan workflow" is loan
creation.

## B. Design

### Proposals (pure: `statementImport/statementRateProposals.ts`)

Every extracted `RateChange` becomes a **proposal** on Statement Review, kept
in `StatementReviewState.rates` with a stable key:

- evidence (read-only): extracted date, rate, previous rate, page, original
  line, and *how it was read* (`origin`: rate table row or narration) plus
  every date printed on that line (`datesInText`) - two small additive engine
  fields, no new extraction logic;
- editable: effective date, rate, rate type (Fixed / Floating / not stated),
  and *include* (a misread line can be left out - it is never saved);
- the **original rate** (rate from the loan's start date): the earliest
  change's printed previous rate, or blank - never guessed.

The engine gives no per-row confidence, so none is invented: the review shows
the evidence and these warnings instead.

**Unresolved until the customer acts (blocks saving):**

- no effective date in the statement;
- an *ambiguous* date: the line prints more than one date - the customer must
  pick/confirm one;
- a *conflict*: two included proposals on the same date with different rates;
- an original rate that is not known (no printed previous rate).

**Errors (block):** invalid date or rate; a date on/before the loan's start
date; a rate equal to the rate before it (no change); the original rate does
not match the loan (Term: the rate its schedule starts from; OD: the loan's
rate must be the rate the confirmed history puts in force today).

**Warnings (shown, do not block):** the printed previous rate differs from the
rate the history gives on that date; a duplicate line (same date and rate)
was left out automatically, keeping one; a rate type taken from the
statement's general interest type.

Proposals are always applied in **date order**, whatever the order they were
printed in.

### Saving

Nothing is saved without the final confirmation **and** a separate tick that
the rate changes were checked.

**OD / CC / DOD (record-only)** - atomic with loan creation. The wizard sends
`CreateLoanRequest.statementRateHistory` (original rate + confirmed changes);
`create_loan_atomic` writes, in the same transaction as the loan:
the INITIAL row (the confirmed original rate, from the start date), then each
change (source `STATEMENT_IMPORT`, reference = file and page, notes = the
statement line, previous rate worked out from the timeline). It re-checks
every rule (table exists, valid entries, after the start date, one per date,
real change, loan rate = rate in force today) and refuses - writing nothing -
on any failure. Drawing power and its schedule are never touched.

**Term Loan** - never repriced during extraction or creation. The loan is
created as before (INITIAL = its own rate = the confirmed original rate). The
confirmed changes then appear in a **Statement rate changes** step, clearly
separate from the loan's saved history; each is recorded, in date order,
through the existing `RecordRateChangeDialog` (prefilled: date, rate, type,
source `STATEMENT_IMPORT`, reference, the line as notes), where the customer
chooses Keep EMI / Keep Tenure (or it is record-only for a lender-CSV / flat /
balloon loan), reviews the proposal and confirms. Each is one
`record_rate_change_atomic` transaction with its stale check. A skipped change
is not saved anywhere; the step says so.

`create_loan_atomic` **refuses** statement rate history on a Term Loan, so a
Term Loan can never be created with changes its schedule does not reflect.

### API changes (no schema change)

- Engine: `RateChange.origin`, `RateChange.datesInText` (additive).
- TS: `CreateLoanRequest.statementRateHistory?`, `StatementDraftResult.rateHistory`,
  `RecordRateChangeDialog` `initialInput` prop.
- Rust: `CreateLoanAtomicRequest.statement_rate_history?` (Overdraft only).

### Without migration 054

The review lists the extracted changes as information only (as before), with
no tick and no blocker; nothing is carried into the loan; the Term step is not
shown. Statements without rate changes see no difference at all.

## Limitations

- Instalments already paid / settled before a past change keep their old
  amounts (the Stage 2 rule): recalculation starts at the first unprotected
  instalment, with a warning.
- Term Loan changes not recorded in the follow-up step are lost (no table
  holds pending proposals); they can be recorded by hand later.
- The engine's rate extraction itself is unchanged (no OCR, no new formats).
