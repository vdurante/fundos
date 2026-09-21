const TRACKER_NAME = 'Principal';
const RENT_NAME = 'Rentabilidade';
const BENCH_NAME = 'Indices';

let trackerSheet;
let rentSheet;
let benchSheet;

let rentabilidades;
let cnpjs;
let rentMonths;

function sortino() {
  init();

  for (let column = 1; column <= trackerSheet.getMaxColumns(); column++) {
    let indexName = trackerSheet.getRange(1, column).getValue();

    if (!indexName) {
      continue;
    }

    let merged = trackerSheet.getRange(1, column).getMergedRanges();

    if (!merged.length) {
      throw new Error(
        `"${indexName}" em ${TRACKER_NAME}!R1C${column} nao esta mesclado; ` +
          'o bloco precisa cobrir Nota + os periodos'
      );
    }

    calculateBlock(indexName, merged[0].getColumn() + 1, merged[0].getLastColumn());
  }
}

function init() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  trackerSheet = spreadsheet.getSheetByName(TRACKER_NAME);
  rentSheet = spreadsheet.getSheetByName(RENT_NAME);
  benchSheet = spreadsheet.getSheetByName(BENCH_NAME);

  if (!benchSheet) {
    throw new Error(`Aba ${BENCH_NAME} nao encontrada`);
  }

  const lastRow = rentSheet.getLastRow();
  const lastColumn = rentSheet.getLastColumn();

  rentMonths = rentSheet
    .getRange(1, 2, 1, lastColumn - 1)
    .getValues()[0]
    .map(monthKeyOf);

  const raw = rentSheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();

  cnpjs = raw.map(p => p[0]).filter(p => !!p);
  rentabilidades = raw.map(p => p.slice(1, 123));
}

function monthKeyOf(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(
      value,
      SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(),
      'yyyy-MM'
    );
  }

  const text = value === null || value === undefined ? '' : value.toString().trim();
  return /^\d{4}-\d{2}/.test(text) ? text.substring(0, 7) : null;
}

function loadBenchmarkColumn(indexName) {
  const values = benchSheet
    .getRange(1, 1, benchSheet.getLastRow(), benchSheet.getLastColumn())
    .getValues();

  const header = values[0].map(h => (h === null ? '' : h.toString().trim()));
  const column = header.indexOf(indexName);

  if (column === -1) {
    throw new Error(
      `Aba ${BENCH_NAME} nao tem a coluna "${indexName}" (colunas: ${header.join(', ')})`
    );
  }

  const byMonth = {};
  for (let row = 1; row < values.length; row++) {
    const key = monthKeyOf(values[row][0]);
    if (key) {
      byMonth[key] = values[row][column];
    }
  }

  return byMonth;
}

function benchmarkSeries(indexName) {
  const byMonth = loadBenchmarkColumn(indexName);

  return rentMonths.map((key, position) => {
    if (!key) {
      throw new Error(
        `${RENT_NAME} coluna ${position + 2} nao tem um mes valido no cabecalho`
      );
    }

    const value = byMonth[key];

    if (value === '' || value === null || value === undefined) {
      throw new Error(`${BENCH_NAME} nao tem ${indexName} para ${key}`);
    }

    return value;
  });
}

function parseMonthCount(periodName) {
  if (periodName.endsWith('m')) {
    return +periodName.replace('m', '');
  }
  if (periodName.toUpperCase() === 'T') {
    return 122;
  }
}

function calcSortino(expectedReturns, riskFreeReturns, allowNonEmpty = false) {
  if (
    !expectedReturns ||
    !expectedReturns.length ||
    !riskFreeReturns ||
    !riskFreeReturns.length
  ) {
    return '';
  }

  if (riskFreeReturns.length < expectedReturns.length) {
    return '';
  }

  let emptyIndex = expectedReturns.findIndex(e => e.toString() === '');

  if (!allowNonEmpty && emptyIndex !== -1) {
    return '';
  } else if (allowNonEmpty && emptyIndex !== -1) {
    expectedReturns = expectedReturns.slice(0, emptyIndex);
    riskFreeReturns = riskFreeReturns.slice(0, emptyIndex);
  }

  if (!expectedReturns.length) {
    return '';
  }

  let numerador = average(expectedReturns.map((v, i) => v - riskFreeReturns[i]));

  let denominador = Math.sqrt(
    average(expectedReturns.map((v, i) => Math.pow(Math.min(v - riskFreeReturns[i], 0), 2)))
  );

  if (denominador === 0) {
    return 9.99;
  } else {
    return numerador / denominador;
  }
}

function calculateBlock(indexName, startCol, endCol) {
  let indices = benchmarkSeries(indexName);

  let periods = [];

  for (let col = startCol; col <= endCol; col++) {
    let months = parseMonthCount(trackerSheet.getRange(2, col).getValue());
    periods.push(months);
  }

  let values = [];

  for (const [idx, cnpj] of cnpjs.entries()) {
    if (!cnpj) {
      break;
    }

    values[idx] = [];

    let rents = rentabilidades[idx];

    for (let [periodIdx, periodo] of periods.entries()) {
      const sortino = calcSortino(
        rents.slice(0, periodo),
        indices.slice(0, periodo),
        periodo === 122
      );
      values[idx][periodIdx] = sortino;
    }
  }

  trackerSheet
    .getRange(3, startCol, values.length, endCol - startCol + 1)
    .setValues(values);
}
