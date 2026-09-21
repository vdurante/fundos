import {sheets_v4, google} from 'googleapis';
import * as fs from 'fs';

const CREDENTIALS_PATH = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';

const TRACKER_NAME = 'Principal';
const RENT_NAME = 'Rentabilidade';
const BENCH_NAME = 'Indices';

const FIRST_DATA_ROW = 3;
const RENT_MONTH_COUNT = 122;
const TOTAL_PERIOD_CAP_MONTHS = 120;
const SENTINEL = 9.99;
const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
const CNPJ_PATTERN = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;

type Cell = string | number | null | undefined;
type Grid = Cell[][];

export interface Block {
  label: string;
  startColumn: number;
  endColumn: number;
  periods: (number | undefined)[];
}

export function columnToA1(columnIndex: number): string {
  let name = '';
  let n = columnIndex + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export function monthKeyOf(value: Cell): string | null {
  if (typeof value === 'number') {
    const date = new Date(SHEETS_EPOCH_UTC + value * 86400000);
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${date.getUTCFullYear()}-${month}`;
  }

  const text = value === null || value === undefined ? '' : String(value).trim();
  return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : null;
}

export function parseMonthCount(periodName: Cell): number | undefined {
  const text = periodName === null || periodName === undefined ? '' : String(periodName).trim();

  const years = text.match(/^(\d+)\s*[Yy]$/);
  if (years) {
    return Number(years[1]) * 12;
  }

  const months = text.match(/^(\d+)\s*[Mm]$/);
  if (months) {
    return Number(months[1]);
  }

  if (text.toUpperCase() === 'T') {
    return TOTAL_PERIOD_CAP_MONTHS;
  }

  return undefined;
}

const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

export function calcSortino(
  expectedReturns: Cell[],
  riskFreeReturns: number[],
  allowNonEmpty = false
): number | '' {
  if (!expectedReturns.length || !riskFreeReturns.length) {
    return '';
  }
  if (riskFreeReturns.length < expectedReturns.length) {
    return '';
  }

  let expected = expectedReturns;
  let riskFree = riskFreeReturns;

  const emptyIndex = expected.findIndex(e => String(e ?? '') === '');

  if (!allowNonEmpty && emptyIndex !== -1) {
    return '';
  }
  if (allowNonEmpty && emptyIndex !== -1) {
    expected = expected.slice(0, emptyIndex);
    riskFree = riskFree.slice(0, emptyIndex);
  }

  if (!expected.length) {
    return '';
  }

  const excess = expected.map((v, i) => (v as number) - riskFree[i]);
  const numerador = average(excess);
  const denominador = Math.sqrt(average(excess.map(d => Math.pow(Math.min(d, 0), 2))));

  return denominador === 0 ? SENTINEL : numerador / denominador;
}

function client(scopes: string[]): sheets_v4.Sheets {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes,
  });
  return google.sheets({version: 'v4', auth});
}

async function readBlocks(
  api: sheets_v4.Sheets,
  header: Grid
): Promise<{sheetId: number; blocks: Block[]}> {
  const meta = await api.spreadsheets.get({
    spreadsheetId: DOC_ID,
    fields: 'sheets(properties(sheetId,title),merges)',
  });
  const tracker = meta.data.sheets?.find(s => s.properties?.title === TRACKER_NAME);
  if (!tracker) {
    throw new Error(`Aba ${TRACKER_NAME} nao encontrada`);
  }

  const [labels, periodRow] = header;

  const blocks = (tracker.merges ?? [])
    .filter(m => m.startRowIndex === 0)
    .sort((a, b) => a.startColumnIndex! - b.startColumnIndex!)
    .map(m => {
      const startColumn = m.startColumnIndex! + 1;
      const endColumn = m.endColumnIndex! - 1;
      const periods = [];
      for (let column = startColumn; column <= endColumn; column++) {
        periods.push(parseMonthCount(periodRow[column]));
      }
      return {
        label: String(labels[m.startColumnIndex!] ?? '').trim(),
        startColumn,
        endColumn,
        periods,
      };
    })
    .filter(
      block =>
        !!block.label &&
        block.periods.length > 0 &&
        block.periods.every(period => period !== undefined)
    );

  return {sheetId: tracker.properties!.sheetId!, blocks};
}

function benchmarkSeries(
  label: string,
  indices: Grid,
  rentMonths: (string | null)[]
): number[] {
  const header = indices[0].map(h => String(h ?? '').trim());
  const column = header.indexOf(label);
  if (column === -1) {
    throw new Error(
      `Aba ${BENCH_NAME} nao tem a coluna "${label}" (colunas: ${header.join(', ')})`
    );
  }

  const byMonth: {[month: string]: Cell} = {};
  for (let row = 1; row < indices.length; row++) {
    const key = monthKeyOf(indices[row][0]);
    if (key) {
      byMonth[key] = indices[row][column];
    }
  }

  return rentMonths.map((key, position) => {
    if (!key) {
      throw new Error(`${RENT_NAME} coluna ${position + 2} nao tem um mes valido no cabecalho`);
    }
    const value = byMonth[key];
    if (value === '' || value === null || value === undefined) {
      throw new Error(`${BENCH_NAME} nao tem ${label} para ${key}`);
    }
    return value as number;
  });
}

export async function runSortino(dryRun = false) {
  const api = client([
    dryRun
      ? 'https://www.googleapis.com/auth/spreadsheets.readonly'
      : 'https://www.googleapis.com/auth/spreadsheets',
  ]);

  const read = await api.spreadsheets.values.batchGet({
    spreadsheetId: DOC_ID,
    ranges: [`${TRACKER_NAME}!1:2`, `${TRACKER_NAME}!A${FIRST_DATA_ROW}:A`, RENT_NAME, BENCH_NAME],
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const [header, trackerColumnA, rent, indices] = read.data.valueRanges!.map(
    v => (v.values ?? []) as Grid
  );

  const {sheetId, blocks} = await readBlocks(api, header);
  const rentMonths = rent[0].slice(1, RENT_MONTH_COUNT + 1).map(monthKeyOf);

  const rentByCnpj: {[cnpj: string]: Cell[]} = {};
  for (let row = 1; row < rent.length; row++) {
    const cnpj = String(rent[row][0] ?? '');
    if (!cnpj) {
      continue;
    }
    const months = rent[row].slice(1, RENT_MONTH_COUNT + 1);
    while (months.length < RENT_MONTH_COUNT) {
      months.push('');
    }
    rentByCnpj[cnpj] = months;
  }

  const series: {[label: string]: number[]} = {};
  for (const block of blocks) {
    series[block.label] = benchmarkSeries(block.label, indices, rentMonths);
  }

  const trackerCnpjs = trackerColumnA.map(row => String(row[0] ?? ''));
  const requests: sheets_v4.Schema$Request[] = [];
  let written = 0;
  let cleared = 0;
  let missing = 0;

  for (const block of blocks) {
    const widestPeriod = Math.max(
      ...block.periods.filter((p): p is number => p !== undefined)
    );

    const values: (number | null)[][] = trackerCnpjs.map(cnpj => {
      const rents = CNPJ_PATTERN.test(cnpj) ? rentByCnpj[cnpj] : undefined;
      if (!rents) {
        return block.periods.map(() => null);
      }
      return block.periods.map(months => {
        if (months === undefined) {
          return null;
        }
        const value = calcSortino(
          rents.slice(0, months),
          series[block.label].slice(0, months),
          months === widestPeriod
        );
        return value === '' ? null : value;
      });
    });

    requests.push({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: FIRST_DATA_ROW - 1,
          endRowIndex: FIRST_DATA_ROW - 1 + values.length,
          startColumnIndex: block.startColumn,
          endColumnIndex: block.endColumn + 1,
        },
        fields: 'userEnteredValue',
        rows: values.map(row => ({
          values: row.map(v => ({
            userEnteredValue: v === null ? {} : {numberValue: v},
          })),
        })),
      },
    });
  }

  for (const cnpj of trackerCnpjs) {
    if (!CNPJ_PATTERN.test(cnpj)) {
      cleared++;
    } else if (!rentByCnpj[cnpj]) {
      missing++;
    } else {
      written++;
    }
  }

  const summary = {
    blocks: blocks.map(b => `${b.label} ${columnToA1(b.startColumn)}:${columnToA1(b.endColumn)}`),
    trackerRows: trackerCnpjs.length,
    funds: written,
    clearedRows: cleared,
    cnpjsWithoutHistory: missing,
    dryRun,
  };

  if (dryRun) {
    return {summary, requests};
  }

  await api.spreadsheets.batchUpdate({
    spreadsheetId: DOC_ID,
    requestBody: {requests},
  });

  return {summary, requests};
}
