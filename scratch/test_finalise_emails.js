const http = require('http');

function post(pathUrl, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 5000,
      path: pathUrl,
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

function get(pathUrl) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:5000${pathUrl}`, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { resolve(raw); }
      });
    }).on('error', reject);
  });
}

async function runTest() {
  console.log('=== STARTING RFQ FINALISE & EMAIL TRIGGER INTEGRATION TEST ===');

  // 1. Create 2 test vendors
  console.log('\nCreating Test Vendors...');
  const v1 = await post('/api/vendors', { name: 'Alpha Selected L1 Vendor', contact_person: 'Subhash', email: 'subhash.l1@yopmail.com', category: 'Raw Materials' });
  const v2 = await post('/api/vendors', { name: 'Beta Non-Selected Vendor', contact_person: 'Devendra', email: 'devendra.nonl1@yopmail.com', category: 'Raw Materials' });
  
  const v1Id = v1.id;
  const v2Id = v2.id;
  console.log(`Created Vendors: v1Id=${v1Id}, v2Id=${v2Id}`);

  // 2. Create RFQ
  console.log('\nCreating Test RFQ...');
  const rfq = await post('/api/rfqs', {
    rfq_number: 'RFQ-FIN-TEST-002',
    project_name: 'Finalisation Email Integration Project',
    available_from: '2020-01-01',
    available_to: '2035-01-01',
    delivery_date: '2026-09-01',
    status: 'Draft',
    items: [
      { item_name: 'Industrial Bolt X', quantity: 50, target_price: 20.0, uom: 'Pcs' }
    ]
  });
  const rfqId = rfq.id;
  console.log(`Created RFQ ID: ${rfqId}`);

  // 3. Dispatch RFQ to both vendors
  console.log('\nDistributing RFQ...');
  await post('/api/rfqs/distribute', { rfq_id: rfqId, vendor_ids: [v1Id, v2Id] });

  // Get tokens
  const rfqDetails = await get(`/api/rfqs/${rfqId}`);
  const dist1 = rfqDetails.data.distributions.find(d => d.vendor_id === v1Id);
  const dist2 = rfqDetails.data.distributions.find(d => d.vendor_id === v2Id);

  const t1 = dist1.token;
  const t2 = dist2.token;

  // 4. Submit L1 bid (Vendor One, cost = 1000)
  console.log('\nSubmitting bid for Vendor One (L1, cost = 1000)...');
  await post('/api/vendor-portal/submit', {
    token: t1,
    quotes: [{ item_id: rfqDetails.data.items[0].id, rate: 20.0, lead_time: 5, remarks: '', payment_terms: 'Partial advance' }],
    final_submit: true,
    final_cost: 1000
  });

  // 5. Submit Non-L1 bid (Vendor Two, cost = 1200)
  console.log('\nSubmitting bid for Vendor Two (Non-L1, cost = 1200)...');
  await post('/api/vendor-portal/submit', {
    token: t2,
    quotes: [{ item_id: rfqDetails.data.items[0].id, rate: 24.0, lead_time: 6, remarks: '', payment_terms: 'Net 30' }],
    final_submit: true,
    final_cost: 1200
  });

  // 6. Post finalise endpoint /api/rfqs/:id/finalise
  console.log('\nCalling RFQ finalise API...');
  const finaliseRes = await post(`/api/rfqs/${rfqId}/finalise`, {});
  console.log('Finalise API Response:', finaliseRes);

  if (!finaliseRes.success) {
    console.error('FAIL: Finalise API returned failure status');
    process.exit(1);
  }

  if (finaliseRes.data.l1_winner !== 'Alpha Selected L1 Vendor') {
    console.error(`FAIL: Expected winner to be "Alpha Selected L1 Vendor", got "${finaliseRes.data.l1_winner}"`);
    process.exit(1);
  }

  if (!finaliseRes.data.notified || finaliseRes.data.notified.length !== 1 || finaliseRes.data.notified[0] !== 'Beta Non-Selected Vendor') {
    console.error('FAIL: Expected "Beta Non-Selected Vendor" to be in notified array', finaliseRes.data.notified);
    process.exit(1);
  }

  console.log('\nPASS: RFQ finalise L1 winner notification and consideration emails triggered successfully!');
  console.log('=== ALL TESTS PASSED SUCCESSFULLY! ===');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Unexpected error running integration test:', err);
  process.exit(1);
});
