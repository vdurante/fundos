#!/usr/bin/env python3
"""Collects an insurer's pension (previdência) fund shelf from Open Insurance open data.

Every OPIN participant self-hosts its own Phase-1 open-data node — there is no
central server — so the host is a required argument. Discover hosts with:

    curl -sS https://data.directory.opinbrasil.com.br/participants \\
      | python3 -c 'import json,sys; [print(p["OrganisationName"]) for p in json.load(sys.stdin) if p["Status"]=="Active"]'

Usage:

    python3 scripts/collect-pension-opendata.py --host api.example      # needs the header
    python3 scripts/collect-pension-opendata.py --host opin.example.com.br

No authentication, no consent, no client certificate. Writes two semicolon-separated
CSVs next to the working directory: one row per product-fund pair, and one row per
distinct fund.

Two gotchas this script exists to encode:

1. `cache-control` is declared `in: header, required: true` by the products-services
   swagger. Some gateways validate it strictly and answer HTTP 400 without it; others
   do not care. It is always sent here, which is safe either way.
2. `defferalPeriod` is misspelled in the OPIN specification itself, not here. Funds also
   appear under `grantPeriodBenefit`, and some exist ONLY there, so both are walked.

Pagination follows `meta.totalPages`. Do not replace it with one large `page-size`:
at least one participant answers HTTP 200 while silently dropping funds.
"""
import argparse
import collections
import csv
import json
import sys
import urllib.error
import urllib.request

PAGE_SIZE = 100
HEADERS = {
    "cache-control": "no-cache",
    "Accept": "application/json",
}
# Ships in real payloads as if it were a fund. It is not.
PLACEHOLDER_CNPJ = "00000000000000"


def fetch(host, family, page):
    url = (
        f"https://{host}/open-insurance/products-services/v2/{family}"
        f"?page={page}&page-size={PAGE_SIZE}"
    )
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_all(host, family):
    first = fetch(host, family, 1)
    meta = first.get("meta") or {}
    total_pages = meta.get("totalPages", 1)
    total_records = meta.get("totalRecords")
    payloads = [first]
    for page in range(2, total_pages + 1):
        payloads.append(fetch(host, family, page))
        print(f"  {family} page {page}/{total_pages}", file=sys.stderr)
    return payloads, total_pages, total_records


def flatten(payloads):
    rows = []
    for d in payloads:
        brand = (d.get("data") or {}).get("brand") or {}
        for company in brand.get("companies") or []:
            for product in company.get("products") or []:
                for detail in product.get("productDetails") or []:
                    periods = (
                        ("diferimento", detail.get("defferalPeriod") or {}),
                        ("beneficio", detail.get("grantPeriodBenefit") or {}),
                    )
                    for periodo, block in periods:
                        if not isinstance(block, dict):
                            continue
                        funds = block.get("investmentFunds") or []
                        minimos = {
                            m.get("minimumPremiumAmountDescription"): m.get(
                                "minimumPremiumAmountValue"
                            )
                            for m in block.get("minimumPremiumAmount") or []
                        }
                        for fund in funds:
                            cnpj = fund.get("cnpjNumber")
                            if not cnpj or cnpj == PLACEHOLDER_CNPJ:
                                continue
                            rows.append(
                                {
                                    "marca": brand.get("name"),
                                    "empresa": company.get("name"),
                                    "cnpj_empresa": company.get("cnpjNumber"),
                                    "periodo": periodo,
                                    "produto": product.get("name"),
                                    "codigo_produto": product.get("code"),
                                    "tipo_plano": product.get("type"),
                                    "modalidade": product.get("modality"),
                                    "processo_susep": detail.get("susepProcessNumber"),
                                    "cnpj_fundo": cnpj,
                                    "nome_fundo": fund.get("companyName"),
                                    "taxa_adm_max": fund.get("maximumAdministrationFee"),
                                    "taxa_perf_max": fund.get("maximumPerformanceFee"),
                                    "tipo_taxa_perf": "|".join(
                                        fund.get("typePerformanceFee") or []
                                    ),
                                    "aporte_min_fundo": fund.get("minimumContributionValue"),
                                    "provisao_min_fundo": fund.get(
                                        "minimumMathematicalProvisionAmount"
                                    ),
                                    "regra_elegibilidade": fund.get("eligibilityRule"),
                                    "aporte_min_unico": minimos.get("APORTE UNICO")
                                    or minimos.get("UNICO"),
                                    "aporte_min_mensal": minimos.get("APORTE MENSAL")
                                    or minimos.get("MENSAL"),
                                    "indice_atualizacao": block.get("updateIndex"),
                                    "carencia_resgate_dias": block.get(
                                        "gracePeriodRedemption"
                                    ),
                                    "carencia_portabilidade_dias": block.get(
                                        "gracePeriodPortability"
                                    ),
                                    "condicoes_url": detail.get("contractTermsConditions"),
                                }
                            )
    return rows


def rollup(rows):
    by_fund = collections.defaultdict(
        lambda: {
            "tipos": set(),
            "produtos": set(),
            "produtos_diferimento": set(),
            "processos": set(),
            "periodos": set(),
        }
    )
    for r in rows:
        acc = by_fund[r["cnpj_fundo"]]
        acc["nome_fundo"] = r["nome_fundo"]
        acc["taxa_adm_max"] = r["taxa_adm_max"]
        acc["taxa_perf_max"] = r["taxa_perf_max"]
        acc["tipos"].add(r["tipo_plano"])
        acc["produtos"].add(r["produto"])
        acc["processos"].add(r["processo_susep"])
        acc["periodos"].add(r["periodo"])
        if r["periodo"] == "diferimento":
            acc["produtos_diferimento"].add(r["produto"])
    out = []
    for cnpj, acc in by_fund.items():
        # qtd_produtos counts deferral-period products only: that is the basis of the
        # shelf heuristic described in the pension open-data note under docs/
        # (a fund is on the purchasable shelf when this count is >= 4 and even).
        qtd = len(acc["produtos_diferimento"])
        out.append(
            {
                "cnpj_fundo": cnpj,
                "nome_fundo": acc.get("nome_fundo"),
                "tipos_plano": "/".join(sorted(t for t in acc["tipos"] if t)),
                "qtd_produtos": qtd,
                "qtd_produtos_total": len(acc["produtos"]),
                "qtd_processos_susep": len(acc["processos"]),
                "periodos": "/".join(sorted(acc["periodos"])),
                "taxa_adm_max": acc.get("taxa_adm_max"),
                "taxa_perf_max": acc.get("taxa_perf_max"),
                "na_prateleira_prevista": qtd >= 4 and qtd % 2 == 0,
            }
        )
    return sorted(out, key=lambda x: (x["nome_fundo"] or ""))


def write_csv(path, rows):
    if not rows:
        return
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()), delimiter=";")
        writer.writeheader()
        writer.writerows(rows)
    print(f"written: {path} ({len(rows)} rows)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--host",
        required=True,
        help="OPIN node host, e.g. opin.example.com.br (no scheme, no path)",
    )
    ap.add_argument(
        "--family", default="life-pension", choices=["life-pension", "pension-plan"]
    )
    ap.add_argument(
        "--out-prefix",
        help="CSV filename prefix; defaults to the first label of --host",
    )
    args = ap.parse_args()
    prefix = args.out_prefix or args.host.split(".")[0]

    try:
        payloads, pages, records = fetch_all(args.host, args.family)
    except urllib.error.HTTPError as exc:
        body = exc.read()[:300]
        print(f"HTTP {exc.code}: {body!r}", file=sys.stderr)
        if exc.code == 400:
            print(
                "A 400 here usually means a required header was rejected; "
                "check the products-services swagger for this version.",
                file=sys.stderr,
            )
        return 1

    rows = flatten(payloads)
    funds = rollup(rows)
    tipos = collections.Counter(r["tipo_plano"] for r in rows)
    processos = {r["processo_susep"] for r in rows}
    ambos = [f for f in funds if f["tipos_plano"] == "PGBL/VGBL"]
    so_beneficio = [f for f in funds if f["periodos"] == "beneficio"]
    previstos = [f for f in funds if f["na_prateleira_prevista"]]

    print(f"family:               {args.family}")
    print(f"pages:                {pages} | declared totalRecords: {records}")
    print(f"product-fund pairs:   {len(rows)}")
    print(f"SUSEP processes:      {len(processos)}")
    print(f"rows per plan type:   {dict(tipos)}")
    print(f"DISTINCT FUNDS:       {len(funds)}")
    print(f"serve PGBL and VGBL:  {len(ambos)}")
    print(f"grant-period only:    {len(so_beneficio)}")
    print(f"predicted shelf:      {len(previstos)}")

    write_csv(f"{prefix}_{args.family}_detalhe.csv", rows)
    write_csv(f"{prefix}_{args.family}_fundos.csv", funds)
    return 0


if __name__ == "__main__":
    sys.exit(main())
