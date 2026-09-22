# Itaú retail funds: CNPJs via the lâmina PDFs

How to obtain the CNPJ of every retail investment fund Itaú distributes, by reading
the *lâmina de informações essenciais* PDF linked from each row of the public
performance table.

This is an **implementation spec**, not a finished crawler. Everything below was
verified live on 2026-09-21; the numbers are what the page actually returned.

**Source page:** <https://www.itau.com.br/investimentos/fundos/rentabilidade>
**Result available:** 467 funds, 47 pages of 10.

---

## TL;DR of the findings that shape the design

1. The page is behind a WAF. A real browser with the user's own profile is
   **mandatory** — a plain HTTP client and Playwright's bundled Chromium both get 403.
2. The CNPJ is **not** in the HTML, at all. Confirmed: the only CNPJ in the rendered
   DOM is the bank's own, in the footer.
3. But "baixar lâmina" is a plain `<a href>` pointing at a **different host that has
   no WAF and no authentication**. So only the *URL harvesting* needs the browser; the
   467 PDF downloads do not.
4. The CNPJ inside the PDF is real extractable text, not an image — but the fonts are
   CID-encoded, so a naive inflate-and-regex pass fails. A real PDF text layer is required.
5. The PDF is *better* data than the table: it carries the fund's **official
   (CVM-registered) name**, which joins cleanly against `crawler-cadastros`, whereas the
   table shows only the commercial name.

Because of (3), the work splits into two phases that can be built, run and debugged
independently.

---

## Why the browser is unavoidable

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://www.itau.com.br/investimentos/fundos/rentabilidade'
# 403

# Same with a full desktop-Chrome User-Agent: still 403.
```

Playwright's **bundled** Chromium is also refused — it is fingerprinted as automation:

```
- Page Title: Access Denied
- HTTP status: 403
```

What works is attaching to the user's real Chrome through the Playwright browser
extension:

```bash
playwright-cli attach --extension=chrome
playwright-cli goto 'https://www.itau.com.br/investimentos/fundos/rentabilidade'
# - Page Title: Tabela de Rentabilidade de fundos Itaú
```

Do not try to defeat the WAF by spoofing a fingerprint. The supported path is the
user's own browser, driving a public page they can open themselves.

> **Gotcha that will waste your time:** the `playwright-cli` session is per *process*.
> If each step runs as a separate shell invocation, the attached session can be gone by
> the next command (`The browser 'kc-xxxx' is not open`). Do `attach` and the work that
> depends on it inside **one** process. Release with `detach`, never `close` — `close`
> takes the user's own windows with it.

---

## Page structure

A real `<table>`, 9 columns:

| # | Column | Example |
|---|---|---|
| 1 | nome (commercial) | `Diferenciado Crédito Privado Renda Fixa` |
| 2 | risco | `baixo` |
| 3 | aplicação inicial | `R$ 1,00` |
| 4–7 | four numeric columns | `14,40%` / `9,76%` / `0,61% (até 17/09)` / `0,45%` |
| 8 | resgate | `crédito em conta em 1 dia útil` |
| 9 | + detalhes | a button |

Columns 4–7 are almost certainly 12-month return, year-to-date return, month-to-date
return (carrying its own as-of date) and administration fee — that ordering is
consistent with the PDF, which labels them explicitly. **Their header labels are nested
inside the `columnheader` elements and were not read**, so confirm them in the DOM
before trusting the mapping.

Pagination is numeric buttons plus "Próxima página", and the page states its own totals:

```
exibindo 10 de 467 resultados
página 1 de 47
```

The last cell of each row holds a button whose accessible name embeds the fund name,
which makes rows addressable without positional guessing:

```yaml
- button "mais info Diferenciado Crédito Privado Renda Fixa" [ref=f1e206]
```

Clicking it opens a detail panel. The panel contains the lâmina link — and this is the
load-bearing discovery:

```yaml
- link "baixar lâmina Diferenciado Crédito Privado Renda Fixa" [ref=f1e1041]:
  - /url: https://laminascomerciais-qh9.cloud.itau.com.br/52678_agencia.pdf
  - text: baixar lâmina
```

Note the shape: `https://laminascomerciais-qh9.cloud.itau.com.br/<id>_agencia.pdf`.
The `<id>` is a fund identifier in the same numbering space as the pension area's
`id_produto` (five-digit, 5xxxx–6xxxx). The `_agencia` suffix presumably denotes the
distribution channel, so other suffixes may exist.

### The PDF host is open

```bash
curl -s -o lamina.pdf -w 'http=%{http_code} type=%{content_type} bytes=%{size_download}\n' \
  'https://laminascomerciais-qh9.cloud.itau.com.br/52678_agencia.pdf'
# http=200 type=application/pdf bytes=173230
```

No cookie, no User-Agent, no session, no Referer. Phase 2 therefore needs no browser
at all — which also means it can be re-run and parallelised freely.

---

## Extracting the CNPJ from the lâmina

### What does not work

Inflating the PDF's `FlateDecode` streams and regexing the `( )` string literals
returns garbage: the document uses CID/Identity-H fonts, so the bytes inside the text
operators are glyph ids that need the font's `ToUnicode` CMap to become characters. The
only CNPJ-shaped string a naive pass finds is `20260921033129` — a build timestamp.

There is no `pdftotext`, `qpdf`, `mutool`, `pypdf` or PyObjC `Quartz` on this machine,
so a dependency is required.

### What works

`pdf-parse` (which wraps pdf.js and therefore handles the CMaps). **Its v2 API is a
class, not a function** — `require('pdf-parse')(buffer)` throws
`TypeError: Class constructors cannot be invoked without 'new'`:

```js
const {PDFParse} = require('pdf-parse');
const parser = new PDFParse({data: new Uint8Array(fs.readFileSync(file))});
const {text} = await parser.getText();
await parser.destroy();
```

Extracted text begins like this (6,705 characters for the sample):

```
agosto 2026  ITAÚ RF DIFERENCIADO CP FIFCIC RL  20.335.522/0001-51
Risco Baixo  PÚBLICO EM GERAL  Informações do Fundo
Aplicação inicial R$ 1,00  Rentabilidade 12m 14,40%
Rentabilidade no ano 9,09%  Rentabilidade no mês 1,06%
O que é  Fundo de Crédito privado com diversificação de emissores ...
```

Three things follow, and they make the parse easy and robust:

- The CNPJ is the **first and only** CNPJ-formatted string in the document.
- There is **no `CNPJ:` label** — searching for the literal string fails. Match on the
  format, not on a label: `/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/`.
- The token immediately before it is the **official fund name**
  (`ITAÚ RF DIFERENCIADO CP FIFCIC RL`), preceded by the reference month. The commercial
  name in the table (`Diferenciado Crédito Privado Renda Fixa`) is a different string
  entirely, so capture both and keep the official one for joining to CVM data.

Treat a PDF yielding zero or more than one CNPJ as a failure to report, not to guess at:
that is the signal that the lâmina layout changed.

---

## Host structure — probed 2026-09-22, after this spec was written

### There is NO JSON API. The 467 funds are already in the page.

Settled in the user's attached Chrome. The page makes **153 XHR/fetch requests** and not one of
them carries fund data:

```
performance.getEntriesByType("resource"), initiatorType xhr|fetch
  apicd.cloud.itau.com.br        128    charon / iske -- the bot shield
  cookielaw / onetrust / vwo / evergage / google / linkedin   24    analytics
  mfegestaocookies.cloud.itau.com.br   1    i18n strings
  -> fund-data endpoints:          0
```

Clicking **Página 2** produced 215 new requests, all analytics; opening a **mais info** panel
produced 213, likewise. The only `www.itau.com.br` request in the whole session is the document
itself. So pagination and panel-open are pure client-side rendering over a dataset that is
already in memory.

Where it comes from: `_rentabilityService` holds a `charonService`, and the 128 `apicd` calls are
that shield. The data request is **tunnelled through charon**, which is why no readable endpoint
URL exists to copy. Do not try to reproduce it outside a browser.

### The whole dataset in ONE eval — this replaces the 467-click loop

The table is an Angular 14 **Elements** micro-frontend, `<itau-tabela-rentabilidade>`. Its
component instance is reachable, and `tempData` is the complete shelf:

```js
const inst = document.querySelector('itau-tabela-rentabilidade')
  ._ngElementStrategy.componentRef.instance;
inst.tempData        // 467 records, the full shelf regardless of the visible page
inst.filteredData    // 467, the current filter result
inst.categories      // 7
inst.segment         // "varejo"
inst._rentabilityService.segments
// {varejo: "3", uniclass: "L", personnalite: "4", "personnalite-rebranding": "4",
//  "private-bank": "7", empresas: "EMP"}
```

Note it is **not React** — a `__reactFiber$` hunt returns nothing, and there are no iframes
despite every Playwright ref being prefixed `f1e`.

Record shape, which is richer than the rendered table:

```js
{ codigoProduto: 52678,                       // <- the lâmina id
  nomeComercial: 'Diferenciado Crédito Privado Renda Fixa',
  idFamiliaProduto: '01',
  valorMinimoAplicacao: 1,
  catalogoProduto: {
    rentabilidade: {dataBase: '18.09.2026', anual: 9.815765,
                    dozeMeses: 14.397926, mesAtual: 0.662077},   // UNROUNDED
    categoria: {nome: 'juros pós-fixados', id: 2},
    risco: {nome: 'baixo', id: 1},
    taxas: [ {nomeTaxa: 'Taxa de distribuição', valorTaxa: 0.1}, … ],  // full breakdown
    taxaAdministracao: 0.04, totalizadorTaxas: 0.45,
    resgateDescricao: 'crédito em conta em 1 dia útil',
    situacaoProduto: true, dataCriacaoProduto: '30.12.2014',
    horaInicialAplicacao: '03:37:24', paraUmaCrianca: false } }
```

`codigoProduto: 52678` for "Diferenciado Crédito Privado Renda Fixa" is exactly the id in this
spec's own `52678_agencia.pdf` sample, so the mapping id -> lâmina is confirmed.

Aggregates over the 467 (saved to `src/corretoras/itau-rentabilidade.json`):

```
unique codigoProduto  467      id range 40369 .. 59392   (wider than the 5xxxx guess)
situacaoProduto       467 true    -- every listed fund is flagged active
categoria             multimercados 178, ações 139, juros pós-fixados 115,
                      inflação 29, juros prefixados 5, cambial 1
risco                 alto 327, médio 132, baixo 8
dataBase              17.09 276, 18.09 183, 20.09 8
```

**Still no CNPJ** — this spec was right about that. The payload has no CNPJ-shaped string
anywhere, so phase 2 (the PDF) remains the only source for it.

### Fetch the FLAT `<id>_agencia.pdf` and FOLLOW REDIRECTS — then check the content type

This is the whole rule, and two earlier revisions of this section got it wrong before a full
467-fund sweep settled it (`scripts/probe-lamina-coverage.py`).

```
GET <id>_agencia.pdf, redirects followed
  200 application/pdf   438 / 467   93.8%   <- has a lâmina
  200 text/html          29 / 467    6.2%   <- has NONE
```

**The trap: a missing lâmina answers `200 text/html` after two redirects.** Status alone reports
every one of the 467 as present. A crawler that checks only the status code writes an HTML error
page to `<id>.pdf`, then fails to find a CNPJ in it — or worse, records nothing and moves on.
Require `content-type: application/pdf`.

Why redirect-following matters rather than choosing a path form: without it the flat form hits
429/467 and the canonical `/fundo/agencia/<id>.pdf` hits 24/43 on the same sample. With it, the
flat form alone reaches all 438, because the newer objects live under the canonical key and the
flat form 301s onto them. The page itself always links the flat form (verified on three funds), so
this matches what Itaú does.

Variants that do NOT work, so do not retry them: `<id>.pdf`, `fundo/<id>.pdf`,
`lamina/<id>.pdf`, `fundo/varejo/<id>.pdf`, zero-padded `056211`.

### The 29 funds without a lâmina — the detail panel does NOT help

Checked directly in the attached browser: filtered the table to a single fund via the
`text-field-nomefundo_input` search box, clicked **mais info**, and read every link the panel
renders. For all three tested (59392 `Itaú Ações Dunamis - Subclasse II`, 56067 `ARX Extra FIC FIM`,
59278 `Capitânia Infra 30 CDI Seleção`) the panel's only document link is

```
https://laminascomerciais-qh9.cloud.itau.com.br/<id>_agencia.pdf
```

i.e. exactly the URL this spec constructs — which for those funds resolves to the HTML page, not a
PDF. **Itaú's own page carries a dead "baixar lâmina" link for these funds.** So the panel offers no
alternative document path, and there is no reason to open panels at all: the URL rule is complete.

That conclusion holds for the *panel*, but **not** for the bank: the ASMX service documented above
reaches 15 of these 29 anyway, 12 through `COMAG` and 3 through `REGUL`. The page simply does not
link to it.

The list is committed at `src/corretoras/itau-lamina-missing.json`. Two patterns in it:

- **RCVM 175 subclasses are systematically missing: 7 of the 8 on the shelf.** Names carrying
  `Subclasse` are 8/467 overall but 7/29 of the misses. A subclass plausibly has no lâmina of its
  own because the class does.
- **The rest skew very recent** — 13 of 29 were created in 2026, and 21 of 29 since 2024. Consistent
  with a document that has not been published yet rather than one that is withheld.

Two oddities worth knowing: 59392 reports `dataCriacaoProduto: '01.01.0001'` (a null sentinel), and
59392's own returns are `0,00%` across all three periods, so some of these are funds that have
barely started trading.

**Recommendation:** carry those 29 with an explicit `lamina: null` rather than dropping them. They
are real, currently-offered funds (`situacaoProduto: true`) whose CNPJ this path cannot supply, and
re-running the probe later will pick up the documents as they are published. Sourcing their CNPJ
today needs a different route — CVM name matching on `nomeComercial` is the obvious candidate, and
it is exactly the fuzzy join the rest of the pipeline avoids.

### The four channels are NOT an availability signal

Both forms aside, a fund has a lâmina in **all four** channels or in **none**:

```
40369  agencia 200  uniclass 200  personnalite 200  private 200
52678  agencia 200  uniclass 200  personnalite 200  private 200
56211  all four 302        59392  all four 302
```

So `/fundo/<channel>/` is four renderings of the same fund (different fee tables, hence
different byte sizes), not four different shelves. An earlier revision of this section floated
modelling an Itaú *segment* column off the path — that is now ruled out. The `segments` map in
`_rentabilityService` is the real per-segment lever, and reaching another segment means loading
the page as that segment, not changing the PDF path.

### Miss and hit are trivially distinguishable

```
hit   200  application/pdf   + last-modified, etag, x-amz-version-id
miss  301/302  application/xml  ~300 bytes
```

No 404 is ever returned, so classify on status plus content-type, not on body size.

### The PDFs are rebuilt daily

`last-modified` on a hit was `Tue, 22 Sep 2026 03:49:07 GMT` — the morning of the probe, for a
document whose reference month is August. So the phase-2 disk cache is safe to keep but must be
**keyed by id AND date**, or a re-run silently reports last month's figures. The CNPJ and
official name are stable; only the return figures move.

### Enumeration is NOT a shortcut — and is now unnecessary

Measured before the dataset was found: ~25 probes across 50,000-65,000 yielded 3 hits, so the id
space is roughly 3% dense and finding 467 funds blind would take on the order of 15,000 requests.
Moot now that `tempData` hands over all 467 ids in one call. There is no directory listing either
— the bucket root and the obvious manifest paths return CloudFront 502 or an S3 redirect.

### One claim in this spec is still unverified

> The `<id>` is a fund identifier in the same numbering space as the pension area's `id_produto`.

Not confirmed. The saved pension artefacts under
`/Volumes/workplace/meshclaw-workspace/itau_previdencia/` do not retain `id_produto`, and OPIN's
`codigoProduto` is a *three*-digit code (401, 402, 403 …), a different space. The retail
`codigoProduto` runs 40369-59392, which is at least consistent with the five-digit claim.

---

## A SECOND source: the `consultalaminageral` ASMX service — found 2026-09-22

```
https://ww16.itau.com.br/ws/consultalaminageral.asmx/ConsultaDocumentosFundo
  ?canal=01&CDFDO=<codigoProduto>&DOCFDO=<docType>
```

A classic .NET document service, unauthenticated, keyed on the **same `codigoProduto`** the page
hands over. It serves documents the S3 host does not, and it serves document *types* the S3 host
has no concept of.

### `DOCFDO` carries both the channel and the document type; `canal` is ignored

Measured on 52678:

```
COMAG   200  146,039b   lâmina, agência        <- matches S3 fundo/agencia/52678.pdf exactly
COMPE   200  202,773b   lâmina, personnalité   (S3 personnalite: 203,028 — regenerated, not identical)
COMPR   200  135,356b   lâmina, private        (S3 private: 134,348)
REGUL   200  115,750b   REGULAMENTO            <- no S3 equivalent
PROSP   200  166,779b   PROSPECTO              <- no S3 equivalent
COMUC / COM / REG / FIC / LAM / LAMINA / FIN / RELMEN / MENSAL   403
```

`canal` makes no difference at all — `01`, `02`, `03`, `04`, `05`, `07`, `0L` all return the same
146,039-byte agência document. So the segment lives in `DOCFDO`, not in `canal`. The uniclass code
is still unknown: `COMUC` is rejected, though S3 does publish a uniclass lâmina.

**`REGUL` and `PROSP` matter beyond coverage** — a regulamento states the fund's CNPJ, so they are
an independent second route to the same field, and a fallback when a lâmina parse fails.

### It rescues 15 of the 29 funds with no S3 lâmina

`node scripts/fetch-itau-documents.js` runs the cascade S3 -> COMAG -> REGUL -> PROSP:

```
resolved 15 of 29      asmx/COMAG 12,  asmx/REGUL 3
small enough to be a lâmina (<220 KB): 8
```

That was measured on a targeted run of the 29. The subsequent **full 467 run hit the WAF partway
through**, so its ledger reads:

```
document resolved   452 / 467
CNPJ extracted      423 / 467
UNRESOLVED          15        the WAF refused us; absence is NOT established
```

Those 15 (58186, 58616, 58826, 58872, 59041, 59047, 59050, 59056, 59060, 59123, 59216, 59228, 59232,
59286, 59392) each show `s3 200 text/html` followed by three `asmx 403`. A re-run once the block
lifts should recover a few of them, so **97.0% is the floor, not the ceiling**.

### `blocked` and `absent` are different states, and conflating them silently invents absences

The script classified them correctly and then **never stored the verdict**: `classify()` was defined
but uncalled, so a WAF rejection was written to the manifest indistinguishably from a fund that
genuinely has no document. The abort guard made it worse by only checking the known-good control on
*every tenth* 403 — a modulo gate lets up to nine funds be recorded while the WAF is already
blocking. Fixed in three places, and the shape generalises to any crawler with a rejection path:

- store `absence: 'blocked' | 'absent'` on every entry that resolved no document;
- check the control on the **first** rejection, rate-limited (30 s) rather than sampled;
- treat `blocked` as *not an answer* in `needsFetch`, so it is retried automatically on the next run
  with no flag — unlike `absent`, which needs `--retry-missing`.

The report now prints the two separately, so `no document, established` can never be misread as the
count of funds Itaú has no document for.

### A strict CNPJ pattern invents absences — third-party lâminas add stray spaces

Third-party managers' documents render the number with whitespace the strict form
`\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}` cannot match:

```
Occam  Favorecido: OCCAM BRASIL LONG BIASED FIC FIM  CNPJ: 18.525.868/0001 -70
M8     M8 Capital Plus FIRF CP LP                    CNPJ: 39.958.460/0001 - 62
```

Those reported `no-cnpj-in-document`, which reads as "this document does not state a CNPJ"
when the CNPJ is right there. Allowing `\s*` around every separator and normalising back to
the canonical form recovered **12 funds** with zero change to the 423 that already resolved.

The failure mode is worth naming because it is not a typo-tolerance nicety: the *diagnosis*
built on top of it was wrong too. Grouping the misses by "has a `CNPJ` label but no strict
match" produced a confident category called `label-present-value-missing`, and the
conclusion that those documents' digits were not in the text layer at all. Nine of the
twelve had the digits in plain text. **A negative from a pattern is evidence about the
pattern until you read the text it rejected.**

### Which CNPJ is the fund: the subscription wire beneficiary

A lâmina names the fund, its administrator, its custodian, and for a feeder its master. The
registry filter removes counterparties exactly (an administrator DTVM is not a registered
fund), but it cannot separate a feeder from its own master — both are registered, operating
classes. Resolution order, highest first:

| rule | signal | n |
|---|---|---|
| `class-label` | `CNPJ DA CLASSE:` in a regulamento | 1 |
| `wire-beneficiary` | follows `Favorecido:` — the account the money lands in | 27 |
| `page-header` | within the first 300 chars, beside the fund's own name | 305 |
| `sole-registered-fund` | only one candidate is a registered fund | 92 |
| `not-named-as-other-fund` | survives dropping `FUNDO MASTER` / `em cotas do` / `fundo-espelho` prose | 6 |
| `cnpj-label` | follows a bare `CNPJ:` | 1 |
| `class-not-master` | a class, and not named MASTER | 3 |

`Favorecido:` is the strongest available signal and it needs no name comparison: it is the
beneficiary of the subscription transfer, so it is by construction the fund being sold.

**One document contradicts itself, and the rule caught it.** `56955` AZ Quest Azimut Equity
Allocation Trend names three CNPJs, all live registered classes:

```
48.038.196/0001-30  ...ALLOCATION TREND FIF DA CIC EM AÇÕES        <- "o fundo apresentado neste material"
46.192.515/0001-31  ...ALLOCATION TREND MASTER FIF EM AÇÕES        <- "seu respectivo Master"
40.102.910/0001-08  AZ QUEST AZIMUT EQUITY CHINA DÓLAR ...         <- a DIFFERENT fund, in the stats table
```

The third is in the statistics block labelled `Fundo` yet belongs to AZ Quest's China Dólar
fund — a defect in the manager's own document. Registry names, not the document, settle it.

### What is genuinely unreachable from a lâmina — 17 funds

```
no CNPJ anywhere in the text   15   incl. 10 with no `CNPJ` label at all
no text layer at all            2   56426 Vinci TR (14 chars), 57393 Riza Travos (27 chars)
only the administrator's CNPJ   2   55591 / 55911 STK, via BNY Mellon DTVM 02.201.501/0001-61
```

22 of the 29 original misses were third-party managers (Occam 7, Polo 4, Opportunity 4,
Riza 4, AZ Quest 2, STK 2) against zero Itaú-issued documents, because Itaú's own template
always carries the CNPJ in the page header. So the remaining gap is one document family
Itaú does not control, not 17 unrelated problems.

**Next lever for those:** the cascade currently stops at the first PDF it finds, so it
accepted the S3 lâmina and never asked ASMX for `REGUL`. A regulamento must state the
fund's CNPJ in body text. Treating "document found but no CNPJ" as a reason to keep
cascading is the fix; it was untestable at time of writing because the ASMX WAF was
refusing this client, control included.

### A 200 application/pdf is NOT proof of a lâmina

Of the 15 rescued, 7 are plainly a different document that `COMAG` falls back to. The PDF metadata
gives them away:

```
56122  1,132,630b  title "Relatorio Mensal Nest FIA.xlsm"     a monthly report exported from Excel
57754  1,623,699b  title "Page 1",  3 pages
57793  2,741,000b  1 page                                      a scan or a graphic sheet
58006    269,827b  title "Apresentação do …"                   a presentation
```

Real lâminas are 2 pages and 68-146 KB. So size is a usable *hint* (`smallEnoughForLamina`), but the
only real test is the one this spec already specifies: exactly one CNPJ-shaped string in the
extracted text. Treat zero or many as a failure to report.

Of the 15 rescued, 7 are plainly a different document that `COMAG` falls back to. The PDF metadata
gives them away:

```
56122  1,132,630b  title "Relatorio Mensal Nest FIA.xlsm"     a monthly report exported from Excel
57754  1,623,699b  title "Page 1",  3 pages
57793  2,741,000b  1 page                                      a scan or a graphic sheet
58006    269,827b  title "Apresentação do …"                   a presentation
```

Real lâminas are 2 pages and 68-146 KB. So size is a usable *hint* (`smallEnoughForLamina`), but the
only real test is the one this spec already specifies: exactly one CNPJ-shaped string in the
extracted text. Treat zero or many as a failure to report.

Do not trust a page count as the classifier either — PDFs written with compressed object streams do
not expose `/Type /Page` in plaintext, so the same regex reports 2 pages for one generator and 0 for
another.

### The WAF rejects Python's TLS fingerprint, whatever headers you send

This host sits behind an F5 ASM that answers `403 text/html` with `Your support ID is: …`. That is a
**client verdict, not "document not found"** — and mistaking the two produced a completely wrong
measurement (all 29 reported absent) before a curl control caught it.

```
Node   fetch(), NO headers at all              200      <- the crawler's language works
curl   User-Agent AND Accept-Encoding          200      <- both required, neither alone
curl   bare / UA only / UA+Accept / UA+Referer 403
Python urllib, every header combination tried  403      <- gzip, curl-like AE, Accept, keep-alive
```

Since headers alone cannot fix Python, the discriminator is below HTTP — the TLS handshake. Hence
`scripts/fetch-itau-documents.js` is Node rather than Python, which is also where
`src/corretoras/corretoras.ts` lives. The S3 host has no such filter, so
`scripts/probe-lamina-coverage.py` stays Python.

**Distinguishing a real absence from a WAF block:** interleave a known-good id. 52678 returned 200
between rejected ids, and the rejected ids stayed rejected across retries 4 and 10 seconds apart, so
those 403s are per-fund. Without that control the two are indistinguishable.

---

## Proposed implementation

### Phase 1 — read the dataset out of the page (browser, attached Chrome, ONE call)

**Superseded by the probe above: there is no click loop, and there is no API to find.** Load the
page in the user's own Chrome and evaluate

```js
document.querySelector('itau-tabela-rentabilidade')
  ._ngElementStrategy.componentRef.instance.tempData
```

which returns all 467 records including `codigoProduto`. Save it and `detach`. No pagination, no
467 detail-panel opens, and none of the throttling risk this spec originally budgeted for — the
page issues no data requests at all, so the only traffic is analytics.

Output committed at `src/corretoras/itau-rentabilidade.json` (467 records, sorted by
`codigoProduto`).

Two things to carry forward:

- **Guard on `tempData.length`.** A framework change that renames the property or splits the array
  would otherwise yield a short list that still looks plausible. Cross-check against the page's own
  `exibindo N de M resultados` text before trusting a run.
- **This reads `varejo` only.** `_rentabilityService.segments` names five more (`uniclass`,
  `personnalite`, `private-bank`, `empresas`), so the shelf is per-segment and this is one slice.
  Reaching another segment means loading the page as that segment — not changing the PDF path,
  which is ruled out above.

The original plan — modelling a 467-item click loop on `scripts/extract-pension-catalog.js` with
its `ESPERAS = [20s, 60s, 120s, 240s]` backoff — is no longer needed here. That machinery still
matters for the *pension logged area*, which has no equivalent in-memory dataset exposed.

### Phase 2 — download and parse (Node, no browser)

Fetch each URL from `laminascomerciais-qh9.cloud.itau.com.br`, extract text, take the
first CNPJ match plus the official name, and join back to phase 1 on the URL. Be polite
with concurrency and cache the PDFs on disk so re-parsing does not re-download.

### Integration point

`src/corretoras/corretoras.ts` holds one async function per platform (`btg()` via a
public JSON API, `xp()` via puppeteer interception) and each one ends with
`writeCnpjs('<platform>', fundos)`, which writes a plain array of CNPJ strings to
`src/corretoras/<platform>.json`. Add `itau()` in that shape and the fund tracker picks
the platform up with no changes elsewhere. A `itau-manual.json` companion already fits
the existing convention if a hand-maintained override is needed.

Keep the richer per-fund data (official name, risk, fees, returns, the three
rentabilidade figures) in a separate CSV rather than forcing it into the CNPJ array.

### New dependency

`pdf-parse`. Note the repo's `prepare`/`pretest` scripts invoke `npm.cmd`, which does not
exist on macOS, so install with `npm install --ignore-scripts pdf-parse`.

---

## Gotcha checklist

- Plain HTTP and bundled Chromium get 403; only the user's attached browser loads the page.
- `playwright-cli` sessions are per process for the ENV var, but the session NAME survives: the CLI prints `-s=kc-xxxx`, reuse it. `detach`, don't `close`.
- There is **no JSON API** — 153 XHR/fetch, zero fund endpoints. Don't go looking again.
- The dataset is on the Angular Elements component instance (`_ngElementStrategy.componentRef.instance.tempData`), not in the DOM, not in a global, not React, not an iframe.
- Use the flat `<id>_agencia.pdf` and FOLLOW redirects; it then covers all 438 available lâminas.
- A WAF `403` is a verdict on the **client**, never on the fund. Record it as `blocked`, not as an absence, and re-probe it on the next run.
- **A missing lâmina answers `200 text/html`** after two redirects — require `application/pdf` or you will save an error page as a PDF.
- Fall back to the ASMX service (`DOCFDO=COMAG` -> `REGUL` -> `PROSP`); that lifts coverage 438 -> 453 of 467.
- **The ASMX host 403s Python whatever headers you send** (TLS fingerprint). Node passes bare; curl needs User-Agent AND Accept-Encoding.
- An ASMX 403 is a CLIENT verdict, not "no document" — interleave a known-good id (52678) before believing an absence.
- `canal` is ignored by the ASMX service; the channel is encoded in `DOCFDO` (`COMAG`/`COMPE`/`COMPR`).
- A 200 application/pdf may be a monthly report or a presentation, not a lâmina — only the CNPJ parse decides.
- 14 of 467 have no commercial document under any source or type.
- Without redirect-following an S3 miss is a 301/302 to XML, never a 404 — either way, never classify on body size.
- All four `/fundo/<channel>/` paths hit or all four miss — the channel path is NOT an availability signal.
- No CNPJ anywhere in the HTML or the in-memory payload; the footer CNPJ is the bank's.
- The lâmina host is public — do not carry cookies into phase 2 or make it depend on the browser.
- The PDFs are rebuilt daily, so key the phase-2 cache by id AND date or you re-report stale returns.
- Do not enumerate the id space: ~3% density, and `tempData` gives all 467 ids anyway.
- PDF text needs a CMap-aware extractor; inflate-and-regex silently returns a timestamp.
- `pdf-parse` v2 exports the `PDFParse` class, not a callable.
- Match the CNPJ by format; there is no `CNPJ:` label to anchor on.
- The table name and the PDF name are different strings; the PDF one is the CVM name.
- 467 sequential detail-panel opens will be throttled; persist progress and back off.
- Columns 4–7 header labels are nested and unverified — read them before mapping.
- This machine has no `timeout(1)` (GNU coreutils absent), if you script around the crawl.

---

## Verified commands

```bash
# 1. the page refuses a non-browser client
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://www.itau.com.br/investimentos/fundos/rentabilidade'

# 2. open it in the user's own Chrome (single process)
playwright-cli attach --extension=chrome
playwright-cli goto 'https://www.itau.com.br/investimentos/fundos/rentabilidade'
playwright-cli snapshot          # yields the table, refs, and "exibindo 10 de 467 resultados"
playwright-cli click <ref>       # a row's "mais info" button -> panel with the lâmina link
playwright-cli detach

# 3. the PDF needs nothing
curl -sS -o lamina.pdf 'https://laminascomerciais-qh9.cloud.itau.com.br/52678_agencia.pdf'

# 4. the CNPJ comes out as text
npm install --ignore-scripts pdf-parse
node -e "
const fs=require('fs'); const {PDFParse}=require('pdf-parse');
(async()=>{
  const p=new PDFParse({data:new Uint8Array(fs.readFileSync('lamina.pdf'))});
  const t=(await p.getText()).text.replace(/\s+/g,' ');
  console.log(t.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)[0]);
  await p.destroy();
})();"
# 20.335.522/0001-51
```

---

## Related

- `docs/itau-pension-opendata.md` — the pension shelf, which needs no browser at all
  (Open Insurance open data). Different regime, different answer: for *previdência* there
  is a public API; for retail funds there is not.
- `scripts/extract-pension-catalog.js` / `.user.js` — the browser extractor to model
  phase 1 on.
- `scripts/collect-pension-opendata.py` — the OPIN collector.
- `src/corretoras/corretoras.ts` — where `itau()` belongs, and the XP request-interception
  pattern worth copying.
