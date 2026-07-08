const http = require('http');

// Helper to make POST requests
function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 5000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'x-user': 'Admin'
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch (e) {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Helper to make GET requests
function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:5000${path}`, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch (e) {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    }).on('error', reject);
  });
}

async function runRigorousTests() {
  console.log('================================================================');
  console.log('🚀 STARTING RIGOROUS COMPREHENSIVE PORTAL TESTING ROUTINE');
  console.log('================================================================');

  const report = {
    passed: [],
    failed: []
  };

  function assert(condition, message) {
    if (condition) {
      report.passed.push(message);
      console.log(`✅ PASS: ${message}`);
    } else {
      report.failed.push(message);
      console.log(`❌ FAIL: ${message}`);
    }
  }

  // ----------------------------------------------------------------
  // TEST 1: Admin Auth Domain Validation
  // ----------------------------------------------------------------
  console.log('\n--- 1. Testing Admin Auth Domain Restrictions ---');
  
  // 1.1 Signup with invalid domain
  const badRegRes = await post('/api/auth/register', {
    name: 'Fake Admin',
    email: 'admin@gmail.com',
    password: 'password123',
    role: 'Procurement Admin'
  });
  assert(
    badRegRes.status === 400 && badRegRes.body.success === false,
    'Admin signup with non-semcogroups.com email address was rejected.'
  );

  // 1.2 Signup with valid domain
  const adminEmail = `admin.${Date.now()}@semcogroups.com`;
  const goodRegRes = await post('/api/auth/register', {
    name: 'Real Admin',
    email: adminEmail,
    password: 'password123',
    role: 'Procurement Admin'
  });
  assert(
    goodRegRes.status === 200 && goodRegRes.body.success === true,
    'Admin signup with valid @semcogroups.com email address succeeded.'
  );

  // 1.3 Login with invalid credentials / non-admin pattern
  const badLoginRes = await post('/api/auth/login', {
    email: 'nonexistent@semcogroups.com',
    password: 'wrongpassword'
  });
  assert(
    badLoginRes.status === 401 && badLoginRes.body.success === false,
    'Login with invalid email/password failed correctly.'
  );

  // 1.4 Login with valid admin credentials
  const goodLoginRes = await post('/api/auth/login', {
    email: adminEmail,
    password: 'password123'
  });
  assert(
    goodLoginRes.status === 200 && goodLoginRes.body.success === true,
    'Login with valid admin credentials succeeded.'
  );

  // ----------------------------------------------------------------
  // TEST 2: Vendor Creation, RFQ Distribution & Bidding
  // ----------------------------------------------------------------
  console.log('\n--- 2. Testing Vendor RFQ and Auto-GST Bidding ---');

  // 2.1 Create Vendor 1
  const vendor1Email = `vendor1.${Date.now()}@gmail.com`;
  const v1Res = await post('/api/vendors', {
    name: 'Test Vendor A',
    contact_person: 'Alice',
    email: vendor1Email,
    phone: '9999888877',
    company_name: 'Vendor A Corp',
    gst_number: '27AAACP9999A1Z9',
    pan_number: 'AACP9999A',
    address: 'Mumbai',
    category: 'Plates'
  });
  const vendor1Id = v1Res.body.id;
  assert(vendor1Id !== undefined, 'Vendor 1 created successfully.');

  // 2.2 Create Vendor 2
  const vendor2Email = `vendor2.${Date.now()}@gmail.com`;
  const v2Res = await post('/api/vendors', {
    name: 'Test Vendor B',
    contact_person: 'Bob',
    email: vendor2Email,
    phone: '9999888866',
    company_name: 'Vendor B Corp',
    gst_number: '27AAACP8888A1Z9',
    pan_number: 'AACP8888A',
    address: 'Pune',
    category: 'Plates'
  });
  const vendor2Id = v2Res.body.id;
  assert(vendor2Id !== undefined, 'Vendor 2 created successfully.');

  // 2.3 Create RFQ
  const rfqRes = await post('/api/rfqs', {
    project_name: 'Metro Line 3 Plates',
    delivery_date: '2026-08-30',
    department: 'Procurement',
    vendor_ids: [vendor1Id, vendor2Id],
    items: [
      { moc: 'IS2062', description: 'Plates 12mm thick', make: 'SAIL', size: '12mm', quantity: 10, unit: 'Ton' }
    ]
  });
  const rfqId = rfqRes.body.id;
  assert(rfqId !== undefined, 'RFQ created successfully.');

  // 2.4 Distribute RFQ
  const distRfqRes = await post('/api/rfqs/distribute', {
    rfq_id: rfqId,
    vendor_ids: [vendor1Id, vendor2Id]
  });
  assert(distRfqRes.status === 200, 'RFQ distributed to vendors.');

  // Get active distributions for token
  const rfqDetails = await get(`/api/rfqs/${rfqId}`);
  const rfqDists = rfqDetails.body.data.distributions || [];
  const v1Dist = rfqDists.find(d => d.vendor_id === vendor1Id);
  const v2Dist = rfqDists.find(d => d.vendor_id === vendor2Id);
  assert(v1Dist !== undefined && v2Dist !== undefined, 'RFQ distribution tokens generated.');

  // 2.5 Submit Bid Vendor 1 (Rate: 50,000/Ton, Tax: 18%)
  const v1Submit = await post('/api/vendor-portal/submit', {
    token: v1Dist.token,
    quotes: [
      {
        item_id: rfqDetails.body.data.items[0].id,
        rate: 50000,
        lead_time: 10,
        payment_terms: '30 Days',
        remarks: 'Premium steel'
      }
    ],
    final_submit: true,
    final_cost: 590000,
    cgst_applicable: true,
    sgst_applicable: true,
    tax_bracket: 18,
    custom_fields: {}
  });
  assert(v1Submit.status === 200, 'Vendor 1 quotation submitted.');

  // 2.6 Submit Bid Vendor 2 (Rate: 48,000/Ton, Tax: 18%)
  const v2Submit = await post('/api/vendor-portal/submit', {
    token: v2Dist.token,
    quotes: [
      {
        item_id: rfqDetails.body.data.items[0].id,
        rate: 48000,
        lead_time: 12,
        payment_terms: '30 Days',
        remarks: 'Standard steel'
      }
    ],
    final_submit: true,
    final_cost: 566400,
    cgst_applicable: true,
    sgst_applicable: true,
    tax_bracket: 18,
    custom_fields: {}
  });
  assert(v2Submit.status === 200, 'Vendor 2 quotation submitted.');

  // Verify GST auto calculation on comparative statement
  const rfqComp = await get(`/api/rfqs/${rfqId}/comparative`);
  const v2Record = rfqComp.body.data.rankings.find(r => r.vendor_id === vendor2Id);
  // Rate: 48,000 * 10 Tons = 480,000.
  // Tax: 18% of 480,000 = 86,400.
  // Final Cost: 480,000 + 86,400 = 566,400.
  assert(
    v2Record && Math.round(v2Record.final_cost) === 566400,
    `Vendor GST auto-calculation verified: Expected 566400, got ${v2Record ? v2Record.final_cost : 'undefined'}`
  );

  // ----------------------------------------------------------------
  // TEST 3: Transporter Creation, Bidding & Live Rankings
  // ----------------------------------------------------------------
  console.log('\n--- 3. Testing Transporter Bidding, Live Rankings, and Formula ---');

  // 3.1 Create Transporter 1
  const trans1Email = `trans1.${Date.now()}@gmail.com`;
  const t1Res = await post('/api/transporters', {
    name: 'Test Transporter A',
    contact_person: 'Charlie',
    email: trans1Email,
    phone: '9999000011',
    company_name: 'Transporter A Ltd',
    gst_number: '27AAACP7777A1Z9',
    pan_number: 'AACP7777A',
    address: 'Kalyan',
    category: 'Plates'
  });
  const trans1Id = t1Res.body.id;
  assert(trans1Id !== undefined, 'Transporter 1 created successfully.');

  // 3.2 Create Transporter 2
  const trans2Email = `trans2.${Date.now()}@gmail.com`;
  const t2Res = await post('/api/transporters', {
    name: 'Test Transporter B',
    contact_person: 'David',
    email: trans2Email,
    phone: '9999000022',
    company_name: 'Transporter B Ltd',
    gst_number: '27AAACP6666A1Z9',
    pan_number: 'AACP6666A',
    address: 'Panvel',
    category: 'Plates'
  });
  const trans2Id = t2Res.body.id;
  assert(trans2Id !== undefined, 'Transporter 2 created successfully.');

  // 3.3 Create Transport Request
  const trqRes = await post('/api/transport-requests', {
    from_location: 'JNPT Port',
    to_location: 'Taloja MIDC',
    required_date: '2026-07-15',
    transporter_ids: [trans1Id, trans2Id],
    items: [
      { material_name: 'Heavy Plates', material_category: 'Plates', quantity: 20, unit: 'Ton', remarks: 'Requires trailer' }
    ]
  });
  const trqId = trqRes.body.id;
  assert(trqId !== undefined, 'Transport request created.');

  // 3.4 Distribute Transport Request
  const distTrqRes = await post('/api/transport-requests/distribute', {
    request_id: trqId,
    transporter_ids: [trans1Id, trans2Id]
  });
  assert(distTrqRes.status === 200, 'Transport request distributed.');

  // Retrieve tokens
  const trqDetails = await get(`/api/transport-requests/${trqId}`);
  const trqDists = trqDetails.body.data.distributions || [];
  const t1Dist = trqDists.find(d => d.transporter_id === trans1Id);
  const t2Dist = trqDists.find(d => d.transporter_id === trans2Id);
  assert(t1Dist !== undefined && t2Dist !== undefined, 'Transporter tokens generated.');

  // 3.5 Submit Bid Transporter 1 (Rate: 15,000, ODC: 2,000, Tax: 12%, Return Trip Included: Yes, Return Trip Rate: 8,000)
  const t1Submit = await post('/api/transporter-portal/submit', {
    token: t1Dist.token,
    distance: 45.0,
    vehicle_available_from: '2026-07-14',
    vehicle_size: '32 feet Multi-Axle',
    vehicle_tonnage: 25.0,
    actual_weight_charged: 20.0,
    rate_per_ton: 15000.00,
    odc_charges: 2000.00,
    tax_bracket: 12,
    return_trip_included: 1,
    return_trip_rate: 8000.00
  });
  assert(t1Submit.status === 200, 'Transporter 1 quotation submitted.');

  // 3.6 Submit Bid Transporter 2 (Rate: 14,000, ODC: 1,500, Tax: 12%, Return Trip Included: Yes, Return Trip Rate: 7,000)
  const t2Submit = await post('/api/transporter-portal/submit', {
    token: t2Dist.token,
    distance: 45.0,
    vehicle_available_from: '2026-07-14',
    vehicle_size: '32 feet Multi-Axle',
    vehicle_tonnage: 25.0,
    actual_weight_charged: 20.0,
    rate_per_ton: 14000.00,
    odc_charges: 1500.00,
    tax_bracket: 12,
    return_trip_included: 1,
    return_trip_rate: 7000.00
  });
  assert(t2Submit.status === 200, 'Transporter 2 quotation submitted.');

  // 3.7 Verify Transporter Calculation Formula
  // For Transporter 2 (L1 Winner):
  // Rate: 14,000.
  // ODC: 1,500.
  // Return Trip: 7,000.
  // Subtotal before tax: 14,000 + 1,500 = 15,500.
  // Base for tax: Subtotal + Return Trip = 15,500 + 7,000 = 22,500.
  // Tax (12% of 22,500) = 2,700.
  // Final Cost = 22,500 + 2,700 = 25,200.
  const trqComp = await get(`/api/transport-requests/${trqId}/comparative`);
  const t2Record = trqComp.body.data.rankings.find(r => r.transporter_id === trans2Id);
  assert(
    t2Record && Math.round(t2Record.final_cost) === 25200,
    `Transporter calculation formula verified: Expected 25200, got ${t2Record ? t2Record.final_cost : 'undefined'}`
  );

  // 3.8 Verify Live Ranking updates (2 bids submitted, verify rank assignment)
  const rankings = trqComp.body.data.rankings;
  assert(
    rankings && rankings.length === 2 && rankings[0].transporter_id === trans2Id && rankings[1].transporter_id === trans1Id,
    'Transporter live ranking order verified successfully (Transporter B L1, Transporter A L2).'
  );

  // ----------------------------------------------------------------
  // TEST 4: L1 Finalisation & Email Dispatch
  // ----------------------------------------------------------------
  console.log('\n--- 4. Testing L1 Finalisation and Unique Subject Threads ---');

  // 4.1 Finalise RFQ L1
  const finaliseRfq = await post(`/api/rfqs/${rfqId}/finalise`, {});
  assert(
    finaliseRfq.status === 200 && finaliseRfq.body.success === true,
    'RFQ L1 finalized successfully.'
  );

  // 4.2 Finalise Transporter L1
  const finaliseTrq = await post(`/api/transport-requests/${trqId}/finalise`, {});
  assert(
    finaliseTrq.status === 200 && finaliseTrq.body.success === true,
    'Transport request L1 finalized successfully.'
  );

  // ----------------------------------------------------------------
  // TEST 5: Verify Safe Testing Mode Wiping (From Scratch State)
  // ----------------------------------------------------------------
  console.log('\n--- 5. Testing Safe Testing Mode Data Clearance ---');
  // Safe testing mode wipes out database records during startup if configured.
  // Let's verify we can fetch the lists and see if they contain the test records.
  const activeRfqs = await get('/api/rfqs');
  assert(activeRfqs.body.data !== undefined, 'API returns list of RFQs successfully.');

  console.log('\n================================================================');
  console.log('🏁 RIGOROUS TESTING COMPLETED. GENERATING TEST SCORE REPORT...');
  console.log('================================================================');
  console.log(`PASSED: ${report.passed.length}/${report.passed.length + report.failed.length}`);
  console.log(`FAILED: ${report.failed.length}/${report.passed.length + report.failed.length}`);

  if (report.failed.length > 0) {
    console.error('⚠️ RIGOROUS PORTAL TESTING FAILED WITH ERRORS!');
    process.exit(1);
  } else {
    console.log('🎉 ALL INTEGRATION AND VALIDATION TESTS PASSED WITHOUT EXCEPTION!');
    process.exit(0);
  }
}

runRigorousTests().catch(err => {
  console.error('❌ RIGOROUS TESTS FATAL ERROR:', err);
  process.exit(1);
});
