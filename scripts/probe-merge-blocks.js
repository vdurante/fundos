const fs = require('fs');
const {google} = require('googleapis');

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';

function a1(col) {
  let s = '';
  let n = col + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function main() {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const api = google.sheets({version: 'v4', auth});

  const meta = await api.spreadsheets.get({
    spreadsheetId: DOC_ID,
    fields: 'sheets(properties(sheetId,title),merges)',
  });
  const sheet = meta.data.sheets.find(s => s.properties.title === 'Merge');

  const rowOneMerges = (sheet.merges || []).filter(m => m.startRowIndex === 0);
  console.log(`Merge sheetId=${sheet.properties.sheetId}  row-1 merges=${rowOneMerges.length}`);

  const res = await api.spreadsheets.values.get({
    spreadsheetId: DOC_ID,
    range: 'Merge!1:2',
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const [labels, periods] = res.data.values;

  for (const m of rowOneMerges.sort((a, b) => a.startColumnIndex - b.startColumnIndex)) {
    const label = labels[m.startColumnIndex];
    const cols = [];
    for (let c = m.startColumnIndex + 1; c < m.endColumnIndex; c++) {
      cols.push(`${a1(c)}=${periods[c]}`);
    }
    console.log(
      `  ${a1(m.startColumnIndex)}${1}:${a1(m.endColumnIndex - 1)}1  label="${label}"  ` +
        `periods -> ${cols.join(' ')}`
    );
  }
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
