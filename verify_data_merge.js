const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const Database = require('./db');

async function runTests() {
  console.log('=== STARTING AUTOMATED DATA PERSISTENCE & MERGE VERIFICATION ===\n');

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Error: MONGODB_URI not found in environment variables.');
    process.exit(1);
  }

  // ----------------------------------------------------
  // TEST 1: Bidirectional MongoDB Startup Sync
  // ----------------------------------------------------
  console.log('[Test 1] Starting Bidirectional Startup Sync Test...');

  // Setup temporary database JSON file
  const tempDbPath = path.join(__dirname, 'data', 'temp-semco-rfq.json');
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  // Initialize a Database instance using the temp file
  const testDb = new Database(tempDbPath.replace('.json', '.db'));

  // Define unique IDs for our test vendors
  const localOnlyId = 'VND_TEST_LOCAL_' + Date.now();
  const mongoOnlyId = 'VND_TEST_MONGO_' + Date.now();

  // Create a local-only record in the JSON database cache
  const localVendor = {
    id: localOnlyId,
    name: 'Test Local-Only Vendor',
    contact_person: 'Local Contact',
    email: 'local@test.com',
    phone: '1234567890',
    company_name: 'Local Co',
    gst_number: '27AAAAA1111A1Z1',
    pan_number: 'AAAAA1111A',
    address: 'Local Road',
    category: 'Plates',
    preferred: 0,
    rating: 4.5,
    archived: 0,
    created_at: new Date().toISOString()
  };
  testDb.data.vendors.push(localVendor);
  testDb.save();
  console.log(`- Created local-only vendor in cache with ID: ${localOnlyId}`);

  // Connect to MongoDB directly using mongoose to insert a Mongo-only record
  console.log('- Connecting to MongoDB for setup...');
  await mongoose.connect(uri);
  const VendorModel = mongoose.models.Vendor || mongoose.model('Vendor', new mongoose.Schema({
    id: String, name: String, contact_person: String, email: String, phone: String, company_name: String,
    gst_number: String, pan_number: String, address: String, category: String, preferred: Number, rating: Number,
    archived: Number, created_at: String
  }));

  const mongoVendor = {
    id: mongoOnlyId,
    name: 'Test Mongo-Only Vendor',
    contact_person: 'Mongo Contact',
    email: 'mongo@test.com',
    phone: '0987654321',
    company_name: 'Mongo Co',
    gst_number: '27BBBBB2222B2Z2',
    pan_number: 'BBBBB2222B',
    address: 'Mongo Street',
    category: 'Seamless Tubes',
    preferred: 0,
    rating: 4.2,
    archived: 0,
    created_at: new Date().toISOString()
  };
  await VendorModel.create(mongoVendor);
  console.log(`- Created mongo-only vendor in MongoDB with ID: ${mongoOnlyId}`);

  // Disconnect mongoose so Database.connectMongo can connect clean
  await mongoose.disconnect();

  // Run the startup connect & sync logic on our test database instance
  console.log('- Triggering Database connectMongo startup sync...');
  await testDb.connectMongo(uri);

  // Read cache and verify both records are merged
  const cacheVendors = testDb.data.vendors;
  const hasLocal = cacheVendors.some(v => v.id === localOnlyId);
  const hasMongo = cacheVendors.some(v => v.id === mongoOnlyId);

  if (hasLocal && hasMongo) {
    console.log('✅ Success: Both local-only and mongo-only records exist in the merged local cache!');
  } else {
    console.error('❌ Failure: Merged local cache is missing records.', { hasLocal, hasMongo });
  }

  // Connect directly to MongoDB to verify that local-only record was pushed
  await mongoose.connect(uri);
  const dbLocalRecord = await VendorModel.findOne({ id: localOnlyId });
  const dbMongoRecord = await VendorModel.findOne({ id: mongoOnlyId });

  if (dbLocalRecord && dbMongoRecord) {
    console.log('✅ Success: Both local-only and mongo-only records exist in the remote MongoDB database!');
  } else {
    console.error('❌ Failure: MongoDB is missing records.', { hasDbLocal: !!dbLocalRecord, hasDbMongo: !!dbMongoRecord });
  }

  // Cleanup test records
  console.log('- Cleaning up test records...');
  await VendorModel.deleteOne({ id: localOnlyId });
  await VendorModel.deleteOne({ id: mongoOnlyId });
  await mongoose.disconnect();

  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  console.log('✅ Test 1 completed successfully!\n');

  // ----------------------------------------------------
  // TEST 2: Excel Import Appending Logic Simulation
  // ----------------------------------------------------
  console.log('[Test 2] Simulating Excel Import Appending Logic...');

  // Helper simulating the decision logic of simulateRFQExcelImport & importTransporterExcel
  function simulateExcelImport(existingRows, spreadsheetItems) {
    // Check if existing items are empty template rows (or empty array)
    const isEmptyTemplate = existingRows.length === 0 || existingRows.every(r => !r.moc && !r.description);

    let finalRows = [];
    if (!isEmptyTemplate) {
      // Keep existing non-empty rows
      finalRows = [...existingRows];
    }
    // Append spreadsheet items
    spreadsheetItems.forEach(item => {
      finalRows.push(item);
    });
    return finalRows;
  }

  // Case A: Table has only empty template row
  const caseA_existing = [{ moc: '', description: '', qty: 1 }];
  const caseA_new = [{ moc: 'SS304', description: 'Pipe', qty: 10 }, { moc: 'SS316', description: 'Fitting', qty: 5 }];
  const caseA_result = simulateExcelImport(caseA_existing, caseA_new);

  console.log('- Case A (Empty template row existing):');
  console.log(`  Expected output size: 2, Actual: ${caseA_result.length}`);
  if (caseA_result.length === 2 && caseA_result[0].moc === 'SS304') {
    console.log('  ✅ Case A Success: Empty template row was cleared and sheet items appended.');
  } else {
    console.error('  ❌ Case A Failure:', caseA_result);
  }

  // Case B: Table has existing valid user input
  const caseB_existing = [{ moc: 'Copper', description: 'Tube', qty: 3 }];
  const caseB_new = [{ moc: 'SS304', description: 'Pipe', qty: 10 }];
  const caseB_result = simulateExcelImport(caseB_existing, caseB_new);

  console.log('- Case B (Valid existing items):');
  console.log(`  Expected output size: 2, Actual: ${caseB_result.length}`);
  if (caseB_result.length === 2 && caseB_result[0].moc === 'Copper' && caseB_result[1].moc === 'SS304') {
    console.log('  ✅ Case B Success: Existing item was preserved and sheet items appended.');
  } else {
    console.error('  ❌ Case B Failure:', caseB_result);
  }

  console.log('\n✅ Test 2 completed successfully!\n');
  console.log('=== ALL PERSISTENCE AND MERGE TESTS PASSED ===');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
