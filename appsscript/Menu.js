function onOpen() {
  var ui = SpreadsheetApp.getUi();
  // Or DocumentApp or FormApp.
  ui.createMenu('CLIQUE AQUI')
      .addItem('Atualizar cálculos', 'sortino')
      .addItem('Formatar colunas', 'format')
      .addSeparator()
      .addItem('Clear Filters', 'filters_clear')
      .addItem('Sort Nota', 'sort_nota')
      .addItem('DP 4 ou 5', 'filter_dp_4_5')
      .addSeparator()
      .addItem('00 ~ 05', 'filter_risco_00_05')
      .addItem('05 ~ 10', 'filter_risco_05_10')
      .addItem('10 ~ 25', 'filter_risco_10_25')
      .addItem('25 ~ 100', 'filter_risco_25_100')
      .addItem('IE', 'filter_tipo_IE')
      .addToUi();
}
