const fs = require('fs');
const {google} = require('googleapis');

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const TARGET = process.argv[2] || 'Volatilidade';

function a1(n) {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
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
    fields:
      'namedRanges,sheets(properties(sheetId,title),conditionalFormats,protectedRanges,basicFilter)',
  });

  const sheets = meta.data.sheets.map(s => s.properties);
  const target = sheets.find(s => s.title === TARGET);
  console.log(`target sheet: ${TARGET} ${target ? `(sheetId ${target.sheetId})` : 'NOT FOUND'}`);

  // 1. Named ranges pointing at the target sheet
  const named = (meta.data.namedRanges || []).filter(
    n => target && n.range && n.range.sheetId === target.sheetId
  );
  console.log(`\nnamed ranges on ${TARGET}: ${named.length}`);
  named.forEach(n => console.log(`  ${n.name}`));

  // 2. Conditional formats / protected ranges referencing it via formula
  let cfHits = 0;
  for (const s of meta.data.sheets) {
    for (const cf of s.conditionalFormats || []) {
      const json = JSON.stringify(cf);
      if (json.includes(TARGET)) {
        cfHits++;
        console.log(`  conditional format on ${s.properties.title} mentions ${TARGET}`);
      }
    }
  }
  console.log(`conditional formats mentioning ${TARGET}: ${cfHits}`);

  // 3. Every formula in every sheet
  const ranges = sheets.map(s => `'${s.title}'`);
  const res = await api.spreadsheets.values.batchGet({
    spreadsheetId: DOC_ID,
    ranges,
    valueRenderOption: 'FORMULA',
  });

  let total = 0;
  const perSheet = {};
  res.data.valueRanges.forEach((vr, i) => {
    const title = sheets[i].title;
    (vr.values || []).forEach((row, r) => {
      row.forEach((cell, c) => {
        if (typeof cell === 'string' && cell.includes(TARGET)) {
          total++;
          perSheet[title] = (perSheet[title] || 0) + 1;
          if (perSheet[title] <= 3) {
            console.log(`  ${title}!${a1(c)}${r + 1} = ${cell.slice(0, 80)}`);
          }
        }
      });
    });
  });

  console.log(`\nformula cells referencing "${TARGET}": ${total}`);
  Object.entries(perSheet).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  const clean = named.length === 0 && cfHits === 0 && total === 0;
  console.log(`\n=> ${clean ? 'CLEAN: nothing references it' : 'STILL REFERENCED — do not delete'}`);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
