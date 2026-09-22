import * as fs from 'fs';
import {google} from 'googleapis';
import {
  writeKeyed,
  resolveColumnRuns,
  columnIndexOf,
  columnLetter,
} from '../src/fundos/sheet-writer';

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const TITLE = '__writer_test';
const HEADERS = ['CNPJ_FUNDO', 'NAME', 'NUM', 'FLAG'];

const cell = (v: any) => (v === undefined || v === null ? '' : v);

let failures = 0;
function check(label: any, actual: any, expected: any) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label}${
      ok
        ? ''
        : `  expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`
    }`,
  );
}

function api() {
  const key = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({version: 'v4', auth});
}

async function readGrid(sheets: any) {
  const [vals, meta] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: DOC_ID,
      range: `'${TITLE}'!A1:D50`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
    sheets.spreadsheets.get({
      spreadsheetId: DOC_ID,
      fields: 'sheets(properties(title,sheetId,gridProperties))',
    }),
  ]);
  const props = meta.data.sheets.find(
    (s: any) => s.properties!.title === TITLE,
  ).properties;
  return {rows: vals.data.values || [], props};
}

async function withScratch(sheets: any, title: any, columnCount: any, fn: any) {
  const before = await sheets.spreadsheets.get({
    spreadsheetId: DOC_ID,
    fields: 'sheets(properties(title,sheetId))',
  });
  const stale = before.data.sheets!.find(
    (s: any) => s.properties!.title === title,
  );
  if (stale) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: DOC_ID,
      requestBody: {
        requests: [{deleteSheet: {sheetId: stale.properties!.sheetId}}],
      },
    });
  }
  const created = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: DOC_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {title, gridProperties: {rowCount: 20, columnCount}},
          },
        },
      ],
    },
  });
  const sheetId = created.data.replies![0].addSheet!.properties!.sheetId;
  try {
    await fn(sheetId);
  } finally {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: DOC_ID,
      requestBody: {requests: [{deleteSheet: {sheetId}}]},
    });
    console.log(`cleaned up scratch sheet ${title}`);
  }
}

async function read(sheets: any, title: any, range: any, render?: any) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: DOC_ID,
    range: `'${title}'!${range}`,
    valueRenderOption: render || 'UNFORMATTED_VALUE',
  });
  return r.data.values || [];
}

// Principal's shape: the writer owns A, B, E, G while C and F are live formulas and D is a human
// annotation. A contiguous write from A would destroy all three.
async function columnMapTests(sheets: any) {
  const TITLE = '__writer_test_map';
  const HEADERS = ['CNPJ', 'NAME', 'VOL', 'FLAG'];
  const COLUMNS = {CNPJ: 'A', NAME: 'B', VOL: 'E', FLAG: 'G'};

  console.log(
    '\nrun 4 — interleaved columns, formulas and human cells in the gaps',
  );
  await withScratch(sheets, TITLE, 8, async () => {
    let s = await writeKeyed(
      TITLE,
      HEADERS,
      [
        {CNPJ: 'k1', NAME: 'one', VOL: 0.01, FLAG: true},
        {CNPJ: 'k2', NAME: 'two', VOL: 0.42, FLAG: false},
        {CNPJ: 'k3', NAME: 'three', VOL: 0.03, FLAG: true},
      ],
      {columns: COLUMNS},
    );
    check('column runs are A:B, E, G', s.columnRuns, ['A:B', 'E:E', 'G:G']);
    check('appended 3', s.appended, 3);

    // The gaps get their real content only now, exactly as Principal has it.
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: DOC_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          {range: `'${TITLE}'!C1:D1`, values: [['VOLPCT', 'HUMAN']]},
          {range: `'${TITLE}'!F1`, values: [['LEN']]},
          {
            range: `'${TITLE}'!C2:D4`,
            values: [
              ['=E2*100', 'mine-1'],
              ['=E3*100', 'mine-2'],
              ['=E4*100', 'mine-3'],
            ],
          },
          {
            range: `'${TITLE}'!F2:F4`,
            values: [['=LEN(B2)'], ['=LEN(B3)'], ['=LEN(B4)']],
          },
        ],
      },
    });

    let grid = await read(sheets, TITLE, 'A1:G4');
    check('header row spans the gaps', grid[0], [
      'CNPJ',
      'NAME',
      'VOLPCT',
      'HUMAN',
      'VOL',
      'LEN',
      'FLAG',
    ]);
    check('k1 full row', grid[1], ['k1', 'one', 1, 'mine-1', 0.01, 3, true]);
    check('k2 derived column saw the written VOL', grid[2][2], 42);

    console.log('run 5 — a second write must not disturb the gaps');
    s = await writeKeyed(
      TITLE,
      HEADERS,
      [
        {CNPJ: 'k1', NAME: 'ONE-v2', VOL: 0.9, FLAG: false},
        {CNPJ: 'k3', NAME: 'three', VOL: 0.03, FLAG: true},
        {CNPJ: 'k4', NAME: 'four', VOL: 0.04, FLAG: true},
      ],
      {columns: COLUMNS},
    );
    check('matched 2', s.matched, 2);
    check('appended 1 (k4)', s.appended, 1);
    check('blanked 1 (k2)', s.blanked, 1);

    const formulas = await read(sheets, TITLE, 'C2:C4', 'FORMULA');
    check(
      'VOLPCT still a formula on every row',
      formulas.map((r: any) => String(r[0]).startsWith('=')),
      [true, true, true],
    );
    const lens = await read(sheets, TITLE, 'F2:F4', 'FORMULA');
    check(
      'LEN still a formula on every row',
      lens.map((r: any) => String(r[0]).startsWith('=')),
      [true, true, true],
    );

    grid = await read(sheets, TITLE, 'A1:G5');
    check(
      'human column untouched by the update',
      [grid[1][3], grid[2][3], grid[3][3]],
      ['mine-1', 'mine-2', 'mine-3'],
    );
    check(
      'k1 writer columns updated',
      [grid[1][1], grid[1][4], grid[1][6]],
      ['ONE-v2', 0.9, false],
    );
    check('k1 VOLPCT recomputed from the new VOL', grid[1][2], 90);
    check(
      'k2 writer columns blanked, key kept',
      [grid[2][0], cell(grid[2][1]), cell(grid[2][4]), cell(grid[2][6])],
      ['k2', '', '', ''],
    );
    check('k2 HUMAN survived the blanking', grid[2][3], 'mine-2');
    check(
      'k4 appended into the mapped columns',
      [grid[4][0], cell(grid[4][1]), cell(grid[4][4]), cell(grid[4][6])],
      ['k4', 'four', 0.04, true],
    );
  });

  console.log('\nrun 6 — key column away from A');
  await withScratch(sheets, '__writer_test_offset', 6, async () => {
    const s = await writeKeyed(
      '__writer_test_offset',
      ['CNPJ', 'NAME'],
      [
        {CNPJ: 'x1', NAME: 'first'},
        {CNPJ: 'x2', NAME: 'second'},
      ],
      {columns: {CNPJ: 'C', NAME: 'A'}},
    );
    check('runs sorted by column, not by header order', s.columnRuns, [
      'A:A',
      'C:C',
    ]);
    const grid = await read(sheets, '__writer_test_offset', 'A1:C3');
    check('NAME in A, CNPJ in C', [grid[1][0], grid[1][2]], ['first', 'x1']);

    const again = await writeKeyed(
      '__writer_test_offset',
      ['CNPJ', 'NAME'],
      [{CNPJ: 'x2', NAME: 'SECOND-v2'}],
      {columns: {CNPJ: 'C', NAME: 'A'}},
    );
    check('matched by the key read from C', again.matched, 1);
    check('blanked the missing key', again.blanked, 1);
    const after = await read(sheets, '__writer_test_offset', 'A1:C3');
    check(
      'x2 updated in place',
      [after[2][0], after[2][2]],
      ['SECOND-v2', 'x2'],
    );
    check(
      'x1 value blanked, key kept',
      [cell(after[1][0]), after[1][2]],
      ['', 'x1'],
    );
  });

  console.log('\nrun 7 — a bad map is rejected before any request');
  try {
    resolveColumnRuns(['A_H', 'B_H'], {A_H: 'A'});
    check('unmapped header throws', 'no throw', 'throws');
  } catch (e: any) {
    check('unmapped header throws', /nao mapeada/.test(e.message), true);
  }
  try {
    resolveColumnRuns(['A_H', 'B_H'], {A_H: 'C', B_H: 'C'});
    check('duplicate column throws', 'no throw', 'throws');
  } catch (e: any) {
    check('duplicate column throws', /mesma coluna/.test(e.message), true);
  }
  check(
    'columnIndexOf round-trips',
    [columnIndexOf('A'), columnIndexOf('Z'), columnIndexOf('AD')],
    [0, 25, 29],
  );
  check(
    'columnLetter round-trips',
    [columnLetter(0), columnLetter(25), columnLetter(29)],
    ['A', 'Z', 'AD'],
  );
}

async function main() {
  const sheets = api();

  const before = await sheets.spreadsheets.get({
    spreadsheetId: DOC_ID,
    fields: 'sheets(properties(title,sheetId))',
  });
  const stale = before.data.sheets!.find(s => s.properties!.title === TITLE);
  if (stale) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: DOC_ID,
      requestBody: {
        requests: [{deleteSheet: {sheetId: stale.properties!.sheetId}}],
      },
    });
  }

  const created = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: DOC_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: TITLE,
              gridProperties: {rowCount: 20, columnCount: 8},
            },
          },
        },
      ],
    },
  });
  const sheetId = created.data.replies![0].addSheet!.properties!.sheetId;

  try {
    console.log('run 1 — seed 4 rows');
    let s = await writeKeyed(TITLE, HEADERS, [
      {CNPJ_FUNDO: 'k1', NAME: 'one', NUM: 1.5, FLAG: true},
      {CNPJ_FUNDO: 'k2', NAME: 'two', NUM: 2, FLAG: false},
      {CNPJ_FUNDO: 'k3', NAME: 'three', NUM: '', FLAG: true},
      {CNPJ_FUNDO: 'k4', NAME: 'four', NUM: 4, FLAG: false},
    ]);
    check('appended 4', s.appended, 4);
    check('matched 0', s.matched, 0);
    check('rowCount not shrunk', s.rowCountAfter >= 20, true);

    let g = await readGrid(sheets);
    check('header', g.rows[0], HEADERS);
    check('k1 row', g.rows[1], ['k1', 'one', 1.5, true]);

    // The values API reports a truly-empty cell and an empty string identically,
    // so ask the sheet itself. An empty string here would make COUNTIF("<>"&"")
    // count the cell as populated -- the exact bug that hit Merge!K.
    await sheets.spreadsheets.values.update({
      spreadsheetId: DOC_ID,
      range: `'${TITLE}'!F1:F2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {values: [['=ISBLANK(C4)'], ['=COUNTIF(C4;"<>"&"")']]},
    });
    const probe = await sheets.spreadsheets.values.get({
      spreadsheetId: DOC_ID,
      range: `'${TITLE}'!F1:F2`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    check('k3 empty NUM is ISBLANK', probe.data.values![0][0], true);
    check('k3 empty NUM not counted as populated', probe.data.values![1][0], 0);

    console.log('run 2 — update 2, drop k2, add k5');
    s = await writeKeyed(TITLE, HEADERS, [
      {CNPJ_FUNDO: 'k1', NAME: 'ONE-v2', NUM: 9.25, FLAG: false},
      {CNPJ_FUNDO: 'k3', NAME: 'THREE-v2', NUM: 3, FLAG: true},
      {CNPJ_FUNDO: 'k4', NAME: 'four', NUM: 4, FLAG: false},
      {CNPJ_FUNDO: 'k5', NAME: 'five', NUM: 5, FLAG: true},
    ]);
    check('matched 3', s.matched, 3);
    check('appended 1', s.appended, 1);
    check('appendedKeys', s.appendedKeys, ['k5']);
    check('blanked 1 (k2)', s.blanked, 1);

    g = await readGrid(sheets);
    check('k1 updated in place', g.rows[1], ['k1', 'ONE-v2', 9.25, false]);
    check('k2 key kept, values blanked', g.rows[2], ['k2']);
    check('k3 still at row 4', g.rows[3][0], 'k3');
    check('k5 appended at row 6', g.rows[5], ['k5', 'five', 5, true]);
    check(
      'row order preserved',
      g.rows.slice(1).map((r: any) => r[0]),
      ['k1', 'k2', 'k3', 'k4', 'k5'],
    );

    console.log('run 3 — growth past the grid');
    const many = [];
    for (let i = 1; i <= 30; i++)
      many.push({CNPJ_FUNDO: 'g' + i, NAME: 'g' + i, NUM: i, FLAG: true});
    s = await writeKeyed(TITLE, HEADERS, many);
    check('grid grew', s.rowCountAfter > s.rowCountBefore, true);
    check('appended 30', s.appended, 30);
    check('blanked the 5 earlier keys', s.blanked, 5);

    g = await readGrid(sheets);
    check('k1 blanked but key kept', g.rows[1], ['k1']);
    check(
      'gridProperties never shrank',
      g.props.gridProperties.rowCount >= 36,
      true,
    );
    check(
      'columnCount never shrank',
      g.props.gridProperties.columnCount >= 8,
      true,
    );
  } finally {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: DOC_ID,
      requestBody: {requests: [{deleteSheet: {sheetId}}]},
    });
    console.log(`\ncleaned up scratch sheet ${TITLE}`);
  }

  await columnMapTests(sheets);

  console.log(
    failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
