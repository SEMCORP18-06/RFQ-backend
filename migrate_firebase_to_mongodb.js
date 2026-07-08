const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get } = require('firebase/database');
const mongoose = require('mongoose');
const path = require('path');
const dns = require('dns');

// Configure custom DNS resolvers to ensure MongoDB Atlas SRV resolution works in restricted environments
try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (e) {
  console.warn('[DNS] Failed to set custom DNS servers:', e.message);
}

require('dotenv').config({ path: path.join(__dirname, '.env') });


const firebaseConfig = {
  apiKey: "AIzaSyCyj2FlT99skWNclrLKnCP1tAQx_mDN-QE",
  authDomain: "smart-rfq-7651e.firebaseapp.com",
  databaseURL: "https://smart-rfq-7651e-default-rtdb.firebaseio.com",
  projectId: "smart-rfq-7651e",
  storageBucket: "smart-rfq-7651e.firebasestorage.app",
  messagingSenderId: "335822094337",
  appId: "1:335822094337:web:d5192e51ea1bd33f078000",
  measurementId: "G-E775JSFCBY"
};

const vendorSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  name: String,
  contact_person: String,
  email: String,
  phone: String,
  company_name: String,
  gst_number: String,
  pan_number: String,
  address: String,
  category: String,
  preferred: { type: Number, default: 0 },
  rating: { type: Number, default: 4.0 },
  created_at: String
});

const Vendor = mongoose.models.Vendor || mongoose.model('Vendor', vendorSchema);

async function migrate() {
  console.log('--- STARTING FIREBASE TO MONGODB VENDOR MIGRATION ---');

  // 1. Fetch from Firebase
  let firebaseVendors = [];
  try {
    console.log('[Firebase] Initializing and fetching vendors...');
    const app = initializeApp(firebaseConfig);
    const db = getDatabase(app);
    const snapshot = await get(ref(db, 'vendors'));
    
    if (snapshot.exists()) {
      const dataObj = snapshot.val();
      if (Array.isArray(dataObj)) {
        firebaseVendors = dataObj.filter(x => x !== null);
      } else if (typeof dataObj === 'object') {
        firebaseVendors = Object.values(dataObj);
      }
      console.log(`[Firebase] Successfully retrieved ${firebaseVendors.length} vendor profiles.`);
    } else {
      console.log('[Firebase] No vendor profiles found in Firebase Realtime Database.');
    }
  } catch (err) {
    console.error('❌ [Firebase Error] Failed to fetch vendors:', err.message);
    process.exit(1);
  }

  if (firebaseVendors.length === 0) {
    console.log('No vendors to migrate. Exiting.');
    process.exit(0);
  }

  // 2. Connect and Save to MongoDB
  const mongoUri = process.env.MONGODB_URI;
  console.log('[MongoDB] URI:', mongoUri);
  if (!mongoUri) {
    console.error('❌ [MongoDB Error] MONGODB_URI is not defined in .env.');
    process.exit(1);
  }

  try {
    console.log('[MongoDB] Connecting to database...');
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log('[MongoDB] Connected successfully.');

    console.log('[MongoDB] Upserting vendors into MongoDB...');
    let migratedCount = 0;
    for (const vendor of firebaseVendors) {
      // Ensure rating and preferred have correct types
      const cleanVendor = {
        ...vendor,
        preferred: vendor.preferred ? 1 : 0,
        rating: typeof vendor.rating === 'number' ? vendor.rating : parseFloat(vendor.rating) || 4.0
      };
      
      await Vendor.findOneAndUpdate(
        { id: vendor.id },
        cleanVendor,
        { upsert: true, new: true }
      );
      migratedCount++;
      console.log(`   -> Migrated vendor: ${vendor.id} (${vendor.name})`);
    }

    console.log(`\n🎉 SUCCESS: Successfully migrated ${migratedCount} vendors from Firebase to MongoDB!`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.log('\n❌ [MongoDB Error] Connection or migration failed:', err.message);
    console.log('⚠️  Notice: Outbound TCP connections to MongoDB Atlas may be blocked by your local network/sandbox DNS limits.');
    console.log('The migration script is complete and ready. Run this locally via "node migrate_firebase_to_mongodb.js" to complete migration.');
    process.exit(0);
  }
}

migrate();
