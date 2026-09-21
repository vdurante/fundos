const fs = require('fs');
const {google} = require('googleapis');

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const SHEET_ID = 1603894158;

const LABEL = 'Risk Free Bond';
const LABEL_COLUMN = 23; // X
const PERIOD_COLUMNS = ['Y', 'Z', 'AA', 'AB', 'AC'];
const PERIOD_NAMES = ['12m', '24m', '36m', '60m', 'T'];
// Variáveis weight rows, in the same term order the existing Nota formulas use.
const WEIGHT_ROWS = ['$B$4', '$B$5', '$B$6', '$B$7', '$B$3'];
const FIRST_ROW = 3;

const apply = process.argv.includes('--apply');

function notaFormula(row) {
  const terms = PERIOD_COLUMNS.map(
    (col, i) =>
      `'Variáveis'!${WEIGHT_ROWS[i]} * IFERROR(RANK(${col}${row}; ${col}:${col};1)` +
      `/count(${col}:${col});0)`
  );
  return (
    `=IFERROR((\n${terms.join(' +\n')})` +
    `\n/INDEX('Variáveis'!$C$3:$C$7;$K${row};0); "")`
  );
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

  // How many data rows does the tracker have? Match column A's extent.
  const read = await api.spreadsheets.values.get({
    spreadsheetId: DOC_ID,
    range: `Merge!A${FIRST_ROW}:A`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rowCount = (read.data.values || []).filter(r => r[0] !== undefined && r[0] !== '').length;
  const lastRow = FIRST_ROW + rowCount - 1;

  // Guard: refuse to overwrite anything already occupying X..AC.
  const occupied = await api.spreadsheets.values.get({
    spreadsheetId: DOC_ID,
    range: 'Merge!X1:AC2000',
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const existing = (occupied.data.values || []).flat().filter(v => v !== '' && v !== undefined);
  console.log(`tracker data rows: ${rowCount} (rows ${FIRST_ROW}..${lastRow})`);
  console.log(`cells already in X:AC -> ${existing.length}`);
  if (existing.length) {
    console.log('REFUSING: X:AC is not empty. Pick a different placement.');
    return;
  }

  const requests = [
    {
      updateCells: {
        range: {
          sheetId: SHEET_ID,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: LABEL_COLUMN,
          endColumnIndex: LABEL_COLUMN + 1,
        },
        fields: 'userEnteredValue',
        rows: [{values: [{userEnteredValue: {stringValue: LABEL}}]}],
      },
    },
    {
      mergeCells: {
        range: {
          sheetId: SHEET_ID,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: LABEL_COLUMN,
          endColumnIndex: LABEL_COLUMN + 1 + PERIOD_COLUMNS.length,
        },
        mergeType: 'MERGE_ROWS',
      },
    },
    {
      updateCells: {
        range: {
          sheetId: SHEET_ID,
          startRowIndex: 1,
          endRowIndex: 2,
          startColumnIndex: LABEL_COLUMN,
          endColumnIndex: LABEL_COLUMN + 1 + PERIOD_COLUMNS.length,
        },
        fields: 'userEnteredValue',
        rows: [
          {
            values: ['Nota', ...PERIOD_NAMES].map(v => ({
              userEnteredValue: {stringValue: v},
            })),
          },
        ],
      },
    },
    {
      updateCells: {
        range: {
          sheetId: SHEET_ID,
          startRowIndex: FIRST_ROW - 1,
          endRowIndex: lastRow,
          startColumnIndex: LABEL_COLUMN,
          endColumnIndex: LABEL_COLUMN + 1,
        },
        fields: 'userEnteredValue',
        rows: Array.from({length: rowCount}, (_, i) => ({
          values: [{userEnteredValue: {formulaValue: notaFormula(FIRST_ROW + i)}}],
        })),
      },
    },
  ];

  console.log(`\nlabel: X1 = "${LABEL}"  merged X1:AC1`);
  console.log(`row 2: ${['Nota', ...PERIOD_NAMES].join(' | ')}`);
  console.log(`\nNota formula for row 3:\n${notaFormula(3)}`);

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
