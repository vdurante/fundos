const fs = require('fs');
const {google} = require('googleapis');
const {writeKeyed} = require('../build/src/fundos/sheet-writer');

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const TITLE = '__writer_test';
const HEADERS = ['CNPJ_FUNDO', 'NAME', 'NUM', 'FLAG'];

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`}`);
}

function api() {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({version: 'v4', auth});
}

async function readGrid(sheets) {
  const [vals, meta] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: DOC_ID,
      range: `'${TITLE}'!A1:D50`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
    sheets.spreadsheets.get({
      spreadsheetId: DOC_ID,
      fields: 'sheets(properties(title,sheetId,gridProperties))',
    }),
  ]);
  const props = meta.data.sheets.find(s => s.properties.title === TITLE).properties;
  return {rows: vals.data.values || [], props};
}

async function main() {
  const sheets = api();

  const before = await sheets.spreadsheets.get({
    spreadsheetId: DOC_ID,
    fields: 'sheets(properties(title,sheetId))',
  });
  const stale = before.data.sheets.find(s => s.properties.title === TITLE);
  if (stale) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: DOC_ID,
      requestBody: {requests: [{deleteSheet: {sheetId: stale.properties.sheetId}}]},
    });
  }

  const created = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: DOC_ID,
    requestBody: {
      requests: [
        {addSheet: {properties: {title: TITLE, gridProperties: {rowCount: 20, columnCount: 8}}}},
      ],
    },
  });
  const sheetId = created.data.replies[0].addSheet.properties.sheetId;

  try {
    console.log('run 1 — seed 4 rows');
    let s = await writeKeyed(TITLE, HEADERS, [
      {CNPJ_FUNDO: 'k1', NAME: 'one', NUM: 1.5, FLAG: true},
      {CNPJ_FUNDO: 'k2', NAME: 'two', NUM: 2, FLAG: false},
      {CNPJ_FUNDO: 'k3', NAME: 'three', NUM: '', FLAG: true},
      {CNPJ_FUNDO: 'k4', NAME: 'four', NUM: 4, FLAG: false},
    ]);
    check('appended 4', s.appended, 4);
    check('matched 0', s.matched, 0);
    check('rowCount not shrunk', s.rowCountAfter >= 20, true);

    let g = await readGrid(sheets);
    check('header', g.rows[0], HEADERS);
    check('k1 row', g.rows[1], ['k1', 'one', 1.5, true]);

    // The values API reports a truly-empty cell and an empty string identically,
    // so ask the sheet itself. An empty string here would make COUNTIF("<>"&"")
    // count the cell as populated -- the exact bug that hit Merge!K.
    await sheets.spreadsheets.values.update({
      spreadsheetId: DOC_ID,
      range: `'${TITLE}'!F1:F2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {values: [['=ISBLANK(C4)'], ['=COUNTIF(C4;"<>"&"")']]},
    });
    const probe = await sheets.spreadsheets.values.get({
      spreadsheetId: DOC_ID,
      range: `'${TITLE}'!F1:F2`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    check('k3 empty NUM is ISBLANK', probe.data.values[0][0], true);
    check('k3 empty NUM not counted as populated', probe.data.values[1][0], 0);

    console.log('run 2 — update 2, drop k2, add k5');
    s = await writeKeyed(TITLE, HEADERS, [
      {CNPJ_FUNDO: 'k1', NAME: 'ONE-v2', NUM: 9.25, FLAG: false},
      {CNPJ_FUNDO: 'k3', NAME: 'THREE-v2', NUM: 3, FLAG: true},
      {CNPJ_FUNDO: 'k4', NAME: 'four', NUM: 4, FLAG: false},
      {CNPJ_FUNDO: 'k5', NAME: 'five', NUM: 5, FLAG: true},
    ]);
    check('matched 3', s.matched, 3);
    check('appended 1', s.appended, 1);
    check('appendedKeys', s.appendedKeys, ['k5']);
    check('blanked 1 (k2)', s.blanked, 1);

    g = await readGrid(sheets);
    check('k1 updated in place', g.rows[1], ['k1', 'ONE-v2', 9.25, false]);
    check('k2 key kept, values blanked', g.rows[2], ['k2']);
    check('k3 still at row 4', g.rows[3][0], 'k3');
    check('k5 appended at row 6', g.rows[5], ['k5', 'five', 5, true]);
    check('row order preserved', g.rows.slice(1).map(r => r[0]), ['k1', 'k2', 'k3', 'k4', 'k5']);

    console.log('run 3 — growth past the grid');
    const many = [];
    for (let i = 1; i <= 30; i++) many.push({CNPJ_FUNDO: 'g' + i, NAME: 'g' + i, NUM: i, FLAG: true});
    s = await writeKeyed(TITLE, HEADERS, many);
    check('grid grew', s.rowCountAfter > s.rowCountBefore, true);
    check('appended 30', s.appended, 30);
    check('blanked the 5 earlier keys', s.blanked, 5);

    g = await readGrid(sheets);
    check('k1 blanked but key kept', g.rows[1], ['k1']);
    check('gridProperties never shrank', g.props.gridProperties.rowCount >= 36, true);
    check('columnCount never shrank', g.props.gridProperties.columnCount >= 8, true);
  } finally {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: DOC_ID,
      requestBody: {requests: [{deleteSheet: {sheetId}}]},
    });
    console.log(`\ncleaned up scratch sheet ${TITLE}`);
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
