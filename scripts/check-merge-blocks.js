const fs = require('fs');
const path = require('path');
const {google} = require('googleapis');

const PKG = path.resolve(__dirname, '..');
const KEY = path.join(PKG, 'config', 'fundos-309615-2795009f4d3e.json');
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';

const BLOCKS = [
  {name: 'CDI', from: 'M', to: 'Q'},
  {name: 'IBOV', from: 'S', to: 'W'},
];
const PERIODS = ['12m', '24m', '36m', '60m', 'T'];

function colIndex(letter) {
  return letter.charCodeAt(0) - 'A'.charCodeAt(0);
}

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
    range: 'Merge!A3:X3000',
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = (res.data.values || []).filter(r => r[0]);
  const isCnpj = v => /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(String(v));
  const valid = rows.filter(r => isCnpj(r[0]));
  const garbage = rows.filter(r => !isCnpj(r[0]));

  console.log(`rows with content in Merge!A: ${rows.length}`);
  console.log(`  valid CNPJ: ${valid.length}`);
  console.log(`  NOT a CNPJ (#REF! etc): ${garbage.length}`);

  for (const block of BLOCKS) {
    const lo = colIndex(block.from);
    const hi = colIndex(block.to);
    const countNumeric = set => {
      let n = 0;
      for (const row of set) {
        for (let c = lo; c <= hi; c++) {
          if (typeof row[c] === 'number') n++;
        }
      }
      return n;
    };
    const good = countNumeric(valid);
    const bad = countNumeric(garbage);
    console.log(
      `  ${block.name.padEnd(5)} numeric on valid rows=${good}  ` +
        `on garbage rows=${bad}  ` +
        `=> ${((bad / (good + bad)) * 100).toFixed(1)}% of every RANK/COUNT denominator is garbage`
    );
  }
  console.log('');

  for (const block of BLOCKS) {
    const lo = colIndex(block.from);
    const hi = colIndex(block.to);
    let numeric = 0;
    let blank = 0;
    let sentinel = 0;
    let error = 0;
    const perPeriodBlank = PERIODS.map(() => 0);

    for (const row of rows) {
      for (let c = lo; c <= hi; c++) {
        const v = row[c];
        if (typeof v === 'number') {
          numeric++;
          if (v === 9.99) sentinel++;
        } else if (v === '' || v === undefined) {
          blank++;
          perPeriodBlank[c - lo]++;
        } else {
          error++;
          if (error <= 3) console.log(`  ${block.name} unexpected cell: ${JSON.stringify(v)}`);
        }
      }
    }

    const total = rows.length * PERIODS.length;
    console.log(
      `${block.name.padEnd(5)} ${block.from}:${block.to}  numeric=${numeric}/${total}  ` +
        `blank=${blank}  9.99=${sentinel} (${((sentinel / total) * 100).toFixed(1)}%)  errors=${error}`
    );
    console.log(
      `      blanks by period: ${PERIODS.map((p, i) => `${p}=${perPeriodBlank[i]}`).join(' ')}`
    );
  }

  console.log('\nfirst 3 funds (CNPJ | CDI 12m 24m 36m 60m T | IBOV 12m 24m 36m 60m T)');
  for (const row of rows.slice(0, 3)) {
    const cdi = PERIODS.map((_, i) => row[colIndex('M') + i]);
    const ibov = PERIODS.map((_, i) => row[colIndex('S') + i]);
    const f = v => (typeof v === 'number' ? v.toFixed(8) : JSON.stringify(v));
    console.log(`  ${row[0]}`);
    console.log(`     CDI  ${cdi.map(f).join('  ')}`);
    console.log(`     IBOV ${ibov.map(f).join('  ')}`);
  }
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
