#!/usr/bin/env node
/**
 * Stage 1 of the Itaú retail shelf: drive real Chrome to the rentabilidade page and
 * read the fund catalogue out of the Angular component instance.
 *
 *   node src/crawlers/itau-rentabilidade.js [--profile <dir>]
 *
 * Why a browser at all: there is NO fund JSON API. 153 XHR/fetch requests on this page
 * carry no fund data — the payload arrives tunnelled through the apicd.cloud.itau.com.br
 * bot shield, so there is no endpoint to call directly. The dataset is reachable only as
 * live state on the `<itau-tabela-rentabilidade>` Angular Elements instance.
 *
 * Why real Chrome (channel:'chrome'), not the bundled Chromium: Itaú's shield answers the
 * bundled build with 403. Confirmed on both Playwright's Chromium and a plain HTTP client.
 *
 * Why the profile must persist: on a COLD profile the component boots (categories fills)
 * but `tempData` stays empty — the shield handshake has not completed and no fund data is
 * served. Measured: cold run 0 records after 30s, next run on the same profile 467 records
 * in 2.5s. So the profile directory is load-bearing, not an optimisation, and a cold start
 * needs reloads rather than a longer single wait.
 *
 * This stage yields codigoProduto (the lâmina id), names, fees and returns — but NO CNPJ.
 * The CNPJ comes from the documents in stage 2 (fetch-itau-documents.js).
 */
import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

import {REPO} from '../lib/paths';
const OUT = path.join(REPO, 'src', 'corretoras', 'itau-rentabilidade.json');
/**
 * The Chrome profile MUST outlive a single run (see the header note on cold profiles), so
 * it lives in the repo's gitignored cache — not $KIROCREW_SCRATCH or /tmp, both of which
 * are reclaimed and would make every run a cold one.
 */
const PROFILE = path.join(REPO, '.cache', 'chrome-itau');
const URL_ = 'https://www.itau.com.br/investimentos/fundos/rentabilidade';
const TAG = 'itau-tabela-rentabilidade';
/** The shelf has been 467 funds; a collection failure must never read as a smaller shelf. */
const FLOOR = 400;
const RELOADS = 4;
const POLL_MS = 2000;
const POLL_TRIES = 15;

const READ = `(() => {
  const el = document.querySelector(${JSON.stringify(TAG)});
  if (!el) return null;
  const s = el._ngElementStrategy;
  const inst = s && s.componentRef && s.componentRef.instance;
  if (!inst || !Array.isArray(inst.tempData)) return null;
  return inst.tempData;
})()`;

const SEGMENTS = `(() => {
  const el = document.querySelector(${JSON.stringify(TAG)});
  const s = el && el._ngElementStrategy;
  const inst = s && s.componentRef && s.componentRef.instance;
  const svc = inst && inst._rentabilityService;
  return (svc && svc.segments) || null;
})()`;

const sleep = (ms: any) => new Promise(r => setTimeout(r, ms));

/**
 * Keep the component's raw record AND hoist the fields consumers actually read.
 *
 * The raw shape nests everything interesting under `catalogoProduto` (with `categoria` and
 * `risco` as objects), and it is the only place the full `taxas` breakdown exists — so it
 * is kept verbatim as the source of truth. The hoisted scalars exist because the first
 * version of this file was hand-extracted in a flattened shape that downstream code and
 * docs already describe; dropping them would be a silent breaking change for a gain of
 * nothing.
 */
function normalise(f: any) {
  const cat = f.catalogoProduto || {};
  const r = cat.rentabilidade || {};
  const name = (v: any) => (v && typeof v === 'object' ? v.nome : v) ?? null;
  return {
    ...f,
    categoria: name(cat.categoria),
    risco: name(cat.risco),
    situacaoProduto: cat.situacaoProduto ?? null,
    dataCriacaoProduto: cat.dataCriacaoProduto ?? null,
    taxaAdministracao: cat.taxaAdministracao ?? null,
    totalizadorTaxas: cat.totalizadorTaxas ?? null,
    resgateDescricao: cat.resgateDescricao ?? null,
    dataBase: r.dataBase ?? null,
    rentAnual: r.anual ?? null,
    rentDozeMeses: r.dozeMeses ?? null,
    rentMesAtual: r.mesAtual ?? null,
  };
}

/** Poll the component instance; null until the shield has served the payload. */
async function readWhenReady(page: any) {
  for (let i = 0; i < POLL_TRIES; i++) {
    const data = await page.evaluate(READ).catch(() => null);
    if (Array.isArray(data) && data.length) return data;
    await sleep(POLL_MS);
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const profile = argv.includes('--profile')
    ? argv[argv.indexOf('--profile') + 1]
    : PROFILE;

  console.log(`profile: ${profile}`);
  const cold = !fs.existsSync(profile);
  if (cold) {
    console.log(
      'profile is COLD — the bot shield typically serves no fund data on the first ' +
        'load. Reloading until it does.',
    );
  }

  const browser = await puppeteer.launch({
    channel: 'chrome',
    // Headful deliberately: the shield's fingerprinting already rejects the bundled
    // Chromium, so a headless real Chrome is not worth assuming works. This stage runs
    // rarely and interactively, so a visible window costs nothing and lets you watch it.
    headless: false,
    userDataDir: profile,
    args: ['--window-size=1400,900'],
  });

  let data = null;
  let segments = null;
  try {
    const page = await browser.newPage();
    await page.setViewport({width: 1400, height: 900});

    for (let attempt = 1; attempt <= RELOADS && !data; attempt++) {
      const res = await page.goto(URL_, {
        waitUntil: 'networkidle2',
        timeout: 90000,
      });
      if (!res) throw new Error(`load ${attempt}: no response from ${URL_}`);
      console.log(`load ${attempt}: HTTP ${res.status()}`);
      if (res.status() !== 200) {
        console.error(
          `  non-200 document — the shield is refusing this client`,
        );
        continue;
      }
      data = await readWhenReady(page);
      console.log(`  tempData: ${data ? data.length : 0}`);
    }
    if (data) segments = await page.evaluate(SEGMENTS).catch(() => null);
  } finally {
    await browser.close();
  }

  if (!data) {
    console.error(
      `\nFAILED: no fund data after ${RELOADS} loads. This is a COLLECTION failure, ` +
        `not an empty shelf — ${path.basename(OUT)} is left untouched.`,
    );
    process.exit(2);
  }

  data = data.map(normalise);
  const ids = new Set(data.map(f => f.codigoProduto));
  console.log(`\nrecords ${data.length}   distinct codigoProduto ${ids.size}`);
  if (segments) console.log(`segments exposed: ${JSON.stringify(segments)}`);

  if (data.length < FLOOR || ids.size < FLOOR) {
    console.error(
      `\nASSERTION FAILED: ${data.length} records / ${ids.size} ids below the floor of ` +
        `${FLOOR}. Treat as a partial collection; ${path.basename(OUT)} is left untouched.`,
    );
    process.exit(1);
  }

  let prev = 0;
  if (fs.existsSync(OUT)) {
    prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).length;
  }
  const tmp = `${OUT}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, OUT);
  console.log(`\nwrote ${OUT}  (was ${prev} records, now ${data.length})`);
  console.log(
    'next: node src/crawlers/itau-documents.js   # resolves the CNPJs',
  );
}

main().catch(e => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
