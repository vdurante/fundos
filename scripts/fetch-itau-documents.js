#!/usr/bin/env node
/**
 * Fetch an Itau retail fund's commercial document, trying every known source.
 *
 * Sources, in order:
 *   1. S3   laminascomerciais-qh9.cloud.itau.com.br/<id>_agencia.pdf  (follows redirects)
 *   2. ASMX ww16.itau.com.br/ws/consultalaminageral.asmx/ConsultaDocumentosFundo
 *           DOCFDO=COMAG (lamina) -> REGUL (regulamento) -> PROSP (prospecto)
 *
 * Three findings this encodes, each of which cost a wrong measurement:
 *   - S3 answers 200 text/html when a fund has no lamina, so the content type
 *     must be checked. Status alone reports all 467 as present.
 *   - ASMX is behind an F5 WAF that rejects Python's TLS fingerprint with 403
 *     regardless of headers. Node passes with no headers at all; curl passes only
 *     with User-Agent AND Accept-Encoding. That is why this script is not Python.
 *   - A 200 application/pdf from COMAG is NOT proof of a lamina: for some funds it
 *     returns a monthly report or a presentation. Only the CNPJ parse can confirm.
 *
 * Usage: node scripts/fetch-itau-documents.js [--ids 1,2,3] [--all] [--out DIR]
 */
const fs = require('fs');
const path = require('path');

const S3 = 'https://laminascomerciais-qh9.cloud.itau.com.br';
const ASMX =
  'https://ww16.itau.com.br/ws/consultalaminageral.asmx/ConsultaDocumentosFundo';
const DOC_TYPES = ['COMAG', 'REGUL', 'PROSP'];
const LAMINA_MAX_BYTES = 220000;

const REPO = path.dirname(__dirname);
const DATA = path.join(REPO, 'src', 'corretoras', 'itau-rentabilidade.json');
const MISSING = path.join(REPO, 'src', 'corretoras', 'itau-lamina-missing.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  try {
    const res = await fetch(url, {redirect: 'follow'});
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      contentType: (res.headers.get('content-type') || '').split(';')[0],
      body: buf,
    };
  } catch (e) {
    return {status: 0, contentType: e.message, body: Buffer.alloc(0)};
  }
}

const isPdf = r =>
  r.status === 200 &&
  r.contentType === 'application/pdf' &&
  r.body.subarray(0, 5).toString() === '%PDF-';

function shape(body) {
  const head = body.subarray(0, Math.min(body.length, 4096)).toString('latin1');
  const title = /\/Title\s*\(([^)]{0,60})\)/.exec(head);
  return {
    bytes: body.length,
    smallEnoughForLamina: body.length < LAMINA_MAX_BYTES,
    title: title ? title[1] : null,
  };
}

async function resolve(id) {
  let r = await get(`${S3}/${id}_agencia.pdf`);
  if (isPdf(r)) return {source: 's3', docType: 'COMAG', ...shape(r.body), body: r.body};
  for (const doc of DOC_TYPES) {
    r = await get(`${ASMX}?canal=01&CDFDO=${id}&DOCFDO=${doc}`);
    if (isPdf(r)) {
      return {source: 'asmx', docType: doc, ...shape(r.body), body: r.body};
    }
    await sleep(400);
  }
  return {source: null, docType: null, bytes: 0, body: Buffer.alloc(0)};
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = n => {
    const i = argv.indexOf(n);
    return i === -1 ? undefined : argv[i + 1];
  };
  const outDir = arg('--out');
  const ids = arg('--ids');

  let funds = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  if (ids) {
    const want = new Set(ids.split(',').map(Number));
    funds = funds.filter(f => want.has(f.codigoProduto));
  } else if (!argv.includes('--all')) {
    const want = new Set(
      JSON.parse(fs.readFileSync(MISSING, 'utf8')).map(r => r.codigoProduto)
    );
    funds = funds.filter(f => want.has(f.codigoProduto));
  }
  if (outDir) fs.mkdirSync(outDir, {recursive: true});

  const rows = [];
  for (const f of funds) {
    const r = await resolve(f.codigoProduto);
    rows.push({
      codigoProduto: f.codigoProduto,
      nomeComercial: f.nomeComercial,
      source: r.source,
      docType: r.docType,
      bytes: r.bytes,
      smallEnoughForLamina: r.smallEnoughForLamina,
      title: r.title,
    });
    if (outDir && r.body.length) {
      fs.writeFileSync(path.join(outDir, `${f.codigoProduto}.pdf`), r.body);
    }
    const tag = !r.source ? '      ' : r.smallEnoughForLamina ? 'lamina' : 'OTHER ';
    console.log(
      `  ${f.codigoProduto}  ${(r.source || '--').padEnd(5)} ` +
        `${(r.docType || '-').padEnd(6)} ${tag} ${String(r.bytes).padStart(9)}b  ` +
        `${f.nomeComercial.slice(0, 44)}${r.title ? `  [${r.title}]` : ''}`
    );
    await sleep(400);
  }

  const byKey = {};
  for (const r of rows) {
    const k = `${r.source}/${r.docType}`;
    byKey[k] = (byKey[k] || 0) + 1;
  }
  const resolved = rows.filter(r => r.source);
  console.log(`\nresolved ${resolved.length} of ${rows.length}`);
  console.log('by source/type:', byKey);
  console.log(
    'small enough to be a lâmina:',
    resolved.filter(r => r.smallEnoughForLamina).length
  );
  const none = rows.filter(r => !r.source).map(r => r.codigoProduto);
  if (none.length) console.log(`no document at all (${none.length}):`, none.join(', '));
}

main();
