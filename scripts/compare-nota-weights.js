const fs = require('fs');
const {google} = require('googleapis');

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';

// Merge column indexes (0-based). Period order matches the Nota formula's term order.
const BLOCKS = {
  CDI: {nota: 11, periods: [12, 13, 14, 15, 16]},
  IBOV: {nota: 17, periods: [18, 19, 20, 21, 22]},
};
// Formula term order: 12m, 24m, 36m, 60m, T -> Variáveis rows B4,B5,B6,B7,B3
const TERM_ORDER = [0, 1, 2, 3, 4];
const T_TERM = 4;

function rankAscending(value, sorted) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

function notaFor(row, block, columns, weights) {
  const filled = block.periods.filter(c => typeof row[c] === 'number').length;
  if (filled === 0) return '';

  let total = 0;
  for (const term of TERM_ORDER) {
    const column = block.periods[term];
    const value = row[column];
    if (typeof value !== 'number') continue;
    total += weights[term] * (rankAscending(value, columns[column]) / columns[column].length);
  }

  // Acumulado is the running total in Variáveis order: T, 12m, 24m, 36m, 60m
  const running = [];
  let acc = 0;
  for (const idx of [T_TERM, 0, 1, 2, 3]) {
    acc += weights[idx];
    running.push(acc);
  }
  const divisor = running[filled - 1];
  return divisor === 0 ? '' : total / divisor;
}

async function main() {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const res = await google
    .sheets({version: 'v4', auth})
    .spreadsheets.values.get({
      spreadsheetId: DOC_ID,
      range: 'Merge!A3:X3000',
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
  const rows = (res.data.values || []).filter(r => r[0]);

  const columns = {};
  for (const block of Object.values(BLOCKS)) {
    for (const c of block.periods) {
      columns[c] = rows.map(r => r[c]).filter(v => typeof v === 'number').sort((a, b) => a - b);
    }
  }

  // weights in TERM_ORDER slots: [12m, 24m, 36m, 60m, T]
  const withT = [1, 1, 1, 1, 1];
  const withoutT = [1, 1, 1, 1, 0];

  for (const [label, block] of Object.entries(BLOCKS)) {
    const scored = rows.map(r => ({
      cnpj: r[0],
      sheet: r[block.nota],
      now: notaFor(r, block, columns, withT),
      before: notaFor(r, block, columns, withoutT),
    }));

    const checkable = scored.filter(s => typeof s.sheet === 'number' && typeof s.now === 'number');
    const agree = checkable.filter(s => Math.abs(s.sheet - s.now) < 1e-9).length;
    console.log(
      `\n${label}: reimplementation matches the sheet on ${agree}/${checkable.length} funds`
    );

    const order = list =>
      list
        .filter(s => typeof s.now === 'number' && typeof s.before === 'number')
        .slice()
        .sort((a, b) => b[list === 'x' ? 'now' : 'now'] - a.now);

    const rankable = scored.filter(
      s => typeof s.now === 'number' && typeof s.before === 'number'
    );
    const nowOrder = rankable.slice().sort((a, b) => b.now - a.now).map(s => s.cnpj);
    const beforeOrder = rankable.slice().sort((a, b) => b.before - a.before).map(s => s.cnpj);

    const posBefore = new Map(beforeOrder.map((c, i) => [c, i]));
    let moved = 0;
    let maxMove = 0;
    nowOrder.forEach((c, i) => {
      const delta = Math.abs(i - posBefore.get(c));
      if (delta > 0) moved++;
      maxMove = Math.max(maxMove, delta);
    });

    const top10Before = new Set(beforeOrder.slice(0, 10));
    const top10Now = nowOrder.slice(0, 10);
    const enteredTop10 = top10Now.filter(c => !top10Before.has(c));

    console.log(`  funds comparable both ways: ${rankable.length}`);
    console.log(`  changed position: ${moved}   largest move: ${maxMove} places`);
    console.log(`  new entrants to the top 10: ${enteredTop10.length ? enteredTop10.join(', ') : 'none'}`);
    console.log('  top 5 now:');
    nowOrder.slice(0, 5).forEach((c, i) => {
      const s = rankable.find(x => x.cnpj === c);
      console.log(
        `    ${i + 1}. ${c}  nota=${s.now.toFixed(6)}  (was ${s.before.toFixed(6)}, ` +
          `position ${posBefore.get(c) + 1})`
      );
    });
  }
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
