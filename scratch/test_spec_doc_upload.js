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

// Helper to simulate multipart/form-data upload using standard Node http
function uploadFile(pathUrl, token, fileContent, filename) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    let header = `--${boundary}\r\n`;
    header += `Content-Disposition: form-data; name="token"\r\n\r\n${token}\r\n`;
    header += `--${boundary}\r\n`;
    header += `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`;
    header += `Content-Type: text/plain\r\n\r\n`;
    
    const footer = `\r\n--${boundary}--\r\n`;
    
    const req = http.request({
      hostname: '127.0.0.1',
      port: 5000,
      path: pathUrl,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { resolve(raw); }
      });
    });
    
    req.on('error', reject);
    req.write(header);
    req.write(fileContent);
    req.write(footer);
    req.end();
  });
}

function attachExcel(rfqId, fileContent, filename) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    let header = `--${boundary}\r\n`;
    header += `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`;
    header += `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`;
    
    const footer = `\r\n--${boundary}--\r\n`;
    
    const req = http.request({
      hostname: '127.0.0.1',
      port: 5000,
      path: `/api/rfqs/${rfqId}/attach-excel`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { resolve(raw); }
      });
    });
    
    req.on('error', reject);
    req.write(header);
    req.write(fileContent);
    req.write(footer);
    req.end();
  });
}


async function runTest() {
  console.log('=== STARTING RFQ SPEC SHEET GATING & VENDOR DOC UPLOAD INTEGRATION TEST ===');

  // 1. Create a test vendor
  console.log('\nCreating Test Vendor...');
  const v = await post('/api/vendors', { name: 'Sierra Test Vendor', contact_person: 'Subhash', email: 'subhash.l1@yopmail.com', category: 'Raw Materials' });
  const vId = v.id;
  console.log(`Created Vendor ID: ${vId}`);

  // 2. Create RFQ with allow_spec_sheet = 0 (default/opt-out)
  console.log('\nCreating RFQ with allow_spec_sheet = 0 (Opt-out)...');
  const rfq1 = await post('/api/rfqs', {
    project_name: 'Spec Gating Test Project 1',
    available_from: '2020-01-01',
    available_to: '2035-01-01',
    delivery_date: '2026-09-01',
    status: 'Draft',
    items: [{ moc: 'MS', description: 'Gating test item 1', size: '10 inch', quantity: 2, unit: 'Nos' }],
    vendor_ids: [vId],
    allow_spec_sheet: 0
  });
  console.log(`Created RFQ 1 ID: ${rfq1.id}`);

  // 3. Create RFQ with allow_spec_sheet = 1 (opt-in)
  console.log('\nCreating RFQ with allow_spec_sheet = 1 (Opt-in)...');
  const rfq2 = await post('/api/rfqs', {
    project_name: 'Spec Gating Test Project 2',
    available_from: '2020-01-01',
    available_to: '2035-01-01',
    delivery_date: '2026-09-01',
    status: 'Draft',
    items: [{ moc: 'MS', description: 'Gating test item 2', size: '12 inch', quantity: 5, unit: 'Nos' }],
    vendor_ids: [vId],
    allow_spec_sheet: 1
  });
  console.log(`Created RFQ 2 ID: ${rfq2.id}`);

  // Attach Excel file to RFQ 2
  console.log('\nAttaching Excel specification sheet to RFQ 2...');
  const attachRes = await attachExcel(rfq2.id, 'Test Excel Sheet Data', 'spec_sheet_final.xlsx');
  console.log('Attach Excel Result:', attachRes);
  if (!attachRes.success || attachRes.filename !== 'spec_sheet_final.xlsx') {
    throw new Error(`Failed to attach excel sheet: ${JSON.stringify(attachRes)}`);
  }
  console.log('PASS: Attached Excel sheet successfully.');

  // 4. Distribute/launch both RFQs to get tokens
  console.log('\nFetching tokens for launched RFQs...');
  const detailsRfq1 = await get(`/api/rfqs/${rfq1.id}`);
  const detailsRfq2 = await get(`/api/rfqs/${rfq2.id}`);
  
  const token1 = detailsRfq1.data.distributions.find(d => d.vendor_id === vId).token;
  const token2 = detailsRfq2.data.distributions.find(d => d.vendor_id === vId).token;
  console.log(`Token for RFQ1: ${token1}`);
  console.log(`Token for RFQ2: ${token2}`);

  // 5. Verify verify-portal responses for allow_spec_sheet value
  console.log('\nVerifying portal data for RFQ1 (expect allow_spec_sheet = 0)...');
  const details1 = await get(`/api/vendor-portal/verify?token=${token1}`);
  if (details1.data.rfq.allow_spec_sheet !== 0) {
    throw new Error(`Expected allow_spec_sheet to be 0 for RFQ1, got: ${details1.data.rfq.allow_spec_sheet}`);
  }
  console.log('PASS: allow_spec_sheet is 0 for RFQ1.');

  console.log('\nVerifying portal data for RFQ2 (expect allow_spec_sheet = 1 and excel_filename = spec_sheet_final.xlsx)...');
  const details2 = await get(`/api/vendor-portal/verify?token=${token2}`);
  if (details2.data.rfq.allow_spec_sheet !== 1) {
    throw new Error(`Expected allow_spec_sheet to be 1 for RFQ2, got: ${details2.data.rfq.allow_spec_sheet}`);
  }
  if (details2.data.excel_filename !== 'spec_sheet_final.xlsx') {
    throw new Error(`Expected excel_filename to be spec_sheet_final.xlsx, got: ${details2.data.excel_filename}`);
  }
  console.log('PASS: allow_spec_sheet is 1 and excel_filename is correct for RFQ2.');

  // 6. Test vendor document upload for RFQ2
  console.log('\nUploading vendor document for RFQ2...');
  const uploadResult = await uploadFile('/api/vendor-portal/upload-doc', token2, 'Test content catalog doc', 'catalog.pdf');
  console.log('Upload Result:', uploadResult);
  if (!uploadResult.success) {
    throw new Error(`Upload failed: ${uploadResult.message}`);
  }

  // 7. Verify fields stored in DB via verify endpoint
  console.log('\nVerifying portal data after upload...');
  const detailsAfterUpload = await get(`/api/vendor-portal/verify?token=${token2}`);
  const vendorData = detailsAfterUpload.data.vendor;
  console.log('Vendor distribution data:', vendorData);
  if (vendorData.vendor_doc_name !== 'catalog.pdf') {
    throw new Error(`Expected stored filename to be catalog.pdf, got: ${vendorData.vendor_doc_name}`);
  }
  if (!vendorData.vendor_doc_path) {
    throw new Error('Expected vendor_doc_path to be non-empty');
  }
  if (!fs.existsSync(vendorData.vendor_doc_path)) {
    throw new Error(`Uploaded file not found at path: ${vendorData.vendor_doc_path}`);
  }
  console.log('PASS: Supporting document uploaded and saved correctly.');

  // 8. Call final submission and ensure it notifies admin successfully
  console.log('\nSubmitting vendor quotation (final)...');
  const items2 = details2.data.items.map(i => ({ item_id: i.id, rate: 100, lead_time: 5, remarks: 'looks good', payment_terms: '' }));
  
  const submitResult = await post('/api/vendor-portal/submit', {
    token: token2,
    quotes: items2,
    final_submit: true,
    final_cost: 500,
    cgst_applicable: true,
    sgst_applicable: true,
    transport_included: 0,
    payment_terms: '30 days net'
  });
  console.log('Submit Result:', submitResult);
  if (!submitResult.success) {
    throw new Error(`Quotation submit failed: ${submitResult.message}`);
  }
  console.log('PASS: Bidding submission and email dispatch succeeded!');

  // Cleanup uploaded file
  try { fs.unlinkSync(vendorData.vendor_doc_path); } catch (_) {}
  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
}

runTest().catch(err => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
