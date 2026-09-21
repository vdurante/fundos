function grids() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ['Merge', 'Rentabilidade', 'Indices', 'Principal', 'Finalistas', 'Variáveis', 'Manual'].forEach(n => {
    const s = ss.getSheetByName(n);
    Logger.log('%s: %s rows x %s cols', n, s.getMaxRows(), s.getMaxColumns());
  });
}