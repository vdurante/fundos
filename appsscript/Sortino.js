const TRACKER_NAME = 'Principal';
const RENT_NAME = 'Rentabilidade';
const BENCH_NAME = 'Indices';

let trackerSheet;
let rentSheet;
let benchSheet;

let rentMonths;
let rentByCnpj;

function sortino() {
  init();

  let processed = 0;

  for (let column = 1; column <= trackerSheet.getMaxColumns(); column++) {
    const indexName = trackerSheet.getRange(1, column).getValue();

    if (!indexName) {
      continue;
    }

    const merged = trackerSheet.getRange(1, column).getMergedRanges();

    if (!merged.length) {
      continue;
    }

    const startCol = merged[0].getColumn() + 1;
    const endCol = merged[0].getLastColumn();

    if (isPeriodBlock(startCol, endCol)) {
      calculateBlock(indexName, startCol, endCol);
      processed++;
    }

    column = endCol;
  }

  if (!processed) {
    throw new Error(
      `Nenhum bloco de periodos encontrado em ${TRACKER_NAME}!1:2`
    );
  }
}

function isPeriodBlock(startCol, endCol) {
  if (endCol < startCol) {
    return false;
  }

  for (let col = startCol; col <= endCol; col++) {
    if (parseMonthCount(trackerSheet.getRange(2, col).getValue()) === undefined) {
      return false;
    }
  }

  return true;
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

  rentMonths = rentMonthColumns(rentSheet.getRange(1, 1, 1, lastColumn).getValues()[0]);
  const monthCount = rentMonths.length;

  const raw = rentSheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();

  rentByCnpj = {};

  raw.forEach(row => {
    const cnpj = row[0] === null || row[0] === undefined ? '' : String(row[0]).trim();
    if (cnpj && !rentByCnpj[cnpj]) {
      rentByCnpj[cnpj] = row.slice(1, monthCount + 1);
    }
  });
}

function rentMonthColumns(headerRow) {
  const keys = [];
  for (let column = 1; column < headerRow.length; column++) {
    const key = monthKeyOf(headerRow[column]);
    if (!key) {
      break;
    }
    keys.push(key);
  }
  return keys;
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
  const text = periodName === null || periodName === undefined ? '' : String(periodName).trim();

  const years = text.match(/^(\d+)\s*[Yy]$/);
  if (years) {
    return +years[1] * 12;
  }

  const months = text.match(/^(\d+)\s*[Mm]$/);
  if (months) {
    return +months[1];
  }

  if (text.toUpperCase() === 'T') {
    return Infinity;
  }

  return undefined;
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
  const indices = benchmarkSeries(indexName);

  const periods = [];

  for (let col = startCol; col <= endCol; col++) {
    periods.push(parseMonthCount(trackerSheet.getRange(2, col).getValue()));
  }

  const lastRow = trackerSheet.getLastRow();

  if (lastRow < 3) {
    return;
  }

  const keys = trackerSheet
    .getRange(3, 1, lastRow - 2, 1)
    .getValues()
    .map(row => (row[0] === null || row[0] === undefined ? '' : String(row[0]).trim()));

  const widestPeriod = Math.max.apply(
    null,
    periods.filter(p => p !== undefined)
  );

  const values = keys.map(cnpj => {
    const rents = cnpj ? rentByCnpj[cnpj] : undefined;

    if (!rents) {
      return periods.map(() => '');
    }

    return periods.map(periodo =>
      periodo === undefined
        ? ''
        : calcSortino(
            rents.slice(0, periodo),
            indices.slice(0, periodo),
            periodo === widestPeriod
          )
    );
  });

  trackerSheet
    .getRange(3, startCol, values.length, endCol - startCol + 1)
    .setValues(values);
}
