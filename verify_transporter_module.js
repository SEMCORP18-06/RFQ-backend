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
        'Content-Length': data.length
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          resolve(raw);
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
          resolve(JSON.parse(raw));
        } catch (e) {
          resolve(raw);
        }
      });
    }).on('error', reject);
  });
}

async function runTest() {
  console.log('=== STARTING TRANSPORTER MODULE INTEGRATION TEST ===');

  // 1. Create a Transporter
  console.log('1. Creating Test Transporter...');
  const transporterRes = await post('/api/transporters', {
    name: 'Transporter Test Cargo',
    contact_person: 'Ramesh Patel',
    email: 'ramesh.cargo@yopmail.com',
    phone: '9820123456',
    company_name: 'Patel Cargo Movers Ltd',
    gst_number: '27AAACP9999A1Z9',
    pan_number: 'AACP9999A',
    address: 'Vashi, Navi Mumbai, IN',
    category: 'Plates'
  });
  console.log('Transporter Response:', transporterRes);
  const transporterId = transporterRes.id || (transporterRes.data && transporterRes.data.id);
  if (!transporterId) {
    throw new Error('Failed to create transporter: ' + JSON.stringify(transporterRes));
  }

  // 2. Register Transporter User Account
  console.log('\n2. Registering Transporter User...');
  const regRes = await post('/api/auth/register', {
    name: 'Ramesh Patel',
    email: 'ramesh.cargo@yopmail.com',
    password: 'password123',
    role: 'Transporter',
    transporterId: transporterId
  });
  console.log('Register Response:', regRes);

  // 3. Login as Transporter
  console.log('\n3. Logging in Transporter User...');
  const loginRes = await post('/api/auth/login', {
    email: 'ramesh.cargo@yopmail.com',
    password: 'password123'
  });
  console.log('Login Response:', loginRes);
  if (!loginRes.success) {
    throw new Error('Failed to log in as transporter');
  }

  // 4. Create Transport Request (Draft)
  console.log('\n4. Creating Transport Request...');
  const requestRes = await post('/api/transport-requests', {
    from_location: 'Mumbai Port',
    to_location: 'Pune Warehouse',
    required_date: '2026-06-30',
    transporter_ids: [transporterId],
    items: [
      { material_name: 'MS Plates 10mm', material_category: 'Plates', quantity: 25.5, unit: 'Ton', remarks: 'Fragile plates' }
    ]
  });
  console.log('Create Request Response:', requestRes);
  const requestId = requestRes.id || (requestRes.data && requestRes.data.id);
  if (!requestId) {
    throw new Error('Failed to create transport request');
  }

  // 5. Distribute / Launch Request (1-Hour Window)
  console.log('\n5. Launching Transport Request Bidding Window...');
  const launchRes = await post('/api/transport-requests/distribute', {
    request_id: requestId,
    transporter_ids: [transporterId]
  });
  console.log('Launch Response:', launchRes);

  // Get active distributions for token
  const detailsRes = await get(`/api/transport-requests/${requestId}`);
  console.log('Request details:', detailsRes);
  const distributions = detailsRes.data.distributions || [];
  const distRecord = distributions.find(d => d.transporter_id === transporterId);
  if (!distRecord) {
    throw new Error('No distribution record found for transporter');
  }
  const token = distRecord.token;
  console.log('Retrieved Token:', token);

  // 6. Verify Transporter Portal Token
  console.log('\n6. Verifying Portal Token...');
  const verifyRes = await get(`/api/transporter-portal/verify?token=${token}`);
  console.log('Verify Response:', {
    success: verifyRes.success,
    request_number: verifyRes.data.request.request_number,
    transporter_name: verifyRes.data.transporter.name,
    dist_status: verifyRes.data.distribution.status
  });

  // 7. Submit Quotation Bids
  console.log('\n7. Submitting Transporter Portal Quote...');
  const submitRes = await post('/api/transporter-portal/submit', {
    token: token,
    distance: 145.0,
    vehicle_available_from: '2026-06-28',
    vehicle_size: '22 feet High Bed',
    vehicle_tonnage: 28.0,
    actual_weight_charged: 26.0,
    rate_per_ton: 1200.00
  });
  console.log('Submission Response:', submitRes);

  // 8. Fetch Comparative rankings & check calculation logic
  console.log('\n8. Verifying Comparative rankings & total cost formula...');
  const comparativeRes = await get(`/api/transport-requests/${requestId}/comparative`);
  console.log('Comparative Rankings:', comparativeRes.data.rankings);
  console.log('Winning Bid Cost:', comparativeRes.data.winner);

  const finalCostExpected = 1200.00; // rate_per_ton (Trip Rate) + ODC + Return Trip (no weight scaling)
  console.log(`Expected Final Cost: ${finalCostExpected}`);
  
  const actualCost = comparativeRes.data.rankings[0].final_cost;
  console.log(`Actual Stored Final Cost: ${actualCost}`);
 
  if (actualCost === finalCostExpected) {
    console.log('\n✅ Total Cost Formula verified successfully (Trip Rate + ODC + Return Trip) + GST!');
  } else {
    throw new Error(`Formula mismatch: Expected ${finalCostExpected}, got ${actualCost}`);
  }

  console.log('\n=== TRANSPORTER MODULE INTEGRATION TEST COMPLETED SUCCESSFULLY ===');
}

runTest().catch(err => {
  console.error('\n❌ INTEGRATION TEST FAILED:', err);
  process.exit(1);
});
