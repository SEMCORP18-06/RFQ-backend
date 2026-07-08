const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dns = require('dns');

// Configure custom DNS resolvers to ensure MongoDB Atlas SRV resolution works in restricted environments
try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (e) {
  console.warn('[DNS] Failed to set custom DNS servers:', e.message);
}

// Load env from the project workspace directory
const projectRoot = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(projectRoot, '.env') });

async function wipeAll() {
  console.log('--- Starting complete database wipe ---');

  // 1. Wipe local JSON database file
  const jsonPath = path.join(projectRoot, 'data/semco-rfq.json');
  const emptyDb = {
    vendors: [],
    rfqs: [],
    rfq_items: [],
    rfq_distributions: [],
    vendor_quotes: [],
    audit_trail: [],
    notifications: [],
    users: [],
    transporters: [],
    transport_requests: [],
    transport_request_items: [],
    transport_distributions: []
  };

  try {
    fs.writeFileSync(jsonPath, JSON.stringify(emptyDb, null, 2), 'utf8');
    console.log('[JSON DB] Successfully wiped local semco-rfq.json cache.');
  } catch (err) {
    console.error('[JSON DB Error] Failed to wipe JSON file:', err.message);
  }

  // 2. Wipe SQLite DB file if it exists
  const sqlitePath = path.join(projectRoot, 'data/semco-rfq.db');
  try {
    if (fs.existsSync(sqlitePath)) {
      fs.unlinkSync(sqlitePath);
      console.log('[SQLite DB] Successfully deleted local semco-rfq.db file.');
    }
  } catch (err) {
    console.error('[SQLite DB Error] Failed to delete semco-rfq.db:', err.message);
  }

  // 3. Clear uploads directory
  const uploadsDir = path.join(projectRoot, 'uploads');
  try {
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      for (const file of files) {
        if (file !== '.gitkeep') {
          fs.unlinkSync(path.join(uploadsDir, file));
        }
      }
      console.log('[Uploads] Successfully cleared uploads folder.');
    }
  } catch (err) {
    console.error('[Uploads Error] Failed to clear uploads folder:', err.message);
  }

  // 4. Wipe MongoDB database documents
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.log('[MongoDB] MONGODB_URI environment variable is not defined in .env. Skipping MongoDB wipe.');
    process.exit(0);
  }

  try {
    console.log('[MongoDB] Connecting to Mongo database to wipe data...');
    await mongoose.connect(mongoUri);
    console.log('[MongoDB] Connected successfully.');

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    
    console.log(`[MongoDB] Found ${collections.length} collection(s) to clear.`);
    for (const collInfo of collections) {
      const name = collInfo.name;
      // Skip system collections if any
      if (name.startsWith('system.')) continue;
      console.log(`[MongoDB] Clearing collection: ${name}...`);
      await db.collection(name).deleteMany({});
    }
    console.log('[MongoDB] Successfully deleted all documents from all collections.');
  } catch (err) {
    console.error('[MongoDB Error] Failed to clear MongoDB data:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('[MongoDB] Disconnected.');
    console.log('--- Database wipe completed successfully ---');
    process.exit(0);
  }
}

wipeAll();
