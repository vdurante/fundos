#!/usr/bin/env node
/**
 * Propose CVM registry candidates for Itaú shelf funds whose document yields no CNPJ.
 *
 * This does NOT decide anything and writes nothing. It ranks registry entries by
 * distinctive-word overlap with the shelf name so a human confirms a value instead of
 * opening 15 PDFs — the confirmed value then goes into itau-cnpj-overrides.json, where
 * the same name check runs again as a guard.
 *
 * Name matching is deliberately kept OUT of the automatic resolver: "Riza Évora
 * Debêntures Incentivadas Infra" has several plausible registry neighbours and picking
 * one silently is how a wrong CNPJ becomes permanent. Proposing is safe; deciding is not.
 *
 * Usage: node src/crawlers/suggest-cnpj-candidates.js [--all] [--top N]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const {loadRegistry, OPERATING} = require('../lib/cvm-registry');

const REPO = path.resolve(__dirname, '..', '..');
const DOCS = path.join(REPO, 'src', 'corretoras', 'itau-documents.json');

const STOP = new Set([
  'fundo',
  'fundos',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'em',
  'e',
  'investimento',
  'investimentos',
  'cotas',
  'fi',
  'fic',
  'fim',
  'fif',
  'cic',
  'rf',
  'mm',
  'cp',
  'lp',
  'ie',
  'rl',
  'resp',
  'responsabilidade',
  'limitada',
  'financeiro',
]);
/** Words that describe a category rather than identify a fund. */
const WEAK = new Set([
  'multimercado',
  'multimercados',
  'acoes',
  'renda',
  'fixa',
  'credito',
  'privado',
  'longo',
  'prazo',
  'prev',
  'previdenciario',
  'subclasse',
  'classe',
  'infra',
  'infraestrutura',
  'incentivadas',
  'debentures',
  'direitos',
  'creditorios',
  'selecao',
  'hedge',
  'total',
  'plus',
  'long',
  'short',
  'biased',
  'only',
  'macro',
  'i',
  'ii',
  'iii',
  'liquidez',
  'corporativo',
  'ativo',
  'small',
  'mid',
  'caps',
  'dolar',
  'bdr',
  'global',
  'equity',
  'market',
  'evolution',
]);

const norm = s =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * A master is the wholesale vehicle several feeders invest into, so it is never a
 * candidate: it cannot identify one shelf product, and its quota series is gross of the
 * feeder's fee. It is still worth PRINTING, separately and labelled, because the feeder
 * sitting above a known master is usually the obvious neighbour in the same name family.
 */
const isMaster = name => /\bMASTER\b/i.test(String(name));

const fmt = c =>
  c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

const words = s => {
  const all = norm(s).filter(w => w.length > 1 && !STOP.has(w));
  return {
    strong: new Set(all.filter(w => !WEAK.has(w))),
    all: new Set(all),
  };
};

async function main() {
  const top =
    Number(process.argv[process.argv.indexOf('--top') + 1] || '') || 4;
  const stubPath = process.argv.includes('--stub')
    ? process.argv[process.argv.indexOf('--stub') + 1]
    : null;
  const rows = JSON.parse(fs.readFileSync(DOCS, 'utf8'));
  const targets = rows.filter(r => r.source && !r.cnpj);
  if (!targets.length) {
    console.log('nothing unresolved — every fund with a document has a CNPJ');
    return;
  }

  const reg = await loadRegistry({});
  const pool = [...reg.entries()]
    .filter(e => e.situacao === OPERATING)
    .map(e => ({...e, w: words(e.name), master: isMaster(e.name)}));
  console.log(
    `registry: ${pool.length} operating entries | unresolved with a document: ${targets.length}\n`,
  );

  const stub = {};
  for (const t of targets) {
    const tw = words(t.nomeComercial);
    const scored = [];
    for (const e of pool) {
      let strong = 0;
      for (const w of tw.strong) if (e.w.strong.has(w)) strong++;
      if (!strong) continue;
      let weak = 0;
      for (const w of tw.all) if (e.w.all.has(w)) weak++;
      scored.push({e, strong, weak});
    }
    scored.sort((a, b) => b.strong - a.strong || b.weak - a.weak);
    const candidates = scored.filter(s => !s.e.master);
    const masters = scored.filter(s => s.e.master);

    console.log(`${t.codigoProduto}  ${t.nomeComercial}`);
    console.log(`  reason: ${t.resolution}`);
    console.log(
      `  distinctive words: ${[...tw.strong].join(', ') || '(none)'}`,
    );
    if (t.resolution === 'only-the-master-is-named' && t.cnpjCandidates) {
      console.log(
        `  the document names ONLY the master: ${t.cnpjCandidates.join(', ')}`,
      );
    }
    if (!candidates.length) {
      console.log(
        '  no non-master registry candidate shares a distinctive word',
      );
    }
    for (const {e, strong, weak} of candidates.slice(0, top)) {
      console.log(
        `  ${fmt(e.cnpj)}  s${strong}/w${weak} ${e.isClass ? 'class' : 'fund '}  ${e.name}`,
      );
    }
    if (candidates.length > top)
      console.log(`  ... ${candidates.length - top} more`);
    for (const {e} of masters.slice(0, 2)) {
      console.log(
        `  (excluded, master — its feeder is what you want) ${fmt(e.cnpj)}  ${e.name}`,
      );
    }
    console.log('');

    stub[t.codigoProduto] = {
      cnpj: 'FILL ME',
      why: `${t.resolution} — see docs/itau-cnpj-candidates.md`,
      sourcedBy: 'FILL ME',
      _fund: t.nomeComercial,
      _candidates: candidates
        .slice(0, top)
        .map(s => `${fmt(s.e.cnpj)}  ${s.e.name}`),
    };
  }

  if (stubPath) {
    fs.writeFileSync(
      stubPath,
      JSON.stringify({overrides: stub}, null, 2) + '\n',
    );
    console.log(`stub written: ${stubPath}`);
    console.log(
      'Fill in cnpj + sourcedBy, drop the _fund/_candidates hints, and merge the entries\n' +
        'into src/corretoras/itau-cnpj-overrides.json. Leave any you are unsure about OUT —\n' +
        'an unresolved fund is honest; a guessed CNPJ silently computes the wrong returns.',
    );
    return;
  }
  console.log(
    'Confirm a value by adding it to src/corretoras/itau-cnpj-overrides.json with a\n' +
      '"why" and a "sourcedBy"; the loader re-checks it against the registry and refuses\n' +
      'a master. Or re-run with --stub <file> to get a fill-in-the-blanks block.',
  );
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
