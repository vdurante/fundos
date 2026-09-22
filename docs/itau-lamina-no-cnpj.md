# Itaú funds whose CNPJ is still unrecovered (17 of 467)

Cached PDFs: `.cache/itau-documents/pdf/<id>.pdf`. Regenerate with
`node scripts/fetch-itau-documents.js --parse-only`.

Recovered separately by the whitespace-tolerant pattern and the `Favorecido:` rule: 12 funds.
Blocked by the ASMX WAF and therefore unknown rather than absent: 15 funds (see the main spec).

## cnpj-label-but-no-number (3)

The template carries the `CNPJ` label and the value column is empty in the text layer. Riza renders `Informações Gerais CNPJ / Data de Início do Fundo //` — the separators survive, the digits do not. Suggests the value column is drawn as an image or with a font lacking a ToUnicode map.

| id | fund | pages | bytes | text | digits | url |
|---|---|---|---|---|---|---|
| 56966 | Riza Daikon Multimercado Crédito Privado | 2 | 211,195 | 6422ch | 507 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/56966_agencia.pdf) |
| 57394 | Riza Évora Debêntures Incentivadas Infra | 2 | 168,214 | 6516ch | 333 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/57394_agencia.pdf) |
| 58533 | Riza Statheros Direitos Creditórios | 2 | 185,091 | 6497ch | 422 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/58533_agencia.pdf) |

## no-cnpj-mention-at-all (10)

No `CNPJ` string anywhere in the extracted text. Extraction itself works (phone numbers, dates and chart axes all come through), so either the number is inside an image, or the document simply never prints it.

| id | fund | pages | bytes | text | digits | url |
|---|---|---|---|---|---|---|
| 56122 | NEST FUNDO DE INVESTIMENTOS EM AÇÕES | 1 | 1,132,630 | 6227ch | 1090 | [pdf](https://ww16.itau.com.br/ws/consultalaminageral.asmx/ConsultaDocumentosFundo?canal=01&CDFDO=56122&DOCFDO=COMAG) |
| 56143 | POLO LONG BIAS FIC FI MM | 1 | 291,567 | 4319ch | 292 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/56143_agencia.pdf) |
| 56145 | Polo Total Credit Multimercado Credito Privado | 1 | 289,003 | 3873ch | 248 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/56145_agencia.pdf) |
| 56301 | Opportunity Total Multimercado | 3 | 567,007 | 7768ch | 1886 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/56301_agencia.pdf) |
| 56302 | Opportunity Market Multimercado | 4 | 627,411 | 8771ch | 2368 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/56302_agencia.pdf) |
| 56336 | Opportunity Total Evolution Multimercado | 3 | 457,500 | 6047ch | 915 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/56336_agencia.pdf) |
| 56812 | Opportunity Global Equity Dolar Ações BDR Nível I | 3 | 416,755 | 5687ch | 764 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/56812_agencia.pdf) |
| 56848 | Polo Crédito Plus Multimercado Crédito Privado | 1 | 285,081 | 4143ch | 238 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/56848_agencia.pdf) |
| 57534 | AZ Quest Small Mid Caps Ações | 1 | 349,926 | 4362ch | 653 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/57534_agencia.pdf) |
| 58940 | Polo Crédito Corporativo Renda Fixa Longo Prazo | 1 | 286,859 | 3869ch | 274 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/58940_agencia.pdf) |

## no-text-layer (2)

Effectively no text layer at all. Needs OCR or a different document.

| id | fund | pages | bytes | text | digits | url |
|---|---|---|---|---|---|---|
| 56426 | Vinci TR FIC FIM | 1 | 1,988,846 | 12ch | 2 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/56426_agencia.pdf) |
| 57393 | Riza Travos Long Bias Multimercado | 2 | 739,877 | 25ch | 4 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/57393_agencia.pdf) |

## only-counterparty-cnpj (2)

The single CNPJ present belongs to the administrator (BNY Mellon Serviços Financeiros DTVM, `02.201.501/0001-61`), correctly rejected because it is not a registered fund. The fund's own CNPJ is absent.

| id | fund | pages | bytes | text | digits | url |
|---|---|---|---|---|---|---|
| 55591 | STK Long Only Ações | 1 | 94,782 | 6686ch | 1137 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/55591_agencia.pdf) |
| 55911 | STK Long Biased Ações | 1 | 104,095 | 7227ch | 1326 | [pdf](https://laminascomerciais-qh9.cloud.itau.com.br/55911_agencia.pdf) |

## Manager concentration

- Opportunity: 4
- Riza: 4
- Polo: 3
- STK: 2
- NEST: 1
- POLO: 1
- Vinci: 1
- AZ Quest: 1

All 17 are third-party managers. Itaú-issued lâminas carry the CNPJ in the page header without exception.
