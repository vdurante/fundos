const FIRST_BLOCK_COLUMN = 12;
const LAST_BLOCK_COLUMN = 29;
const NOTA_COLUMNS = [12, 18, 24];

const GRADIENT_POINTS = [
  [SpreadsheetApp.InterpolationType.NUMBER, -1],
  [SpreadsheetApp.InterpolationType.NUMBER, 0],
  [SpreadsheetApp.InterpolationType.NUMBER, 1],
];

function format() {
  const spreadSheet = SpreadsheetApp.getActiveSpreadsheet();
  filters_clear();
  setFormatOnSheet(spreadSheet.getSheetByName('Principal'), GRADIENT_POINTS);
  setFormatOnSheet(spreadSheet.getSheetByName('Finalistas'), GRADIENT_POINTS);
}

function setFormatOnSheet(sheet, points) {
  if (!sheet) {
    return;
  }

  const rows = sheet.getMaxRows() - 2;

  if (rows < 1) {
    return;
  }

  const range = sheet.getRange(
    3,
    FIRST_BLOCK_COLUMN,
    rows,
    LAST_BLOCK_COLUMN - FIRST_BLOCK_COLUMN + 1
  );

  range.clearFormat();
  range.setHorizontalAlignment('center');

  NOTA_COLUMNS.forEach(column => {
    sheet.getRange(3, column, rows, 1).setFontWeight('bold');
  });

  const gradient = SpreadsheetApp.newConditionalFormatRule()
    .setGradientMinpointWithValue('#E06666', points[0][0], points[0][1])
    .setGradientMidpointWithValue('#FFD666', points[1][0], points[1][1])
    .setGradientMaxpointWithValue('#93C47D', points[2][0], points[2][1])
    .setRanges([range])
    .build();

  const kept = sheet
    .getConditionalFormatRules()
    .filter(rule => !!rule.getBooleanCondition());

  sheet.setConditionalFormatRules(kept.concat([gradient]));
}
