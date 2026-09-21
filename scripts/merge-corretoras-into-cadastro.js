const fs = require('fs');
const {google} = require('googleapis');

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const CADASTRO_ID = 1081096016;

// Column D/E/F of Cadastro. Order mirrors Merge!H2/I2 ("BTG", "XP").
const FLAGS = ['BTG', 'XP', 'MANUAL'];
const FIRST_COLUMN = 3; // D

const apply = process.argv.includes('--apply');

async function main() {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [
      apply
        ? 'https://www.googleapis.com/auth/spreadsheets'
        : 'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
  });
  const api = google.sheets({version: 'v4', auth});

  const read = await api.spreadsheets.values.batchGet({
    spreadsheetId: DOC_ID,
    ranges: ['Cadastro!A1:F1200', 'Corretoras!A1:B2000'],
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const cad = read.data.valueRanges[0].values || [];
  const cor = read.data.valueRanges[1].values || [];

  const cadRows = cad.slice(1).filter(r => r[0]);
  console.log(`Cadastro rows: ${cadRows.length}   header: ${cad[0].join(' | ')}`);

  // Pivot Corretoras (one row per fund per broker) into a flag set per fund.
  const byFund = {};
  const seenBrokers = {};
  for (const row of cor.slice(1)) {
    const broker = String(row[0] ?? '').trim();
    const cnpj = String(row[1] ?? '').trim();
    if (!broker || !cnpj) continue;
    seenBrokers[broker] = (seenBrokers[broker] || 0) + 1;
    byFund[cnpj] = byFund[cnpj] || new Set();
    byFund[cnpj].add(broker);
  }
  console.log(`Corretoras brokers: ${JSON.stringify(seenBrokers)}`);

  const unknown = Object.keys(seenBrokers).filter(b => !FLAGS.includes(b));
  if (unknown.length) {
    console.log(`REFUSING: broker value(s) with no column: ${unknown.join(', ')}`);
    return;
  }

  const notInCadastro = Object.keys(byFund).filter(
    c => !cadRows.some(r => r[0] === c)
  ).length;
  console.log(`Corretoras funds absent from Cadastro: ${notInCadastro}`);

  const counts = {};
  const values = cadRows.map(r => {
    const set = byFund[r[0]] || new Set();
    return FLAGS.map(flag => {
      const on = set.has(flag);
      if (on) counts[flag] = (counts[flag] || 0) + 1;
      return {userEnteredValue: {boolValue: on}};
    });
  });
  console.log(`flags to write: ${JSON.stringify(counts)}`);

  const requests = [
    {
      updateSheetProperties: {
        properties: {
          sheetId: CADASTRO_ID,
          gridProperties: {columnCount: FIRST_COLUMN + FLAGS.length},
        },
        fields: 'gridProperties.columnCount',
      },
    },
    {
      updateCells: {
        range: {
          sheetId: CADASTRO_ID,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: FIRST_COLUMN,
          endColumnIndex: FIRST_COLUMN + FLAGS.length,
        },
        fields: 'userEnteredValue',
        rows: [{values: FLAGS.map(f => ({userEnteredValue: {stringValue: f}}))}],
      },
    },
    {
      updateCells: {
        range: {
          sheetId: CADASTRO_ID,
          startRowIndex: 1,
          endRowIndex: 1 + values.length,
          startColumnIndex: FIRST_COLUMN,
          endColumnIndex: FIRST_COLUMN + FLAGS.length,
        },
        fields: 'userEnteredValue',
        rows: values.map(v => ({values: v})),
      },
    },
  ];

  if (!apply) {
    console.log('\nread-only — pass --apply to write');
    return;
  }

  await api.spreadsheets.batchUpdate({spreadsheetId: DOC_ID, requestBody: {requests}});
  console.log('\napplied');
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
