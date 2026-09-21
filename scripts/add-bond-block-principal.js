const fs = require('fs');
const {google} = require('googleapis');

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const PRINCIPAL_ID = 2025255252;

const BOND_COLUMNS = ['X', 'Y', 'Z', 'AA', 'AB', 'AC'];
const START_INDEX = 23; // X
const POINTER = '$AD';
const FIRST_ROW = 3;
const LAST_ROW = 1123;

const apply = process.argv.includes('--apply');

function cells(values) {
  return {values: values.map(v => ({userEnteredValue: {formulaValue: v}}))};
}

async function main() {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [
      apply
        ? 'https://www.googleapis.com/auth/spreadsheets'
        : 'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  });
  const api = google.sheets({version: 'v4', auth});

  const occupied = await api.spreadsheets.values.get({
    spreadsheetId: DOC_ID,
    range: 'Principal!X1:AC2000',
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const existing = (occupied.data.values || []).flat().filter(v => v !== '' && v !== undefined);
  console.log(`Principal X:AC occupied cells -> ${existing.length}`);
  if (existing.length) {
    console.log('REFUSING: not empty.');
    return;
  }

  const rowCount = LAST_ROW - FIRST_ROW + 1;

  const requests = [
    {
      updateCells: {
        range: {
          sheetId: PRINCIPAL_ID,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: START_INDEX,
          endColumnIndex: START_INDEX + 1,
        },
        fields: 'userEnteredValue',
        rows: [cells(['=Merge!X1'])],
      },
    },
    {
      mergeCells: {
        range: {
          sheetId: PRINCIPAL_ID,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: START_INDEX,
          endColumnIndex: START_INDEX + BOND_COLUMNS.length,
        },
        mergeType: 'MERGE_ROWS',
      },
    },
    {
      updateCells: {
        range: {
          sheetId: PRINCIPAL_ID,
          startRowIndex: 1,
          endRowIndex: 2,
          startColumnIndex: START_INDEX,
          endColumnIndex: START_INDEX + BOND_COLUMNS.length,
        },
        fields: 'userEnteredValue',
        rows: [cells(BOND_COLUMNS.map(c => `=Merge!${c}2`))],
      },
    },
    {
      updateCells: {
        range: {
          sheetId: PRINCIPAL_ID,
          startRowIndex: FIRST_ROW - 1,
          endRowIndex: LAST_ROW,
          startColumnIndex: START_INDEX,
          endColumnIndex: START_INDEX + BOND_COLUMNS.length,
        },
        fields: 'userEnteredValue',
        rows: Array.from({length: rowCount}, (_, i) =>
          cells(BOND_COLUMNS.map(c => `=INDEX(Merge!${c}:${c}; ${POINTER}${FIRST_ROW + i})`))
        ),
      },
    },
  ];

  console.log(`\nX1  = =Merge!X1   (merged X1:AC1)`);
  console.log(`row 2 = ${BOND_COLUMNS.map(c => `=Merge!${c}2`).join(' | ')}`);
  console.log(`rows ${FIRST_ROW}..${LAST_ROW} = =INDEX(Merge!<col>:<col>; ${POINTER}<row>)`);

  if (!apply) {
    console.log('\nread-only — pass --apply to write');
    return;
  }

  await api.spreadsheets.batchUpdate({spreadsheetId: DOC_ID, requestBody: {requests}});
  console.log(`\napplied ${requests.length} requests`);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
