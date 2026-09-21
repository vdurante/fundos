function FindRowNumber(sheetName, searchTerm){
  let tracker =  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  for(let row = 1; row <= tracker.getMaxRows(); row++){
    if(tracker.getRange(row, 1).getValue() === searchTerm){
      return row;
    }
  }
  return undefined;
}

const average = arr => arr.reduce( ( p, c ) => p + c, 0 ) / arr.length;

function SORTINO_DEBUG(cnpj, index, period, rentabilidades, retornoMinimo, allowNonEmpty = false) {
  const Logger = BetterLog.useSpreadsheet('136soID6bNAdyqkjplZLnZTXMFDx_SP9ogbA5aDvQKhc');

  const cache = CacheService.getDocumentCache();

  const key = `${cnpj}/${index}/${period}/${allowNonEmpty}`;

  let result = cache.get(key);

  if(result !== null){
    //return parseFloat(result);
  }

  try{

    if(!rentabilidades || !rentabilidades.length || !retornoMinimo || !retornoMinimo.length){
      return '';
    }

    let emptyIndex = rentabilidades[0].findIndex(e => e.toString() === '');

    if(!allowNonEmpty && emptyIndex !== -1){
      return '';
    } else if(allowNonEmpty && emptyIndex !== -1){
      rentabilidades[0] = rentabilidades[0].slice(0, emptyIndex+1);
      retornoMinimo[0] = retornoMinimo[0].slice(0, emptyIndex+1);
    }

    //return 2;

    let expectedReturn = rentabilidades[0].map(p => p + 1).reduce((acc, curr) => acc * curr, 1);
    let riskFreeReturn = retornoMinimo[0].map(p => p + 1).reduce((acc, curr) => acc * curr, 1);
    let numerador = expectedReturn - riskFreeReturn;
    let denominador = Math.sqrt(average(rentabilidades[0].map((v, i) => Math.pow(v >= retornoMinimo[0][i] ? 0 : v - retornoMinimo[0][i], 2))));

    if(denominador === 0){
      result = 9.99;
    } else {
      result = numerador / denominador;
    }
    
    //cache.put(key, result);

    return result;

  }catch(ex){
    Logger.log(rentabilidades);
    Logger.log(retornoMinimo);
    Logger.log(ex);
    throw ex;
  }
  
}

function SORTINO_OLD(cnpj, index, period, rentabilidades, retornoMinimo, allowNonEmpty = false) {
  const Logger = BetterLog.useSpreadsheet('136soID6bNAdyqkjplZLnZTXMFDx_SP9ogbA5aDvQKhc');

  const cache = CacheService.getDocumentCache();

  const key = `${cnpj}/${index}/${period}/${allowNonEmpty}`;

  let result = cache.get(key);

  if(result !== null){
    return parseFloat(result);
  }

  try{

    if(!rentabilidades || !rentabilidades.length || !retornoMinimo || !retornoMinimo.length){
      return '';
    }

    let emptyIndex = rentabilidades[0].findIndex(e => e.toString() === '');

    if(!allowNonEmpty && emptyIndex !== -1){
      return '';
    } else if(allowNonEmpty && emptyIndex !== -1){
      rentabilidades[0] = rentabilidades[0].slice(0, emptyIndex+1);
      retornoMinimo[0] = retornoMinimo[0].slice(0, emptyIndex+1);
    }

    //return 2;

    let avg = average(rentabilidades[0]);
    let avgMin = average(retornoMinimo[0]);
    let numerador = avg - avgMin;
    let denominador = Math.sqrt(average(rentabilidades[0].map((v, i) => Math.pow(v >= retornoMinimo[0][i] ? 0 : v - retornoMinimo[0][i], 2))));

    if(denominador === 0){
      result = 9.99;
    } else {
      result = numerador / denominador;
    }
    
    cache.put(key, result);

    return result;

  }catch(ex){
    Logger.log(rentabilidades);
    Logger.log(retornoMinimo);
    Logger.log(ex);
    throw ex;
  }
  
}