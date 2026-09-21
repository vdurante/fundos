const fs = require('fs');
const path = require('path');
const {google} = require('googleapis');

const PKG = path.resolve(__dirname, '..');
const KEY = path.join(PKG, 'config', 'fundos-309615-2795009f4d3e.json');
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const SHEET = 'Indices';
const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);

function monthKeyOf(cell) {
  if (typeof cell === 'number') {
    const d = new Date(SHEETS_EPOCH_UTC + cell * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return String(cell).slice(0, 7);
}

async function main() {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const api = google.sheets({version: 'v4', auth});

  const [shown, raw] = await Promise.all([
    api.spreadsheets.values.get({
      spreadsheetId: DOC_ID,
      range: SHEET,
      valueRenderOption: 'FORMATTED_VALUE',
    }),
    api.spreadsheets.values.get({
      spreadsheetId: DOC_ID,
      range: SHEET,
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
  ]);

  const shownRows = shown.data.values || [];
  const rawRows = raw.data.values || [];
  const header = shownRows[0];

  console.log(`rows=${shownRows.length} (1 header + ${shownRows.length - 1} months)`);
  console.log(`header: ${header.join(' | ')}\n`);

  const sample = [1, 2, 3, shownRows.length - 2, shownRows.length - 1];
  console.log('AS DISPLAYED');
  for (const i of sample) {
    console.log(`  ${shownRows[i].join('  ')}`);
  }
  console.log('\nUNDERLYING VALUES (same rows)');
  for (const i of sample) {
    console.log(`  ${rawRows[i].join('  ')}`);
  }

  const bad = [];
  for (let i = 1; i < shownRows.length; i++) {
    for (let c = 1; c < header.length; c++) {
      if (!/%$/.test(String(shownRows[i][c] ?? ''))) {
        bad.push(`r${i + 1}c${c + 1}="${shownRows[i][c]}"`);
      }
    }
  }
  console.log(
    `\npercent-formatted: ${bad.length === 0 ? 'ALL cells' : `MISSING on ${bad.length} (${bad.slice(0, 5).join(', ')})`}`
  );

  const months = rawRows.slice(1).map(r => monthKeyOf(r[0]));
  const gaps = [];
  for (let i = 0; i < months.length - 1; i++) {
    const [y, m] = months[i].split('-').map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    if (months[i + 1] !== prev) gaps.push(`${months[i]} -> ${months[i + 1]}`);
  }
  console.log(`month sequence: ${months[0]} .. ${months[months.length - 1]}`);
  console.log(`gaps: ${gaps.length === 0 ? 'none' : gaps.join(', ')}`);

  const empty = [];
  for (let i = 1; i < rawRows.length; i++) {
    for (let c = 1; c < header.length; c++) {
      if (rawRows[i][c] === undefined || rawRows[i][c] === '') {
        empty.push(`${months[i - 1]}/${header[c]}`);
      }
    }
  }
  console.log(`empty value cells: ${empty.length === 0 ? 'none' : empty.join(', ')}`);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
