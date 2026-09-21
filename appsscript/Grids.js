function grids() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [
    'Rentabilidade',
    'Indices',
    'Principal',
    'Finalistas',
    'Variáveis',
    'Fundos',
    'Missing',
    'Manual',
  ].forEach(n => {
    const s = ss.getSheetByName(n);
    if (!s) {
      Logger.log('%s: ausente', n);
      return;
    }
    Logger.log('%s: %s rows x %s cols', n, s.getMaxRows(), s.getMaxColumns());
  });
}
