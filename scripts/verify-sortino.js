const fs = require('fs');
const path = require('path');
const {google} = require('googleapis');

const PKG = path.resolve(__dirname, '..');
const KEY = path.join(PKG, 'config', 'fundos-309615-2795009f4d3e.json');
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';

const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
const PERIODS = [
  {name: '12m', months: 12},
  {name: '24m', months: 24},
  {name: '36m', months: 36},
  {name: '60m', months: 60},
  {name: 'T', months: 122},
];
const BLOCKS = [
  {series: 'CDI', firstCol: 'M'},
  {series: 'IBOV', firstCol: 'S'},
];
const SAMPLE = process.argv[2] ? Number(process.argv[2]) : 25;

function monthKeyOf(cell) {
  if (typeof cell === 'number') {
    const d = new Date(SHEETS_EPOCH_UTC + cell * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const text = cell === null || cell === undefined ? '' : String(cell).trim();
  return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : null;
}

const average = arr => arr.reduce((p, c) => p + c, 0) / arr.length;

function calcSortino(expected, riskFree, allowNonEmpty, fixOffByOne) {
  if (!expected || !expected.length || !riskFree || !riskFree.length) return '';
  if (riskFree.length < expected.length) return '';

  let emptyIndex = expected.findIndex(e => e.toString() === '');

  if (!allowNonEmpty && emptyIndex !== -1) return '';
  if (allowNonEmpty && emptyIndex !== -1) {
    const end = fixOffByOne ? emptyIndex : emptyIndex + 1;
    expected = expected.slice(0, end);
    riskFree = riskFree.slice(0, end);
  }

  const numerador = average(expected.map((v, i) => v - riskFree[i]));
  const denominador = Math.sqrt(
    average(expected.map((v, i) => Math.pow(Math.min(v - riskFree[i], 0), 2)))
  );

  return denominador === 0 ? 9.99 : numerador / denominador;
}

async function main() {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const api = google.sheets({version: 'v4', auth});

  const res = await api.spreadsheets.values.batchGet({
    spreadsheetId: DOC_ID,
    ranges: ['Rentabilidade', 'Indices', 'Merge!A3:X3000'],
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const [rent, indices, merge] = res.data.valueRanges.map(v => v.values || []);

  const rentMonths = rent[0].slice(1).map(monthKeyOf);

  const indexHeader = indices[0].map(h => String(h).trim());
  const byMonth = {};
  for (const name of indexHeader.slice(1)) byMonth[name] = {};
  for (let r = 1; r < indices.length; r++) {
    const key = monthKeyOf(indices[r][0]);
    if (!key) continue;
    for (let c = 1; c < indexHeader.length; c++) {
      byMonth[indexHeader[c]][key] = indices[r][c];
    }
  }

  const series = {};
  for (const {series: name} of BLOCKS) {
    series[name] = rentMonths.map(k => byMonth[name][k]);
  }

  const rentByCnpj = {};
  for (let r = 1; r < rent.length; r++) {
    const row = rent[r];
    if (!row[0]) continue;
    const months = row.slice(1, 123).map(v => (v === undefined ? '' : v));
    while (months.length < 122) {
      months.push('');
    }
    rentByCnpj[row[0]] = months;
  }

  const mergeRows = merge.filter(r => r[0]).slice(0, SAMPLE);
  let checked = 0;
  let mismatches = 0;
  const tShifts = [];

  for (const row of mergeRows) {
    const rents = rentByCnpj[row[0]];
    if (!rents) {
      console.log(`  ${row[0]}: absent from Rentabilidade, skipped`);
      continue;
    }

    for (const block of BLOCKS) {
      const base = block.firstCol.charCodeAt(0) - 'A'.charCodeAt(0);
      PERIODS.forEach((period, i) => {
        const sheetValue = row[base + i];
        const mine = calcSortino(
          rents.slice(0, period.months),
          series[block.series].slice(0, period.months),
          period.months === 122,
          false
        );

        checked++;
        const bothBlank = mine === '' && (sheetValue === '' || sheetValue === undefined);
        const close =
          typeof mine === 'number' &&
          typeof sheetValue === 'number' &&
          Math.abs(mine - sheetValue) < 1e-9;

        if (!bothBlank && !close) {
          mismatches++;
          if (mismatches <= 8) {
            console.log(
              `  MISMATCH ${row[0]} ${block.series} ${period.name}: ` +
                `sheet=${JSON.stringify(sheetValue)} mine=${JSON.stringify(mine)}`
            );
          }
        }

        if (period.name === 'T' && typeof mine === 'number') {
          const fixed = calcSortino(rents.slice(0, 122), series[block.series].slice(0, 122), true, true);
          if (typeof fixed === 'number' && Math.abs(fixed - mine) > 1e-12) {
            tShifts.push({cnpj: row[0], block: block.series, current: mine, fixed});
          }
        }
      });
    }
  }

  console.log(
    `\nindependent recompute: ${checked - mismatches}/${checked} cells match the sheet ` +
      `(${mergeRows.length} funds x 2 blocks x 5 periods)`
  );

  console.log(`\nitem 2 preview — T column if the off-by-one is fixed (${tShifts.length} of the sampled T cells move):`);
  for (const s of tShifts.slice(0, 8)) {
    const delta = s.fixed - s.current;
    console.log(
      `  ${s.cnpj} ${s.block.padEnd(4)} ${s.current.toFixed(8)} -> ${s.fixed.toFixed(8)}  ` +
        `(${delta > 0 ? '+' : ''}${delta.toFixed(8)})`
    );
  }
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
