import {sheets_v4, google} from 'googleapis';
import * as fs from 'fs';

const CREDENTIALS_PATH = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';

const HEADER_ROW_COUNT = 1;
const MAX_CELLS_PER_REQUEST = 20000;

export type CellValue = string | number | boolean | undefined | null;

export type ColumnMap = {[header: string]: string};

export interface KeyedWriteOptions {
  columns?: ColumnMap;
  headerRowCount?: number;
}

export interface KeyedWriteSummary {
  sheet: string;
  matched: number;
  appended: number;
  blanked: number;
  rowCountBefore: number;
  rowCountAfter: number;
  columnCountBefore: number;
  columnCountAfter: number;
  appendedKeys: string[];
  columnRuns: string[];
}

function client(): sheets_v4.Sheets {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({version: 'v4', auth});
}

function encode(value: CellValue): sheets_v4.Schema$ExtendedValue {
  if (value === undefined || value === null || value === '') {
    return {};
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? {numberValue: value} : {};
  }
  if (typeof value === 'boolean') {
    return {boolValue: value};
  }
  return {stringValue: String(value)};
}

function chunkRows<T>(rows: T[], columns: number): T[][] {
  const perChunk = Math.max(
    1,
    Math.floor(MAX_CELLS_PER_REQUEST / Math.max(1, columns))
  );
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += perChunk) {
    chunks.push(rows.slice(i, i + perChunk));
  }
  return chunks;
}

export function columnLetter(index: number): string {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export function columnIndexOf(letter: string): number {
  const text = letter.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(text)) {
    throw new Error(`Coluna invalida: ${letter}`);
  }
  let index = 0;
  for (const character of text) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index - 1;
}

export interface ColumnRun {
  startColumnIndex: number;
  headers: string[];
}

export function resolveColumnRuns(
  headers: string[],
  columns?: ColumnMap
): ColumnRun[] {
  if (!columns) {
    return [{startColumnIndex: 0, headers: [...headers]}];
  }

  const placed = headers.map(header => {
    const letter = columns[header];
    if (letter === undefined) {
      throw new Error(`writeKeyed: coluna nao mapeada para "${header}"`);
    }
    return {header, index: columnIndexOf(letter)};
  });

  const byIndex = new Map<number, string>();
  for (const {header, index} of placed) {
    const clash = byIndex.get(index);
    if (clash !== undefined) {
      throw new Error(
        `writeKeyed: "${header}" e "${clash}" mapeiam para a mesma coluna ${columnLetter(
          index
        )}`
      );
    }
    byIndex.set(index, header);
  }

  placed.sort((a, b) => a.index - b.index);

  const runs: ColumnRun[] = [];
  for (const {header, index} of placed) {
    const last = runs[runs.length - 1];
    if (last && last.startColumnIndex + last.headers.length === index) {
      last.headers.push(header);
    } else {
      runs.push({startColumnIndex: index, headers: [header]});
    }
  }
  return runs;
}

export async function blankColumnsBeyond(
  sheetTitle: string,
  keepColumns: number
): Promise<{cleared: number; columnCount: number}> {
  const api = client();

  const meta = await api.spreadsheets.get({
    spreadsheetId: DOC_ID,
    fields: 'sheets(properties(sheetId,title,gridProperties))',
  });
  const sheet = meta.data.sheets?.find(s => s.properties?.title === sheetTitle);
  if (!sheet) {
    throw new Error(`Aba ${sheetTitle} nao encontrada`);
  }
  const sheetId = sheet.properties!.sheetId!;
  const columnCount = sheet.properties!.gridProperties!.columnCount!;

  if (columnCount <= keepColumns) {
    return {cleared: 0, columnCount};
  }

  await api.spreadsheets.batchUpdate({
    spreadsheetId: DOC_ID,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: {
              sheetId,
              startColumnIndex: keepColumns,
              endColumnIndex: columnCount,
            },
            fields: 'userEnteredValue',
          },
        },
      ],
    },
  });

  return {cleared: columnCount - keepColumns, columnCount};
}

/**
 * Writes rows into a sheet WITHOUT clearing or shrinking it.
 *
 * - matches existing rows by the key column's value
 * - appends unseen keys below the last populated row, in the order supplied
 * - blanks the value columns of a row whose key vanished, keeping the key
 * - grows rowCount/columnCount when needed, never lowers either
 *
 * Row order is preserved, so positional references from other sheets stay valid.
 *
 * Without `columns` the headers occupy A, B, C... contiguously, which is only safe on a sheet the
 * writer owns end to end. Pass `columns` ({header: 'A1 letter'}) for a sheet whose columns are
 * shared with humans or with formulas: only the mapped columns are touched, one request per
 * contiguous run, and the key column is read from wherever it is mapped rather than assumed to be A.
 */
export async function writeKeyed(
  sheetTitle: string,
  headers: string[],
  rows: {[header: string]: CellValue}[],
  options: KeyedWriteOptions = {}
): Promise<KeyedWriteSummary> {
  if (!headers.length) {
    throw new Error('writeKeyed needs at least one header');
  }
  const {columns} = options;
  const headerRowCount = options.headerRowCount ?? HEADER_ROW_COUNT;
  if (!Number.isInteger(headerRowCount) || headerRowCount < 1) {
    throw new Error(
      `writeKeyed: headerRowCount invalido: ${options.headerRowCount}`
    );
  }
  const keyHeader = headers[0];
  const columnRuns = resolveColumnRuns(headers, columns);
  const keyColumnIndex = columns ? columnIndexOf(columns[keyHeader]) : 0;
  const keyColumnLetter = columnLetter(keyColumnIndex);
  const lastColumnIndex = Math.max(
    ...columnRuns.map(run => run.startColumnIndex + run.headers.length - 1)
  );

  const api = client();

  const meta = await api.spreadsheets.get({
    spreadsheetId: DOC_ID,
    fields: 'sheets(properties(sheetId,title,gridProperties))',
  });
  const sheet = meta.data.sheets?.find(s => s.properties?.title === sheetTitle);
  if (!sheet) {
    throw new Error(`Aba ${sheetTitle} nao encontrada`);
  }
  const sheetId = sheet.properties!.sheetId!;
  const rowCountBefore = sheet.properties!.gridProperties!.rowCount!;
  const columnCountBefore = sheet.properties!.gridProperties!.columnCount!;

  const existing = await api.spreadsheets.values.get({
    spreadsheetId: DOC_ID,
    range: `'${sheetTitle}'!${keyColumnLetter}1:${keyColumnLetter}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const keyColumn = (existing.data.values ?? []).map(r => String(r[0] ?? ''));

  const rowByKey = new Map<string, number>();
  let lastPopulatedRow = headerRowCount - 1;
  for (let i = headerRowCount; i < keyColumn.length; i++) {
    const key = keyColumn[i];
    if (!key) {
      continue;
    }
    if (!rowByKey.has(key)) {
      rowByKey.set(key, i);
    }
    lastPopulatedRow = i;
  }

  const seen = new Set<string>();
  const placements: {rowIndex: number; row: {[header: string]: CellValue}}[] =
    [];
  const appendedKeys: string[] = [];
  let nextAppendRow = lastPopulatedRow + 1;

  for (const row of rows) {
    const key = String(row[keyHeader] ?? '');
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);

    const existingRow = rowByKey.get(key);
    const rowIndex = existingRow === undefined ? nextAppendRow++ : existingRow;
    if (existingRow === undefined) {
      appendedKeys.push(key);
    }
    placements.push({rowIndex, row});
  }

  const blanks: number[] = [];
  for (const [key, rowIndex] of rowByKey) {
    if (!seen.has(key)) {
      blanks.push(rowIndex);
    }
  }

  const rowCountAfter = Math.max(rowCountBefore, nextAppendRow);
  const columnCountAfter = Math.max(columnCountBefore, lastColumnIndex + 1);

  const requests: sheets_v4.Schema$Request[] = [];

  if (rowCountAfter > rowCountBefore || columnCountAfter > columnCountBefore) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            rowCount: rowCountAfter,
            columnCount: columnCountAfter,
          },
        },
        fields: 'gridProperties.rowCount,gridProperties.columnCount',
      },
    });
  }

  for (const run of columnRuns) {
    requests.push({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: headerRowCount - 1,
          endRowIndex: headerRowCount,
          startColumnIndex: run.startColumnIndex,
          endColumnIndex: run.startColumnIndex + run.headers.length,
        },
        fields: 'userEnteredValue',
        rows: [
          {
            values: run.headers.map(h => ({
              userEnteredValue: {stringValue: h},
            })),
          },
        ],
      },
    });
  }

  placements.sort((a, b) => a.rowIndex - b.rowIndex);

  // Contiguous runs become one request each; chunked so no request is oversized.
  const rowRuns: {start: number; rows: {[header: string]: CellValue}[]}[] = [];
  for (const placement of placements) {
    const last = rowRuns[rowRuns.length - 1];
    if (last && last.start + last.rows.length === placement.rowIndex) {
      last.rows.push(placement.row);
    } else {
      rowRuns.push({start: placement.rowIndex, rows: [placement.row]});
    }
  }

  for (const columnRun of columnRuns) {
    for (const rowRun of rowRuns) {
      let offset = 0;
      for (const chunk of chunkRows(rowRun.rows, columnRun.headers.length)) {
        requests.push({
          updateCells: {
            range: {
              sheetId,
              startRowIndex: rowRun.start + offset,
              endRowIndex: rowRun.start + offset + chunk.length,
              startColumnIndex: columnRun.startColumnIndex,
              endColumnIndex:
                columnRun.startColumnIndex + columnRun.headers.length,
            },
            fields: 'userEnteredValue',
            rows: chunk.map(row => ({
              values: columnRun.headers.map(h => ({
                userEnteredValue: encode(row[h]),
              })),
            })),
          },
        });
        offset += chunk.length;
      }
    }
  }

  // A vanished key keeps its identity; only its value columns are emptied.
  for (const rowIndex of blanks) {
    for (const run of columnRuns) {
      const valueHeaders = run.headers.filter(h => h !== keyHeader);
      if (!valueHeaders.length) {
        continue;
      }
      const startColumnIndex =
        run.headers[0] === keyHeader
          ? run.startColumnIndex + 1
          : run.startColumnIndex;
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: rowIndex,
            endRowIndex: rowIndex + 1,
            startColumnIndex,
            endColumnIndex: startColumnIndex + valueHeaders.length,
          },
          fields: 'userEnteredValue',
          rows: [{values: valueHeaders.map(() => ({userEnteredValue: {}}))}],
        },
      });
    }
  }

  const BATCH = 100;
  for (let i = 0; i < requests.length; i += BATCH) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: DOC_ID,
      requestBody: {requests: requests.slice(i, i + BATCH)},
    });
  }

  return {
    sheet: sheetTitle,
    matched: placements.length - appendedKeys.length,
    appended: appendedKeys.length,
    blanked: blanks.length,
    rowCountBefore,
    rowCountAfter,
    columnCountBefore,
    columnCountAfter,
    appendedKeys,
    columnRuns: columnRuns.map(
      run =>
        `${columnLetter(run.startColumnIndex)}:${columnLetter(
          run.startColumnIndex + run.headers.length - 1
        )}`
    ),
  };
}
