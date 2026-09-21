# Itaú pension funds via Open Data

How to obtain the list of pension (previdência) investment funds offered by Itaú
programmatically, with no scraping and no authentication.

**Result:** 235 funds published by Itaú Vida e Previdência, of which 160 are the
funds actually selectable in the retail internet-banking shelf. A filter on the
open data recovers all 160 with 96.4% precision.

Verified 2026-09-20.

---

## TL;DR

```bash
curl -sS -H 'cache-control: no-cache' \
  'https://api.itau/open-insurance/products-services/v2/life-pension?page=1&page-size=100'
```

The `cache-control` request header is **mandatory**. Without it the endpoint
returns HTTP 400. That single header is the whole trick.

---

## Why the obvious sources do not work

### SUSEP publishes no product dataset

SUSEP is the insurance regulator and therefore the intuitive starting point, but
its [open data page](https://www.gov.br/susep/pt-br/acesso-a-informacao/dados-abertos)
only publishes the institutional Open Data Plans (PDAs) and links to
dados.gov.br. The product registry exists **only** behind an ASP.NET form at
`www2.susep.gov.br/safe/menumercado/REP2/Produto.aspx` — the exact unstable page
scraping that we are trying to avoid.

More importantly, there is no public SUSEP dataset linking a SUSEP process number
to the CNPJ of its FIE (*Fundo de Investimento Especialmente Constituído*, the
fund that holds a pension plan's assets). That link is reported to SUSEP through
periodic filings and is not published. Any pipeline that assumes it exists breaks
in the middle.

### CVM knows the funds exist, not that they are available

Two traps in the CVM open data:

**`cad_fi.csv` is effectively dead.** As of 2026-09 it holds 46,806 rows, of which
46,575 are `CANCELADA` and only **22** are `EM FUNCIONAMENTO NORMAL`. The live
universe migrated to Resolução CVM 175 and now lives in
[`registro_fundo_classe.zip`](https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo_classe.zip)
(`registro_fundo.csv`, `registro_classe.csv`, `registro_subclasse.csv`).

**There is no subscription-status column.** Neither the legacy nor the current
cadastral files expose whether a fund is open to new money. `Forma_Condominio`
(`Aberto`/`Fechado`) is the *condominium type*, not the subscription status —
conflating the two produces a wrong answer that looks right. The `Situacao`
values are `Em Funcionamento Normal`, `Fase Pré-Operacional`, `Em Liquidação`,
`Cancelado`.

Also note that under RCVM 175 the CNPJ that matters is the **class** CNPJ
(`CNPJ_Classe` in `registro_classe.csv`), not the fund CNPJ, and the daily NAV
report is per class.

Filtering CVM alone for Itaú pension classes yields **1,242 classes** (1,175 in
normal operation) — roughly 7x the real shelf. Worse, `Publico_Alvo` is
`Profissional` for 1,171 of them, which is *correct* and therefore useless: the
FIE's quotaholder is the insurer, not the saver. Same for `Exclusivo = S`. Those
two fields carry zero signal about retail availability.

---

## The source that works: Open Insurance Brasil, Phase 1

Open Insurance (OPIN) is the SUSEP-regulated open-data ecosystem for insurance,
pensions and capitalization — the insurance analogue of Open Finance. Phase 1
obliges every participant to publish product data through **unauthenticated**
APIs. Crucially, the pension product payload contains the plan → fund link that
SUSEP does not publish.

There is no central server. Each insurer hosts the same standardized path on its
own domain. Discovery is through the participant directory:

```bash
curl -sS https://data.directory.opinbrasil.com.br/participants
```

38 participants. Itaú appears as `ITAU SEGUROS S.A.`, `Status: Active`,
`OrganisationId 0d7b810c-9546-4745-9e61-4685cbc9c8b9`, exposing:

| ApiFamilyType | Endpoint |
|---|---|
| `products-services_life-pension` | `https://api.itau/open-insurance/products-services/v2/life-pension` |
| `products-services_pension-plan` | `https://api.itau/open-insurance/products-services/v{1,2}/pension-plan` |

`api.itau` has no TLD but resolves publicly (CloudFront).

### `life-pension` is the only family that carries funds

The OPIN taxonomy splits pensions across two families, and only one is useful:

- **`life-pension`** — *Previdência com Cobertura por Sobrevivência*. Holds both
  PGBL and VGBL, and is the only family in the whole specification whose payload
  contains `investmentFunds`.
- **`pension-plan`** — traditional/risk pension plans. No `investmentFunds`
  (verified against Zurich, which serves this family). For Itaú it returns
  `products: []`.
- **`person`** — life insurance. VGBL is *legally* a life insurance product, so
  this looks like a candidate, but the spec puts VGBL under `life-pension`
  because of the survival coverage. Itaú's `person` payload contains only risk
  products (term life, travel) and zero occurrences of `PGBL`, `VGBL` or
  `investmentFunds`.

### The `cache-control` gotcha

A bare `GET` returns:

```
HTTP/2 400
x-amzn-errortype: BadRequestException
x-cache: Error from cloudfront
{"errors":[{"code":"BAD_REQUEST_PARAMETERS", ...}]}
```

The error is emitted by API Gateway before the request reaches the backend. The
cause is in the official swagger
([`current/life-pension.yaml`](https://github.com/br-openinsurance/areadesenvolvedor/blob/main/documentation/source/files/swagger/current/life-pension.yaml),
version 2.0.0):

```yaml
cache-Control:
  name: cache-control
  in: header
  description: Controle de cache para evitar que informações confidenciais sejam armazenadas em cache.
  required: true
```

Itaú's gateway enforces the spec literally. Sending `cache-control: no-cache`
turns every 400 into a 200.

Two observations that cost time and are worth recording:

- All `/v2/` routes returned 400 while `/v1/person` and
  `/v1/capitalization-title` returned 200. That looked like a broken v2
  deployment. It was not: the working v1 routes are the **deprecated** ones
  (they answer with `x-v: 1.7.0`) and simply do not enforce the header.
- A `403` on a route means it is not deployed at all; a `400` means the route
  exists and the request was rejected. Reading that difference is what separates
  "not implemented" from "wrong request".

### Pagination

Query parameters are `page` and `page-size` (note the hyphen; the swagger
component is named `pageSize` but its wire name is `page-size`).

```
"meta": { "totalRecords": 1106, "totalPages": 12 }
```

`page-size=100` gives 12 pages. `links.next` carries the next URL.

### Response shape

```json
{
  "data": { "brand": { "name": "ITAU SEGUROS S.A", "companies": [{
    "name": "Itaú Vida e Previdência S.A",
    "cnpjNumber": "92661388000190",
    "products": [{
      "name": "...", "code": "...", "type": "PGBL",
      "productDetails": [{
        "susepProcessNumber": "...",
        "defferalPeriod": {
          "updateIndex": "IPCA",
          "gracePeriodRedemption": 60,
          "gracePeriodPortability": 60,
          "minimumPremiumAmount": [{ "minimumPremiumAmountValue": "...", "minimumPremiumAmountDescription": "MENSAL" }],
          "investmentFunds": [{
            "cnpjNumber": "42461943000161",
            "companyName": "...",
            "maximumAdministrationFee": "2.0",
            "maximumPerformanceFee": "0",
            "typePerformanceFee": ["NAO_APLICA"],
            "eligibilityRule": false,
            "minimumContributionValue": "0",
            "minimumMathematicalProvisionAmount": "0"
          }]
        }
      }]
    }]
  }] } },
  "links": { "next": "...", "last": "..." },
  "meta": { "totalRecords": 1106, "totalPages": 12 }
}
```

Note the typo `defferalPeriod` — it is in the specification, not a transcription
error.

### What Itaú publishes

| Metric | Value |
|---|---|
| Products | 1,106 (551 PGBL / 556 VGBL) |
| Distinct SUSEP processes | 494 |
| Product↔fund pairs | 1,107 |
| **Distinct funds** | **235** |
| Funds serving both PGBL and VGBL | 225 (96%) |

**The grain is N:N.** The natural key is `(susepProcessNumber, fund CNPJ)`. A
fund appears in many products, so counting rows is not counting funds. And
because 96% of funds serve both tax regimes, PGBL vs VGBL is a *contract*
attribute, not a fund attribute — filtering by regime does not reduce the fund
universe. The question "which funds can I choose" is answered per plan, never
per tax regime.

---

## Enriching with CVM

Join the 235 fund CNPJs against `registro_classe.csv` on `CNPJ_Classe`
(digits only, both sides). All 235 matched, all `Em Funcionamento Normal`.

Useful columns: `Situacao`, `Classificacao_Anbima`, `Data_Constituicao`,
`Patrimonio_Liquido`, `Tipo_Classe`, `Classe_ESG`. Join
`registro_fundo.csv` on `ID_Registro_Fundo` for `Administrador` and `Gestor`, and
`registro_subclasse.csv` on `ID_Registro_Classe` for the `Previdenciario` and
`Exclusivo_Previdencia_Complementar` flags.

For NAV and returns, use the per-class daily report under
`https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/`.

Composition of the 235 by ANBIMA class: Previdência Multimercado Livre (85),
Ações Ativo (28), RF Duração Livre Crédito Livre (27), RF Data Alvo (22), the
rest scattered. 53 distinct managers; 135 of 235 are Itaú Asset, the other 100
third-party (Kinea 12, BTG 5, Icatu Vanguarda 5, Absolute 4, Verde 4, SPX 4, …).

---

## Published shelf vs. purchasable shelf

The open data publishes what the **company** offers across every plan and
channel. It does not expose the cut by distribution channel (Uniclass /
Personnalité / Private), by plan, or by subscription status. So the published set
is a superset of what any one customer sees.

Measured against the real retail shelf (160 funds extracted from the
authenticated internet-banking catalogue):

- **160 of 160 are present in the open data.** The shelf is a strict subset;
  nothing on screen is missing from OPIN.
- The distinguishing feature is **how many products each fund appears in**.

| | on the shelf (160) | published only (75) |
|---|---|---|
| products per fund, median | 6 | 2 |
| minimum | 4 | 1 |
| parity | all even | mixed |

Every one of the 160 shelf funds has an **even** product count of **at least 4**
(41 with 4, 96 with 6, 17 with 8, 4 with 10, 2 with 12). Nothing odd, nothing
below 4. Outside the shelf: 9 funds with 1 product, 55 with 2, 4 with 3.

The parity is not a coincidence — products come in PGBL+VGBL pairs, so an odd
count means an incomplete pair, the signature of a product being wound down. A
floor of 4 means the fund belongs to at least two pairs, i.e. more than one
currently-sold plan.

### The filter

```
qtd_produtos >= 4  AND  qtd_produtos % 2 == 0
```

| Rule | Predicted | False + | False − | Recall | Precision |
|---|---|---|---|---|---|
| `products >= 2` | 226 | 66 | 0 | 100% | 70.8% |
| `products >= 3` | 171 | 11 | 0 | 100% | 93.6% |
| `products >= 4` | 167 | 7 | 0 | 100% | 95.8% |
| **`products >= 4` and even** | **166** | **6** | **0** | **100%** | **96.4%** |
| `products >= 4` + constituted ≥ 2010 + fee ≤ 2.9% | 164 | 5 | **1** | 99.4% | 97.0% |

The last row is a warning, not a recommendation. Adding the age and fee filters
raises precision but **drops a real shelf fund**. Those filters were fitted
against a partial sample of 115 and failed once the remaining 45 arrived —
textbook overfitting. Prefer the simpler rule with perfect recall.

### The 6 the filter gets wrong

| Products | Net assets | Constituted | Fund |
|---|---|---|---|
| 6 | R$ 387M | 2025 | SUL AMERICA PRESTIGE STRATE ITAU RF CP |
| 4 | R$ 3,862M | **1998** | ITAU FLEXPREV PLUS RF |
| 4 | R$ 350M | 2016 | ITAU FLEXPR PRE FIXADO IDKA |
| 4 | R$ 1,371M | 2014 | ITAU PRIVATE PREV NTN-B 2030 |
| 4 | R$ 1,478M | 2019 | ITAU PRIVATE PREV NTN-B 2035 |
| 4 | R$ 38M | 2024 | SPX RANGER PREV ITAU |

Three different reasons, and no public field separates them:

- **Legacy at scale.** FLEXPREV PLUS RF was constituted in 1998 and holds
  R$ 3.9 billion. It is closed to new money but full of existing savers, so a
  net-assets floor does not help.
- **Channel, but not by name.** `ITAU PRIVATE PREV NTN-B 2028` *is* on the
  retail shelf while `2030` and `2035` are not. Excluding funds whose name
  contains `PRIVATE`/`PVT` breaks the shelf — the name inherits the product's
  origin, not today's distribution channel. This was the most intuitive of the
  three hypotheses and the only one that did not survive testing.
- **Other plans.** SPX RANGER (2024) and SUL AMERICA PRESTIGE (2025) are
  presumably tied to plans other than the retail one.

Closing the last 6 would require knowing which SUSEP process is *your* plan.
OPIN publishes that link at company level without saying which one is yours.

---

## Reproducing

```bash
# 1. discover endpoints for every insurer
curl -sS https://data.directory.opinbrasil.com.br/participants -o participants.json

# 2. pull all pages of Itaú's pension catalogue
for p in $(seq 1 12); do
  curl -sS -H 'cache-control: no-cache' \
    "https://api.itau/open-insurance/products-services/v2/life-pension?page=$p&page-size=100" \
    -o "life-pension-$p.json"
done

# 3. CVM cadastral data (current, RCVM 175)
curl -sS -o registro_fundo_classe.zip \
  https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo_classe.zip
unzip -o registro_fundo_classe.zip -d cvm/
```

A ready-made collector that paginates, flattens the N:N grain and writes two
CSVs (per product↔fund pair, and per fund) lives outside this repository at
`itau_previdencia/collect.py`:

```bash
python3 collect.py --family life-pension
```

Other insurers serve the identical contract on their own hosts, e.g.
`https://opin.bradescoseguros.com.br/open-insurance/products-services/v2/life-pension`,
`https://opin.icatuseguros.com.br/...`, `https://insurance-openfinance.xpi.com.br/...`.
Ratios differ sharply: Bradesco publishes 10 products over 4 distinct funds;
Icatu, 25 products over 1.

## Caveats

- `api.itau` is what the OPIN directory advertises. If it changes, re-read the
  directory rather than guessing a hostname.
- The swagger `current` version is 2.0.0 (path `/v2/`); 3.0.0 is a release
  candidate (`/v3/`) and 1.x is retired or deprecated. Multi-versioning means
  paths can move — check the
  [Phase 1 page](https://opinbrasil.atlassian.net/wiki/spaces/RDD/pages/753678/Fase+1+-+Dados+Abertos)
  for the current status table.
- `itau.com.br` blocks non-browser clients with HTTP 403 at the WAF, including
  an automated Chromium. Nothing here touches that host — the open-data API is a
  separate origin with no such protection.
- Fee fields are maxima (`maximumAdministrationFee`), not the effective fee for a
  given plan.
