import {sheets_v4, google} from 'googleapis';
import * as fs from 'fs';

const CREDENTIALS_PATH = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';

const HEADER_ROW_COUNT = 1;
const MAX_CELLS_PER_REQUEST = 20000;

export type CellValue = string | number | boolean | undefined | null;

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
  const perChunk = Math.max(1, Math.floor(MAX_CELLS_PER_REQUEST / Math.max(1, columns)));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += perChunk) {
    chunks.push(rows.slice(i, i + perChunk));
  }
  return chunks;
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
 */
export async function writeKeyed(
  sheetTitle: string,
  headers: string[],
  rows: {[header: string]: CellValue}[]
): Promise<KeyedWriteSummary> {
  if (!headers.length) {
    throw new Error('writeKeyed needs at least one header');
  }
  const keyHeader = headers[0];

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
    range: `'${sheetTitle}'!A1:A`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const keyColumn = (existing.data.values ?? []).map(r => String(r[0] ?? ''));

  const rowByKey = new Map<string, number>();
  let lastPopulatedRow = HEADER_ROW_COUNT - 1;
  for (let i = HEADER_ROW_COUNT; i < keyColumn.length; i++) {
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
  const placements: {rowIndex: number; values: CellValue[]}[] = [];
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
    placements.push({rowIndex, values: headers.map(h => row[h])});
  }

  const blanks: number[] = [];
  for (const [key, rowIndex] of rowByKey) {
    if (!seen.has(key)) {
      blanks.push(rowIndex);
    }
  }

  const rowCountAfter = Math.max(rowCountBefore, nextAppendRow);
  const columnCountAfter = Math.max(columnCountBefore, headers.length);

  const requests: sheets_v4.Schema$Request[] = [];

  if (rowCountAfter > rowCountBefore || columnCountAfter > columnCountBefore) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {rowCount: rowCountAfter, columnCount: columnCountAfter},
        },
        fields: 'gridProperties.rowCount,gridProperties.columnCount',
      },
    });
  }

  requests.push({
    updateCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: headers.length,
      },
      fields: 'userEnteredValue',
      rows: [{values: headers.map(h => ({userEnteredValue: {stringValue: h}}))}],
    },
  });

  placements.sort((a, b) => a.rowIndex - b.rowIndex);

  // Contiguous runs become one request each; chunked so no request is oversized.
  const runs: {start: number; rows: CellValue[][]}[] = [];
  for (const placement of placements) {
    const last = runs[runs.length - 1];
    if (last && last.start + last.rows.length === placement.rowIndex) {
      last.rows.push(placement.values);
    } else {
      runs.push({start: placement.rowIndex, rows: [placement.values]});
    }
  }

  for (const run of runs) {
    let offset = 0;
    for (const chunk of chunkRows(run.rows, headers.length)) {
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: run.start + offset,
            endRowIndex: run.start + offset + chunk.length,
            startColumnIndex: 0,
            endColumnIndex: headers.length,
          },
          fields: 'userEnteredValue',
          rows: chunk.map(values => ({
            values: values.map(v => ({userEnteredValue: encode(v)})),
          })),
        },
      });
      offset += chunk.length;
    }
  }

  // A vanished key keeps its identity; only its value columns are emptied.
  for (const rowIndex of blanks) {
    requests.push({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: rowIndex,
          endRowIndex: rowIndex + 1,
          startColumnIndex: 1,
          endColumnIndex: headers.length,
        },
        fields: 'userEnteredValue',
        rows: [{values: headers.slice(1).map(() => ({userEnteredValue: {}}))}],
      },
    });
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
  };
}
