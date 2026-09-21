const spreadSheet = SpreadsheetApp.getActiveSpreadsheet();
const principal = spreadSheet.getSheetByName("Principal");
const principalFilter = principal.getFilter();

const COLUMN_RISCO = get_column("Risco");
const COLUMN_TIPO = get_column("Tipo");
const COLUMN_DP = get_column("DP");
const COLUMN_NOTA = get_column("Nota");

// ACTIONS
function filters_clear(){
  filter_remove(COLUMN_RISCO);
  filter_remove(COLUMN_TIPO);
  filter_remove(COLUMN_DP);
}

function filter_risco_00_05(){
  filter_risco('00 ~ 05');
  filter_tipo('');
  filter_dp([4, 5]);
  sort_nota();
}

function filter_risco_05_10(){
  filter_risco('05 ~ 10');
  filter_tipo('');
  filter_dp([4, 5]);
  sort_nota();
}

function filter_risco_10_25(){  
  filter_risco('10 ~ 25');
  filter_tipo('');
  filter_dp([4, 5]);
  sort_nota();
}

function filter_risco_25_100(){  
  filter_risco('25~100');
  filter_tipo('');
  filter_dp([4, 5]);
  sort_nota();
}

function filter_tipo_IE(){
  filter_risco();
  filter_tipo('IE');
  filter_dp([4, 5]);
  sort_nota();
}

function filter_dp_4_5(){
  filter_risco();
  filter_tipo();
  filter_dp([4, 5]);
  sort_nota();
}

function sort_nota(){
  sort_column(COLUMN_NOTA, false);
}

/********************

  HELPERS

*********************/

function get_column(name){
  var columnValues = principal.getRange(2, 1, 1, 20).getValues(); //1st is header row
  var searchResult = columnValues[0].indexOf(name)+1;
  return searchResult;
}

// FILTERS
function filter_risco(risco){
  if(!risco){
    filter_remove(COLUMN_RISCO);
  } else {
    filter_set(COLUMN_RISCO, SpreadsheetApp.newFilterCriteria().whenTextEqualTo(risco));
  }
}

function filter_tipo(tipo){
  if(tipo === null || tipo === undefined){
    filter_remove(COLUMN_TIPO);
  } else if (tipo == '') {
    filter_set(COLUMN_TIPO, SpreadsheetApp.newFilterCriteria().whenCellEmpty());
  } else {
    filter_set(COLUMN_TIPO, SpreadsheetApp.newFilterCriteria().whenTextEqualTo(tipo));
  }
}

function filter_dp(dps){
  var except = ['', null, undefined, 1,2,3,4,5].filter(e => !dps.includes(e));
  filter_set(COLUMN_DP, SpreadsheetApp.newFilterCriteria().setHiddenValues(except));
}

function filter_set(col, criteria){
  const filter = getFilter();
  filter.setColumnFilterCriteria(col, criteria);  
}

function filter_remove(col){
  const filter = getFilter();
  filter.removeColumnFilterCriteria(col);  
}

// SORTERS
function sort_column(col, ascending){
  principal.getRange('A3:Z').sort({column: COLUMN_NOTA, ascending: false});
}


function getFilter(){
  return principalFilter;
}



