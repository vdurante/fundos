#!/usr/bin/env node
/**
 * CVM fund registry: download, cache, and index by CNPJ.
 *
 * Source: dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo_classe.zip — rebuilt daily,
 * unauthenticated, ~6.8 MB. This replaced cad_fi.csv, which CVM now labels "Não Adaptados
 * RCVM175" and which is 99.5% cancelled registrations.
 *
 * Two things the join depends on:
 *   - The registry's own key is ID_Registro_Fundo, NOT a CNPJ. A class carries its own
 *     CNPJ_Classe; for the single-class majority it equals CNPJ_Fundo, which is why a
 *     fund-CNPJ join looks correct 99.7% of the time and then silently misses every
 *     multi-class fund. Look up CNPJ_Classe first.
 *   - Situacao has 7 values, not 4. Anything other than 'Em Funcionamento Normal' is not
 *     operating, and an unrecognised value must be surfaced rather than assumed alive.
 *
 * Usage: const {loadRegistry} = require('./lib/cvm-registry');
 *        const reg = await loadRegistry();       // cache-first
 *        reg.lookup('20.335.522/0001-51');       // {cnpj, name, situacao, isClass, isFund}
 */
'use strict';
const fs = require('fs');
const path = require('path');

const URL =
  'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo_classe.zip';
const CACHE = path.join(path.dirname(path.dirname(__dirname)), '.cache', 'cvm');
const ZIP = path.join(CACHE, 'registro_fundo_classe.zip');

const OPERATING = 'Em Funcionamento Normal';
const KNOWN_SITUACOES = new Set([
  OPERATING,
  'Cancelado',
  'Fase Pré-Operacional',
  'Em Liquidação',
  'Incorporação',
  'Em Situação Especial',
  'Em Análise',
]);

const digits = s => String(s || '').replace(/\D/g, '');
const ageDays = file => (Date.now() - fs.statSync(file).mtimeMs) / 86400000;

async function download() {
  fs.mkdirSync(CACHE, {recursive: true});
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`registry download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1_000_000) {
    throw new Error(`registry download too small (${buf.length}b) — refusing to cache`);
  }
  fs.writeFileSync(ZIP, buf);
  return buf.length;
}

/** Semicolon-delimited, latin1, with quoted free-text fields in some CVM files. */
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ';') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function index(rows, cnpjCol, kind, into, unknownSituacoes) {
  const hdr = rows[0];
  const iCnpj = hdr.indexOf(cnpjCol);
  const iName = hdr.indexOf('Denominacao_Social');
  const iSit = hdr.indexOf('Situacao');
  if (iCnpj < 0 || iName < 0 || iSit < 0) {
    throw new Error(
      `registry schema moved: ${cnpjCol}/Denominacao_Social/Situacao not all present in ` +
        `[${hdr.slice(0, 12).join(', ')}...]`
    );
  }
  let n = 0;
  for (let r = 1; r < rows.length; r++) {
    const cnpj = digits(rows[r][iCnpj]);
    if (cnpj.length !== 14) continue;
    const situacao = rows[r][iSit];
    if (!KNOWN_SITUACOES.has(situacao)) unknownSituacoes.add(situacao);
    const prev = into.get(cnpj);
    if (prev) {
      prev[kind] = true;
      continue;
    }
    into.set(cnpj, {
      cnpj,
      name: rows[r][iName],
      situacao,
      operating: situacao === OPERATING,
      isClass: kind === 'isClass',
      isFund: kind === 'isFund',
    });
    n++;
  }
  return n;
}

async function loadRegistry({maxAgeDays = 7, refresh = false} = {}) {
  const AdmZip = require('adm-zip');
  const stale = !fs.existsSync(ZIP) || ageDays(ZIP) > maxAgeDays;
  if (refresh || stale) {
    process.stderr.write(`cvm registry: downloading (${refresh ? 'forced' : 'stale'})\n`);
    await download();
  }
  const zip = new AdmZip(ZIP);
  const read = name => {
    const e = zip.getEntry(name);
    if (!e) throw new Error(`${name} missing from the registry zip`);
    return e.getData().toString('latin1');
  };

  const byCnpj = new Map();
  const unknown = new Set();
  // classes first: CNPJ_Classe is the investable vehicle and wins the lookup
  const nClass = index(
    parseCsv(read('registro_classe.csv')),
    'CNPJ_Classe',
    'isClass',
    byCnpj,
    unknown
  );
  const nFund = index(
    parseCsv(read('registro_fundo.csv')),
    'CNPJ_Fundo',
    'isFund',
    byCnpj,
    unknown
  );
  if (nClass < 20000 || nFund < 40000) {
    throw new Error(
      `registry below floor: ${nClass} classes / ${nFund} funds — treat as a bad download`
    );
  }
  if (unknown.size) {
    process.stderr.write(
      `cvm registry: unrecognised Situacao values ${[...unknown].join(', ')} — ` +
        `these are counted as NOT operating\n`
    );
  }
  return {
    size: byCnpj.size,
    classes: nClass,
    funds: nFund,
    ageDays: ageDays(ZIP),
    lookup: cnpj => byCnpj.get(digits(cnpj)) || null,
    has: cnpj => byCnpj.has(digits(cnpj)),
  };
}

module.exports = {loadRegistry, OPERATING, KNOWN_SITUACOES};

if (require.main === module) {
  loadRegistry({refresh: process.argv.includes('--refresh')}).then(r => {
    console.log(
      `registry: ${r.size} CNPJs (${r.classes} classes, ${r.funds} funds), ` +
        `cache ${r.ageDays.toFixed(1)}d old`
    );
    for (const c of process.argv.slice(2).filter(a => /\d/.test(a))) {
      console.log(' ', c, JSON.stringify(r.lookup(c)));
    }
  });
}
