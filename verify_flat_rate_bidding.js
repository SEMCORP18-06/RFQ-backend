const http = require('http');

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
        'Content-Length': data.length
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:5000${path}`, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { resolve(raw); }
      });
    }).on('error', reject);
  });
}

async function runTest() {
  console.log('=== STARTING FLAT-RATE TRIP AND RETURN TRIP BIDDING INTEGRATION TEST ===');

  // 1. Create a Transporter
  console.log('\n1. Creating Test Transporter...');
  const transporterRes = await post('/api/transporters', {
    name: 'Flat Rate Carrier Corp',
    contact_person: 'Ramesh Kumar',
    email: 'ramesh.flatrate@yopmail.com',
    phone: '9812345678',
    company_name: 'Flat Rate Logistics Pvt Ltd',
    gst_number: '27AAACL9999A1Z9',
    pan_number: 'AACL9999A',
    address: 'Vashi, Navi Mumbai, IN',
    category: 'FTL Trucking'
  });
  console.log('Transporter Response:', transporterRes);
  const transporterId = transporterRes.id;
  if (!transporterId) throw new Error('Failed to create transporter');

  // 2. Create Transport Request (Draft)
  console.log('\n2. Creating Transport Request...');
  const requestRes = await post('/api/transport-requests', {
    from_location: 'Pune Plant',
    to_location: 'Chennai Hub',
    required_date: '2026-07-10',
    transporter_ids: [transporterId],
    items: [
      { material_name: 'Steel Tubes', material_category: 'Raw Materials', quantity: 15.0, unit: 'Tons', remarks: 'Requires side pillar vehicle' }
    ],
    distance: 1200.0,
    vehicle_available_from: null,
    vehicle_size: '32 Ft Single Axle',
    vehicle_tonnage: 15.0,
    actual_weight_charged: 0.0,
    odc_charges: 0.0,
    weight_unit: 'Tons',
    tax_bracket: 0.0
  });
  console.log('Create Request Response:', requestRes);
  const requestId = requestRes.id;
  if (!requestId) throw new Error('Failed to create request');

  // 3. Launch Request (Distribute)
  console.log('\n3. Launching Transport Request Bidding Window...');
  const launchRes = await post('/api/transport-requests/distribute', {
    request_id: requestId,
    transporter_ids: [transporterId]
  });
  console.log('Launch Response:', launchRes);

  // Get token
  const detailsRes = await get(`/api/transport-requests/${requestId}`);
  if (!detailsRes.success || !detailsRes.data.distributions || detailsRes.data.distributions.length === 0) {
    throw new Error('Failed to get transport request details or distribution record');
  }
  const token = detailsRes.data.distributions[0].token;
  console.log('Generated Transporter Token:', token);

  // 4. Verify Portal Link
  console.log('\n4. Verifying Transporter Portal Link...');
  const verifyRes = await get(`/api/transporter-portal/verify?token=${token}`);
  if (!verifyRes.success) {
    throw new Error('Failed to verify portal token: ' + verifyRes.message);
  }
  console.log('Verify Response (Transporter Name):', verifyRes.data.transporter.name);

  // 5. Submit Flat-Rate Bid with Return Trip Rate & ODC Charges
  console.log('\n5. Submitting Flat-Rate Bid with ODC and Return Trip...');
  const submitRes = await post('/api/transporter-portal/submit', {
    token: token,
    distance: 1200.0,
    vehicle_available_from: '2026-07-08',
    vehicle_size: '32 Ft Single Axle',
    vehicle_tonnage: 15.0,
    actual_weight_charged: 1.0, // Weight is set to 1 for flat rate trip
    rate_per_ton: 45000.0, // Flat Trip Rate
    start_location: 'Pune Plant',
    end_location: 'Chennai Hub',
    odc_charges: 5000.0,
    weight_unit: 'Trip',
    tax_bracket: 12.0, // GTA GST 12%
    return_trip_included: 1, // Yes, return trip is included
    return_trip_rate: 22000.0 // Return trip flat rate
  });
  console.log('Submit Bid Response:', submitRes);
  if (!submitRes.success) {
    throw new Error('Failed to submit transporter bid: ' + submitRes.message);
  }

  // 6. Verify Backend calculation and Comparative Statement details
  console.log('\n6. Fetching Comparative Statement...');
  const compRes = await get(`/api/transport-requests/${requestId}/comparative`);
  if (!compRes.success) {
    throw new Error('Failed to fetch comparative statement: ' + compRes.message);
  }

  const rankings = compRes.data.rankings;
  console.log('Rankings details:', JSON.stringify(rankings, null, 2));

  if (rankings.length === 0) {
    throw new Error('Comparative rankings is empty!');
  }

  const bid = rankings[0];
  console.log('\nAsserting cost calculations...');
  // Expected Final Cost = (rate + odc + returnRate) + GST 12%
  // Final Cost = (45000 + 5000 + 22000) * 1.12 = 80640.0
  const expectedFinalCost = 80640.0;
  console.log(`Expected Final Cost: ₹${expectedFinalCost}`);
  console.log(`Actual Final Cost:   ₹${bid.final_cost}`);
 
  if (bid.final_cost !== expectedFinalCost) {
    throw new Error(`Assertion FAILED: Expected final cost to be ${expectedFinalCost}, but got ${bid.final_cost}`);
  }
  console.log('✅ Final Cost assertion passed!');

  console.log('\nAsserting return trip rates in comparative schema...');
  console.log(`Expected return_trip_included: 1, Actual: ${bid.return_trip_included}`);
  console.log(`Expected return_trip_rate: 22000, Actual: ${bid.return_trip_rate}`);

  if (bid.return_trip_included !== 1 && bid.return_trip_included !== true) {
    throw new Error('Assertion FAILED: return_trip_included is not true/1');
  }
  if (bid.return_trip_rate !== 22000) {
    throw new Error('Assertion FAILED: return_trip_rate is not 22000');
  }
  console.log('✅ Return trip fields assertions passed!');

  console.log('\n=== ALL FLAT-RATE AND RETURN TRIP BIDDING INTEGRATION TESTS PASSED ===');
  process.exit(0);
}

runTest().catch((err) => {
  console.error('\n❌ Integration Test Failed:', err);
  process.exit(1);
});
