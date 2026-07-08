const http = require('http');
const fs = require('fs');
const path = require('path');

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
  console.log('=== STARTING LIVE RANKING & SUBMISSION ALERT INTEGRATION TEST ===');

  // Verify Frontend Code matches popup alert and dropdown expectations
  console.log('\nChecking index.html for correct submission alerts and comparative dropdown...');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  
  const vendorSubmitAlertMatch = indexHtml.includes("showCustomAlert('Submission Recorded', 'You are not the L1 vendor for this RFQ yet but your participation is highly valued')");
  const transporterSubmitAlertMatch = indexHtml.includes("showCustomAlert('Submission Recorded', 'You are not the L1 vendor for this RFQ yet but your participation is highly valued')");
  const dropdownMatch = indexHtml.includes('id="comparative-rfq-select"');
  const oldChecklistRemoved = !indexHtml.includes('id="comparative-rfqs-checklist"');

  if (!vendorSubmitAlertMatch) {
    console.error('FAIL: Vendor submission alert string not found in index.html');
    process.exit(1);
  }
  if (!transporterSubmitAlertMatch) {
    console.error('FAIL: Transporter submission alert string not found in index.html');
    process.exit(1);
  }
  if (!dropdownMatch) {
    console.error('FAIL: Dropdown id="comparative-rfq-select" not found in index.html');
    process.exit(1);
  }
  if (!oldChecklistRemoved) {
    console.error('FAIL: Old checkbox container id="comparative-rfqs-checklist" was not removed from index.html');
    process.exit(1);
  }
  console.log('PASS: Correct disclaimer popup strings and dropdown elements exist in index.html.');

  // Verify Live Ranking backend verification & email dispatch
  console.log('\nTesting Vendor Bidding Live Ranking logic (Admin gets minimum 2 quotes/bids)...');
  
  // 1. Create 2 test vendors
  const v1 = await post('/api/vendors', { name: 'Vendor One', contact_person: 'A', email: 'v1@yopmail.com', category: 'Raw Materials' });
  const v2 = await post('/api/vendors', { name: 'Vendor Two', contact_person: 'B', email: 'v2@yopmail.com', category: 'Raw Materials' });
  
  const v1Id = v1.id;
  const v2Id = v2.id;
  console.log(`Created Vendors: v1Id=${v1Id}, v2Id=${v2Id}`);

  // 2. Create RFQ
  const rfq = await post('/api/rfqs', {
    rfq_number: 'RFQ-RANK-TEST-001',
    project_name: 'Rank Integration Project',
    available_from: '2020-01-01',
    available_to: '2035-01-01',
    delivery_date: '2026-08-01',
    status: 'Draft',
    items: [
      { item_name: 'Component A', quantity: 100, target_price: 10.0, uom: 'Pcs' }
    ]
  });
  const rfqId = rfq.id;
  console.log(`Created RFQ ID: ${rfqId}`);

  // 3. Dispatch RFQ to both vendors
  await post('/api/rfqs/distribute', { rfq_id: rfqId, vendor_ids: [v1Id, v2Id] });
  console.log('RFQ Dispatched to vendors.');

  // Get tokens
  const rfqDetails = await get(`/api/rfqs/${rfqId}`);
  const dist1 = rfqDetails.data.distributions.find(d => d.vendor_id === v1Id);
  const dist2 = rfqDetails.data.distributions.find(d => d.vendor_id === v2Id);

  const t1 = dist1.token;
  const t2 = dist2.token;
  console.log(`Tokens: t1=${t1.substring(0,10)}..., t2=${t2.substring(0,10)}...`);

  // Verify initially no ranking is shown (since 0 bids are submitted)
  let verify1 = await get(`/api/vendor-portal/verify?token=${t1}`);
  console.log('Initially Verify1 ranking:', verify1.data.ranking);
  if (verify1.data.ranking !== null) {
    console.error('FAIL: Ranking should be null when there are < 2 submitted bids');
    process.exit(1);
  }

  // 4. Submit 1st bid (from Vendor One, cost = 1200)
  console.log('\nSubmitting 1st bid (Vendor One, cost = 1200)...');
  await post('/api/vendor-portal/submit', {
    token: t1,
    quotes: [{ item_id: rfqDetails.data.items[0].id, rate: 12.0, lead_time: 5, remarks: '', payment_terms: '' }],
    final_submit: true,
    final_cost: 1200
  });

  // Verify still no ranking is shown (since only 1 bid is submitted)
  verify1 = await get(`/api/vendor-portal/verify?token=${t1}`);
  console.log('After 1 bid Verify1 ranking:', verify1.data.ranking);
  if (verify1.data.ranking !== null) {
    console.error('FAIL: Ranking should be null when only 1 bid is submitted');
    process.exit(1);
  }

  // 5. Submit 2nd bid (from Vendor Two, cost = 1000 - makes it L1)
  console.log('\nSubmitting 2nd bid (Vendor Two, cost = 1000)...');
  await post('/api/vendor-portal/submit', {
    token: t2,
    quotes: [{ item_id: rfqDetails.data.items[0].id, rate: 10.0, lead_time: 4, remarks: '', payment_terms: '' }],
    final_submit: true,
    final_cost: 1000
  });

  // Verify ranking is now shown for both (since total bids >= 2)
  verify1 = await get(`/api/vendor-portal/verify?token=${t1}`);
  let verify2 = await get(`/api/vendor-portal/verify?token=${t2}`);

  console.log('After 2 bids Verify1 ranking:', verify1.data.ranking);
  console.log('After 2 bids Verify2 ranking:', verify2.data.ranking);

  if (!verify1.data.ranking || verify1.data.ranking.rank !== 2 || verify1.data.ranking.total_bids !== 2 || verify1.data.ranking.is_l1 !== false) {
    console.error('FAIL: Vendor One ranking stats incorrect', verify1.data.ranking);
    process.exit(1);
  }
  if (!verify2.data.ranking || verify2.data.ranking.rank !== 1 || verify2.data.ranking.total_bids !== 2 || verify2.data.ranking.is_l1 !== true) {
    console.error('FAIL: Vendor Two ranking stats incorrect', verify2.data.ranking);
    process.exit(1);
  }

  console.log('PASS: Vendor Portal Live Ranking integration works correctly!');
  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Unexpected error running integration test:', err);
  process.exit(1);
});
