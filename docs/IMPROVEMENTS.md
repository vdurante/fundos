# Fundos — improvement backlog

Working list. One item at a time. Tick a box only when the change is live and verified.

Scope spans three artifacts:

| Artifact | Where | Notes |
|---|---|---|
| Node job | `/Volumes/workplace/meshclaw-workspace/fundos/` | writes `Volatilidade`, `Rentabilidade`, `Cadastro`, `Corretoras` |
| Apps Script | bound to the Sheet (`Extensions → Apps Script`) | writes `Merge!M:Q` and `Merge!S:W`; menu `CLIQUE AQUI` |
| Spreadsheet | id `1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0` | `Merge` = join + `Nota`; `Principal`/`Finalistas` = views; `Indices` = machine-filled benchmarks; `Variáveis`/`Manual` = hand-maintained |

---

## Established facts (do not re-litigate)

- **`sortino()` runs.** Verified 2026-09-20 22:05 by filling `Indices!B4:AC4` with `0.1` and recalculating: `Merge!S:W` and `Nota-IBOV` changed on every sampled row. An earlier prediction that `init()` would throw on an out-of-bounds `getRange` was **wrong** — Apps Script tolerates the oversized request.
- **The values in the sheet are current, not stale.** So every bug below has been actively affecting the rankings.
- **Live grids:** `Merge` 2103×144, `Rentabilidade` 1081×135, `Indices` 190×5 (was 997×171 before the rewrite), `Principal` 3816×151, `Finalistas` 969×142.
- **`Merge` row order is `Rentabilidade` row order** (`A3 = =Rentabilidade!A2`), and the script writes by that index. Sorting `Merge` silently scrambles every value in it. `Principal` is the sortable view.
- **Block discovery is driven by merged cells in `Merge` row 1** (`L1:Q1` = CDI, `R1:W1` = IBOV). The script writes from the *second* column of each block, so `Nota` stays a formula.
- **The metric is a monthly Sortino ratio**, benchmark-as-MAR: `mean(excess) / sqrt(mean(min(excess,0)^2))`. Not annualized. `SORTINO_OLD`'s numerator is algebraically identical to the current one; `SORTINO_DEBUG`'s compounded numerator over a monthly denominator was dimensionally wrong and correctly abandoned.
- **No Sharpe anywhere**, in any artifact.
- The service-account key is already covered by `.gitignore` line 124 (by exact filename).

### `Indices` data sources — identified 2026-09-20

Every series was hand-typed. Two of the three are now traced to a public API that
reproduces the existing values, so automating them is not a methodology change.

**CDI = BCB SGS series 4391** ("CDI acumulado no mês"). Matches the sheet to the
last floating-point digit, 8/8 sampled months. Values in percent — divide by 100.

```
GET https://api.bcb.gov.br/dados/serie/bcdata.sgs.4391/dados?formato=json&dataInicial=01/01/2011
 -> [{"data":"01/01/2011","valor":"0.86"}, ...]   189 points, through 2026-09
```

**IBOV = B3 `GetMonthlyEvolution`**, the monthly-evolution table behind
`sistemaswebb3-listados.b3.com.br/indexStatisticsPage/monthly-evolution/IBOVESPA`.
Parameters are base64-encoded JSON in the path; **both dates are required** or it
returns `[]` with HTTP 200. Returns index *levels*, so a return is the ratio of
consecutive months — fetch one extra month at the start.

```
GET https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetMonthlyEvolution/{b64}
    b64 = base64(JSON({"index":"IBOV","language":"pt-br",
                       "dateInitial":"2010-01-01","dateFinal":"2026-12-31"}))
 -> [{"month":1,"year":2011,"indexClosingRate":66574.88}, ...]   201 points
```

Verdict against the sheet's 142 surviving values: **140 within 1bp** (the sheet is
rounded to 4dp, hence no exact hits), one rounding artefact, and one real error —
see item 1b. Sibling endpoints on the same proxy, if ever useful:
`GetYearlyVariation`, `GetMensalVolatility`, `GetAverageGrowthRate`,
`GetPortfolioDay`, `GetDownloadMonthlyEvolution`.

**Risk Free Bond = hand-typed prefixado yield, one per calendar year.** Formulas
use pt-BR separators (`=Pow(1,1493; 1/12)-1` is 14.93% a.a., not 1.1493). 15 level
changes across 170 months; formulas from 2022 on, pre-computed literals before.
The level applied to year Y matches the prefixado yield at the **end of year Y-1**,
i.e. "the rate I could have locked in on 1 January", held flat for twelve months.

| Year | 2025 | 2024 | 2023 | 2022 | 2021 | 2020 | 2019 | 2018 |
|---|---|---|---|---|---|---|---|---|
| a.a. | 14.93% | 10.57% | 13.21% | 11.00% | 7.58% | 6.77% | 9.22% | 9.72% |

| Year | 2017 | 2016 | 2015 | 2014 | 2013 | 2012 | 2011 |
|---|---|---|---|---|---|---|---|
| a.a. | 10.93% | 16.00% | 11.97% | 13.40% | 9.55% | 11.19% | 12.40% |

Still open: whether the hurdle should stay a locked-in **yield** or become the bond's
**realized** mark-to-market return. Those give materially different Sortino values
and answer different questions.

**Title identified: `Tesouro Prefixado 2024-07-01`, `Taxa Compra`, read at the turn
of the year.** Source dataset "Taxas dos Títulos Ofertados pelo Tesouro Direto" —
one CSV, latin-1, `;`-delimited, pt-BR decimal commas, 176,390 rows back to 2002:

```
https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv
Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha
```

Exact hits on the Compra side within days of 1 January:

| Applied to | Rate | Exact hit in the dataset |
|---|---|---|
| 2022 | 11.00% | 20/12/2021 — Prefixado 2024-07-01 |
| 2023 | 13.21% | 02/01/2023, 03/01/2023 — Prefixado 2024-07-01 |
| 2024 | 10.57% | 02/01/2024, 04/01/2024 — Prefixado 2024-07-01 |
| 2025 | 14.93% | 06/01/2025 — Prefixado 2026-01-01 (the 2024-07 title matured Jul 2024) |

Independent confirmation: across the last December session of each year, Prefixado
2024-07-01 fits with mean |error| **0.13pp**, against 0.54pp for the next-best
maturity. Caveat: a 2dp rate recurs ~100× across the history, so the evidence is the
conjunction — one title, one side of the spread, the first days of January, three
consecutive years — not any single exact hit.

Derived rule if automated: `Tesouro Prefixado` (not the semiannual-coupon variant),
`Taxa Compra Manha`, first trading session of January, shortest maturity at least
~2 years out; convert with `(1+rate)^(1/12)-1`.

Resolve these URLs through the CKAN API rather than hardcoding a resource id:
`https://www.tesourotransparente.gov.br/ckan/api/3/action/package_search?q=tesouro-direto`

---

## P0 — resolved by the `Indices` rewrite

Both items below were about repairing the legacy hand-maintained `Indices` row.
That row no longer exists: `Indices` **is** the machine-filled tall sheet as of
2026-09-21 09:30, carrying correct IBOV for all 189 months from B3. Nothing to
restore and nothing to fix by hand. Kept here for the record.

- [x] **1. Restore the `Indices` IBOV row and recalculate.** ~~Moot~~ — the 28
  blank months (2025-02 back to 2022-11) are now filled from B3 by
  `crawler-indices.ts`, along with the other 161. The B3 values that would have
  been pasted by hand are preserved below in case you ever need to audit them.

  | 2025-02 | 2025-01 | 2024-12 | 2024-11 | 2024-10 | 2024-09 | 2024-08 |
  |---|---|---|---|---|---|---|
  | -0.0264 | 0.0486 | -0.0428 | -0.0312 | -0.0160 | -0.0308 | 0.0654 |

  | 2024-07 | 2024-06 | 2024-05 | 2024-04 | 2024-03 | 2024-02 | 2024-01 |
  |---|---|---|---|---|---|---|
  | 0.0302 | 0.0148 | -0.0304 | -0.0170 | -0.0071 | 0.0099 | -0.0479 |

  | 2023-12 | 2023-11 | 2023-10 | 2023-09 | 2023-08 | 2023-07 | 2023-06 |
  |---|---|---|---|---|---|---|
  | 0.0538 | 0.1254 | -0.0294 | 0.0071 | -0.0509 | 0.0327 | 0.0900 |

  | 2023-05 | 2023-04 | 2023-03 | 2023-02 | 2023-01 | 2022-12 | 2022-11 |
  |---|---|---|---|---|---|---|
  | 0.0374 | 0.0250 | -0.0291 | -0.0749 | 0.0337 | -0.0245 | -0.0306 |

- [x] **1b. Fix the one bad historical IBOV cell.** ~~Moot~~ — `2022-10` read
  `+0.0684` in the old hand-typed row; the rewritten sheet carries B3's
  `+0.054530`. The only hand-entry error in 142 months, gone with the row.

---

## P1 — `Indices`: DONE 2026-09-21 09:30

Migrated, shipped and verified live. **`Indices` itself is now the tall
machine-filled sheet** (`MONTH | CDI | IBOV | Risk Free Bond | 6 % a.a.`, newest
first, 189 rows, values percent-formatted `0.00%`). The interim `Benchmarks` tab
has been deleted; the sheet id `506484335` is the original `Indices`, repurposed
in place rather than replaced, so any bookmark or tab-order habit still lands on
it. The Apps Script is in git and deployable with `npm run gs:push` (script id
`1H_v74o7Weu6N7aNp-PI0_enw_IpP08gTOWziUTJxLwQzaynBm_HTdafA`).

Before the rewrite, the whole workbook was scanned for cell formulas referencing
`Indices` (`scripts/probe-indices-refs.js`, FORMULA render over every sheet):
**zero hits**. Apps Script was the only reader, which is what made repurposing the
sheet safe rather than merely convenient. The pre-migration wide sheet — values
*and* formulas, including the `=Pow(1,1493; 1/12)-1` bond entries — is snapshotted
at `docs/indices-wide-snapshot.json`.

**Post-recalc verification, `Merge` rows 3-5 against the pre-change baseline:**

| Block | Cells moved | Expected | Meaning |
|---|---|---|---|
| CDI `M:Q` | **0 of 15** | 0 | the date-keyed reader aligns exactly as the positional one did |
| IBOV `S:W` | **15 of 15** | 15 | real IBOV replaced 28 months of zero benchmark |

`9.99` sentinels afterwards: IBOV block 55/4,345 cells (1.3%), CDI block 42/4,345
(1.0%) — comparable, as two real benchmarks should be. Before, IBOV 12m/24m were
full of them because "never underperformed" is trivial against zero. Fund
`00.817.677/0001-17` went `9.99 / 9.99` → `+0.6095 / +0.0724`.

IBOV Sortinos got **worse** nearly everywhere (row 3's 24m `+0.0635` → `-0.2586`),
which is the correction landing: funds that appeared to beat IBOV were beating 0%.


**Status 2026-09-20 22:47: built, run, and verified against the live sheet.**
`Benchmarks` exists — 189 rows, 2011-01 → 2026-09, zero gaps in any series. Decisions
taken: tall layout in a new sheet, all three series automated, bond on the ≥12-month
floor recalculated monthly. Implemented in the Node job rather than Apps Script because
the Tesouro CSV is 14.5 MB / 176k rows (a bad bet against the 6-minute Apps Script
limit) and because benchmarks only matter when `Rentabilidade` gains a month.

Comparison of `Benchmarks` against the legacy `Indices`, 170 shared months:

| Series | Result |
|---|---|
| CDI | **170 identical**, bit for bit |
| 6 % a.a. | **170 identical** |
| IBOV | 140 within 1bp; 2 differ — `2022-10` (−138.7bp, the typo) and `2022-09` (−1.1bp, 4dp rounding) |
| Risk Free Bond | 166 differ, max 38bp — the intended annual→monthly change |

Files:

| File | What |
|---|---|
| `src/fundos/crawler-indices.ts` | new — CDI (BCB 4391), IBOV (B3), bond (Tesouro CKAN→CSV), `6 % a.a.` constant. Whole fetch runs in ~2.7s |
| `src/fundos/fundos.ts` | `writeBenchmarks()` (targets `Indices`), `formatBenchmarkPercentages()`, `dropLegacyBenchmarksSheet()`, `runBenchmarks()` |
| `src/indices.ts` | entry point — refreshes ONLY `Indices`; no Puppeteer, no fund data |
| `appsscript/Sortino.js` | reads `Indices` by month key |
| `scripts/probe-indices-refs.js` | lists sheets, scans every formula for `Indices` references, snapshots the sheet |
| `scripts/verify-indices.js` | post-write check: month sequence, gaps, empty cells, percent formatting |
| `package.json` | `npm.cmd` → `npm` (item 20, was breaking `npm install` on macOS); `gs:pull`/`gs:push`/`gs:status`; `googleapis` devDep for the two scripts |

Refresh the benchmarks any time with:

```bash
cd /Volumes/workplace/meshclaw-workspace/fundos && node build/src/indices.js
node scripts/verify-indices.js      # optional post-write check
```

The run is idempotent: it clears and rewrites `Indices`, re-applies the percent
format, and deletes a stray `Benchmarks` tab if one ever reappears.

Note the writer sends `MONTH` as `'YYYY-MM'` and Sheets coerces it to a date serial.
That is fine and even desirable — the cell still *displays* `2026-09`, it sorts
correctly, and Apps Script reads it back as a `Date`, which `monthKeyOf()` handles.
It formats using the **spreadsheet's** timezone, not the script's, because the
serial→Date conversion happens in the spreadsheet's zone and the two can differ.

Remaining: nothing. Deployed and recalculated.

What the rewrite fixes structurally: `calculateBlock` now builds the benchmark array
from `Rentabilidade`'s own month headers via a month→value map, so position
correspondence is guaranteed rather than assumed, and a missing month **throws naming
the month** instead of silently becoming 0%. `calcSortino` is byte-identical to the
current version on purpose — the off-by-one (item 2) stays a separate change so this
migration cannot quietly alter any number for a reason other than the data.

- [x] **A. Transpose to tall.** Done — `Indices` itself, 189 rows × 5 columns.
- [x] **B. Automate all three series.** Done and verified in `crawler-indices.ts`.
- [x] **D. Show the numbers as percentages.** `0.00%` on every value cell, applied by
  the writer so a rerun cannot lose it. Renders pt-BR (`0,67%`); the underlying values
  stay full-precision decimals, so nothing downstream changes.
- [x] **C. Bond hurdle → monthly, ≥12-month floor.** Chosen and implemented.

  Rule: `Tesouro Prefixado` (not the semiannual-coupon variant), `Taxa Compra Manha`,
  **first trading session of the month**, **shortest maturity at least 12 months out**,
  converted with `(1+rate)^(1/12)-1`.

  Verified 2026-09-20 against the real CSV: **170/170 months covered, no gaps**. The
  title rolls on its own (Prefixado 2026-01 through most of 2024 → 2027-01 from
  Feb 2025 → ~2-year bonds in earlier years). Difference from the old annual snapshot:
  median **14bp/month**, p90 29bp, max 38bp — systematic, not noise: through H2 2024 the
  flat `0.008408` sat against an actual hurdle rising to `0.010861`, flattering funds by
  roughly 2.4%/year against the bond exactly while prefixado yields spiked. Feb-2025
  agrees to 0.2bp, confirming the conversion matches the sheet's own `Pow` formula.

  The 12-month floor is deliberate over the literally nearest bond: a title in its last
  months quotes on thin liquidity and short duration, and when one matures before a
  replacement is offered the "nearest" jumps from a 6-month to a ~2.5-year instrument,
  putting a step in the hurdle unrelated to rates. A constant 2-year point would need
  curve interpolation — more machinery than a ranking hurdle justifies.

- [ ] **D. Decide whether the bond becomes a ranked block.** Still nothing reads it:
  `sortino()` only processes labels merged in `Merge` row 1 (`L1:Q1` CDI, `R1:W1` IBOV),
  so `Risk Free Bond` and `6 % a.a.` are now *correctly computed and still unused*.
  Making the bond matter means a third merged block plus six columns in `Merge`,
  `Principal` and `Finalistas`.

---

## Deploying the Apps Script — and the revert trap

`npm run gs:push` **replaces the whole project** with the contents of `appsscript/`,
and its success output is **not proof** the live code changed. On 2026-09-21 09:30 a
push reported all 7 files pushed while the live `Sortino.js` was still the original
pre-migration code, which then threw
`TypeError: Cannot read properties of null (reading 'getRow')` — the old
`getRentabilidadesByName` doing `createTextFinder(...).findNext().getRow()`, where
`findNext()` returns `null` because the rewritten `Indices` has no series label down
column A. The likeliest cause is a stale Apps Script editor tab saving its old
buffer over the project; the live script timezone had been changed to
`America/Sao_Paulo` in the same window (a better value than the repo's
`America/New_York`, so it was adopted rather than overwritten).

**Verify every push by reading the live project back.** Pull into a throwaway
directory holding only a `.clasp.json` (`{"scriptId": "...", "rootDir": "src"}`) and
diff each file against `appsscript/`. Close or reload the Apps Script editor tab
around a push.

The failed run threw inside the first block, before `calculateBlock` writes, so
`Merge` was left intact rather than half-written.

**Triggering a function from the CLI does not work for this script.**
`clasp run sortino` reaches the Execution API but fails with
`Exception: We're sorry, a server error occurred while reading from storage. Error
code NOT_FOUND.` — identically in devMode and `--nondev`, and identically after
creating a fresh version and a versioned deployment. That is the container-bound
script limitation, not a setup gap. A recalculation therefore needs one of:

1. a click on **CLIQUE AQUI → Atualizar cálculos**;
2. a web-app deployment with a `doGet` trigger — which means a publicly reachable
   URL that mutates the sheet, and Script Properties can't be seeded from the CLI,
   so the shared-secret gate needs the editor UI once;
3. moving the Sortino calculation into the Node job, which already authenticates
   with the service account and already writes this workbook.

Option 3 is the one that removes the whole failure class (no push/revert race, no
timezone seam, no click, and `calcSortino` becomes locally testable).

---

## P1 — bugs that change the numbers you rank on
- [ ] **2. `calcSortino` keeps the blank cell it slices at.**
  `expectedReturns.slice(0, emptyIndex+1)` retains the first empty month; `'' - rf` coerces to `-rf`, injecting a fake 0%-return month that hits the numerator *and* lands fully in the downside denominator. Affects the `T` column of every fund without ~10 years of history, i.e. most of them. Fix: `slice(0, emptyIndex)` on both arrays.

- [x] **3. A blank in the `Indices` row is silently read as 0%.** Fixed by the
  `Indices` rewrite: `calculateBlock` resolves each month through a month→value map
  and throws `Indices nao tem <série> para <YYYY-MM>` on a miss, so a gap can no
  longer coerce to 0. `calcSortino` itself is unchanged — the guarantee now comes
  from the caller, which is the right place for it.

- [ ] **4. The `9.99` sentinel distorts `Nota`.**
  `denominador === 0` → `9.99`. `Nota` ranks by `RANK(...)/COUNT(...)`, so every sentinel fund ties at the top percentile. Under bug #3 this handed the top of the IBOV ranking to "never had a down month", which low-volatility funds satisfy trivially. Decide: return `''`, or keep a cap and have `Nota` exclude sentinels from the rank.

---

## P2 — robustness in the Apps Script

- [ ] **5. `init()` sizes its read off the wrong sheet.**
  `rentSheet.getRange(2, 1, trackerSheet.getMaxRows(), trackerSheet.getMaxColumns())` asks 2,103 rows × 144 cols of an 1,081 × 135 sheet. It does not throw, but it hauls back ~1,000 padded blank rows every run. Fix: `rentSheet.getLastRow() - 1` and `rentSheet.getLastColumn()`.

- [ ] **6. `cnpjs` is compacted while `rentabilidades` is not.**
  `.filter(p => !!p)` makes the two arrays different lengths and permanently disarms the `if(!cnpj) break;` guard in `calculateBlock`. It happens to work because all blanks are trailing. Fix: drop the filter and let the guard do its job.

- [ ] **7. Protect `Merge` from being sorted.**
  Nothing enforces the row-order invariant. Add a protected range on `Merge`, or a bold note in row 1.

- [ ] **8. Two unguarded crashes in `sortino()`.**
  `merged[0]` is undefined if a row-1 label isn't merged (`SORTINO >>>` is merged on `Principal`/`Finalistas` as `I1:K1` — copy it into `Merge` row 1 and the loop dies). And `getRentabilidadesByName` does `.findNext().getRow()` with no null check, so a label with no matching `Indices` row throws. Fix: skip a column with no merged range, and report a missing index by name.

- [ ] **9. The 122-month window is hardcoded in two places.**
  `rentabilidades.map(p => p.slice(1, 123))` and `parseMonthCount('T') → 122`, whose comment says "10 anos - 1 mes" (which would be 119; 10 years is 120). Derive the width from `Rentabilidade`'s column count and fix the comment.

---

## P2 — Format.gs and Filters.gs

- [ ] **10. `format()` accumulates conditional-format rules forever.**
  `getConditionalFormatRules()` → `push` → `set` adds 12 rules per sheet per run and never removes the old ones; `clearFormat()` doesn't touch them. Currently 22 rules on `Principal`, 40 on `Finalistas`, including two-cell fragments (`M34:M35`) left from older row counts. Fix: filter out rules whose range matches the target column before pushing. Also `var rules` shadows the parameter of the same name.

- [ ] **11. `Filters.gs` resolves everything at module load.**
  `const principalFilter = principal.getFilter()` is `null` when `Principal` has no filter, which makes every `filter_*` call throw — including via `format()`, which calls `filters_clear()` first — and goes stale if the filter is recreated in the UI. The four `get_column` calls plus three `SpreadsheetApp` lookups run on *every* execution in the project, `onOpen` included, which is what makes the menu slow. Fix: move them inside the functions.

- [ ] **12. `get_column("Nota")` can only ever find the CDI column.**
  `indexOf` returns the first match (column L), so `sort_nota()` cannot sort by the IBOV `Nota` in column R. Add an explicit block argument.

- [ ] **13. `sort_column(col, ascending)` ignores both parameters** and hardcodes `COLUMN_NOTA, false`.

- [ ] **14. `filter_dp` passes `null`/`undefined` into `setHiddenValues`** and omits `0`, so funds with zero data points are never hidden.

---

## P2 — the Node pipeline

- [ ] **15. Reconcile `currentYear = 2022` with reality.**
  `fundos.ts` `run()` caps the quota download at 2022, yet `Rentabilidade` holds real returns through 2025-02. The committed code cannot have produced the live sheet — either the constant was edited locally and never committed, or a newer copy exists elsewhere. Running the repo as-is would blank the 2023-2025 columns. Settle this before the next run.

- [ ] **16. Migrate off the dead CVM cadastral file.**
  `cad_fi.csv` is effectively dead (46,575 `CANCELADA`, 22 live). The live universe is `registro_fundo_classe.zip` (`registro_classe.csv`), keyed on `CNPJ_Classe` under RCVM 175. The daily NAV report is per *class*, so `crawler-quotas.ts`'s `isTracked(results.data['CNPJ_FUNDO'])` filter probably needs `CNPJ_FUNDO_CLASSE` for recent files. Own research is already written up in `docs/itau-pension-opendata.md`.

- [ ] **17. The XP scrape can fail silently.**
  `xpData` starts as `[]` and `writeCnpjs`'s guard is `if (!fundos)`, which an empty array passes. A page change overwrites `xp.json` with `[]`, logs "xp populado", and drops ~700 funds. Fix: fail on `length === 0`.

- [ ] **18. `getFile` masks network errors.**
  `ex.response.status` throws `TypeError` when there is no response (DNS, timeout, reset), hiding the real cause. Guard `ex.response?.status`.

- [ ] **19. Decide about the 87 dropped CNPJs.**
  The old hand-maintained list (810 distinct, 990 entries with 180 duplicates) contained 87 CNPJs absent from today's scraped universe of 1,139. If any were deliberate picks rather than stale entries, they belong in `cnpj-manual.json`, the only list the scrape cannot overwrite.

- [ ] **20. Clean up `package.json`.** `prepare`/`pretest` call `npm.cmd` (Windows-only); `test` exits 1. `launch.json` uses `\\src\\index.ts`.

- [ ] **21. Delete dead code.** `Fundos_olg.gs` entirely (`SORTINO_OLD`, `SORTINO_DEBUG`, `FindRowNumber`, the only `BetterLog` dependency). In the TS: unused `SQRT_252`, `getQuotasMonthly`, `getYearFromCsv`, `import {e} from 'mathjs'`, and the unused `axios`/`AdmZip`/`csv-parse`/`GoogleSpreadsheet` imports in both crawlers. Also the stale root-level `btg.json` (654 entries vs 663 in `src/corretoras/`).

---

## P3 — metrics and hygiene

- [ ] **22. Add Sharpe.** Same excess-return array as `calcSortino`, two-sided `stdev` in the denominator. Would need a third merged block in `Merge` row 1 and five more columns.

- [ ] **23. Decide whether to annualize.** The current ratio is monthly. `×√12` makes it comparable to published figures; it does not change any ranking.

- [ ] **24. Two maintained-but-unread `Indices` series.** `6 % a.a.` and `Risk Free Bond` are both 189/189 filled and never read — `sortino()` only processes labels merged in `Merge` row 1. Either give them blocks or stop maintaining them. Same for the `Dif` row in `Manual`.

- [ ] **25. Volatility hardcodes 2018.** `writeVolatilidades` filters `DT_COMPTC >= 2018` and recomputes `m.sqrt(252)` inline while the `SQRT_252` const sits unused. Make the start year a parameter.

- [ ] **26. Move the service-account key out of `~/Downloads`.**
  `/Users/vcd/Downloads/fundos/config/fundos-309615-2795009f4d3e.json` grants **edit** rights on the document. `fundos.ts` expects it at `config/fundos-309615-2795009f4d3e.json` relative to cwd, and `.gitignore` already names that exact filename — so *move* (not copy) it into the repo's `config/`. Broaden the ignore to `config/` so a rotated key with a new filename is still covered.

- [ ] **27. Get the Apps Script into version control and deployable via `clasp`.**

  The Apps Script API **does not work with service accounts**, so the key in
  `config/` cannot push code — `clasp` with browser OAuth is the only path. The
  `gs:pull` / `gs:push` / `gs:status` npm scripts are already in `package.json`;
  `~/.clasprc.json` (the OAuth token) lives outside the repo and `.clasprc.json` is
  gitignored as a guard.

  **`clasp push` replaces the ENTIRE script project with the contents of `rootDir`.**
  Push a directory holding only `Sortino.gs` and `Menu.gs`, `Format.gs`,
  `Filters.gs` and `Fundos_olg.gs` are deleted from the project. Always clone or pull
  first so the local directory is complete.

  One-time setup (needs a human: a browser login and an account toggle):

  1. `npm install --save-dev @google/clasp`
  2. Enable the Apps Script API for the account at https://script.google.com/home/usersettings
  3. `npx clasp login` — opens a browser, writes `~/.clasprc.json`
  4. Script id: Extensions → Apps Script → Project Settings → Script ID
  5. `npx clasp clone <SCRIPT_ID> --rootDir appsscript` from the package root — writes `.clasp.json` and pulls all five `.gs` files plus the real `appsscript.json` manifest

  Step 5 **overwrites** `appsscript/Sortino.gs` with the live version. Commit the
  authored version first; `git checkout appsscript/Sortino.gs` restores it after the
  clone, then `npm run gs:push` deploys. Do not hand-author `appsscript.json` — the
  live manifest carries the `BetterLog` library dependency `Fundos_olg.gs` uses, and
  inventing one would silently drop it.

  Steady state after setup: `npm run gs:pull` → edit → `npm run gs:push`.

---

## Deliberately not doing

- The `.xlsx` export is an archive, not a working copy: Google-only functions (`QUERY`, `FILTER`) survive only as `__xludf.DUMMYFUNCTION` stubs with cached values, and `Pow(` is not Excel's `POWER(`. Never edit the export and push it back.
- `~/Downloads/fundos` is an incomplete pre-scraping ancestor (empty `src/fundos/`, hardcoded CNPJ list, no Puppeteer, `!process.env.CACHE_FILE` inverted-flag bug). Nothing to salvage except the key in `config/`.
