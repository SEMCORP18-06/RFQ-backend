const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'uploads', 'rfq_rfq_1782804721911_Purchase_Automation_-_Version_2.xlsx');
try {
  const workbook = XLSX.readFile(filePath);
  console.log('Sheet Names:', workbook.SheetNames);
  
  workbook.SheetNames.forEach(sheetName => {
    console.log(`\nSheet: ${sheetName}`);
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    console.log(`Range: ${sheet['!ref']}`);
    const json = XLSX.utils.sheet_to_json(sheet, {header: 1});
    console.log('First 5 rows:');
    console.log(json.slice(0, 5));
  });
} catch (err) {
  console.error(err);
}
