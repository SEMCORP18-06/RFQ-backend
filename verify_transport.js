const dns = require('dns');

// Configure custom DNS resolvers to ensure MongoDB Atlas SRV resolution works in restricted environments
try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (e) {}

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
  console.log('=== STARTING TRANSPORT COST INTEGRATION TEST ===');

  // 1. Create a Vendor
  console.log('Creating Test Vendor...');
  const vendorRes = await post('/api/vendors', {
    name: 'Transport Test Vendor',
    contact_person: 'Mrunal Pathak',
    email: 'mrunal.transport@yopmail.com',
    phone: '9876543210',
    company_name: 'Transport Logistics Ltd',
    category: 'Logistics',
    address: 'Mumbai, IN'
  });
  console.log('Vendor Response:', vendorRes);
  const vendorId = vendorRes.id || (vendorRes.data && vendorRes.data.id);

  // 1b. Register Vendor User
  console.log('Registering Vendor User...');
  const regRes = await post('/api/auth/register', {
    name: 'Transport Test Vendor',
    email: 'mrunal.transport@yopmail.com',
    password: 'password123',
    role: 'Vendor',
    vendorId: vendorId
  });
  console.log('Register Response:', regRes);

  // 2. Create an RFQ
  console.log('Creating Test RFQ...');
  const rfqRes = await post('/api/rfqs', {
    rfq_date: '2026-06-22',
    delivery_date: '2026-06-30',
    project_name: 'Transport Validation Project',
    department: 'Logistics',
    buyer_name: 'Procurement Admin',
    items: [
      { moc: 'SS 304', description: 'Tubes', size: '2 inch', quantity: 10, unit: 'Nos' }
    ],
    vendor_ids: [vendorId]
  });
  console.log('RFQ Response:', rfqRes);
  const rfqId = rfqRes.id || (rfqRes.data && rfqRes.data.id);

  // 3. Distribute RFQ
  console.log('Distributing RFQ...');
  const distRes = await post('/api/rfqs/distribute', {
    rfq_id: rfqId,
    vendor_ids: [vendorId]
  });
  console.log('Distribution Response:', distRes);
  const token = distRes.data[0].portal_url.split('token=')[1] || distRes.data[0].portal_url.split('vendor_id=')[1];

  // 4. Verify Vendor Portal verification returns correct structure
  console.log('Verifying Portal Link...');
  const verifyRes = await get(`/api/vendor-portal/verify?token=${token}`);
  console.log('Verify Response (Vendor Status & Fields):', {
    vendor_name: verifyRes.data.vendor.name,
    transport_included: verifyRes.data.vendor.transport_included,
    transport_packaging: verifyRes.data.vendor.transport_packaging
  });

  // 5. Submit rates including transport cost breakup details
  console.log('Submitting Rates with Transport Breakup...');
  const item_id = verifyRes.data.items[0].id;
  const submitRes = await post('/api/vendor-portal/submit', {
    token: token,
    final_submit: true,
    final_cost: 1550.00, // Total cost
    cgst_applicable: 1,
    sgst_applicable: 1,
    transport_included: 1,
    transport_packaging: 50.00,
    transport_freight: 150.00,
    transport_loading: 30.00,
    transport_other: 20.00,
    quotes: [
      { item_id: item_id, rate: 130.00, lead_time: 5, remarks: 'Delivered' }
    ]
  });
  console.log('Submit Response:', submitRes);

  // 6. Check comparative statement output
  console.log('Checking Comparative Statement details...');
  const compRes = await get(`/api/rfqs/${rfqId}/comparative`);
  console.log('Comparative rankings output (including transport):', compRes.data.rankings);

  // 7. Check submissions list
  console.log('Checking Vendor Submissions list...');
  const subRes = await get(`/api/submissions`);
  console.log('Submitted quotes transport breakup check:', subRes.data.map(q => ({
    vendor_name: q.vendor_name,
    rfq_number: q.rfq_number,
    final_cost: q.final_cost,
    transport_included: q.transport_included,
    transport_packaging: q.transport_packaging,
    transport_freight: q.transport_freight,
    transport_loading: q.transport_loading,
    transport_other: q.transport_other
  })));

  console.log('=== INTEGRATION TEST FINISHED ===');
}

runTest().catch(console.error);
