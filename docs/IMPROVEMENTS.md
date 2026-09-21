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

- [x] **D. Decide whether the bond becomes a ranked block.** DONE — it IS one. `Risk Free Bond` is the third block (`Principal!X:AC`, label + 5 periods), written by `sortino()` and ranked by its own `Nota` in `X`. Original text: Still nothing reads it:
  `sortino()` only processes labels merged in `Merge` row 1 (`L1:Q1` CDI, `R1:W1` IBOV),
  so `Risk Free Bond` and `6 % a.a.` are now *correctly computed and still unused*.
  Making the bond matter means a third merged block plus six columns in `Merge`,
  `Principal` and `Finalistas`.

---

## Deploying the Apps Script — `clasp push` lies, so verify

**Never trust `clasp push` output.** Use `npm run gs:deploy`, which pushes, pulls the
live project back into a temp directory, diffs every file against `appsscript/`, and
retries up to 3 times before failing non-zero. `npm run gs:push` is the raw push and
should only be used when you intend to verify by hand.

Two independent defects make the naive push unreliable, and both bit on 2026-09-21.

**1. `clasp push` reports success without updating the remote —
[google/clasp#507](https://github.com/google/clasp/issues/507).** Open since Jan 2019,
**closed** as `API support needed — A lack of a Google API feature blocks this issue`,
so it is an unfixed Apps Script API limitation rather than a config error. The
reporter's repro is exactly ours: push, reload, change absent; push again, change
present. Observed live: a 09:30 push printed `Pushed 7 files` while the remote
`Sortino.js` stayed on the pre-migration code; the byte-identical 09:38 push landed.

The symptom that surfaced it was
`TypeError: Cannot read properties of null (reading 'getRow')` from **Atualizar
cálculos** — the old `getRentabilidadesByName` doing
`createTextFinder(...).findNext().getRow()`, where `findNext()` returns `null`
because the rewritten `Indices` carries its series as column headers (`B1:E1`)
instead of row labels down column A. Old code, new sheet. It threw inside the first
block, before `calculateBlock` writes, so `Merge` was left intact rather than
half-written.

**2. A changed `appsscript.json` silently skips the ENTIRE push in any non-TTY
shell.** From `node_modules/@google/clasp/build/src/commands/push.js`:

```js
if (isManifestUpdated && !force) {
    force = await confirmManifestUpdate();
    if (!force) { console.log("Skipping push."); return; }   // pushes NOTHING
}
async function confirmManifestUpdate() {
    if (!isInteractive()) { return false; }   // piped shell, CI, agent shell
```

Not just the manifest — every file. So `gs:push` and `gs:deploy` both pass
`--force`, and `gs-deploy.js` additionally fails loudly if it ever sees
`Skipping push`.

The live script timezone is `America/Sao_Paulo`, matching the spreadsheet; the repo
manifest was `America/New_York` until 2026-09-21 and was aligned to the live value
rather than overwriting it. `monthKeyOf` formats with the **spreadsheet's** timezone
regardless, so the two can differ without corrupting a month key, but aligning them
removes the seam.

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

Option 3 is the one that removes the whole failure class — no push/verify dance, no
timezone seam, no click, and `calcSortino` becomes locally testable.

---

## P1 — bugs that change the numbers you rank on
- [x] **2. `calcSortino` keeps the blank cell it slices at.** DONE — `slice(0, emptyIndex)` plus an empty-length guard; 1,748 of 2,124 `T` cells changed.
  `expectedReturns.slice(0, emptyIndex+1)` retains the first empty month; `'' - rf` coerces to `-rf`, injecting a fake 0%-return month that hits the numerator *and* lands fully in the downside denominator. Affects the `T` column of every fund without ~10 years of history. Fix: `slice(0, emptyIndex)` on both arrays.

  **Measured 2026-09-21** with `node scripts/verify-sortino.js 99999`: **1,662 of the
  2,124 T cells move** (1,062 funds × 2 blocks) — 78%. Deltas run both directions and
  reach ~2.6pp of Sortino, e.g. `12.796.232/0001-87` CDI `0.04890035 → 0.07500190`,
  IBOV `-0.08413948 → -0.09233546`. `Nota` weights T at 0 today, so this does not
  currently move any ranking — it corrupts a column you read directly.

- [x] **3. A blank in the `Indices` row is silently read as 0%.** Fixed by the
  `Indices` rewrite: `calculateBlock` resolves each month through a month→value map
  and throws `Indices nao tem <série> para <YYYY-MM>` on a miss, so a gap can no
  longer coerce to 0. `calcSortino` itself is unchanged — the guarantee now comes
  from the caller, which is the right place for it.

- [ ] **4. The `9.99` sentinel distorts `Nota`.**
  `denominador === 0` → `9.99`. `Nota` ranks by `RANK(...)/COUNT(...)`, so every sentinel fund ties at the top percentile. Under bug #3 this handed the top of the IBOV ranking to "never had a down month", which low-volatility funds satisfy trivially. Decide: return `''`, or keep a cap and have `Nota` exclude sentinels from the rank.

---

## P1 — `Merge` row integrity (found 2026-09-21 while verifying the recalc)

The Apps Script arithmetic itself is now **fully verified**: `node scripts/verify-sortino.js 99999`
recomputes Sortino independently from `Rentabilidade` + `Indices` and matches the sheet
on **10,620/10,620 cells** (1,062 funds × 2 blocks × 5 periods, agreement < 1e-9).
Everything below is about the rows around that data, not the maths.

- [x] **28. 59 `#REF!` rows at the bottom of `Merge` (rows 1065-1123).** OBSOLETE — `Merge` deleted 2026-09-21.
  `Merge!A/B/C/J` are `#REF! (Reference does not exist.)` — formulas pointing at
  something deleted. `Merge!A` holds 1,121 non-empty cells of which only **1,062 are
  valid CNPJs**.

  `sortino()` writes `values.length` rows from row 3, and `values.length` is
  `Rentabilidade`'s fund count (**1,080**), so it writes rows 3-1082 regardless of what
  `Merge!A` says. Consequence: rows 1065-1082 receive real funds' numbers under a
  broken identity, and rows 1083-1123 hold **stale** numbers from an older, longer run
  that nothing overwrites.

  Impact today is contained but the mechanism is live: the garbage rows carry a numeric
  value **only in the `T` column** (`Q`/`W`), because `M:P`/`S:V` are blank there. `Nota`
  uses whole-column `RANK(Q3; Q:Q; 1)/COUNT(Q:Q)`, so `COUNT(Q:Q)` and `COUNT(W:W)` are
  inflated by 5.3% — harmless *only* because `Variáveis!B3` (the T weight) is `0`, which
  multiplies that whole term away. **Give T any non-zero weight and 59 junk rows start
  shifting every fund's percentile.**

  Fix: repair or delete rows 1065-1123, and have `calculateBlock` clear the region below
  the rows it writes so a shrinking fund count cannot leave stale values behind.

- [x] **29. 95 real funds have no `Nota` at all — `#DIV/0!` in both blocks.** FIXED 2026-09-21.
  `K3 = COUNTIF(M3:Q3;"<>"&"")` counts non-blank period cells and indexes the divisor:
  `/INDEX('Variáveis'!$C$3:$C$7; $K3; 0)`. `K=1` (only `T` filled) indexes `Variáveis!C3`
  which is `0`, because `T`'s weight is `0` — so the fund has zero weighted evidence and
  the ratio is genuinely undefined. `K=0` indexes row 0, returning the whole range.

  Fix applied by `node scripts/fix-nota-guard.js --apply` (script since deleted): every `Nota` formula in
  `Merge!L` and `Merge!R` is now wrapped as `=IFERROR(<original>; "")`, so a fund with no
  weighted evidence shows **blank** rather than an error. Blank is the right answer — a
  fund with under 12 months of history cannot be scored on 12m/24m/36m/60m, and blank
  sorts to the end under `sort_nota`. Giving `T` a non-zero weight remains a separate,
  open methodology choice; this fix does not preclude it.

  Result: `err 0` in both columns (was 154 each), `blank 154` = 102 rows with `K=0` +
  52 with `K=1`, and all 541 `K=5` rows numeric. `Nota` for full-history funds is
  byte-identical (`0.2654331114532912`).

  **Two traps this exposed, both worth remembering.**
  (1) `updateCells` with `fields: 'userEnteredValue'` and an **empty** `userEnteredValue`
  CLEARS the cell. A "skip this cell" branch must re-send the existing formula, not an
  empty value — the first run wiped `L3`/`R3` (the 2 cells a prior test had already
  wrapped) and they had to be restored with a `copyPaste` / `PASTE_FORMULA` from row 4.
  (2) After rewriting ~1,100 formulas, Google recalculates **asynchronously**; a read
  taken immediately afterwards returned stale values for the second column and made the
  fix look like it had produced 1,121 numbers. Re-read before concluding anything.

  The pt-BR `;` argument separator round-trips correctly through
  `userEnteredValue.formulaValue`, so no locale translation is needed.

- [x] **30. `Merge` is missing 18 funds that `Rentabilidade` has.** DONE by the collapse — all 18 now carry Sortino data in `Principal` (`cnpjsWithoutHistory: 0`), and 7 of them had their volatility restored too.
  1,062 valid CNPJs in `Merge` against 1,080 in `Rentabilidade`. Positional alignment is
  exact for rows 3-1064, so the 18 are simply never joined in — probably the same broken
  reference behind item 28.

  **One root cause, three visible symptoms (measured 2026-09-21).** The 59 `#REF!` rows
  in `Merge` propagate outward:

  | Where | Symptom |
  |---|---|
  | `Merge` rows 1065-1123 | `A/B/C/J` are `#REF!`; identity lost |
  | `Principal` | **59 rows** whose `AD` pointer `=MATCH(A;Merge!A:A;0)` is `#N/A`, so every `INDEX` on that row yields `#N/A` |
  | `Finalistas` | 3 of those 59 pass the `F='B' OR G='B'` filter and render as visibly broken rows — `#N/A` in `B`/`C`, blanks across all three Nota blocks |

  The three that surface are `57.879.610/0001-24` (Principal row 524),
  `58.198.613/0001-65` (528) and `58.561.455/0001-66` (532). Repairing the `Merge` rows
  fixes all three layers at once; patching `Principal` or `Finalistas` only hides it.

- [x] **32. `Finalistas` query range was frozen at row 974.** FIXED 2026-09-21.
  `=QUERY(Principal!A2:AC974; …)` while `Principal` held data to row 1123. Changed to the
  open-ended `Principal!A2:AC` so it cannot go stale again as funds are added.

  Impact was **3 funds, not the ~149 rows excluded** — the `WHERE F = 'B' OR G = 'B'`
  filter admits only 30 funds in total, 27 of which already sat inside the old window.
  `Finalistas` went 27 → 30 data rows, well inside its 967-row capacity.

### Verification tooling added

| Script | What it proves |
|---|---|
| `scripts/verify-sortino.js [n]` | recomputes Sortino independently and diffs against `Principal`; also previews the item-2 fix |
| `scripts/verify-indices.js` | `Indices` month sequence, gaps, empty cells, percent formatting |
| `scripts/read-range.js <A1>` | ad-hoc range dump |
| `scripts/gs-deploy.js` | pushes Apps Script and **verifies** it landed (see clasp#507 above) |
| `scripts/test-sheet-writer.js` | 24 live-API checks on the keyed writer, on a throwaway sheet (`npm run test:writer`) |
| `scripts/find-sheet-references.js <Sheet>` | formulas + named ranges + conditional formats naming a sheet, before deleting it |
| `scripts/dry-run-fundos.js` | measures what a `writeFundos` run WOULD change, read-only |
| `scripts/probe-cvm-registry.js` | CNPJ coverage of `registro_fundo` / `registro_classe` against the live sheet |

Note when writing a checker: the Sheets API **omits trailing empty cells**, so a
short-history fund's row comes back shorter rather than padded. Apps Script's
`getValues()` pads with `''`. Pad to 122 months before comparing, or every
short-history fund will look like a mismatch — this produced a false 7,196/10,620 on
the first run.

---

## P1 — root cause of the `#REF!` rows and the 18 missing funds (diagnosed 2026-09-21)

**`Merge` joins by row-pinned reference, and the Node job deletes the rows it points at.**

`Merge` builds each row from fixed single-cell references, offset by one:

```
Merge!A3    = =Rentabilidade!A2          Merge!B3    = =Cadastro!B2
Merge!A1064 = =Rentabilidade!A1063       Merge!J3    = =ROUND(Volatilidade!B2;2)
Merge!A1065 = =#REF!                     Merge!J1065 = =ROUND(#REF!;2)
```

`=#REF!` is the permanent scar of a **deleted** source row. Sheets does not heal it when
data grows back, and `Merge!C` (`=IFS(J…)`) inherits the failure from `J`.

The deletion comes from `writeToSheetNew` in `src/fundos/fundos.ts`:

```ts
await sheet.resize({columnCount: headers.length, rowCount: data.length + 1});
```

Shrinking `rowCount` **deletes rows**. That function writes precisely the three sheets
`Merge` references — `Volatilidade` (line 137), `Cadastro` (220), `Rentabilidade` (334).
So any run where the fund count *falls* silently breaks every `Merge` formula pointing
past the new end, forever.

**The arithmetic closes exactly.** `Merge` formulas reach `Rentabilidade` row 1063
(= `Merge` row 1064), covering 1,062 funds. All three source sheets now hold 1,080 funds
(rows 2-1081).

| | |
|---|---|
| broken `Merge` rows | 1065-1123 = **59** |
| would point at `Rentabilidade` rows | 1064-1122 |
| of which rows that hold a real fund (1064-1081) | **18** — invisible today |
| of which rows past the end of the data (1082-1122) | **41** — would correctly go blank |

`59 = 18 + 41`, and `Principal!A` independently shows 1,080 CNPJs across 1,121 rows,
i.e. 41 blanks. The 18 are all `57.x / 58.x / 59.x` CNPJs — the most recently registered
funds, which is what you would expect when a reference range stops growing.

- [x] **33. Repair the 59 rows.** OBSOLETE — never done, and correctly so: the collapse admitted the 18 real funds without repairing a single cell. Original text: restore the pattern on `Merge` rows 1065-1123:
  `A{r} = =Rentabilidade!A{r-1}`, `B{r} = =Cadastro!B{r-1}`,
  `J{r} = =ROUND(Volatilidade!B{r-1};2)`. `C` heals itself once `J` works. This admits the
  18 funds and blanks the other 41. It also changes every ranking, because 18 funds enter
  `COUNT`/`RANK`.

- [x] **34. Stop the recurrence.** DONE — `writeToSheetNew` no longer resizes or clears; `writeKeyed` matches by key, appends, blanks vacated cells and never lowers `rowCount`. Repairing alone is not enough — the next shrinking run
  re-breaks it. Either (a) never shrink: clear values instead of resizing `rowCount` down,
  or (b) make the join shrink-proof by replacing ~1,100 pinned references per column with
  one dynamic `ARRAYFORMULA`/`QUERY` over `Rentabilidade!A2:A`, which cannot be pin-broken.
  (b) is the real fix; (a) is the one-line stopgap.

---

## Destination — one table in `Principal` (agreed direction, not yet scheduled)

### DONE 2026-09-21 — blank Vol explained and repaired; row headroom restored

**"Real data but no volatility" was never a calculation gap.** All 7 funds HAD a volatility in
`Fundos!C` the whole time:

```
57.976.053/0001-60  0.030654      58.481.477/0001-16  0.002039
58.495.741/0001-70  0.198217      57.879.610/0001-24  0.035359
57.976.525/0001-84  0.001540      58.804.815/0001-03  0.005044
                                  58.943.835/0001-65  0.002824
```

Those 7 are 7 of the 18 funds `Merge` had NO ROW for, so `Principal!J` read `#N/A`, and the
collapse's step-1 freeze blanked all 342 error cells (18 rows x 19 columns). The gap was `Merge`'s,
not the volatility pipeline's. Restored from `docs/fundos-final-snapshot.json`, rounded to 2dp to
match the column's convention. `Risco` then computed itself: **blank Vol 0, blank Risco 0**.

`Risco` is healthy and discriminating: `00 ~ 05` 472 · `10 ~ 25` 340 · `05 ~ 10` 137 · `25~100` 77.

**Observation, not fixed:** the old `=ROUND(Fundos!C;2)` is lossy. Unrounded volatility runs
min 0.000898 / median 0.0609 / max 0.7273, and **109 of 1,040 funds round to 0.00**, collapsing
into one indistinguishable `00 ~ 05` group. 2dp rounding can also flip a band at a boundary
(0.0549 -> 0.05 reads as `00 ~ 05`). When `writePrincipal` is built, write unrounded volatility
and let the number format handle display.

**Row headroom restored: 1028 -> 2000** (974 spare rows for ~2x the current fund count). All 11
conditional formats and the basic filter re-extended to 2000 in the SAME batch — `0` rules off
grid height. The filter went out with `sortSpecs` omitted, so the row order survived
(`1025/1025` pairs still Nota-descending).

**No CNPJ denylist anywhere.** Vitor's lists were examples, not a rule to encode. The filter is
computed from data on both tiers: `Tipo_Fundo in (FIP, FII)` from the registry, and `DP = 0` at
write time. `docs/removed-no-data-funds.json` is an audit record of one removal, NOT an input.

### DONE 2026-09-21 — `Fundos` and `Missing` deleted; 6 sheets left

```
remaining sheets (6): Variáveis, Finalistas, Principal, Indices, Rentabilidade, Manual
Principal: error cells 0 · Finalistas: error cells 0 · funds 1026
```

Snapshots: `docs/fundos-final-snapshot.json`, `docs/missing-final-snapshot.json`.

**`Fundos` held one column that existed nowhere else: `MANUAL` (26 TRUE).** "Centralised in
`Principal`" was not yet true — `Principal` had `BTG` and `XP` but no `MANUAL`. Ported to
`Principal!AD` keyed by CNPJ before the delete: **24** landed (the other 2 were among the 54 DP=0
funds already removed). `AD` was free because the collapse cleared the old `IDX` column.

`Missing` was the only formula reference to `Fundos` (its two `FILTER`/`MATCH` drift checks), so
the two had to go together — deleting `Fundos` alone would have left `Missing` broken.

**Code removed in the same commit, because a deleted sheet named in live code is a latent crash**
— the same defect hit `grids()` and `writeCorretoras()` earlier today:

- `writeCorretoras()` deleted (45 lines). Its `Corretoras` sheet was ALREADY gone, so `run()`
  would have thrown there before ever reaching `writeFundos`.
- `writeFundos()` deleted, and both calls removed from `run()`.
- `BTG_FUNDOS` / `XP_FUNDOS` / `MANUAL_FUNDOS` imports dropped from `fundos.ts` (still exported
  from `tracker.ts` for the future Principal writer).

`writeFundos`'s row-building logic is the spec for the eventual `writePrincipal`: join volatility
by CNPJ, set `BTG`/`XP`/`MANUAL` from the tracker sets, override `DENOM_SOCIAL` from `CNPJ_MANUAL`,
then write owned columns through `writeKeyed`. It is recorded here rather than left as dead code.

The basic filter was widened to `A2:AD` so `MANUAL` is filterable alongside `BTG`/`XP` —
**with `sortSpecs` omitted**, which is what stops `setBasicFilter` re-sorting the sheet.

### Filter rule for the Principal writer — exclude by TYPE, skip by DATA, never by CNPJ list

Vitor asked for the no-value funds to be filtered in Node so they never land in `Principal`.
Measured first, and his two symptom lists need different treatment.

**Symptom lists are not the predicate.** "No Risco" is the WRONG filter: of the 18 blank-Risco
funds, **7 have real data and real scores** (DP=1, Nota up to 0.97076). Blank Risco means no
*volatility*, not no *value* — dropping them loses ranked funds. The usable predicate is `DP = 0`
(no computable Sortino period).

**DP=0 splits by fund type, measured across all 1,080 funds then in the sheet:**

```
Tipo_Fundo   total   DP=0   with data   unrankable
  FI          1012      5        1007        0.5%
  FIDC          37     20          17       54.1%
  FIP           20     20           0       100.0%
  FII            8      8           0       100.0%
  FMIA-CL        2      0           2         0.0%
  FIAGRO         1      1           0       100.0%
```

So the rule is two-tier:

1. **Structural exclusion by `Tipo_Fundo`** — `FIP` and `FII` are 100% unrankable (n=28); they do
   not report a comparable monthly NAV series and never will. Exclude at the universe level.
   **Do NOT exclude `FIDC` by type** — 17 of its 37 carry real data.
2. **Dynamic skip on `DP = 0` at write time** for everything else. NOT a static CNPJ denylist:
   of the 54 DP=0 funds, **24 were registered in 2024 and 9 in 2025** — they have no history
   *yet*. A hardcoded list would permanently bury a fund that becomes rankable next quarter,
   whereas a write-time skip lets it appear by itself once it has data.

The 54 DP=0 rows were removed from `Principal` (list kept in `docs/removed-no-data-funds.json`);
none carried manual annotations. 1,080 -> 1,026 funds. The 7 blank-Risco-but-ranked funds stay.

### Grid trimmed to the data — formats no longer have headroom

Vitor deleted `Principal`'s trailing empty rows, so `rowCount` went **3816 -> 1028** (1,026 funds
+ 2 header rows). Every conditional format and the basic filter re-pinned to 1028, which is still
"grid height" — but grid height now equals DATA height, so the headroom that made
`declare at grid height` self-maintaining is gone.

**Consequence for the writer:** appending a fund past row 1028 puts it OUTSIDE every conditional
format and outside the filter. So when the keyed writer raises `rowCount` it MUST also re-extend
the 11 conditional-format ranges and the basic filter to the new height, in the same run. Use
`setBasicFilter` WITHOUT `sortSpecs` for that (see the sorting hazard above) or it re-sorts.

### DONE 2026-09-21 — `Nota` guarded on zero data points, and `Format.js` made idempotent

**`INDEX` with index 0 does not error — it returns the whole range.** The Nota divisor
`INDEX('Variáveis'!$C$3:$C$7; $K{r}; 0)` with `K = 0` therefore yielded `{1;2;3;4;5}`, so
`0 / {1;2;3;4;5}` produced an array whose first element is `0`. Result: of the 54 funds with no
data points, 5 displayed `Nota = 0` and 44 displayed blank — same condition, two renderings.

All 3,240 `L`/`R`/`X` formulas are now guarded. Per Vitor: **a fund with no data is a fund with a
0 rating**, so the guard yields `0`, not `""`:

```
=IF($K{r}=0;0;IFERROR((…)/INDEX('Variáveis'!$C$3:$C$7;$K{r};0); ""))
```

```
L (CDI): numeric 1080/1080  zeros 54  min non-zero 0.000975
R (IBOV):numeric 1080/1080  zeros 54  min non-zero 0.007667
X (Bond):numeric 1080/1080  zeros 54  min non-zero 0.000975
sorted descending: 1079/1079 pairs · first Nota=0 at row 1029, all rows below are 0
blank Nota cells: 0 · error cells: 0
```

An intermediate attempt used `""`. That is WORSE than it looks: a formula returning `""` is
**text, not blank**, and Sheets sorts text BEFORE numbers in a descending sort, so all 54
data-less funds clustered at the TOP of the sheet. `0` is a number and sorts last, which is both
semantically right and the fix for the ordering.

**`Format.js` was the debris generator.** It did `rules.push(rule); setConditionalFormatRules(rules)`
for each of 18 columns on each of 2 sheets, **every run** — so each click of `Formatar colunas`
added 36 conditional-format rules and would have taken `Principal` from 11 straight back to 29.
Rewritten to: drop existing gradient rules rather than append, emit ONE rule spanning `L:AC`
instead of 18 per-column rules, and size ranges from `getMaxRows()` (grid height) rather than
`getLastRow()` (data height) so they cannot rot again.

Note for a future sort: `sortRange` correctly rewrites relative formula references — verified
0 of 1,080 rows pointing at the wrong row afterwards. A suspicious sort is more likely a data
problem than a formula problem.

### DONE 2026-09-21 — `Atualizar cálculos` (Apps Script `sortino()`) fixed for `Principal`

Reported broken by Vitor after the collapse. TWO bugs, the second far worse than the first, and
the first was masking it.

**1. Bogus block.** `sortino()` scans row 1 for any non-empty merged label. `Principal` carries
`I1 = "SORTINO >>>"` merged over `I:K`, which `Merge` never had, so it called
`calculateBlock("SORTINO >>>", J, K)` and `loadBenchmarkColumn` threw
`Aba Indices nao tem a coluna "SORTINO >>>"`. Fixed with `isPeriodBlock(startCol, endCol)`,
which requires every period header in the span to parse — the same filter added to
`src/fundos/sortino.ts`. Only `TRACKER_NAME` had been changed in the JS file; the filter was not
ported, which is what left this broken.

**2. Positional write — silent corruption.** `calculateBlock` ended with

```js
trackerSheet.getRange(3, startCol, values.length, ...).setValues(values);
```

writing values in **`Rentabilidade` row order**. That was correct on `Merge` only because
`Merge!A3 = Rentabilidade!A2` made the two positionally aligned by construction. `Principal!A`
is human-ordered (and now `Nota`-sorted), so a positional write puts every fund's Sortino on the
WRONG ROW. Had only bug 1 been fixed, the menu item would have silently corrupted the sheet.
`calculateBlock` now reads `Principal`'s own column A and looks each CNPJ up in a `rentByCnpj`
index built in `init()` — the same keying `sortino.ts` uses.

Also hardened `parseMonthCount` to coerce its argument, since `periodName.endsWith` throws on a
numeric or blank header cell.

**Lesson: a sheet rename in one implementation is not a port.** `sortino()` existed in both
TypeScript and Apps Script; repointing only the TS version left a live, user-facing path aimed at
the new sheet with the old sheet's assumptions baked in.

### DONE 2026-09-21 — spent Merge-era scripts deleted (part of item 21)

Eleven one-shot scripts removed: they either read the now-deleted `Merge` sheet or were
already-applied migrations to sheets that no longer exist.

```
check-row-alignment.js   compare-blocks.js        add-bond-block.js
fix-nota-guard.js        check-merge-blocks.js    merge-corretoras-into-cadastro.js
merge-volatilidade-into-cadastro.js               compare-nota-weights.js
probe-merge-blocks.js    add-bond-block-principal.js   capture-collapse-baseline.js
```

No `npm` script referenced any of them. The artifacts they produced are kept:
`docs/collapse-baseline.json`, `docs/merge-snapshot.json`, `docs/volatilidade-snapshot.json`,
`docs/fundos-snapshot.json`, `docs/principal-cf-snapshot.json`.

Kept deliberately: `test-sheet-writer.js` (only a comment mentions `Merge`),
`read-range.js` (default range repointed to `Principal`), and the `collapse-step*.js` pair,
which are idempotent and document how the collapse was executed.

### DONE 2026-09-21 — item 10, `Principal` conditional formats consolidated 40 -> 11

All 30 gradient rules turned out to share ONE identical parameter set (NUMBER -1 / 0 / +1,
red -> yellow -> green), so they collapsed into a single rule:

```
before: 10 boolean (grid height) + 18 gradients L3:L1123..AC3:AC1123 + 12 DEAD at L1124:AC1137
after:  10 boolean (unchanged)   +  1 gradient  L3:AC3816
verified: gradient params identical · old ranges uncovered 0 · boolean rules unchanged true
```

The 12 dead rules formatted rows 1124-1137, past the last data row (1123) — they coloured
nothing. The 18 live ones were frozen at the old DATA height, so an appended fund at row 1124
would have received no Nota colouring.

Snapshot for rollback: `docs/principal-cf-snapshot.json` (all 40 original rules).

**Corrects an earlier note in this file** which said the fix was to declare formats "open-ended".
There is no open-ended range (see the tested behaviour above): the rule is **declare at GRID
height**. `C3:C3816` survived every row-count change precisely because 3,816 IS the grid height.

`Finalistas` deliberately left alone for now — 47 rules, ~18 of them dead (`L33:L33`..`W33:W33`,
`L34:L35`..`P34:P35`, and `X33:AC969` starting at row 33 so it misses the data entirely).

### DONE 2026-09-21 — `Principal` basic filter widened

```
before: A2:W1137   (endColumnIndex 23, endRowIndex 1137)
after:  A2:AC3816  (endColumnIndex 29, endRowIndex 3816)
criteria identical: true   sortSpecs identical: true
```

**HAZARD FOUND — `setBasicFilter` APPLIES its `sortSpecs`.** Passing the 9 existing sortSpecs
back to preserve them physically re-sorted the sheet (`Nota` desc: 1029/1030 adjacent pairs in
order, up from 500/1018). This contradicts an earlier claim in this file that no API mechanism
re-sorts. Data integrity was unaffected — rows move whole, so annotations follow their CNPJ
(verified: 0 of 1,080 CNPJs changed in `D:G`, 0 lost, 0 gained) — but ROW ORDER changed, and row
order is human data. To widen a filter WITHOUT re-sorting, omit `sortSpecs` from the request.

### DONE 2026-09-21 — `Merge` deleted, `Principal` is the single table

Executed in the order 1 -> 4 -> 2 -> 3 (step 4 had to precede step 2; see below).

```
formula cells referencing "Merge": 0
Principal error cells:   0      (baseline 1475)
Finalistas error cells:  0      rows returned 30
manual/key cells changed vs baseline: 0
sortino verify: 16200/16200 cells match  (1080 funds x 3 blocks x 5 periods; was 15930/1062)
remaining sheets (8): Variáveis, Finalistas, Principal, Missing, Indices, Fundos, Rentabilidade, Manual
```

Snapshots kept: `docs/collapse-baseline.json` (Principal, pre-change) and
`docs/merge-snapshot.json` (Merge values + formulas + gridProperties, pre-delete).

**Ordering correction.** Nota first evaluated to `0` on 1,019 rows. Not a formula bug: `RANK`
propagates an error present anywhere in its range, and the 41 keyless rows still held
`=INDEX(Merge!M:M; $AD{r})` = `#N/A`. Confirmed by `COUNTA(M:M) - COUNT(M:M) = 1009 - 967 = 42`
= 41 errors + 1 text header. **Clear the junk rows BEFORE installing population-wide formulas.**

**Near-miss on human data.** The plan called for clearing all 41 keyless rows wholesale. A
pre-flight check found **4 of them carry `Tipo = "IE"`** (rows 522, 552, 561, 571) with no CNPJ —
orphaned annotations. Only the derived columns were cleared; `D:G` preserved on all 41. Those 4
still need a decision about what they should attach to.

**`Nota` moved, as predicted** (population 1,062 -> 1,080), by very little:
`L` 1,018 changed, meanΔ -0.00052 · `R` 1,019 changed, meanΔ +0.00082 · `X` 1,018 changed, meanΔ -0.00057.

**The 18 orphan funds are now live.** They previously showed `#N/A` in every derived column
because `Merge` had no row for them. They DO have return history (`cnpjsWithoutHistory: 0`), so
the collapse populated them — which is what closed item 33 without repairing anything.

**Code changes:** `TRACKER_NAME` `'Merge'` -> `'Principal'` in BOTH `src/fundos/sortino.ts` and
`appsscript/Sortino.js`; `scripts/verify-sortino.js` repointed. Block discovery gained a filter
requiring every period header to parse (`block.periods.every(p => p !== undefined)`) because
`Principal` merges `I:K` under the label `SORTINO >>>`, which the old `!!block.label` test let
through and which would have crashed on `series['SORTINO >>>']`.

### Feasibility confirmed + execution order (2026-09-21)

Two blocking unknowns were checked and both are clear:

- **`Merge` is referenced by `Principal` alone** — 28,052 formula cells, all in `Principal`;
  0 named ranges, 0 conditional formats, nothing in `Finalistas` or `Missing`. Plus 3 header
  cells `Principal!A1` / `R1` / `X1` = `=Merge!A1` / `R1` / `X1`. One sheet to change.
- **`Principal` already carries the same merged block headers** as `Merge` (`L:Q`, `R:W`,
  `X:AC`), which is how `sortino.ts` discovers blocks — so it repoints with almost no change.
  Caveat: `Principal` ALSO merges `I:K`, which the scanner would misread as a fourth block.
  Filter on merge width (6) or on the label cell reading `Nota`.

**This does NOT depend on the crawler rework.** `B` / `H` / `I` / `J` currently hold computed
`INDEX` results; those values can be read and written back as literals, freezing today's data.
The reworked crawlers later update the same columns through `writeKeyed`.

Order, each step independently verifiable:

1. **Freeze the data columns.** Read current computed `B`, `H`, `I`, `J` and the three Sortino
   blocks from `Principal`; write them back as literal values. Verify: re-read and compare to
   `docs/collapse-baseline.json` — must be byte-identical.
2. **Convert the 5 live-formula columns** to self-referencing formulas: `C` = `IFS` on its own
   `J`, `K` = `COUNTIF(M{r}:Q{r})`, `L`/`R`/`X` = the existing Nota formula reading `Principal`'s
   own `M:Q` / `S:W` / `Y:AC` + `Variáveis`. Verify: `C` and `K` must match exactly; **`Nota`
   will move** because the ranking population changes from `Merge`'s 1,062 valid rows to
   `Principal`'s 1,080 — measure and report the delta, do not mistake it for a regression.
3. **Delevel the 3 header cells** `A1`/`R1`/`X1` to literals, and drop `AD` (`IDX`), which
   nothing references once step 2 lands.
4. **Clear the ~43 keyless formula rows** below the last CNPJ (`Principal` has formulas to row
   1,123 but keys only to 1,080) — a large share of the 1,475 current errors.
5. **Repoint `sortino.ts`** from `Merge` to `Principal` with the block filter from above.
   Verify with `verify-sortino.js` against `Principal`.
6. **Delete `Merge`**, only once `find-sheet-references.js Merge` reports 0.
7. **Widen the basic filter** to `A2:AC` at grid height, carrying its 5 criteria and 9 sortSpecs.

### Corrected collapse design — formulas STAY on `Principal`

Vitor, 2026-09-21: **`Nota` must remain a live formula.** The point of the sheet is to change
a weight in `Variáveis` and immediately see how the evaluation moves. A Node-computed `Nota`
would need a job re-run to reflect a weight change, destroying that loop. An earlier plan to
port `Nota` to Node was wrong and is withdrawn.

`Merge`'s columns are two different kinds, and only the first kind moves:

| Kind | Columns | Where it goes |
|---|---|---|
| **Data** — static input, no interactivity | `B` DENOM, `H` BTG, `I` XP, `J` Vol, and the three Sortino blocks `M:Q` / `S:W` / `Y:AC` | Node writes VALUES straight into `Principal` |
| **Live formula** — must recalc on edit | `C` Risco, `K` DP, `L`/`R`/`X` Nota | Stays a formula, rewritten to reference `Principal`'s OWN columns |

So the collapse removes `Merge` as an **indirection layer**, not as a calculation. The formulas
move onto `Principal` and get simpler, losing the `INDEX(...; $AD{row})` wrapper:

```
Principal!C3   =IFS(J3<=0,05; "00 ~ 05"; J3<=0,1; "05 ~ 10"; J3<=0,25; "10 ~ 25"; J3<=100; "25~100")
Principal!K3   =COUNTIF(M3:Q3; "<>"&"")
Principal!L3   the existing Nota formula, reading Principal!M:Q + 'Variáveis'!$B$3:$B$7
Principal!AD   DELETED — no MATCH into Merge is needed any more
```

`RANK`/`COUNT` still work on whole columns because the data now lives in `Principal`'s own
`M:Q` / `S:W` / `Y:AC`.

**Consequence to expect: every `Nota` value will shift.** The ranking population changes from
`Merge`'s row set (1,062 valid of 1,123) to `Principal`'s curated rows (1,080). Ranking among
the funds actually tracked is the more correct behaviour, but it is not a no-op and must not be
mistaken for a regression.

**New requirement on the writer.** Columns `C`, `K`, `L`, `R`, `X` are owned-but-formula: an
appended fund needs its formulas written with the correct row number, not a value. `writeKeyed`
must therefore support per-column formula templates alongside plain values.

### What the collapse subsumes — do NOT do these first

Sequencing note added 2026-09-21. Several backlog items only exist to prop up `Merge`, and
the collapse deletes them rather than completing them. Doing them first is wasted work:

| Item | Why the collapse subsumes it |
|---|---|
| **33.** repair the 59 `#REF!` rows on `Merge` 1065–1123 | The 18 missing funds are missing *because* `Merge` has a gap. Writing `Principal` directly from data admits them with no repair. Interim value only. |
| Guard `Merge!C`/`J` on `ISBLANK` | `Merge!J = ROUND(Fundos!C;2)` reads a blank as `0`, and `IFS` then bands it as lowest-risk. Measured, real — but it is a formula artifact. The Node writer computes Risco/Vol itself and writes a true blank. |
| `Merge` block-probing tooling | `check-merge-blocks.js`, `probe-merge-blocks.js`, `compare-blocks.js` described a sheet that no longer exists — all deleted 2026-09-21. |

### What survives the collapse — safe to do now

- The **keyed non-shrinking writer** (`src/fundos/sheet-writer.ts`). Unchanged by the collapse.
- **`Rentabilidade`** on that writer. The sheet stays (122 month columns) and its data source is healthy.
- **Cadastral source migration** (item 16) and **`CNPJ_FUNDOS` reconciliation**. Needed regardless of layout.
- **`Principal`'s presentation state** — filter widened to `AC` and declared at grid height,
  conditional-format debris cleaned. `Principal` is the surviving table.

### The no-delete rule survives, for a different reason

Today "blank, never delete" protects `Merge`'s row-pinned formulas (`=Rentabilidade!A{n}`,
`=Fundos!B{n}`). After the collapse those pins are gone — but the rule still holds, because
`Principal` carries **1,216 manual cells** (`Tipo`, `Resgate`, `M`, `Buy`) and **its row order
is itself human data**. Deleting a row destroys human input, and row-indexed conditional
formats and filter ranges shift under it. Same writer, same invariant, new justification.


Kill `Merge` and `Fundos`, keep `Principal` as the single table. The chain today is
strictly linear, with two mirror layers:

```
Rentabilidade(1062) ┐
Fundos(4366)        ├→ Merge ──28052──→ Principal ──2──→ Finalistas
Variáveis(3363)     ┘
```

`Principal` holds **28,052 formula cells whose only job is to copy `Merge`**
(1,121 rows x 25 columns). All three sheets are the same grain, one row per fund; they
are split by **writer**, not by data — Node writes `Fundos`, formulas plus `sortino.ts`
write `Merge`, the human writes `Principal`'s order and annotations.

**`Merge` carries zero conditional formats and no filter** — pure plumbing, so removing
it costs nothing in presentation. That is what makes the direction sound.

### What a rerun must not disturb — measured 2026-09-21

| Surface | State |
|---|---|
| `Principal` grid | 3,816 x 157, data to row 1,123, no frozen rows |
| `Principal` conditional formats | **40 rules** |
| `Principal` basic filter | range **`A2:W1137`**, live criteria on **5 columns** |
| `Finalistas` conditional formats | **47 rules** |
| `Finalistas` basic filter | range `A2:W33` |
| Hand-entered on `Principal` | column A order (1,080 literals), `D` Tipo 53, `E` Resgate 53, `F` M **0**, `G` Buy 30 |

**`F` ("M") is a deliberate second Buy channel, not an abandoned column.** Confirmed by
Vitor 2026-09-21: `G` ("Buy") records a buy recommendation for himself, `F` ("M") records
one **for other people**. Same semantics, different audience. It is empty only because it
has not been used lately.

So `Finalistas`' `=QUERY(... WHERE F = 'B' OR G = 'B' ...)` is **correct as written** —
"recommended to me OR to someone else". It currently yields 30 rows purely because all 30
marks live in `G`. Do not "simplify" that predicate, do not drop the column, and do not
read its emptiness as dead weight; the moment a mark lands in `F` the filter must pick it up.

Its header is cryptic, and renaming it is safe if ever wanted: `Finalistas` filters by
column **letter** (`F`), and `Filters.js` never references it, so a clearer header
(`Buy (outros)`) would break nothing.

1. **Row deletion breaks formatting; overwriting values does not.** Conditional-format
   ranges and the basic-filter range are row-index bound — insert/delete shifts and
   fragments them, writing over cells leaves them intact. So a keyed writer must
   **blank vacated cells, never delete rows**, and never lower `rowCount` (item 34's
   bug in another costume).

2. **The filter is already stale twice over.** `A2:W1137` stops at **W**, so it does not
   cover the bond block at `X:AC`; and it ends at row **1,137** while data ends at 1,123
   — grow past 1,137 and new funds fall outside the filter silently. `Finalistas`'
   `A2:W33` has the same column shortfall.

3. **Formatting debris is already accumulating** (item 10, now quantified).
   `Principal`'s 40 rules include fragments at `L1124:L1137` and `M1124:M1137`, aimed
   past the data. `Finalistas`' 47 include `M34:M35`, `N34:N35`, `I3:I35` from when its
   query returned 33-35 rows instead of today's 30. The effectively whole-column rules
   (`C3:C3816`, `H3:I3816`, `J3:J3816`) have stayed correct; the narrow ones rot.

### Invariants for the keyed writer
- Key on the CNPJ in column A; write ONLY the columns that writer owns.
- Append new funds below the last data row; never re-sort (row order is the human's).
- Blank the owned columns of a row whose key disappeared; never delete the row.
- Never lower `rowCount` or `columnCount`.
- Declare conditional formats and the filter range to the **grid height, never the data
  height**, and widen both to `AC`.

### Range and sort mechanics — tested 2026-09-21 on `Merge`

**There is no unbounded range.** A `GridRange` with `endRowIndex` omitted is stored
pinned to the sheet's current `rowCount`:

```
requested: {startRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1}
stored:    {startRowIndex: 2, endRowIndex: 2103, startColumnIndex: 0, endColumnIndex: 1}
```

`setBasicFilter` behaves identically (stored `endRowIndex: 2103`). This is exactly why
`C3:C3816` / `H3:I3816` / `J3:J3816` have stayed correct while `L1124:L1137` rotted — the
survivors were declared to the GRID height, the casualty to the DATA height. `Principal`
has 3,816 rows for 1,121 of data, so grid-height declarations cover ~2,695 funds of growth.

| Mechanic | Behaviour |
|---|---|
| Filter criteria | **live** — apply to appended rows automatically, if inside the range |
| Sort | **not live** — a one-time physical reorder; appended rows stay at the bottom |
| Filter range | **not extendable in place** — `setBasicFilter` replaces the whole filter, so widening requires resupplying criteria + sortSpecs |

All of it is readable from `spreadsheets.get` (`basicFilter.range` / `.criteria` /
`.sortSpecs`), so backup-and-reapply is safe. `Principal`'s live state: criteria on
columns **B, C, D, I, K** (the menu only sets C/D/K — B and I were set by hand) and a
**9-deep sortSpec stack** (L desc, J asc, B asc, A asc, R desc, Q desc, C asc, M desc,
F desc), which still includes `F` — the second Buy channel, currently unused.

Consequences for the plan:

- **One-time:** re-declare the filter as `A2:AC3816` carrying the 5 criteria and 9
  sortSpecs back verbatim; re-declare the rotted format fragments at grid height.
- **Per-run:** no filter or format work at all — appends land inside the range and
  criteria apply live.
- **Never sort in the writer.** Nothing re-sorts live, and `Sort Nota` is already the
  deliberate user action.
- **Only if the grid must grow past 3,816 rows** do formats and filter need re-extending,
  since both stay pinned at the old height.

`sortino.ts` already implements exactly this — keyed by column A, writes only
`M:Q`/`S:W`/`Y:AC`, touches no formula and no manual cell. Making `writeFundos` behave
the same way is the prerequisite for collapsing anything, and it independently fixes
item 34.

`Rentabilidade` stays separate regardless: same grain, but its 122 month columns would
make the collapsed table ~150 wide.

---

## P2 — robustness in the Apps Script


- [x] **5. `init()` sizes its read off the wrong sheet.** DONE — now `rentSheet.getLastRow()` / `getLastColumn()`.
  `rentSheet.getRange(2, 1, trackerSheet.getMaxRows(), trackerSheet.getMaxColumns())` asks 2,103 rows × 144 cols of an 1,081 × 135 sheet. It does not throw, but it hauls back ~1,000 padded blank rows every run. Fix: `rentSheet.getLastRow() - 1` and `rentSheet.getLastColumn()`.

- [x] **6. `cnpjs` is compacted while `rentabilidades` is not.** DONE — superseded: `calculateBlock` keys rows by CNPJ through `rentByCnpj`, so the index-alignment guard no longer exists to disarm.
  `.filter(p => !!p)` makes the two arrays different lengths and permanently disarms the `if(!cnpj) break;` guard in `calculateBlock`. It happens to work because all blanks are trailing. Fix: drop the filter and let the guard do its job.

- [x] **7. Protect `Merge` from being sorted.** OBSOLETE — `Merge` deleted. The concern TRANSFERS to `Principal`, where row order is human data: `setBasicFilter` re-applies `sortSpecs`, so always omit them when widening a filter.
  Nothing enforces the row-order invariant. Add a protected range on `Merge`, or a bold note in row 1.

- [x] **8. Two unguarded crashes in `sortino()`.** DONE — an unmerged row-1 label is skipped (`if (!merged.length) continue`), `isPeriodBlock()` rejects a non-period block, and `loadBenchmarkColumn` throws a named error listing the available columns.
  `merged[0]` is undefined if a row-1 label isn't merged (`SORTINO >>>` is merged on `Principal`/`Finalistas` as `I1:K1` — copy it into `Merge` row 1 and the loop dies). And `getRentabilidadesByName` does `.findNext().getRow()` with no null check, so a label with no matching `Indices` row throws. Fix: skip a column with no merged range, and report a missing index by name.

- [x] **9. The 122-month window is hardcoded in two places.** DONE on the Node side — `HISTORY_MONTHS = 122` in `fundos.ts` now drives the header set (`rentMonthKeys()`), the download range (`rentYearRange()`) and the column count. `appsscript/Sortino.js` still carries its own `122` for `parseMonthCount('T')`; the two agree by construction but are not shared, because Apps Script cannot import. Original text:
  `rentabilidades.map(p => p.slice(1, 123))` and `parseMonthCount('T') → 122`, whose comment says "10 anos - 1 mes" (which would be 119; 10 years is 120). Derive the width from `Rentabilidade`'s column count and fix the comment.
### The 122-month window, measured (item 9 context)

```
Rentabilidade: 134 month columns — newest 2025-02, oldest 2014-01
code reads slice(1, 123) = the newest 122 → 2015-01 .. 2025-02
12 columns (2014-01 .. 2014-12) are NEVER read
```

`122` appears twice and the two must agree: the read window `row.slice(1, 123)` and
`parseMonthCount('T') → 122`, which makes the "T" period a fixed 10-year window rather than the
total history its name implies. The comment says "10 anos - 1 mes" (119) while 10 years is 120,
so the literal matches neither. Derive both from `Rentabilidade`'s column count.


---

## P2 — Format.gs and Filters.gs

- [x] **10. `format()` accumulates conditional-format rules forever.** DONE — drops existing gradient rules instead of appending, emits ONE rule spanning `L:AC`, and sizes from `getMaxRows()`. `Principal` consolidated 40 -> 11 rules. **`Finalistas` then cleaned itself on the next click of `Formatar colunas`: 47 -> 12 rules** (11 boolean + 1 gradient `L3:AC969` at grid height), which is the idempotency proof — the old code would have pushed `Principal` to 29. Its basic filter was separately widened from `A2:W33` to `A2:AC969` (grid height), `sortSpecs` omitted.
  `getConditionalFormatRules()` → `push` → `set` adds 12 rules per sheet per run and never removes the old ones; `clearFormat()` doesn't touch them. Currently 22 rules on `Principal`, 40 on `Finalistas`, including two-cell fragments (`M34:M35`) left from older row counts. Fix: filter out rules whose range matches the target column before pushing. Also `var rules` shadows the parameter of the same name.

- [x] **11. `Filters.gs` resolves everything at module load.** DONE — `sheet_()`, `header_()`, `get_column()` and `getFilter()` all resolve per call, so a recreated filter or a moved column is picked up instead of throwing on a captured stale object.
  `const principalFilter = principal.getFilter()` is `null` when `Principal` has no filter, which makes every `filter_*` call throw — including via `format()`, which calls `filters_clear()` first — and goes stale if the filter is recreated in the UI. The four `get_column` calls plus three `SpreadsheetApp` lookups run on *every* execution in the project, `onOpen` included, which is what makes the menu slow. Fix: move them inside the functions.

- [x] **12. `get_column("Nota")` can only ever find the CDI column.** DONE — `get_column(name, occurrence)` scans the FULL header width (was capped at 20 columns, which could not even see `X`) and takes an occurrence index. `sort_nota_ibov()` / `sort_nota_bond()` added; a missing column now throws a named error listing the headers.
  `indexOf` returns the first match (column L), so `sort_nota()` cannot sort by the IBOV `Nota` in column R. Add an explicit block argument.

- [x] **13. `sort_column(col, ascending)` ignores both parameters.** DONE, and it was worse than described: it sorted `A3:Z` while the data now runs to `AD`, so `AA`/`AB`/`AC` (bond 36m/60m/T) and `AD` (MANUAL) stayed put while every other column moved — silent row misalignment on EVERY menu click, since all filters call `sort_nota()`. Introduced when the bond block was added; before that the data ended at `W`. Verified no damage had occurred yet (`15390/15390` recompute match). Now honours both parameters and sorts `getLastColumn()` wide.

- [x] **14. `filter_dp` passes `null`/`undefined` into `setHiddenValues`.** DONE — hidden values are built from the string set `0..5` minus what is kept, plus `''`. `0` is included, and no `null`/`undefined` reaches the API.

---

### DONE 2026-09-21 — periods relabelled `1Y 2Y 3Y 5Y 10Y`

Headers are the only definition of a period, so this was a header edit plus one parser change.
`parseMonthCount` now accepts `<n>Y` (years x 12) as well as `<n>m` and `T`, in BOTH
`src/fundos/sortino.ts` and `appsscript/Sortino.js`.

**The trap: `allowNonEmpty` was keyed on `months === 122`.** That flag is what makes the widest
period BEST-EFFORT — it truncates at the first gap instead of returning blank, which is why a
fund with 3 months of history still gets `DP = 1`. Relabelling `T` (122) to `10Y` (120) would have
made the equality fail, turning `10Y` strict and collapsing `DP` for every fund without 120 full
months. Replaced with the real intent: **the widest period in each block is best-effort**, computed
per block as `Math.max(...periods)`. Same generalisation in both implementations.

Measured after the change (1,026 funds):

```
period       same  changed   mean delta
  1Y..5Y     1026        0   -          (relabelling is value-neutral, as expected)
  CDI 10Y     838      188   +0.103876
  IBOV 10Y    838      188   -0.000998
  RFB 10Y     838      188   +0.122180
DP before: {1:59, 2:60, 3:98, 4:268, 5:541}
DP after:  {1:59, 2:60, 3:98, 4:268, 5:541}   <- identical, so the trap was avoided
error cells: 0
```

The 188 changed funds are those with >=120 months, where dropping 122 -> 120 months moves the
number. The identical `DP` distribution is the proof that best-effort still applies to the widest
period.

**`verify-sortino.js` had the same 122 hardcoded** and reported 14826/15390 after the relabel —
the verifier was stale, not the sheet. It now READS the period labels from `Principal!A2:AC2` and
derives the widest-period rule itself, so a future relabel cannot silently invalidate it. The
Sortino math stays an independent implementation. Back to **15390/15390**.

### DONE 2026-09-21 — `RENT_MONTHS` renamed `HISTORY_MONTHS`

`RENT` was short for *rentabilidade*, but the name reads as "rental months" and Vitor had to ask what
it meant — which is the only evidence a name needs. It answers "how far back do we keep returns", so
`HISTORY_MONTHS` says it. Entries above use the new name throughout; the symbol was called
`RENT_MONTHS` until this commit.

The dead `export {HISTORY_MONTHS}` re-export in `fundos.ts` went with it — nothing imported the
constant through that module, and leaving a public re-export implies a consumer that does not exist.

### DONE 2026-09-21 — one limit in the writer, `T` derived from the data

Vitor's decomposition: the WRITER decides how much history to retain (10 years, everything, it does
not matter), and `T` means *all data available for that fund* within whatever was retained. A fund
with 3 years gets a 3-year Sortino; a fund with 20 years gets as much as the sheet holds. The point
is that the limit is then set in exactly ONE place.

`T` is no longer a number. `parseMonthCount('T')` returns **`Infinity`**, so:

- `rents.slice(0, Infinity)` is the whole row — no cap of its own
- `Math.max(...periods)` makes `T` the widest period, which is already the best-effort one, so
  `calcSortino` truncates at the fund's first missing month
- the read width comes from `rentMonthColumns(headerRow)`, which walks row 1 and stops at the first
  cell that does not parse as a month — so a cleared or ragged tail is excluded automatically

That removes the window constant from every consumer. It now exists in `src/fundos/window.ts` and is
read only by the writer (`rentMonthKeys`, `rentYearRange`, the trim message). `sortino.ts`,
`appsscript/Sortino.js` and `verify-sortino.js` carry **no** window literal at all — before this
there were four, and `appsscript/Sortino.js` was unfixable-by-import, which is what made the
duplication permanent.

Also deleted two dead Apps Script globals (`rentabilidades`, `cnpjs`), assigned in `init()` and read
nowhere since the CNPJ-keying rewrite — they were the last `HISTORY_MONTHS` consumers there.

**Measured effect.** The live sheet still holds the March-2025 vintage: 134 month headers of which
the oldest 12 (2014) are empty, so 122 populated. `T` therefore rose 120 -> 122 months:

```
T cells changed: 564  = 188 funds x 3 blocks   (those with >=120 months)
DP: {1:59, 2:60, 3:98, 4:268, 5:541}           unchanged
effective months per fund: median 62, max 122
9.99 sentinel T cells: 5 -> 4                  (one fund gained a down month)
independent recompute: 15390/15390             error cells 0
```

**Consequence to keep in mind:** `T` now tracks the sheet rather than a constant, so it is 122 today
and becomes 120 after the next `npm run rentabilidade` (window 120 + the stale-tail trim). If more
history is wanted, raise `HISTORY_MONTHS` — that one number moves the download, the headers, the trim
and `T` together.

### DONE 2026-09-21 — the window is a hard cap, and the stale tail is now cleared

`Rentabilidade` IS capped. `rentMonthKeys()` emits exactly `HISTORY_MONTHS` keys and
`writeRentabilidades` writes `['CNPJ_FUNDO', ...rentMonthKeys()]` — **121 columns, 120 months**,
newest first. There is no "keep whatever history exists" path; a fund with 200 months of quotas
contributes only the newest 120, and the download range is derived from the same keys.

**The gap: `writeKeyed` never shrinks, by design.** `columnCountAfter = Math.max(columnCountBefore,
headers.length)` and every `updateCells` range ends at `headers.length`, so columns past the window
are neither written nor cleared. The live sheet is 135 columns wide from the March-2025 run, so the
next `npm run rentabilidade` would have left a **14-column stale tail**:

```
window now:  120 months, 2026-08 .. 2016-09        (121 columns)
live grid:   135 columns, headers 2025-02 .. 2014-01
untouched:   columns 122-135 = 2015-02, 2015-01, 2014-12 ... 2014-01
```

The sheet would then read `… 2016-10, 2016-09, 2015-02, 2015-01, …` — a break in the sequence, with
two data vintages side by side. Harmless to Sortino, which slices the first `HISTORY_MONTHS` columns
and never sees the tail, but dangerous the moment anyone raises `HISTORY_MONTHS` or reads the sheet by
header: those old columns would then be consumed as if current.

`blankColumnsBeyond(sheetTitle, keepColumns)` in `sheet-writer.ts` clears values (headers included)
in every column past the window, and `writeRentabilidades` calls it after the keyed write, reporting
the count. It does NOT resize the grid — `writeKeyed`'s never-shrink contract exists to keep
positional references valid, and leaving the columns present-but-empty avoids re-creating the
grid-height-equals-data-height trap hit earlier today.

Not yet executed: the trim only runs inside a `rentabilidade` run, which has not happened.

### Where `122` came from (answered 2026-09-21)

The number was a **snapshot of a moving quantity**, and the hypothesis that "T meant everything,
and everything happened to be 122 months" is exactly right.

The original, pulled from the live Apps Script into git only on 2026-09-20 (`606e19f`) — it predates
this repo's history, having been written in the Sheet itself:

```js
if(periodName.toUpperCase() === 'T'){
  return 122; // 10 anos - 1 mes;
}
```

The populated width of `Rentabilidade` was never a constant. Headers spanned 12 years truncated at
the current month (`132 + currentMonth` columns), while the download covered only 11 years because
of `range`'s exclusive stop — so the oldest 12 columns were always empty:

```
populated months = (132 + currentMonth) − 12 = 120 + currentMonth
```

That equals **122 only in February**. The live sheet was last written 2025-02, and its populated
region measures exactly `2015-01 .. 2025-02` = 10 full years + 2 months = **122**, with all 12 of
the 2014 columns present and empty. So `slice(1, 123)` was not an arbitrary 122 — it was "every
column that actually has data", correct on the day it was written and silently wrong every month
since. The `10 anos - 1 mes` comment (119) matched neither.

**Fix: one constant, one round number.** `src/fundos/window.ts` now holds `HISTORY_MONTHS = 120` and
is the single definition. It was previously four independent literals — `HISTORY_MONTHS` in
`fundos.ts`, `RENT_MONTH_COUNT` and the `T` cap in `sortino.ts`, `slice(1, 123)` twice plus the `T`
cap in `appsscript/Sortino.js`, and a padding width in `verify-sortino.js`. `T` is now defined AS
the window (`TOTAL_PERIOD_CAP_MONTHS = HISTORY_MONTHS`), which is the original intent — T is
everything — expressed so it cannot drift from what the sheet actually holds.

120 rather than 122 because 122 has no meaning beyond "a February run", and the pending
`npm run rentabilidade` shifts the window forward 18 months regardless, so preserving the two
oldest months buys nothing. Values unchanged: **15390/15390**.

### DONE 2026-09-21 — widest period relabelled back `10Y` -> `T`, capped at 120 months

`10Y` was the wrong NAME for a column that was never a 10-year comparison. The widest period is
best-effort, so for a fund with 40 months of history it holds a 40-month figure. Only **190 of
1,080** funds in `Rentabilidade` have the full 120; 836 have less. Labelling that `10Y` invites
reading it as a like-for-like decade comparison, which it is not for 4 funds in 5.

`T` (total, capped at 120) describes it correctly: *the fund's whole life, up to ten years*. The
computation did not change at all — `TOTAL_PERIOD_CAP_MONTHS = 120` equals the `10Y` it replaced,
so **15390/15390** cells still match and the `DP` distribution is byte-identical.

```
headers: 1Y | 2Y | 3Y | 5Y | T      (x3 blocks, Q2 / W2 / AC2)
T = 120 months, best-effort (a CAP, not a requirement)
DP: {1:59, 2:60, 3:98, 4:268, 5:541}   unchanged
independent recompute: 15390/15390     error cells: 0
```

**Best-effort on the widest period is load-bearing for `Nota`, not a convenience.** The denominator
is `INDEX('Variáveis'!$C$3:$C$7; $K)` — a CUMULATIVE weight indexed by `DP`, whose rows are ordered
`T, 12m, 24m, 36m, 60m`. That ordering assumes `T` is the term a fund gets FIRST: `DP = 1` means
`T` alone is populated, `DP = 2` means `T` + `12m`, and so on. The formula confirms it —
`'Variáveis'!$B$3` multiplies column `Q` (the widest), while `$B$4..$B$7` multiply `M..P`. So if the
widest period were ever made strict, the 59 `DP = 1` funds would lose their only term and score 0.

Contiguous months of history per fund, measured on `Rentabilidade`:

```
0 months: 54    1-11: 59    12-23: 60    24-35: 98    36-59: 268    60-119: 351    120+: 190
median 60   p90 122   14 funds have an interior gap (truncated there, so T = months since the gap)
```

**Open, and it needs a decision.** `Variáveis` weights are now `T=1, 12m=1, 24m=1, 36m=1, 60m=1`
(`T` was 0 in an earlier session), so `T` DOES feed `Nota` — and it is the one term where funds are
ranked on unequal windows, a 3-month Sortino percentile-ranked against a 120-month one. Either
accept that (it is what makes short-history funds rankable at all) or set `T=0` and let `Nota` rest
on the fixed windows only. The `Variáveis` labels `12m..60m` are also now stale against
`1Y..5Y`; renaming them is cosmetic since the mapping is by explicit cell reference, not by label.

### DONE 2026-09-21 — `Rentabilidade` extracted to its own entry point

`writeRentabilidades()` was reachable only through `run()` — bundled with the blocked cadastral
crawl, and with no npm script pointing at it. Now:

```
npm run rentabilidade        # download quotas for the derived window and write the sheet
npm run rentabilidade:dry    # download and report month coverage, write nothing
```

**One constant replaces three disagreeing spans.** `HISTORY_MONTHS = 122` drives all of them:

| was | now |
|---|---|
| headers: a 12-year loop -> 134 columns | `rentMonthKeys()` -> exactly 122 months, 123 columns |
| download: `range(cy, cy-11, -1)` -> **11 years** (stop is exclusive) | `rentYearRange()` -> every year the window touches |
| read window: a separate literal `122` | the same `HISTORY_MONTHS` |

**That off-by-one is why the live sheet carries 12 empty columns.** Proven:

```
range(2026, 2015, -1) = [2026..2016]     -> 11 years downloaded
header loop 2026..2026-11 = [2026..2015] -> 12 years of headers
years with headers but NO download: 2015
```

The March-2025 run generated headers for 2025..2014 but downloaded only 2025..2015, so all 12 of
the 2014 columns got a header and no data — exactly what the sheet shows
(`{"2014":0,"2015":12,...,"2025":2}`). Verified against the new code: `years missing from
download: []`.

**Not yet run, deliberately.** Today's window is `2016-07 .. 2026-08`, needing 11 years of CVM
`INF_DIARIO` daily-NAV files. `.cache` holds only `cadastros`, so the first run downloads all of
it (132 monthly CSVs, hundreds of MB). It also SHIFTS every column — the live sheet ends at
2025-02 — which moves every Sortino value and therefore every `Nota`.

## P2 — the Node pipeline

- [x] **35. `Volatilidade` folded into `Cadastro`.** DONE 2026-09-21 (step 1 of 2).
  `Cadastro` and `Volatilidade` were the same grain — 1,080 rows, same key set, **identical
  key order** — so `Volatilidade!B` became `Cadastro!C`.

  | Step | What |
  |---|---|
  | data | `Cadastro` widened to 3 columns, `VOLATILIDADE` written to `C`; verified **0 differences** against `Volatilidade!B` on all 1,080 rows |
  | `Merge!J` | 1,062 formulas repointed `=ROUND(Volatilidade!B{n};2)` → `=ROUND(Cadastro!C{n};2)`; the 59 `=ROUND(#REF!;2)` rows deliberately left for item 33 |
  | verify | `Merge!J` matches `ROUND(vol,2)` on all 1,033 valid numeric rows, 0 mismatches (29 blank-volatility rows, 59 `#REF!` rows) |
  | code | `writeVolatilidades` → pure `computeVolatilidades(quotas)`; `writeCadastros(doc, csv, volatilidades)` now writes 3 columns; `run()` no longer writes a `Volatilidade` sheet |

  The code change was **not optional**: `writeToSheetNew` resizes to `headers.length`
  columns, so the next run would have deleted a hand-added column C.

  40 of 1,080 funds have no volatility value; they are written blank, not zero.

  **The `Volatilidade` sheet was deleted 2026-09-21** after an exhaustive reference scan
  (`node scripts/find-sheet-references.js Volatilidade`) returned zero formula cells, zero
  named ranges and zero conditional formats pointing at it. Post-delete error counts were
  unchanged (`Merge` 236 = 59 rows x 4 columns, `Principal` 1475 = 59 x 25, `Finalistas` 6),
  confirming no new `#REF!`. Final contents snapshotted to `docs/volatilidade-snapshot.json`.

  Remaining for a single fund table (step 2): fold in `Corretoras`. **DONE 2026-09-21.**

- [x] **36. `Corretoras` folded in, and the table renamed to `Fundos`.** DONE 2026-09-21.
  The single fund table is `Fundos`: `CNPJ_FUNDO | DENOM_SOCIAL | VOLATILIDADE | BTG | XP | MANUAL`
  (1,080 rows), renamed from `Cadastro` once it stopped being just a registry.

  The rename was done with `updateSheetProperties`, which makes Sheets rewrite every
  reference itself: **all 4,368 formula cells** repointed to `Fundos!` with **0 value changes**
  (`Merge` 4,366 = 1062 B + 1121 H + 1121 I + 1062 J, plus 2 in `Missing`). Error counts held
  at `Merge` 236 / `Principal` 1,475 / `Finalistas` 6. In code only the sheet-name string and
  `writeCadastros` -> `writeFundos` changed; `getCadastros` keeps its name because it reads the
  CVM *cadastro* CSV, which really is called that.

  Note `Missing` is a live diagnostic over this table --
  `=FILTER(Fundos!A:A;ISNA(MATCH(Fundos!A:A;Principal!A:A;0)))` and the reverse -- so it is
  where the 18 funds of item 30 surface.
  `Merge!H/I` went from a whole-column double-criteria scan to a plain cell reference:

  ```
  before: =COUNTIFS(Corretoras!$A:$A; "="&H$2; Corretoras!$B:$B; "="&$A3)>0
  after:  =Cadastro!D2
  ```

  That removes **2,242 whole-column scans per recalculation** (2 brokers x 1,121 rows over a
  1,306-row range).

  **Derived from the live sheet, not the code constants** — deliberately, so values could be
  proven unchanged: all **1,062 valid rows identical, 0 changed**. The 59 `#REF!` rows now
  show real flags instead of `false`; cosmetic, since they are excluded from Sortino, `Nota`
  and `Principal` alike.

  Positional (`=Cadastro!D{r-1}`) rather than a lookup is safe because `Rentabilidade!A` and
  `Cadastro!A` are positionally identical — verified, **0 differences over 1,080 rows** — and
  it matches how `Merge!B` and `Merge!J` already work.

  `Filters.js` needed no change at all, as predicted: it resolves columns by header **name**
  (`get_column`), `Principal!H/I` were already headed `BTG`/`XP`, and only the right-hand side
  of the formula moved.

  **The code constants have drifted from the sheet.** The next full `run()` will change these
  flags materially:

  | | code constants | live sheet |
  |---|---|---|
  | XP | 705 | 604 funds (608 rows) |
  | BTG | 663 | 672 |
  | MANUAL | 8 | 26 |
  | distinct funds | 1,139 | 1,080 |

  Also `Corretoras` holds **4 duplicate** fund/broker rows (1,306 rows → 1,302 distinct pairs),
  and `writeCorretoras` **never writes `MANUAL_FUNDOS`** — so the sheet's 26 `MANUAL` rows are
  hand-maintained and a full run would drop them to 0. Worth fixing before the next full run.

  `Corretoras` is now unreferenced by any formula (`node scripts/find-sheet-references.js
  Corretoras` → clean) but `writeCorretoras` still writes it, so do not delete the sheet
  without removing that call first.


- [x] **15. Reconcile `currentYear = 2022` with reality.** DONE for `Rentabilidade` — `runRentabilidades()` derives its window from the current date, so no year constant can expire. `run()` still carries the 2022 pin for the cadastral path; that dies with item 16. Origin found: commit `eb14851` (2022-10-06) set it in the SAME change that uncommented the quota download — a debugging pin that was correct that day. It cannot have produced the live sheet, which holds 2025 data, so the code that actually ran had a different value. Original text:
  `fundos.ts` `run()` caps the quota download at 2022, yet `Rentabilidade` holds real returns through 2025-02. The committed code cannot have produced the live sheet — either the constant was edited locally and never committed, or a newer copy exists elsewhere. Running the repo as-is would blank the 2023-2025 columns. Settle this before the next run.

### Universe refresh — measured, and the key is `CNPJ_Fundo` NOT `CNPJ_Classe`

Measured 2026-09-21 by `scripts/probe-cvm-registry.js` against
`registro_fundo_classe.zip`, compared with the 1,080 live `Principal!A` keys:

```
registro_fundo.csv    90,218 rows   CNPJ_Fundo   81,373 distinct   matches 1080/1080 (100.0%)
registro_classe.csv   36,753 rows   CNPJ_Classe  36,740 distinct   matches  946/1080  (87.6%)
```

**An earlier note in this file said to key on `CNPJ_Classe` under RCVM 175. For identity that
is wrong and destructive**: it matches only 946 of the 1,080 rows, so it would orphan **134
funds' worth of hand-entered `Tipo` / `Resgate` / `M` / `Buy`**. `CNPJ_Fundo` matches 100%,
so `Principal!A` needs no reindexing at all and every manual annotation stays attached.

`CNPJ_Classe` is still needed, but only as the **NAV lookup**, never as the key.

Resolved shape of the refresh:

| Need | Source | Coverage |
|---|---|---|
| Identity / key | `registro_fundo.CNPJ_Fundo` | **1080/1080** |
| Fund name | `registro_fundo.Denominacao_Social` | **1080/1080** (vs 112 all-`CANCELADA` from `cad_fi.csv`) |
| Fund → class join | `ID_Registro_Fundo`, present in BOTH files | 921/1080 resolve to ≥1 class |
| NAV / rentability | `INF_DIARIO` keyed on `CNPJ_Classe` | 921 funds, all with ≥1 live class |

**`registro_fundo.csv` is NOT unique on `CNPJ_Fundo`** — 90,218 rows for 81,373 distinct CNPJs.
A first pass here keyed a Map by CNPJ (last-write-wins) and reported 921 live / 159 dead; that
was an artifact of picking an arbitrary row per fund. Corrected counts, treating a fund as live
when ANY of its rows is `Em Funcionamento`:

```
rows per CNPJ:  {1: 995, 2: 72, 3: 12, 4: 1}     85 of the 1,080 funds have >1 row
CORRECTED:      946 live, 134 dead
```

The duplicates are **re-registrations**, and they change `Tipo_Fundo`:

```
45.123.558/0001-00  ID=1523   FII      Cancelado                reg 2022-04-08  canc 2025-09-30
45.123.558/0001-00  ID=88762  FIAGRO   Em Funcionamento Normal  reg 2025-09-30
```

So the crawler MUST dedupe on `CNPJ_Fundo` preferring the live row (or the latest
`Data_Registro`). 55 of the 85 are exactly one `Cancelado` + one `Em Funcionamento` pair.

Refinement of the key argument above: the 134 CNPJs that `CNPJ_Classe` fails to match are
**exactly the 134 dead funds** — for a live single-class fund the class inherits the fund's CNPJ,
which is why `CNPJ_Classe` matches 946 and live funds number 946. So keying on `CNPJ_Classe`
would orphan the cancelled funds specifically, not an arbitrary scatter. `CNPJ_Fundo` is still
the right key, because `Principal` tracks dead funds too and carries manual annotations on them.

Class cardinality: **920 funds map 1:1 to a class, exactly 1 fund has 2 classes** — that single
case needs a pick rule (prefer the live class) before the NAV fetch can be fully automatic.

- [ ] **16. Migrate off the dead CVM cadastral file.** **BLOCKING `writeFundos`.**
  Measured 2026-09-21 via `node scripts/dry-run-fundos.js` (read-only), against a live
  snapshot of `Fundos` saved to `docs/fundos-final-snapshot.json` (1,080 rows):

  ```
  getCadastros():      112 rows, 110 distinct CNPJ, SIT = {"CANCELADA": 112}
  CNPJ_FUNDOS:         1,139 distinct        live Fundos rows: 1,080
  would be padded:     1,029  (no cadastro row at all)
    of those, live rows WITH a name that would be blanked: 424
  would be appended:   394    (in CNPJ_FUNDOS, not in the sheet)
  would be blanked:    335    (in the sheet, not in CNPJ_FUNDOS)
  ```

  So a `writeFundos` run today **wipes 424 fund names** and churns ~730 rows. Two
  independent causes, both must be fixed before any run:
  1. `cad_fi.csv` yields only 112 rows for the 1,139 tracked funds, every one
     `CANCELADA` — names cannot be sourced from it at all.
  2. `CNPJ_FUNDOS` has diverged from the sheet in BOTH directions (335 live keys absent
     from the constant, 394 constant keys absent from the sheet). They share 745 keys.
     The sheet is the human-curated truth; the constant is stale.

  The keyed writer contains the blast radius — it blanks instead of deleting, so no
  `#REF!` is produced — but it cannot protect against bad input. Do not run `writeFundos`
  until the cadastral source is migrated and `CNPJ_FUNDOS` is reconciled against the sheet.
  <!-- original note follows -->
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

- [ ] **22. Add Sharpe.** Same excess-return array as `calcSortino`, two-sided `stdev` in the denominator. Would need a FOURTH merged block (`Merge` is gone; blocks now live on `Principal` row 1, currently `L:Q` CDI, `R:W` IBOV, `X:AC` Risk Free Bond) plus six columns.

- [ ] **23. Decide whether to annualize.** The current ratio is monthly. `×√12` makes it comparable to published figures; it does not change any ranking.

- [ ] **24. ONE maintained-but-unread `Indices` series.** `Risk Free Bond` is now read (it is the `X:AC` block). Only **`6 % a.a.`** remains filled 189/189 and read by nothing — `sortino()` processes only the labels merged in `Principal` row 1, which are `CDI`, `IBOV`, `Risk Free Bond`. Either give it a block or stop maintaining it. Same for the `Dif` row in `Manual`.

- [x] **31. `T` now carries weight 1.** DONE 2026-09-21, at the user's instruction.
  `Variáveis!B3` changed `0 → 1`. `Acumulado` is a running total (`=B3`, `=B4+C3`, …) so
  one cell was enough: `C3:C7` went `0,1,2,3,4` → `1,2,3,4,5`.

  Effect, measured with `node scripts/compare-nota-weights.js` (script since deleted; it reproduced the
  sheet's `Nota` on 1019/1019 funds, so the comparison is trustworthy):

  | | CDI | IBOV |
  |---|---|---|
  | funds now ranked | 1019 (+52) | 1019 (+52) |
  | changed position | 961 of 967 | 959 of 967 |
  | largest move | 300 places | 390 places |
  | new entrants to top 10 | 6 | 4 |

  The 52 newly-ranked funds are the `K=1` rows that previously divided by zero. The 102
  `K=0` rows stay blank — they hold no period data at all.

  **Ordering mattered here.** Item 28's 59 `#REF!` rows carried a value *only* in the `T`
  column. Weighting `T` before clearing them would have pulled 59 junk values into
  `COUNT(Q:Q)` and every fund's percentile. They were cleared first, so `T`'s weight now
  ranks real funds only.


- [ ] **25. Volatility hardcodes 2018.** `writeVolatilidades` filters `DT_COMPTC >= 2018` and recomputes `m.sqrt(252)` inline while the `SQRT_252` const sits unused. Make the start year a parameter.

- [ ] **26. Move the service-account key out of `~/Downloads`.**

- [ ] **35. Revisit `HISTORY_MONTHS = 120`.** Deferred 2026-09-21 — keep 120 for now. It is the single
  knob for how much return history is kept, and `T` follows it automatically, so raising it is a
  one-line change plus a re-download. Worth revisiting because **188 of 1,026 funds** sit at the
  ceiling — their history fills the whole window, so `T` is truncated by the window rather than by
  their real lifetime, which is the opposite of what `T` is meant to mean. How much longer those
  funds actually ran is unknown from the sheet alone. Cost of raising it: `rentYearRange` widens, so
  the CVM `INF_DIARIO` download grows by roughly 12 monthly CSVs per extra year, and every Sortino
  and `Nota` moves.
  `/Users/vcd/Downloads/fundos/config/fundos-309615-2795009f4d3e.json` grants **edit** rights on the document. `fundos.ts` expects it at `config/fundos-309615-2795009f4d3e.json` relative to cwd, and `.gitignore` already names that exact filename — so *move* (not copy) it into the repo's `config/`. Broaden the ignore to `config/` so a rotated key with a new filename is still covered.

- [x] **27. Get the Apps Script into version control and deployable via `clasp`.** DONE — `appsscript/` is tracked and `npm run gs:deploy` pushes AND verifies (defends clasp#507 and the non-TTY manifest skip).

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
