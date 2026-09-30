# PDF balance-reconciliation warnings (Import Preview)

When you preview a **PDF** statement, FinWea checks every transaction
against the statement's own running balance. A row that disagrees is
flagged as a **balance mismatch**. CSV and Excel imports are not checked.

## The check

The rows are put in date order (oldest first, whatever order the PDF
uses). Then, for each row that prints a running balance and whose
previous row also prints one:

```
expected balance = previous row's statement balance + amount   (Income)
expected balance = previous row's statement balance - amount   (Expense)
```

The row **matches** when `expected balance` equals the balance printed on
the row, to the paisa. Otherwise it is a mismatch.

Rows that are never checked:

- The first row with a balance (there is no previous balance to compare).
- Rows whose Income/Expense could not be determined. They already show a
  "Transaction type could not be determined" error, and FinWea never
  guesses their direction.
- Transfers, and rows with no printed balance. A row with no balance
  restarts the chain, so the next row is not compared across the gap.
- `B/F` / "Brought Forward" / "Opening Balance" lines. These restate a
  balance rather than move money, so they are not imported as
  transactions. Their balance is used as the starting point.

## What the warning shows

| Figure | Meaning |
| --- | --- |
| **Previous balance** | The running balance printed on the previous row, in date order |
| **+ Income / - Expense** | This row's amount and direction, as FinWea read them |
| **Expected balance** | Previous balance ± amount, i.e. what this row *should* print if its amount and direction were read correctly |
| **Statement balance** | The running balance actually printed on this row |
| **Difference** | Statement balance − expected balance. Never zero on a mismatch |

The headline names the most likely cause:

- **"Direction does not match the statement"**: the balance moved by
  exactly this row's amount, but the opposite way. The row is probably
  Income where it says Expense, or the reverse.
- **"Amount does not match the statement"**: the balance moved by a
  different amount than the row's. The amount may have been misread, a
  row may be missing or merged, or the statement itself may be
  inconsistent.

These are evidence for you to act on. FinWea never changes an amount or
Income/Expense by itself.

Each row is checked only against its own amount and the two printed
balances, so one wrong row never flags its neighbours. Correcting or
skipping a row never changes another row's result.

## Resolving a mismatch

A mismatched row **blocks the import** until you do one of the following
on that row:

1. **Correct it.** Change its Income/Expense and/or its amount in the
   Amount column. The check re-runs immediately. The row turns green
   ("Corrected") only when the corrected values match the statement
   balance. A correction that still doesn't match keeps it blocked.
   Setting a value back to what was previewed removes the correction.
2. **Skip it** ("Skip row"). The row is left out of this import.
   "Include row" undoes this. A skipped row's printed balance is still
   used when checking the next row.

The import service applies the same rule. An import containing an
unresolved mismatch is refused before anything is written.
