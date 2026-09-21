const fs = require('fs');
const {google} = require('googleapis');

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const CADASTRO_ID = 1081096016;

const apply = process.argv.includes('--apply');

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

  const read = await api.spreadsheets.values.batchGet({
    spreadsheetId: DOC_ID,
    ranges: ['Cadastro!A1:C1200', 'Volatilidade!A1:B1200'],
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const cad = read.data.valueRanges[0].values || [];
  const vol = read.data.valueRanges[1].values || [];

  const cadRows = cad.slice(1).filter(r => r[0]);
  const volRows = vol.slice(1).filter(r => r[0]);

  console.log(`Cadastro rows: ${cadRows.length}   Volatilidade rows: ${volRows.length}`);
  console.log(`Cadastro header: ${cad[0].join(' | ')}`);

  if (cadRows.length !== volRows.length) {
    console.log('REFUSING: row counts differ');
    return;
  }

  const misaligned = cadRows
    .map((r, i) => (r[0] === volRows[i][0] ? null : `row ${i + 2}: ${r[0]} vs ${volRows[i][0]}`))
    .filter(Boolean);
  if (misaligned.length) {
    console.log(`REFUSING: ${misaligned.length} keys misaligned, e.g. ${misaligned[0]}`);
    return;
  }
  console.log('key alignment: exact on all rows');

  const alreadyThere = cadRows.filter(r => r[2] !== undefined && r[2] !== '').length;
  console.log(`Cadastro column C already populated on ${alreadyThere} rows`);

  const blanks = volRows.filter(r => typeof r[1] !== 'number').length;
  console.log(`Volatilidade values that are not numbers: ${blanks}`);

  const values = volRows.map(r => [
    typeof r[1] === 'number' ? {userEnteredValue: {numberValue: r[1]}} : {userEnteredValue: {}},
  ]);

  const requests = [
    {
      updateSheetProperties: {
        properties: {sheetId: CADASTRO_ID, gridProperties: {columnCount: 3}},
        fields: 'gridProperties.columnCount',
      },
    },
    {
      updateCells: {
        range: {
          sheetId: CADASTRO_ID,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 2,
          endColumnIndex: 3,
        },
        fields: 'userEnteredValue',
        rows: [{values: [{userEnteredValue: {stringValue: 'VOLATILIDADE'}}]}],
      },
    },
    {
      updateCells: {
        range: {
          sheetId: CADASTRO_ID,
          startRowIndex: 1,
          endRowIndex: 1 + values.length,
          startColumnIndex: 2,
          endColumnIndex: 3,
        },
        fields: 'userEnteredValue',
        rows: values.map(v => ({values: v})),
      },
    },
  ];

  console.log(`\nwould write VOLATILIDADE header + ${values.length} values into Cadastro!C`);
  console.log(`first: ${cadRows[0][0]} -> ${volRows[0][1]}`);
  console.log(`last : ${cadRows[cadRows.length - 1][0]} -> ${volRows[volRows.length - 1][1]}`);

  if (!apply) {
    console.log('\nread-only — pass --apply to write');
    return;
  }

  await api.spreadsheets.batchUpdate({spreadsheetId: DOC_ID, requestBody: {requests}});
  console.log('\napplied');
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
