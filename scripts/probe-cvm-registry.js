const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');

const SNAP = 'docs/collapse-baseline.json';
const SCRATCH = process.env.KIROCREW_SCRATCH || '/tmp';
const DIR = path.join(SCRATCH, 'cvm-registry');
const URL = 'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo_classe.zip';

const norm = s => String(s ?? '').replace(/\D/g, '');

function readCsv(file) {
  const raw = fs.readFileSync(file, 'latin1');
  const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
  const head = lines[0].split(';').map(h => h.trim());
  return {head, rows: lines.slice(1).map(l => l.split(';'))};
}

function columnOf(head, candidates) {
  for (const c of candidates) {
    const i = head.findIndex(h => h.toUpperCase() === c.toUpperCase());
    if (i >= 0) return i;
  }
  return -1;
}

function main() {
  fs.mkdirSync(DIR, {recursive: true});
  const zip = path.join(DIR, 'registro_fundo_classe.zip');
  if (!fs.existsSync(zip)) {
    console.log('downloading registry...');
    execSync(`curl -sS -o ${JSON.stringify(zip)} ${JSON.stringify(URL)}`, {stdio: 'inherit'});
  }
  execSync(`unzip -o -q ${JSON.stringify(zip)} -d ${JSON.stringify(DIR)}`);
  console.log(`files: ${fs.readdirSync(DIR).filter(f => f.endsWith('.csv')).join(', ')}\n`);

  const baseline = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const principal = baseline.principalValues
    .slice(2)
    .map(r => String(r[0] ?? ''))
    .filter(c => c !== '');
  const principalNorm = new Set(principal.map(norm));
  console.log(`Principal CNPJs: ${principal.length} (${principalNorm.size} distinct normalized)\n`);

  const report = {};

  for (const file of ['registro_fundo.csv', 'registro_classe.csv', 'registro_subclasse.csv']) {
    const full = path.join(DIR, file);
    if (!fs.existsSync(full)) {
      console.log(`${file}: MISSING`);
      continue;
    }
    const {head, rows} = readCsv(full);
    const keyCandidates = head.filter(h => /CNPJ/i.test(h));
    console.log(`${file}: ${rows.length} rows, CNPJ-ish columns: ${JSON.stringify(keyCandidates)}`);

    for (const kc of keyCandidates) {
      const idx = columnOf(head, [kc]);
      const values = new Set(rows.map(r => norm(r[idx])).filter(v => v !== ''));
      let hit = 0;
      for (const c of principalNorm) if (values.has(c)) hit++;
      const pct = ((hit / principalNorm.size) * 100).toFixed(1);
      console.log(`    ${kc.padEnd(22)} ${String(values.size).padStart(7)} distinct   matches ${String(hit).padStart(5)}/${principalNorm.size}  (${pct}%)`);
      report[`${file}:${kc}`] = {distinct: values.size, matched: hit, pct: Number(pct)};
    }

    const sit = columnOf(head, ['SIT', 'Situacao', 'SITUACAO']);
    if (sit >= 0) {
      const counts = {};
      for (const r of rows) {
        const s = String(r[sit] ?? '').trim() || '(none)';
        counts[s] = (counts[s] || 0) + 1;
      }
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
      console.log(`    SIT: ${JSON.stringify(Object.fromEntries(top))}`);
    }
    console.log('');
  }

  const best = Object.entries(report).sort((a, b) => b[1].matched - a[1].matched)[0];
  if (best) {
    console.log(`best key: ${best[0]} -> ${best[1].matched}/${principalNorm.size} (${best[1].pct}%)`);
    console.log(`unmatched Principal CNPJs: ${principalNorm.size - best[1].matched}`);
  }
}

main();
