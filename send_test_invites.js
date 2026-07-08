/**
 * send_test_invites_v2.js
 * Updated Platform Invite email with:
 * - SEMCO logo (base64 embedded)
 * - Removed "What is the Platform" section
 * - Fixed numbered circles (table-based layout)
 * - Font size +2pt throughout body
 * - Vendor/Transporter specific Step 3 & 4 content
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const smtpTransporter = nodemailer.createTransport({
  host: 'smtp.office365.com',
  port: 587,
  secure: false,
  auth: {
    user: 'umesh.p@semcogroups.com',
    pass: 'U@$emco@111'
  },
  tls: {
    ciphers: 'SSLv3',
    rejectUnauthorized: false
  }
});

// Check if logo exists
const logoPath = path.join(__dirname, 'semco-logo-new.png');
const LOGO_SRC = fs.existsSync(logoPath) ? 'cid:semco_logo' : null;

const TEST_RECIPIENTS = [
  { name: 'Mrunal Pathak',    contact_person: 'Mrunal Pathak',    email: 'mrunalpathak9441@gmail.com', type: 'vendor' },
  { name: 'Mrunal (Alt)',     contact_person: 'Mrunal',            email: 'mrunn28@gmail.com',           type: 'transporter' },
  { name: 'Divyansh Agarwal', contact_person: 'Divyansh Agarwal',  email: 'divyansh.agarwal900@gmail.com', type: 'vendor' }
];

async function sendMail(to, subject, html) {
  try {
    const attachments = [];
    if (html.includes('cid:semco_logo') && fs.existsSync(logoPath)) {
      attachments.push({
        filename: 'semco-logo-new.png',
        path: logoPath,
        cid: 'semco_logo'
      });
    }
    await smtpTransporter.sendMail({
      from: '"SEMCO Groups" <umesh.p@semcogroups.com>',
      to,
      subject,
      html,
      attachments
    });
    console.log(`  ✅  Sent → ${to}`);
    return true;
  } catch (err) {
    console.error(`  ❌  Failed → ${to}: ${err.message}`);
    return false;
  }
}

function buildEmail(contactName, type = 'vendor') {
  const isVendor     = type === 'vendor';
  const portalType   = isVendor ? 'Vendor' : 'Transporter';
  const accentColor  = isVendor ? '#2563eb' : '#0891b2';
  const headerGrad   = isVendor
    ? 'linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%)'
    : 'linear-gradient(135deg,#0f172a 0%,#164e63 100%)';
  const year = new Date().getFullYear();

  // Steps — Step 3 & 4 are distinct per type
  const steps = [
    {
      num: '1',
      title: 'Receive a Secure Portal Link',
      desc: isVendor
        ? 'When SEMCO raises a Request for Quotation (RFQ) and selects you as a partner, you will receive an automated email with a <strong>unique, secure portal link</strong> exclusively assigned to you. Each link is valid only for the duration of the bidding window.'
        : 'When SEMCO raises a Transport Bid Request and selects you as a logistics partner, you will receive an automated email with a <strong>unique, secure portal link</strong> exclusively assigned to you. Each link is valid only for the duration of the bidding window.'
    },
    {
      num: '2',
      title: 'Access Your Personalised Portal',
      desc: isVendor
        ? 'Click the link in your email to instantly open your <strong>Vendor Portal</strong>. No username or password is required — your link is your secure key. The portal will display the full RFQ with all item details.'
        : 'Click the link in your email to instantly open your <strong>Transporter Portal</strong>. No username or password is required — your link is your secure key. The portal will display the full transport request with all route and material details.'
    },
    {
      num: '3',
      title: 'Review the Request Details',
      desc: isVendor
        ? 'Carefully go through each line item in the RFQ including the <strong>Material of Construction (MOC)</strong>, item description, size, quantity, unit, and required delivery date. Ensure you can supply the exact specifications listed before submitting your rates.'
        : 'Carefully review the <strong>from and to locations</strong>, material name, category, weight/quantity, unit, and any special remarks. Also note the required delivery date and the vehicle type and tonnage specified by SEMCO for the movement.'
    },
    {
      num: '4',
      title: isVendor ? 'Submit Your Quotation' : 'Submit Your Bid',
      desc: isVendor
        ? 'Enter your <strong>unit rate (₹)</strong> for each line item and specify the <strong>lead time in days</strong>. Indicate whether CGST and SGST are applicable, and provide transport cost breakup (Packaging &amp; Forwarding, Freight, Loading, Other charges) if not included in the rate. Add any remarks and click <strong>Submit Quotation</strong> to confirm.'
        : 'Enter your <strong>rate per ton or per trip</strong>, specify your <strong>vehicle availability date</strong>, and confirm the vehicle size and tonnage you will deploy. Add any operational remarks and click <strong>Submit Bid</strong> to confirm your transport quote.'
    },
    {
      num: '5',
      title: 'Await Our Response',
      desc: 'Our procurement team will evaluate all received bids and get in touch with the selected partner. All submissions are treated with <strong>strict confidentiality</strong>.'
    }
  ];

  // Build step rows using table for reliable email rendering
  const stepsHtml = steps.map(s => `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:18px;">
      <tr>
        <td width="44" valign="top">
          <table border="0" cellpadding="0" cellspacing="0">
            <tr>
              <td width="36" height="36" align="center" valign="middle"
                  style="background-color:${accentColor};border-radius:50%;color:#ffffff;font-size:15px;font-weight:700;line-height:36px;text-align:center;font-family:'Segoe UI',Arial,sans-serif;">
                ${s.num}
              </td>
            </tr>
          </table>
        </td>
        <td valign="top" style="padding-left:12px;">
          <div style="font-weight:700;font-size:15px;color:#1e293b;margin-bottom:4px;font-family:'Segoe UI',Arial,sans-serif;">${s.title}</div>
          <div style="font-size:15px;color:#475569;line-height:1.65;font-family:'Segoe UI',Arial,sans-serif;">${s.desc}</div>
        </td>
      </tr>
    </table>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Welcome to SEMCO Smart RFQ Platform</title>
</head>
<body style="margin:0;padding:20px;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);border:1px solid #e2e8f0;">

    <!-- HEADER -->
    <div style="background:${headerGrad};padding:32px 32px 24px;text-align:center;">
      ${LOGO_SRC ? `<img src="${LOGO_SRC}" alt="SEMCO Groups" width="220" style="display:block;margin:0 auto 16px;max-width:220px;height:auto;" />` : `<div style="color:#ffffff;font-size:24px;font-weight:700;margin-bottom:12px;letter-spacing:-0.5px;font-family:'Segoe UI',Arial,sans-serif;">SEMCO Groups</div>`}
      <div style="display:inline-block;background:#f59e0b;color:#fff;font-size:12px;font-weight:700;padding:4px 16px;border-radius:20px;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px;">Smart RFQ e-Procurement Platform</div>
      <h2 style="color:#ffffff;margin:8px 0 4px;font-size:18px;font-weight:600;font-family:'Segoe UI',Arial,sans-serif;">Welcome, ${contactName}!</h2>
      <p style="color:rgba(255,255,255,0.6);margin:0;font-size:14px;font-family:'Segoe UI',Arial,sans-serif;">You have been registered as a ${portalType} Partner on our platform.</p>
    </div>

    <!-- BODY -->
    <div style="padding:32px;">

      <!-- Greeting -->
      <p style="font-size:16px;color:#1e293b;line-height:1.75;margin-top:0;font-family:'Segoe UI',Arial,sans-serif;">
        Dear <strong>${contactName}</strong>,<br><br>
        We are pleased to inform you that <strong>SEMCO Groups</strong> has onboarded you as a valued <strong>${portalType} Partner</strong> on our <strong>Smart RFQ e-Procurement Platform</strong> — a dedicated digital portal designed to streamline the ${isVendor ? 'procurement quoting' : 'logistics and freight bidding'} process.
      </p>

      <!-- Walkthrough heading -->
      <div style="border-bottom:2px solid #f1f5f9;margin-bottom:20px;padding-bottom:10px;">
        <span style="font-size:16px;font-weight:700;color:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">🚀&nbsp; How You Will Operate Your ${portalType} Portal</span>
      </div>

      <!-- Steps -->
      ${stepsHtml}

      <!-- BIDDING DEADLINE POLICY -->
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0;background:#fff7ed;border:2px solid #f97316;border-radius:10px;">
        <tr>
          <td style="padding:18px 20px;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td width="36" valign="top" style="font-size:22px;line-height:1;padding-right:12px;">⚠️</td>
                <td valign="top">
                  <div style="font-weight:700;font-size:15px;color:#c2410c;margin-bottom:8px;font-family:'Segoe UI',Arial,sans-serif;">Important — Bidding Deadline Policy</div>
                  <p style="margin:0 0 10px;font-size:15px;color:#7c2d12;line-height:1.65;font-family:'Segoe UI',Arial,sans-serif;">
                    Each ${isVendor ? 'RFQ' : 'bid request'} issued by SEMCO carries a <strong>strict submission deadline</strong>. Please note:
                  </p>
                  <table border="0" cellpadding="4" cellspacing="0" style="font-size:15px;color:#7c2d12;font-family:'Segoe UI',Arial,sans-serif;">
                    <tr><td valign="top" style="padding-right:8px;">•</td><td>All bids <strong>must be submitted within the allotted time frame</strong> specified in the portal.</td></tr>
                    <tr><td valign="top" style="padding-right:8px;">•</td><td><strong>No bids will be accepted after the deadline has passed.</strong> The portal closes automatically once the deadline expires.</td></tr>
                    <tr><td valign="top" style="padding-right:8px;">•</td><td>You will receive <strong>automated reminder emails</strong> when 1 hour and 30 minutes are remaining.</td></tr>
                    <tr><td valign="top" style="padding-right:8px;">•</td><td>Please submit your bid <strong>well before the deadline</strong> to avoid any last-minute issues.</td></tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Upcoming Notice -->
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;">
        <tr>
          <td style="padding:18px 20px;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td width="36" valign="top" style="font-size:20px;padding-right:10px;">📨</td>
                <td valign="top">
                  <div style="font-weight:700;font-size:15px;color:#166534;margin-bottom:4px;font-family:'Segoe UI',Arial,sans-serif;">Upcoming Requests</div>
                  <div style="font-size:15px;color:#15803d;line-height:1.65;font-family:'Segoe UI',Arial,sans-serif;">
                    You will be receiving ${isVendor ? 'RFQ (Request for Quotation)' : 'transport bid'} requests from us <strong>very soon</strong>. Please ensure your registered email is active and check your inbox regularly so you do not miss any opportunities.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Support -->
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <tr>
          <td style="padding:16px 18px;font-size:15px;color:#475569;font-family:'Segoe UI',Arial,sans-serif;">
            <strong style="color:#1e293b;">Need Help?</strong><br>
            If you have any questions about using the platform or your registration, please reach out to our procurement team:<br>
            <span style="color:${accentColor};font-weight:600;">📧 umesh.p@semcogroups.com</span>
          </td>
        </tr>
      </table>

    </div>

    <!-- FOOTER -->
    <div style="background:#0f172a;padding:18px 24px;text-align:center;">
      <p style="color:#ffffff;font-size:12px;margin:0 0 4px;font-family:'Segoe UI',Arial,sans-serif;">© ${year} SEMCO Groups. All rights reserved.</p>
      <p style="color:#ffffff;font-size:12px;margin:0;font-family:'Segoe UI',Arial,sans-serif;">This is an automated email from the SEMCO Smart RFQ e-Procurement Platform. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   SEMCO — Platform Invite v2 Test Emails             ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  console.log('🔌 Verifying SMTP connection...');
  try {
    await smtpTransporter.verify();
    console.log('  ✅  SMTP connection verified\n');
  } catch (err) {
    console.error('  ❌  SMTP connection failed:', err.message);
    process.exit(1);
  }

  let sent = 0, failed = 0;

  for (const r of TEST_RECIPIENTS) {
    const isVendor = r.type === 'vendor';
    const randId = Math.floor(1000 + Math.random() * 9000);
    const subject = isVendor
      ? `Welcome to SEMCO Smart RFQ Platform — Vendor Portal Guide [Ref #${randId}]`
      : `Welcome to SEMCO Smart RFQ Platform — Transporter Portal Guide [Ref #${randId}]`;
    console.log(`📧  Sending to: ${r.name} <${r.email}> [${r.type}]`);
    const html = buildEmail(r.contact_person, r.type);
    const ok = await sendMail(r.email, subject, html);
    if (ok) sent++; else failed++;
    await new Promise(res => setTimeout(res, 800));
  }

  console.log('\n──────────────────────────────────────');
  console.log(`  ✅  Sent:   ${sent}`);
  console.log(`  ❌  Failed: ${failed}`);
  console.log('──────────────────────────────────────\n');
}

main();
