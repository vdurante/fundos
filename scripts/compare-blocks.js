const fs = require('fs');
const {google} = require('googleapis');

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';

const BLOCKS = {
  CDI: {nota: 11, first: 12},
  IBOV: {nota: 17, first: 18},
  Bond: {nota: 23, first: 24},
};
const PERIODS = ['12m', '24m', '36m', '60m', 'T'];

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

function ranks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  order.forEach(([, i], r) => (out[i] = r + 1));
  return out;
}

function pairs(rows, a, b) {
  const xs = [];
  const ys = [];
  for (const row of rows) {
    if (typeof row[a] === 'number' && typeof row[b] === 'number') {
      xs.push(row[a]);
      ys.push(row[b]);
    }
  }
  return [xs, ys];
}

async function main() {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const res = await google
    .sheets({version: 'v4', auth})
    .spreadsheets.values.get({
      spreadsheetId: DOC_ID,
      range: 'Merge!A3:AC3000',
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
  const rows = (res.data.values || []).filter(r => r[0]);

  console.log('Sortino correlation, Bond vs CDI (same fund, same period)');
  PERIODS.forEach((p, i) => {
    const [xs, ys] = pairs(rows, BLOCKS.CDI.first + i, BLOCKS.Bond.first + i);
    console.log(`  ${p.padEnd(4)} n=${String(xs.length).padStart(4)}  r=${pearson(xs, ys).toFixed(4)}`);
  });

  console.log('\nSortino correlation, Bond vs IBOV (for contrast)');
  PERIODS.forEach((p, i) => {
    const [xs, ys] = pairs(rows, BLOCKS.IBOV.first + i, BLOCKS.Bond.first + i);
    console.log(`  ${p.padEnd(4)} n=${String(xs.length).padStart(4)}  r=${pearson(xs, ys).toFixed(4)}`);
  });

  console.log('\nNota (the thing you actually rank on)');
  for (const [a, b] of [
    ['CDI', 'Bond'],
    ['CDI', 'IBOV'],
    ['IBOV', 'Bond'],
  ]) {
    const [xs, ys] = pairs(rows, BLOCKS[a].nota, BLOCKS[b].nota);
    const rs = pearson(ranks(xs), ranks(ys));
    console.log(
      `  ${a} vs ${b}: n=${xs.length}  pearson=${pearson(xs, ys).toFixed(4)}  spearman=${rs.toFixed(4)}`
    );
  }

  const [cdi, bond] = pairs(rows, BLOCKS.CDI.nota, BLOCKS.Bond.nota);
  const rc = ranks(cdi).map(r => cdi.length - r);
  const rb = ranks(bond).map(r => bond.length - r);
  let moved = 0;
  let max = 0;
  for (let i = 0; i < rc.length; i++) {
    const d = Math.abs(rc[i] - rb[i]);
    if (d > 0) moved++;
    max = Math.max(max, d);
  }
  console.log(
    `\nranking by Nota-Bond vs Nota-CDI: ${moved}/${rc.length} funds sit at a different position, largest gap ${max} places`
  );
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
