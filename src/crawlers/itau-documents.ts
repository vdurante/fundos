#!/usr/bin/env node
/**
 * Resolve every Itau retail fund's commercial document, cache it, and extract its CNPJ.
 *
 * Two independently cached stages, so a replay costs nothing:
 *   fetch  cascade S3 -> ASMX COMAG -> REGUL -> PROSP, blob to .cache, metadata to manifest
 *   parse  pdf-parse text -> CNPJ, keyed by the blob's sha256 so an unchanged PDF is skipped
 *
 * Findings this encodes, each of which cost a wrong measurement:
 *   - S3 answers 200 text/html when a fund has no lamina, so the content type must be
 *     checked. Status alone reports all 467 as present.
 *   - ASMX sits behind an F5 WAF that rejects Python's TLS fingerprint with 403 regardless
 *     of headers. Node passes with no headers at all. That is why this is not Python, and
 *     why a 403 is checked against a known-good control before being recorded as absence.
 *   - A 200 application/pdf from COMAG is NOT proof of a lamina: for some funds it serves a
 *     monthly report or a presentation. Only the CNPJ parse decides.
 *   - The PDFs are rebuilt daily, so the cache carries last-modified and --max-age rather
 *     than assuming a blob stays current.
 *
 * Usage:
 *   node src/crawlers/itau-documents.js                  # all 467, cache-first
 *   node src/crawlers/itau-documents.js --ids 52678
 *   node src/crawlers/itau-documents.js --retry-missing  # re-probe only the unresolved
 *   node src/crawlers/itau-documents.js --max-age 30     # refetch blobs older than N days
 *   node src/crawlers/itau-documents.js --refresh        # ignore the cache entirely
 *   node src/crawlers/itau-documents.js --parse-only
 */
import {isMaster, validCnpj} from '../lib/cnpj';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const S3 = 'https://laminascomerciais-qh9.cloud.itau.com.br';
const ASMX =
  'https://ww16.itau.com.br/ws/consultalaminageral.asmx/ConsultaDocumentosFundo';
const ASMX_DOC_TYPES = ['COMAG', 'REGUL', 'PROSP'];
const CONTROL_ID = 52678;
const CONTROL_COOLDOWN_MS = 30000;
const LAMINA_MAX_BYTES = 220000;
/**
 * Bump whenever resolveCnpj changes. Cached blobs are then re-parsed instead of keeping a
 * verdict the current rule would not produce.
 */
const PARSER_VERSION = 5;

import {REPO} from '../lib/paths';
const FUNDS = path.join(REPO, 'src', 'corretoras', 'itau-rentabilidade.json');
const CACHE = path.join(REPO, '.cache', 'itau-documents');
const BLOBS = path.join(CACHE, 'pdf');
const MANIFEST = path.join(CACHE, 'manifest.json');
const OUT = path.join(REPO, 'src', 'corretoras', 'itau-documents.json');
import {OPERATING} from '../lib/cvm-registry';

const sleep = (ms: any) => new Promise(r => setTimeout(r, ms));
const sha256 = (buf: any) =>
  crypto.createHash('sha256').update(buf).digest('hex');

/* ---------------------------------------------------------------- CNPJ ---- */

/**
 * A CNPJ, tolerating whitespace around every separator.
 *
 * Third-party managers' lâminas render the number with stray spaces the strict form
 * misses entirely: Occam writes `18.525.868/0001 -70` and M8 writes
 * `39.958.460/0001 - 62`. A strict pattern reports "no CNPJ in document" for those,
 * which is a false absence, not a missing value.
 */
const CNPJ_RE =
  /(\d{2})\s*\.\s*(\d{3})\s*\.\s*(\d{3})\s*\/\s*(\d{4})\s*-\s*(\d{2})/g;
const canon = (m: any) => `${m[1]}.${m[2]}.${m[3]}/${m[4]}-${m[5]}`;
/** A regulamento states the investable vehicle under this exact label. */
const CLASS_LABEL_RE =
  /CNPJ\s+DA\s+CLASSE\s*[:nº°]*\s*(\d{2}\s*\.\s*\d{3}\s*\.\s*\d{3}\s*\/\s*\d{4}\s*-\s*\d{2})/i;
/** How far into the text a page-header CNPJ can sit; beyond this it is body text. */
const HEADER_WINDOW = 300;
/** How much text before a match is read to classify what the number refers to. */
const CONTEXT_WINDOW = 90;

/**
 * The beneficiary of the subscription wire transfer IS the fund being sold — a stronger
 * signal than any name comparison, because it is where the customer's money lands.
 */
const BENEFICIARY_RE = /Favorecido\s*:/i;
/** Language that introduces a DIFFERENT fund: the master, or a mirrored strategy. */
const OTHER_FUND_RE =
  /FUNDO\s+MASTER|inscrito\s+no\s+CNPJ|em\s+cotas\s+d[oa]|fundo[\s-]espelho|respectivo\s+Master|carteira\s+d[oa]|aloca\s+seus\s+recursos/i;
/** A bare `CNPJ:` label immediately before the number. */
const BARE_LABEL_RE = /CNPJ\s*[:nº°]*\s*$/i;

/**
 * A master (mestre) is the wholesale vehicle several feeders invest INTO, so it is never
 * the thing a shelf sells and can never identify one shelf product — by construction it is
 * shared by every feeder above it. It is also not merely the wrong label: the master's
 * quota series is gross of the feeder's own administration fee, so keying a shelf row to
 * it produces optimistically WRONG returns that still look plausible. That is precisely
 * the defect found in the sheet's ONZE previdência rows.
 *
 * So a master is excluded from the candidate pool outright rather than ranked low. When
 * every candidate in a document is a master the correct outcome is "unresolved, and here
 * is the master as a lead", not a confident wrong answer.
 */

/**
 * Decide which CNPJ in a document is the fund's own.
 *
 * A document names several: the fund, its administrator, its custodian, its manager, and
 * for a feeder its master. Excluding counterparties by name was tried and is unbounded —
 * the CVM registry does it exactly instead, because an administrator DTVM is not a
 * registered fund. Measured on 452 documents: the page-header CNPJ resolves in the
 * registry 312 of 314 times, and the two that do not are precisely the two documents whose
 * only CNPJ is the administrator's.
 */
function resolveCnpj(text: any, registry: any): any {
  const raw = [...text.matchAll(CNPJ_RE)];
  // Every occurrence, annotated with what the surrounding prose says it refers to.
  const occurrences = raw
    .map(m => {
      const before = text.slice(Math.max(0, m.index - CONTEXT_WINDOW), m.index);
      return {
        cnpj: canon(m),
        index: m.index,
        beneficiary: BENEFICIARY_RE.test(before),
        otherFund: OTHER_FUND_RE.test(before),
        labelled: BARE_LABEL_RE.test(before),
      };
    })
    .filter(o => validCnpj(o.cnpj));

  const distinct = [...new Set(occurrences.map(o => o.cnpj))];
  const registered = distinct.filter(c => registry.has(c));
  // A master is never investable, so it is not a candidate at all.
  const masters = registered.filter(c => isMaster(registry.lookup(c).name));
  const resolving = registered.filter(c => !masters.includes(c));
  const note = (c: any) => {
    const r = registry.lookup(c);
    return {
      cnpj: c,
      nomeOficial: r.name,
      situacao: r.situacao,
      isClass: r.isClass,
    };
  };
  /** Any occurrence of `c` satisfying `pred` — a CNPJ can appear more than once. */
  const anyOcc = (c: any, pred: any) =>
    occurrences.some(o => o.cnpj === c && pred(o));

  if (!distinct.length)
    return {cnpj: null, resolution: 'no-cnpj-in-document', distinct};
  if (!resolving.length) {
    // Distinguish "only counterparties" from "only the master": the second is a LEAD,
    // because the feeder sitting above a known master is findable in the registry.
    if (masters.length) {
      return {
        cnpj: null,
        resolution: 'only-the-master-is-named',
        distinct,
        masters,
        masterNames: masters.map(c => registry.lookup(c).name),
      };
    }
    return {cnpj: null, resolution: 'no-cnpj-is-a-registered-fund', distinct};
  }

  // 0. a regulamento labels the investable class explicitly
  const labelled = CLASS_LABEL_RE.exec(text);
  const labelledCanon = labelled ? labelled[1].replace(/\s+/g, '') : null;
  if (
    labelledCanon &&
    registry.has(labelledCanon) &&
    !isMaster(registry.lookup(labelledCanon).name)
  ) {
    return {
      ...note(labelledCanon),
      resolution: 'class-label',
      distinct,
      resolving,
    };
  }

  // 1. the beneficiary of the subscription transfer — the fund the money buys
  const beneficiary = resolving.filter(c =>
    anyOcc(c, (o: any) => o.beneficiary),
  );
  if (beneficiary.length === 1) {
    return {
      ...note(beneficiary[0]),
      resolution: 'wire-beneficiary',
      distinct,
      resolving,
    };
  }

  // 2. the repeated page header, which sits beside the fund's own name
  const header = occurrences.find(o => o.index < HEADER_WINDOW);
  if (header && resolving.includes(header.cnpj)) {
    return {
      ...note(header.cnpj),
      resolution: 'page-header',
      distinct,
      resolving,
    };
  }

  // 3. only one of the document's CNPJs is a registered fund at all
  if (resolving.length === 1) {
    return {
      ...note(resolving[0]),
      resolution: 'sole-registered-fund',
      distinct,
      resolving,
    };
  }

  // 4. drop numbers the prose introduces as a DIFFERENT fund (master, mirrored strategy)
  let pool = resolving;
  const own = pool.filter(
    c =>
      !anyOcc(c, (o: any) => o.otherFund) ||
      anyOcc(c, (o: any) => o.beneficiary),
  );
  if (own.length) pool = own;
  if (pool.length === 1) {
    return {
      ...note(pool[0]),
      resolution: 'not-named-as-other-fund',
      distinct,
      resolving,
    };
  }

  // 5. a bare `CNPJ:` label, which the fund's own identification block carries
  const bare = pool.filter(c => anyOcc(c, (o: any) => o.labelled));
  if (bare.length === 1) {
    return {...note(bare[0]), resolution: 'cnpj-label', distinct, resolving};
  }

  // 6. narrow to the investable vehicle: a class rather than the fund registration
  const classes = pool.filter(c => registry.lookup(c).isClass);
  if (classes.length) pool = classes;
  if (pool.length === 1) {
    return {
      ...note(pool[0]),
      resolution: 'class-not-fund',
      distinct,
      resolving,
    };
  }

  return {
    cnpj: null,
    resolution: 'ambiguous',
    distinct,
    resolving,
    narrowed: pool,
  };
}

/* --------------------------------------------------------------- fetch ---- */

async function get(url: any) {
  try {
    const res = await fetch(url, {redirect: 'follow'});
    const body = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      contentType: (res.headers.get('content-type') || '').split(';')[0],
      lastModified: res.headers.get('last-modified') || null,
      redirects: res.redirected ? 1 : 0,
      body,
    };
  } catch (e: any) {
    return {
      status: 0,
      contentType: `error: ${e.message}`,
      body: Buffer.alloc(0),
    };
  }
}

const isPdf = (r: any) =>
  r.status === 200 &&
  r.contentType === 'application/pdf' &&
  r.body.subarray(0, 5).toString('latin1') === '%PDF-';

/** A rejection of this client, which says nothing about whether the document exists. */
const isRejection = (a: any) =>
  a.status === 403 || a.status === 429 || a.status >= 500;

/** True when the WAF is rejecting this client rather than the fund being absent. */
async function controlIsBlocked() {
  const r = await get(`${ASMX}?canal=01&CDFDO=${CONTROL_ID}&DOCFDO=COMAG`);
  return !isPdf(r);
}

async function resolveOne(id: any, delayMs: any) {
  const attempts = [];

  const s3Url = `${S3}/${id}_agencia.pdf`;
  let r = await get(s3Url);
  attempts.push({url: s3Url, status: r.status, contentType: r.contentType});
  if (isPdf(r))
    return {source: 's3', docType: 'COMAG', url: s3Url, res: r, attempts};

  for (const doc of ASMX_DOC_TYPES) {
    await sleep(delayMs);
    const url = `${ASMX}?canal=01&CDFDO=${id}&DOCFDO=${doc}`;
    r = await get(url);
    attempts.push({url, status: r.status, contentType: r.contentType});
    if (isPdf(r)) return {source: 'asmx', docType: doc, url, res: r, attempts};
  }
  return {source: null, docType: null, url: null, res: null, attempts};
}

/**
 * absent  every probe gave a definitive answer and none was a document
 * blocked at least one probe was refused, so absence is NOT established
 */
const classify = (attempts: any) =>
  attempts.some(isRejection) ? 'blocked' : 'absent';

/** Backfill `absence` onto entries written before it was recorded. */
function backfillAbsence(manifest: Record<string, any>) {
  let n = 0;
  for (const e of Object.values(manifest)) {
    if (!e.source && !e.absence && Array.isArray(e.attempts)) {
      e.absence = classify(e.attempts);
      n++;
    }
  }
  return n;
}

/* --------------------------------------------------------------- parse ---- */

async function extract(buf: any) {
  const {PDFParse} = require('pdf-parse');
  const parser = new PDFParse({data: new Uint8Array(buf)});
  try {
    const out = await parser.getText();
    const text = out.text.replace(/\s+/g, ' ').trim();
    const firstLine = out.text
      .split('\n')
      .map((s: any) => s.trim())
      .find((s: any) => s.length > 8);
    return {
      text,
      pages: out.pages ? out.pages.length : out.total || null,
      firstLine: firstLine ? firstLine.slice(0, 120) : null,
    };
  } finally {
    await parser.destroy();
  }
}

/* ------------------------------------------------------------ manifest ---- */

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) return {};
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch (e: any) {
    console.error(`manifest unreadable (${e.message}); starting empty`);
    return {};
  }
}

function saveJson(file: any, data: any) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

const ageDays = (iso: any) => (Date.now() - Date.parse(iso)) / 86400000;

function needsFetch(entry: any, opts: any) {
  if (!entry) return true;
  if (opts.refresh) return true;
  // `blocked` is not an answer: the WAF refused us, so always probe again.
  if (entry.absence === 'blocked') return true;
  if (!entry.source) return !!opts.retryMissing;
  if (opts.maxAge != null && ageDays(entry.fetchedAt) > opts.maxAge)
    return true;
  return !fs.existsSync(path.join(BLOBS, `${entry.codigoProduto}.pdf`));
}

/* ---------------------------------------------------------------- main ---- */

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n: any) => argv.includes(n);
  const val = (n: any) => {
    const i = argv.indexOf(n);
    return i === -1 ? undefined : argv[i + 1];
  };
  const opts = {
    refresh: flag('--refresh'),
    retryMissing: flag('--retry-missing'),
    maxAge: val('--max-age') != null ? Number(val('--max-age')) : null,
    concurrency: Number(val('--concurrency') || 4),
    delay: Number(val('--delay') || 250),
    fetchOnly: flag('--fetch-only'),
    parseOnly: flag('--parse-only'),
    refreshRegistry: flag('--refresh-registry'),
  };

  fs.mkdirSync(BLOBS, {recursive: true});
  const manifest = loadManifest();
  const backfilled = backfillAbsence(manifest);
  if (backfilled) {
    console.log(`backfilled absence classification on ${backfilled} entries`);
  }

  const all = JSON.parse(fs.readFileSync(FUNDS, 'utf8'));
  const ids = val('--ids');
  const funds = ids
    ? all.filter((f: any) =>
        new Set(ids.split(',').map(Number)).has(f.codigoProduto),
      )
    : all;

  /* ---- stage 1: fetch ---- */
  let fetched = 0;
  let cached = 0;
  let blocked = false;

  if (!opts.parseOnly) {
    const todo = funds.filter((f: any) =>
      needsFetch(manifest[f.codigoProduto], opts),
    );
    cached = funds.length - todo.length;
    console.log(
      `fetch: ${todo.length} to probe, ${cached} served from cache (${funds.length} funds)`,
    );

    let cursor = 0;
    let lastControlAt = 0;
    const worker = async () => {
      while (cursor < todo.length && !blocked) {
        const f = todo[cursor++];
        const id = f.codigoProduto;
        const r = await resolveOne(id, opts.delay);

        if (!r.source) {
          const asmxRejected = r.attempts.some(
            a => a.url.includes('asmx') && a.status === 403,
          );
          // Check the control on the FIRST rejection, not every tenth: a modulo
          // gate lets up to N-1 funds be written while the WAF is already
          // blocking us. Re-checks are rate-limited rather than sampled.
          if (
            asmxRejected &&
            Date.now() - lastControlAt > CONTROL_COOLDOWN_MS
          ) {
            lastControlAt = Date.now();
            if (await controlIsBlocked()) {
              blocked = true;
              console.error(
                `\nABORT: control ${CONTROL_ID} also rejected — the WAF is blocking this ` +
                  `client, so these 403s are not fund absences. Nothing recorded as missing.`,
              );
              return;
            }
          }
        }

        const prev = manifest[id] || {};
        const entry: Record<string, any> = {
          codigoProduto: id,
          nomeComercial: f.nomeComercial,
          source: r.source,
          docType: r.docType,
          url: r.url,
          status: r.res ? r.res.status : null,
          contentType: r.res ? r.res.contentType : null,
          bytes: r.res ? r.res.body.length : 0,
          lastModified: r.res ? r.res.lastModified : null,
          fetchedAt: new Date().toISOString(),
          attempts: r.source ? undefined : r.attempts,
          absence: r.source ? undefined : classify(r.attempts),
          // parse fields survive a refetch; invalidated below when the blob changes
          sha256: prev.sha256,
          cnpj: prev.cnpj,
          cnpjCandidates: prev.cnpjCandidates,
          resolution: prev.resolution,
          pages: prev.pages,
          textChars: prev.textChars,
          docFirstLine: prev.docFirstLine,
          parsedSha256: prev.parsedSha256,
        };

        if (r.source) {
          const digest = sha256(r.res.body);
          fs.writeFileSync(path.join(BLOBS, `${id}.pdf`), r.res.body);
          entry.sha256 = digest;
          entry.looksLikeLamina = r.res.body.length < LAMINA_MAX_BYTES;
          fetched++;
        }
        manifest[id] = entry;
        if (fetched % 25 === 0) saveJson(MANIFEST, manifest);
        process.stdout.write(
          `  ${id}  ${(r.source || '--').padEnd(4)} ${(r.docType || '-').padEnd(5)} ` +
            `${String(entry.bytes).padStart(8)}b  ${f.nomeComercial.slice(0, 48)}\n`,
        );
        await sleep(opts.delay);
      }
    };
    await Promise.all(
      Array.from(
        {length: Math.min(opts.concurrency, Math.max(todo.length, 1))},
        worker,
      ),
    );
    saveJson(MANIFEST, manifest);
  }

  if (blocked) process.exit(2);

  /* ---- stage 2: parse ---- */
  let parsed = 0;
  let parseSkipped = 0;
  let registry = null;
  if (!opts.fetchOnly) {
    const {loadRegistry} = require('../lib/cvm-registry');
    registry = await loadRegistry({refresh: opts.refreshRegistry});
    console.log(
      `registry: ${registry.size} CNPJs (${registry.classes} classes, ` +
        `${registry.funds} funds), cache ${registry.ageDays.toFixed(1)}d old`,
    );

    const targets = funds
      .map((f: any) => manifest[f.codigoProduto])
      .filter((e: any) => e && e.source && e.sha256);
    for (const e of targets) {
      if (
        e.parsedSha256 === e.sha256 &&
        e.parserVersion === PARSER_VERSION &&
        !opts.refresh
      ) {
        parseSkipped++;
        continue;
      }
      const file = path.join(BLOBS, `${e.codigoProduto}.pdf`);
      if (!fs.existsSync(file)) continue;
      try {
        const {text, pages, firstLine} = await extract(fs.readFileSync(file));
        const r = resolveCnpj(text, registry);
        e.pages = pages;
        e.textChars = text.length;
        e.docFirstLine = firstLine;
        e.cnpj = r.cnpj || null;
        e.nomeOficial = r.nomeOficial || null;
        e.situacao = r.situacao || null;
        e.resolution = r.resolution;
        e.cnpjDistinct = r.distinct;
        e.cnpjResolving =
          r.resolving && r.resolving.length > 1 ? r.resolving : undefined;
        e.parseError = undefined;
        e.parsedSha256 = e.sha256;
        e.parserVersion = PARSER_VERSION;
        parsed++;
      } catch (err: any) {
        e.parseError = err.message;
        e.parsedSha256 = e.sha256;
        e.parserVersion = PARSER_VERSION;
      }
      if (parsed % 25 === 0) saveJson(MANIFEST, manifest);
    }
    saveJson(MANIFEST, manifest);
    console.log(
      `parse: ${parsed} parsed, ${parseSkipped} unchanged and skipped`,
    );
  }

  /* ---- derived output + assertions ---- */
  const rows = funds
    .map((f: any) => manifest[f.codigoProduto])
    .filter(Boolean)
    .map((e: any) => ({
      codigoProduto: e.codigoProduto,
      nomeComercial: e.nomeComercial,
      cnpj: e.cnpj || null,
      nomeOficial: e.nomeOficial || null,
      situacao: e.situacao || null,
      resolution: e.resolution || null,
      cnpjCandidates: e.cnpj ? undefined : e.cnpjDistinct,
      source: e.source,
      absence: e.source ? undefined : e.absence || null,
      docType: e.docType,
      bytes: e.bytes,
      pages: e.pages ?? null,
      docFirstLine: e.docFirstLine || null,
      lastModified: e.lastModified,
    }));
  const unlabelled = rows.filter((r: any) => r.cnpj && !r.resolution);
  if (unlabelled.length) {
    throw new Error(
      `${unlabelled.length} funds carry a CNPJ with no resolution — the manifest key was ` +
        `renamed without migrating the cache, so the label was read as undefined. ` +
        `Migrate .cache/itau-documents/manifest.json or delete it to re-parse. ` +
        `First: ${unlabelled[0].codigoProduto}`,
    );
  }
  if (!ids) saveJson(OUT, rows);

  const withDoc = rows.filter((r: any) => r.source);
  const withCnpj = rows.filter((r: any) => r.cnpj);
  const dup: Record<string, any[]> = {};
  for (const r of withCnpj)
    (dup[r.cnpj] = dup[r.cnpj] || []).push(r.codigoProduto);
  const collisions = Object.entries(dup).filter(([, v]) => v.length > 1);

  console.log(`\nfunds              ${rows.length}`);
  console.log(`document resolved  ${withDoc.length}`);
  console.log(`CNPJ extracted     ${withCnpj.length}`);
  const byResolution: Record<string, number> = {};
  for (const r of rows) {
    if (r.resolution)
      byResolution[r.resolution] = (byResolution[r.resolution] || 0) + 1;
  }
  console.log('by resolution     ', byResolution);
  const bySrc: Record<string, number> = {};
  for (const r of withDoc) {
    const k = `${r.source}/${r.docType}`;
    bySrc[k] = (bySrc[k] || 0) + 1;
  }
  console.log('by source/type    ', bySrc);
  const notOperating = withCnpj.filter(
    (r: any) => r.situacao && r.situacao !== OPERATING,
  );
  console.log(
    `registry status    ${withCnpj.length - notOperating.length} operating`,
  );
  if (notOperating.length) {
    console.log(
      `  NOT operating (${notOperating.length}): ` +
        notOperating
          .map((r: any) => `${r.codigoProduto} ${r.situacao}`)
          .join(', '),
    );
  }
  if (collisions.length) {
    console.log(`\nCNPJ shared by >1 fund id (${collisions.length}):`);
    for (const [c, v] of collisions) console.log(`  ${c}  ${v.join(', ')}`);
  }
  const noDoc = rows.filter((r: any) => !r.source);
  const absent = noDoc.filter((r: any) => r.absence === 'absent');
  const blockedRows = noDoc.filter((r: any) => r.absence !== 'absent');
  if (absent.length) {
    console.log(
      `\nno document, established (${absent.length}): ` +
        absent.map((r: any) => r.codigoProduto).join(', '),
    );
  }
  if (blockedRows.length) {
    console.log(
      `\nUNRESOLVED — the WAF refused us, absence NOT established (${blockedRows.length}): ` +
        blockedRows.map((r: any) => r.codigoProduto).join(', '),
    );
    console.log('  re-run later; these are retried automatically.');
  }
  const noCnpj = rows.filter((r: any) => r.source && !r.cnpj);
  if (noCnpj.length) {
    console.log(`document but no CNPJ (${noCnpj.length}):`);
    for (const r of noCnpj) {
      console.log(
        `  ${r.codigoProduto}  ${r.resolution.padEnd(30)} ${r.nomeComercial.slice(0, 40)}`,
      );
    }
  }

  if (!ids) {
    const FLOOR_DOCS = 400;
    const FLOOR_CNPJ = 380;
    if (withDoc.length < FLOOR_DOCS || withCnpj.length < FLOOR_CNPJ) {
      console.error(
        `\nASSERTION FAILED: ${withDoc.length} documents (floor ${FLOOR_DOCS}), ` +
          `${withCnpj.length} CNPJs (floor ${FLOOR_CNPJ}). Treat this run as a ` +
          `collection failure, not as funds losing their documents.`,
      );
      process.exit(1);
    }
  }
  console.log(`\ncache ${CACHE}\nderived ${OUT}`);
}

main();
