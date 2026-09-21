const TRACKER_NAME = 'Merge'
const RENT_NAME = 'Rentabilidade';
const INDEX_NAME = 'Indices';

let trackerSheet;
let rentSheet;
let indexSheet;

let rentabilidades;
let cnpjs;


function sortino() {
  init();
  
  for(let column = 1; column <= trackerSheet.getMaxColumns(); column++){
    let indexName = trackerSheet.getRange(1, column).getValue();
    
    if(indexName){
      let merged = trackerSheet.getRange(1, column).getMergedRanges();

      calculateBlock(indexName, merged[0].getColumn()+1, merged[0].getLastColumn());
    }
  }
}

function init(){
  trackerSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TRACKER_NAME);
  rentSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RENT_NAME);
  indexSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(INDEX_NAME);

  rentabilidades = rentSheet.getRange(2, 1, trackerSheet.getMaxRows(), trackerSheet.getMaxColumns()).getValues();
  cnpjs = rentabilidades.map(p => p[0]).filter(p => !!p);
  rentabilidades = rentabilidades.map(p => p.slice(1, 123));
}


function parseMonthCount(periodName){
  
  if(periodName.endsWith('m')){
    return +periodName.replace('m', '');
  }
  if(periodName.toUpperCase() === 'T'){
    return 122; // 10 anos - 1 mes;
  }
}

function getRentabilidadesByRow(sheetName, row){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  
  return sheet.getRange(row, 2, 1, sheet.getMaxColumns() - 1).getValues()[0];
}
function getRentabilidadesByName(sheetName, findText){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var row = sheet.getRange('A:A').createTextFinder(findText).findNext().getRow();
  
  return sheet.getRange(row, 2, 1, sheet.getMaxColumns() - 1).getValues()[0];
}

function calcSortino(expectedReturns, riskFreeReturns, allowNonEmpty = false) {
  if(!expectedReturns || !expectedReturns.length || !riskFreeReturns || !riskFreeReturns.length){
    return '';
  }

  if(riskFreeReturns.length < expectedReturns.length){
    return '';
  }

  let emptyIndex = expectedReturns.findIndex(e => e.toString() === '');

  if(!allowNonEmpty && emptyIndex !== -1){
    return '';
  } else if(allowNonEmpty && emptyIndex !== -1){
    expectedReturns = expectedReturns.slice(0, emptyIndex+1);
    riskFreeReturns = riskFreeReturns.slice(0, emptyIndex+1);
  }

  //return 2;

  // delta das medias
  //let avg = average(rentabilidades);
  //let avgMin = average(retornoMinimo);

  // retorno total
  // let expectedReturn = expectedReturns.map(p => p + 1).reduce((acc, curr) => acc * curr, 1);
  // let riskFreeReturn = riskFreeReturns.map(p => p + 1).reduce((acc, curr) => acc * curr, 1);
  // let numerador = expectedReturn - riskFreeReturn;

  // media de deltas
  let numerador = average(expectedReturns.map((v, i) => v - riskFreeReturns[i]));

  let denominador = Math.sqrt(average(expectedReturns.map((v, i) => Math.pow(Math.min(v - riskFreeReturns[i], 0), 2))));

  if(denominador === 0){
    return 9.99;
  } else {
    return (numerador / denominador);
  }
}

function calculateBlock(indexName, startCol, endCol){
  let indices = getRentabilidadesByName(INDEX_NAME, indexName);

  let periods = [];

  for(let col = startCol; col<= endCol; col++){
    let months = parseMonthCount(trackerSheet.getRange(2, col).getValue());
    periods.push(months);
  }

  let values = [];

  for (const [idx, cnpj] of cnpjs.entries()) {
    if(!cnpj){
      break;
    }

    values[idx]=[];

    let rents = rentabilidades[idx];
    
    for(let [periodIdx, periodo] of periods.entries()){
      if(cnpj === '29.177.015/0001-01'){
        //debugger;
      }
      const sortino = calcSortino(rents.slice(0, periodo), indices.slice(0, periodo), periodo === 122);
      values[idx][periodIdx]=sortino;
    }
  }
  trackerSheet.getRange(3, startCol, values.length, endCol-startCol+1).setValues(values);     
}