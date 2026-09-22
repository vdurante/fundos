const fs = require('fs');
const {google} = require('googleapis');
const {
  writePrincipal,
  selectFunds,
  principalRow,
  PRINCIPAL_COLUMNS,
  PRINCIPAL_HEADERS,
} = require('../build/src/fundos/principal');

const KEY = 'config/fundos-309615-2795009f4d3e.json';
const DOC_ID = '1Ev0j3XqQJYWCSDftuud7IFAWya7gIiQGvp2ULfjWCi0';
const TITLE = '__principal_test';

// Principal's real derived columns, copied verbatim so the fixture exercises the production
// formulas rather than a simplified stand-in.
const RISCO = r =>
  `=IF(J${r}="";"";IFS(J${r}<=0,05; "00 ~ 05"; J${r}<=0,1; "05 ~ 10"; J${r}<=0,25; "10 ~ 25"; J${r} <= 100; "25~100"))`;
const DP = r => `=COUNTIF(M${r}:Q${r}; "<>"&"")`;

const cell = v => (v === undefined || v === null ? '' : v);

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label}${
      ok
        ? ''
        : `  expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`
    }`
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

async function read(sheets, range, render) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: DOC_ID,
    range: `'${TITLE}'!${range}`,
    valueRenderOption: render || 'UNFORMATTED_VALUE',
  });
  return r.data.values || [];
}

const FIXTURES = [
  {
    cnpj: '11.111.111/0001-11',
    name: 'ALPHA FIC FIM',
    type: 'FI',
    volatility: 0.0123456789,
    availability: ['BTG', 'XP'],
    monthsOfHistory: 60,
  },
  {
    cnpj: '22.222.222/0001-22',
    name: 'ONZE | BETA PREV FIC RF',
    type: 'FI',
    volatility: 0.0549,
    availability: ['ONZE'],
    monthsOfHistory: 24,
  },
  {
    cnpj: '33.333.333/0001-33',
    name: 'GAMMA SEM VOL FIA',
    type: 'FI',
    availability: ['BTG'],
    monthsOfHistory: 12,
  },
  {
    cnpj: '44.444.444/0001-44',
    name: 'DELTA FIP',
    type: 'FIP',
    volatility: 0.4,
    availability: ['BTG'],
    monthsOfHistory: 90,
  },
  {
    cnpj: '55.555.555/0001-55',
    name: 'EPSILON FII',
    type: 'fii',
    volatility: 0.3,
    availability: ['XP'],
    monthsOfHistory: 90,
  },
  {
    cnpj: '66.666.666/0001-66',
    name: 'ZETA SEM HISTORICO',
    type: 'FI',
    volatility: 0.2,
    availability: ['XP'],
    monthsOfHistory: 0,
  },
  {
    cnpj: '11.111.111/0001-11',
    name: 'ALPHA DUPLICADO',
    type: 'FI',
    volatility: 0.9,
    availability: ['XP'],
    monthsOfHistory: 60,
  },
];

async function main() {
  const sheets = api();

  const before = await sheets.spreadsheets.get({
    spreadsheetId: DOC_ID,
    fields: 'sheets(properties(title,sheetId))',
  });
  const stale = before.data.sheets.find(s => s.properties.title === TITLE);
  if (stale) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: DOC_ID,
      requestBody: {
        requests: [{deleteSheet: {sheetId: stale.properties.sheetId}}],
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
              gridProperties: {rowCount: 20, columnCount: 30},
            },
          },
        },
      ],
    },
  });
  const sheetId = created.data.replies[0].addSheet.properties.sheetId;

  try {
    console.log('selection — pure, no API');
    const sel = selectFunds(FIXTURES);
    check('kept 3', sel.kept.length, 3);
    check(
      'excluded FIP and FII (case-insensitive)',
      sel.excludedByType.map(f => f.name),
      ['DELTA FIP', 'EPSILON FII']
    );
    check(
      'excluded no-history',
      sel.excludedNoHistory.map(f => f.name),
      ['ZETA SEM HISTORICO']
    );
    check('duplicate dropped, first wins', sel.duplicates, [
      '11.111.111/0001-11',
    ]);
    check('row projection', principalRow(FIXTURES[1]), {
      CNPJ: '22.222.222/0001-22',
      DENOM_SOCIAL: 'ONZE | BETA PREV FIC RF',
      BTG: false,
      XP: false,
      Vol: 0.0549,
      ONZE: true,
    });
    check('headers start with the key', PRINCIPAL_HEADERS[0], 'CNPJ');
    check('ONZE maps to AD', PRINCIPAL_COLUMNS.ONZE, 'AD');

    console.log('\nrun 1 — seed the block label row, then write');
    // Row 1 is Principal's merged block-label row. It must survive untouched.
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: DOC_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          {range: `'${TITLE}'!I1`, values: [['SORTINO >>>']]},
          {range: `'${TITLE}'!L1`, values: [['CDI']]},
          {
            range: `'${TITLE}'!C2:G2`,
            values: [['Risco', 'Tipo', 'Resgate', 'M', 'Buy']],
          },
          {range: `'${TITLE}'!K2`, values: [['DP']]},
        ],
      },
    });

    let result = await writePrincipal(FIXTURES, {sheetTitle: TITLE});
    check('wrote the kept funds', result.write.appended, 3);
    check('column runs', result.write.columnRuns, ['A:B', 'H:J', 'AD:AD']);
    check('selection counts', result.selection.kept, 3);

    // The derived columns only exist once there are data rows to attach them to.
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: DOC_ID,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          {
            range: `'${TITLE}'!C3:C5`,
            values: [[RISCO(3)], [RISCO(4)], [RISCO(5)]],
          },
          {range: `'${TITLE}'!K3:K5`, values: [[DP(3)], [DP(4)], [DP(5)]]},
          {
            range: `'${TITLE}'!D3:G5`,
            values: [
              ['IE', 'D+1', 'B', 'B'],
              ['VIP', 'D+30', '', 'B'],
              ['', 'D+0', 'B', ''],
            ],
          },
        ],
      },
    });

    let grid = await read(sheets, 'A1:AD5');
    check(
      'block label row untouched',
      [grid[0][8], grid[0][11]],
      ['SORTINO >>>', 'CDI']
    );
    check('headers landed in row 2, not row 1', cell(grid[0][0]), '');
    check('row 2 header set', grid[1].slice(0, 11), [
      'CNPJ',
      'DENOM_SOCIAL',
      'Risco',
      'Tipo',
      'Resgate',
      'M',
      'Buy',
      'BTG',
      'XP',
      'Vol',
      'DP',
    ]);
    check('ONZE header at AD2', grid[1][29], 'ONZE');
    check('data starts at row 3', grid[2][0], '11.111.111/0001-11');
    check(
      'alpha writer columns',
      [grid[2][1], grid[2][7], grid[2][8], grid[2][9], grid[2][29]],
      ['ALPHA FIC FIM', true, true, 0.0123456789, false]
    );
    check(
      'onze fund flags ONZE only',
      [grid[3][7], grid[3][8], grid[3][29]],
      [false, false, true]
    );
    check('missing volatility left blank', cell(grid[4][9]), '');

    console.log('\nunrounded volatility changes the Risco band');
    check('alpha 0.0123456789 -> 00 ~ 05', grid[2][2], '00 ~ 05');
    // ROUND(0.0549;2) = 0.05 would have banded this as "00 ~ 05". Writing it unrounded
    // is what puts it in the correct band -- the lossiness noted against writePrincipal.
    check('beta 0.0549 -> 05 ~ 10, not 00 ~ 05', grid[3][2], '05 ~ 10');
    check('no volatility -> blank Risco', cell(grid[4][2]), '');

    console.log('\nrun 2 — rewrite: human columns and formulas must survive');
    const changed = FIXTURES.filter(f => f.cnpj !== '22.222.222/0001-22').map(
      f =>
        f.cnpj === '11.111.111/0001-11' && f.name === 'ALPHA FIC FIM'
          ? Object.assign({}, f, {
              name: 'ALPHA v2',
              volatility: 0.26,
              availability: ['XP'],
            })
          : f
    );
    result = await writePrincipal(changed, {sheetTitle: TITLE});
    check('matched 2', result.write.matched, 2);
    check('blanked the vanished fund', result.write.blanked, 1);

    grid = await read(sheets, 'A1:AD5');
    check(
      'alpha updated in place',
      [grid[2][1], grid[2][7], grid[2][8], grid[2][9]],
      ['ALPHA v2', false, true, 0.26]
    );
    check('alpha Risco recomputed to 25~100', grid[2][2], '25~100');
    check(
      'human columns untouched',
      [grid[2].slice(3, 7), grid[3].slice(3, 7), grid[4].slice(3, 7)],
      [
        ['IE', 'D+1', 'B', 'B'],
        ['VIP', 'D+30', '', 'B'],
        ['', 'D+0', 'B', ''],
      ]
    );
    check(
      'vanished fund keeps CNPJ, loses writer columns',
      [grid[3][0], cell(grid[3][1]), cell(grid[3][9]), cell(grid[3][29])],
      ['22.222.222/0001-22', '', '', '']
    );
    check('vanished fund keeps its human annotations', grid[3].slice(3, 7), [
      'VIP',
      'D+30',
      '',
      'B',
    ]);

    const formulas = await read(sheets, 'C3:C5', 'FORMULA');
    check(
      'Risco still a formula on every row',
      formulas.map(r => String(r[0]).startsWith('=')),
      [true, true, true]
    );
    const dp = await read(sheets, 'K3:K5', 'FORMULA');
    check(
      'DP still a formula on every row',
      dp.map(r => String(r[0]).startsWith('=')),
      [true, true, true]
    );

    console.log('\ndry run writes nothing');
    const dry = await writePrincipal(FIXTURES, {
      sheetTitle: TITLE,
      dryRun: true,
    });
    check('dry run reports selection', dry.selection.kept, 3);
    check('dry run has no write', dry.write, undefined);
    const after = await read(sheets, 'A3:B3');
    check('sheet unchanged by the dry run', after[0], [
      '11.111.111/0001-11',
      'ALPHA v2',
    ]);
  } finally {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: DOC_ID,
      requestBody: {requests: [{deleteSheet: {sheetId}}]},
    });
    console.log(`\ncleaned up scratch sheet ${TITLE}`);
  }

  console.log(
    failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
