const fs = require('fs');
const {google} = require('googleapis');

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const SHEET = 'Merge';
const SHEET_ID = 1603894158;
const FIRST_ROW = 3;
const NOTA_COLUMNS = {L: 11, R: 17};

const testOnly = process.argv.includes('--test-row-3');
const apply = process.argv.includes('--apply');

function wrap(formula) {
  const body = formula.replace(/^=/, '').trim();
  if (/^IFERROR\s*\(/i.test(body)) {
    return null;
  }
  return `=IFERROR(${body}; "")`;
}

function auth(scopes) {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  return new google.auth.JWT({email: key.client_email, key: key.private_key, scopes});
}

async function main() {
  const scopes = [
    apply
      ? 'https://www.googleapis.com/auth/spreadsheets'
      : 'https://www.googleapis.com/auth/spreadsheets.readonly',
  ];
  const api = google.sheets({version: 'v4', auth: auth(scopes)});

  const lastRow = testOnly ? FIRST_ROW : 3000;
  const ranges = Object.keys(NOTA_COLUMNS).map(c => `${SHEET}!${c}${FIRST_ROW}:${c}${lastRow}`);

  const read = await api.spreadsheets.values.batchGet({
    spreadsheetId: DOC_ID,
    ranges,
    valueRenderOption: 'FORMULA',
  });

  const requests = [];
  let wrapped = 0;
  let already = 0;
  let empty = 0;

  Object.keys(NOTA_COLUMNS).forEach((letter, i) => {
    const column = NOTA_COLUMNS[letter];
    const rows = read.data.valueRanges[i].values || [];

    const cells = rows.map(row => {
      const formula = row[0];
      if (typeof formula !== 'string' || !formula.startsWith('=')) {
        empty++;
        return null;
      }
      const next = wrap(formula);
      if (next === null) {
        already++;
        // Re-write the existing formula unchanged. Returning null here would emit
        // an empty userEnteredValue, which CLEARS the cell rather than skipping it.
        return formula;
      }
      wrapped++;
      return next;
    });

    const lastIndex = cells.reduce((acc, c, idx) => (c === null ? acc : idx), -1);
    if (lastIndex === -1) return;

    requests.push({
      updateCells: {
        range: {
          sheetId: SHEET_ID,
          startRowIndex: FIRST_ROW - 1,
          endRowIndex: FIRST_ROW - 1 + lastIndex + 1,
          startColumnIndex: column,
          endColumnIndex: column + 1,
        },
        fields: 'userEnteredValue',
        rows: cells.slice(0, lastIndex + 1).map(c => ({
          values: [c === null ? {} : {userEnteredValue: {formulaValue: c}}],
        })),
      },
    });
  });

  console.log(`columns: ${Object.keys(NOTA_COLUMNS).join(', ')}`);
  console.log(`to wrap: ${wrapped}   already wrapped: ${already}   non-formula/empty: ${empty}`);

  const sample = read.data.valueRanges[0].values?.[0]?.[0];
  if (sample) {
    console.log(`\nsample BEFORE:\n${sample}`);
    console.log(`\nsample AFTER:\n${wrap(sample) ?? '(unchanged)'}`);
  }

  if (!apply) {
    console.log('\nread-only — pass --apply to write');
    return;
  }

  await api.spreadsheets.batchUpdate({spreadsheetId: DOC_ID, requestBody: {requests}});
  console.log(`\napplied ${requests.length} updateCells request(s)`);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
