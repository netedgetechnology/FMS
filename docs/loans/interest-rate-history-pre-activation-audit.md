# Interest Rate History - Pre-Activation Audit (Stages 1-4)

- **Date:** 2026-11-13
- **Branch:** `feat/accounts-cards-loans`, HEAD `c39409c`. All Stage 1-4 work is uncommitted.
- **Migration 054:** unregistered and unapplied throughout this audit.
- **Related design:** [`docs/import/statement-rate-history.md`](../import/statement-rate-history.md) (Stage 4).

> **ACTIVATED 2026-11-13:** migration 054 is registered and applied to the live database. See [section 8](#8-activation-2026-11-13).

## Overall result after the fix round (2026-11-13): **PASS WITH CONDITIONS**

B1, H1, M1 and M2 are fixed and covered by synthetic tests, and every suite passes (see
[section 6](#6-fix-round-2026-11-13)). The conditions:
1. Your explicit approval of activation.
2. The activation, backup and recovery checklist (section 4), including the M4 test updates.
3. The desktop verification items in 2.5, which unit tests cannot replace. In particular, the H1 close guard and the
   M1 save have **not** been run in the desktop app yet.

The original audit result follows, unchanged, for the record.

## Original result: **FAIL - not ready for activation**

There is one **Blocker (B1)**. "Keep the EMI" can propose an outdated EMI after an earlier Keep Tenure change, and the
wrong schedule could then be saved. Two further findings must also be fixed before activation: **H1** (pending statement rate
changes can be lost silently) and **M1** (an OD statement with every rate change left out cannot be saved).

Everything else audited passes:
- the history rules;
- the write paths;
- stale-write protection;
- protected instalments;
- the record-only restrictions;
- the migration SQL and its compatibility.

Once B1, H1 and M1 are fixed and re-verified, the expected result is **PASS WITH CONDITIONS**. The conditions are the
activation checklist below and the remaining desktop verification.

> No desktop or production verification is claimed from unit tests. The isolated desktop runs (Stages 3.2 and 3.3) are
> listed separately, with what they did **not** cover.

---

## 1. Findings

| ID | Severity | Area | Summary | Before activation? |
|---|---|---|---|---|
| B1 | **Blocker** | Schedule | Keep EMI keeps the most common EMI across *all* instalments, paid ones included | **Required** (a calculation fix, which needs your approval) |
| H1 | **High** | Statement | Statement Term Loan changes that are skipped, or lost by closing the dialog, are not persisted | **Required** (minimum: no silent loss) |
| M1 | Medium | Statement | OD/CC/DOD statement with every proposal left out: the create is refused | **Required** |
| M2 | Medium | Migration | DB enforces uniqueness on (loan, date, **rate**), not one live rate per date | Your decision (schema) |
| M3 | Medium | Operations | The automatic backup runs *after* migrations at startup, so it is no pre-054 backup | Procedure (checklist) |
| M4 | Medium | Tests | Registering 054 breaks three tests that assume it is absent | Part of activation |
| L1 | Low | Schedule | Rust re-checks OD / lender CSV repricing, but not flat-rate or balloon loans | Recommended |
| L2 | Low | Integrity | Edit forms show the stored rate snapshot, which can lag an upcoming date | Recommended |
| L3 | Low | Integrity | `LoanRepository.create` (non-atomic, no history) is dead code | Recommended |
| L4 | Low | Statement | Statement proposals cannot be edited in the OD wizard, only on Statement Review | Optional |
| L5 | Low | Statement | A Term statement with every change left out still asks for the rate tick ("0 changes") | Optional |
| L6 | Low | Integrity | History rows of a soft-deleted loan are kept (by design) | None |
| L7 | Low | Operations | A post-054 backup restored into a build without 054 registered is treated as "available" | Note only |

### B1 - Keep EMI can keep an outdated EMI (Blocker)

- **Where:** `apps/desktop/src/modules/loans/setup/rateChangeProposal.ts`. The code is
  `const currentEmi = mostCommon(nonFinal)`, where `nonFinal` is every instalment except the last, *including paid ones*.
- **What happens:** after a Keep Tenure change late in a loan, the paid instalments at the old EMI outnumber the future
  ones at the new EMI. A later "Keep the EMI" change then keeps the **old** EMI. So the EMI goes down, and the tenure grows,
  even though the customer chose to keep it.
- **Evidence:** test `setup/rateChangeProposal.preActivationAudit.test.ts`, which uses a synthetic 24-month loan with 16 paid
  instalments.
  - The EMI is 11,074.78 at 10%.
  - A Keep Tenure change to 14% from instalment 17 sets the remaining EMI to 11,238.55.
  - A Keep EMI change to 15% then proposes **11,074.78**.
  - The test is `it.fails`: it passes while the defect exists. Change it to `it` once the defect is fixed.
- **Why it is reachable:** the Rust command stores `emiAmount` and the rows as sent; it does not re-derive the EMI. The
  review shows "EMI 11,074.78 -> 11,074.78", which looks correct. It is most likely in exactly the Stage 4 statement
  follow-up: several changes recorded in a row on a loan with many paid instalments.
- **Fix (needs approval, because it is a calculation change):** take the regular EMI from the instalments being recalculated
  (the most common EMI among the future, non-final rows, or the first recalculated row). Then flip the audit test to `it`,
  add a Keep EMI → Keep Tenure → Keep EMI chain test, and re-run the Stage 2 "no-change equals the generator" regression.

### H1 - Pending statement Term Loan changes can be lost (High)

- **Where:** `components/rates/StatementRateChangesStep.tsx` and `components/AddLoanDialog.tsx`.
- **What happens:** after a statement Term Loan is created at its original rate, its confirmed changes live only in React
  state. They are lost by:
  - "Do not record";
  - "Finish without the rest";
  - closing the dialog by its X, Escape or a click outside (`handleOpenChange` closes it unconditionally).

  The only guard is an inline warning. The loan then shows the **original** rate as current, and its future schedule stays at
  the old rate, although the statement shows later rates.
- **Required before activation (no schema change):**
  1. While changes are pending, closing the dialog asks for confirmation and lists exactly what will not be recorded.
     This covers the X button, Escape, a click outside and "Finish".
  2. "Do not record" needs a confirmation per change.
  3. After the step closes, a persistent toast or notice lists any changes that were not recorded.
- **Recommended (separate approval, new migration 055):** persist the pending proposals in a
  `loan_rate_change_proposals` table with:
  - the loan, date, rate and type;
  - the evidence (file, page and statement line);
  - a status: PENDING, RECORDED or DISMISSED, with the reason.

  Show a **"Rate changes from the statement - pending"** banner on the loan's details and a marker in the loan list until
  each one is recorded or dismissed. This is the only way to make sure no pending change is overlooked across sessions.
  Writing them into the loan's free-text Notes is *not* recommended: it is unstructured and could not be resolved later.

### M1 - OD/CC/DOD statement with every proposal left out cannot be saved (Medium)

- **Where:** `components/setup/AddLoanWizard.tsx`. Its `showRates` uses `hasRateProposals(...)`, which counts *all*
  proposals, including ones left out.
- **What happens:** with every proposal left out, the wizard still sends a `statementRateHistory` with zero changes.
  `create_loan_atomic` then refuses it ("No confirmed rate change was sent."). Nothing is written, but a valid statement can no
  longer be saved.
- **Fix:** attach the history, and require the rate tick, only when at least one change is included. Add a test.

### M2 - One live rate per date is enforced only in application code (Medium, your decision)

- **What the DB does:** `ux_loan_interest_rate_history_live` is unique on `(loan_id, effective_from, rate) WHERE
  superseded_at IS NULL`. So the database blocks an exact duplicate, but not two *different* live rates on the same date.
- **What the app does:** both writers refuse that case. `rate_change.rs` refuses "Another rate ... is already recorded from
  that date", and `create_loan_atomic`'s statement check requires one change per date in date order.
- **Option:** before first activation, the index could be tightened to `(loan_id, effective_from) WHERE superseded_at IS NULL`.
  That is the cheapest moment for a schema change, and every writer already supersedes before it inserts. It is a change to
  054 itself, so it is your decision. Not required.

### M3 - The automatic backup is not a pre-054 backup (Medium, procedure)

`main.tsx` runs `initializeDatabase()`, including `MigrationEngine.migrate()`, *before* the deferred daily backup. On
the first start with 054 registered, the migration is applied before any automatic backup is taken. Also, a dev app that is
running applies a newly registered migration within seconds (see the earlier 052 incident). So you need a **manual backup
with the app closed** (see the checklist).

### M4 - Tests to update when 054 is registered (Medium, part of activation)

| Test | Why it breaks |
|---|---|
| `core/database/migrations/053_dropline_drawing_power_schedule.test.ts:26` | Asserts 053 is the last migration |
| `core/database/migrations/054_loan_interest_rate_history.test.ts:41-44` | Asserts 054 is NOT registered |
| `modules/loans/services/LoanSetup.e2e.test.ts` - "without migration 054 a loan is created exactly as before" | Builds its DB from the registry, so the table will exist |

Other suites that build from the registry will then include the (empty) table, so run the full suite after registering.

### Low findings

- **L1:** `rate_change.rs` refuses a schedule replacement for an Overdraft and a lender-CSV loan, but relies on the
  TypeScript proposal engine to refuse **flat-rate** and **balloon** loans. Add the same two checks to the Rust command
  (it would need to select `interest_type` and `balloon_amount`), as defence in depth.
- **L2:** `loans.interest_rate` is a snapshot as at the last save. After an upcoming date passes, it lags until the next
  save. Every calculation and the list, details and history views use the derived current rate (`currentLoanRate`), and the
  stale check compares like with like. Only the read-only rate field in `EditLoanDialog` / `OverdraftForm` shows the
  snapshot. Show the derived rate there, or label it "as at last save".
- **L3:** `LoanRepository.create()` (a plain JS INSERT with no INITIAL row) has no callers. Remove it so it can never become a
  bypass.
- **L4:** if the OD wizard's start date or rate is changed so that a proposal becomes invalid, the confirmation shows the
  problem, but the proposals can only be corrected by restarting the statement import.
- **L5:** a Term statement where every change is left out still shows the rate confirmation with "0 rate change(s)".
- **L6:** loans are soft-deleted (`deleted_at`), so the foreign key never blocks deletion. History rows stay as an audit
  trail and are only read by loan id.
- **L7:** availability is "the table exists". A post-054 backup restored into an older build would show the feature.

---

## 2. Audit evidence by area

### 2.1 Rate-history integrity - PASS (apart from L2/L3)

**Writers of `loans.interest_rate` (production code):**

| Writer | Path | Guard |
|---|---|---|
| Create (term / OD / statement OD) | `create_loan_atomic` (`loan_create.rs`) | New loan only. With statement history, Rust requires the loan's rate = the rate in force today |
| Edit (term) | `LoanService.update` → `LoanRepository.update` | `directRateEditRefusal` runs before both repository writers (source-scan test) |
| Edit (OD) | `overdraft_update.rs` | Refuses a changed rate before its UPDATE |
| Rate change / correction | `rate_change.rs` | Sets the rate in force today, inside the same transaction |

- The Stage 3.1 source-scan test asserts that exactly three production files contain `interest_rate = ?`.
- No module outside `loans` reads the loan's interest rate.

**Writers of `loan_interest_rate_history`:**
- `create_loan_atomic`: the INITIAL row for new loans, and the statement OD rows;
- `rate_change.rs`: the INITIAL baseline, supersession and the new entry.

The TypeScript repository is read-only. **No path writes history automatically for an existing loan.**

**One current-rate rule** (`setup/interestRateHistory.ts`, mirrored in Rust): the latest live entry on or before the
date. An entry after today is upcoming and is never written to `loans.interest_rate` before its date. It is used by the
list, the details, the history view, `oldRate` (Stage 3.3) and the statement timeline.

**Stale writes:** `record_rate_change_atomic` refuses unless the stored rate, the live history ids and every schedule row are
exactly as prepared. The Stage 3.3 desktop check confirmed this with a second writer. Corrections supersede the original
(never an edit) and record a reason. Before any write, the command also refuses:
- a history with only superseded entries (no safe baseline);
- a second rate on an existing date;
- a date before the start.

### 2.2 Schedule safety - PASS except B1 (and L1)

- **Keep EMI / Keep Tenure engine (Stage 2):**
  - daily accrual uses the rate in force on each day;
  - a mid-period change is split by days (MONTHLY_RATE uses day weights);
  - the final instalment absorbs the rounding difference.
- **Regression:** an engine run with no change equals `EMIScheduleGenerator` exactly, across six configurations.
- **Guards:**
  - an EMI that does not cover the interest is refused;
  - at most 600 instalments can be added;
  - an unpaid broken-period instalment is refused;
  - partly paid instalments are refused as ambiguous;
  - the protected instalments (paid, transaction-linked, payment recorded, settled before FinWea) must be a leading prefix,
    and the principal chain is re-verified.
- **Rust** re-checks the stale state and the protected rows, requires the revised schedule to add up, and moves tenure and
  outstanding interest accordingly.
- **Record-only cases:**
  - lender CSV, flat-rate and balloon loans in TypeScript (Rust: lender CSV only - L1);
  - a Term Loan with no schedule;
  - **OD/CC/DOD, enforced in both TypeScript and Rust.**
- Drawing power and its schedule are never touched by any rate path. This is asserted by Stage 4's Rust test.
- **Risk to paid or linked instalments:** none found. They are never replaced, and recalculation starts at the first
  unprotected instalment, with a warning.

### 2.3 Statement integration - PASS except H1 and M1

- Proposal correction, leaving out, duplicates (left out automatically, with a note) and conflicts (both rows blocked)
  are covered by 21 unit tests.
- Missing or ambiguous dates and an unknown original rate stay unresolved; nothing is invented.
- Both save paths need the separate rate tick.
- The OD save is atomic, with rollback proven by Rust tests: 12 rule violations write nothing, and a failing third change
  rolls back the loan and every rate row.
- A Term Loan is never created with changes. Rust refuses that outright.
- **The outdated note has been corrected in this audit.** `statementToDraft.ts` no longer says "FinWea's schedule uses one rate".
  It now says the loan starts at the original rate and how the statement's changes are recorded. A test was added.

### 2.4 Migration 054 - PASS (M2 optional)

- **SQL:** one table plus two indexes, with `CREATE ... IF NOT EXISTS`.
  - Columns: `id` PK, `loan_id`, `effective_from`, `rate`, `previous_rate`, `rate_type`, `source`, `reference`,
    `document_id`, `notes`, `applied_from_instalment`, `created_at`, `superseded_by`, `superseded_at`,
    `correction_reason`.
  - CHECKs: the date shape (GLOB), rate and previous rate between 0 and 100, rate type and source enums,
    instalment ≥ 1, `superseded_by` and `superseded_at` set together, not self-superseding, and a reason required once
    superseded.
- **Foreign keys:**
  - `loans(id)`: safe with soft delete;
  - `documents(id)`: migration 008, so the table exists on every DB;
  - self `superseded_by`: a correction uses `PRAGMA defer_foreign_keys` inside its transaction.
- **Indexes:** the partial unique index on live rows (see M2) and `(loan_id, effective_from)` for lookups.
- **Framework:** `MigrationEngine` splits on `;` (054 has exactly three statements and no `;` inside one). It runs the
  statements outside a transaction and records `schema_version` 54 only after all of them succeed. A crash part-way through is
  therefore safe to re-run.
- **Fresh databases:** the in-memory test builds migrations 1-53 with foreign keys on, then 054.
- **Existing databases at 053:** additive only. The tests show that no existing table or index changes, existing loans are
  byte-identical, and the table is empty (0 rows). It can be applied twice.
- **Behaviour after activation:**
  - **Existing loans:** no history rows. The history view says "No rate history is recorded", and their stored rate becomes
    the INITIAL row only together with their first explicit change. Their schedules are unchanged.
  - **New loans:** they get an INITIAL row as they are created.

### 2.5 Tests and desktop readiness

Actual results (2026-11-13; run from the paths shown):

| Command | Result |
|---|---|
| `apps/desktop$ npx vitest run` | **3,301 passed, 1 expected fail** (B1 `it.fails`), 213 files |
| ↳ rate-history files only (migration 054, engine, current rate, service, rates UI, statement proposals, e2e) | 289 passed + 1 expected fail, 15 files |
| `apps/desktop$ npx tsc --noEmit -p .` | clean |
| `packages/import-engine$ npx vitest run` | **437 passed, 1 skipped**, 25 files |
| `apps/desktop/src-tauri$ cargo test --no-default-features` | **148 passed**, 0 failed (`rate_change` 23; `loan_create` 41, incl. 6 Stage 4) |

**Desktop verification already done** (isolated `com.finwea.ratehistorytest`, synthetic data, Stages 3.2 and 3.3).
**Caveat:** 054's SQL was executed in-page into that test DB, **not** applied by `MigrationEngine`.
- the details view;
- the current and upcoming rates;
- Record and Correct for Term Loans and OD/CC/DOD;
- Keep EMI and Keep Tenure reviews;
- record-only behaviour;
- validation, cancel and confirmation;
- consecutive changes in one window;
- stale refusal and its retry;
- the baseline guidance;
- edits blocked;
- the table layout.

**Still needs desktop verification after activation:**
1. 054 applied by `MigrationEngine` on startup, against a **copy** (a dry run), then for real. Check the restart, and that
   the data persists.
2. A new Term Loan and a new OD created through the **wizard UI**, each getting its INITIAL row. Stage 3.2 created them
   through the service in the page.
3. All of Stage 4 in the UI, from a synthetic PDF:
   - proposal editing and the ambiguous-date buttons;
   - the OD wizard confirmation and save;
   - the Term follow-up, including the H1 close behaviour.
4. The B1 fix: Keep Tenure, then Keep EMI, on a loan with many paid instalments.
5. The M1 fix: an OD statement with every change left out.
6. A backup → restore round trip with the new table.
7. An upcoming rate becoming current after its date (shown correctly; the snapshot catches up on the next save, L2).

**Synthetic tests still missing (add with the fixes):**
- the Keep EMI chain (B1);
- the OD statement with every change left out (M1);
- the follow-up close and confirm behaviour (H1);
- Rust refusal of a flat-rate or balloon schedule replacement (L1);
- a DOD create with statement rates (asserting the drawing-power schedule rows are unchanged);
- a `MigrationEngine` class run (not just the same split logic) over 1-54 in `node:sqlite`.

---

## 3. Required before activation

> **Status (fix round, section 6):** items 1-4 are done, with H1 at its minimum (055 not introduced). Item 5 (L1-L3) is
> still open. In item 6 the suites have been re-run; the desktop verification is still to do. In 2.5's list of missing
> synthetic tests, the B1, M1 and H1 tests now exist; the L1, DOD and `MigrationEngine`-class tests are still missing.

1. **B1:** fix the Keep EMI source of the EMI (needs your approval: calculation change). Flip the audit test and add the chain tests.
2. **H1:** no silent loss of pending statement changes (close guard, per-change confirmation, summary notice). Decide on the
   persistent pending table (migration 055).
3. **M1:** send statement history only when at least one change is included.
4. **M2:** decide whether to tighten the live unique index before first activation.
5. Optional: L1-L3.
6. Re-run every suite and repeat the desktop verification items 1-7 above in the isolated app.

---

## 4. Activation, backup and recovery checklist

Do not start until section 3 is done and you have **explicitly approved** activation.

### A. Before
- [ ] FinWea is **closed**: no `financeos.exe`, and no `pnpm tauri dev` running (it applies new migrations immediately).
- [ ] Note the live DB path: `financeos.db` in the app's data directory for identifier `com.financeos.app` (with
      `-wal` / `-shm`).
- [ ] **Manual backup** (the automatic one runs after migrations - M3), with the app closed: copy `financeos.db`,
      `financeos.db-wal` and `financeos.db-shm` together into a dated folder. Record each file's SHA-256.
- [ ] Check the backup copy read-only: `PRAGMA integrity_check` = `ok`, and `SELECT MAX(version) FROM schema_version` = 53.
- [ ] Record read-only **fingerprints** from the live DB:
  - `SELECT COUNT(*), total(interest_rate), total(emi_amount), total(outstanding_principal), total(outstanding_interest) FROM loans`;
  - `SELECT COUNT(*), total(principal_amount), total(interest_amount), total(total_amount) FROM loan_payment_schedule`;
  - SHA-256 of `SELECT * FROM loans ORDER BY id` and of `SELECT * FROM loan_payment_schedule ORDER BY id`, both exported to text.
- [ ] Optional dry run: copy the backup into a separate isolated identifier, and start a build with 054 registered against
      that copy only. Then run the checks in C.

### B. Activate
- [ ] With the app closed, add `LoanInterestRateHistoryMigration` to `apps/desktop/src/core/database/migrations/registry.ts`.
      That is the only production change.
- [ ] Update the three tests listed in M4. Run every suite: Vitest, `tsc`, import-engine and `cargo test`.
- [ ] Start FinWea once.

### C. Verify (read-only)
- [ ] `SELECT MAX(version) FROM schema_version` = 54.
- [ ] `SELECT name FROM sqlite_master WHERE name LIKE '%interest_rate_history%'` lists the table and both indexes.
- [ ] `SELECT COUNT(*) FROM loan_interest_rate_history` = 0.
- [ ] `PRAGMA integrity_check` = `ok`, and `PRAGMA foreign_key_check` returns nothing.
- [ ] The loan and schedule fingerprints are **identical** to step A.
- [ ] In the app, an existing loan's details show "No rate history is recorded"; its list rate is unchanged; Record rate
      change is enabled.

### D. Recovery
- **The migration failed, or verification failed, before any rate was recorded:**
  1. Close the app.
  2. Revert the `registry.ts` change. Otherwise 054 re-applies on the next start.
  3. Restore all three backup files, deleting any newer `-wal` / `-shm` first. Then re-check `PRAGMA integrity_check`.
  - Only with your explicit approval, and only if the table is still empty, the minimal alternative is
    `DROP TABLE loan_interest_rate_history; DELETE FROM schema_version WHERE version = 54;` (indexes go with the table).
- **After rate changes were recorded:** do **not** drop the table. Repriced schedules would stay without their history.
  Either keep 054 and correct entries through Correct (which supersedes), or restore the backup and accept losing everything
  entered since it.
- Keep the backup until the post-activation desktop checks in 2.5 have passed.

---

## 5. Changes made by this audit

- `docs/loans/interest-rate-history-pre-activation-audit.md` (this document).
- `apps/desktop/src/modules/loans/setup/rateChangeProposal.preActivationAudit.test.ts`: the B1 evidence (`it.fails`).
- `apps/desktop/src/modules/loans/statementImport/statementToDraft.ts`: the corrected statement-import note (text only),
  and its test in `statementRateProposals.test.ts`.

No financial calculation, accounting behaviour, schema or migration registration was changed.

---

## 6. Fix round (2026-11-13)

Approved fixes for B1, H1 (minimum, no migration 055), M1 and M2. Migration 054 stays unregistered and unapplied; no
database was opened, no app was started, and only synthetic data was used.

| ID | Status | What changed |
|---|---|---|
| B1 | **Fixed** | Keep EMI uses the EMI in force at the recalculation point |
| H1 | **Fixed (minimum)** | Close guard, per-change confirmation, notice afterwards; persistence (055) not introduced |
| M1 | **Fixed** | An OD statement with every change left out saves as a typed-in loan |
| M2 | **Fixed** | 054's live unique index is now one rate per loan and date |
| M3, M4 | Open | Part of activation (checklist) |
| L1-L4, L6, L7 | Open | Unchanged |
| L5 | Partly | The "all left out" confirmation now says plainly that nothing is recorded; the explicit tick is kept on purpose |

### B1 - Keep EMI
- `setup/rateChangeProposal.ts`: `mostCommon(nonFinal)` over every instalment is replaced by `emiInForce(rows, startIndex)`:
  the first recalculated instalment's EMI. When only the final instalment (which carries the rounding adjustment) is
  left, the regular instalment just before it gives the EMI.
- Nothing else in the engine changed. Protection of paid, partly paid, linked, payment-recorded and settled instalments is
  untouched, and a loan with no earlier change gets exactly the same EMI as before (tested).
- `rateChangeProposal.preActivationAudit.test.ts` (now 10 tests, the `it.fails` flipped to `it`):
  - Keep Tenure then Keep EMI keeps 11,238.55, not 11,074.78, at a higher and a lower rate;
  - Keep Tenure, Keep EMI, Keep Tenure in a row, each from the schedule the previous one saved;
  - the review's EMI, final adjustment and remaining instalments match the saved schedule, the last row closes at 0, and
    the principal repaid equals the starting principal;
  - paid rows are never in the proposal; settled-before-FinWea rows protect the same; a partly paid row still refuses;
  - only the final instalment left; and a loan with no earlier change (unchanged result).

### H1 - Pending statement Term Loan changes (minimum fix)
- `components/rates/StatementRateChangesStep.tsx`:
  - "Do not record" now only asks. The change stays pending until **Leave it unrecorded** is pressed, per change.
  - "Finish without the rest" / "Done" with anything unrecorded opens a confirmation listing every change (rate, date,
    statement reference) with **Keep recording** or **Finish and leave them unrecorded**.
  - Cancelling a Record Rate Change review leaves the change pending, never skipped.
  - The step reports its unrecorded changes to the dialog.
- `components/AddLoanDialog.tsx`: while the follow-up is open, a close by X, Escape, outside click or Cancel is refused if
  anything is unrecorded. It shows the same listed confirmation instead (**Close and leave them unrecorded**). The list
  starts as every confirmed change, so a close before the step has loaded is guarded too. When the follow-up ends with
  changes left, a warning toast that stays until dismissed names each one and says where to record it later.
- `statementImport/statementRateProposals.ts`: `unrecordedChanges`, `unrecordedChangeText`, `unrecordedNotice`.
- Before the loan is created nothing is saved, so Back and Cancel in Statement Review and the wizard are unchanged.
- Remaining risk: unrecorded changes are still **not persisted**. Once the customer confirms leaving them, only the
  toast says so. Persisting them needs the recommended migration 055, which was not introduced.

### M1 - OD statement with every change left out
- `overdraftStatementRateHistoryFor` returns `null` when no change is included, and `AddLoanWizard` then sends no
  `statementRateHistory`. So the loan is created exactly as a typed-in one: at its own rate, with its INITIAL row, and no
  invented entry. The existing Rust test `an_overdraft_without_statement_rates_is_created_exactly_as_before` covers that
  path.
- With one change or more included, the request is unchanged, and every validation still applies (a mismatch still
  refuses). Rust still refuses an empty `changes` list if one is ever sent.
- `StatementRateConfirmation` with every change left out says that none is recorded and gives the loan's own rate. It still
  asks for an explicit tick ("Save the loan without them").

### M2 - Migration 054 constraint
- `ux_loan_interest_rate_history_live` is now `UNIQUE (loan_id, effective_from) WHERE superseded_at IS NULL`. Still three
  statements, all `IF NOT EXISTS`, and still additive only.
- Corrections are unaffected. `rate_change.rs` already supersedes the old row before it inserts the replacement, with
  `PRAGMA defer_foreign_keys` for `superseded_by`. The existing Rust same-date correction tests (`rate-2` → `rate-2b`,
  and the INITIAL correction) pass under the new index.
- New tests:
  - `054_loan_interest_rate_history.test.ts`: a different rate on a live date is refused; the index shape is checked; valid
    history across dates and loans is accepted; a same-date correction succeeds, while inserting first is refused and rolls
    back; corrections to another date and corrections of corrections work, with superseded rows sharing a date; a re-run
    keeps the rows and the index, and `integrity_check` is `ok`. Two older fixtures that relied on two live rows on one
    date now use separate dates.
  - Rust `a_different_live_rate_on_a_recorded_date_is_refused_by_the_database`.
- SQLite: partial indexes need SQLite 3.8.0 or later; `node:sqlite` and the bundled sqlx SQLite both pass.
- **Note:** the isolated test DB `com.finwea.ratehistorytest` still has the **old** index, from the in-page run in Stage
  3.2. `IF NOT EXISTS` would not replace it there. Desktop verification item 1 must use a fresh copy migrated by
  `MigrationEngine`, never that DB, as the evidence for 054.

### Test results (actual runs, 2026-11-13, after the fixes)

| Command | Result |
|---|---|
| `apps/desktop$ npx vitest run` | **3,333 passed**, 0 failed, 215 files (no expected failures remain) |
| `apps/desktop$ npx tsc --noEmit -p .` | clean (exit 0) |
| `packages/import-engine$ npx vitest run` | **437 passed, 1 skipped**, 24 files passed + 1 skipped |
| `apps/desktop/src-tauri$ cargo test --no-default-features` | **149 passed**, 0 failed |

No regression needed fixing outside the tests above.

### Files changed in this round
- `apps/desktop/src/modules/loans/setup/rateChangeProposal.ts`: B1.
- `apps/desktop/src/modules/loans/setup/rateChangeProposal.preActivationAudit.test.ts`: B1 tests.
- `apps/desktop/src/modules/loans/components/rates/StatementRateChangesStep.tsx`: H1.
- `apps/desktop/src/modules/loans/components/rates/StatementRateChangesStep.test.ts` (new): H1 tests.
- `apps/desktop/src/modules/loans/components/AddLoanDialog.tsx`: H1 close guard and notice.
- `apps/desktop/src/modules/loans/statementImport/statementRateProposals.ts`: H1 helpers, M1 `overdraftStatementRateHistoryFor`.
- `apps/desktop/src/modules/loans/statementImport/statementRateProposals.preActivation.test.ts` (new): M1 and H1 tests.
- `apps/desktop/src/modules/loans/components/setup/AddLoanWizard.tsx`: M1.
- `apps/desktop/src/modules/loans/components/setup/StatementRateProposals.tsx`: M1 confirmation text.
- `apps/desktop/src/modules/loans/components/setup/StatementRateProposals.test.ts`: M1 tests.
- `apps/desktop/src/core/database/migrations/054_loan_interest_rate_history.ts`: M2 index.
- `apps/desktop/src/core/database/migrations/054_loan_interest_rate_history.test.ts`: M2 tests.
- `apps/desktop/src-tauri/src/loan_create.rs`: one M2 test (tests module only).
- This document.

`registry.ts` is unchanged (no 054 entry).

---

## 7. Isolated desktop verification (2026-11-13)

A source copy of the working tree (git-listed files only; no statements, spreadsheets or databases) was run with 054
registered **in that copy only**, under throwaway identities `com.finwea.v054base`, `com.finwea.v054upgrade` and
`com.finwea.v054fresh` (each with its own database and WebView2 profile). All data was synthetic, including two generated
statement PDFs marked "SYNTHETIC TEST DOCUMENT". The old `com.finwea.ratehistorytest` DB was not used. The identities and
the copy were deleted afterwards.

| Area | Result | Evidence |
|---|---|---|
| Migration 054, synthetic copy at 053 | **PASS** | The app's own startup moved schema 53 → 54 and created the table and both indexes, with the unique index on `(loan_id, effective_from) WHERE superseded_at IS NULL`. 0 history rows. Loans, the 84 schedule rows, accounts and transactions were byte-identical (SHA-256) to the 053 copy. `integrity_check` ok, no foreign-key problems. |
| Migration 054, fresh DB | **PASS** | Migrations 1-54 applied at startup; the table was empty. Loans created afterwards through the create service got one INITIAL row each. |
| M2 constraint and corrections | **PASS** | The app refused a second rate on a recorded date. A direct insert (different or same rate) was refused by the DB (`UNIQUE constraint failed`). A same-date correction (15% → 15.5%) superseded the old row with its reason and left one live row, with foreign-key and integrity checks clean. |
| B1 | **PASS** | On a loan with 16 settled instalments: Keep Tenure 14% showed 11,074.78 → 11,238.55 (8 → 8 left). Keep EMI 15% then showed 11,238.55 → 11,238.55 (4 → 5 left). The saved schedule matched the review: EMI 11,238.55, tenure 25, final #25 = 95.03 closing at 0, principal repaid from #21 = the starting principal 43,673.05. Rows 1-16 were unchanged. |
| H1 | **PASS** | X, Escape and an outside click each showed the listed confirmation instead of closing; "Keep recording" returned. "Do not record" asked first, and its Cancel kept the change pending. Cancelling a Record review kept it pending. Finish and Done (with a confirmed-skipped change) asked first. Confirming, by Finish or by X then "Close and leave them unrecorded", showed a warning naming each change; it was still visible after 30 s. The DB held only the recorded change. |
| M1 | **PASS** | An OD statement with both changes left out showed "None is recorded ... its own rate of 12%". It saved at 12% with exactly one INITIAL row (12% from the start date, no reference): nothing was invented. |

**Not verified in this pass:**
- the real backup and activation procedure (section 4);
- a backup → restore round trip with the new table;
- an upcoming rate becoming current after its date (L2);
- DOD/CC statement imports;
- the statement PDF's disbursal table, which was not read from the generated PDF, so the gross disbursed amount and date
  were entered on the review (a fixture limitation, not a product defect).

No product code was changed during this verification.

---

## 8. Activation (2026-11-13)

Activated with your explicit authorization, in the order of section 4.

**1. Backup (before anything else).** FinWea was confirmed closed (no process) and nothing is installed: the app is
this repo's dev build, identifier `com.financeos.app`, database `sqlite:financeos.db`. The live DB was a single,
checkpointed file at schema 53 (integrity `ok`, no foreign-key problems).
- Backup: a dated copy of the live DB in a separate pre-migration backup folder beside it (exact location and file name
  kept outside the repository).
- Its SHA-256 was recorded; it was identical to the live file's, and unchanged at the end of activation.
- Verified: `integrity_check` ok, `foreign_key_check` empty, schema 53. Row counts and per-table fingerprints were recorded
  for every table.
- **Keep this backup.**

**2. Registration.** `registry.ts` now ends with `LoanInterestRateHistoryMigration` (CRLF kept). The three M4 tests
were updated:
- the 053 test now checks that 053 is registered once and that 054 follows it;
- the 054 test now checks that 054 is registered once, as the last migration, plus a full-registry build that has the
  table, the tightened index and no rows;
- `LoanSetup.e2e.test.ts` builds its database at 053, as an existing database is, so the pre-054 tests stay meaningful.
  The test "without migration 054..." was renamed "on a database not yet at 054...".

The migration design and all calculations are unchanged.

**3. Tests before starting.**

| Suite | Result |
|---|---|
| desktop Vitest | 3,334 passed, 215 files |
| `tsc --noEmit` | clean |
| import-engine | 437 passed, 1 skipped |
| `cargo test --no-default-features` | 149 passed |

**4. Applied by the app's own startup** (`pnpm tauri dev`, normal identity). `schema_version` has 54 recorded exactly once
(on 2026-11-13) and MAX = 54. The table and both indexes exist, the unique index being `(loan_id, effective_from)
WHERE superseded_at IS NULL`. `integrity_check` is ok and `foreign_key_check` is empty.
- **Existing data:** all existing tables were byte-identical to the backup (row counts and content hashes), including
  loans, schedules, accounts and transactions, and the schema of every other object was unchanged. 0 history rows: no
  existing loan was given history.
- **Synthetic loan:** "SYN 054 activation test (synthetic - safe to delete)", a 9.75% fixed, 12-month Term Loan, created
  through `LoanService.create`, the same path as the wizard save. It got exactly **one** history row: INITIAL, 9.75% from
  its start date 2026-11-13. It also added its 12 schedule rows, its liability account and one lender record ("SYN Test
  Lender"); the transaction count is unchanged.
- **Afterwards:** compared row by row with the restored backup, every original row in every table is unchanged. Integrity
  ok, no foreign-key problems.

**5. Restore test.** The backup was restored to a separate scratch folder (the live DB was never overwritten). The
restored file has the same SHA-256, `integrity_check` ok, schema 53, no rate-history table, and every table fingerprint
equals the pre-migration one.

**Remaining:**
- The synthetic test loan remains in the live DB, by design. Delete it from the Loans page when you want; it has no
  transactions.
- Still not verified in the live app:
  - the Stage 4 statement screens with a real statement;
  - an upcoming rate becoming current after its date (L2).
- Low findings L1-L4, L6 and L7 are open.
- Recovery, if ever needed, is in section 4D: close the app, revert `registry.ts`, and restore the backup above, removing
  any newer `-wal`/`-shm`.
