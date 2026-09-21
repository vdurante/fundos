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

  const res = await api.spreadsheets.values.batchGet({
    spreadsheetId: DOC_ID,
    ranges: ['Merge!A3:A3000', 'Rentabilidade!A2:A2000'],
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const mergeCol = (res.data.valueRanges[0].values || []).map(r => (r[0] === undefined ? '' : r[0]));
  const rentCol = (res.data.valueRanges[1].values || []).map(r => (r[0] === undefined ? '' : r[0]));

  const rentRaw = rentCol.length;
  const rentFiltered = rentCol.filter(v => !!v);
  const mergeNonEmpty = mergeCol.filter(v => v !== '');

  console.log(`Merge!A3..        cells=${mergeCol.length}  non-empty=${mergeNonEmpty.length}`);
  console.log(`Rentabilidade!A2..  cells=${rentRaw}  non-empty=${rentFiltered.length}`);
  console.log(
    `Rentabilidade blank-CNPJ rows inside the data range: ` +
      `${rentCol.slice(0, rentFiltered.length + 5).filter(v => !v).length}`
  );

  const refErrors = mergeNonEmpty.filter(v => String(v).startsWith('#'));
  console.log(`\nMerge!A error cells: ${refErrors.length}`);
  if (refErrors.length) {
    const firstIdx = mergeCol.findIndex(v => String(v).startsWith('#'));
    console.log(`  first at Merge row ${firstIdx + 3}: ${JSON.stringify(mergeCol[firstIdx])}`);
  }

  let aligned = 0;
  let diverged = 0;
  let firstDivergence = null;
  const limit = Math.min(mergeNonEmpty.length, rentFiltered.length);
  for (let i = 0; i < limit; i++) {
    if (mergeNonEmpty[i] === rentFiltered[i]) {
      aligned++;
    } else {
      diverged++;
      if (!firstDivergence) {
        firstDivergence = {
          position: i,
          mergeRow: i + 3,
          merge: mergeNonEmpty[i],
          rent: rentFiltered[i],
        };
      }
    }
  }

  console.log(`\npositional comparison over ${limit} rows: aligned=${aligned} diverged=${diverged}`);
  if (firstDivergence) {
    console.log(
      `  first divergence at Merge row ${firstDivergence.mergeRow}: ` +
        `Merge="${firstDivergence.merge}" vs Rentabilidade="${firstDivergence.rent}"`
    );
  }

  const rentSet = new Set(rentFiltered);
  const missing = mergeNonEmpty.filter(v => !String(v).startsWith('#') && !rentSet.has(v));
  console.log(`\nMerge CNPJs absent from Rentabilidade: ${missing.length}`);
  if (missing.length) console.log(`  e.g. ${missing.slice(0, 5).join(', ')}`);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
