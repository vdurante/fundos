const fs = require('fs');
const {google} = require('googleapis');
const {getCadastros} = require('../build/src/fundos/crawler-cadastros');
const {CNPJ_FUNDOS} = require('../build/src/tracker');

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const SNAPSHOT = 'docs/fundos-snapshot.json';

function api() {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({version: 'v4', auth});
}

async function main() {
  const sheets = api();

  const live = await sheets.spreadsheets.values.get({
    spreadsheetId: DOC_ID,
    range: "'Fundos'!A1:F2000",
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = live.data.values || [];
  const header = rows[0];
  const body = rows.slice(1).filter(r => String(r[0] ?? '') !== '');

  fs.writeFileSync(SNAPSHOT, JSON.stringify({header, rows: body}, null, 1));
  console.log(`snapshot: ${body.length} rows -> ${SNAPSHOT}`);
  console.log(`header:   ${JSON.stringify(header)}`);

  const liveByCnpj = new Map(body.map(r => [String(r[0]), r]));

  const cadastros = await getCadastros();
  console.log(`\ngetCadastros(): ${cadastros.length} rows`);
  const withName = cadastros.filter(c => String(c['DENOM_SOCIAL'] ?? '').trim() !== '');
  console.log(`  with DENOM_SOCIAL: ${withName.length}`);
  const cadCnpjs = new Set(cadastros.map(c => String(c['CNPJ_FUNDO'])));
  console.log(`  distinct CNPJ:     ${cadCnpjs.size}`);

  const situacoes = {};
  for (const c of cadastros) {
    const s = String(c['SIT'] ?? '(none)');
    situacoes[s] = (situacoes[s] || 0) + 1;
  }
  console.log(`  SIT breakdown:     ${JSON.stringify(situacoes)}`);

  console.log(`\nCNPJ_FUNDOS constant: ${new Set(CNPJ_FUNDOS).size} distinct`);
  console.log(`live Fundos rows:     ${liveByCnpj.size}`);

  const padded = [...new Set(CNPJ_FUNDOS)].filter(c => !cadCnpjs.has(c));
  console.log(`\nwould be padded (no cadastro row): ${padded.length}`);

  let nameWipes = 0;
  const wipeSamples = [];
  for (const cnpj of padded) {
    const liveRow = liveByCnpj.get(cnpj);
    if (liveRow && String(liveRow[1] ?? '').trim() !== '') {
      nameWipes++;
      if (wipeSamples.length < 5) wipeSamples.push(`${cnpj} = ${liveRow[1]}`);
    }
  }
  console.log(`  of those, live rows WITH a name that would be blanked: ${nameWipes}`);
  wipeSamples.forEach(s => console.log(`    ${s}`));

  const newKeys = [...new Set(CNPJ_FUNDOS)].filter(c => !liveByCnpj.has(c));
  console.log(`\nwould be appended (not in live sheet): ${newKeys.length}`);

  const vanished = [...liveByCnpj.keys()].filter(c => !new Set(CNPJ_FUNDOS).has(c));
  console.log(`would be blanked (live key not in CNPJ_FUNDOS): ${vanished.length}`);

  process.exit(0);
}

main().catch(e => {
  console.error('ERROR: ' + e.message);
  process.exit(1);
});
