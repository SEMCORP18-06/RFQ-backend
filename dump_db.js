const Database = require('./db');
const db = new Database('C:/Users/Admin/.gemini/antigravity/scratch/semco-smart-rfq/data/semco-rfq.db');

console.log('=== USERS ===');
const users = db.prepare('SELECT id, email, role, vendor_id, transporter_id FROM users').all();
console.log(users);

console.log('\n=== TRANSPORTERS ===');
const transporters = db.prepare('SELECT id, name, email FROM transporters').all();
console.log(transporters);
