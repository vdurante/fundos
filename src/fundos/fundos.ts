/* eslint-disable no-debugger */
import axios from 'axios';
import * as AdmZip from 'adm-zip';
import * as parse from 'csv-parse/lib/index';
import * as cacache from 'cacache';
import * as Papa from 'papaparse';
import * as _ from 'lodash';
import {
  BTG_FUNDOS,
  CNPJ_FUNDOS,
  isTracked,
  XP_FUNDOS,
  CNPJ_MANUAL,
} from '../tracker';
import {
  GoogleSpreadsheet,
  GoogleSpreadsheetWorksheet,
} from 'google-spreadsheet';
import {getQuotas, getQuotasMonthly} from './crawler-quotas';
import {CsvType, range} from '../shared';
import * as m from 'mathjs';
import {isNumber} from 'lodash';
import {getCadastros} from './crawler-cadastros';
import {
  Benchmarks,
  CDI,
  FIXED_SIX,
  getBenchmarks,
  IBOV,
  RISK_FREE_BOND,
} from './crawler-indices';
import {e} from 'mathjs';

const BENCHMARKS_SHEET = 'Indices';
const LEGACY_BENCHMARKS_SHEET = 'Benchmarks';
const BENCHMARK_COLUMNS = [CDI, IBOV, RISK_FREE_BOND, FIXED_SIX];
const BENCHMARK_START_YEAR = 2011;
const BENCHMARK_PERCENT_PATTERN = '0.00%';

async function writeToSheet(
  doc: GoogleSpreadsheet,
  sheetName: string,
  monthIndexes: string[],
  data: {[key: string]: string | number}[]
) {
  const sheet = doc.sheetsByTitle[sheetName];

  await sheet.resize({
    columnCount: monthIndexes.length + 1,
    rowCount: Object.keys(data).length + 1,
  });

  await sheet.clear();
  await sheet.saveUpdatedCells();

  await sheet.setHeaderRow(['CNPJ_FUNDO', ...monthIndexes]);
  await sheet.saveUpdatedCells();

  await sheet.addRows(data);
  await sheet.saveUpdatedCells();
}

async function writeToSheetNew(
  doc: GoogleSpreadsheet,
  sheetName: string,
  headers: string[],
  data: {[key: string]: string | number}[]
) {
  const missing = _.difference(
    CNPJ_FUNDOS,
    data.map(p => p['CNPJ_FUNDO'].toString())
  );

  data.push(
    ...missing.map(p => {
      return {CNPJ_FUNDO: p};
    })
  );

  data = _(data).uniqBy('CNPJ_FUNDO').sortBy('CNPJ_FUNDO').value();

  data.map(p => {
    if (Object.keys(CNPJ_MANUAL).includes(p['CNPJ_FUNDO'].toString())) {
      p['DENOM_SOCIAL'] = CNPJ_MANUAL[p['CNPJ_FUNDO'].toString()];
    }
  });

  const sheet = doc.sheetsByTitle[sheetName];

  await sheet.resize({
    columnCount: headers.length,
    rowCount: data.length + 1,
  });

  await sheet.clear();
  await sheet.saveUpdatedCells();

  await sheet.setHeaderRow(headers);
  await sheet.saveUpdatedCells();

  await sheet.addRows(data);
  await sheet.saveUpdatedCells();
}

function computeVolatilidades(quotas: CsvType[]) {
  return _(quotas)
    .groupBy('CNPJ_FUNDO')
    .mapValues(g => {
      const fq = _(g)
        .filter(p => {
          return +p['DT_COMPTC'].substring(0, 4) >= 2018;
        })
        .sortBy('DT_COMPTC')
        .map(p => parseFloat(p['VL_QUOTA']))
        .filter(p => isNumber(p) && p !== undefined && p !== null && p > 0)
        .map((curr, i, arr) => {
          if (i === 0) {
            return 0;
          } else {
            return (curr - arr[i - 1]) / arr[i - 1];
          }
        })
        .value();

      return m.std(fq) * m.sqrt(252);
    })
    .map((volatilidade, cnpj) => {
      return {
        CNPJ_FUNDO: cnpj,
        VOLATILIDADE: volatilidade,
      };
    })
    .value();
}

async function writeBenchmarks(doc: GoogleSpreadsheet, benchmarks: Benchmarks) {
  const headers = ['MONTH', ...BENCHMARK_COLUMNS];

  let sheet = doc.sheetsByTitle[BENCHMARKS_SHEET];
  if (!sheet) {
    sheet = await doc.addSheet({
      title: BENCHMARKS_SHEET,
      headerValues: headers,
    });
  }

  const rows = benchmarks.months.map(month => {
    const row: {[key: string]: string | number} = {MONTH: month};
    for (const name of BENCHMARK_COLUMNS) {
      const value = benchmarks.series[name][month];
      if (value !== undefined) {
        row[name] = value;
      }
    }
    return row;
  });

  await sheet.resize({
    columnCount: headers.length,
    rowCount: rows.length + 1,
  });

  await sheet.clear();
  await sheet.saveUpdatedCells();

  await sheet.setHeaderRow(headers);
  await sheet.saveUpdatedCells();

  await sheet.addRows(rows);
  await sheet.saveUpdatedCells();

  await formatBenchmarkPercentages(sheet, rows.length);
}

async function formatBenchmarkPercentages(
  sheet: GoogleSpreadsheetWorksheet,
  dataRowCount: number
) {
  if (dataRowCount === 0) {
    return;
  }

  const lastColumn = String.fromCharCode('A'.charCodeAt(0) + BENCHMARK_COLUMNS.length);
  const lastRow = dataRowCount + 1;
  await sheet.loadCells(`B2:${lastColumn}${lastRow}`);

  for (let row = 1; row <= dataRowCount; row++) {
    for (let column = 1; column <= BENCHMARK_COLUMNS.length; column++) {
      const cell = sheet.getCell(row, column);
      cell.numberFormat = {
        type: 'PERCENT',
        pattern: BENCHMARK_PERCENT_PATTERN,
      };
    }
  }

  await sheet.saveUpdatedCells();
}

async function dropLegacyBenchmarksSheet(doc: GoogleSpreadsheet) {
  const legacy = doc.sheetsByTitle[LEGACY_BENCHMARKS_SHEET];
  if (!legacy) {
    return;
  }

  await legacy.delete();
  console.log(`dropped legacy sheet ${LEGACY_BENCHMARKS_SHEET}`);
}

async function writeCadastros(
  doc: GoogleSpreadsheet,
  csv: CsvType[],
  volatilidades: {CNPJ_FUNDO: string; VOLATILIDADE: number}[]
) {
  const byCnpj = _.keyBy(volatilidades, 'CNPJ_FUNDO');

  const rows = csv.map(p => {
    const cnpj = p['CNPJ_FUNDO'].toString();
    const volatilidade = byCnpj[cnpj]?.VOLATILIDADE;
    return {
      ...p,
      VOLATILIDADE: volatilidade === undefined ? '' : volatilidade,
    } as {[key: string]: string | number};
  });

  await writeToSheetNew(
    doc,
    'Cadastro',
    ['CNPJ_FUNDO', 'DENOM_SOCIAL', 'VOLATILIDADE'],
    rows
  );
}

async function writeCorretoras(doc: GoogleSpreadsheet, cadastros: CsvType[]) {
  let csv: CsvType[] = [];

  const denomSocial = (cnpjFundo: string) =>
    cadastros.find(p => p['CNPJ_FUNDO'] === cnpjFundo)?.DENOM_SOCIAL;
  csv = [
    ...csv,
    ...XP_FUNDOS.map(cnpjFundo => {
      return {
        CORRETORA: 'XP',
        CNPJ_FUNDO: cnpjFundo,
        DENOM_SOCIAL: denomSocial(cnpjFundo),
      } as CsvType;
    }),
  ];
  csv = [
    ...csv,
    ...BTG_FUNDOS.map(cnpjFundo => {
      return {
        CORRETORA: 'BTG',
        CNPJ_FUNDO: cnpjFundo,
        DENOM_SOCIAL: denomSocial(cnpjFundo),
      } as CsvType;
    }),
  ];

  const headers = ['CORRETORA', 'CNPJ_FUNDO', 'DENOM_SOCIAL'];
  csv = _(csv).sortBy('CNPJ_FUNDO').value();

  const sheet = doc.sheetsByTitle['Corretoras'];

  await sheet.resize({
    columnCount: headers.length,
    rowCount: csv.length + 1,
  });

  await sheet.clear();
  await sheet.saveUpdatedCells();

  await sheet.setHeaderRow(headers);
  await sheet.saveUpdatedCells();

  await sheet.addRows(csv);
  await sheet.saveUpdatedCells();
}

async function getDoc() {
  const fs = require('fs');
  const creds = JSON.parse(
    fs.readFileSync('config/fundos-309615-2795009f4d3e.json', 'utf8')
  );
  const doc = new GoogleSpreadsheet(
    '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0'
  );
  await doc.useServiceAccountAuth(creds);

  await doc.loadInfo(); // loads document properties and worksheets

  return doc;
}

async function writeRentabilidades(doc: GoogleSpreadsheet, quotas: CsvType[]) {
  const rentabilidades = _(quotas)
    .filter(p => parseFloat(p['VL_QUOTA']) > 0)
    .orderBy(['DT_COMPTC'], ['desc'])
    .groupBy('CNPJ_FUNDO')
    .mapValues(g => {
      const tmp = _(g)
        .groupBy(h => h['DT_COMPTC'].substring(0, 7))
        .mapValues(h => _.maxBy(h, 'DT_COMPTC') || {})
        .values()
        .map((curr, i, arr) => {
          const currMonth = curr['DT_COMPTC'].substring(0, 7);
          const r = {};

          if (i + 1 === arr.length) {
            r[currMonth] = 0;
          } else {
            const currQuota = parseFloat(curr['VL_QUOTA']);
            const prevQuota = parseFloat(arr[i + 1]['VL_QUOTA']);
            r[currMonth] = (currQuota - prevQuota) / prevQuota;
          }
          return r;
        })
        .value();
      const final = {};
      return _.assign(final, ...tmp);
    })
    .map((rents, cnpj) => {
      return {
        CNPJ_FUNDO: cnpj,
        ...rents,
      };
    })

    .value();

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  const headers = ['CNPJ_FUNDO'];
  for (let year = currentYear; year >= currentYear - 11; year--) {
    for (
      let month = year === currentYear ? currentMonth : 12;
      month >= 1;
      month--
    ) {
      headers.push(`${year}-${month.toString().padStart(2, '0')}`);
    }
  }

  await writeToSheetNew(doc, 'Rentabilidade', headers, rentabilidades);
}

export async function runBenchmarks(startYear = BENCHMARK_START_YEAR) {
  const doc = await getDoc();

  const benchmarks = await getBenchmarks(startYear);
  await writeBenchmarks(doc, benchmarks);
  await dropLegacyBenchmarksSheet(doc);

  console.log(
    `writeBenchmarks done (${benchmarks.months.length} months, ` +
      `${benchmarks.months[benchmarks.months.length - 1]} .. ${benchmarks.months[0]})`
  );
}

export async function run() {
  //const currentYear = new Date().getFullYear();
  const currentYear = 2022;
  const currentMonth = new Date().getMonth();

  const doc = await getDoc();

  const benchmarks = await getBenchmarks(currentYear - 11);
  await writeBenchmarks(doc, benchmarks);
  console.log('writeBenchmarks done');

  const rawQuotas = await getQuotas(currentYear, currentYear - 11);

  const volatilidades = computeVolatilidades(rawQuotas);
  console.log(`computeVolatilidades done (${volatilidades.length} funds)`);

  await writeRentabilidades(doc, rawQuotas);
  console.log('writeRentabilidades done');

  const cadastros = await getCadastros();

  await writeCadastros(doc, cadastros, volatilidades);
  console.log('writeCadastros done');

  await writeCorretoras(doc, cadastros);
  console.log('writeCorretoras done');
}
