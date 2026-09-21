const fs = require('fs');
const path = require('path');
const {google} = require('googleapis');

const PKG = path.resolve(__dirname, '..');
const KEY = path.join(PKG, 'config', 'fundos-309615-2795009f4d3e.json');
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';

const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
// Period definitions are READ FROM THE SHEET, so relabeling headers cannot make this
// verifier silently stale. The Sortino math below stays an independent implementation.
const TOTAL_FALLBACK_MONTHS = 120;
const RENT_MONTHS = TOTAL_FALLBACK_MONTHS;

function parsePeriod(label) {
  const text = label === null || label === undefined ? '' : String(label).trim();
  const years = text.match(/^(\d+)\s*[Yy]$/);
  if (years) return Number(years[1]) * 12;
  const months = text.match(/^(\d+)\s*[Mm]$/);
  if (months) return Number(months[1]);
  if (text.toUpperCase() === 'T') return TOTAL_FALLBACK_MONTHS;
  return undefined;
}
const BLOCKS = [
  {series: 'CDI', firstCol: 'M'},
  {series: 'IBOV', firstCol: 'S'},
  {series: 'Risk Free Bond', firstCol: 'Y'},
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

  if (fixOffByOne && !expected.length) return '';

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
    ranges: ['Rentabilidade', 'Indices', 'Principal!A3:AC3000', 'Principal!A2:AC2'],
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
    while (months.length < RENT_MONTHS) {
      months.push('');
    }
    rentByCnpj[row[0]] = months;
  }

  const headerRow = (res.data.valueRanges[3].values || [[]])[0] || [];

  for (const block of BLOCKS) {
    const base = block.firstCol.charCodeAt(0) - 'A'.charCodeAt(0);
    block.periods = [];
    for (let i = 0; i < 5; i++) {
      const label = headerRow[base + i];
      const months = parsePeriod(label);
      if (months === undefined) {
        throw new Error(
          `Principal!${block.firstCol}2 block: header ${JSON.stringify(label)} is not a period`
        );
      }
      block.periods.push({name: String(label).trim(), months});
    }
    console.log(
      `  ${block.series.padEnd(16)} ${block.periods.map(p => `${p.name}=${p.months}`).join(' ')}`
    );
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
      const periods = block.periods;
      const widest = Math.max(...periods.map(p => p.months));
      periods.forEach((period, i) => {
        const sheetValue = row[base + i];
        const mine = calcSortino(
          rents.slice(0, period.months),
          series[block.series].slice(0, period.months),
          period.months === widest,
          true
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

        if (period.months === widest && typeof mine === 'number') {
          const broken = calcSortino(
            rents.slice(0, period.months),
            series[block.series].slice(0, period.months),
            true,
            false
          );
          if (typeof broken === 'number' && Math.abs(broken - mine) > 1e-12) {
            tShifts.push({cnpj: row[0], block: block.series, current: broken, fixed: mine});
          }
        }
      });
    }
  }

  console.log(
    `\nindependent recompute: ${checked - mismatches}/${checked} cells match the sheet ` +
      `(${mergeRows.length} funds x ${BLOCKS.length} blocks x ${BLOCKS[0].periods.length} periods)`
  );

  console.log(`\nitem 2 — T cells that moved vs the pre-fix code (${tShifts.length}):`);
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
