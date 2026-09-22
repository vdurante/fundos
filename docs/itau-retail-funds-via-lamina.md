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

The open host gives up more than the spec above assumed. Four findings, each from live
requests against `laminascomerciais-qh9.cloud.itau.com.br`.

### `<id>_agencia.pdf` is a legacy alias; the canonical path names a channel

A miss redirects and leaks the real layout:

```
GET /99999_agencia.pdf   -> 301, location: /fundo/agencia/99999.pdf   (server: AmazonS3)
GET /fundo/agencia/52678.pdf -> 200 application/pdf
```

So the flat `<id>_agencia.pdf` form is an S3 routing rule onto `/fundo/<channel>/<id>.pdf`.
Prefer the canonical path: one fewer round trip, and it makes the channel explicit.

### FOUR distribution channels are published, all unauthenticated

```
fundo/agencia/52678.pdf        200   146,039 bytes
fundo/private/52678.pdf        200   134,348
fundo/personnalite/52678.pdf   200   203,028
fundo/uniclass/52678.pdf       200   145,997
fundo/varejo|digital|institucional/52678.pdf   302  (do not exist)
```

The byte sizes differ, so these are genuinely different documents for the same fund —
presumably different fee tables per segment, which is exactly what you would expect.

**This is the cut OPIN cannot give you.** `docs/itau-pension-opendata.md` records that the
open data "does not expose the cut by distribution channel (Uniclass / Personnalité /
Private)". For *retail* funds the lâmina host does expose it, by path.

**Unverified, and the important caveat:** both sampled funds (52677, 52678) return 200 on
all four channels, so n=2 cannot distinguish "sold in all four" from "every fund gets all
four rendered regardless". If some fund 302s on one channel, the path is real availability
data and `Principal` could carry an Itaú *segment* rather than a boolean. Resolve it by
checking all four channels for the first ~20 ids phase 1 harvests — it costs 80 requests
and decides whether the channel dimension is worth modelling.

### Miss and hit are trivially distinguishable

```
hit   200  application/pdf   + last-modified, etag, x-amz-version-id
miss  301/302  application/xml  ~300 bytes
```

No 404 is ever returned, so classify on status plus content-type, not on body size.

### The PDFs are rebuilt daily

`last-modified` on a hit was `Tue, 22 Sep 2026 03:49:07 GMT` — the morning of the probe,
for a document whose reference month is August. So the phase-2 disk cache is safe to keep
but must be **keyed by id AND date**, or a re-run silently reports last month's figures.
The CNPJ and official name are stable; only the return figures move.

### Enumeration is NOT a shortcut — measured, so do not retry it

The spec wonders whether the id space could be walked directly. It is too sparse:

```
~25 probes across 50,000-65,000  ->  3 hits (52677, 52678, 52700)
467 funds over a ~15,000-wide id range  ->  roughly 3% density
```

Finding all 467 by enumeration means on the order of 15,000 requests against someone
else's host to replace a 47-page crawl. Disproportionate, so **the spec's own advice
stands: look for the JSON API first.** That remains the only way to collapse phase 1, and
it needs the attached browser — the table page is still 403 to everything else.

There is no directory listing to fall back on: the bucket root and the obvious manifest
paths return CloudFront 502 or an S3 redirect, never an index.

### One claim in this spec is still unverified

> The `<id>` is a fund identifier in the same numbering space as the pension area's `id_produto`.

Not confirmed. The saved pension artefacts under
`/Volumes/workplace/meshclaw-workspace/itau_previdencia/` do not retain `id_produto` — the
CSVs are the OPIN-derived ones, and OPIN's own `codigo_produto` is a *three*-digit code
(401, 402, 403 …), a different space entirely. Testing it needs a logged-area `?id=` value,
so it waits for the browser too.

---

## Proposed implementation

### Phase 1 — harvest lâmina URLs (browser, attached Chrome)

For each of the 47 pages, for each of the 10 rows: click the row's
`button "mais info <name>"`, read the `href` of `link "baixar lâmina <name>"`, close the
panel, move on. Emit one record per fund with the commercial name, the lâmina URL and
the table columns.

Model it on `scripts/extract-pension-catalog.js`, which already solves the same problems
against the same bank's SPA: an on-page control panel, progress persisted after every
item so a throttled or timed-out run resumes instead of restarting, and resume by
page/item position. 467 sequential interactions will hit rate limiting — the pension
extractor met `Forbidden` throttling and backs off with `ESPERAS = [20s, 60s, 120s, 240s]`.
Reuse that.

Prefer a console script (or the userscript variant) over driving clicks from
`playwright-cli`: it runs in the user's own tab, survives page re-renders, and does not
depend on an attached session staying alive for the length of a 467-item crawl.

**Check for a JSON API before building the click loop.** The `<id>_agencia.pdf` naming
strongly suggests the page hydrates from an endpoint that already carries those ids for
all 467 funds. If it does, phase 1 collapses from ~470 interactions to a handful of
requests. `src/corretoras/corretoras.ts` already does exactly this for XP — it uses
`page.setRequestInterception(true)` plus a `requestfinished` listener to capture the
underlying `api.xpi.com.br/investment-funds/yield-portal/...` response instead of
scraping the DOM. Look for the equivalent with `playwright-cli requests`, the browser
devtools network tab, or a puppeteer interception run.

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
- `playwright-cli` sessions are per process — attach and act in the same one; `detach`, don't `close`.
- No CNPJ anywhere in the HTML; the footer CNPJ is the bank's.
- The lâmina host is public — do not carry cookies into phase 2 or make it depend on the browser.
- Use the canonical `/fundo/<channel>/<id>.pdf`; the flat `<id>_agencia.pdf` is a 301 alias.
- A missing lâmina is a **301/302 to XML**, never a 404 — classify on status plus content-type.
- The PDFs are rebuilt daily, so key the phase-2 cache by id AND date or you re-report stale returns.
- Do not enumerate the id space: ~3% density means ~15,000 requests to find 467 funds.
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
