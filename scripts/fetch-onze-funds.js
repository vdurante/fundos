#!/usr/bin/env node
/**
 * Onze plan funds: resolve each fund's CNPJ from its own regulamento PDF.
 *
 *   node scripts/fetch-onze-funds.js [--input ~/Downloads/onze.json] [--refresh]
 *
 * Onze's catalogue (hand-exported from the platform, since the shelf of a CORPORATE
 * pension plan is published nowhere public) carries name, fee, yield and a
 * `regulation_url` — but no CNPJ. The regulamento does, and those PDFs sit on an
 * unauthenticated S3 bucket, so this stage needs no browser and no login.
 *
 * Why the regulamento is the better source here than Icatu's OPIN catalogue: it states
 * the feeder AND its master explicitly, in prose. Onze's shelf is feeders whose masters
 * are what the tracking sheet currently keys — so a regulamento is the document that
 * proves the remap rather than inferring it.
 *
 * Resolution reuses the Itaú rules unchanged, and they suffice: the CVM registry drops
 * every counterparty (insurer, administrator, gestora, banco are not registered funds)
 * and the master exclusion drops the parent. Measured on Absolute Icatu I Prev: 7 CNPJs
 * in the document, 1 survivor.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {loadRegistry, OPERATING} = require('./lib/cvm-registry');

const REPO = path.dirname(__dirname);
const CACHE = path.join(REPO, '.cache', 'onze-regulations');
const OUT = path.join(REPO, 'src', 'corretoras', 'onze-funds.json');
const DEFAULT_INPUT = path.join(process.env.HOME, 'Downloads', 'onze.json');

const CNPJ_RE = /(\d{2})\s*\.\s*(\d{3})\s*\.\s*(\d{3})\s*\/\s*(\d{4})\s*-\s*(\d{2})/g;
const isMaster = n => /\bMASTER\b/i.test(String(n));
/** Prose that introduces the master rather than the fund the document is FOR. */
const OTHER_FUND_RE =
  /MASTER|inscrito\s+no\s+CNPJ\s+sob|em\s+cotas\s+do\s+fundo|aplica\s+seus\s+recursos/i;

function validCnpj(formatted) {
  const d = formatted.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const check = len => {
    let sum = 0;
    let w = len - 7;
    for (let i = 0; i < len; i++) {
      sum += Number(d[i]) * w--;
      if (w < 2) w = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

function readCatalogue(file) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const seen = new Map();
  for (const [key, val] of Object.entries(d)) {
    for (const f of Array.isArray(val) ? val : [val]) {
      if (f && f.value && !seen.has(f.value)) seen.set(f.value, {...f, _bucket: key});
    }
  }
  return [...seen.values()];
}

async function blob(fund) {
  fs.mkdirSync(CACHE, {recursive: true});
  const file = path.join(CACHE, `${fund.slug}.pdf`);
  if (fs.existsSync(file) && !process.argv.includes('--refresh')) {
    return {buf: fs.readFileSync(file), cached: true};
  }
  const res = await fetch(fund.regulation_url);
  if (!res.ok) return {error: `HTTP ${res.status}`};
  const ct = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  // A bucket that answers 200 with an error page must not be cached as a regulamento.
  if (!/pdf/i.test(ct) || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return {error: `not a PDF (${ct}, ${buf.length}b)`};
  }
  fs.writeFileSync(file, buf);
  return {buf, cached: false};
}

async function extract(buf) {
  const {PDFParse} = require('pdf-parse');
  const p = new PDFParse({data: new Uint8Array(buf)});
  try {
    const out = await p.getText();
    return {text: out.text.replace(/\s+/g, ' '), pages: out.total};
  } finally {
    await p.destroy();
  }
}

function resolve(text, registry) {
  const occ = [];
  let m;
  CNPJ_RE.lastIndex = 0;
  while ((m = CNPJ_RE.exec(text)) !== null) {
    const cnpj = `${m[1]}.${m[2]}.${m[3]}/${m[4]}-${m[5]}`;
    if (!validCnpj(cnpj)) continue;
    const before = text.slice(Math.max(0, m.index - 110), m.index);
    occ.push({cnpj, index: m.index, otherFund: OTHER_FUND_RE.test(before)});
  }
  const distinct = [...new Set(occ.map(o => o.cnpj))];
  const registered = distinct.filter(c => registry.has(c));
  const masters = registered.filter(c => isMaster(registry.lookup(c).name));
  let pool = registered.filter(c => !masters.includes(c));

  const note = (c, resolution) => {
    const r = registry.lookup(c);
    return {cnpj: c, nomeOficial: r.name, situacao: r.situacao, resolution};
  };
  if (!distinct.length) return {resolution: 'no-cnpj-in-document', distinct, masters};
  if (!pool.length) {
    return {
      resolution: masters.length ? 'only-the-master-is-named' : 'no-cnpj-is-a-registered-fund',
      distinct,
      masters,
    };
  }
  if (pool.length === 1) return {...note(pool[0], 'sole-registered-fund'), distinct, masters};

  // The regulamento's own subject is named in the title block, before any counterparty.
  const own = pool.filter(c => !occ.some(o => o.cnpj === c && o.otherFund));
  if (own.length) pool = own;
  if (pool.length === 1) return {...note(pool[0], 'not-named-as-other-fund'), distinct, masters};

  const first = occ.find(o => pool.includes(o.cnpj));
  if (first) return {...note(first.cnpj, 'first-in-title-block'), distinct, masters};
  return {resolution: 'ambiguous', distinct, masters, narrowed: pool};
}

async function main() {
  const argv = process.argv.slice(2);
  const input = argv.includes('--input') ? argv[argv.indexOf('--input') + 1] : DEFAULT_INPUT;
  if (!fs.existsSync(input)) {
    console.error(`input not found: ${input}`);
    process.exit(1);
  }
  const funds = readCatalogue(input);
  console.log(`catalogue: ${funds.length} funds from ${input}`);
  const registry = await loadRegistry({});
  console.log(
    `registry: ${registry.size} CNPJs, cache ${registry.ageDays.toFixed(1)}d old\n`
  );

  const rows = [];
  for (const f of funds) {
    const row = {
      id: f.value,
      name: f.name,
      slug: f.slug,
      bucket: f._bucket,
      administrationFee: f.administration_fee ?? null,
      riskProfile: f.risk_profile ?? null,
      annualYield: f.annual_yield ?? null,
      qualifiedInvestorOnly: f.qualified_investor_only ?? null,
      regulationUrl: f.regulation_url || null,
      cnpj: null,
      nomeOficial: null,
      situacao: null,
      resolution: null,
    };
    if (!f.regulation_url) {
      row.resolution = 'no-regulation-url';
      rows.push(row);
      console.log(`  ${'--'.padEnd(18)} ${row.resolution.padEnd(26)} ${f.name.slice(0, 44)}`);
      continue;
    }
    const got = await blob(f);
    if (got.error) {
      row.resolution = `fetch-failed: ${got.error}`;
      rows.push(row);
      console.log(`  ${'--'.padEnd(18)} ${row.resolution.padEnd(26)} ${f.name.slice(0, 44)}`);
      continue;
    }
    row.sha256 = crypto.createHash('sha256').update(got.buf).digest('hex').slice(0, 16);
    const {text, pages} = await extract(got.buf);
    row.pages = pages;
    const r = resolve(text, registry);
    Object.assign(row, {
      cnpj: r.cnpj || null,
      nomeOficial: r.nomeOficial || null,
      situacao: r.situacao || null,
      resolution: r.resolution,
      candidates: r.cnpj ? undefined : r.distinct,
      masterNamed: r.masters && r.masters.length ? r.masters : undefined,
    });
    rows.push(row);
    console.log(
      `  ${(row.cnpj || '--').padEnd(18)} ${row.resolution.padEnd(26)} ${f.name.slice(0, 44)}`
    );
  }

  const withCnpj = rows.filter(r => r.cnpj);
  const notOperating = withCnpj.filter(r => r.situacao !== OPERATING);
  const dup = {};
  for (const r of withCnpj) (dup[r.cnpj] = dup[r.cnpj] || []).push(r.name);
  const collisions = Object.entries(dup).filter(([, v]) => v.length > 1);

  console.log(`\nfunds            ${rows.length}`);
  console.log(`CNPJ resolved    ${withCnpj.length}`);
  const byResolution = {};
  for (const r of rows) byResolution[r.resolution] = (byResolution[r.resolution] || 0) + 1;
  console.log('by resolution   ', byResolution);
  if (notOperating.length) {
    console.log(`NOT operating (${notOperating.length}):`);
    for (const r of notOperating) console.log(`  ${r.cnpj} ${r.situacao} ${r.name}`);
  }
  if (collisions.length) {
    console.log(`\nCNPJ shared by >1 fund (${collisions.length}) — investigate:`);
    for (const [c, v] of collisions) console.log(`  ${c}  ${v.join(' | ')}`);
  }

  const tmp = `${OUT}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + '\n');
  fs.renameSync(tmp, OUT);
  console.log(`\nwrote ${OUT}`);
}

main().catch(e => {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
});
