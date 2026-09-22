/**
 * Behavioural digest of the code the TypeScript 7 upgrade touches, computed offline
 * from the cache so it is reproducible before and after.
 *
 * The upgrade's import-style fixes change the EMITTED JavaScript (namespace import ->
 * default import adds interop helpers) in the four files that compute returns, and
 * those files have no direct test. A green compile proves nothing about the numbers.
 *
 *   node test/digest-fundos.js > before.json   # then upgrade, then again, then diff
 *
 * Deliberately does NOT call getQuotasMonthly or getCadastros: the first returns an
 * empty array for the current year (open defect, see the notes in this file's output)
 * and the second always hits the network. Both would make the comparison vacuous.
 * Instead the monthly aggregation is driven directly over a cached INF_DIARIO zip, so
 * the column resolution and the tracked-universe filter run against real data.
 */
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const Papa = require('papaparse');
const cacache = require('cacache');

const {cnpjColumnOf} = require('../build/src/fundos/crawler-quotas');
const {rentMonthKeys, rentYearRange} = require('../build/src/fundos/fundos');
const {
  calcSortino,
  parseMonthCount,
  columnToA1,
  monthKeyOf,
} = require('../build/src/fundos/sortino');
const {isTracked} = require('../build/src/tracker');
const {range} = require('../build/src/shared');

const ZIP =
  'http://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_202608.zip';

const sha = v =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(v))
    .digest('hex')
    .slice(0, 16);

const FIXED_NOW = new Date(Date.UTC(2026, 8, 22));

function pureDigest() {
  const headers = {
    hist2016: 'CNPJ_FUNDO;DT_COMPTC;VL_QUOTA',
    monthly2023: 'TP_FUNDO;CNPJ_FUNDO;DT_COMPTC;VL_QUOTA',
    monthly2024:
      'TP_FUNDO_CLASSE;CNPJ_FUNDO_CLASSE;ID_SUBCLASSE;DT_COMPTC;VL_QUOTA',
  };
  const cnpjColumn = {};
  for (const [k, v] of Object.entries(headers)) cnpjColumn[k] = cnpjColumnOf(v);

  let unknownHeaderThrows = false;
  try {
    cnpjColumnOf('TP;DT_COMPTC;VL_QUOTA');
  } catch (e) {
    unknownHeaderThrows = true;
  }

  const monthKeys = rentMonthKeys(FIXED_NOW);
  const series = [
    0.01, -0.02, 0.03, -0.015, 0.008, 0.02, -0.005, 0.011, 0.004, -0.03, 0.017,
    0.006,
  ];
  const bench = series.map((_, i) => 0.005 + i * 0.0001);

  return {
    cnpjColumn,
    unknownHeaderThrows,
    monthKeys,
    monthKeyCount: monthKeys.length,
    yearRange: rentYearRange(monthKeys),
    range: [range(1, 5), range(2026, 2023, -1), range(3, 3)],
    parseMonthCount: ['12M', '3Y', 'T', 'bogus'].map(s =>
      String(parseMonthCount(s)),
    ),
    columnToA1: [1, 26, 27, 52, 53, 703].map(n => columnToA1(n)),
    monthKeyOf: [46000, '2026-09-01', '', null].map(v => String(monthKeyOf(v))),
    calcSortino: String(calcSortino(series, bench, 12)),
    calcSortinoShort: String(
      calcSortino(series.slice(0, 3), bench.slice(0, 3), 12),
    ),
    calcSortinoNoDownside: String(
      calcSortino([0.02, 0.03, 0.04], [0.001, 0.001, 0.001], 3),
    ),
  };
}

/** The real monthly aggregation, driven over a cached zip rather than the network. */
async function realDataDigest() {
  const {data} = await cacache.get('.cache', ZIP);
  const entries = new AdmZip(data).getEntries();

  const monthly = {};
  let rows = 0;
  let kept = 0;

  for (const entry of entries) {
    const text = entry.getData().toString();
    const cnpjColumn = cnpjColumnOf(text.slice(0, text.indexOf('\n')));
    Papa.parse(text, {
      header: true,
      delimiter: ';',
      worker: true,
      skipEmptyLines: true,
      step: results => {
        rows++;
        const cnpj = results.data[cnpjColumn];
        if (!isTracked(cnpj)) return;
        kept++;
        const month = String(results.data['DT_COMPTC'] || '').slice(0, 7);
        const quota = parseFloat(results.data['VL_QUOTA']);
        if (!month || !Number.isFinite(quota)) return;
        monthly[cnpj] = monthly[cnpj] || {};
        monthly[cnpj][month] = quota;
      },
      complete: () => {},
    });
  }

  const cnpjs = Object.keys(monthly).sort();
  const sample = {};
  for (const c of cnpjs.slice(0, 5)) sample[c] = monthly[c];

  return {
    zip: ZIP.split('/').pop(),
    rowsScanned: rows,
    rowsTracked: kept,
    cnpjCount: cnpjs.length,
    firstFiveCnpjs: cnpjs.slice(0, 5),
    sample,
    fullDigest: sha(monthly),
  };
}

async function main() {
  const out = {
    pure: pureDigest(),
    realData: await realDataDigest(),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

main().catch(e => {
  process.stdout.write(
    JSON.stringify({error: String(e && e.stack)}, null, 2) + '\n',
  );
  process.exit(1);
});
