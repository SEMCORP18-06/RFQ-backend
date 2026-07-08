const Database = require('../db');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'semco-rfq.db');
const db = new Database(dbPath);

console.log('--- rfqs table info ---');
console.log(db.prepare("PRAGMA table_info(rfqs)").all());

console.log('--- rfq_items table info ---');
console.log(db.prepare("PRAGMA table_info(rfq_items)").all());

db.close();
