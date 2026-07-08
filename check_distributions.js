const Database = require('./db');
const db = new Database('C:/Users/Admin/.gemini/antigravity/scratch/semco-smart-rfq/data/semco-rfq.db');

console.log('=== TRANSPORT DISTRIBUTIONS ===');
const dists = db.prepare('SELECT * FROM transport_distributions').all();
console.log(JSON.stringify(dists, null, 2));
