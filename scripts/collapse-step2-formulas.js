const fs = require('fs');
const {google} = require('googleapis');

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const APPLY = process.argv.includes('--apply');
const FIRST_ROW = 3;
const LAST_ROW = 1123;

const BLOCKS = [
  {label: 'L', periods: ['M', 'N', 'O', 'P', 'Q']},
  {label: 'R', periods: ['S', 'T', 'U', 'V', 'W']},
  {label: 'X', periods: ['Y', 'Z', 'AA', 'AB', 'AC']},
];

const letterToIndex = s => {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

// Risco guarded on a blank J so a data-less fund is not banded as "00 ~ 05".
const riscoFormula = r =>
  `=IF(J${r}="";"";IFS(J${r}<=0,05; "00 ~ 05"; J${r}<=0,1; "05 ~ 10"; J${r}<=0,25; "10 ~ 25"; J${r} <= 100; "25~100"))`;

const dpFormula = r => `=COUNTIF(M${r}:Q${r}; "<>"&"")`;

const notaFormula = (r, p) =>
  `=IFERROR((\n` +
  `'Variáveis'!$B$4 * IFERROR(RANK(${p[0]}${r}; ${p[0]}:${p[0]};1)/count(${p[0]}:${p[0]});0) +\n` +
  `'Variáveis'!$B$5 * IFERROR(RANK(${p[1]}${r}; ${p[1]}:${p[1]};1)/count(${p[1]}:${p[1]});0) + \n` +
  `'Variáveis'!$B$6 * IFERROR(RANK(${p[2]}${r}; ${p[2]}:${p[2]};1)/count(${p[2]}:${p[2]});0) + \n` +
  `'Variáveis'!$B$7 * IFERROR(RANK(${p[3]}${r}; ${p[3]}:${p[3]};1)/count(${p[3]}:${p[3]});0) + \n` +
  `'Variáveis'!$B$3 * IFERROR(RANK(${p[4]}${r}; ${p[4]}:${p[4]};1)/count(${p[4]}:${p[4]}); 0))\n` +
  `/INDEX('Variáveis'!$C$3:$C$7;$K${r};0); "")`;

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

async function main() {
  const sheets = api(APPLY);
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: DOC_ID,
    fields: 'sheets(properties(sheetId,title))',
  });
  const sheetId = meta.data.sheets.find(s => s.properties.title === 'Principal').properties
    .sheetId;

  const keys = (
    await sheets.spreadsheets.values.get({
      spreadsheetId: DOC_ID,
      range: `'Principal'!A${FIRST_ROW}:A${LAST_ROW}`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    })
  ).data.values || [];

  const targetRows = [];
  keys.forEach((r, i) => {
    if (String(r[0] ?? '') !== '') targetRows.push(FIRST_ROW + i);
  });
  console.log(`keyed rows to convert: ${targetRows.length}`);

  const requests = [];
  const put = (rowIndex, colLetter, formula) =>
    requests.push({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: rowIndex - 1,
          endRowIndex: rowIndex,
          startColumnIndex: letterToIndex(colLetter),
          endColumnIndex: letterToIndex(colLetter) + 1,
        },
        fields: 'userEnteredValue',
        rows: [{values: [{userEnteredValue: {formulaValue: formula}}]}],
      },
    });

  for (const r of targetRows) {
    put(r, 'C', riscoFormula(r));
    put(r, 'K', dpFormula(r));
    for (const b of BLOCKS) put(r, b.label, notaFormula(r, b.periods));
  }

  console.log(`formula cells to write: ${requests.length}`);
  console.log(`\nsample C:\n  ${riscoFormula(3)}`);
  console.log(`sample K:\n  ${dpFormula(3)}`);
  console.log(`sample L:\n${notaFormula(3, BLOCKS[0].periods).split('\n').map(l => '  ' + l).join('\n')}`);

  if (!APPLY) {
    console.log('\nDRY RUN — pass --apply to write');
    return;
  }

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
