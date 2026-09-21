function format() {
  const spreadSheet = SpreadsheetApp.getActiveSpreadsheet();
  filters_clear();
  setFormatOnSheet(
    spreadSheet.getSheetByName("Principal"), 
    [
      [SpreadsheetApp.InterpolationType.NUMBER, -1],
      [SpreadsheetApp.InterpolationType.NUMBER, 0],
      [SpreadsheetApp.InterpolationType.NUMBER, 1]
    ]);
    /*[
      [SpreadsheetApp.InterpolationType.PERCENTILE, "10"],
      [SpreadsheetApp.InterpolationType.PERCENT, "50"],
      [SpreadsheetApp.InterpolationType.PERCENTILE, "90"]
    ])*/;
  setFormatOnSheet(
    spreadSheet.getSheetByName("Finalistas"), 
    [
      [SpreadsheetApp.InterpolationType.NUMBER, -1],
      [SpreadsheetApp.InterpolationType.NUMBER, 0],
      [SpreadsheetApp.InterpolationType.NUMBER, 1]
    ]);
}

function setFormatOnSheet(sheet, rules){  
  for(let i = 12; i<=29;i++){
    setFormatOnColumn(sheet, i, rules);
  }
}

function setFormatOnColumn(sheet, column, rules){
  var range = sheet.getRange(3, column, sheet.getLastRow()-2, 1);
  range.clearFormat();
  range.setHorizontalAlignment("center");
  if(column == 12 ||column == 18 || column == 24){
    range.setFontWeight("bold");
  }
  var rule = SpreadsheetApp.newConditionalFormatRule()
    .setGradientMinpointWithValue("#E06666", rules[0][0], rules[0][1])
    .setGradientMidpointWithValue("#FFD666", rules[1][0], rules[1][1]) 
    .setGradientMaxpointWithValue("#93C47D", rules[2][0], rules[2][1]) 
    .setRanges([range])
    .build();

  var rules = sheet.getConditionalFormatRules();
  rules.push(rule);
  sheet.setConditionalFormatRules(rules);
}