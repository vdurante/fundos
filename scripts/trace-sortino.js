const fs = require('fs');
const path = require('path');
const {google} = require('googleapis');

const PKG = path.resolve(__dirname, '..');
const KEY = path.join(PKG, 'config', 'fundos-309615-2795009f4d3e.json');
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);

const CNPJ = process.argv[2] || '12.796.232/0001-87';
const SERIES = process.argv[3] || 'CDI';

function monthKeyOf(cell) {
  if (typeof cell === 'number') {
    const d = new Date(SHEETS_EPOCH_UTC + cell * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const text = cell === null || cell === undefined ? '' : String(cell).trim();
  return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : null;
}

const average = a => a.reduce((p, c) => p + c, 0) / a.length;

async function main() {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const res = await google
    .sheets({version: 'v4', auth})
    .spreadsheets.values.batchGet({
      spreadsheetId: DOC_ID,
      ranges: ['Rentabilidade', 'Indices'],
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
  const [rent, indices] = res.data.valueRanges.map(v => v.values || []);

  const months = rent[0].slice(1).map(monthKeyOf);
  const header = indices[0].map(h => String(h).trim());
  const col = header.indexOf(SERIES);
  const byMonth = {};
  for (let r = 1; r < indices.length; r++) {
    const k = monthKeyOf(indices[r][0]);
    if (k) byMonth[k] = indices[r][col];
  }

  const row = rent.find(r => r[0] === CNPJ);
  if (!row) throw new Error(`${CNPJ} not in Rentabilidade`);

  const rents = row.slice(1, 123).map(v => (v === undefined ? '' : v));
  while (rents.length < 122) rents.push('');
  const bench = months.slice(0, 122).map(k => byMonth[k]);

  const emptyIndex = rents.findIndex(e => e.toString() === '');
  console.log(`fund ${CNPJ}   benchmark ${SERIES}`);
  console.log(`months of real history: ${emptyIndex}   first blank at index ${emptyIndex} (${months[emptyIndex]})\n`);

  const show = (label, end) => {
    const e = rents.slice(0, end);
    const b = bench.slice(0, end);
    const diffs = e.map((v, i) => v - b[i]);
    const down = diffs.map(d => Math.pow(Math.min(d, 0), 2));
    const num = average(diffs);
    const den = Math.sqrt(average(down));
    console.log(`${label}  (slice(0, ${end}) -> ${e.length} months)`);
    console.log(`  last 2 months: fund=[${e.slice(-2).map(v => JSON.stringify(v)).join(', ')}]  bench=[${b.slice(-2).map(v => v.toFixed(6)).join(', ')}]`);
    console.log(`  last 2 diffs : [${diffs.slice(-2).map(d => d.toFixed(6)).join(', ')}]`);
    console.log(`  last 2 downside^2: [${down.slice(-2).map(d => d.toExponential(3)).join(', ')}]`);
    console.log(`  numerador=${num.toFixed(8)}  denominador=${den.toFixed(8)}  sortino=${(num / den).toFixed(8)}\n`);
    return {num, den, sortino: num / den};
  };

  const broken = show('CURRENT (bug): includes the blank', emptyIndex + 1);
  const fixed = show('FIXED: stops before the blank', emptyIndex);

  console.log(`the invented month alone contributes ${(Math.pow(Math.min(0 - bench[emptyIndex], 0), 2)).toExponential(3)} to the downside sum`);
  console.log(`real months' largest downside^2: ${Math.max(...rents.slice(0, emptyIndex).map((v, i) => Math.pow(Math.min(v - bench[i], 0), 2))).toExponential(3)}`);
  console.log(`\nsortino ${broken.sortino.toFixed(8)} -> ${fixed.sortino.toFixed(8)}`);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
