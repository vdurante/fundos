const SHEET_NAME = 'Principal';
const HEADER_ROW = 2;
const FIRST_DATA_ROW = 3;
const DP_VALUES = ['0', '1', '2', '3', '4', '5'];

function sheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error(`Aba ${SHEET_NAME} nao encontrada`);
  }

  return sheet;
}

function header_() {
  const sheet = sheet_();

  return sheet
    .getRange(HEADER_ROW, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(value => (value === null || value === undefined ? '' : String(value).trim()));
}

function get_column(name, occurrence) {
  const wanted = occurrence === undefined ? 1 : occurrence;
  const header = header_();
  let seen = 0;

  for (let i = 0; i < header.length; i++) {
    if (header[i] === name) {
      seen++;
      if (seen === wanted) {
        return i + 1;
      }
    }
  }

  throw new Error(
    `Coluna "${name}" (ocorrencia ${wanted}) nao encontrada em ${SHEET_NAME}!${HEADER_ROW}:${HEADER_ROW} ` +
      `(colunas: ${header.join(', ')})`
  );
}

function getFilter() {
  const filter = sheet_().getFilter();

  if (!filter) {
    throw new Error(`Aba ${SHEET_NAME} nao tem filtro; crie um filtro basico antes de filtrar`);
  }

  return filter;
}

/********************

  ACTIONS

*********************/

function filters_clear() {
  filter_remove(get_column('Risco'));
  filter_remove(get_column('Tipo'));
  filter_remove(get_column('DP'));
}

function filter_risco_00_05() {
  filter_risco('00 ~ 05');
  filter_tipo('');
  filter_dp([4, 5]);
  sort_nota();
}

function filter_risco_05_10() {
  filter_risco('05 ~ 10');
  filter_tipo('');
  filter_dp([4, 5]);
  sort_nota();
}

function filter_risco_10_25() {
  filter_risco('10 ~ 25');
  filter_tipo('');
  filter_dp([4, 5]);
  sort_nota();
}

function filter_risco_25_100() {
  filter_risco('25~100');
  filter_tipo('');
  filter_dp([4, 5]);
  sort_nota();
}

function filter_tipo_IE() {
  filter_risco();
  filter_tipo('IE');
  filter_dp([4, 5]);
  sort_nota();
}

function filter_dp_4_5() {
  filter_risco();
  filter_tipo();
  filter_dp([4, 5]);
  sort_nota();
}

function sort_nota() {
  sort_column(get_column('Nota'), false);
}

function sort_nota_ibov() {
  sort_column(get_column('Nota', 2), false);
}

function sort_nota_bond() {
  sort_column(get_column('Nota', 3), false);
}

/********************

  FILTERS

*********************/

function filter_risco(risco) {
  const column = get_column('Risco');

  if (!risco) {
    filter_remove(column);
    return;
  }

  filter_set(column, SpreadsheetApp.newFilterCriteria().whenTextEqualTo(risco));
}

function filter_tipo(tipo) {
  const column = get_column('Tipo');

  if (tipo === null || tipo === undefined) {
    filter_remove(column);
    return;
  }

  if (tipo === '') {
    filter_set(column, SpreadsheetApp.newFilterCriteria().whenCellEmpty());
    return;
  }

  filter_set(column, SpreadsheetApp.newFilterCriteria().whenTextEqualTo(tipo));
}

function filter_dp(dps) {
  const keep = (dps || []).map(String);
  const hidden = DP_VALUES.filter(value => keep.indexOf(value) === -1);

  hidden.push('');

  filter_set(get_column('DP'), SpreadsheetApp.newFilterCriteria().setHiddenValues(hidden));
}

function filter_set(column, criteria) {
  getFilter().setColumnFilterCriteria(column, criteria);
}

function filter_remove(column) {
  getFilter().removeColumnFilterCriteria(column);
}

/********************

  SORTERS

*********************/

function sort_column(column, ascending) {
  const sheet = sheet_();
  const rows = sheet.getLastRow() - FIRST_DATA_ROW + 1;

  if (rows < 1) {
    return;
  }

  sheet
    .getRange(FIRST_DATA_ROW, 1, rows, sheet.getLastColumn())
    .sort({column: column, ascending: !!ascending});
}
