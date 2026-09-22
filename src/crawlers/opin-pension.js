#!/usr/bin/env node
/**
 * Previdência funds from Open Insurance (OPIN) products-services open data.
 *
 *   node src/crawlers/opin-pension.js --host api.itau --platform ITAU_PREV
 *   node src/crawlers/opin-pension.js --host opin.icatuseguros.com.br --platform ICATU
 *
 * Unauthenticated: no consent, no client certificate, no browser. Every OPIN participant
 * self-hosts the same standardized path, so the host is required — discover hosts at
 * https://data.directory.opinbrasil.com.br/participants rather than guessing.
 *
 * Four things this encodes, each of which silently loses data if you skip it:
 *
 * 1. `cache-control` is declared required by the products-services swagger. Itaú's gateway
 *    enforces it and answers HTTP 400 without it; Icatu's does not care. Verified again at
 *    time of writing: bare GET 400, with the header 200.
 * 2. `defferalPeriod` is misspelled in the OPIN SPECIFICATION, not here. Spell it
 *    correctly and you read nothing.
 * 3. Funds also appear under `grantPeriodBenefit`, and some exist ONLY there — 2 real
 *    Icatu funds do. Both blocks are walked.
 * 4. Pagination follows `meta.totalPages`. Do NOT substitute one large `page-size`: it
 *    answers 200 while silently dropping funds (measured on Itaú: 1000 -> 220 funds,
 *    all 12 pages -> 235).
 *
 * The shelf heuristic: a fund is treated as purchasable when its count of DEFERRAL-period
 * products is >= 4 and even. Derived from a logged-area extraction of 160 funds — 100%
 * recall, 96.4% precision. It is a PROXY, carried as `onShelf` rather than asserted as
 * availability, because the API does not publish the shelf.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const {loadRegistry, OPERATING} = require('../lib/cvm-registry');

const REPO = path.resolve(__dirname, '..', '..');
const PAGE_SIZE = 100;
const HEADERS = {'cache-control': 'no-cache', Accept: 'application/json'};
/** Ships in real payloads as if it were a fund, with companyName "N/A". It is not one. */
const PLACEHOLDER = '00000000000000';
const isMaster = n => /\bMASTER\b/i.test(String(n));

const digits = s => String(s || '').replace(/\D/g, '');
const fmt = c =>
  digits(c).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

async function fetchPage(host, family, page) {
  const url =
    `https://${host}/open-insurance/products-services/v2/${family}` +
    `?page=${page}&page-size=${PAGE_SIZE}`;
  const res = await fetch(url, {headers: HEADERS});
  if (!res.ok)
    throw new Error(`HTTP ${res.status} on page ${page} of ${family}`);
  return res.json();
}

async function fetchAll(host, family) {
  const first = await fetchPage(host, family, 1);
  const meta = first.meta || {};
  const totalPages = meta.totalPages || 1;
  const payloads = [first];
  for (let p = 2; p <= totalPages; p++) {
    payloads.push(await fetchPage(host, family, p));
    process.stderr.write(`  ${family} page ${p}/${totalPages}\r`);
  }
  process.stderr.write('\n');
  return {payloads, totalPages, totalRecords: meta.totalRecords};
}

/** One row per product-fund pair, walking BOTH period blocks. */
function flatten(payloads) {
  const rows = [];
  for (const d of payloads) {
    const brand = (d.data && d.data.brand) || {};
    for (const company of brand.companies || []) {
      for (const product of company.products || []) {
        for (const detail of product.productDetails || []) {
          const blocks = [
            ['diferimento', detail.defferalPeriod],
            ['beneficio', detail.grantPeriodBenefit],
          ];
          for (const [periodo, block] of blocks) {
            if (!block || typeof block !== 'object') continue;
            for (const fund of block.investmentFunds || []) {
              const cnpj = digits(fund.cnpjNumber);
              if (!cnpj || cnpj === PLACEHOLDER) continue;
              rows.push({
                periodo,
                produto: product.name,
                tipoPlano: product.type,
                cnpjFundo: cnpj,
                nomeFundo: fund.companyName,
                taxaAdmMax: fund.maximumAdministrationFee ?? null,
                taxaPerfMax: fund.maximumPerformanceFee ?? null,
              });
            }
          }
        }
      }
    }
  }
  return rows;
}

function rollup(rows, registry) {
  const acc = new Map();
  for (const r of rows) {
    let a = acc.get(r.cnpjFundo);
    if (!a) {
      a = {
        cnpj: r.cnpjFundo,
        nomeFundo: r.nomeFundo,
        taxaAdmMax: r.taxaAdmMax,
        taxaPerfMax: r.taxaPerfMax,
        tipos: new Set(),
        produtosDiferimento: new Set(),
        produtos: new Set(),
        periodos: new Set(),
      };
      acc.set(r.cnpjFundo, a);
    }
    if (r.tipoPlano) a.tipos.add(r.tipoPlano);
    a.produtos.add(r.produto);
    a.periodos.add(r.periodo);
    if (r.periodo === 'diferimento') a.produtosDiferimento.add(r.produto);
  }

  const out = [];
  for (const a of acc.values()) {
    const qtd = a.produtosDiferimento.size;
    const reg = registry.lookup(a.cnpj);
    out.push({
      cnpj: fmt(a.cnpj),
      nomeFundo: a.nomeFundo || null,
      nomeOficial: reg ? reg.name : null,
      situacao: reg ? reg.situacao : null,
      registered: !!reg,
      // A master is the wholesale vehicle several feeders invest into: it is never sold,
      // and its quota series is gross of the feeder's fee. Never a tracked identity.
      master: reg ? isMaster(reg.name) : false,
      tiposPlano: [...a.tipos].sort().join('/'),
      qtdProdutosDiferimento: qtd,
      qtdProdutos: a.produtos.size,
      periodos: [...a.periodos].sort().join('/'),
      taxaAdmMax: a.taxaAdmMax,
      taxaPerfMax: a.taxaPerfMax,
      onShelf: qtd >= 4 && qtd % 2 === 0,
    });
  }
  return out.sort((x, y) =>
    (x.nomeFundo || '').localeCompare(y.nomeFundo || ''),
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const val = n => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const host = val('--host') || 'api.itau';
  const platform = val('--platform') || 'ITAU_PREV';
  const family = val('--family') || 'life-pension';
  const out =
    val('--out') ||
    path.join(
      REPO,
      'src',
      'corretoras',
      `${platform.toLowerCase().replace(/_/g, '-')}-funds.json`,
    );

  console.log(`host ${host}  family ${family}  platform ${platform}`);
  const {payloads, totalPages, totalRecords} = await fetchAll(host, family);
  const rows = flatten(payloads);
  console.log(
    `pages ${totalPages}  products ${totalRecords}  product-fund pairs ${rows.length}`,
  );

  const registry = await loadRegistry({});
  console.log(
    `registry: ${registry.size} CNPJs, cache ${registry.ageDays.toFixed(1)}d old`,
  );

  const funds = rollup(rows, registry);
  const registered = funds.filter(f => f.registered);
  const masters = funds.filter(f => f.master);
  const shelf = funds.filter(f => f.onShelf && f.registered && !f.master);
  const shelfOperating = shelf.filter(f => f.situacao === OPERATING);

  console.log(`\ndistinct funds        ${funds.length}`);
  console.log(`  in CVM registry     ${registered.length}`);
  console.log(`  masters (excluded)  ${masters.length}`);
  console.log(`  onShelf heuristic   ${shelf.length}`);
  console.log(`  ... and operating   ${shelfOperating.length}`);

  const unregistered = funds.filter(f => !f.registered);
  if (unregistered.length) {
    console.log(
      `\nNOT in the registry (${unregistered.length}) — check before trusting:`,
    );
    for (const f of unregistered.slice(0, 10)) {
      console.log(`  ${f.cnpj}  ${(f.nomeFundo || '').slice(0, 60)}`);
    }
  }

  // A collection failure must never read as a smaller shelf.
  const FLOOR = 150;
  if (funds.length < FLOOR) {
    console.error(
      `\nASSERTION FAILED: ${funds.length} funds below the floor of ${FLOOR}. ` +
        `Treat as a partial collection; ${path.basename(out)} left untouched.`,
    );
    process.exit(1);
  }

  const tmp = `${out}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(funds, null, 2) + '\n');
  fs.renameSync(tmp, out);
  console.log(`\nwrote ${out}`);
}

main().catch(e => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
