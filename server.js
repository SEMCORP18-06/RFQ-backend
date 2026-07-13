/**
 * SEMCO Smart RFQ AI Agent — Production Backend Server
 * =====================================================
 * Express.js  +  better-sqlite3  +  SendGrid  +  Multer
 *
 * Quick start:
 *   npm install && node server.js
 *   Open http://localhost:5000
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('./db');
const jwt = require('jsonwebtoken');
const sgMail = require('@sendgrid/mail');
const multer = require('multer');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
require('dotenv').config();

// ═══════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'semco_smart_rfq_jwt_secure_key_2026';

const getFrontendUrl = (req) => {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  if (req && req.headers.origin) {
    return req.headers.origin;
  }
  if (req && req.headers.referer) {
    try {
      const refUrl = new URL(req.headers.referer);
      return `${refUrl.protocol}//${refUrl.host}`;
    } catch (_) {}
  }
  return 'https://semcogroupsrfq.vercel.app';
};

// ─── Directories ─────────────────────────────────────────
const DB_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
[DB_DIR, UPLOAD_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ─── Database (better-sqlite3 — synchronous, reliable) ───
const db = new Database(path.join(DB_DIR, 'semco-rfq.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── SendGrid ────────────────────────────────────────────
let sendgridReady = false;
if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_API_KEY.startsWith('SG.')) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  sendgridReady = true;
  console.log('[SendGrid] API key configured.');
} else {
  console.warn('[SendGrid] No valid API key — running in simulation mode.');
}

// ─── SMTP Transporter ────────────────────────────────────
const smtpTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.office365.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER || 'umesh.p@semcogroups.com',
    pass: process.env.SMTP_PASS || 'U@$emco@111'
  },
  tls: {
    ciphers: 'SSLv3',
    rejectUnauthorized: false
  }
});

async function sendMailViaSmtp(to, subject, html, attachmentPath = null, attachmentName = null) {
  try {
    const attachments = [];
    if (html.includes('cid:semco_logo')) {
      const logoPath = path.join(__dirname, 'semco-logo-new.png');
      if (fs.existsSync(logoPath)) {
        attachments.push({
          filename: 'semco-logo-new.png',
          path: logoPath,
          cid: 'semco_logo'
        });
      }
    }
    if (attachmentPath) {
      if (Array.isArray(attachmentPath)) {
        attachmentPath.forEach((p, idx) => {
          if (p && fs.existsSync(p)) {
            const name = (Array.isArray(attachmentName) && attachmentName[idx]) || (typeof attachmentName === 'string' ? attachmentName : path.basename(p));
            attachments.push({
              filename: name,
              path: p
            });
          }
        });
      } else if (fs.existsSync(attachmentPath)) {
        attachments.push({
          filename: attachmentName || 'RFQ_Attachment.xlsx',
          path: attachmentPath
        });
      }
    }
    await smtpTransporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || 'SEMCO Groups'}" <${process.env.SMTP_USER || 'umesh.p@semcogroups.com'}>`,
      to: to,
      subject: subject,
      html: html,
      attachments: attachments
    });
    console.log(`[SMTP] Email successfully sent to ${to}`);
    return true;
  } catch (error) {
    console.error(`[SMTP Error] Failed to send email to ${to}:`, error.message);
    return false;
  }
}
function formatDateDDMMYYYY(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return `${parts[0]}/${parts[1]}/${parts[2]}`;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const pad = (n) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

async function notifyLiveRankingsForRFQ(rfqId) {
  try {
    const rfq = db.prepare('SELECT rfq_number, project_name FROM rfqs WHERE id = ?').get(rfqId);
    if (!rfq) return;

    // Fetch all submitted distributions for this RFQ, ordered by final_cost ascending
    const allDists = db.prepare(`
      SELECT d.*, v.name as vendor_name, v.email as vendor_email
      FROM rfq_distributions d
      JOIN vendors v ON d.vendor_id = v.id
      WHERE d.rfq_id = ?
    `).all(rfqId);

    const submittedDists = allDists
      .filter(d => d.status === 'Submitted')
      .sort((a, b) => (parseFloat(a.final_cost) || 0) - (parseFloat(b.final_cost) || 0));

    const totalBids = submittedDists.length;
    if (totalBids < 2) return; // Minimum 2 bids required

    console.log(`[Ranking Update] Sending rank notifications to ${totalBids} vendors for RFQ ${rfq.rfq_number}...`);

    for (let i = 0; i < totalBids; i++) {
      const dist = submittedDists[i];
      const rank = i + 1;
      const isL1 = rank === 1;
      const rankText = `#${rank} of ${totalBids}`;
      
      const subject = `[Rank Update] Live Ranking Alert: RFQ ${rfq.rfq_number}`;
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #f8fafc;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #0f172a; margin: 0;">SEMCO Procurement Portal</h2>
            <p style="color: #64748b; font-size: 14px; margin: 5px 0 0 0;">Live Bidding Updates & Rankings</p>
          </div>
          <div style="background-color: #ffffff; padding: 20px; border-radius: 6px; border: 1px solid #cbd5e1;">
            <p style="color: #334155; font-size: 15px;">Dear <strong>${dist.vendor_name}</strong>,</p>
            <p style="color: #334155; font-size: 15px; line-height: 1.5;">
              A new bid was submitted for <strong>RFQ ${rfq.rfq_number}</strong> (${rfq.project_name}). 
              As a result, the live bidding rankings have been recalculated.
            </p>
            <div style="margin: 20px 0; padding: 15px; background-color: ${isL1 ? '#dcfce7' : '#f1f5f9'}; border-left: 5px solid ${isL1 ? '#22c55e' : '#3b82f6'}; border-radius: 4px;">
              <span style="font-size: 14px; color: #475569; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Your Current Live Rank</span>
              <div style="font-size: 32px; font-weight: 800; color: ${isL1 ? '#15803d' : '#1e3a8a'}; margin-top: 5px;">
                ${rankText}
              </div>
              <p style="margin: 5px 0 0 0; font-size: 13px; color: #475569;">
                ${isL1 ? '🎉 You are currently the L1 (Lowest Cost) bidder!' : 'Keep bidding to optimize your pricing and improve your rank.'}
              </p>
            </div>
            <p style="color: #334155; font-size: 14px; line-height: 1.5;">
              You can access your bidding workspace and view your live rankings at any time using your secure link.
            </p>
          </div>
          <div style="text-align: center; margin-top: 20px; font-size: 11px; color: #94a3b8;">
            This is an automated notification from SEMCO Procurement System.<br>
            For support, contact us at umesh.p@semcogroups.com.
          </div>
        </div>
      `;

      await sendMailViaSmtp(dist.vendor_email, subject, emailHtml);
    }
  } catch (err) {
    console.error("Error sending vendor ranking email notifications:", err);
  }
}

async function notifyLiveRankingsForTransportRequest(requestId) {
  try {
    const reqItem = db.prepare('SELECT request_number, from_location, to_location FROM transport_requests WHERE id = ?').get(requestId);
    if (!reqItem) return;

    // Fetch all submitted transport distributions, ordered by final_cost ascending
    const allDists = db.prepare(`
      SELECT d.*, t.name as transporter_name, t.email as transporter_email
      FROM transport_distributions d
      JOIN transporters t ON d.transporter_id = t.id
      WHERE d.request_id = ?
    `).all(requestId);

    const submittedDists = allDists
      .filter(d => d.status === 'Submitted')
      .sort((a, b) => (parseFloat(a.final_cost) || 0) - (parseFloat(b.final_cost) || 0));

    const totalBids = submittedDists.length;
    if (totalBids < 2) return; // Minimum 2 bids required

    console.log(`[Ranking Update] Sending rank notifications to ${totalBids} transporters for Request ${reqItem.request_number}...`);

    for (let i = 0; i < totalBids; i++) {
      const dist = submittedDists[i];
      const rank = i + 1;
      const isL1 = rank === 1;
      const rankText = `#${rank} of ${totalBids}`;
      
      const subject = `[Rank Update] Live Ranking Alert: Transport Request ${reqItem.request_number}`;
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #f8fafc;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #0f172a; margin: 0;">SEMCO Logistics Portal</h2>
            <p style="color: #64748b; font-size: 14px; margin: 5px 0 0 0;">Live Logistics Bidding Updates</p>
          </div>
          <div style="background-color: #ffffff; padding: 20px; border-radius: 6px; border: 1px solid #cbd5e1;">
            <p style="color: #334155; font-size: 15px;">Dear <strong>${dist.transporter_name}</strong>,</p>
            <p style="color: #334155; font-size: 15px; line-height: 1.5;">
              A new bid was submitted for <strong>Transport Request ${reqItem.request_number}</strong> (${reqItem.from_location} &rarr; ${reqItem.to_location}). 
              As a result, the live bidding rankings have been recalculated.
            </p>
            <div style="margin: 20px 0; padding: 15px; background-color: ${isL1 ? '#dcfce7' : '#f1f5f9'}; border-left: 5px solid ${isL1 ? '#22c55e' : '#3b82f6'}; border-radius: 4px;">
              <span style="font-size: 14px; color: #475569; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">Your Current Live Rank</span>
              <div style="font-size: 32px; font-weight: 800; color: ${isL1 ? '#15803d' : '#1e3a8a'}; margin-top: 5px;">
                ${rankText}
              </div>
              <p style="margin: 5px 0 0 0; font-size: 13px; color: #475569;">
                ${isL1 ? '🎉 You are currently the L1 (Lowest Cost) transporter!' : 'Keep bidding to optimize your pricing and improve your rank.'}
              </p>
            </div>
            <p style="color: #334155; font-size: 14px; line-height: 1.5;">
              You can access your bidding workspace and view your live rankings at any time using your secure link.
            </p>
          </div>
          <div style="text-align: center; margin-top: 20px; font-size: 11px; color: #94a3b8;">
            This is an automated notification from SEMCO Procurement System.<br>
            For support, contact us at umesh.p@semcogroups.com.
          </div>
        </div>
      `;

      await sendMailViaSmtp(dist.transporter_email, subject, emailHtml);
    }
  } catch (err) {
    console.error("Error sending transporter ranking email notifications:", err);
  }
}

// ─── Multer (file uploads, 50 MB max) ────────────────────
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Middleware ──────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// Middleware to ensure database is connected before processing request on Vercel
let mongoConnected = false;
let mongoConnectingPromise = null;
app.use(async (req, res, next) => {
  if (process.env.MONGODB_URI && !mongoConnected) {
    if (!mongoConnectingPromise) {
      mongoConnectingPromise = db.connectMongo(process.env.MONGODB_URI)
        .then(() => { mongoConnected = true; })
        .catch(err => { console.error('[MongoDB Middleware Error]:', err.message); })
        .finally(() => { mongoConnectingPromise = null; });
    }
    try {
      await mongoConnectingPromise;
    } catch (_) {}
  }
  next();
});


// ═══════════════════════════════════════════════════════════
//  DATABASE SCHEMA
// ═══════════════════════════════════════════════════════════
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vendors (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      contact_person TEXT NOT NULL DEFAULT '',
      email         TEXT NOT NULL,
      phone         TEXT DEFAULT '',
      company_name  TEXT DEFAULT '',
      gst_number    TEXT DEFAULT '',
      pan_number    TEXT DEFAULT '',
      address       TEXT DEFAULT '',
      category      TEXT DEFAULT '',
      preferred     INTEGER DEFAULT 0,
      rating        REAL DEFAULT 4.0,
      archived      INTEGER DEFAULT 0,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL,
      vendor_id     TEXT,
      transporter_id TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rfqs (
      id            TEXT PRIMARY KEY,
      rfq_number    TEXT UNIQUE NOT NULL,
      rfq_date      TEXT NOT NULL,
      delivery_date TEXT NOT NULL,
      project_name  TEXT NOT NULL,
      department    TEXT DEFAULT '',
      buyer_name    TEXT DEFAULT '',
      status        TEXT DEFAULT 'Draft',
      version       INTEGER DEFAULT 1,
      available_from TEXT DEFAULT '',
      available_to   TEXT DEFAULT '',
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rfq_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id        TEXT NOT NULL,
      moc           TEXT NOT NULL,
      description   TEXT NOT NULL,
      size          TEXT NOT NULL,
      quantity      REAL NOT NULL,
      unit          TEXT NOT NULL DEFAULT 'Nos',
      FOREIGN KEY (rfq_id) REFERENCES rfqs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rfq_distributions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id        TEXT NOT NULL,
      vendor_id     TEXT NOT NULL,
      token         TEXT UNIQUE NOT NULL,
      status        TEXT DEFAULT 'Sent',
      sent_at       TEXT DEFAULT (datetime('now')),
      opened_at     TEXT,
      submitted_at  TEXT,
      final_cost    REAL DEFAULT 0.0,
      cgst_applicable INTEGER DEFAULT 0,
      sgst_applicable INTEGER DEFAULT 0,
      reminder_60_sent INTEGER DEFAULT 0,
      reminder_30_sent INTEGER DEFAULT 0,
      FOREIGN KEY (rfq_id)   REFERENCES rfqs(id) ON DELETE CASCADE,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS vendor_quotes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id          TEXT NOT NULL,
      vendor_id       TEXT NOT NULL,
      item_id         INTEGER NOT NULL,
      rate            REAL NOT NULL,
      lead_time_days  INTEGER DEFAULT 7,
      payment_terms   TEXT DEFAULT '',
      remarks         TEXT DEFAULT '',
      submitted_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (rfq_id)   REFERENCES rfqs(id) ON DELETE CASCADE,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id)  REFERENCES rfq_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_trail (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT DEFAULT (datetime('now')),
      username    TEXT NOT NULL,
      action      TEXT NOT NULL,
      details     TEXT DEFAULT '',
      ip_address  TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT (datetime('now')),
      title     TEXT NOT NULL,
      message   TEXT NOT NULL,
      status    TEXT DEFAULT 'Unread'
    );

    CREATE TABLE IF NOT EXISTS transporters (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      contact_person TEXT NOT NULL DEFAULT '',
      email         TEXT NOT NULL,
      phone         TEXT DEFAULT '',
      company_name  TEXT DEFAULT '',
      gst_number    TEXT DEFAULT '',
      pan_number    TEXT DEFAULT '',
      address       TEXT DEFAULT '',
      category      TEXT DEFAULT 'Others',
      rating        REAL DEFAULT 4.0,
      archived      INTEGER DEFAULT 0,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transport_requests (
      id            TEXT PRIMARY KEY,
      request_number TEXT UNIQUE NOT NULL,
      from_location TEXT NOT NULL,
      to_location   TEXT NOT NULL,
      required_date TEXT NOT NULL,
      status        TEXT DEFAULT 'Draft',
      launched_at   TEXT,
      expires_at    TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transport_request_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id    TEXT NOT NULL,
      material_name TEXT NOT NULL,
      material_category TEXT NOT NULL,
      quantity      REAL NOT NULL,
      unit          TEXT NOT NULL DEFAULT 'Ton',
      remarks       TEXT DEFAULT '',
      FOREIGN KEY (request_id) REFERENCES transport_requests(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS transport_distributions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id    TEXT NOT NULL,
      transporter_id TEXT NOT NULL,
      token         TEXT UNIQUE NOT NULL,
      status        TEXT DEFAULT 'Sent',
      sent_at       TEXT DEFAULT (datetime('now')),
      opened_at     TEXT,
      submitted_at  TEXT,
      distance      REAL DEFAULT 0.0,
      vehicle_available_from TEXT,
      vehicle_size  TEXT,
      vehicle_tonnage REAL DEFAULT 0.0,
      actual_weight_charged REAL DEFAULT 0.0,
      rate_per_ton  REAL DEFAULT 0.0,
      final_cost    REAL DEFAULT 0.0,
      reminder_60_sent INTEGER DEFAULT 0,
      reminder_30_sent INTEGER DEFAULT 0,
      reminder_15_sent INTEGER DEFAULT 0,
      start_location TEXT,
      end_location   TEXT,
      odc_charges   REAL DEFAULT 0.0,
      weight_unit   TEXT DEFAULT 'Tons',
      tax_bracket   REAL DEFAULT 0.0,
      return_trip_included INTEGER DEFAULT 0,
      return_trip_rate REAL DEFAULT 0.0,
      FOREIGN KEY (request_id) REFERENCES transport_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (transporter_id) REFERENCES transporters(id) ON DELETE CASCADE
    );
  `);

  // Upgrade existing databases with new onboarding registration columns safely
  const vendorCols = ['bank_name', 'bank_address', 'account_name', 'account_type', 'account_number', 'ifsc_code', 'msme_status'];
  const transporterCols = ['bank_name', 'bank_address', 'account_name', 'account_type', 'account_number', 'ifsc_code'];

  vendorCols.forEach(col => {
    try {
      db.exec(`ALTER TABLE vendors ADD COLUMN ${col} TEXT DEFAULT ''`);
    } catch (_) {}
  });

  transporterCols.forEach(col => {
    try {
      db.exec(`ALTER TABLE transporters ADD COLUMN ${col} TEXT DEFAULT ''`);
    } catch (_) {}
  });

  try {
    db.exec(`ALTER TABLE transport_distributions ADD COLUMN return_trip_included INTEGER DEFAULT 0`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE transport_distributions ADD COLUMN return_trip_rate REAL DEFAULT 0.0`);
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
//  SEED DEFAULT DATA
// ═══════════════════════════════════════════════════════════
function seedDefaults() {
  console.log('[Database] Safe testing mode: starting database clean from scratch (no dummy data seeded).');
  if (db.data) {
    db.data.seeded = true;
    db.save();
  }
}

initSchema();

// Dynamically add columns if they do not exist
try { db.prepare("ALTER TABLE rfqs ADD COLUMN initial_window_hours TEXT").run(); } catch (_) {}
try { db.prepare("ALTER TABLE rfqs ADD COLUMN expires_at TEXT").run(); } catch (_) {}
try { db.prepare("ALTER TABLE transport_requests ADD COLUMN initial_window_hours TEXT").run(); } catch (_) {}
try { db.prepare("ALTER TABLE rfq_distributions ADD COLUMN reminder_60_sent INTEGER DEFAULT 0").run(); } catch (_) {}
try { db.prepare("ALTER TABLE rfq_distributions ADD COLUMN reminder_30_sent INTEGER DEFAULT 0").run(); } catch (_) {}
try { db.prepare("ALTER TABLE transport_distributions ADD COLUMN reminder_60_sent INTEGER DEFAULT 0").run(); } catch (_) {}
try { db.prepare("ALTER TABLE transport_distributions ADD COLUMN reminder_30_sent INTEGER DEFAULT 0").run(); } catch (_) {}
// New transport_request_items columns for vehicle-spec schema
try { db.prepare("ALTER TABLE transport_request_items ADD COLUMN vehicle_type TEXT DEFAULT ''").run(); } catch (_) {}
try { db.prepare("ALTER TABLE transport_request_items ADD COLUMN size_ft REAL DEFAULT 0").run(); } catch (_) {}
try { db.prepare("ALTER TABLE transport_request_items ADD COLUMN odc_charges REAL DEFAULT 0").run(); } catch (_) {}
try { db.prepare("ALTER TABLE rfqs ADD COLUMN excel_filename TEXT DEFAULT ''").run(); } catch (_) {}
try { db.prepare("ALTER TABLE rfqs ADD COLUMN excel_path TEXT DEFAULT ''").run(); } catch (_) {}
try { db.prepare("ALTER TABLE rfqs ADD COLUMN custom_headers TEXT DEFAULT ''").run(); } catch (_) {}
try { db.prepare("ALTER TABLE rfq_items ADD COLUMN custom_data TEXT DEFAULT ''").run(); } catch (_) {}
try { db.prepare("ALTER TABLE rfq_distributions ADD COLUMN payment_terms TEXT DEFAULT ''").run(); } catch (_) {}
try { db.prepare("ALTER TABLE transport_distributions ADD COLUMN payment_terms TEXT DEFAULT ''").run(); } catch (_) {}
try { db.prepare("ALTER TABLE rfqs ADD COLUMN allow_spec_sheet INTEGER DEFAULT 0").run(); } catch (_) {}
try { db.prepare("ALTER TABLE rfq_distributions ADD COLUMN vendor_doc_path TEXT DEFAULT ''").run(); } catch (_) {}
try { db.prepare("ALTER TABLE rfq_distributions ADD COLUMN vendor_doc_name TEXT DEFAULT ''").run(); } catch (_) {}
try { db.prepare("ALTER TABLE rfq_distributions ADD COLUMN vendor_docs TEXT DEFAULT '[]'").run(); } catch (_) {}

// ═══════════════════════════════════════════════════════════
//  UTILITY HELPERS
// ═══════════════════════════════════════════════════════════
function logAudit(username, action, details, req) {
  const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1') : '127.0.0.1';
  db.prepare(`INSERT INTO audit_trail (username,action,details,ip_address) VALUES (?,?,?,?)`)
    .run(username || 'System Agent', action, details, ip);
}

function nextVendorId() {
  const last = db.prepare("SELECT id FROM vendors ORDER BY id DESC LIMIT 1").get();
  if (!last) return 'VND001';
  const num = parseInt(last.id.replace('VND', ''), 10) + 1;
  return 'VND' + String(num).padStart(3, '0');
}

function nextTransporterId() {
  const last = db.prepare("SELECT id FROM transporters ORDER BY id DESC LIMIT 1").get();
  if (!last) return 'TRN001';
  const num = parseInt(last.id.replace('TRN', ''), 10) + 1;
  return 'TRN' + String(num).padStart(3, '0');
}

function cleanUpFile(filepath) {
  try { if (filepath && fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
//  HEALTH CHECK
// ═══════════════════════════════════════════════════════════
app.get('/api/health', (_req, res) => {
  const vendorCount = db.prepare('SELECT count(*) AS c FROM vendors').get().c;
  const rfqCount    = db.prepare('SELECT count(*) AS c FROM rfqs').get().c;
  res.json({
    success: true,
    database: 'connected',
    sendgrid: sendgridReady ? 'configured' : 'simulation',
    vendors: vendorCount,
    rfqs: rfqCount
  });
});

// ═══════════════════════════════════════════════════════════
//  DASHBOARD STATISTICS
// ═══════════════════════════════════════════════════════════
app.get('/api/dashboard/stats', (_req, res) => {
  try {
    const rfqs = db.prepare('SELECT * FROM rfqs').all();
    const vendors = db.prepare('SELECT * FROM vendors').all();
    const dists = db.prepare('SELECT * FROM rfq_distributions').all();
    const quotes = db.prepare('SELECT * FROM vendor_quotes').all();

    const transportRequests = db.prepare('SELECT * FROM transport_requests').all();
    const transporters = db.prepare('SELECT * FROM transporters').all();
    const tDists = db.prepare('SELECT * FROM transport_distributions').all();

    // ─── 1. VENDOR CALCULATIONS ───
    let vTotalSpend = 0;
    let vTotalSavings = 0;

    rfqs.forEach(rfq => {
      const rfqDists = dists.filter(d => d.rfq_id === rfq.id && d.status === 'Submitted');
      if (rfqDists.length > 0) {
        const costs = rfqDists.map(d => parseFloat(d.final_cost) || 0).filter(c => c > 0);
        if (costs.length > 0) {
          const lowest = Math.min(...costs);
          vTotalSpend += lowest;
          if (costs.length > 1) {
            const avg = costs.reduce((s, c) => s + c, 0) / costs.length;
            vTotalSavings += Math.max(0, avg - lowest);
          }
        }
      }
    });

    const vActiveCount = rfqs.filter(r => r.status !== 'Closed' && r.status !== 'Draft' && r.status !== 'Expired').length;
    const vCompletedCount = rfqs.filter(r => r.status === 'Submitted' || r.status === 'Closed' || r.status === 'Expired').length;

    const vStatusDistribution = { 'Draft': 0, 'Sent': 0, 'Opened': 0, 'In Progress': 0, 'Submitted': 0, 'Closed': 0, 'Expired': 0 };
    rfqs.forEach(r => {
      if (r.status === 'Draft') vStatusDistribution['Draft']++;
      if (r.status === 'Closed') vStatusDistribution['Closed']++;
      if (r.status === 'Expired') vStatusDistribution['Expired']++;
    });
    dists.forEach(d => {
      const r = rfqs.find(x => x.id === d.rfq_id);
      if (r && r.status !== 'Draft' && r.status !== 'Closed' && r.status !== 'Expired') {
        if (vStatusDistribution[d.status] !== undefined) {
          vStatusDistribution[d.status]++;
        }
      }
    });

    const sortedRFQs = [...rfqs].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const latestRFQ = sortedRFQs.find(rfq => dists.some(d => d.rfq_id === rfq.id && parseFloat(d.final_cost) > 0));
    
    let vPriceComparison = { rfq_number: '', labels: [], data: [], created_at: '1970-01-01T00:00:00.000Z' };
    if (latestRFQ) {
      const rfqDists = dists.filter(d => d.rfq_id === latestRFQ.id);
      const labels = [];
      const data = [];
      rfqDists.forEach(d => {
        const v = vendors.find(x => x.id === d.vendor_id);
        if (v && parseFloat(d.final_cost) > 0) {
          labels.push(v.name);
          data.push(parseFloat(d.final_cost));
        }
      });
      vPriceComparison = {
        rfq_number: latestRFQ.rfq_number,
        labels,
        data,
        created_at: latestRFQ.created_at || '1970-01-01T00:00:00.000Z'
      };
    }

    const months = [];
    const monthIndices = [];
    const today = new Date();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push(monthNames[d.getMonth()]);
      monthIndices.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const vSavingsTrendData = monthIndices.map(() => 0);
    rfqs.forEach(rfq => {
      const rfqDists = dists.filter(d => d.rfq_id === rfq.id && d.status === 'Submitted');
      if (rfqDists.length > 1) {
        const costs = rfqDists.map(d => parseFloat(d.final_cost) || 0).filter(c => c > 0);
        if (costs.length > 1) {
          const lowest = Math.min(...costs);
          const avg = costs.reduce((s, c) => s + c, 0) / costs.length;
          const savings = Math.max(0, avg - lowest);
          if (rfq.rfq_date) {
            const match = rfq.rfq_date.substring(0, 7);
            const idx = monthIndices.indexOf(match);
            if (idx >= 0) {
              vSavingsTrendData[idx] += savings;
            }
          }
        }
      }
    });
    const vSavingsTrend = { labels: months, data: vSavingsTrendData };

    const vAvgRating = vendors.length > 0 
      ? (vendors.reduce((sum, v) => sum + (parseFloat(v.rating) || 4.0), 0) / vendors.length) * 20 
      : 80;

    const vSubmittedDists = dists.filter(d => d.status === 'Submitted').length;
    const vTotalDists = dists.length;
    const vResponseRate = vTotalDists > 0 ? (vSubmittedDists / vTotalDists) * 100 : 75;

    const validQuotes = quotes.filter(q => (q.lead_time_days || q.lead_time) > 0);
    const avgLeadTime = validQuotes.length > 0
      ? validQuotes.reduce((sum, q) => sum + (parseInt(q.lead_time_days || q.lead_time) || 7), 0) / validQuotes.length
      : 9;
    const vLeadTimeScore = Math.max(50, Math.min(100, 100 - (avgLeadTime - 7) * 4));

    let vPriceScoreSum = 0;
    let vPriceScoreCount = 0;
    rfqs.forEach(rfq => {
      const rfqDists = dists.filter(d => d.rfq_id === rfq.id && d.status === 'Submitted');
      if (rfqDists.length > 0) {
        const costs = rfqDists.map(d => parseFloat(d.final_cost) || 0).filter(c => c > 0);
        if (costs.length > 0) {
          const lowest = Math.min(...costs);
          const avg = costs.reduce((s, c) => s + c, 0) / costs.length;
          if (avg > 0) {
            vPriceScoreSum += (lowest / avg) * 100;
            vPriceScoreCount++;
          }
        }
      }
    });
    const vPriceScore = vPriceScoreCount > 0 ? (vPriceScoreSum / vPriceScoreCount) : 85;
    const vComplianceScore = 95;

    const vPerformanceTrend = vendors.length > 0 ? [
      Math.round(vAvgRating),
      Math.round(vPriceScore),
      Math.round(vLeadTimeScore),
      Math.round(Math.max(70, vComplianceScore)),
      Math.round(vResponseRate)
    ] : [0, 0, 0, 0, 0];


    // ─── 2. TRANSPORTER CALCULATIONS ───
    let tTotalSpend = 0;
    let tTotalSavings = 0;

    transportRequests.forEach(req => {
      const reqDists = tDists.filter(d => d.request_id === req.id && d.status === 'Submitted');
      if (reqDists.length > 0) {
        const costs = reqDists.map(d => parseFloat(d.final_cost) || 0).filter(c => c > 0);
        if (costs.length > 0) {
          const lowest = Math.min(...costs);
          tTotalSpend += lowest;
          if (costs.length > 1) {
            const avg = costs.reduce((s, c) => s + c, 0) / costs.length;
            tTotalSavings += Math.max(0, avg - lowest);
          }
        }
      }
    });

    const tActiveCount = transportRequests.filter(r => r.status !== 'Closed' && r.status !== 'Draft' && r.status !== 'Expired').length;
    const tCompletedCount = transportRequests.filter(r => r.status === 'Submitted' || r.status === 'Closed' || r.status === 'Expired').length;

    const tStatusDistribution = { 'Draft': 0, 'Sent': 0, 'Opened': 0, 'Submitted': 0, 'Closed': 0, 'Expired': 0 };
    transportRequests.forEach(r => {
      if (r.status === 'Draft') tStatusDistribution['Draft']++;
      if (r.status === 'Closed') tStatusDistribution['Closed']++;
      if (r.status === 'Expired') tStatusDistribution['Expired']++;
    });
    tDists.forEach(d => {
      const r = transportRequests.find(x => x.id === d.request_id);
      if (r && r.status !== 'Draft' && r.status !== 'Closed' && r.status !== 'Expired') {
        if (tStatusDistribution[d.status] !== undefined) {
          tStatusDistribution[d.status]++;
        }
      }
    });

    const sortedTRs = [...transportRequests].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const latestTR = sortedTRs.find(req => tDists.some(d => d.request_id === req.id && parseFloat(d.final_cost) > 0));
    
    let tPriceComparison = { request_number: '', labels: [], data: [], created_at: '1970-01-01T00:00:00.000Z' };
    if (latestTR) {
      const reqDists = tDists.filter(d => d.request_id === latestTR.id);
      const labels = [];
      const data = [];
      reqDists.forEach(d => {
        const t = transporters.find(x => x.id === d.transporter_id);
        if (t && parseFloat(d.final_cost) > 0) {
          labels.push(t.name);
          data.push(parseFloat(d.final_cost));
        }
      });
      tPriceComparison = {
        request_number: latestTR.request_number,
        labels,
        data,
        created_at: latestTR.created_at || '1970-01-01T00:00:00.000Z'
      };
    }

    const tSavingsTrendData = monthIndices.map(() => 0);
    transportRequests.forEach(req => {
      const reqDists = tDists.filter(d => d.request_id === req.id && d.status === 'Submitted');
      if (reqDists.length > 1) {
        const costs = reqDists.map(d => parseFloat(d.final_cost) || 0).filter(c => c > 0);
        if (costs.length > 1) {
          const lowest = Math.min(...costs);
          const avg = costs.reduce((s, c) => s + c, 0) / costs.length;
          const savings = Math.max(0, avg - lowest);
          if (req.required_date) {
            let match = '';
            if (req.required_date.includes('-')) {
              match = req.required_date.substring(0, 7);
            } else if (req.required_date.length === 8) {
              const d = req.required_date.substring(0, 2);
              const m = req.required_date.substring(2, 4);
              const y = req.required_date.substring(4, 8);
              match = `${y}-${m}`;
            }
            if (match) {
              const idx = monthIndices.indexOf(match);
              if (idx >= 0) {
                tSavingsTrendData[idx] += savings;
              }
            }
          }
        }
      }
    });
    const tSavingsTrend = { labels: months, data: tSavingsTrendData };

    const tAvgRating = transporters.length > 0 
      ? (transporters.reduce((sum, t) => sum + (parseFloat(t.rating) || 4.0), 0) / transporters.length) * 20 
      : 80;

    const tSubmittedDists = tDists.filter(d => d.status === 'Submitted').length;
    const tTotalDists = tDists.length;
    const tResponseRate = tTotalDists > 0 ? (tSubmittedDists / tTotalDists) * 100 : 75;

    const tComplianceScore = 96;
    let tPriceScoreSum = 0;
    let tPriceScoreCount = 0;
    transportRequests.forEach(req => {
      const reqDists = tDists.filter(d => d.request_id === req.id && d.status === 'Submitted');
      if (reqDists.length > 0) {
        const costs = reqDists.map(d => parseFloat(d.final_cost) || 0).filter(c => c > 0);
        if (costs.length > 0) {
          const lowest = Math.min(...costs);
          const avg = costs.reduce((s, c) => s + c, 0) / costs.length;
          if (avg > 0) {
            tPriceScoreSum += (lowest / avg) * 100;
            tPriceScoreCount++;
          }
        }
      }
    });
    const tPriceScore = tPriceScoreCount > 0 ? (tPriceScoreSum / tPriceScoreCount) : 85;
    const tLeadTimeScore = 88;

    const tPerformanceTrend = transporters.length > 0 ? [
      Math.round(tAvgRating),
      Math.round(tPriceScore),
      Math.round(tLeadTimeScore),
      Math.round(Math.max(70, tComplianceScore)),
      Math.round(tResponseRate)
    ] : [0, 0, 0, 0, 0];

    res.json({
      success: true,
      data: {
        vendor: {
          totalSpend: vTotalSpend,
          totalSavings: vTotalSavings,
          activeCount: vActiveCount,
          completedCount: vCompletedCount,
          statusDistribution: vStatusDistribution,
          priceComparison: vPriceComparison,
          savingsTrend: vSavingsTrend,
          performanceTrend: vPerformanceTrend
        },
        transporter: {
          totalSpend: tTotalSpend,
          totalSavings: tTotalSavings,
          activeCount: tActiveCount,
          completedCount: tCompletedCount,
          statusDistribution: tStatusDistribution,
          priceComparison: tPriceComparison,
          savingsTrend: tSavingsTrend,
          performanceTrend: tPerformanceTrend
        }
      }
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  NATIVE AUTHENTICATION (MongoDB User Login & Registration)
// ═══════════════════════════════════════════════════════════
const crypto = require('crypto');
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

app.post('/api/auth/register', (req, res) => {
  try {
    const { name, email, password, role, vendorId, transporterId } = req.body;
    
    if (!email || !password || !role) {
      return res.status(400).json({ success: false, message: 'Email, password, and role are required.' });
    }

    if (role === 'Procurement Admin') {
      const domain = email.split('@')[1];
      if (!domain || domain.toLowerCase() !== 'semcogroups.com') {
        return res.status(400).json({ success: false, message: 'Only @semcogroups.com email addresses are allowed for Procurement Admin registration.' });
      }
    }

    // Check if email already registered
    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email address already in use.' });
    }

    const id = 'usr_' + Date.now();
    const password_hash = hashPassword(password);
    db.prepare('INSERT INTO users (id, email, password_hash, role, vendor_id, transporter_id) VALUES (?, ?, ?, ?, ?, ?)').run(id, email, password_hash, role, vendorId || null, transporterId || null);
    
    logAudit(name || email, 'USER_REGISTER', `Registered user account ${email} with role ${role}`, req);
    res.json({ success: true, message: 'Account registered successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: "Your account does not exist. Please contact the administrator for further assistance." 
      });
    }

    if (user.role === 'Procurement Admin') {
      const domain = email.split('@')[1];
      if (!domain || domain.toLowerCase() !== 'semcogroups.com') {
        return res.status(401).json({ success: false, message: 'Only @semcogroups.com email addresses are allowed for Procurement Admin login.' });
      }
    }

    const inputHash = hashPassword(password);
    if (user.password_hash !== inputHash) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, vendorId: user.vendor_id, transporterId: user.transporter_id },
      JWT_SECRET,
      { expiresIn: '15d' }
    );

    logAudit(user.email, 'USER_LOGIN', `Logged in user account ${user.email}`, req);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        vendorId: user.vendor_id,
        transporterId: user.transporter_id
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  USER MANAGEMENT
// ═══════════════════════════════════════════════════════════
app.delete('/api/auth/users/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    logAudit(req.headers['x-user'] || 'Admin', 'USER_DELETE', `Deleted user account ${id}`, req);
    res.json({ success: true, message: 'User deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/users/clear', async (_req, res) => {
  try {
    db.prepare('DELETE FROM users').run();
    res.json({ success: true, message: 'All user accounts cleared.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  VENDOR CRUD
// ═══════════════════════════════════════════════════════════
app.get('/api/vendors', (_req, res) => {
  try {
    const vendors = db.prepare('SELECT * FROM vendors ORDER BY name ASC').all();
    res.json({ success: true, data: vendors });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/vendors/archived', (_req, res) => {
  try {
    const vendors = db.prepare('SELECT * FROM vendors WHERE archived = 1 ORDER BY name ASC').all();
    res.json({ success: true, data: vendors });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/vendors', (req, res) => {
  try {
    const b = req.body;
    const id = nextVendorId();
    db.prepare(`
      INSERT INTO vendors (id,name,contact_person,email,phone,company_name,gst_number,pan_number,address,category,preferred,rating)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      b.name || 'Unknown',
      b.contact_person || b.contactPerson || '',
      b.email || '',
      b.phone || '',
      b.company_name || b.name || '',
      b.gst_number || '',
      b.pan_number || '',
      b.address || '',
      b.category || b.product_category || '',
      0, // preferred is removed, default to 0
      b.rating || 4.0
    );
    logAudit(req.headers['x-user'] || 'Admin', 'VENDOR_CREATE', `Added vendor ${b.name} (${id})`, req);

    res.json({ success: true, id, message: `Vendor ${b.name} added successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/vendors/:id', (req, res) => {
  try {
    const { id } = req.params;
    const b = req.body;

    const existing = db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Vendor not found.' });
    }

    db.prepare(`
      UPDATE vendors 
      SET name = ?, contact_person = ?, email = ?, phone = ?, company_name = ?, gst_number = ?, pan_number = ?, address = ?, category = ?, preferred = ?, rating = ?
      WHERE id = ?
    `).run(
      b.name || existing.name,
      b.contact_person !== undefined ? b.contact_person : existing.contact_person,
      b.email !== undefined ? b.email : existing.email,
      b.phone !== undefined ? b.phone : existing.phone,
      b.company_name !== undefined ? b.company_name : existing.company_name,
      b.gst_number !== undefined ? b.gst_number : existing.gst_number,
      b.pan_number !== undefined ? b.pan_number : existing.pan_number,
      b.address !== undefined ? b.address : existing.address,
      b.category !== undefined ? b.category : existing.category,
      0, // preferred is removed, set to 0
      b.rating !== undefined ? b.rating : existing.rating,
      id
    );

    logAudit(req.headers['x-user'] || 'Admin', 'VENDOR_UPDATE', `Updated vendor ${b.name || existing.name} (${id})`, req);
    res.json({ success: true, message: `Vendor ${b.name || existing.name} updated successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/vendors/:id', (req, res) => {
  try {
    const role = req.headers['x-role'] || 'Admin';
    if (role !== 'Procurement Admin' && role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized. Only Procurement Admin can delete vendors.' });
    }
    const { id } = req.params;
    const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found.' });

    if (vendor.archived === 1) {
      db.prepare('DELETE FROM vendors WHERE id = ?').run(id);
      db.prepare('DELETE FROM users WHERE vendor_id = ?').run(id);
      logAudit(req.headers['x-user'] || 'Admin', 'VENDOR_DELETE_PERMANENT', `Permanently deleted vendor ${vendor.name} (${id})`, req);
      res.json({ success: true, message: 'Vendor permanently deleted.' });
    } else {
      db.prepare('UPDATE vendors SET archived = 1 WHERE id = ?').run(id);
      logAudit(req.headers['x-user'] || 'Admin', 'VENDOR_ARCHIVE', `Archived vendor ${vendor.name} (${id})`, req);
      res.json({ success: true, message: 'Vendor archived successfully.' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/vendors/:id/recover', (req, res) => {
  try {
    const role = req.headers['x-role'] || 'Admin';
    if (role !== 'Procurement Admin' && role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized. Only Procurement Admin can recover vendors.' });
    }
    const { id } = req.params;
    const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found.' });

    db.prepare('UPDATE vendors SET archived = ? WHERE id = ?').run(0, id);
    logAudit(req.headers['x-user'] || 'Admin', 'VENDOR_RECOVER', `Recovered vendor ${vendor.name} (${id})`, req);
    res.json({ success: true, message: 'Vendor recovered successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  VENDOR FILE UPLOAD (Excel/CSV → DB)
// ═══════════════════════════════════════════════════════════
app.post('/api/upload/vendors', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);
    cleanUpFile(req.file.path);

    if (rows.length === 0) return res.status(400).json({ success: false, message: 'Spreadsheet is empty.' });

    const insertV = db.prepare(`
      INSERT INTO vendors (id,name,contact_person,email,phone,company_name,gst_number,pan_number,address,category,preferred,rating)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const inserted = [];
    const insertTx = db.transaction((dataRows) => {
      for (const row of dataRows) {
        const name    = row.name || row.Name || row['Company Name'] || row['Vendor Name'] || '';
        if (!name) continue;
        const email   = row.email || row.Email || row['Email ID'] || row['Email Address'] || '';
        const contact = row.contact_person || row.contact || row['Contact Person'] || '';
        const phone   = row.phone || row.Phone || row['Mobile Number'] || '';
        const gst     = (row.gst_number || row.GST || row['GST Number'] || '').toString().toUpperCase();
        const pan     = (row.pan_number || row.PAN || row['PAN Number'] || '').toString().toUpperCase();
        const address = row.address || row.Address || '';
        const cat     = row.category || row.Category || row['Product Category'] || '';
        const pref    = parseInt(row.preferred || 0) ? 1 : 0;

        const id = nextVendorId();
        insertV.run(id, name, contact, email, phone, name, gst, pan, address, cat, pref, 4.0);
        inserted.push({ id, name, email });
      }
    });
    insertTx(rows);

    logAudit(req.headers['x-user'] || 'Admin', 'VENDOR_IMPORT', `Imported ${inserted.length} vendors from spreadsheet`, req);
    res.json({ success: true, count: inserted.length, data: inserted });
  } catch (err) {
    cleanUpFile(req.file?.path);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  RFQ CRUD
// ═══════════════════════════════════════════════════════════
app.get('/api/rfqs', (_req, res) => {
  try {
    const rfqs = db.prepare(`
      SELECT r.*,
        (SELECT count(*) FROM rfq_items       WHERE rfq_id = r.id) AS item_count,
        (SELECT count(*) FROM rfq_distributions WHERE rfq_id = r.id) AS vendor_sent_count,
        (SELECT count(*) FROM rfq_distributions WHERE rfq_id = r.id AND status = 'Submitted') AS vendor_submitted_count
      FROM rfqs r ORDER BY r.created_at DESC
    `).all();
    res.json({ success: true, data: rfqs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/rfqs/:id', (req, res) => {
  try {
    const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
    if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found.' });

    const items = db.prepare('SELECT * FROM rfq_items WHERE rfq_id = ?').all(rfq.id);
    const distributions = db.prepare(`
      SELECT d.*, v.name AS vendor_name, v.email AS vendor_email
      FROM rfq_distributions d JOIN vendors v ON d.vendor_id = v.id
      WHERE d.rfq_id = ?
    `).all(rfq.id);

    res.json({ success: true, data: { rfq, items, distributions } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/rfqs', (req, res) => {
  try {
    const { rfq_date, delivery_date, project_name, department, buyer_name, items, vendor_ids, available_from, available_to, initial_window_hours, custom_headers, allow_spec_sheet } = req.body;
    const count = db.prepare('SELECT count(*) AS c FROM rfqs').get().c;
    const rfq_number = `RFQ-${new Date().getFullYear()}-${String(count + 1).padStart(3, '0')}`;
    const id = 'rfq_' + Date.now();

    db.prepare(`
      INSERT INTO rfqs (id,rfq_number,rfq_date,delivery_date,project_name,department,buyer_name,status,available_from,available_to,initial_window_hours,custom_headers,allow_spec_sheet)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, rfq_number, rfq_date || new Date().toISOString().slice(0,10), delivery_date, project_name, department || '', buyer_name || '', 'Draft', available_from || '', available_to || '', initial_window_hours || '12', custom_headers || '', allow_spec_sheet ? 1 : 0);

    if (items && items.length > 0) {
      const insertItem = db.prepare(`INSERT INTO rfq_items (rfq_id,moc,description,size,quantity,unit,custom_data) VALUES (?,?,?,?,?,?,?)`);
      const insertTx = db.transaction((itemList) => {
        for (const it of itemList) {
          insertItem.run(id, it.moc, it.description, it.size, parseFloat(it.quantity), it.unit || 'Nos', it.custom_data || '');
        }
      });
      insertTx(items);
    }

    if (vendor_ids && vendor_ids.length > 0) {
      const insertDist = db.prepare(`INSERT INTO rfq_distributions (rfq_id,vendor_id,token,status) VALUES (?,?,?,?)`);
      const distTx = db.transaction((vIds) => {
        for (const vId of vIds) {
          const token = jwt.sign({ rfq_id: id, vendor_id: vId }, JWT_SECRET, { expiresIn: '15d' });
          insertDist.run(id, vId, token, 'Draft');
        }
      });
      distTx(vendor_ids);
    }

    logAudit(buyer_name || 'Executive', 'RFQ_CREATE', `Created draft ${rfq_number} for ${project_name}`, req);
    res.json({ success: true, id, rfq_number, message: 'RFQ draft created successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


app.delete('/api/rfqs/:id', (req, res) => {
  try {
    const { id } = req.params;
    const rfq = db.prepare('SELECT rfq_number FROM rfqs WHERE id = ?').get(id);
    if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found.' });

    db.prepare('DELETE FROM rfqs WHERE id = ?').run(id);
    logAudit(req.headers['x-user'] || 'Admin', 'RFQ_DELETE', `Deleted RFQ ${rfq.rfq_number} (${id})`, req);
    res.json({ success: true, message: 'RFQ deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  RFQ ITEMS FILE UPLOAD (parse-only, returns JSON preview)
// ═══════════════════════════════════════════════════════════
app.post('/api/upload/rfq-items', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);
    cleanUpFile(req.file.path);

    const parsed = [];
    for (const row of rows) {
      const moc  = row.moc || row.MOC || row['Material'] || row['Material of Construction'] || '';
      const desc = row.description || row.Description || row.item || row.Item || row['Item Description'] || '';
      const size = row.size || row.Size || row.dimension || row.Dimension || '';
      const qty  = parseFloat(row.quantity || row.Quantity || row.qty || row.Qty || 1);
      const unit = row.unit || row.Unit || row.uom || row.UOM || 'Nos';
      if (moc || desc) parsed.push({ moc, description: desc, size, quantity: qty, unit });
    }

    res.json({ success: true, count: parsed.length, data: parsed });
  } catch (err) {
    cleanUpFile(req.file?.path);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  RFQ EXCEL ATTACHMENT — Save file to uploads folder
// ═══════════════════════════════════════════════════════════
app.post('/api/rfqs/:id/attach-excel', upload.single('file'), (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });

    const rfq = db.prepare('SELECT id FROM rfqs WHERE id = ?').get(id);
    if (!rfq) { cleanUpFile(req.file.path); return res.status(404).json({ success: false, message: 'RFQ not found.' }); }

    // Keep original extension, rename to rfq_<id>_<originalname>
    const originalName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destName = `rfq_${id}_${originalName}`;
    const destPath = path.join(UPLOAD_DIR, destName);

    // Remove old attachment if exists
    const existing = db.prepare('SELECT excel_path FROM rfqs WHERE id = ?').get(id);
    if (existing && existing.excel_path) cleanUpFile(existing.excel_path);

    const fs = require('fs');
    fs.renameSync(req.file.path, destPath);

    db.prepare('UPDATE rfqs SET excel_filename = ?, excel_path = ? WHERE id = ?')
      .run(originalName, destPath, id);

    logAudit('Admin', 'RFQ_EXCEL_ATTACH', `Excel file attached to RFQ ${id}: ${originalName}`, req);
    res.json({ success: true, filename: originalName });
  } catch (err) {
    cleanUpFile(req.file?.path);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  RFQ EXCEL DOWNLOAD — Vendor can download the attached file
// ═══════════════════════════════════════════════════════════
app.get('/api/rfqs/:id/excel-download', (req, res) => {
  try {
    const { id } = req.params;
    const rfq = db.prepare('SELECT excel_filename, excel_path FROM rfqs WHERE id = ?').get(id);
    if (!rfq || !rfq.excel_path) return res.status(404).json({ success: false, message: 'No Excel file attached to this RFQ.' });

    const fs = require('fs');
    if (!fs.existsSync(rfq.excel_path)) return res.status(404).json({ success: false, message: 'Attached file not found on server.' });

    res.setHeader('Content-Disposition', `attachment; filename="${rfq.excel_filename || 'rfq_attachment.xlsx'}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    fs.createReadStream(rfq.excel_path).pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  RFQ EXCEL PREVIEW — Returns all sheet data as JSON for inline rendering
// ═══════════════════════════════════════════════════════════
app.get('/api/rfqs/:id/excel-preview', (req, res) => {
  try {
    const { id } = req.params;
    const rfq = db.prepare('SELECT excel_filename, excel_path FROM rfqs WHERE id = ?').get(id);
    if (!rfq || !rfq.excel_path) return res.status(404).json({ success: false, message: 'No Excel file attached to this RFQ.' });

    const fs = require('fs');
    if (!fs.existsSync(rfq.excel_path)) return res.status(404).json({ success: false, message: 'File not found on server.' });

    const workbook = XLSX.readFile(rfq.excel_path, { cellDates: true, raw: false });
    const sheets = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      // header:1 gives raw array-of-arrays, preserving ALL columns
      const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rawRows.length === 0) { sheets.push({ name: sheetName, headers: [], rows: [] }); continue; }

      const headers = rawRows[0].map(h => (h === null || h === undefined) ? '' : String(h));
      const rows = rawRows.slice(1).map(row => {
        const padded = [...row];
        while (padded.length < headers.length) padded.push('');
        return padded.map(cell => (cell === null || cell === undefined) ? '' : String(cell));
      }).filter(r => r.some(cell => cell !== ''));

      sheets.push({ name: sheetName, headers, rows });
    }

    res.json({ success: true, filename: rfq.excel_filename, sheets });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  DISTRIBUTION — ONE-CLICK SEND VIA SENDGRID
// ═══════════════════════════════════════════════════════════

app.post('/api/rfqs/distribute', async (req, res) => {
  try {
    const { rfq_id, vendor_ids } = req.body;
    const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(rfq_id);
    if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found.' });

    const now = new Date();
    let expires = null;
    const windowHrs = rfq.initial_window_hours || '12';
    if (windowHrs === 'custom') {
      expires = rfq.available_to ? new Date(rfq.available_to) : new Date(now.getTime() + 12 * 60 * 60 * 1000);
    } else {
      const hrs = parseFloat(windowHrs) || 12;
      expires = new Date(now.getTime() + hrs * 60 * 60 * 1000);
    }
    const expiresISO = expires.toISOString();

    const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'rfq@semcogroups.com';
    const fromName  = process.env.SENDGRID_FROM_NAME  || 'SEMCO Procurement Automation';

    // No testing mode redirection
    const effectiveTestEmail = '';

    const results = [];

    for (const vendorId of vendor_ids) {
      const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendorId);
      if (!vendor) continue;

      // Check if already distributed
      let dist = db.prepare('SELECT * FROM rfq_distributions WHERE rfq_id = ? AND vendor_id = ?').get(rfq_id, vendorId);
      let token;

      if (!dist) {
        token = jwt.sign({ rfq_id, vendor_id: vendorId }, JWT_SECRET, { expiresIn: '15d' });
        db.prepare(`INSERT INTO rfq_distributions (rfq_id,vendor_id,token,status,sent_at) VALUES (?,?,?,?,datetime('now'))`)
          .run(rfq_id, vendorId, token, 'Sent');
      } else {
        token = dist.token;
        db.prepare(`UPDATE rfq_distributions SET status = 'Sent', sent_at = datetime('now') WHERE rfq_id = ? AND vendor_id = ?`)
          .run(rfq_id, vendorId);
      }

      const targetUrl = `${getFrontendUrl(req)}/index.html?token=${token}`;
      const subject = `Request For Quotation: ${rfq.rfq_number} — SEMCO Groups`;
      const emailHtml = `
        <div style="font-family:'Inter','Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
          <div style="background:#0f172a;padding:25px;text-align:center;border-bottom:3px solid #2563eb;">
            <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;letter-spacing:.5px;">SEMCO Groups</h1>
            <p style="color:#94a3b8;margin:5px 0 0;font-size:13px;">Enterprise Quotation Request</p>
          </div>
          <div style="padding:30px;background:#fff;">
            <p style="font-size:15px;margin-top:0;">Dear <strong>${vendor.contact_person || vendor.name}</strong>,</p>
            <p style="line-height:1.6;font-size:14px;">We are pleased to invite <strong>${vendor.name}</strong> to submit rates/quotation for the following requirement:</p>
            <div style="background:#f1f5f9;padding:15px;border-radius:6px;margin:20px 0;border-left:4px solid #2563eb;">
              <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <tr><td style="padding:4px 0;font-weight:600;color:#64748b;width:130px;">RFQ Number:</td><td style="padding:4px 0;font-weight:700;">${rfq.rfq_number}</td></tr>
                <tr><td style="padding:4px 0;font-weight:600;color:#64748b;">Project:</td><td style="padding:4px 0;">${rfq.project_name}</td></tr>
                <tr><td style="padding:4px 0;font-weight:600;color:#64748b;">Department:</td><td style="padding:4px 0;">${rfq.department || 'General'}</td></tr>
                <tr><td style="padding:4px 0;font-weight:600;color:#64748b;width:130px;">Required Delivery:</td><td style="padding:4px 0;color:#dc2626;font-weight:600;">${formatDateDDMMYYYY(rfq.delivery_date)}</td></tr>
                <tr><td style="padding:4px 0;font-weight:600;color:#64748b;">Expires At:</td><td style="padding:4px 0;color:#dc2626;font-weight:600;">${(() => {
                  const pad = (n) => n.toString().padStart(2, '0');
                  const d = pad(expires.getDate());
                  const m = pad(expires.getMonth() + 1);
                  const y = expires.getFullYear();
                  const timeStr = expires.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                  return `${d}/${m}/${y} ${timeStr}`;
                })()}</td></tr>
              </table>
            </div>
            <p style="font-size:14px;line-height:1.6;">Click the button below to access your secure vendor portal. You can review specifications and submit unit rates, payment terms, and lead time. Competitor bids are hidden.</p>
            <div style="text-align:center;margin:30px 0;">
              <a href="${targetUrl}" target="_blank" style="background:#2563eb;color:#fff;font-weight:600;text-decoration:none;padding:12px 30px;border-radius:6px;display:inline-block;box-shadow:0 4px 6px -1px rgba(37,99,235,.2);">ACCESS RFQ PORTAL</a>
            </div>
            <p style="font-size:12px;color:#94a3b8;text-align:center;">This link is unique to you. Do not share. Expires in 15 days.</p>
          </div>
          <div style="background:#0f172a;padding:15px;text-align:center;font-size:11px;color:#ffffff;">
            &copy; ${new Date().getFullYear()} SEMCO Groups. All rights reserved. | umesh.p@semcogroups.com
          </div>
        </div>`;

      let mailSent = false;
      let errorMsg = null;
      const recipientEmail = vendor.email;

      try {
        mailSent = await sendMailViaSmtp(recipientEmail, subject, emailHtml, rfq.excel_path, rfq.excel_filename);
        if (!mailSent) {
          errorMsg = 'SMTP_FAILED';
        }
      } catch (mailErr) {
        console.error(`[SMTP Error] ${vendor.email}:`, mailErr.message);
        errorMsg = mailErr.message;
      }

      results.push({
        vendor_id: vendorId,
        vendor_name: vendor.name,
        email: recipientEmail,
        success: mailSent,
        portal_url: targetUrl,
        details: errorMsg || 'Sent successfully'
      });
    }



    db.prepare("UPDATE rfqs SET status = 'Sent', available_from = ?, available_to = ? WHERE id = ?")
      .run(now.toISOString(), expiresISO, rfq_id);
    db.prepare(`INSERT INTO notifications (title,message) VALUES (?,?)`)
      .run('RFQ Dispatched', `${rfq.rfq_number} distributed to ${vendor_ids.length} vendors.`);
    logAudit(rfq.buyer_name || 'System', 'RFQ_DISTRIBUTE', `Dispatched ${rfq.rfq_number} to ${vendor_ids.length} vendors`, req);

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  VENDOR PORTAL — SECURE TOKEN ACCESS
// ═══════════════════════════════════════════════════════════
app.get('/api/vendor-portal/verify', (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, message: 'Token is required.' });

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ success: false, message: 'Invalid or expired vendor access token.' });
    }

    const { rfq_id, vendor_id } = decoded;
    const rfq    = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(rfq_id);
    const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendor_id);
    if (!vendor) {
      return res.status(404).json({ 
        success: false, 
        message: "Your account does not exist. Please contact the administrator for further assistance." 
      });
    }
    if (vendor.archived === 1) {
      return res.status(403).json({ success: false, message: 'Vendor account is disabled or inactive.' });
    }
    if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found.' });

    // Track "opened" status
    const dist = db.prepare('SELECT * FROM rfq_distributions WHERE rfq_id = ? AND vendor_id = ?').get(rfq_id, vendor_id);
    if (dist && dist.status === 'Sent') {
      db.prepare(`UPDATE rfq_distributions SET status = 'Opened', opened_at = datetime('now') WHERE rfq_id = ? AND vendor_id = ?`)
        .run(rfq_id, vendor_id);
      db.prepare(`INSERT INTO notifications (title,message) VALUES (?,?)`)
        .run('RFQ Portal Opened', `${vendor.name} opened portal for ${rfq.rfq_number}`);
      logAudit('Vendor Portal', 'RFQ_OPENED', `${vendor.name} opened portal for ${rfq.rfq_number}`, req);
    }

    // Fetch items with any existing quotes from this vendor
    const items = db.prepare(`
      SELECT i.*, q.rate, q.lead_time_days, q.payment_terms, q.remarks
      FROM rfq_items i
      LEFT JOIN vendor_quotes q ON i.id = q.item_id AND q.vendor_id = ?
      WHERE i.rfq_id = ?
    `).all(vendor_id, rfq_id);

    // Calculate live ranking
    let ranking = null;
    const allDists = db.prepare('SELECT * FROM rfq_distributions WHERE rfq_id = ?').all(rfq_id);
    const submittedDists = allDists
      .filter(d => d.status === 'Submitted')
      .sort((a, b) => (parseFloat(a.final_cost) || 0) - (parseFloat(b.final_cost) || 0));

    const totalBids = submittedDists.length;
    if (totalBids >= 2) {
      const idx = submittedDists.findIndex(d => d.vendor_id === vendor_id);
      if (idx !== -1) {
        ranking = {
          rank: idx + 1,
          total_bids: totalBids,
          is_l1: idx === 0
        };
      }
    }

    res.json({
      success: true,
      data: {
        rfq,
        vendor: {
          ...vendor,
          final_cost: dist ? dist.final_cost : 0.0,
          cgst_applicable: dist ? dist.cgst_applicable : 0,
          sgst_applicable: dist ? dist.sgst_applicable : 0,
          transport_included: dist ? (dist.transport_included || 0) : 0,
          transport_packaging: dist ? (dist.transport_packaging || 0.0) : 0.0,
          transport_freight: dist ? (dist.transport_freight || 0.0) : 0.0,
          transport_loading: dist ? (dist.transport_loading || 0.0) : 0.0,
          transport_other: dist ? (dist.transport_other || 0.0) : 0.0,
          payment_terms: dist ? (dist.payment_terms || '') : '',
          vendor_doc_name: dist ? (dist.vendor_doc_name || '') : '',
          vendor_doc_path: dist ? (dist.vendor_doc_path || '') : '',
          vendor_docs: dist ? (dist.vendor_docs || '[]') : '[]'
        },
        items,
        status: dist ? dist.status : 'Sent',
        excel_filename: rfq.excel_filename || '',
        ranking
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
// Vendor: upload multiple supporting documents (optional, sent to admin on final submit)
app.post('/api/vendor-portal/upload-doc', upload.array('files', 10), (req, res) => {
  const uploadedFiles = req.files || [];
  try {
    const { token } = req.body;
    if (!token) {
      uploadedFiles.forEach(f => cleanUpFile(f.path));
      return res.status(400).json({ success: false, message: 'Token is required.' });
    }
    if (uploadedFiles.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      uploadedFiles.forEach(f => cleanUpFile(f.path));
      return res.status(401).json({ success: false, message: 'Session expired.' });
    }

    const { rfq_id, vendor_id } = decoded;
    const fsSync = require('fs');

    // Remove previous vendor docs if they exist
    const prevDist = db.prepare('SELECT vendor_docs, vendor_doc_path FROM rfq_distributions WHERE rfq_id = ? AND vendor_id = ?').get(rfq_id, vendor_id);
    if (prevDist) {
      if (prevDist.vendor_docs) {
        try {
          const prevDocs = JSON.parse(prevDist.vendor_docs);
          if (Array.isArray(prevDocs)) {
            prevDocs.forEach(d => { if (d.path) cleanUpFile(d.path); });
          }
        } catch (_) {}
      }
      if (prevDist.vendor_doc_path) {
        cleanUpFile(prevDist.vendor_doc_path);
      }
    }

    const savedDocsList = [];
    uploadedFiles.forEach((file, idx) => {
      const safeOriginal = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const destName = `vendor_${vendor_id}_rfq_${rfq_id}_${idx}_${safeOriginal}`;
      const destPath = path.join(UPLOAD_DIR, destName);

      fsSync.renameSync(file.path, destPath);
      savedDocsList.push({ name: file.originalname, path: destPath });
    });

    const firstDoc = savedDocsList[0];
    db.prepare('UPDATE rfq_distributions SET vendor_doc_path = ?, vendor_doc_name = ?, vendor_docs = ? WHERE rfq_id = ? AND vendor_id = ?')
      .run(firstDoc.path, firstDoc.name, JSON.stringify(savedDocsList), rfq_id, vendor_id);

    logAudit(vendor_id, 'VENDOR_DOC_UPLOAD_MULTIPLE', `Vendor ${vendor_id} uploaded ${savedDocsList.length} supporting docs for RFQ ${rfq_id}`, req);
    res.json({ success: true, files: savedDocsList });
  } catch (err) {
    uploadedFiles.forEach(f => cleanUpFile(f.path));
    res.status(500).json({ success: false, message: err.message });
  }
});

// Vendor: submit or autosave rates
app.post('/api/vendor-portal/submit', (req, res) => {
  try {
    const { token, quotes, final_submit } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token is required.' });

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ success: false, message: 'Session expired.' });
    }

    const { rfq_id, vendor_id } = decoded;

    const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendor_id);
    if (!vendor || vendor.archived === 1) {
      return res.status(403).json({ success: false, message: 'Vendor account is disabled or inactive.' });
    }

    // Ensure not expired
    const rfq = db.prepare('SELECT status, available_to FROM rfqs WHERE id = ?').get(rfq_id);
    if (!rfq || rfq.status === 'Closed' || rfq.status === 'Expired' || (rfq.available_to && new Date() > new Date(rfq.available_to))) {
      return res.status(403).json({ success: false, message: 'This RFQ bidding window has expired. Quotes are no longer accepted.' });
    }

    // Ensure not already submitted
    const dist = db.prepare('SELECT status FROM rfq_distributions WHERE rfq_id = ? AND vendor_id = ?').get(rfq_id, vendor_id);
    if (dist && dist.status === 'Submitted') {
      return res.status(400).json({ success: false, message: 'Submission locked. Rates already finalized.' });
    }

    // Delete previous drafts & save new
    db.prepare('DELETE FROM vendor_quotes WHERE rfq_id = ? AND vendor_id = ?').run(rfq_id, vendor_id);

    const insertQ = db.prepare(`INSERT INTO vendor_quotes (rfq_id,vendor_id,item_id,rate,lead_time_days,payment_terms,remarks) VALUES (?,?,?,?,?,?,?)`);
    const saveTx = db.transaction((quotesList) => {
      for (const q of quotesList) {
        insertQ.run(rfq_id, vendor_id, q.item_id, parseFloat(q.rate) || 0, parseInt(q.lead_time) || 7, q.payment_terms || '', q.remarks || '');
      }
    });
    saveTx(quotes);

    const { 
      final_cost, 
      cgst_applicable, 
      sgst_applicable,
      transport_included,
      transport_packaging,
      transport_freight,
      transport_loading,
      transport_other,
      payment_terms
    } = req.body;

    if (final_submit) {
      db.prepare(`UPDATE rfq_distributions SET status = 'Submitted', submitted_at = datetime('now'), final_cost = ?, cgst_applicable = ?, sgst_applicable = ?, transport_included = ?, transport_packaging = ?, transport_freight = ?, transport_loading = ?, transport_other = ?, payment_terms = ? WHERE rfq_id = ? AND vendor_id = ?`)
        .run(
          parseFloat(final_cost) || 0.0, 
          cgst_applicable ? 1 : 0, 
          sgst_applicable ? 1 : 0,
          parseInt(transport_included) || 0,
          parseFloat(transport_packaging) || 0.0,
          parseFloat(transport_freight) || 0.0,
          parseFloat(transport_loading) || 0.0,
          parseFloat(transport_other) || 0.0,
          payment_terms || '',
          rfq_id, 
          vendor_id
        );
      
      notifyLiveRankingsForRFQ(rfq_id).catch(err => console.error("Error updating vendor rankings:", err));

      // Send admin notification email asynchronously
      (async () => {
        try {
          const rfqFull = db.prepare('SELECT rfq_number, project_name FROM rfqs WHERE id = ?').get(rfq_id);
          const currentDist = db.prepare('SELECT vendor_docs, vendor_doc_path, vendor_doc_name FROM rfq_distributions WHERE rfq_id = ? AND vendor_id = ?').get(rfq_id, vendor_id);
          const subject = `[New Bid] Vendor ${vendor.name} has submitted a quote for RFQ ${rfqFull.rfq_number}`;
          
          let attachmentPaths = null;
          let attachmentNames = null;
          let docsHtml = '';
          
          if (currentDist && currentDist.vendor_docs) {
            try {
              const docs = JSON.parse(currentDist.vendor_docs);
              if (Array.isArray(docs) && docs.length > 0) {
                attachmentPaths = docs.map(d => d.path);
                attachmentNames = docs.map(d => d.name);
                docsHtml = `<p><strong>Attached Supporting Documents:</strong></p><ul>` + docs.map(d => `<li>${d.name}</li>`).join('') + `</ul>`;
              }
            } catch (_) {}
          }
          
          if (!docsHtml && currentDist && currentDist.vendor_doc_name) {
            attachmentPaths = currentDist.vendor_doc_path;
            attachmentNames = currentDist.vendor_doc_name;
            docsHtml = `<p><strong>Attached Supporting Document:</strong> ${currentDist.vendor_doc_name}</p>`;
          }
          
          if (!docsHtml) {
            docsHtml = '<p>No supporting document attached.</p>';
          }

          const html = `
            <h3>New Bid Submission Notification</h3>
            <p><strong>Vendor Name:</strong> ${vendor.name}</p>
            <p><strong>RFQ Number:</strong> ${rfqFull.rfq_number}</p>
            <p><strong>Project Name:</strong> ${rfqFull.project_name || '-'}</p>
            <p><strong>Total Cost (Incl. Taxes/Transport):</strong> ₹${parseFloat(final_cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p><strong>Payment Terms Specified:</strong> ${payment_terms || '-'}</p>
            ${docsHtml}
            <br/>
            <p>This is an automated notification from the SEMCO Smart RFQ Workspace.</p>
          `;
          await sendMailViaSmtp('umesh.p@semcogroups.com', subject, html, attachmentPaths, attachmentNames);
        } catch (emailErr) {
          console.error("Failed to send admin notification email:", emailErr.message);
        }
      })().catch(err => console.error("Error in email async function:", err));
    } else {
      db.prepare(`UPDATE rfq_distributions SET final_cost = ?, cgst_applicable = ?, sgst_applicable = ?, transport_included = ?, transport_packaging = ?, transport_freight = ?, transport_loading = ?, transport_other = ?, payment_terms = ? WHERE rfq_id = ? AND vendor_id = ?`)
        .run(
          parseFloat(final_cost) || 0.0, 
          cgst_applicable ? 1 : 0, 
          sgst_applicable ? 1 : 0,
          parseInt(transport_included) || 0,
          parseFloat(transport_packaging) || 0.0,
          parseFloat(transport_freight) || 0.0,
          parseFloat(transport_loading) || 0.0,
          parseFloat(transport_other) || 0.0,
          payment_terms || '',
          rfq_id, 
          vendor_id
        );
    }

    res.json({ success: true, message: final_submit ? 'Quotation submitted successfully.' : 'Draft autosaved.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  COMPARATIVE ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════
app.get('/api/rfqs/:id/comparative', (req, res) => {
  try {
    const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
    if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found.' });

    const items = db.prepare('SELECT * FROM rfq_items WHERE rfq_id = ?').all(rfq.id);
    const distributions = db.prepare(`
      SELECT d.*, v.name AS vendor_name, v.preferred
      FROM rfq_distributions d JOIN vendors v ON d.vendor_id = v.id
      WHERE d.rfq_id = ?
    `).all(rfq.id);

    const quotes = db.prepare(`
      SELECT q.*, v.name AS vendor_name
      FROM vendor_quotes q JOIN vendors v ON q.vendor_id = v.id
      WHERE q.rfq_id = ?
    `).all(rfq.id);

    // Build quote map: quoteMap[item_id][vendor_id] = quoteObj
    const quoteMap = {};
    for (const q of quotes) {
      if (!quoteMap[q.item_id]) quoteMap[q.item_id] = {};
      quoteMap[q.item_id][q.vendor_id] = q;
    }

    // Comparative rows
    const rows = items.map(item => {
      const itemQ  = quoteMap[item.id] || {};
      const rates  = Object.values(itemQ).map(q => q.rate).filter(r => r > 0);
      const lowest  = rates.length > 0 ? Math.min(...rates) : 0;
      const highest = rates.length > 0 ? Math.max(...rates) : 0;
      const avg     = rates.length > 0 ? rates.reduce((s, r) => s + r, 0) / rates.length : 0;

      let recVendor = '';
      for (const [, q] of Object.entries(itemQ)) {
        if (q.rate === lowest && lowest > 0) { recVendor = q.vendor_name; break; }
      }

      return {
        item_id: item.id, moc: item.moc, description: item.description,
        make: item.make, size: item.size, quantity: item.quantity, unit: item.unit,
        quotes: itemQ, lowest, highest, average: avg, recommended_vendor: recVendor
      };
    });

    // L1/L2/L3 ranking
    const vendorTotals = {};
    for (const d of distributions) {
      vendorTotals[d.vendor_id] = {
        vendor_id: d.vendor_id, vendor_name: d.vendor_name,
        preferred: d.preferred, total_value: 0,
        avg_lead_time: 0, item_count: 0, status: d.status,
        final_cost: parseFloat(d.final_cost) || 0,
        transport_included: d.transport_included || 0,
        transport_packaging: d.transport_packaging || 0,
        transport_freight: d.transport_freight || 0,
        transport_loading: d.transport_loading || 0,
        transport_other: d.transport_other || 0,
        payment_terms: d.payment_terms || ''
      };
    }

    for (const item of items) {
      const itemQ = quoteMap[item.id] || {};
      for (const d of distributions) {
        const q = itemQ[d.vendor_id];
        if (q && q.rate > 0) {
          vendorTotals[d.vendor_id].total_value   += q.rate * item.quantity;
          vendorTotals[d.vendor_id].avg_lead_time += q.lead_time_days;
          vendorTotals[d.vendor_id].item_count    += 1;
        }
      }
    }

    const rankingArray = Object.values(vendorTotals)
      .map(v => { if (v.item_count > 0) v.avg_lead_time = Math.round(v.avg_lead_time / v.item_count); return v; })
      .filter(v => v.total_value > 0)
      .sort((a, b) => a.total_value - b.total_value);

    const rankings = rankingArray.map((v, i) => ({
      rank: i + 1,
      vendor_id: v.vendor_id,
      vendor: v.vendor_name,
      total_rate: v.total_value,
      lead_time: v.avg_lead_time,
      difference: i === 0 ? '0.0%' : (((v.total_value - rankingArray[0].total_value) / rankingArray[0].total_value) * 100).toFixed(1) + '%',
      preferred: v.preferred,
      final_cost: v.final_cost,
      transport_included: v.transport_included || 0,
      transport_packaging: v.transport_packaging || 0,
      transport_freight: v.transport_freight || 0,
      transport_loading: v.transport_loading || 0,
      transport_other: v.transport_other || 0,
      payment_terms: v.payment_terms || ''
    }));

    // Winner metrics
    let winningVendor = '', winningValue = 0, savingsAchieved = 0, pctAdvantage = 0;
    if (rankings.length > 0) {
      winningVendor = rankings[0].vendor;
      winningValue  = rankings[0].total_rate;
      if (rankings.length > 1) {
        const avgTot = rankings.reduce((s, r) => s + r.total_rate, 0) / rankings.length;
        savingsAchieved = Math.max(0, avgTot - winningValue);
        pctAdvantage    = ((avgTot - winningValue) / avgTot) * 100;
      }
    }

    res.json({
      success: true,
      data: {
        rfq,
        columns: distributions.map(d => ({ vendor_id: d.vendor_id, vendor_name: d.vendor_name })),
        rows,
        rankings,
        winner: {
          vendor: winningVendor,
          value: winningValue,
          savings: savingsAchieved.toFixed(2),
          advantage: pctAdvantage.toFixed(1) + '%'
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  AUDIT TRAIL & NOTIFICATIONS
// ═══════════════════════════════════════════════════════════
app.get('/api/audit-trail', (_req, res) => {
  try {
    const audits = db.prepare('SELECT * FROM audit_trail ORDER BY timestamp DESC LIMIT 50').all();
    res.json({ success: true, data: audits });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/notifications', (_req, res) => {
  try {
    const notifications = db.prepare('SELECT * FROM notifications ORDER BY timestamp DESC LIMIT 20').all();
    res.json({ success: true, data: notifications });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET all submissions for a vendor
app.get('/api/vendors/:id/submissions', (req, res) => {
  try {
    const vendorId = req.params.id;
    const quotes = db.prepare(`
      SELECT q.*, r.rfq_number, r.project_name, i.description, i.moc, i.size, i.quantity, i.unit, 
             d.final_cost, d.cgst_applicable, d.sgst_applicable, d.transport_included, 
             d.transport_packaging, d.transport_freight, d.transport_loading, d.transport_other,
             d.payment_terms
      FROM vendor_quotes q
      JOIN rfqs r ON q.rfq_id = r.id
      JOIN rfq_items i ON q.item_id = i.id
      LEFT JOIN rfq_distributions d ON q.rfq_id = d.rfq_id AND q.vendor_id = d.vendor_id
      WHERE q.vendor_id = ?
    `).all(vendorId);
    
    res.json({ success: true, data: quotes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET all submissions across all vendors
app.get('/api/submissions', (_req, res) => {
  try {
    const quotes = db.prepare(`
      SELECT q.rfq_id, q.vendor_id, q.item_id, q.rate, q.lead_time_days, q.remarks,
             r.rfq_number, r.project_name, i.description, i.moc, i.make, i.size, i.quantity, i.unit, 
             v.name as vendor_name, d.final_cost, d.cgst_applicable, d.sgst_applicable, d.submitted_at,
             d.transport_included, d.transport_packaging, d.transport_freight, d.transport_loading, d.transport_other,
             d.payment_terms
      FROM vendor_quotes q
      JOIN rfqs r ON q.rfq_id = r.id
      JOIN rfq_items i ON q.item_id = i.id
      JOIN vendors v ON q.vendor_id = v.id
      LEFT JOIN rfq_distributions d ON q.rfq_id = d.rfq_id AND q.vendor_id = d.vendor_id
      WHERE d.status = 'Submitted'
      ORDER BY d.submitted_at DESC
    `).all();
    res.json({ success: true, data: quotes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/vendors/:id/profile
app.post('/api/vendors/:id/profile', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, email, contact_person, phone, address, 
      bank_name, bank_address, account_name, account_type, account_number, ifsc_code,
      gst_number, pan_number, msme_status 
    } = req.body;

    const existing = db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Vendor not found.' });
    }

    db.prepare(`
      UPDATE vendors 
      SET name = ?, email = ?, contact_person = ?, phone = ?, address = ?, 
          bank_name = ?, bank_address = ?, account_name = ?, account_type = ?, account_number = ?, ifsc_code = ?, 
          gst_number = ?, pan_number = ?, msme_status = ?
      WHERE id = ?
    `).run(
      name !== undefined ? name : existing.name,
      email !== undefined ? email : existing.email,
      contact_person !== undefined ? contact_person : existing.contact_person,
      phone !== undefined ? phone : existing.phone,
      address !== undefined ? address : existing.address,
      bank_name !== undefined ? bank_name : (existing.bank_name || ''),
      bank_address !== undefined ? bank_address : (existing.bank_address || ''),
      account_name !== undefined ? account_name : (existing.account_name || ''),
      account_type !== undefined ? account_type : (existing.account_type || ''),
      account_number !== undefined ? account_number : (existing.account_number || ''),
      ifsc_code !== undefined ? ifsc_code : (existing.ifsc_code || ''),
      gst_number !== undefined ? gst_number : existing.gst_number,
      pan_number !== undefined ? pan_number : existing.pan_number,
      msme_status !== undefined ? msme_status : (existing.msme_status || 'No'),
      id
    );

    logAudit(req.headers['x-user'] || 'Vendor', 'VENDOR_PROFILE_UPDATE', `Updated company profile details for ${existing.name} (${id})`, req);

    // Send notification email to admin
    const subject = `[Notification] Partner Profile Updated — ${existing.name}`;
    const emailHtml = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;color:#333;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:8px;padding:24px;">
        <h3 style="color:#1e3a8a;border-bottom:2px solid #3b82f6;padding-bottom:8px;margin-top:0;">Partner Profile Submission Received</h3>
        <p>The vendor <strong>${existing.name}</strong> (${existing.email}) has filled/updated their company profile details on the portal.</p>
        
        <h4 style="color:#2563eb;margin-bottom:8px;">Updated Company Registry Information:</h4>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          <tr>
            <td style="padding:6px;font-weight:600;width:45%;border-bottom:1px solid #f1f5f9;color:#555;">Contact Person:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;font-weight:bold;">${contact_person || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Contact Number:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;font-weight:bold;">${phone || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Address of Company:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;">${address || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Name of Bank:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;">${bank_name || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Address of Bank:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;">${bank_address || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Account Name:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;">${account_name || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Account Type:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;">${account_type || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Account Number:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;font-family:monospace;font-weight:bold;">${account_number || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">IFSC Code:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;font-family:monospace;font-weight:bold;">${ifsc_code || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">GST Identification Number:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;font-family:monospace;font-weight:bold;">${gst_number || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Permanent Account Number (PAN):</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;font-family:monospace;font-weight:bold;">${pan_number || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">MSME Company Status:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;font-weight:bold;color:${msme_status === 'Yes' ? '#16a34a' : '#dc2626'};">${msme_status || 'No'}</td>
          </tr>
        </table>
        
        <p style="font-size:12px;color:#64748b;text-align:center;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px;">This is an automated notification from the SEMCO Smart RFQ System.</p>
      </div>
    `;
    
    await sendMailViaSmtp('umesh.p@semcogroups.com', subject, emailHtml);

    res.json({ success: true, message: 'Profile updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/transporters/:id/profile', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, email, contact_person, phone, address, 
      bank_name, bank_address, account_name, account_type, account_number, ifsc_code,
      gst_number, pan_number 
    } = req.body;

    const existing = db.prepare('SELECT * FROM transporters WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Transporter not found.' });
    }

    db.prepare(`
      UPDATE transporters 
      SET name = ?, email = ?, contact_person = ?, phone = ?, address = ?, 
          bank_name = ?, bank_address = ?, account_name = ?, account_type = ?, account_number = ?, ifsc_code = ?, 
          gst_number = ?, pan_number = ?
      WHERE id = ?
    `).run(
      name !== undefined ? name : existing.name,
      email !== undefined ? email : existing.email,
      contact_person !== undefined ? contact_person : existing.contact_person,
      phone !== undefined ? phone : existing.phone,
      address !== undefined ? address : existing.address,
      bank_name !== undefined ? bank_name : (existing.bank_name || ''),
      bank_address !== undefined ? bank_address : (existing.bank_address || ''),
      account_name !== undefined ? account_name : (existing.account_name || ''),
      account_type !== undefined ? account_type : (existing.account_type || ''),
      account_number !== undefined ? account_number : (existing.account_number || ''),
      ifsc_code !== undefined ? ifsc_code : (existing.ifsc_code || ''),
      gst_number !== undefined ? gst_number : existing.gst_number,
      pan_number !== undefined ? pan_number : existing.pan_number,
      id
    );

    logAudit(req.headers['x-user'] || 'Transporter', 'TRANSPORTER_PROFILE_UPDATE', `Updated company profile details for ${existing.name} (${id})`, req);

    // Send notification email to admin
    const subject = `[Notification] Partner Profile Updated — ${existing.name}`;
    const emailHtml = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;color:#333;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:8px;padding:24px;">
        <h3 style="color:#1e3a8a;border-bottom:2px solid #3b82f6;padding-bottom:8px;margin-top:0;">Partner Profile Submission Received</h3>
        <p>The transporter <strong>${existing.name}</strong> (${existing.email}) has filled/updated their company profile details on the portal.</p>
        
        <h4 style="color:#2563eb;margin-bottom:8px;">Updated Company Registry Information:</h4>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          <tr>
            <td style="padding:6px;font-weight:600;width:45%;border-bottom:1px solid #f1f5f9;color:#555;">Contact Person:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;font-weight:bold;">${contact_person || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Contact Number:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;font-weight:bold;">${phone || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Address of Company:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;">${address || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Name of Bank:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;">${bank_name || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Address of Bank:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;">${bank_address || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Account Name:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;">${account_name || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Account Type:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;">${account_type || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Account Number:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;font-family:monospace;font-weight:bold;">${account_number || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">IFSC Code:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;font-family:monospace;font-weight:bold;">${ifsc_code || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">GST Identification Number:</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;font-family:monospace;font-weight:bold;">${gst_number || '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px;font-weight:600;border-bottom:1px solid #f1f5f9;color:#555;">Permanent Account Number (PAN):</td>
            <td style="padding:6px;border-bottom:1px solid #f1f5f9;font-family:monospace;font-weight:bold;">${pan_number || '-'}</td>
          </tr>
        </table>
        
        <p style="font-size:12px;color:#64748b;text-align:center;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px;">This is an automated notification from the SEMCO Smart RFQ System.</p>
      </div>
    `;
    
    await sendMailViaSmtp('umesh.p@semcogroups.com', subject, emailHtml);

    res.json({ success: true, message: 'Profile updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/notifications/clear', (_req, res) => {
  try {
    db.prepare('DELETE FROM notifications').run();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  TRANSPORTER MODULE APIs
// ═══════════════════════════════════════════════════════════

// GET all transporters
app.get('/api/transporters', (_req, res) => {
  try {
    const transporters = db.prepare('SELECT * FROM transporters WHERE archived = 0 ORDER BY name ASC').all();
    res.json({ success: true, data: transporters });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET archived transporters
app.get('/api/transporters/archived', (_req, res) => {
  try {
    const transporters = db.prepare('SELECT * FROM transporters WHERE archived = 1 ORDER BY name ASC').all();
    res.json({ success: true, data: transporters });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create transporter
app.post('/api/transporters', (req, res) => {
  try {
    const b = req.body;
    const id = nextTransporterId();
    db.prepare(`
      INSERT INTO transporters (id, name, contact_person, email, phone, company_name, gst_number, pan_number, address, category, rating)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      b.name || 'Unknown',
      b.contact_person || '',
      b.email || '',
      b.phone || '',
      b.company_name || b.name || '',
      b.gst_number || '',
      b.pan_number || '',
      b.address || '',
      b.category || 'Others',
      b.rating || 4.0
    );
    logAudit(req.headers['x-user'] || 'Admin', 'TRANSPORTER_CREATE', `Added transporter ${b.name} (${id})`, req);
    res.json({ success: true, id, message: `Transporter ${b.name} added successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT update transporter
app.put('/api/transporters/:id', (req, res) => {
  try {
    const { id } = req.params;
    const b = req.body;
    const existing = db.prepare('SELECT * FROM transporters WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Transporter not found.' });
    }
    db.prepare(`
      UPDATE transporters
      SET name = ?, contact_person = ?, email = ?, phone = ?, company_name = ?, gst_number = ?, pan_number = ?, address = ?, rating = ?, category = ?
      WHERE id = ?
    `).run(
      b.name || existing.name,
      b.contact_person !== undefined ? b.contact_person : existing.contact_person,
      b.email !== undefined ? b.email : existing.email,
      b.phone !== undefined ? b.phone : existing.phone,
      b.company_name !== undefined ? b.company_name : existing.company_name,
      b.gst_number !== undefined ? b.gst_number : existing.gst_number,
      b.pan_number !== undefined ? b.pan_number : existing.pan_number,
      b.address !== undefined ? b.address : existing.address,
      b.rating !== undefined ? b.rating : existing.rating,
      b.category !== undefined ? b.category : existing.category,
      id
    );
    logAudit(req.headers['x-user'] || 'Admin', 'TRANSPORTER_UPDATE', `Updated transporter ${b.name || existing.name} (${id})`, req);
    res.json({ success: true, message: `Transporter updated successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE transporter (archive / delete)
app.delete('/api/transporters/:id', (req, res) => {
  try {
    const role = req.headers['x-role'] || 'Admin';
    if (role !== 'Procurement Admin' && role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized. Only Procurement Admin or Admin can delete transporters.' });
    }
    const { id } = req.params;
    const transporter = db.prepare('SELECT * FROM transporters WHERE id = ?').get(id);
    if (!transporter) return res.status(404).json({ success: false, message: 'Transporter not found.' });

    if (transporter.archived === 1) {
      db.prepare('DELETE FROM transporters WHERE id = ?').run(id);
      db.prepare('DELETE FROM users WHERE transporter_id = ?').run(id);
      logAudit(req.headers['x-user'] || 'Admin', 'TRANSPORTER_HARD_DELETE', `Hard deleted transporter ${transporter.name} (${id})`, req);
      res.json({ success: true, message: `Transporter ${transporter.name} permanently deleted.` });
    } else {
      db.prepare('UPDATE transporters SET archived = 1 WHERE id = ?').run(id);
      logAudit(req.headers['x-user'] || 'Admin', 'TRANSPORTER_ARCHIVE', `Archived transporter ${transporter.name} (${id})`, req);
      res.json({ success: true, message: `Transporter ${transporter.name} archived successfully.` });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT restore transporter
app.put('/api/transporters/:id/restore', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('UPDATE transporters SET archived = ? WHERE id = ?').run(0, id);
    logAudit(req.headers['x-user'] || 'Admin', 'TRANSPORTER_RESTORE', `Restored transporter ${id}`, req);
    res.json({ success: true, message: 'Transporter restored successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET all transport requests
app.get('/api/transport-requests', (_req, res) => {
  try {
    const requests = db.prepare('SELECT r.* FROM transport_requests r').all();
    res.json({ success: true, data: requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET single transport request detail
app.get('/api/transport-requests/:id', (req, res) => {
  try {
    const r = db.prepare('SELECT * FROM transport_requests WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ success: false, message: 'Request not found.' });
    const items = db.prepare('SELECT * FROM transport_request_items WHERE request_id = ?').all(r.id);
    const distributions = db.prepare(`
      SELECT d.*, t.name AS transporter_name, t.email AS transporter_email
      FROM transport_distributions d
      JOIN transporters t ON d.transporter_id = t.id
      WHERE d.request_id = ?
    `).all(r.id);
    res.json({ success: true, data: { ...r, items, distributions } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create draft transport request
app.post('/api/transport-requests', (req, res) => {
  try {
    const { 
      from_location, to_location, required_date, items,
      distance, vehicle_available_from, vehicle_size, vehicle_tonnage,
      actual_weight_charged, odc_charges, weight_unit, tax_bracket,
      initial_window_hours, expires_at
    } = req.body;
    if (!from_location || !to_location || !required_date) {
      return res.status(400).json({ success: false, message: 'From, To, and Date are required.' });
    }
    const id = 'trq_' + Date.now();
    const reqNum = 'TRQ-' + Date.now().toString().slice(-6);

    db.prepare(`
      INSERT INTO transport_requests (
        id, request_number, from_location, to_location, required_date, status,
        distance, vehicle_available_from, vehicle_size, vehicle_tonnage,
        actual_weight_charged, odc_charges, weight_unit, tax_bracket,
        initial_window_hours, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, reqNum, from_location, to_location, required_date, 'Draft',
      parseFloat(distance) || 0.0,
      vehicle_available_from || null,
      vehicle_size || '',
      parseFloat(vehicle_tonnage) || 0.0,
      parseFloat(actual_weight_charged) || 0.0,
      parseFloat(odc_charges) || 0.0,
      weight_unit || 'Tons',
      parseFloat(tax_bracket) || 0.0,
      initial_window_hours || '12',
      expires_at || null
    );

    if (items && Array.isArray(items)) {
      for (const item of items) {
        db.prepare(`
          INSERT INTO transport_request_items
            (request_id, material_name, material_category, vehicle_type, size_ft, quantity, unit, odc_charges, remarks)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          item.material_name  || '',
          item.material_category || '',
          item.vehicle_type   || '',
          parseFloat(item.size_ft)      || 0,
          parseFloat(item.quantity)     || 0,
          item.unit           || 'Ton',
          parseFloat(item.odc_charges)  || 0,
          item.remarks        || ''
        );
      }
    }

    logAudit(req.headers['x-user'] || 'Admin', 'TRANSPORT_REQ_CREATE', `Created draft request ${reqNum}`, req);
    res.json({ success: true, id, request_number: reqNum, message: 'Transport request draft created.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE transport request
app.delete('/api/transport-requests/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM transport_requests WHERE id = ?').run(id);
    logAudit(req.headers['x-user'] || 'Admin', 'TRANSPORT_REQ_DELETE', `Deleted transport request ${id}`, req);
    res.json({ success: true, message: 'Transport request deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST distribute/launch transport request
app.post('/api/transport-requests/distribute', async (req, res) => {
  try {
    const { request_id, transporter_ids } = req.body;
    if (!request_id || !transporter_ids || !Array.isArray(transporter_ids) || transporter_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Request ID and transporters are required.' });
    }

    const request = db.prepare('SELECT * FROM transport_requests WHERE id = ?').get(request_id);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });

    const now = new Date();
    let startTime = now;
    let initialStatus = 'Sent';
    
    if (request.vehicle_available_from && new Date(request.vehicle_available_from) > now) {
      startTime = new Date(request.vehicle_available_from);
      initialStatus = 'Scheduled';
    }

    // Calculate expires_at based on initial_window_hours and start time
    let expires = null;
    const windowHrs = request.initial_window_hours || '12';
    if (windowHrs === 'custom') {
      expires = request.expires_at ? new Date(request.expires_at) : new Date(startTime.getTime() + 12 * 60 * 60 * 1000);
    } else {
      const hrs = parseFloat(windowHrs) || 12;
      expires = new Date(startTime.getTime() + hrs * 60 * 60 * 1000);
    }
    const expiresISO = expires.toISOString();

    db.prepare(`
      UPDATE transport_requests
      SET status = ?, launched_at = ?, expires_at = ?
      WHERE id = ?
    `).run(initialStatus, now.toISOString(), expiresISO, request_id);

    // Delete existing distributions if any
    db.prepare('DELETE FROM transport_distributions WHERE request_id = ?').run(request_id);

    const launchedTransporters = [];

    for (const tId of transporter_ids) {
      const transporter = db.prepare('SELECT * FROM transporters WHERE id = ?').get(tId);
      if (!transporter) continue;

      const token = jwt.sign(
        { request_id, transporter_id: tId, type: 'transport' },
        JWT_SECRET,
        { expiresIn: '15d' }
      );

      db.prepare(`
        INSERT INTO transport_distributions (
          request_id, transporter_id, token, status, sent_at, opened_at, submitted_at,
          distance, vehicle_available_from, vehicle_size, vehicle_tonnage, actual_weight_charged, rate_per_ton, final_cost, reminder_60_sent, reminder_30_sent
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, NULL, '', 0, 0, 0, 0, 0, 0)
      `).run(request_id, tId, token, initialStatus, now.toISOString());

      if (initialStatus === 'Sent') {
        // Send registration and request access email immediately
        const portalUrl = `${getFrontendUrl(req)}/index.html?transport_token=${token}`;
        const subject = `New Transport Bid Request: ${request.request_number} — SEMCO Groups`;
        const emailHtml = `
          <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
            <div style="background:#0f172a;padding:25px;text-align:center;border-bottom:3px solid #3b82f6;">
              <h1 style="color:#fff;margin:0;font-size:20px;">🚚 NEW TRANSPORT BID REQUEST</h1>
            </div>
            <div style="padding:30px;background:#fff;">
              <p style="font-size:15px;margin-top:0;">Dear <strong>${transporter.contact_person || transporter.name}</strong>,</p>
              <p style="line-height:1.6;font-size:14px;">We request your transport quote for the following route details:</p>
              <div style="background:#f0f9ff;padding:15px;border-radius:6px;margin:20px 0;border-left:4px solid #3b82f6;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                  <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;width:130px;">Request Number:</td><td style="font-weight:700;">${request.request_number}</td></tr>
                  <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;">Route:</td><td>${request.from_location} to ${request.to_location}</td></tr>
                  <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;">Required Date:</td><td>${formatDateDDMMYYYY(request.required_date)}</td></tr>
                  <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;">Expires At:</td><td style="color:#dc2626;font-weight:600;">${(() => {
                    const pad = (n) => n.toString().padStart(2, '0');
                    const d = pad(expires.getDate());
                    const m = pad(expires.getMonth() + 1);
                    const y = expires.getFullYear();
                    const timeStr = expires.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                    return `${d}/${m}/${y} ${timeStr}`;
                  })()}</td></tr>
                </table>
              </div>
              <div style="text-align:center;margin:30px 0;">
                <a href="${portalUrl}" target="_blank" style="background:#2563eb;color:#fff;font-weight:600;text-decoration:none;padding:12px 30px;border-radius:6px;display:inline-block;">ACCESS PORTAL & SUBMIT BID</a>
              </div>
            </div>
            <div style="background:#0f172a;padding:15px;text-align:center;font-size:11px;color:#ffffff;">&copy; ${new Date().getFullYear()} SEMCO Groups | umesh.p@semcogroups.com</div>
          </div>`;

        try {
          await sendMailViaSmtp(transporter.email, subject, emailHtml);
        } catch (mailErr) {
          console.error(`[SMTP Launch Error] ${transporter.email}:`, mailErr.message);
        }
      }

      launchedTransporters.push(transporter.name);
    }

    if (initialStatus === 'Sent') {
      db.prepare(`INSERT INTO notifications (title, message, rfq_id) VALUES (?, ?, ?)`)
        .run('Transport Request Distributed', `Sent to ${launchedTransporters.length} transporters for request ${request.request_number}.`, request_id);
      logAudit(req.headers['x-user'] || 'Admin', 'TRANSPORT_REQ_DISTRIBUTE', `Sent request ${request.request_number} to ${launchedTransporters.length} transporters`, req);
    } else {
      db.prepare(`INSERT INTO notifications (title, message, rfq_id) VALUES (?, ?, ?)`)
        .run('Transport Request Scheduled', `Scheduled request ${request.request_number} for ${launchedTransporters.length} transporters. Will start at ${request.vehicle_available_from}.`, request_id);
      logAudit(req.headers['x-user'] || 'Admin', 'TRANSPORT_REQ_SCHEDULE', `Scheduled request ${request.request_number} to start at ${request.vehicle_available_from}`, req);
    }

    res.json({ success: true, data: launchedTransporters, status: initialStatus });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET verify transport token
app.get('/api/transporter-portal/verify', (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, message: 'Token is required.' });

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token link.' });
    }

    const dist = db.prepare('SELECT d.*, r.request_number, r.from_location, r.to_location, r.required_date, r.expires_at, r.status as request_status FROM transport_distributions d JOIN transport_requests r ON d.request_id = r.id WHERE d.token = ?').get(token);
    if (!dist) {
      return res.status(404).json({ success: false, message: 'Transport request distribution not found.' });
    }

    // Check if scheduled
    if (dist.status === 'Scheduled' || dist.request_status === 'Scheduled') {
      return res.status(403).json({ success: false, message: 'This transport request is scheduled and will be active only after its start time.' });
    }

    // Check expiration — allow submitted distributions through so they can view their bid
    if (dist.status !== 'Submitted' && (dist.request_status === 'Expired' || new Date() > new Date(dist.expires_at))) {
      if (dist.status !== 'Expired') {
        db.prepare("UPDATE transport_distributions SET status = 'Expired' WHERE token = ?").run(token);
        db.prepare("UPDATE transport_requests SET status = 'Expired' WHERE id = ? AND status != 'Submitted' AND status != 'Closed'").run(dist.request_id);
      }
      return res.status(403).json({ success: false, message: 'This bid request window has expired. Quotes are no longer accepted.' });
    }

    // If status is 'Sent', update to 'Opened'
    if (dist.status === 'Sent') {
      db.prepare("UPDATE transport_distributions SET status = 'Opened', opened_at = ? WHERE token = ?").run(new Date().toISOString(), token);
      dist.status = 'Opened';
    }

    const items = db.prepare('SELECT * FROM transport_request_items WHERE request_id = ?').all(dist.request_id);
    const transporter = db.prepare('SELECT * FROM transporters WHERE id = ?').get(dist.transporter_id);
    if (!transporter || transporter.archived === 1) {
      return res.status(403).json({ success: false, message: 'Transporter account is disabled or inactive.' });
    }

    // Calculate live ranking
    let ranking = null;
    const allDists = db.prepare('SELECT * FROM transport_distributions WHERE request_id = ?').all(dist.request_id);
    const submittedDists = allDists
      .filter(d => d.status === 'Submitted')
      .sort((a, b) => (parseFloat(a.final_cost) || 0) - (parseFloat(b.final_cost) || 0));

    const totalBids = submittedDists.length;
    if (totalBids >= 2) {
      const idx = submittedDists.findIndex(d => d.transporter_id === dist.transporter_id);
      if (idx !== -1) {
        ranking = {
          rank: idx + 1,
          total_bids: totalBids,
          is_l1: idx === 0
        };
      }
    }

    res.json({
      success: true,
      data: {
        request: {
          id: dist.request_id,
          request_number: dist.request_number,
          from_location: dist.from_location,
          to_location: dist.to_location,
          required_date: dist.required_date,
          expires_at: dist.expires_at,
          items
        },
        transporter,
        distribution: dist,
        ranking
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST submit transport quote
app.post('/api/transporter-portal/submit', (req, res) => {
  try {
    const { token, distance, vehicle_available_from, vehicle_size, vehicle_tonnage, actual_weight_charged, rate_per_ton,
            start_location, end_location, odc_charges, weight_unit, tax_bracket, return_trip_included, return_trip_rate, payment_terms } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token is required.' });

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token link.' });
    }

    const dist = db.prepare('SELECT d.*, r.request_number, r.expires_at, r.status as request_status FROM transport_distributions d JOIN transport_requests r ON d.request_id = r.id WHERE d.token = ?').get(token);
    if (!dist) return res.status(404).json({ success: false, message: 'Submission record not found.' });

    const transporter = db.prepare('SELECT * FROM transporters WHERE id = ?').get(dist.transporter_id);
    if (!transporter || transporter.archived === 1) {
      return res.status(403).json({ success: false, message: 'Transporter account is disabled or inactive.' });
    }

    // Check if scheduled
    if (dist.status === 'Scheduled' || dist.request_status === 'Scheduled') {
      return res.status(403).json({ success: false, message: 'This transport request is scheduled and will be active only after its start time.' });
    }

    // Check if expired
    if (dist.request_status === 'Expired' || new Date() > new Date(dist.expires_at)) {
      if (dist.status !== 'Submitted' && dist.status !== 'Expired') {
        db.prepare("UPDATE transport_distributions SET status = 'Expired' WHERE token = ?").run(token);
      }
      return res.status(403).json({ success: false, message: 'The 1-hour submission window has expired.' });
    }

    const weight = parseFloat(actual_weight_charged) || 1; // always 1 for flat-rate trips
    const rate = parseFloat(rate_per_ton) || 0;
    const odc = parseFloat(odc_charges) || 0;
    const taxPct = parseFloat(tax_bracket) || 0;
    const returnTripIncludedVal = return_trip_included === true || return_trip_included === 1 || return_trip_included === '1' || return_trip_included === 'true' ? 1 : 0;
    const returnTripRateVal = parseFloat(return_trip_rate) || 0.0;

    // Use client-sent final_cost if provided (computed by UI to match live breakdown),
    // otherwise recompute using forward formula:
    // subtotal = tripRate + odc, taxable = subtotal + returnRate, tax = taxable × GST%, total = taxable + tax
    let final_cost;
    if (req.body.final_cost !== undefined && parseFloat(req.body.final_cost) > 0) {
      final_cost = parseFloat(req.body.final_cost);
    } else {
      const subtotal = rate + odc;
      const taxableBase = subtotal + (returnTripIncludedVal ? returnTripRateVal : 0);
      const taxAmount = taxableBase * (taxPct / 100);
      final_cost = taxableBase + taxAmount;
    }

    db.prepare(`
      UPDATE transport_distributions
      SET status = 'Submitted', submitted_at = ?, distance = ?, vehicle_available_from = ?, vehicle_size = ?, vehicle_tonnage = ?, actual_weight_charged = ?, rate_per_ton = ?, final_cost = ?,
          start_location = ?, end_location = ?, odc_charges = ?, weight_unit = ?, tax_bracket = ?, return_trip_included = ?, return_trip_rate = ?, payment_terms = ?
      WHERE token = ?
    `).run(
      new Date().toISOString(),
      parseFloat(distance) || 0,
      vehicle_available_from || null,
      vehicle_size || '',
      parseFloat(vehicle_tonnage) || 0,
      weight,
      rate,
      final_cost,
      start_location || '',
      end_location || '',
      odc,
      weight_unit || 'Tons',
      taxPct,
      returnTripIncludedVal,
      returnTripRateVal,
      payment_terms || '',
      token
    );

    // Update transport request status to 'Submitted' if it was not closed or expired
    db.prepare("UPDATE transport_requests SET status = 'Submitted' WHERE id = ? AND status = 'Sent'").run(dist.request_id);

    db.prepare(`INSERT INTO notifications (title, message, rfq_id) VALUES (?, ?, ?)`)
      .run('Transport Bid Submitted', `Transporter bid received for Request ${dist.request_number}.`, dist.request_id);

    logAudit('Transporter Portal', 'TRANSPORT_BID_SUBMIT', `Submitted bid for request ${dist.request_number}. Cost: Rs. ${final_cost}`, req);
    
    notifyLiveRankingsForTransportRequest(dist.request_id).catch(err => console.error("Error updating transporter rankings:", err));
    
    res.json({ success: true, message: 'Transport bid submitted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET transport request comparative summary
app.get('/api/transport-requests/:id/comparative', (req, res) => {
  try {
    const requestId = req.params.id;
    const request = db.prepare('SELECT * FROM transport_requests WHERE id = ?').get(requestId);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });

    const items = db.prepare('SELECT * FROM transport_request_items WHERE request_id = ?').all(requestId);
    const distributions = db.prepare(`
      SELECT d.*, t.name AS transporter_name, t.contact_person, t.email AS transporter_email
      FROM transport_distributions d
      JOIN transporters t ON d.transporter_id = t.id
      WHERE d.request_id = ?
    `).all(requestId);

    const rows = items.map(item => {
      const row = {
        item_id: item.id,
        material_name: item.material_name,
        material_category: item.material_category,
        quantity: item.quantity,
        unit: item.unit,
        remarks: item.remarks,
        bids: {}
      };

      distributions.forEach(d => {
        row.bids[d.transporter_id] = {
          status: d.status,
          distance: d.distance,
          available_from: d.vehicle_available_from,
          vehicle_size: d.vehicle_size,
          vehicle_tonnage: d.vehicle_tonnage,
          actual_weight: d.actual_weight_charged,
          rate_per_ton: d.rate_per_ton,
          final_cost: d.final_cost,
          start_location: d.start_location,
          end_location: d.end_location,
          odc_charges: d.odc_charges,
          weight_unit: d.weight_unit,
          tax_bracket: d.tax_bracket,
          return_trip_included: d.return_trip_included,
          return_trip_rate: d.return_trip_rate,
          payment_terms: d.payment_terms || ''
        };
      });
      return row;
    });

    const submittedDists = distributions.filter(d => d.status === 'Submitted');
    const rankings = submittedDists.map(d => ({
      transporter_id: d.transporter_id,
      transporter_name: d.transporter_name,
      final_cost: d.final_cost,
      distance: d.distance,
      rate_per_ton: d.rate_per_ton,
      actual_weight_charged: d.actual_weight_charged,
      start_location: d.start_location,
      end_location: d.end_location,
      odc_charges: d.odc_charges,
      weight_unit: d.weight_unit,
      tax_bracket: d.tax_bracket,
      return_trip_included: d.return_trip_included,
      return_trip_rate: d.return_trip_rate,
      payment_terms: d.payment_terms || ''
    }));
    rankings.sort((a, b) => a.final_cost - b.final_cost);

    let winningTransporter = null;
    let winningValue = 0;
    if (rankings.length > 0) {
      winningTransporter = rankings[0].transporter_name;
      winningValue = rankings[0].final_cost;
    }

    res.json({
      success: true,
      data: {
        request,
        columns: distributions.map(d => ({
          transporter_id: d.transporter_id,
          transporter_name: d.transporter_name,
          return_trip_included: d.return_trip_included,
          return_trip_rate: d.return_trip_rate
        })),
        rows,
        rankings,
        winner: winningTransporter ? {
          transporter: winningTransporter,
          value: winningValue
        } : null
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST send reminders to transporters
app.post('/api/transport-requests/:id/remind', async (req, res) => {
  try {
    const request = db.prepare('SELECT * FROM transport_requests WHERE id = ?').get(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Transport Request not found.' });

    const pending = db.prepare(`
      SELECT d.*, t.name AS transporter_name, t.email AS transporter_email, t.contact_person
      FROM transport_distributions d
      JOIN transporters t ON d.transporter_id = t.id
      WHERE d.request_id = ? AND d.status != 'Submitted'
    `).all(request.id);

    const sentTransporters = [];

    for (const d of pending) {
      const portalUrl = `${getFrontendUrl(req)}/index.html?transport_token=${d.token}`;
      const subject = `REMINDER: Transport Bid Request ${request.request_number} — SEMCO Groups`;
      const emailHtml = `
        <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
          <div style="background:#0f172a;padding:25px;text-align:center;border-bottom:3px solid #3b82f6;">
            <h1 style="color:#fff;margin:0;font-size:20px;">🚨 TRANSPORT BID REMINDER</h1>
            <p style="color:#60a5fa;margin:5px 0 0;font-size:13px;">Submission Pending</p>
          </div>
          <div style="padding:30px;background:#fff;">
            <p style="font-size:15px;margin-top:0;">Dear <strong>${d.contact_person || d.transporter_name}</strong>,</p>
            <p style="line-height:1.6;font-size:14px;">This is a friendly reminder that we are awaiting your transport quotation for:</p>
            <div style="background:#f0f9ff;padding:15px;border-radius:6px;margin:20px 0;border-left:4px solid #3b82f6;">
              <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;width:130px;">Request Number:</td><td style="font-weight:700;">${request.request_number}</td></tr>
                <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;">Route:</td><td>${request.from_location} to ${request.to_location}</td></tr>
                <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;">Required Date:</td><td>${request.required_date}</td></tr>
              </table>
            </div>
            <div style="text-align:center;margin:30px 0;">
              <a href="${portalUrl}" target="_blank" style="background:#2563eb;color:#fff;font-weight:600;text-decoration:none;padding:12px 30px;border-radius:6px;display:inline-block;">ACCESS PORTAL & SUBMIT BID</a>
            </div>
          </div>
          <div style="background:#0f172a;padding:15px;text-align:center;font-size:11px;color:#ffffff;">&copy; ${new Date().getFullYear()} SEMCO Groups | umesh.p@semcogroups.com</div>
        </div>`;

      try {
        await sendMailViaSmtp(d.transporter_email, subject, emailHtml);
      } catch (mailErr) {
        console.error(`[SMTP Transport Reminder Error] ${d.transporter_email}:`, mailErr.message);
      }
      sentTransporters.push(d.transporter_name);
    }

    db.prepare(`INSERT INTO notifications (title, message, rfq_id) VALUES (?, ?, ?)`)
      .run('Transport Reminders Sent', `Follow-up reminders sent to ${pending.length} transporters for request ${request.request_number}.`, request.id);
    logAudit(req.headers['x-user'] || 'Admin', 'TRANSPORT_REQ_REMIND', `Sent reminders for request ${request.request_number} to ${pending.length} transporters`, req);

    res.json({ success: true, data: sentTransporters });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST close bidding manually
app.post('/api/transport-requests/:id/close', (req, res) => {
  try {
    const request = db.prepare('SELECT * FROM transport_requests WHERE id = ?').get(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Transport Request not found.' });

    db.prepare("UPDATE transport_requests SET status = 'Closed' WHERE id = ?").run(request.id);
    db.prepare("UPDATE transport_distributions SET status = 'Expired' WHERE request_id = ? AND status != 'Submitted'").run(request.id);

    db.prepare(`INSERT INTO notifications (title, message, rfq_id) VALUES (?, ?, ?)`)
      .run('Transport Bidding Closed', `Bidding window closed manually for request ${request.request_number}.`, request.id);
    logAudit(req.headers['x-user'] || 'Admin', 'TRANSPORT_REQ_CLOSE', `Closed bidding for request ${request.request_number}`, req);

    res.json({ success: true, message: 'Bidding closed successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST close RFQ bidding manually
app.post('/api/rfqs/:id/close', (req, res) => {
  try {
    const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
    if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found.' });

    db.prepare("UPDATE rfqs SET status = 'Closed' WHERE id = ?").run(rfq.id);
    db.prepare("UPDATE rfq_distributions SET status = 'Expired' WHERE rfq_id = ? AND status != 'Submitted'").run(rfq.id);

    db.prepare(`INSERT INTO notifications (title, message, rfq_id) VALUES (?, ?, ?)`)
      .run('RFQ Bidding Closed', `Bidding window closed manually for RFQ ${rfq.rfq_number}.`, rfq.id);
    logAudit(req.headers['x-user'] || 'Admin', 'RFQ_CLOSE', `Closed bidding for RFQ ${rfq.rfq_number}`, req);

    res.json({ success: true, message: 'RFQ Bidding closed successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST finalise RFQ and notify non-L1 vendors
app.post('/api/rfqs/:id/finalise', async (req, res) => {
  try {
    const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
    if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found.' });

    // Set RFQ to Closed
    db.prepare("UPDATE rfqs SET status = 'Closed' WHERE id = ?").run(rfq.id);
    db.prepare("UPDATE rfq_distributions SET status = 'Expired' WHERE rfq_id = ? AND status != 'Submitted'").run(rfq.id);

    // Calculate L1 rankings
    const items = db.prepare('SELECT * FROM rfq_items WHERE rfq_id = ?').all(rfq.id);
    const distributions = db.prepare(`
      SELECT d.*, v.name AS vendor_name, v.email AS vendor_email, v.contact_person
      FROM rfq_distributions d
      JOIN vendors v ON d.vendor_id = v.id
      WHERE d.rfq_id = ?
    `).all(rfq.id);

    const quotes = db.prepare(`
      SELECT q.* FROM vendor_quotes q
      JOIN rfq_items i ON q.item_id = i.id
      WHERE i.rfq_id = ?
    `).all(rfq.id);

    const quoteMap = {};
    quotes.forEach(q => {
      if (!quoteMap[q.item_id]) quoteMap[q.item_id] = {};
      quoteMap[q.item_id][q.vendor_id] = q;
    });

    const vendorTotals = [];
    distributions.forEach(d => {
      let total_value = 0;
      let submitted_count = 0;
      items.forEach(item => {
        const q = (quoteMap[item.id] || {})[d.vendor_id];
        if (q && q.rate > 0) {
          total_value += q.rate * item.quantity;
          submitted_count++;
        }
      });

      if (d.status === 'Submitted' && submitted_count > 0) {
        vendorTotals.push({
          vendor_id: d.vendor_id,
          vendor_name: d.vendor_name,
          vendor_email: d.vendor_email,
          contact_person: d.contact_person || d.vendor_name,
          total_value
        });
      }
    });

    vendorTotals.sort((a, b) => a.total_value - b.total_value);

    let l1VendorId = null;
    let l1VendorName = '';
    let l1VendorEmail = '';
    let l1VendorContact = '';
    let l1TotalValue = 0;
    if (vendorTotals.length > 0) {
      l1VendorId = vendorTotals[0].vendor_id;
      l1VendorName = vendorTotals[0].vendor_name;
      l1VendorEmail = vendorTotals[0].vendor_email;
      l1VendorContact = vendorTotals[0].contact_person || vendorTotals[0].vendor_name;
      l1TotalValue = vendorTotals[0].total_value;
    }

    const notifiedVendors = [];
    const testEmails = [
      'mrunn28@gmail.com',
      'divyansh.agarwal900@gmail.com',
      'mnaik123321@gmail.com',
      'mrunaalpathak@gmail.com'
    ];

    // Email content builder for L1 winning vendor
    const buildL1WinnerEmail = (vendorName, rfqNumber, projectName, totalValue, finalCost) => {
      return `
        <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
          <div style="background:#0f172a;padding:25px;text-align:center;border-bottom:3px solid #22c55e;">
            <img src="cid:semco_logo" alt="SEMCO Groups" style="max-height:50px;" />
          </div>
          <div style="padding:30px;background:#ffffff;">
            <h2 style="color:#15803d;margin-top:0;font-size:22px;font-weight:700;">🏆 Congratulations!</h2>
            <p>Dear ${vendorName},</p>
            <p>We are pleased to inform you that your quotation submission for <strong>RFQ ${rfqNumber}</strong> (${projectName}) has been selected as the <strong>L1 (Lowest Cost) winning bid</strong>!</p>
            <div style="margin:20px 0;padding:15px;background-color:#dcfce7;border-left:5px solid #22c55e;border-radius:4px;">
              <span style="font-size:12px;color:#15803d;text-transform:uppercase;font-weight:bold;letter-spacing:0.5px;">RFQ Summary</span>
              <table style="width:100%;margin-top:8px;font-size:14px;color:#1f2937;">
                <tr><td style="font-weight:600;padding:2px 0;width:160px;">RFQ Number:</td><td>${rfqNumber}</td></tr>
                <tr><td style="font-weight:600;padding:2px 0;">Project Name:</td><td>${projectName}</td></tr>
                ${totalValue > 0 ? `<tr><td style="font-weight:600;padding:2px 0;">Your Items Total:</td><td>₹${parseFloat(totalValue).toLocaleString('en-IN')}</td></tr>` : ''}
                ${finalCost > 0 ? `<tr><td style="font-weight:600;padding:2px 0;">Final Bid Value (incl. taxes &amp; transport):</td><td style="font-weight:700;color:#15803d;">₹${parseFloat(finalCost).toLocaleString('en-IN')}</td></tr>` : ''}
              </table>
            </div>
            <p>Our Procurement Team will be contacting you shortly.</p>
            <p style="margin-bottom:0;">Best Regards,<br /><strong>SEMCO Groups Procurement Team</strong></p>
          </div>
          <div style="background:#0f172a;padding:15px;text-align:center;">
            <p style="color:#ffffff;font-size:12px;margin:0;font-family:'Segoe UI',Arial,sans-serif;">This is an automated email from the SEMCO Smart RFQ e-Procurement Platform. Please do not reply to this email.</p>
          </div>
        </div>
      `;
    };

    // Email content builder for non-selected vendors
    const buildThankYouEmail = (vendorName) => {
      return `
        <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
          <div style="background:#0f172a;padding:25px;text-align:center;border-bottom:3px solid #2563eb;">
            <img src="cid:semco_logo" alt="SEMCO Groups" style="max-height:50px;" />
          </div>
          <div style="padding:30px;background:#ffffff;">
            <h2 style="color:#0f172a;margin-top:0;font-size:20px;font-weight:700;">📩 Quotation Update</h2>
            <p>Dear ${vendorName},</p>
            <p>Thank you for submitting your quotation for RFQ <strong>${rfq.rfq_number}</strong>.</p>
            <div style="margin:20px 0;padding:15px;background-color:#eff6ff;border-left:5px solid #2563eb;border-radius:4px;">
              <span style="font-size:12px;color:#1d4ed8;text-transform:uppercase;font-weight:bold;letter-spacing:0.5px;">RFQ Reference</span>
              <table style="width:100%;margin-top:8px;font-size:14px;color:#1f2937;">
                <tr><td style="font-weight:600;padding:2px 0;width:130px;">RFQ Number:</td><td>${rfq.rfq_number}</td></tr>
                <tr><td style="font-weight:600;padding:2px 0;">Project Name:</td><td>${rfq.project_name || '-'}</td></tr>
              </table>
            </div>
            <p>After evaluation, your proposal was not selected for this contract. We highly value your competitive pricing and participation, and look forward to collaborating on future RFQs.</p>
            <p style="margin-bottom:0;">Best Regards,<br /><strong>SEMCO Groups Procurement Team</strong></p>
          </div>
          <div style="background:#0f172a;padding:15px;text-align:center;">
            <p style="color:#ffffff;font-size:12px;margin:0;font-family:'Segoe UI',Arial,sans-serif;">This is an automated email from the SEMCO Smart RFQ e-Procurement Platform. Please do not reply to this email.</p>
          </div>
        </div>
      `;
    };

    const finaliseTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    // 1. Send Congratulations Email to L1 winner
    if (l1VendorId && l1VendorEmail) {
      try {
        const l1Dist = distributions.find(d => d.vendor_id === l1VendorId);
        const l1FinalCost = l1Dist ? (parseFloat(l1Dist.final_cost) || 0) : 0;
        const winnerHtml = buildL1WinnerEmail(l1VendorContact, rfq.rfq_number, rfq.project_name, l1TotalValue, l1FinalCost);
        await sendMailViaSmtp(l1VendorEmail, `Congratulations! L1 Winner for RFQ: ${rfq.rfq_number} [Ref: ${finaliseTime}]`, winnerHtml);
      } catch (mailErr) {
        console.error(`[Finalise RFQ Winner Email Error] ${l1VendorEmail}:`, mailErr.message);
      }
    }

    // 2. Send emails to actual non-selected submitted vendors
    for (const v of vendorTotals) {
      if (v.vendor_id !== l1VendorId && v.vendor_email) {
        try {
          const emailHtml = buildThankYouEmail(v.vendor_name);
          await sendMailViaSmtp(v.vendor_email, `RFQ bid not selected for RFQ: ${rfq.rfq_number} [Ref: ${finaliseTime}]`, emailHtml);
          notifiedVendors.push(v.vendor_name);
        } catch (mailErr) {
          console.error(`[Finalise RFQ Email Error] ${v.vendor_email}:`, mailErr.message);
        }
      }
    }

    db.prepare(`INSERT INTO notifications (title, message, rfq_id) VALUES (?, ?, ?)`)
      .run('RFQ Bidding Finalised', `RFQ ${rfq.rfq_number} L1 identified as ${l1VendorName || 'None'}. thank-you & award emails sent.`, rfq.id);
    logAudit(req.headers['x-user'] || 'Admin', 'RFQ_FINALISE', `Finalised RFQ ${rfq.rfq_number}. L1 winner: ${l1VendorName || 'None'}`, req);

    res.json({
      success: true,
      message: `RFQ successfully finalised. L1 award email and thank-you emails sent.`,
      data: { l1_winner: l1VendorName, notified: notifiedVendors }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST finalise Transport Request and notify non-L1 transporters
app.post('/api/transport-requests/:id/finalise', async (req, res) => {
  try {
    const request = db.prepare('SELECT * FROM transport_requests WHERE id = ?').get(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Transport Request not found.' });

    // Set Transport Request to Closed
    db.prepare("UPDATE transport_requests SET status = 'Closed' WHERE id = ?").run(request.id);
    db.prepare("UPDATE transport_distributions SET status = 'Expired' WHERE request_id = ? AND status != 'Submitted'").run(request.id);

    // Calculate L1 rankings
    const distributions = db.prepare(`
      SELECT d.*, t.name AS transporter_name, t.email AS transporter_email
      FROM transport_distributions d
      JOIN transporters t ON d.transporter_id = t.id
      WHERE d.request_id = ?
    `).all(request.id);

    const submittedDists = distributions.filter(d => d.status === 'Submitted');
    submittedDists.sort((a, b) => (parseFloat(a.final_cost) || 0) - (parseFloat(b.final_cost) || 0));

    let l1TransporterId = null;
    let l1TransporterName = '';
    let l1TransporterEmail = '';
    let l1TotalCost = 0;
    if (submittedDists.length > 0) {
      l1TransporterId = submittedDists[0].transporter_id;
      l1TransporterName = submittedDists[0].transporter_name;
      l1TransporterEmail = submittedDists[0].transporter_email;
      l1TotalCost = parseFloat(submittedDists[0].final_cost) || 0;
    }

    const notifiedTransporters = [];
    const testEmails = [
      'mrunn28@gmail.com',
      'divyansh.agarwal900@gmail.com',
      'mnaik123321@gmail.com',
      'mrunaalpathak@gmail.com'
    ];

    // Email content builder for L1 winning transporter
    const buildL1WinnerEmail = (transporterName, requestNumber, fromLocation, toLocation, totalCost) => {
      return `
        <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
          <div style="background:#0f172a;padding:25px;text-align:center;border-bottom:3px solid #22c55e;">
            <img src="cid:semco_logo" alt="SEMCO Groups" style="max-height:50px;" />
          </div>
          <div style="padding:30px;background:#ffffff;">
            <h2 style="color:#15803d;margin-top:0;font-size:22px;font-weight:700;">🏆 Congratulations!</h2>
            <p>Dear ${transporterName},</p>
            <p>We are pleased to inform you that your logistics bid for <strong>Transport Request ${requestNumber}</strong> (Route: ${fromLocation} to ${toLocation}) has been selected as the <strong>L1 winning bid</strong>.</p>
            <div style="margin:20px 0;padding:15px;background-color:#dcfce7;border-left:5px solid #22c55e;border-radius:4px;">
              <span style="font-size:12px;color:#15803d;text-transform:uppercase;font-weight:bold;letter-spacing:0.5px;">Bidding Summary</span>
              <table style="width:100%;margin-top:8px;font-size:14px;color:#1f2937;">
                <tr><td style="font-weight:600;padding:2px 0;width:130px;">Request Number:</td><td>${requestNumber}</td></tr>
                <tr><td style="font-weight:600;padding:2px 0;">Route:</td><td>${fromLocation} to ${toLocation}</td></tr>
                <tr><td style="font-weight:600;padding:2px 0;">Awarded Value:</td><td style="font-weight:700;color:#15803d;">₹${parseFloat(totalCost).toLocaleString('en-IN')}</td></tr>
              </table>
            </div>
            <p>Our Procurement Team will be contacting you shortly.</p>
            <p style="margin-bottom:0;">Best Regards,<br /><strong>SEMCO Groups Logistics Team</strong></p>
          </div>
          <div style="background:#0f172a;padding:15px;text-align:center;">
            <p style="color:#ffffff;font-size:12px;margin:0;font-family:'Segoe UI',Arial,sans-serif;">This is an automated email from the SEMCO Smart RFQ e-Procurement Platform. Please do not reply to this email.</p>
          </div>
        </div>
      `;
    };

    // Email content builder for non-selected transporters
    const buildThankYouEmail = (transporterName) => {
      return `
        <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
          <div style="background:#0f172a;padding:25px;text-align:center;border-bottom:3px solid #0891b2;">
            <img src="cid:semco_logo" alt="SEMCO Groups" style="max-height:50px;" />
          </div>
          <div style="padding:30px;background:#ffffff;">
            <h2 style="color:#0f172a;margin-top:0;font-size:20px;font-weight:700;">📩 Logistics Bid Update</h2>
            <p>Dear ${transporterName},</p>
            <p>Thank you for submitting your freight quote for transport request <strong>${request.request_number}</strong>.</p>
            <div style="margin:20px 0;padding:15px;background-color:#ecfeff;border-left:5px solid #0891b2;border-radius:4px;">
              <span style="font-size:12px;color:#0e7490;text-transform:uppercase;font-weight:bold;letter-spacing:0.5px;">Transport Request Reference</span>
              <table style="width:100%;margin-top:8px;font-size:14px;color:#1f2937;">
                <tr><td style="font-weight:600;padding:2px 0;width:150px;">Request Number:</td><td>${request.request_number}</td></tr>
                <tr><td style="font-weight:600;padding:2px 0;">Route:</td><td>${request.from_location || '-'} → ${request.to_location || '-'}</td></tr>
              </table>
            </div>
            <p>After evaluation, your quote was not selected for this route. We highly value your competitive pricing and responsiveness, and look forward to collaborating on future route dispatches.</p>
            <p style="margin-bottom:0;">Best Regards,<br /><strong>SEMCO Groups Logistics Team</strong></p>
          </div>
          <div style="background:#0f172a;padding:15px;text-align:center;">
            <p style="color:#ffffff;font-size:12px;margin:0;font-family:'Segoe UI',Arial,sans-serif;">This is an automated email from the SEMCO Smart RFQ e-Procurement Platform. Please do not reply to this email.</p>
          </div>
        </div>
      `;
    };

    const finaliseTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    // 1. Send Congratulations Email to L1 winner
    if (l1TransporterId && l1TransporterEmail) {
      try {
        const winnerHtml = buildL1WinnerEmail(l1TransporterName, request.request_number, request.from_location, request.to_location, l1TotalCost);
        await sendMailViaSmtp(l1TransporterEmail, `Congratulations! L1 Winner for Transport Request: ${request.request_number} [Ref: ${finaliseTime}]`, winnerHtml);
      } catch (mailErr) {
        console.error(`[Finalise Transport Winner Email Error] ${l1TransporterEmail}:`, mailErr.message);
      }
    }

    // 2. Send emails to actual non-selected submitted transporters
    for (const d of submittedDists) {
      if (d.transporter_id !== l1TransporterId && d.transporter_email) {
        try {
          const emailHtml = buildThankYouEmail(d.transporter_name);
          await sendMailViaSmtp(d.transporter_email, `Transport bid not selected for Request: ${request.request_number} [Ref: ${finaliseTime}]`, emailHtml);
          notifiedTransporters.push(d.transporter_name);
        } catch (mailErr) {
          console.error(`[Finalise Transport Email Error] ${d.transporter_email}:`, mailErr.message);
        }
      }
    }

    db.prepare(`INSERT INTO notifications (title, message, rfq_id) VALUES (?, ?, ?)`)
      .run('Transport Request Finalised', `Request ${request.request_number} L1 identified as ${l1TransporterName || 'None'}. thank-you & award emails sent.`, request.id);
    logAudit(req.headers['x-user'] || 'Admin', 'TRANSPORT_REQ_FINALISE', `Finalised Request ${request.request_number}. L1 winner: ${l1TransporterName || 'None'}`, req);

    res.json({
      success: true,
      message: `Transport request successfully finalised. L1 award email and thank-you emails sent.`,
      data: { l1_winner: l1TransporterName, notified: notifiedTransporters }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST extend RFQ bidding window
app.post('/api/rfqs/:id/extend', (req, res) => {
  try {
    const { hours } = req.body;
    const hrs = parseFloat(hours);
    if (isNaN(hrs) || hrs <= 0) {
      return res.status(400).json({ success: false, message: 'Valid number of hours is required.' });
    }

    const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
    if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found.' });

    let currentExpiry = rfq.available_to ? new Date(rfq.available_to) : new Date();
    if (isNaN(currentExpiry.getTime()) || currentExpiry < new Date()) {
      currentExpiry = new Date();
    }

    const newExpiry = new Date(currentExpiry.getTime() + hrs * 60 * 60 * 1000);
    const newExpiryISO = newExpiry.toISOString();

    db.prepare('UPDATE rfqs SET available_to = ? WHERE id = ?').run(newExpiryISO, rfq.id);
    if (rfq.status === 'Closed' || rfq.status === 'Expired') {
      db.prepare("UPDATE rfqs SET status = 'Sent' WHERE id = ?").run(rfq.id);
    }

    db.prepare(`INSERT INTO notifications (title, message, rfq_id) VALUES (?, ?, ?)`)
      .run('RFQ Window Extended', `RFQ ${rfq.rfq_number} bidding window extended by ${hrs} hours. New deadline: ${newExpiry.toLocaleString()}`, rfq.id);
    logAudit(req.headers['x-user'] || 'Admin', 'RFQ_WINDOW_EXTEND', `Extended RFQ ${rfq.rfq_number} by ${hrs} hours. New deadline: ${newExpiryISO}`, req);

    res.json({ success: true, new_expiry: newExpiryISO, message: `Bidding window successfully extended by ${hrs} hours.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST extend Transport Request bidding window
app.post('/api/transport-requests/:id/extend', (req, res) => {
  try {
    const { hours } = req.body;
    const hrs = parseFloat(hours);
    if (isNaN(hrs) || hrs <= 0) {
      return res.status(400).json({ success: false, message: 'Valid number of hours is required.' });
    }

    const request = db.prepare('SELECT * FROM transport_requests WHERE id = ?').get(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Transport Request not found.' });

    let currentExpiry = request.expires_at ? new Date(request.expires_at) : new Date();
    if (isNaN(currentExpiry.getTime()) || currentExpiry < new Date()) {
      currentExpiry = new Date();
    }

    const newExpiry = new Date(currentExpiry.getTime() + hrs * 60 * 60 * 1000);
    const newExpiryISO = newExpiry.toISOString();

    db.prepare('UPDATE transport_requests SET expires_at = ? WHERE id = ?').run(newExpiryISO, request.id);
    if (request.status === 'Closed' || request.status === 'Expired') {
      db.prepare("UPDATE transport_requests SET status = 'Sent' WHERE id = ?").run(request.id);
    }
    db.prepare("UPDATE transport_distributions SET status = 'Sent' WHERE request_id = ? AND status = 'Expired'").run(request.id);

    db.prepare(`INSERT INTO notifications (title, message, rfq_id) VALUES (?, ?, ?)`)
      .run('Transport Request Window Extended', `Transport Request ${request.request_number} bidding window extended by ${hrs} hours. New deadline: ${newExpiry.toLocaleString()}`, request.id);
    logAudit(req.headers['x-user'] || 'Admin', 'TRANSPORT_REQ_WINDOW_EXTEND', `Extended request ${request.request_number} by ${hrs} hours. New deadline: ${newExpiryISO}`, req);

    res.json({ success: true, new_expiry: newExpiryISO, message: `Bidding window successfully extended by ${hrs} hours.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST re-open RFQ bidding window
app.post('/api/rfqs/:id/re-open', async (req, res) => {
  try {
    const { expiry } = req.body; // ISO String
    if (!expiry) {
      return res.status(400).json({ success: false, message: 'New expiry date/time is required.' });
    }

    const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
    if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found.' });

    if (rfq.status === 'Draft') {
      return res.status(400).json({ success: false, message: 'Re-opening is not allowed for Draft RFQs.' });
    }

    const newExpiry = new Date(expiry);
    if (isNaN(newExpiry.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid expiry date/time format.' });
    }
    const newExpiryISO = newExpiry.toISOString();
    const now = new Date();

    // 1. Update RFQ status to Sent and set new expiry
    db.prepare("UPDATE rfqs SET status = 'Sent', available_from = ?, available_to = ? WHERE id = ?")
      .run(now.toISOString(), newExpiryISO, rfq.id);

    // 2. Find pending/unsubmitted distributions
    const pending = db.prepare(`
      SELECT d.*, v.name AS vendor_name, v.email AS vendor_email, v.contact_person
      FROM rfq_distributions d JOIN vendors v ON d.vendor_id = v.id
      WHERE d.rfq_id = ? AND d.status != 'Submitted'
    `).all(rfq.id);

    const sentVendors = [];

    for (const d of pending) {
      // 3. Update distribution status to Sent, reset reminders
      db.prepare("UPDATE rfq_distributions SET status = 'Sent' WHERE rfq_id = ? AND vendor_id = ?")
        .run(rfq.id, d.vendor_id);
      db.prepare("UPDATE rfq_distributions SET reminder_60_sent = ? WHERE rfq_id = ? AND vendor_id = ?")
        .run(0, rfq.id, d.vendor_id);
      db.prepare("UPDATE rfq_distributions SET reminder_30_sent = ? WHERE rfq_id = ? AND vendor_id = ?")
        .run(0, rfq.id, d.vendor_id);

      // 4. Send email
      const portalUrl = `${getFrontendUrl(req)}/index.html?token=${d.token}`;
      const subject = `RE-OPENED: Request For Quotation ${rfq.rfq_number} — SEMCO Groups`;
      
      const pad = (n) => n.toString().padStart(2, '0');
      const day = pad(newExpiry.getDate());
      const month = pad(newExpiry.getMonth() + 1);
      const year = newExpiry.getFullYear();
      const timeStr = newExpiry.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      const formattedExpiry = `${day}/${month}/${year} ${timeStr}`;

      const emailHtml = `
        <div style="font-family:'Inter','Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
          <div style="background:#0f172a;padding:25px;text-align:center;border-bottom:3px solid #f59e0b;">
            <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">🔄 RFQ BIDDING RE-OPENED</h1>
            <p style="color:#fbbf24;margin:5px 0 0;font-size:13px;">Your submission window has been extended</p>
          </div>
          <div style="padding:30px;background:#fff;">
            <p style="font-size:15px;margin-top:0;">Dear <strong>${d.contact_person || d.vendor_name}</strong>,</p>
            <p style="line-height:1.6;font-size:14px;">The bidding window for <strong>RFQ ${rfq.rfq_number}</strong> has been re-opened for your submission.</p>
            <p style="line-height:1.6;font-size:14px;">Please access your vendor portal using the link below and submit your rates before the new deadline.</p>
            <div style="background:#fffbeb;padding:15px;border-radius:6px;margin:20px 0;border-left:4px solid #f59e0b;">
              <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <tr><td style="padding:4px 0;font-weight:600;color:#b45309;width:130px;">RFQ Number:</td><td style="font-weight:700;">${rfq.rfq_number}</td></tr>
                <tr><td style="padding:4px 0;font-weight:600;color:#b45309;">Project:</td><td>${rfq.project_name}</td></tr>
                <tr><td style="padding:4px 0;font-weight:600;color:#b45309;width:130px;">Required Delivery:</td><td>${formatDateDDMMYYYY(rfq.delivery_date)}</td></tr>
                <tr><td style="padding:4px 0;font-weight:600;color:#b45309;">New Expiry Time:</td><td style="color:#dc2626;font-weight:700;">${formattedExpiry}</td></tr>
              </table>
            </div>
            <div style="text-align:center;margin:30px 0;">
              <a href="${portalUrl}" target="_blank" style="background:#f59e0b;color:#fff;font-weight:600;text-decoration:none;padding:12px 30px;border-radius:6px;display:inline-block;box-shadow:0 4px 6px -1px rgba(245,158,11,.2);">ACCESS PORTAL & SUBMIT RATES</a>
            </div>
            <p style="font-size:12px;color:#94a3b8;text-align:center;">This link is unique to you. Do not share.</p>
          </div>
          <div style="background:#0f172a;padding:15px;text-align:center;font-size:11px;color:#ffffff;">&copy; ${new Date().getFullYear()} SEMCO Groups | umesh.p@semcogroups.com</div>
        </div>`;

      try {
        await sendMailViaSmtp(d.vendor_email, subject, emailHtml);
      } catch (mailErr) {
        console.error(`[SMTP Reopen Error] ${d.vendor_email}:`, mailErr.message);
      }
      sentVendors.push(d.vendor_name);
    }

    db.prepare("INSERT INTO notifications (title, message, rfq_id) VALUES (?, ?, ?)")
      .run('RFQ Re-opened', `RFQ ${rfq.rfq_number} bidding window re-opened. New deadline: ${newExpiry.toLocaleString()}`, rfq.id);
    logAudit(req.headers['x-user'] || 'Admin', 'RFQ_REOPEN', `Re-opened RFQ ${rfq.rfq_number} with new deadline: ${newExpiryISO}. Notified ${sentVendors.length} vendors.`, req);

    res.json({ success: true, message: `RFQ bidding successfully re-opened. Notified ${sentVendors.length} pending vendors.`, data: sentVendors });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST re-open Transport Request bidding window
app.post('/api/transport-requests/:id/re-open', async (req, res) => {
  try {
    const { expiry } = req.body; // ISO String
    if (!expiry) {
      return res.status(400).json({ success: false, message: 'New expiry date/time is required.' });
    }

    const request = db.prepare('SELECT * FROM transport_requests WHERE id = ?').get(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Transport Request not found.' });

    if (request.status === 'Draft') {
      return res.status(400).json({ success: false, message: 'Re-opening is not allowed for Draft requests.' });
    }

    const newExpiry = new Date(expiry);
    if (isNaN(newExpiry.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid expiry date/time format.' });
    }
    const newExpiryISO = newExpiry.toISOString();
    const now = new Date();

    // 1. Update Transport Request status to Sent and set new expiry
    db.prepare("UPDATE transport_requests SET status = 'Sent', launched_at = ?, expires_at = ? WHERE id = ?")
      .run(now.toISOString(), newExpiryISO, request.id);

    // 2. Find pending/unsubmitted distributions
    const pending = db.prepare(`
      SELECT d.*, t.name AS transporter_name, t.email AS transporter_email, t.contact_person
      FROM transport_distributions d JOIN transporters t ON d.transporter_id = t.id
      WHERE d.request_id = ? AND d.status != 'Submitted'
    `).all(request.id);

    const sentTransporters = [];

    for (const d of pending) {
      // 3. Update distribution status to Sent, reset reminders
      db.prepare("UPDATE transport_distributions SET status = ?, sent_at = ? WHERE request_id = ? AND transporter_id = ?")
        .run('Sent', now.toISOString(), request.id, d.transporter_id);
      db.prepare("UPDATE transport_distributions SET reminder_60_sent = ? WHERE request_id = ? AND transporter_id = ?")
        .run(0, request.id, d.transporter_id);
      db.prepare("UPDATE transport_distributions SET reminder_30_sent = ? WHERE request_id = ? AND transporter_id = ?")
        .run(0, request.id, d.transporter_id);

      // 4. Send email
      const portalUrl = `${getFrontendUrl(req)}/index.html?transport_token=${d.token}`;
      const subject = `RE-OPENED: Transport Bid Request ${request.request_number} — SEMCO Groups`;

      const pad = (n) => n.toString().padStart(2, '0');
      const day = pad(newExpiry.getDate());
      const month = pad(newExpiry.getMonth() + 1);
      const year = newExpiry.getFullYear();
      const timeStr = newExpiry.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      const formattedExpiry = `${day}/${month}/${year} ${timeStr}`;

      const emailHtml = `
        <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
          <div style="background:#0f172a;padding:25px;text-align:center;border-bottom:3px solid #3b82f6;">
            <h1 style="color:#fff;margin:0;font-size:20px;">🔄 TRANSPORT BIDDING RE-OPENED</h1>
            <p style="color:#60a5fa;margin:5px 0 0;font-size:13px;">Your submission window has been extended</p>
          </div>
          <div style="padding:30px;background:#fff;">
            <p style="font-size:15px;margin-top:0;">Dear <strong>${d.contact_person || d.transporter_name}</strong>,</p>
            <p style="line-height:1.6;font-size:14px;">The bidding window for <strong>Transport Request ${request.request_number}</strong> has been re-opened for your submission.</p>
            <p style="line-height:1.6;font-size:14px;">Please access your transporter portal using the link below and submit your quote before the new deadline.</p>
            <div style="background:#f0f9ff;padding:15px;border-radius:6px;margin:20px 0;border-left:4px solid #3b82f6;">
              <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;width:130px;">Request Number:</td><td style="font-weight:700;">${request.request_number}</td></tr>
                <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;">Route:</td><td>${request.from_location} to ${request.to_location}</td></tr>
                <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;">Required Date:</td><td>${formatDateDDMMYYYY(request.required_date)}</td></tr>
                <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;">New Expiry Time:</td><td style="color:#dc2626;font-weight:700;">${formattedExpiry}</td></tr>
              </table>
            </div>
            <div style="text-align:center;margin:30px 0;">
              <a href="${portalUrl}" target="_blank" style="background:#2563eb;color:#fff;font-weight:600;text-decoration:none;padding:12px 30px;border-radius:6px;display:inline-block;box-shadow:0 4px 6px -1px rgba(37,99,235,.2);">ACCESS PORTAL & SUBMIT BID NOW</a>
            </div>
            <p style="font-size:12px;color:#94a3b8;text-align:center;">This link is unique to you. Do not share.</p>
          </div>
          <div style="background:#0f172a;padding:15px;text-align:center;font-size:11px;color:#ffffff;">&copy; ${new Date().getFullYear()} SEMCO Groups | umesh.p@semcogroups.com</div>
        </div>`;

      try {
        await sendMailViaSmtp(d.transporter_email, subject, emailHtml);
      } catch (mailErr) {
        console.error(`[SMTP Reopen Error] ${d.transporter_email}:`, mailErr.message);
      }
      sentTransporters.push(d.transporter_name);
    }

    db.prepare("INSERT INTO notifications (title, message, rfq_id) VALUES (?, ?, ?)")
      .run('Transport Request Re-opened', `Transport Request ${request.request_number} bidding window re-opened. New deadline: ${newExpiry.toLocaleString()}`, request.id);
    logAudit(req.headers['x-user'] || 'Admin', 'TRANSPORT_REQ_REOPEN', `Re-opened Transport Request ${request.request_number} with new deadline: ${newExpiryISO}. Notified ${sentTransporters.length} transporters.`, req);

    res.json({ success: true, message: `Transport bidding successfully re-opened. Notified ${sentTransporters.length} pending transporters.`, data: sentTransporters });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET all submitted quotes across transporters
app.get('/api/transport-submissions', (req, res) => {
  try {
    const submissions = db.prepare(`
      SELECT d.*, r.request_number, r.from_location, r.to_location, r.required_date,
             t.name AS transporter_name, t.contact_person, t.email AS transporter_email
      FROM transport_distributions d
      JOIN transport_requests r ON d.request_id = r.id
      JOIN transporters t ON d.transporter_id = t.id
      WHERE d.status = 'Submitted'
      ORDER BY d.submitted_at DESC
    `).all();
    res.json({ success: true, data: submissions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  AUTOMATED SCHEDULER FOR RFQ & TRANSPORT EXPIRY & REMINDERS
// ═══════════════════════════════════════════════════════════
async function checkRemindersAndExpirations() {
  try {
    const now = new Date();

    // ─── PART 0: START SCHEDULED TRANSPORT REQUESTS ───
    const scheduledDists = db.prepare(`
      SELECT d.*, r.request_number, r.expires_at, r.vehicle_available_from
      FROM transport_distributions d
      JOIN transport_requests r ON d.request_id = r.id
      WHERE d.status = 'Scheduled'
    `).all();

    for (const d of scheduledDists) {
      if (d.vehicle_available_from && new Date(d.vehicle_available_from) <= now) {
        // Fetch transporter info
        const transporter = db.prepare('SELECT * FROM transporters WHERE id = ?').get(d.transporter_id);
        if (!transporter) continue;

        // Update distribution status
        db.prepare("UPDATE transport_distributions SET status = 'Sent' WHERE request_id = ? AND transporter_id = ?").run(d.request_id, d.transporter_id);
        // Update request status if still Scheduled
        db.prepare("UPDATE transport_requests SET status = 'Sent' WHERE id = ? AND status = 'Scheduled'").run(d.request_id);

        // Send email
        const portalUrl = `${getFrontendUrl(null)}/index.html?transport_token=${d.token}`;
        const subject = `New Transport Bid Request: ${d.request_number} — SEMCO Groups`;
        
        let expiresText = '-';
        if (d.expires_at) {
          const expiresDate = new Date(d.expires_at);
          const pad = (n) => n.toString().padStart(2, '0');
          const day = pad(expiresDate.getDate());
          const month = pad(expiresDate.getMonth() + 1);
          const year = expiresDate.getFullYear();
          const timeStr = expiresDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
          expiresText = `${day}/${month}/${year} ${timeStr}`;
        }

        const emailHtml = `
          <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
            <div style="background:#0f172a;padding:25px;text-align:center;border-bottom:3px solid #3b82f6;">
              <h1 style="color:#fff;margin:0;font-size:20px;">🚚 NEW TRANSPORT BID REQUEST</h1>
            </div>
            <div style="padding:30px;background:#fff;">
              <p style="font-size:15px;margin-top:0;">Dear <strong>${transporter.contact_person || transporter.name}</strong>,</p>
              <p style="line-height:1.6;font-size:14px;">We request your transport quote for the following route details:</p>
              <div style="background:#f0f9ff;padding:15px;border-radius:6px;margin:20px 0;border-left:4px solid #3b82f6;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                  <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;width:130px;">Request Number:</td><td style="font-weight:700;">${d.request_number}</td></tr>
                  <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;">Expires At:</td><td style="color:#dc2626;font-weight:600;">${expiresText}</td></tr>
                </table>
              </div>
              <div style="text-align:center;margin:30px 0;">
                <a href="${portalUrl}" target="_blank" style="background:#2563eb;color:#fff;font-weight:600;text-decoration:none;padding:12px 30px;border-radius:6px;display:inline-block;">ACCESS PORTAL & SUBMIT BID</a>
              </div>
            </div>
            <div style="background:#0f172a;padding:15px;text-align:center;font-size:11px;color:#ffffff;">&copy; ${new Date().getFullYear()} SEMCO Groups | umesh.p@semcogroups.com</div>
          </div>`;

        try {
          await sendMailViaSmtp(transporter.email, subject, emailHtml);
        } catch (mailErr) {
          console.error(`[SMTP Scheduled Launch Error] ${transporter.email}:`, mailErr.message);
        }

        db.prepare(`INSERT INTO notifications (title, message, rfq_id) VALUES (?, ?, ?)`)
          .run('Transport Request Active', `Scheduled transport request ${d.request_number} is now active and sent to ${transporter.name}.`, d.request_id);
        
        console.log(`[Scheduler] Activated scheduled transport request ${d.request_number} for ${transporter.name}`);
      }
    }

    // ─── PART 1: TRANSPORTERS SCHEDULER ───
    const activeTransportDists = db.prepare(`
      SELECT d.*, r.request_number, r.expires_at, r.status as request_status, t.email as transporter_email, t.name as transporter_name, t.contact_person
      FROM transport_distributions d
      JOIN transport_requests r ON d.request_id = r.id
      JOIN transporters t ON d.transporter_id = t.id
      WHERE d.status IN ('Sent', 'Opened')
    `).all();

    for (const d of activeTransportDists) {
      if (!d.expires_at) continue;

      const expiresAt = new Date(d.expires_at);
      const timeLeftMs = expiresAt.getTime() - now.getTime();
      const minutesLeft = timeLeftMs / (60 * 1000);

      if (timeLeftMs <= 0) {
        db.prepare("UPDATE transport_distributions SET status = 'Expired' WHERE request_id = ? AND transporter_id = ?").run(d.request_id, d.transporter_id);
        
        const dists = db.prepare("SELECT status FROM transport_distributions WHERE request_id = ?").all(d.request_id);
        const allInactive = dists.every(x => x.status === 'Expired' || x.status === 'Submitted');
        if (allInactive) {
          db.prepare("UPDATE transport_requests SET status = ? WHERE id = ?").run('Expired', d.request_id);
        }

        db.prepare("INSERT INTO notifications (title, message, rfq_id) VALUES (?, ?, ?)")
          .run('Bid Request Expired', `Transport bid request window expired for ${d.transporter_name}.`, d.request_id);
        
        console.log(`[Scheduler] Expired transport distribution for ${d.transporter_name} on Request ${d.request_number}`);
        continue;
      }

      // Check for 1 hour left reminder
      if (minutesLeft <= 60 && minutesLeft > 30 && d.reminder_60_sent === 0) {
        db.prepare("UPDATE transport_distributions SET reminder_60_sent = ? WHERE request_id = ? AND transporter_id = ?").run(1, d.request_id, d.transporter_id);
        
        const portalUrl = `${getFrontendUrl(null)}/index.html?transport_token=${d.token}`;
        const subject = `⏰ REMINDER: 1 hour left to quote for Transport Request ${d.request_number}`;
        const emailHtml = `
          <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
            <div style="background:#2563eb;padding:25px;text-align:center;border-bottom:3px solid #1d4ed8;">
              <h1 style="color:#fff;margin:0;font-size:20px;">⏰ 1 HOUR REMINDER</h1>
              <p style="color:#93c5fd;margin:5px 0 0;font-size:13px;">Time is running out to submit your transport quote</p>
            </div>
            <div style="padding:30px;background:#fff;">
              <p style="font-size:15px;margin-top:0;">Dear <strong>${d.contact_person || d.transporter_name}</strong>,</p>
              <p style="line-height:1.6;font-size:14px;">This is a friendly reminder that you have <strong>1 hour left</strong> to submit your quote for transport request:</p>
              <div style="background:#eff6ff;padding:15px;border-radius:6px;margin:20px 0;border-left:4px solid #2563eb;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                  <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;width:130px;">Request:</td><td style="font-weight:700;">${d.request_number}</td></tr>
                  <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;">Remaining Time:</td><td style="color:#2563eb;font-weight:700;">${Math.ceil(minutesLeft)} minutes</td></tr>
                </table>
              </div>
              <div style="text-align:center;margin:30px 0;">
                <a href="${portalUrl}" target="_blank" style="background:#2563eb;color:#fff;font-weight:600;text-decoration:none;padding:12px 30px;border-radius:6px;display:inline-block;">ACCESS PORTAL & SUBMIT BID NOW</a>
              </div>
            </div>
            <div style="background:#0f172a;padding:15px;text-align:center;font-size:11px;color:#ffffff;">&copy; ${new Date().getFullYear()} SEMCO Groups | umesh.p@semcogroups.com</div>
          </div>`;
        
        await sendMailViaSmtp(d.transporter_email, subject, emailHtml);
        console.log(`[Scheduler] Sent 1-hour reminder email to ${d.transporter_email}`);
      }

      // Check for 30 minutes left reminder
      if (minutesLeft <= 30 && minutesLeft > 0 && d.reminder_30_sent === 0) {
        db.prepare("UPDATE transport_distributions SET reminder_30_sent = ? WHERE request_id = ? AND transporter_id = ?").run(1, d.request_id, d.transporter_id);
        
        const portalUrl = `${getFrontendUrl(null)}/index.html?transport_token=${d.token}`;
        const subject = `⚠️ URGENT REMINDER: 30 minutes left to quote for Transport Request ${d.request_number}`;
        const emailHtml = `
          <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
            <div style="background:#e11d48;padding:25px;text-align:center;border-bottom:3px solid #be123c;">
              <h1 style="color:#fff;margin:0;font-size:20px;">⚠️ 30 MINUTE REMINDER</h1>
              <p style="color:#fda4af;margin:5px 0 0;font-size:13px;">Time is running out to submit your transport quote</p>
            </div>
            <div style="padding:30px;background:#fff;">
              <p style="font-size:15px;margin-top:0;">Dear <strong>${d.contact_person || d.transporter_name}</strong>,</p>
              <p style="line-height:1.6;font-size:14px;">This is a reminder that you have <strong>less than 30 minutes left</strong> to submit your quote for transport request:</p>
              <div style="background:#fff1f2;padding:15px;border-radius:6px;margin:20px 0;border-left:4px solid #e11d48;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                  <tr><td style="padding:4px 0;font-weight:600;color:#9f1239;width:130px;">Request:</td><td style="font-weight:700;">${d.request_number}</td></tr>
                  <tr><td style="padding:4px 0;font-weight:600;color:#9f1239;">Remaining Time:</td><td style="color:#e11d48;font-weight:700;">${Math.ceil(minutesLeft)} minutes</td></tr>
                </table>
              </div>
              <div style="text-align:center;margin:30px 0;">
                <a href="${portalUrl}" target="_blank" style="background:#e11d48;color:#fff;font-weight:600;text-decoration:none;padding:12px 30px;border-radius:6px;display:inline-block;">ACCESS PORTAL & SUBMIT BID NOW</a>
              </div>
            </div>
            <div style="background:#0f172a;padding:15px;text-align:center;font-size:11px;color:#ffffff;">&copy; ${new Date().getFullYear()} SEMCO Groups | umesh.p@semcogroups.com</div>
          </div>`;
        
        await sendMailViaSmtp(d.transporter_email, subject, emailHtml);
        console.log(`[Scheduler] Sent 30-min reminder email to ${d.transporter_email}`);
      }
    }

    // ─── PART 2: VENDORS (RFQS) SCHEDULER ───
    const activeRfqDists = db.prepare(`
      SELECT d.*, r.rfq_number, r.project_name, r.delivery_date, r.available_to, r.status as rfq_status, v.email as vendor_email, v.name as vendor_name, v.contact_person
      FROM rfq_distributions d
      JOIN rfqs r ON d.rfq_id = r.id
      JOIN vendors v ON d.vendor_id = v.id
      WHERE r.status IN ('Sent', 'In Progress') AND d.status IN ('Sent', 'Opened', 'In Progress')
    `).all();

    for (const d of activeRfqDists) {
      if (!d.available_to) continue;

      const availableTo = new Date(d.available_to);
      const timeLeftMs = availableTo.getTime() - now.getTime();
      const minutesLeft = timeLeftMs / (60 * 1000);

      if (timeLeftMs <= 0) {
        db.prepare("UPDATE rfq_distributions SET status = 'Expired' WHERE rfq_id = ? AND vendor_id = ?").run(d.rfq_id, d.vendor_id);
        
        const dists = db.prepare("SELECT status FROM rfq_distributions WHERE rfq_id = ?").all(d.rfq_id);
        const allInactive = dists.every(x => x.status === 'Expired' || x.status === 'Submitted');
        if (allInactive) {
          db.prepare("UPDATE rfqs SET status = ? WHERE id = ?").run('Expired', d.rfq_id);
        }

        db.prepare("INSERT INTO notifications (title, message, rfq_id) VALUES (?, ?, ?)")
          .run('RFQ Window Expired', `RFQ bidding window expired for ${d.vendor_name}.`, d.rfq_id);
        
        console.log(`[Scheduler] Expired RFQ distribution for ${d.vendor_name} on RFQ ${d.rfq_number}`);
        continue;
      }

      // Check for 1 hour left reminder
      if (minutesLeft <= 60 && minutesLeft > 30 && d.reminder_60_sent === 0) {
        db.prepare("UPDATE rfq_distributions SET reminder_60_sent = ? WHERE rfq_id = ? AND vendor_id = ?").run(1, d.rfq_id, d.vendor_id);
        
        const portalUrl = `${getFrontendUrl(null)}/index.html?token=${d.token}`;
        const subject = `⏰ REMINDER: 1 hour left to quote for RFQ ${d.rfq_number}`;
        const emailHtml = `
          <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
            <div style="background:#2563eb;padding:25px;text-align:center;border-bottom:3px solid #1d4ed8;">
              <h1 style="color:#fff;margin:0;font-size:20px;">⏰ 1 HOUR REMINDER</h1>
              <p style="color:#93c5fd;margin:5px 0 0;font-size:13px;">Time is running out to submit your quotation</p>
            </div>
            <div style="padding:30px;background:#fff;">
              <p style="font-size:15px;margin-top:0;">Dear <strong>${d.contact_person || d.vendor_name}</strong>,</p>
              <p style="line-height:1.6;font-size:14px;">This is a friendly reminder that you have <strong>1 hour left</strong> to submit your quotation for RFQ:</p>
              <div style="background:#eff6ff;padding:15px;border-radius:6px;margin:20px 0;border-left:4px solid #2563eb;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                  <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;width:130px;">RFQ Number:</td><td style="font-weight:700;">${d.rfq_number}</td></tr>
                  <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;">Project:</td><td>${d.project_name}</td></tr>
                  <tr><td style="padding:4px 0;font-weight:600;color:#1d4ed8;">Remaining Time:</td><td style="color:#2563eb;font-weight:700;">${Math.ceil(minutesLeft)} minutes</td></tr>
                </table>
              </div>
              <div style="text-align:center;margin:30px 0;">
                <a href="${portalUrl}" target="_blank" style="background:#2563eb;color:#fff;font-weight:600;text-decoration:none;padding:12px 30px;border-radius:6px;display:inline-block;">ACCESS PORTAL & SUBMIT RATES</a>
              </div>
            </div>
            <div style="background:#0f172a;padding:15px;text-align:center;font-size:11px;color:#ffffff;">&copy; ${new Date().getFullYear()} SEMCO Groups | umesh.p@semcogroups.com</div>
          </div>`;
        
        await sendMailViaSmtp(d.vendor_email, subject, emailHtml);
        console.log(`[Scheduler] Sent 1-hour reminder email to ${d.vendor_email}`);
      }

      // Check for 30 minutes left reminder
      if (minutesLeft <= 30 && minutesLeft > 0 && d.reminder_30_sent === 0) {
        db.prepare("UPDATE rfq_distributions SET reminder_30_sent = ? WHERE rfq_id = ? AND vendor_id = ?").run(1, d.rfq_id, d.vendor_id);
        
        const portalUrl = `${getFrontendUrl(null)}/index.html?token=${d.token}`;
        const subject = `⚠️ URGENT REMINDER: 30 minutes left to quote for RFQ ${d.rfq_number}`;
        const emailHtml = `
          <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
            <div style="background:#e11d48;padding:25px;text-align:center;border-bottom:3px solid #be123c;">
              <h1 style="color:#fff;margin:0;font-size:20px;">⚠️ 30 MINUTE REMINDER</h1>
              <p style="color:#fda4af;margin:5px 0 0;font-size:13px;">Time is running out to submit your quotation</p>
            </div>
            <div style="padding:30px;background:#fff;">
              <p style="font-size:15px;margin-top:0;">Dear <strong>${d.contact_person || d.vendor_name}</strong>,</p>
              <p style="line-height:1.6;font-size:14px;">This is a reminder that you have <strong>less than 30 minutes left</strong> to submit your quotation for RFQ:</p>
              <div style="background:#fff1f2;padding:15px;border-radius:6px;margin:20px 0;border-left:4px solid #e11d48;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                  <tr><td style="padding:4px 0;font-weight:600;color:#9f1239;width:130px;">RFQ Number:</td><td style="font-weight:700;">${d.rfq_number}</td></tr>
                  <tr><td style="padding:4px 0;font-weight:600;color:#9f1239;">Project:</td><td>${d.project_name}</td></tr>
                  <tr><td style="padding:4px 0;font-weight:600;color:#9f1239;">Remaining Time:</td><td style="color:#e11d48;font-weight:700;">${Math.ceil(minutesLeft)} minutes</td></tr>
                </table>
              </div>
              <div style="text-align:center;margin:30px 0;">
                <a href="${portalUrl}" target="_blank" style="background:#e11d48;color:#fff;font-weight:600;text-decoration:none;padding:12px 30px;border-radius:6px;display:inline-block;">ACCESS PORTAL & SUBMIT RATES</a>
              </div>
            </div>
            <div style="background:#0f172a;padding:15px;text-align:center;font-size:11px;color:#ffffff;">&copy; ${new Date().getFullYear()} SEMCO Groups | umesh.p@semcogroups.com</div>
          </div>`;
        
        await sendMailViaSmtp(d.vendor_email, subject, emailHtml);
        console.log(`[Scheduler] Sent 30-min reminder email to ${d.vendor_email}`);
      }
    }
  } catch (err) {
    console.error("[Scheduler Error] Consolidated reminder checker failed:", err.message);
  }
}

function startReminderScheduler() {
  setInterval(checkRemindersAndExpirations, 30000);
}

// Test route to force run the automated scheduler tick immediately
app.post('/api/test/reminder-tick', async (req, res) => {
  try {
    await checkRemindersAndExpirations();
    res.json({ success: true, message: 'Tick completed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Test route to backdate deadline (can go negative)
app.post('/api/test/backdate', (req, res) => {
  try {
    const { rfq_id, request_id, hours } = req.body;
    const hrs = parseFloat(hours);
    if (isNaN(hrs)) {
      return res.status(400).json({ success: false, message: 'Hours is required and must be a number.' });
    }
    if (rfq_id) {
      const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(rfq_id);
      if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found.' });
      let currentExpiry = rfq.available_to ? new Date(rfq.available_to) : new Date();
      const newExpiry = new Date(currentExpiry.getTime() + hrs * 60 * 60 * 1000);
      const newExpiryISO = newExpiry.toISOString();
      db.prepare('UPDATE rfqs SET available_to = ? WHERE id = ?').run(newExpiryISO, rfq.id);
      return res.json({ success: true, new_expiry: newExpiryISO, message: `Deadline backdated/extended to ${newExpiryISO}` });
    }
    if (request_id) {
      const request = db.prepare('SELECT * FROM transport_requests WHERE id = ?').get(request_id);
      if (!request) return res.status(404).json({ success: false, message: 'Transport Request not found.' });
      let currentExpiry = request.expires_at ? new Date(request.expires_at) : new Date();
      const newExpiry = new Date(currentExpiry.getTime() + hrs * 60 * 60 * 1000);
      const newExpiryISO = newExpiry.toISOString();
      db.prepare('UPDATE transport_requests SET expires_at = ? WHERE id = ?').run(newExpiryISO, request.id);
      return res.json({ success: true, new_expiry: newExpiryISO, message: `Deadline backdated/extended to ${newExpiryISO}` });
    }
    return res.status(400).json({ success: false, message: 'Either rfq_id or request_id must be provided.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  PLATFORM INVITE / PRE-ALERT EMAIL
// ═══════════════════════════════════════════════════════════

// Load SEMCO logo once at startup for inline embedding
let SEMCO_LOGO_B64 = '';
try {
  SEMCO_LOGO_B64 = require('fs').readFileSync(path.join(__dirname, 'semco-logo-new.png')).toString('base64');
  console.log('[Platform Invite] SEMCO logo loaded for email embedding.');
} catch (e) {
  console.warn('[Platform Invite] semco-logo-new.png not found — header will use text fallback.');
}

function buildPlatformInviteEmail(contactName, type, registerUrl) {
  const isVendor    = type === 'vendor';
  const portalType  = isVendor ? 'Vendor' : 'Transporter';
  const accentColor = isVendor ? '#2563eb' : '#0891b2';
  const headerGrad  = isVendor
    ? 'linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%)'
    : 'linear-gradient(135deg,#0f172a 0%,#164e63 100%)';
  const year        = new Date().getFullYear();
  const logoSrc     = require('fs').existsSync(require('path').join(__dirname, 'semco-logo-new.png'))
    ? 'cid:semco_logo'
    : null;

  const logoHtml = logoSrc
    ? `<img src="${logoSrc}" alt="SEMCO Groups" width="210" style="display:block;margin:0 auto 16px;max-width:210px;height:auto;" />`
    : `<div style="color:#fff;font-size:24px;font-weight:700;margin-bottom:12px;letter-spacing:-0.5px;">SEMCO Groups</div>`;

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
      ${logoHtml}
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

      <!-- REGISTRATION SECTION -->
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">
        <tr>
          <td style="padding:20px 24px;text-align:center;">
            <div style="font-weight:700;font-size:15px;color:#1e3a8a;margin-bottom:8px;font-family:'Segoe UI',Arial,sans-serif;">Complete Your Onboarding Profile</div>
            <p style="font-size:14px;color:#1e40af;margin:0 0 16px;line-height:1.5;font-family:'Segoe UI',Arial,sans-serif;">
              Please complete your registration profile information including contact, company address, and bank/tax details.
            </p>
            <a href="${registerUrl}" target="_blank" style="display:inline-block;background-color:${accentColor};color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:6px;font-family:'Segoe UI',Arial,sans-serif;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
              Fill Registration Information
            </a>
          </td>
        </tr>
      </table>

      <!-- BIDDING DEADLINE POLICY -->
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0;background:#fff7ed;border:2px solid #f97316;border-radius:10px;">
        <tr>
          <td style="padding:18px 20px;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td width="36" valign="top" style="font-size:22px;line-height:1;padding-right:12px;">&#x26A0;&#xFE0F;</td>
                <td valign="top">
                  <div style="font-weight:700;font-size:15px;color:#c2410c;margin-bottom:8px;font-family:'Segoe UI',Arial,sans-serif;">Important — Bidding Deadline Policy</div>
                  <table border="0" cellpadding="0" cellspacing="0" style="font-size:15px;color:#7c2d12;font-family:'Segoe UI',Arial,sans-serif;">
                    <tr><td valign="top" style="padding:3px 10px 3px 0;font-size:16px;">&#x2022;</td><td style="padding:3px 0;">All bids must be submitted within the specified time frame. No bids will be accepted after the deadline.</td></tr>
                    <tr><td valign="top" style="padding:3px 10px 3px 0;font-size:16px;">&#x2022;</td><td style="padding:3px 0;">Automated email reminders are sent at 1 hour and 30 minutes before expiration.</td></tr>
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
                <td width="36" valign="top" style="font-size:20px;padding-right:10px;">&#x1F4E8;</td>
                <td valign="top">
                  <div style="font-weight:700;font-size:15px;color:#166534;margin-bottom:4px;font-family:'Segoe UI',Arial,sans-serif;">Upcoming Requests</div>
                  <div style="font-size:15px;color:#15803d;line-height:1.65;font-family:'Segoe UI',Arial,sans-serif;">
                    You will be receiving ${isVendor ? 'RFQ (Request for Quotation)' : 'transport bid'} requests from us <strong>very soon</strong>. Check your inbox regularly so you do not miss any opportunities.
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
          <td style="padding:16px 18px;font-size:15px;color:#475569;font-family:'Segoe UI',Arial,sans-serif;line-height:1.7;">
            <strong style="color:#1e293b;">Need Help?</strong><br>
            If you have any questions about using the platform or your registration, please reach out to our procurement team:<br>
            <span style="color:${accentColor};font-weight:600;">&#x1F4E7; umesh.p@semcogroups.com</span>
          </td>
        </tr>
      </table>

    </div>

    <!-- FOOTER -->
    <div style="background:#0f172a;padding:18px 24px;text-align:center;">
      <p style="color:#ffffff;font-size:12px;margin:0 0 4px;font-family:'Segoe UI',Arial,sans-serif;">&#xA9; ${year} SEMCO Groups. All rights reserved.</p>
      <p style="color:#ffffff;font-size:12px;margin:0;font-family:'Segoe UI',Arial,sans-serif;">This is an automated email from the SEMCO Smart RFQ e-Procurement Platform. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>`;
}

app.post('/api/send-platform-invite', async (req, res) => {
  try {
    const { type, ids } = req.body;

    if (!type || !['vendor', 'transporter'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid type. Must be "vendor" or "transporter".' });
    }

    let recipients = [];
    if (type === 'vendor') {
      const rows = db.prepare('SELECT * FROM vendors').all();
      recipients = ids && ids.length > 0 ? rows.filter(r => ids.includes(r.id)) : rows;
    } else {
      const rows = db.prepare('SELECT * FROM transporters').all();
      recipients = ids && ids.length > 0 ? rows.filter(r => ids.includes(r.id)) : rows;
    }

    if (recipients.length === 0) {
      return res.json({ success: true, sent: 0, failed: 0, message: 'No recipients found.' });
    }

    const isVendor = type === 'vendor';
    let sent = 0, failed = 0;
    const results = [];

    for (const r of recipients) {
      const contactName = r.contact_person || r.name;
      const randId = Math.floor(1000 + Math.random() * 9000);
      const subject = isVendor
        ? `Welcome to SEMCO Smart RFQ Platform — Vendor Registration Guide [Ref #${randId}]`
        : `Welcome to SEMCO Smart RFQ Platform — Transporter Registration Guide [Ref #${randId}]`;

      const registerToken = jwt.sign({ id: r.id, type }, JWT_SECRET, { expiresIn: '30d' });
      const registerUrl = `${getFrontendUrl(req)}/index.html?register_token=${registerToken}`;

      const emailHtml = buildPlatformInviteEmail(contactName, type, registerUrl);
      const mailOk = await sendMailViaSmtp(r.email, subject, emailHtml);
      if (mailOk) {
        sent++;
        results.push({ name: r.name, email: r.email, status: 'sent' });
        console.log(`[Platform Invite] Sent to ${type} ${r.name} <${r.email}>`);
      } else {
        failed++;
        results.push({ name: r.name, email: r.email, status: 'failed' });
      }
    }

    logAudit(
      req.headers['x-user'] || 'Admin',
      'PLATFORM_INVITE_SENT',
      `Sent platform invite to ${sent} ${type}(s). Failed: ${failed}.`
    );

    db.prepare(`INSERT INTO notifications (title, message) VALUES (?, ?)`)
      .run('Platform Invites Sent', `Dispatched onboarding emails to ${sent} ${type}(s).`);

    res.json({ success: true, sent, failed, results });
  } catch (err) {
    console.error('[Platform Invite Error]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Partner onboarding verification endpoint
app.get('/api/onboarding/verify', (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, message: 'Token is required.' });

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ success: false, message: 'Invalid or expired onboarding session.' });
    }

    const { id, type } = decoded;
    if (type === 'vendor') {
      const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
      if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found.' });
      return res.json({ success: true, data: vendor, type });
    } else if (type === 'transporter') {
      const transporter = db.prepare('SELECT * FROM transporters WHERE id = ?').get(id);
      if (!transporter) return res.status(404).json({ success: false, message: 'Transporter not found.' });
      return res.json({ success: true, data: transporter, type });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid onboarding partner type.' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Partner onboarding submission endpoint
app.post('/api/onboarding/submit', (req, res) => {
  try {
    const { token, name, email, contact_person, phone, address, bank_name, bank_address, account_name, account_type, account_number, ifsc_code, gst_number, pan_number, msme_status } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token is required.' });

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ success: false, message: 'Invalid or expired onboarding session.' });
    }

    const { id, type } = decoded;
    if (type === 'vendor') {
      const existing = db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ success: false, message: 'Vendor not found.' });

      db.prepare(`
        UPDATE vendors 
        SET name = ?, email = ?, contact_person = ?, phone = ?, address = ?, bank_name = ?, bank_address = ?, account_name = ?, account_type = ?, account_number = ?, ifsc_code = ?, gst_number = ?, pan_number = ?, msme_status = ?
        WHERE id = ?
      `).run(
        name !== undefined ? name : existing.name,
        email !== undefined ? email : existing.email,
        contact_person !== undefined ? contact_person : existing.contact_person,
        phone !== undefined ? phone : existing.phone,
        address !== undefined ? address : existing.address,
        bank_name !== undefined ? bank_name : (existing.bank_name || ''),
        bank_address !== undefined ? bank_address : (existing.bank_address || ''),
        account_name !== undefined ? account_name : (existing.account_name || ''),
        account_type !== undefined ? account_type : (existing.account_type || 'Current'),
        account_number !== undefined ? account_number : (existing.account_number || ''),
        ifsc_code !== undefined ? ifsc_code : (existing.ifsc_code || ''),
        gst_number !== undefined ? gst_number : existing.gst_number,
        pan_number !== undefined ? pan_number : existing.pan_number,
        msme_status !== undefined ? msme_status : (existing.msme_status || 'No'),
        id
      );

      logAudit('System', 'VENDOR_ONBOARD', `Vendor ${name || existing.name} completed profile onboarding registration.`, req);
      return res.json({ success: true, message: 'Registration profile successfully submitted!' });
    } else if (type === 'transporter') {
      const existing = db.prepare('SELECT * FROM transporters WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ success: false, message: 'Transporter not found.' });

      db.prepare(`
        UPDATE transporters 
        SET name = ?, email = ?, contact_person = ?, phone = ?, address = ?, bank_name = ?, bank_address = ?, account_name = ?, account_type = ?, account_number = ?, ifsc_code = ?, gst_number = ?, pan_number = ?
        WHERE id = ?
      `).run(
        name !== undefined ? name : existing.name,
        email !== undefined ? email : existing.email,
        contact_person !== undefined ? contact_person : existing.contact_person,
        phone !== undefined ? phone : existing.phone,
        address !== undefined ? address : existing.address,
        bank_name !== undefined ? bank_name : (existing.bank_name || ''),
        bank_address !== undefined ? bank_address : (existing.bank_address || ''),
        account_name !== undefined ? account_name : (existing.account_name || ''),
        account_type !== undefined ? account_type : (existing.account_type || 'Current'),
        account_number !== undefined ? account_number : (existing.account_number || ''),
        ifsc_code !== undefined ? ifsc_code : (existing.ifsc_code || ''),
        gst_number !== undefined ? gst_number : existing.gst_number,
        pan_number !== undefined ? pan_number : existing.pan_number,
        id
      );

      logAudit('System', 'TRANSPORTER_ONBOARD', `Transporter ${name || existing.name} completed profile onboarding registration.`, req);
      return res.json({ success: true, message: 'Registration profile successfully submitted!' });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid onboarding partner type.' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  REMINDERS — ONE-CLICK FOLLOW-UP VIA SENDGRID
// ═══════════════════════════════════════════════════════════
app.post('/api/rfqs/:id/remind', async (req, res) => {
  try {
    const rfq = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
    if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found.' });

    const pending = db.prepare(`
      SELECT d.*, v.name AS vendor_name, v.email AS vendor_email, v.contact_person
      FROM rfq_distributions d JOIN vendors v ON d.vendor_id = v.id
      WHERE d.rfq_id = ? AND d.status != 'Submitted'
    `).all(rfq.id);

    const sentVendors = [];

    for (const d of pending) {
      const portalUrl = `${getFrontendUrl(req)}/index.html?token=${d.token}`;
      const subject = `REMINDER: ${rfq.rfq_number} — SEMCO Groups`;
      const emailHtml = `
        <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;">
          <div style="background:#0f172a;padding:25px;text-align:center;border-bottom:3px solid #f59e0b;">
            <h1 style="color:#fff;margin:0;font-size:20px;">🚨 SEMCO RFQ REMINDER</h1>
            <p style="color:#fbbf24;margin:5px 0 0;font-size:13px;">Quotation Submission Pending</p>
          </div>
          <div style="padding:30px;background:#fff;">
            <p style="font-size:15px;margin-top:0;">Dear <strong>${d.contact_person || d.vendor_name}</strong>,</p>
            <p style="line-height:1.6;font-size:14px;">This is a friendly reminder that we are awaiting your quotation for:</p>
            <div style="background:#fffbeb;padding:15px;border-radius:6px;margin:20px 0;border-left:4px solid #f59e0b;">
              <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <tr><td style="padding:4px 0;font-weight:600;color:#b45309;width:130px;">RFQ Number:</td><td style="font-weight:700;">${rfq.rfq_number}</td></tr>
                <tr><td style="padding:4px 0;font-weight:600;color:#b45309;">Project:</td><td>${rfq.project_name}</td></tr>
                <tr><td style="padding:4px 0;font-weight:600;color:#b45309;">Required Delivery:</td><td style="color:#dc2626;font-weight:600;">${rfq.delivery_date}</td></tr>
              </table>
            </div>
            <div style="text-align:center;margin:30px 0;">
              <a href="${portalUrl}" target="_blank" style="background:#f59e0b;color:#fff;font-weight:600;text-decoration:none;padding:12px 30px;border-radius:6px;display:inline-block;">ACCESS PORTAL & SUBMIT RATES</a>
            </div>
          </div>
          <div style="background:#0f172a;padding:15px;text-align:center;font-size:11px;color:#ffffff;">&copy; ${new Date().getFullYear()} SEMCO Groups | umesh.p@semcogroups.com</div>
        </div>`;

      try {
        await sendMailViaSmtp(d.vendor_email, subject, emailHtml);
      } catch (mailErr) {
        console.error(`[SMTP Reminder Error] ${d.vendor_email}:`, mailErr.message);
      }
      sentVendors.push(d.vendor_name);
    }

    db.prepare(`INSERT INTO notifications (title,message) VALUES (?,?)`)
      .run('Reminders Dispatched', `Sent to ${pending.length} vendors for ${rfq.rfq_number}.`);
    logAudit('System Agent', 'RFQ_REMIND', `Follow-up for ${rfq.rfq_number} to ${pending.length} vendors`, req);

    res.json({ success: true, data: sentVendors });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════

//  START SERVER (Asynchronous Load & Boot)
// ═══════════════════════════════════════════════════════════
async function startServer() {
  if (process.env.MONGODB_URI) {
    try {
      await db.connectMongo(process.env.MONGODB_URI);
      mongoConnected = true;
    } catch (err) {
      console.error('[MongoDB Init Error]:', err.message);
    }
  }
  seedDefaults();

  app.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════╗');
    console.log('  ║  🚀 SEMCO Smart RFQ AI Agent — Server Running      ║');
    console.log(`  ║  🌐 http://localhost:${PORT}                           ║`);
    console.log(`  ║  📦 Database: ${path.join(DB_DIR, 'semco-rfq.db').slice(-38).padStart(38)}  ║`);
    console.log(`  ║  📧 SendGrid: ${(sendgridReady ? 'Configured ✓' : 'Simulation Mode').padEnd(38)}  ║`);
    console.log('  ╚══════════════════════════════════════════════════════╝');
    console.log('');

    // Start automated background scheduler for RFQ & transporter expiration and reminders
    startReminderScheduler();
  });
}

if (require.main === module || !process.env.VERCEL) {
  startServer();
} else {
  // Trigger schema setup synchronously on serverless boot
  seedDefaults();
}

module.exports = app;
// Touched to trigger database reload under watch mode (v2)
