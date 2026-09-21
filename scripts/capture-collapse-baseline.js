const fs = require('fs');
const {google} = require('googleapis');

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const OUT = 'docs/collapse-baseline.json';

function api() {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({version: 'v4', auth});
}

const col = n => {
  let s = '';
  n++;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

async function main() {
  const sheets = api();

  const grab = async (range, render) =>
    (
      await sheets.spreadsheets.values.get({
        spreadsheetId: DOC_ID,
        range,
        valueRenderOption: render,
      })
    ).data.values || [];

  console.log('=== Merge row 3 formulas (what Node must reproduce) ===');
  const mergeF = (await grab("'Merge'!A3:AC3", 'FORMULA'))[0] || [];
  const mergeH = (await grab("'Merge'!A2:AC2", 'FORMATTED_VALUE'))[0] || [];
  const mergeFormulas = {};
  mergeF.forEach((f, i) => {
    if (String(f ?? '') !== '') {
      mergeFormulas[col(i)] = {header: mergeH[i] ?? '', formula: f};
      console.log(`  ${col(i)}  ${String(mergeH[i] ?? '').padEnd(14)} ${f}`);
    }
  });

  console.log('\n=== Variáveis (weights) ===');
  const vars = await grab("'Variáveis'!A1:F20", 'FORMATTED_VALUE');
  vars.forEach((r, i) => {
    if (r.some(c => String(c ?? '') !== '')) console.log(`  row ${i + 1}: ${JSON.stringify(r)}`);
  });

  console.log('\n=== Principal column mapping check ===');
  const pHeaders = (await grab("'Principal'!A2:AD2", 'FORMATTED_VALUE'))[0] || [];
  const pRow3 = (await grab("'Principal'!A3:AD3", 'FORMULA'))[0] || [];
  let mismatches = 0;
  pRow3.forEach((f, i) => {
    const letter = col(i);
    const s = String(f ?? '');
    const m = s.match(/INDEX\(Merge!([A-Z]+):[A-Z]+/);
    if (m) {
      const same = m[1] === letter;
      if (!same) mismatches++;
      console.log(
        `  Principal!${letter.padEnd(3)} ${String(pHeaders[i] ?? '').padEnd(14)} -> Merge!${m[1]}  ${same ? 'same letter' : '*** DIFFERENT ***'}`
      );
    } else if (s !== '') {
      console.log(`  Principal!${letter.padEnd(3)} ${String(pHeaders[i] ?? '').padEnd(14)} literal/other: ${s.slice(0, 60)}`);
    } else {
      console.log(`  Principal!${letter.padEnd(3)} ${String(pHeaders[i] ?? '').padEnd(14)} (empty in row 3)`);
    }
  });
  console.log(`  mapping mismatches: ${mismatches}`);

  console.log('\n=== Full Principal snapshot ===');
  const [pFormulas, pValues] = await Promise.all([
    grab("'Principal'!A1:AD1200", 'FORMULA'),
    grab("'Principal'!A1:AD1200", 'UNFORMATTED_VALUE'),
  ]);
  const dataRows = pFormulas.filter((r, i) => i >= 2 && String(r[0] ?? '') !== '').length;
  console.log(`  rows with a CNPJ in A: ${dataRows}`);

  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        mergeFormulas,
        variaveis: vars,
        principalHeaders: pHeaders,
        principalFormulas: pFormulas,
        principalValues: pValues,
      },
      null,
      1
    )
  );
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`  wrote ${OUT} (${kb} KB)`);
}

main().catch(e => {
  console.error('ERROR: ' + e.message);
  process.exit(1);
});
