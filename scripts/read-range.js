const fs = require('fs');
const path = require('path');
const {google} = require('googleapis');

const PKG = path.resolve(__dirname, '..');
const KEY = path.join(PKG, 'config', 'fundos-309615-2795009f4d3e.json');
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const RANGE = process.argv[2] || 'Merge!A1:X6';

async function main() {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const api = google.sheets({version: 'v4', auth});

  const res = await api.spreadsheets.values.get({
    spreadsheetId: DOC_ID,
    range: RANGE,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  (res.data.values || []).forEach((row, i) => {
    console.log(`r${i + 1}: ${row.map(c => (c === '' ? '·' : c)).join(' | ')}`);
  });
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
