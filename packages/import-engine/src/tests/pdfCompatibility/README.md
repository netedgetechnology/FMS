# PDF layout compatibility corpus

`pdfCompatibility.test.ts` runs every fixture here through the production
PDF import pipeline from text extraction onward:

```
pdf-parse text -> parsePdfText (structural parse) -> detectCsvColumns (mapping)
  -> normalizeCsvRows / moneyNormalizer (canonical amount + direction)
  -> validateCandidates -> reconcileBalanceChain
```

Adding a layout never requires touching importer code or the test file.

## Adding a layout

1. Extract the statement text exactly as the app sees it:

   ```
   cd packages/import-engine
   node scripts/extract-pdf-text.mjs path/to/statement.pdf src/tests/pdfCompatibility/fixtures/<layout-id>.txt
   ```

2. **Anonymise it.** Keep the structure (line breaks, tabs, column order,
   page headers and footers, wrapped narration, placeholders such as `-`
   or `0.00`), but replace names, account numbers, references and
   narration. Keep a handful of rows and keep the running balances
   arithmetically consistent.
3. Write `fixtures/<layout-id>.expected.json` **by hand, from the
   statement**. Never copy the parser's output into it:

   ```json
   {
     "source": "What this layout is and what makes it distinctive",
     "importType": "BANK_PDF",
     "features": ["debit-credit", "zero-filled-unused-cell"],
     "expect": {
       "validationErrors": 0,
       "balanceReconciliation": { "checkedRows": 4, "mismatches": 0 },
       "rows": [
         { "date": "2026-01-05", "type": "expense", "amount": 450, "balance": 1550,
           "reference": "optional", "description": "optional" }
       ]
     }
   }
   ```

   `rows` are in document order. `type` is `income`, `expense`, `transfer`
   or `null` (direction genuinely unknowable from the document). `amount`
   is always positive. `checkedRows` is the number of rows with a
   predecessor that also prints a balance.
4. Run `npx vitest run src/tests/pdfCompatibility`.

If a fixture fails, fix the **general** rule in `parser/pdfParser.ts` or
`normalizer/moneyNormalizer.ts`. Never branch on a bank name, file name or
statement-specific string.

## Checking real PDFs without committing them

`realPdfCorpus.test.ts` is opt-in. Point it at a local folder of real
statements:

```
FINWEA_PDF_CORPUS="C:/path/to/statements" npx vitest run realPdfCorpus
```

A statement passes when every row validates and every row with a running
balance reconciles with the previous one. An optional
`<name>.expected.json` next to `<name>.pdf` can pin the statement's own
summary totals: `{ "rows": 88, "income": 1882822.16, "expense": 1884633.65 }`.

## Layouts covered by fixtures

| Fixture | Representation |
| --- | --- |
| `withdrawal-deposit-blank-cells-newest-first` | Withdrawals/Deposits with the unused cell blank (amount + balance only), newest-first, reference before description, multi-page |
| `debits-credits-zero-filled-overdraft` | Debits/Credits with the unused cell `0.00`, tab-separated, negative balances, `B/F` row, negative debit (reversal) |
| `amount-drcr-marker-balance-branch` | Amount + separate `DR`/`CR` column + balance + trailing branch column |
| `amount-single-letter-cd-marker-no-balance` | Amount + trailing `C`/`D`, no balance (credit card) |
| `withdrawal-deposit-dash-placeholder-rupee` | `-` placeholders, attached `₹` |
| `deposit-first-column-order-zero-filled` | Credit column printed before Debit |
| `signed-amount-balance` | Signed amount (`-`, `+`, parentheses) + balance |
| `attached-drcr-suffix-signed-balance` | `1,500.00Dr` / `25.00 Dr`, Dr/Cr-marked balances, overdrawn |
| `amount-only-unsigned-undetermined` | No direction evidence at all, so the direction is left for the user |
| `debit-credit-dash-no-balance` | Debit/Credit with `-`, no balance |
| `serial-extra-columns-currency-code-multipage` | Serial column, `INR` token, lakh grouping, three pages |

## Known unsupported layouts

- **Values wrapped mid-token.** Narrow columns where pdf-parse splits a
  date or an amount across lines (`06/Aug/2` + `026`, `7,21,000.` + `00`).
  Text-only parsing cannot rejoin these reliably; supporting them needs
  coordinate-aware extraction. `reconcileBalanceChain` flags the affected
  rows.
- Amounts printed without decimals (`1500`), because free-text integers
  are indistinguishable from reference numbers.
- Decimal-comma locales (`1.234,56`). These are rejected, not misread.
- Scanned or image-only PDFs, which have no text layer.
- Transaction headers split across several lines per column name. Column
  order then falls back to Debit-first, and to balance arithmetic where
  balances exist.
