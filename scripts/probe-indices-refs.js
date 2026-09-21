const fs = require('fs');
const path = require('path');
const {google} = require('googleapis');

const PKG = path.resolve(__dirname, '..');
const KEY = path.join(PKG, 'config', 'fundos-309615-2795009f4d3e.json');
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';

async function main() {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const api = google.sheets({version: 'v4', auth});

  const meta = await api.spreadsheets.get({spreadsheetId: DOC_ID});
  const sheets = meta.data.sheets.map(s => s.properties);

  console.log('=== SHEETS ===');
  for (const s of sheets) {
    console.log(
      `${String(s.sheetId).padStart(12)}  ${s.title.padEnd(16)} ` +
        `${s.gridProperties.rowCount}x${s.gridProperties.columnCount}`
    );
  }

  console.log('\n=== FORMULAS REFERENCING "Indices" (FULL workbook) ===');
  const ranges = sheets.map(s => `'${s.title}'`);
  const res = await api.spreadsheets.values.batchGet({
    spreadsheetId: DOC_ID,
    ranges,
    valueRenderOption: 'FORMULA',
  });
  let hits = 0;
  res.data.valueRanges.forEach((vr, i) => {
    const title = sheets[i].title;
    (vr.values || []).forEach((row, r) => {
      row.forEach((cell, c) => {
        if (typeof cell === 'string' && /indices/i.test(cell)) {
          hits++;
          console.log(`  ${title} r${r + 1}c${c + 1}: ${cell.slice(0, 120)}`);
        }
      });
    });
  });
  if (!hits) console.log('  none');

  console.log('\n=== CURRENT Indices (backup dump) ===');
  const [vals, forms] = await Promise.all([
    api.spreadsheets.values.get({
      spreadsheetId: DOC_ID,
      range: 'Indices',
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
    api.spreadsheets.values.get({
      spreadsheetId: DOC_ID,
      range: 'Indices',
      valueRenderOption: 'FORMULA',
    }),
  ]);
  const out = {
    captured_at: new Date().toISOString(),
    note: 'Pre-migration snapshot of the wide Indices sheet (row=series, col=month).',
    values: vals.data.values || [],
    formulas: forms.data.values || [],
  };
  const dest = path.join(PKG, 'docs', 'indices-wide-snapshot.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(
    `  rows=${out.values.length} cols=${Math.max(...out.values.map(r => r.length))} -> ${dest}`
  );
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
