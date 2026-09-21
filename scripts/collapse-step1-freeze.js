const fs = require('fs');
const {google} = require('googleapis');

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const APPLY = process.argv.includes('--apply');

const FIRST_ROW = 3;
const LAST_ROW = 1123;
// owned DATA columns, 0-based: B, H, I, J, then the three Sortino blocks
const DATA_COLS = [1, 7, 8, 9, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28];

const col = n => {
  let s = '';
  n++;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

function api(write) {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [
      write
        ? 'https://www.googleapis.com/auth/spreadsheets'
        : 'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  });
  return google.sheets({version: 'v4', auth});
}

const isError = v => typeof v === 'string' && v.startsWith('#');

function encode(v) {
  if (v === undefined || v === null || v === '' || isError(v)) return {};
  if (typeof v === 'number') return Number.isFinite(v) ? {numberValue: v} : {};
  if (typeof v === 'boolean') return {boolValue: v};
  return {stringValue: String(v)};
}

async function main() {
  const sheets = api(APPLY);

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: DOC_ID,
    fields: 'sheets(properties(sheetId,title))',
  });
  const sheetId = meta.data.sheets.find(s => s.properties.title === 'Principal').properties
    .sheetId;

  const got = await sheets.spreadsheets.values.get({
    spreadsheetId: DOC_ID,
    range: `'Principal'!A${FIRST_ROW}:AC${LAST_ROW}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = got.data.values || [];

  const plan = [];
  let errorsBlanked = 0;
  let skippedNoKey = 0;
  const stats = {};

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const cnpj = String(row[0] ?? '');
    if (cnpj === '') {
      skippedNoKey++;
      continue;
    }
    const values = {};
    for (const c of DATA_COLS) {
      const v = row[c];
      if (isError(v)) errorsBlanked++;
      values[c] = encode(v);
      const kind = isError(v)
        ? 'error->blank'
        : v === undefined || v === '' ? 'blank' : typeof v;
      stats[kind] = (stats[kind] || 0) + 1;
    }
    plan.push({rowIndex: FIRST_ROW - 1 + i, values});
  }

  console.log(`rows with a key:        ${plan.length}`);
  console.log(`rows skipped (no key):  ${skippedNoKey}`);
  console.log(`cells to write:         ${plan.length * DATA_COLS.length}`);
  console.log(`  error cells -> blank: ${errorsBlanked}`);
  console.log(`  value kinds:          ${JSON.stringify(stats)}`);
  console.log(`columns: ${DATA_COLS.map(col).join(',')}`);

  if (!APPLY) {
    console.log('\nDRY RUN — pass --apply to write');
    return;
  }

  const requests = [];
  for (const p of plan) {
    for (const c of DATA_COLS) {
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: p.rowIndex,
            endRowIndex: p.rowIndex + 1,
            startColumnIndex: c,
            endColumnIndex: c + 1,
          },
          fields: 'userEnteredValue',
          rows: [{values: [{userEnteredValue: p.values[c]}]}],
        },
      });
    }
  }
  console.log(`\nsending ${requests.length} updateCells requests...`);
  const BATCH = 2000;
  for (let i = 0; i < requests.length; i += BATCH) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: DOC_ID,
      requestBody: {requests: requests.slice(i, i + BATCH)},
    });
    console.log(`  ${Math.min(i + BATCH, requests.length)}/${requests.length}`);
  }
  console.log('done');
}

main().catch(e => {
  console.error('ERROR: ' + e.message);
  process.exit(1);
});
