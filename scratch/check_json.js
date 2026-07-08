const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, '..', 'data', 'semco-rfq.json');
if (!fs.existsSync(jsonPath)) {
  console.log('JSON file does not exist yet.');
  process.exit(0);
}

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

console.log('--- rfqs table ---');
const rfqs = data.rfqs || [];
console.log('Total rfqs:', rfqs.length);
if (rfqs.length > 0) {
  console.log('Keys of first RFQ:', Object.keys(rfqs[0]));
}

console.log('--- rfq_items table ---');
const rfqItems = data.rfq_items || [];
console.log('Total rfq_items:', rfqItems.length);
if (rfqItems.length > 0) {
  console.log('Keys of first RFQ item:', Object.keys(rfqItems[0]));
}
