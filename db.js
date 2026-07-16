const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dns = require('dns');

// Configure custom DNS resolvers to ensure MongoDB Atlas SRV resolution works in restricted environments
try {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (e) {
  console.warn('[DNS] Failed to set custom DNS servers:', e.message);
}

// Intercept all Mongoose Query exec calls to keep track of pending writes
global.mongoPromises = [];
const originalQueryExec = mongoose.Query.prototype.exec;
mongoose.Query.prototype.exec = function(...args) {
  const promise = originalQueryExec.apply(this, args);
  if (global.mongoPromises) {
    global.mongoPromises.push(promise.catch(() => {}));
  }
  return promise;
};

// Mongoose Schemas
const vendorSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  name: String,
  contact_person: String,
  email: String,
  phone: String,
  company_name: String,
  gst_number: String,
  pan_number: String,
  address: String,
  category: String,
  preferred: { type: Number, default: 0 },
  rating: { type: Number, default: 4.0 },
  archived: { type: Number, default: 0 },
  created_at: String,
  bank_name: String,
  bank_address: String,
  account_name: String,
  account_type: String,
  account_number: String,
  ifsc_code: String,
  msme_status: String
});

const rfqSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  rfq_number: String,
  rfq_date: String,
  delivery_date: String,
  project_name: String,
  department: String,
  buyer_name: String,
  status: String,
  available_from: String,
  available_to: String,
  initial_window_hours: String,
  expires_at: String,
  excel_filename: String,
  excel_path: String,
  excel_base64: String,
  custom_headers: String,
  allow_spec_sheet: { type: Number, default: 0 },
  version: { type: Number, default: 1 },
  created_at: String
});

const rfqItemSchema = new mongoose.Schema({
  id: Number,
  rfq_id: String,
  moc: String,
  description: String,
  size: String,
  quantity: Number,
  unit: String,
  custom_data: String
});

const rfqDistributionSchema = new mongoose.Schema({
  rfq_id: String,
  vendor_id: String,
  token: String,
  status: String,
  sent_at: String,
  opened_at: String,
  submitted_at: String,
  final_cost: { type: Number, default: 0.0 },
  cgst_applicable: { type: Number, default: 0 },
  sgst_applicable: { type: Number, default: 0 },
  transport_included: { type: Number, default: 0 },
  transport_packaging: { type: Number, default: 0.0 },
  transport_freight: { type: Number, default: 0.0 },
  transport_loading: { type: Number, default: 0.0 },
  transport_other: { type: Number, default: 0.0 },
  payment_terms: String,
  reminder_60_sent: { type: Number, default: 0 },
  reminder_30_sent: { type: Number, default: 0 },
  vendor_doc_name: String,
  vendor_doc_path: String,
  vendor_docs: { type: String, default: '[]' }
});

const vendorQuoteSchema = new mongoose.Schema({
  rfq_id: String,
  vendor_id: String,
  item_id: Number,
  rate: Number,
  lead_time_days: Number,
  payment_terms: String,
  remarks: String,
  submitted_at: String
});

const auditLogSchema = new mongoose.Schema({
  id: Number,
  username: String,
  action: String,
  details: String,
  ip_address: String,
  timestamp: String
});

const notificationSchema = new mongoose.Schema({
  id: Number,
  title: String,
  message: String,
  status: String,
  rfq_id: String,
  vendor_id: String,
  timestamp: String
});

const userSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  email: { type: String, unique: true },
  password_hash: String,
  role: String,
  vendorId: String,
  transporterId: String,
  created_at: String
});

const transporterSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  name: String,
  contact_person: String,
  email: String,
  phone: String,
  company_name: String,
  gst_number: String,
  pan_number: String,
  address: String,
  rating: { type: Number, default: 4.0 },
  archived: { type: Number, default: 0 },
  created_at: String,
  bank_name: String,
  bank_address: String,
  account_name: String,
  account_type: String,
  account_number: String,
  ifsc_code: String
});

const transportRequestSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  request_number: String,
  from_location: String,
  to_location: String,
  required_date: String,
  status: String,
  launched_at: String,
  expires_at: String,
  initial_window_hours: String,
  created_at: String,
  distance: { type: Number, default: 0.0 },
  vehicle_available_from: String,
  vehicle_size: String,
  vehicle_tonnage: { type: Number, default: 0.0 },
  actual_weight_charged: { type: Number, default: 0.0 },
  odc_charges: { type: Number, default: 0.0 },
  weight_unit: { type: String, default: 'Tons' },
  tax_bracket: { type: Number, default: 0.0 }
});

const transportRequestItemSchema = new mongoose.Schema({
  id: Number,
  request_id: String,
  material_name: String,
  material_category: String,
  vehicle_type: { type: String, default: '' },
  size_ft: { type: Number, default: 0 },
  quantity: Number,
  unit: String,
  odc_charges: { type: Number, default: 0 },
  remarks: String
});

const transportDistributionSchema = new mongoose.Schema({
  request_id: String,
  transporter_id: String,
  token: String,
  status: String,
  sent_at: String,
  opened_at: String,
  submitted_at: String,
  distance: { type: Number, default: 0.0 },
  vehicle_available_from: String,
  vehicle_size: String,
  vehicle_tonnage: { type: Number, default: 0.0 },
  actual_weight_charged: { type: Number, default: 0.0 },
  rate_per_ton: { type: Number, default: 0.0 },
  final_cost: { type: Number, default: 0.0 },
  reminder_60_sent: { type: Number, default: 0 },
  reminder_30_sent: { type: Number, default: 0 },
  reminder_15_sent: { type: Number, default: 0 },
  start_location: String,
  end_location: String,
  odc_charges: { type: Number, default: 0.0 },
  weight_unit: String,
  tax_bracket: { type: Number, default: 0.0 },
  return_trip_included: { type: Number, default: 0 },
  return_trip_rate: { type: Number, default: 0.0 },
  payment_terms: String
});

// Compile Models
const Vendor = mongoose.models.Vendor || mongoose.model('Vendor', vendorSchema);
const Rfq = mongoose.models.Rfq || mongoose.model('Rfq', rfqSchema);
const RfqItem = mongoose.models.RfqItem || mongoose.model('RfqItem', rfqItemSchema);
const RfqDistribution = mongoose.models.RfqDistribution || mongoose.model('RfqDistribution', rfqDistributionSchema);
const VendorQuote = mongoose.models.VendorQuote || mongoose.model('VendorQuote', vendorQuoteSchema);
const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
const User = mongoose.models.User || mongoose.model('User', userSchema);
const Transporter = mongoose.models.Transporter || mongoose.model('Transporter', transporterSchema);
const TransportRequest = mongoose.models.TransportRequest || mongoose.model('TransportRequest', transportRequestSchema);
const TransportRequestItem = mongoose.models.TransportRequestItem || mongoose.model('TransportRequestItem', transportRequestItemSchema);
const TransportDistribution = mongoose.models.TransportDistribution || mongoose.model('TransportDistribution', transportDistributionSchema);




class Database {
  constructor(filepath) {
    this.filepath = filepath.replace('.db', '.json');
    this.data = {
      vendors: [],
      rfqs: [],
      rfq_items: [],
      rfq_distributions: [],
      vendor_quotes: [],
      audit_trail: [],
      notifications: [],
      users: [],
      transporters: [],
      transport_requests: [],
      transport_request_items: [],
      transport_distributions: []
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filepath)) {
        const raw = fs.readFileSync(this.filepath, 'utf8');
        this.data = JSON.parse(raw);
        console.log(`[JSON DB] Loaded database cache from ${this.filepath}`);
      } else {
        console.log(`[JSON DB] Creating new database cache at ${this.filepath}`);
        this.save();
      }
    } catch (e) {
      console.error("[JSON DB] Error loading database cache, using empty database:", e);
    }
  }

  save() {
    try {
      const dir = path.dirname(this.filepath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error("[JSON DB] Error saving database cache:", e);
    }
  }

  async wipeDatabase() {
    this.data = {
      vendors: [],
      rfqs: [],
      rfq_items: [],
      rfq_distributions: [],
      vendor_quotes: [],
      audit_trail: [],
      notifications: [],
      users: [],
      transporters: [],
      transport_requests: [],
      transport_request_items: [],
      transport_distributions: []
    };
    this.save();

    if (mongoose.connection.readyState === 1) {
      await Promise.all([
        Vendor.deleteMany({}),
        Rfq.deleteMany({}),
        RfqItem.deleteMany({}),
        RfqDistribution.deleteMany({}),
        VendorQuote.deleteMany({}),
        AuditLog.deleteMany({}),
        Notification.deleteMany({}),
        User.deleteMany({}),
        Transporter.deleteMany({}),
        TransportRequest.deleteMany({}),
        TransportRequestItem.deleteMany({}),
        TransportDistribution.deleteMany({})
      ]);
    }
  }

  async connectMongo(uri) {
    try {
      if (mongoose.connection.readyState === 1) {
        return;
      }
      console.log('[MongoDB] Connecting to database...');
      await mongoose.connect(uri);
      console.log('[MongoDB] Connected successfully.');

      // Load all data from MongoDB
      const vendors = await Vendor.find().lean();
      const rfqs = await Rfq.find().lean();
      const items = await RfqItem.find().lean();
      const dists = await RfqDistribution.find().lean();
      const quotes = await VendorQuote.find().lean();
      const audits = await AuditLog.find().lean();
      const notifications = await Notification.find().lean();
      const users = await User.find().lean();
      const transporters = await Transporter.find().lean();
      const transportRequests = await TransportRequest.find().lean();
      const transportRequestItems = await TransportRequestItem.find().lean();
      const transportDistributions = await TransportDistribution.find().lean();

      // Helper function to merge local cache and Mongo arrays and sync new local records to MongoDB
      async function mergeCollection(localArray, mongoArray, Model, uniqueKeys, name) {
        const getCompositeKey = (item, keys) => {
          return keys.map(k => String(item[k] || '')).join('|');
        };

        const mongoMap = new Map();
        mongoArray.forEach(item => {
          mongoMap.set(getCompositeKey(item, uniqueKeys), item);
        });

        const toInsertIntoMongo = [];
        const mergedArray = [...mongoArray];

        localArray.forEach(item => {
          const key = getCompositeKey(item, uniqueKeys);
          if (!mongoMap.has(key)) {
            toInsertIntoMongo.push(item);
            mergedArray.push(item);
          }
        });

        if (toInsertIntoMongo.length > 0) {
          console.log(`[MongoDB Sync] Syncing ${toInsertIntoMongo.length} new ${name}(s) from local cache to MongoDB...`);
          try {
            await Model.insertMany(toInsertIntoMongo);
          } catch (err) {
            console.error(`[MongoDB Sync Error] Failed to sync ${name} to MongoDB:`, err.message);
          }
        }

        return mergedArray;
      }

      const isMongoEmpty = (vendors.length === 0 && rfqs.length === 0 && transportRequests.length === 0);

      if (!isMongoEmpty) {
        // MongoDB is the absolute source of truth, overwrite local cache
        this.data.vendors = vendors;
        this.data.rfqs = rfqs;
        this.data.rfq_items = items;
        this.data.rfq_distributions = dists;
        this.data.vendor_quotes = quotes;
        this.data.audit_trail = audits;
        this.data.notifications = notifications;
        this.data.users = users;
        this.data.transporters = transporters;
        this.data.transport_requests = transportRequests;
        this.data.transport_request_items = transportRequestItems;
        this.data.transport_distributions = transportDistributions;
        
        console.log(`[MongoDB] Overwrote local cache directly with MongoDB collections (${vendors.length} vendors, ${rfqs.length} RFQs).`);
      } else {
        // Initialize MongoDB from local cache seed data
        this.data.vendors = await mergeCollection(this.data.vendors || [], vendors, Vendor, ['id'], 'vendor');
        this.data.rfqs = await mergeCollection(this.data.rfqs || [], rfqs, Rfq, ['id'], 'rfq');
        this.data.rfq_items = await mergeCollection(this.data.rfq_items || [], items, RfqItem, ['rfq_id', 'description', 'moc', 'size'], 'rfq_item');
        this.data.rfq_distributions = await mergeCollection(this.data.rfq_distributions || [], dists, RfqDistribution, ['rfq_id', 'vendor_id'], 'rfq_distribution');
        this.data.vendor_quotes = await mergeCollection(this.data.vendor_quotes || [], quotes, VendorQuote, ['rfq_id', 'vendor_id', 'item_id'], 'vendor_quote');
        this.data.audit_trail = await mergeCollection(this.data.audit_trail || [], audits, AuditLog, ['username', 'action', 'details', 'timestamp'], 'audit_log');
        this.data.notifications = await mergeCollection(this.data.notifications || [], notifications, Notification, ['title', 'message', 'timestamp'], 'notification');
        this.data.users = await mergeCollection(this.data.users || [], users, User, ['id'], 'user');
        this.data.transporters = await mergeCollection(this.data.transporters || [], transporters, Transporter, ['id'], 'transporter');
        this.data.transport_requests = await mergeCollection(this.data.transport_requests || [], transportRequests, TransportRequest, ['id'], 'transport_request');
        this.data.transport_request_items = await mergeCollection(this.data.transport_request_items || [], transportRequestItems, TransportRequestItem, ['request_id', 'material_name'], 'transport_request_item');
        this.data.transport_distributions = await mergeCollection(this.data.transport_distributions || [], transportDistributions, TransportDistribution, ['request_id', 'transporter_id'], 'transport_distribution');
        console.log(`[MongoDB] Initialized MongoDB collections from local cache seed data.`);
      }

      this.save(); // Sync to local JSON file as backup
    } catch (e) {
      console.error('[MongoDB] Connection or Sync Error:', e.message);
      console.warn('[MongoDB] Falling back to offline local JSON database mode.');
    }
  }

  async refreshCache() {
    if (mongoose.connection.readyState === 1) {
      try {
        const [
          vendors, rfqs, items, dists, quotes,
          audits, notifications, users, transporters,
          transportRequests, transportRequestItems, transportDistributions
        ] = await Promise.all([
          Vendor.find().lean(),
          Rfq.find().lean(),
          RfqItem.find().lean(),
          RfqDistribution.find().lean(),
          VendorQuote.find().lean(),
          AuditLog.find().lean(),
          Notification.find().lean(),
          User.find().lean(),
          Transporter.find().lean(),
          TransportRequest.find().lean(),
          TransportRequestItem.find().lean(),
          TransportDistribution.find().lean()
        ]);

        this.data.vendors = vendors;
        this.data.rfqs = rfqs;
        this.data.rfq_items = items;
        this.data.rfq_distributions = dists;
        this.data.vendor_quotes = quotes;
        this.data.audit_trail = audits;
        this.data.notifications = notifications;
        this.data.users = users;
        this.data.transporters = transporters;
        this.data.transport_requests = transportRequests;
        this.data.transport_request_items = transportRequestItems;
        this.data.transport_distributions = transportDistributions;
      } catch (err) {
        console.error('[MongoDB Refresh Cache Error]:', err.message);
      }
    }
  }




  pragma(sql) {
    return this;
  }

  exec(sql) {
    return this;
  }

  transaction(fn) {
    return (...args) => {
      const res = fn(...args);
      this.save();
      return res;
    };
  }

  async waitForMongo() {
    if (global.mongoPromises && global.mongoPromises.length > 0) {
      await Promise.all(global.mongoPromises);
      global.mongoPromises.length = 0;
    }
  }

  prepare(sql) {
    return new PreparedStatement(sql, this);
  }
}

class PreparedStatement {
  constructor(sql, db) {
    this.sql = sql;
    this.db = db;
  }

  get(...args) {
    const res = this.execute(args);
    return Array.isArray(res) ? res[0] : res;
  }

  all(...args) {
    const res = this.execute(args);
    return Array.isArray(res) ? res : (res ? [res] : []);
  }

  run(...args) {
    const res = this.execute(args);
    this.db.save();
    return {
      changes: 1,
      lastInsertRowid: Date.now()
    };
  }

  execute(rawArgs) {
    const sql = this.sql.replace(/\s+/g, ' ').trim();
    let args = rawArgs;

    // Handle named parameters (e.g. @id, @name) when args[0] is an object
    if (rawArgs.length === 1 && typeof rawArgs[0] === 'object' && rawArgs[0] !== null) {
      const obj = rawArgs[0];
      const matches = this.sql.match(/@\w+/g);
      if (matches) {
        args = matches.map(m => {
          const key = m.substring(1);
          return obj[key];
        });
      }
    }

    if (sql.includes('ALTER TABLE')) {
      return { changes: 0 };
    }

    // ─── 1. COUNT QUERIES ───
    if (sql.includes('SELECT count(*) AS c FROM vendors') || sql.includes('SELECT count(*) as c FROM vendors')) {
      return { c: this.db.data.vendors.filter(v => !v.archived).length };
    }

    if (sql.includes('SELECT count(*) AS c FROM rfqs') || sql.includes('SELECT count(*) as c FROM rfqs')) {
      if (sql.includes('status NOT IN')) {
        const count = this.db.data.rfqs.filter(r => r.status !== 'Closed' && r.status !== 'Draft').length;
        return { c: count };
      }
      return { c: this.db.data.rfqs.length };
    }

    if (sql.includes('SELECT count(*) AS c FROM rfq_distributions') || sql.includes('SELECT count(*) as c FROM rfq_distributions')) {
      const rfqId = args[0];
      if (sql.includes("status = 'Submitted'")) {
        const count = this.db.data.rfq_distributions.filter(d => d.rfq_id === rfqId && d.status === 'Submitted').length;
        return { c: count };
      }
      const count = this.db.data.rfq_distributions.filter(d => d.rfq_id === rfqId).length;
      return { c: count };
    }

    // ─── 2. VENDORS QUERIES ───
    if (sql.includes('SELECT id FROM vendors ORDER BY id DESC LIMIT 1')) {
      if (this.db.data.vendors.length === 0) return undefined;
      const sorted = [...this.db.data.vendors].sort((a, b) => (b.id || '').localeCompare(a.id || ''));
      return { id: sorted[0].id };
    }

    if (sql.includes('FROM vendors WHERE archived = 1')) {
      return [...this.db.data.vendors].filter(v => v.archived === 1).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    if (sql.includes('FROM vendors ORDER BY name ASC')) {
      return [...this.db.data.vendors].filter(v => !v.archived).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    if (sql.includes('SELECT name FROM vendors WHERE id = ?') || sql.includes('SELECT name FROM vendors WHERE id=?')) {
      const v = this.db.data.vendors.find(x => x.id === args[0]);
      return v ? { name: v.name } : undefined;
    }

    if (sql.includes('SELECT') && (sql.includes('FROM vendors WHERE id = ?') || sql.includes('FROM vendors WHERE id=?'))) {
      const v = this.db.data.vendors.find(x => x.id === args[0]);
      return v;
    }

    if (sql.includes('SELECT') && sql.includes('FROM vendors') && !sql.includes('WHERE') && !sql.includes('ORDER BY') && !sql.includes('LIMIT')) {
      return [...this.db.data.vendors].filter(v => !v.archived);
    }

    if (sql.includes('INSERT INTO vendors')) {
      const [id, name, contact_person, email, phone, company_name, gst_number, pan_number, address, category, preferred, rating] = args;
      const idx = this.db.data.vendors.findIndex(x => x.id === id);
      const newVendor = {
        id, name, contact_person, email, phone, company_name, gst_number, pan_number, address, category,
        preferred: preferred ? 1 : 0, rating: rating || 4.0, archived: 0, created_at: new Date().toISOString()
      };
      if (idx >= 0) {
        this.db.data.vendors[idx] = newVendor;
      } else {
        this.db.data.vendors.push(newVendor);
      }

      if (mongoose.connection.readyState === 1) {
        Vendor.findOneAndUpdate({ id }, newVendor, { upsert: true, returnDocument: 'after' }).exec()
          .catch(err => console.error('[MongoDB Error] Vendor insert failed:', err.message));
      }
      return;
    }

    if (sql.includes('UPDATE vendors SET archived = ?') || sql.includes('UPDATE vendors SET archived = 1')) {
      const [archivedVal, id] = args.length === 2 ? args : [1, args[0]];
      const archived = archivedVal ? 1 : 0;
      const v = this.db.data.vendors.find(x => x.id === id);
      if (v) {
        v.archived = archived;
        if (mongoose.connection.readyState === 1) {
          Vendor.findOneAndUpdate({ id }, { archived }).exec()
            .catch(err => console.error('[MongoDB Error] Vendor archive update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('UPDATE vendors SET') && sql.includes('name = ?') && sql.includes('email = ?') && sql.includes('msme_status = ?')) {
      const [name, email, contact_person, phone, address, bank_name, bank_address, account_name, account_type, account_number, ifsc_code, gst_number, pan_number, msme_status, id] = args;
      const v = this.db.data.vendors.find(x => x.id === id);
      if (v) {
        v.name = name;
        v.company_name = name; // Maintain sync with company name
        v.email = email;
        v.contact_person = contact_person;
        v.phone = phone;
        v.address = address;
        v.bank_name = bank_name;
        v.bank_address = bank_address;
        v.account_name = account_name;
        v.account_type = account_type;
        v.account_number = account_number;
        v.ifsc_code = ifsc_code;
        v.gst_number = gst_number;
        v.pan_number = pan_number;
        v.msme_status = msme_status;

        if (mongoose.connection.readyState === 1) {
          const updateObj = { name, company_name: name, email, contact_person, phone, address, bank_name, bank_address, account_name, account_type, account_number, ifsc_code, gst_number, pan_number, msme_status };
          Vendor.findOneAndUpdate({ id }, updateObj).exec()
            .catch(err => console.error('[MongoDB Error] Vendor registration update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('UPDATE vendors SET') && sql.includes('contact_person = ?') && sql.includes('msme_status = ?')) {
      const [contact_person, phone, address, bank_name, bank_address, account_name, account_type, account_number, ifsc_code, gst_number, pan_number, msme_status, id] = args;
      const v = this.db.data.vendors.find(x => x.id === id);
      if (v) {
        v.contact_person = contact_person;
        v.phone = phone;
        v.address = address;
        v.bank_name = bank_name;
        v.bank_address = bank_address;
        v.account_name = account_name;
        v.account_type = account_type;
        v.account_number = account_number;
        v.ifsc_code = ifsc_code;
        v.gst_number = gst_number;
        v.pan_number = pan_number;
        v.msme_status = msme_status;

        if (mongoose.connection.readyState === 1) {
          Vendor.findOneAndUpdate({ id }, { contact_person, phone, address, bank_name, bank_address, account_name, account_type, account_number, ifsc_code, gst_number, pan_number, msme_status }).exec()
            .catch(err => console.error('[MongoDB Error] Vendor registration update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('UPDATE vendors SET') && !sql.includes('contact_person = ?') && sql.includes('msme_status = ?')) {
      const [phone, address, bank_name, bank_address, account_name, account_type, account_number, ifsc_code, gst_number, pan_number, msme_status, id] = args;
      const v = this.db.data.vendors.find(x => x.id === id);
      if (v) {
        v.phone = phone;
        v.address = address;
        v.bank_name = bank_name;
        v.bank_address = bank_address;
        v.account_name = account_name;
        v.account_type = account_type;
        v.account_number = account_number;
        v.ifsc_code = ifsc_code;
        v.gst_number = gst_number;
        v.pan_number = pan_number;
        v.msme_status = msme_status;

        if (mongoose.connection.readyState === 1) {
          Vendor.findOneAndUpdate({ id }, { phone, address, bank_name, bank_address, account_name, account_type, account_number, ifsc_code, gst_number, pan_number, msme_status }).exec()
            .catch(err => console.error('[MongoDB Error] Vendor onboarding registration update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('UPDATE vendors SET name')) {
      const [name, contact_person, email, phone, company_name, gst_number, pan_number, address, category, preferred, rating, id] = args;
      const v = this.db.data.vendors.find(x => x.id === id);
      if (v) {
        v.name = name;
        v.contact_person = contact_person;
        v.email = email;
        v.phone = phone;
        v.company_name = company_name;
        v.gst_number = gst_number;
        v.pan_number = pan_number;
        v.address = address;
        v.category = category;
        v.preferred = preferred ? 1 : 0;
        v.rating = rating;



        if (mongoose.connection.readyState === 1) {
          Vendor.findOneAndUpdate({ id }, { name, contact_person, email, phone, company_name, gst_number, pan_number, address, category, preferred: preferred ? 1 : 0, rating }).exec()
            .catch(err => console.error('[MongoDB Error] Vendor update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('DELETE FROM vendors WHERE id = ?')) {
      const id = args[0];
      this.db.data.vendors = this.db.data.vendors.filter(x => x.id !== id);
      this.db.data.rfq_distributions = this.db.data.rfq_distributions.filter(x => x.vendor_id !== id);
      this.db.data.vendor_quotes = this.db.data.vendor_quotes.filter(x => x.vendor_id !== id);



      if (mongoose.connection.readyState === 1) {
        Vendor.deleteOne({ id }).exec()
          .catch(err => console.error('[MongoDB Error] Vendor delete failed:', err.message));
        RfqDistribution.deleteMany({ vendor_id: id }).exec()
          .catch(err => console.error('[MongoDB Error] Dist delete failed:', err.message));
        VendorQuote.deleteMany({ vendor_id: id }).exec()
          .catch(err => console.error('[MongoDB Error] Quotes delete failed:', err.message));
      }
      return;
    }

    // ─── 3. RFQS QUERIES ───
    if (sql.includes('SELECT r.*') && sql.includes('FROM rfqs r')) {
      const rfqs = [...this.db.data.rfqs];
      rfqs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      return rfqs.map(r => {
        const item_count = this.db.data.rfq_items.filter(x => x.rfq_id === r.id).length;
        const vendor_sent_count = this.db.data.rfq_distributions.filter(x => x.rfq_id === r.id).length;
        const vendor_submitted_count = this.db.data.rfq_distributions.filter(x => x.rfq_id === r.id && x.status === 'Submitted').length;
        return {
          ...r,
          item_count,
          vendor_sent_count,
          vendor_submitted_count
        };
      });
    }

    if (sql.includes('SELECT') && (sql.includes('FROM rfqs WHERE id = ?') || sql.includes('FROM rfqs WHERE id=?'))) {
      const rfqId = args[0];
      return this.db.data.rfqs.find(x => x.id === rfqId);
    }

    if ((sql.includes('SELECT id FROM rfqs') || sql.includes('SELECT * FROM rfqs') || sql.includes('FROM rfqs')) && !sql.includes('WHERE') && !sql.includes('ORDER BY') && !sql.includes('LIMIT')) {
      return [...this.db.data.rfqs];
    }

    if (sql.includes('INSERT INTO rfqs')) {
      let rfq = { version: 1, created_at: new Date().toISOString() };
      const match = sql.match(/INSERT INTO rfqs\s*\(([^)]+)\)/i);
      if (match) {
        const cols = match[1].split(',').map(c => c.trim().toLowerCase());
        cols.forEach((col, idx) => {
          rfq[col] = args[idx];
        });
      } else {
        if (args.length >= 10) {
          const [id, rfq_number, rfq_date, delivery_date, project_name, department, buyer_name, status, available_from, available_to] = args;
          rfq = { id, rfq_number, rfq_date, delivery_date, project_name, department, buyer_name, status, available_from, available_to, version: 1, created_at: new Date().toISOString() };
        } else {
          const [id, rfq_number, rfq_date, delivery_date, project_name, department, buyer_name, status] = args;
          rfq = { id, rfq_number, rfq_date, delivery_date, project_name, department, buyer_name, status, available_from: rfq_date, available_to: delivery_date, version: 1, created_at: new Date().toISOString() };
        }
      }
      this.db.data.rfqs.push(rfq);

      if (mongoose.connection.readyState === 1) {
        Rfq.findOneAndUpdate({ id: rfq.id }, rfq, { upsert: true, returnDocument: 'after' }).exec()
          .catch(err => console.error('[MongoDB Error] RFQ insert failed:', err.message));
      }
      return;
    }

    if (sql.includes('UPDATE rfqs SET status = ? WHERE id = ?') || sql.includes('UPDATE rfqs SET status=? WHERE id=?')) {
      const [status, id] = args;
      const rfq = this.db.data.rfqs.find(x => x.id === id);
      if (rfq) {
        rfq.status = status;

        if (mongoose.connection.readyState === 1) {
          Rfq.findOneAndUpdate({ id }, { status }).exec()
            .catch(err => console.error('[MongoDB Error] RFQ status update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('UPDATE rfqs SET excel_filename = ?, excel_path = ?, excel_base64 = ? WHERE id = ?') || sql.includes('UPDATE rfqs SET excel_filename=?, excel_path=?, excel_base64=? WHERE id=?')) {
      const [excel_filename, excel_path, excel_base64, id] = args;
      const rfq = this.db.data.rfqs.find(x => x.id === id);
      if (rfq) {
        rfq.excel_filename = excel_filename;
        rfq.excel_path = excel_path;
        rfq.excel_base64 = excel_base64;

        if (mongoose.connection.readyState === 1) {
          Rfq.findOneAndUpdate({ id }, { excel_filename, excel_path, excel_base64 }).exec()
            .catch(err => console.error('[MongoDB Error] RFQ excel update failed:', err.message));
        }
      }
      return;
    }


    if (sql.includes("UPDATE rfqs SET status = 'Sent'")) {
      let id;
      let available_from = null;
      let available_to = null;
      if (sql.includes('available_from')) {
        [available_from, available_to, id] = args;
      } else if (sql.includes('available_to')) {
        [available_to, id] = args;
      } else {
        id = args[0];
      }
      const rfq = this.db.data.rfqs.find(x => x.id === id);
      if (rfq) {
        rfq.status = 'Sent';
        if (available_from) rfq.available_from = available_from;
        if (available_to) rfq.available_to = available_to;

        if (mongoose.connection.readyState === 1) {
          Rfq.findOneAndUpdate({ id }, { status: 'Sent', available_from, available_to }).exec()
            .catch(err => console.error('[MongoDB Error] RFQ status update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes("UPDATE rfqs SET status = 'Closed' WHERE id = ?") || sql.includes("UPDATE rfqs SET status='Closed' WHERE id=?")) {
      const id = args[0];
      const rfq = this.db.data.rfqs.find(x => x.id === id);
      if (rfq) {
        rfq.status = 'Closed';
        if (mongoose.connection.readyState === 1) {
          Rfq.findOneAndUpdate({ id }, { status: 'Closed' }).exec()
            .catch(err => console.error('[MongoDB Error] RFQ close update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes("UPDATE rfq_distributions SET status = 'Expired' WHERE rfq_id = ?")) {
      const rfq_id = args[0];
      this.db.data.rfq_distributions.forEach(d => {
        if (d.rfq_id === rfq_id && d.status !== 'Submitted') {
          d.status = 'Expired';
        }
      });
      if (mongoose.connection.readyState === 1) {
        RfqDistribution.updateMany({ rfq_id, status: { $ne: 'Submitted' } }, { status: 'Expired' }).exec()
          .catch(err => console.error('[MongoDB Error] RFQ dist expire update failed:', err.message));
      }
      return;
    }

    if (sql.includes("UPDATE rfqs SET available_to = ? WHERE id = ?") || sql.includes("UPDATE rfqs SET available_to=? WHERE id=?")) {
      const [available_to, id] = args;
      const rfq = this.db.data.rfqs.find(x => x.id === id);
      if (rfq) {
        rfq.available_to = available_to;
        if (mongoose.connection.readyState === 1) {
          Rfq.findOneAndUpdate({ id }, { available_to }).exec()
            .catch(err => console.error('[MongoDB Error] RFQ available_to update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('DELETE FROM rfqs WHERE id = ?') || sql.includes('DELETE FROM rfqs WHERE id=?')) {
      const id = args[0];
      this.db.data.rfqs = this.db.data.rfqs.filter(x => x.id !== id);
      this.db.data.rfq_items = this.db.data.rfq_items.filter(x => x.rfq_id !== id);
      this.db.data.rfq_distributions = this.db.data.rfq_distributions.filter(x => x.rfq_id !== id);
      this.db.data.vendor_quotes = this.db.data.vendor_quotes.filter(x => x.rfq_id !== id);

      if (mongoose.connection.readyState === 1) {
        Rfq.deleteOne({ id }).exec()
          .catch(err => console.error('[MongoDB Error] RFQ delete failed:', err.message));
        RfqItem.deleteMany({ rfq_id: id }).exec()
          .catch(err => console.error('[MongoDB Error] RFQ items delete failed:', err.message));
        RfqDistribution.deleteMany({ rfq_id: id }).exec()
          .catch(err => console.error('[MongoDB Error] RFQ distributions delete failed:', err.message));
        VendorQuote.deleteMany({ rfq_id: id }).exec()
          .catch(err => console.error('[MongoDB Error] RFQ quotes delete failed:', err.message));
      }
      return;
    }

    // ─── 4. ITEMS QUERIES ───
    if (sql.includes('FROM rfq_items WHERE rfq_id = ?') || sql.includes('FROM rfq_items WHERE rfq_id=?')) {
      const rfqId = args[0];
      return this.db.data.rfq_items.filter(x => x.rfq_id === rfqId);
    }

    if (sql.includes('INSERT INTO rfq_items')) {
      let item = {};
      const match = sql.match(/INSERT INTO rfq_items\s*\(([^)]+)\)/i);
      if (match) {
        const cols = match[1].split(',').map(c => c.trim().toLowerCase());
        cols.forEach((col, idx) => {
          if (col === 'quantity') {
            item[col] = parseFloat(args[idx]) || 0;
          } else {
            item[col] = args[idx];
          }
        });
      } else {
        const [rfq_id, moc, description, size, quantity, unit] = args;
        item = { rfq_id, moc, description, size, quantity: parseFloat(quantity), unit };
      }
      const id = this.db.data.rfq_items.length + 1;
      item.id = id;
      this.db.data.rfq_items.push(item);

      if (mongoose.connection.readyState === 1) {
        RfqItem.create(item)
          .catch(err => console.error('[MongoDB Error] RFQ item create failed:', err.message));
      }
      return;
    }

    // ─── 5. DISTRIBUTIONS QUERIES ───
    if (sql.includes('FROM rfq_distributions d') && sql.includes('JOIN rfqs r') && sql.includes("d.status IN ('Sent', 'Opened', 'In Progress')")) {
      const activeDists = this.db.data.rfq_distributions.filter(d => {
        const r = this.db.data.rfqs.find(x => x.id === d.rfq_id) || {};
        return (r.status === 'Sent' || r.status === 'In Progress') && (d.status === 'Sent' || d.status === 'Opened' || d.status === 'In Progress');
      });
      return activeDists.map(d => {
        const r = this.db.data.rfqs.find(x => x.id === d.rfq_id) || {};
        const v = this.db.data.vendors.find(x => x.id === d.vendor_id) || {};
        return {
          ...d,
          rfq_number: r.rfq_number || 'RFQ-XXX',
          project_name: r.project_name || '',
          delivery_date: r.delivery_date || '',
          available_to: r.available_to || null,
          rfq_status: r.status || 'Draft',
          vendor_email: v.email || '',
          vendor_name: v.name || '',
          contact_person: v.contact_person || ''
        };
      });
    }

    if (sql.includes('FROM rfq_distributions d JOIN vendors v') && sql.includes('d.status != \'Submitted\'')) {
      const rfqId = args[0];
      const dists = this.db.data.rfq_distributions.filter(d => d.rfq_id === rfqId && d.status !== 'Submitted');
      return dists.map(d => {
        const v = this.db.data.vendors.find(x => x.id === d.vendor_id) || {};
        return {
          ...d,
          vendor_name: v.name || '',
          vendor_email: v.email || '',
          contact_person: v.contact_person || '',
          preferred: v.preferred || 0
        };
      });
    }

    if (sql.includes('FROM rfq_distributions d JOIN vendors v') && sql.includes('vendor_email')) {
      const rfqId = args[0];
      const dists = this.db.data.rfq_distributions.filter(d => d.rfq_id === rfqId);
      return dists.map(d => {
        const v = this.db.data.vendors.find(x => x.id === d.vendor_id) || {};
        return {
          ...d,
          vendor_name: v.name || '',
          vendor_email: v.email || '',
          preferred: v.preferred || 0
        };
      });
    }

    if (sql.includes('FROM rfq_distributions d JOIN vendors v') && sql.includes('vendor_name')) {
      const rfqId = args[0];
      const dists = this.db.data.rfq_distributions.filter(d => d.rfq_id === rfqId);
      return dists.map(d => {
        const v = this.db.data.vendors.find(x => x.id === d.vendor_id) || {};
        return {
          ...d,
          vendor_name: v.name || '',
          preferred: v.preferred || 0
        };
      });
    }

    if (sql.includes('FROM rfq_distributions WHERE rfq_id = ? AND vendor_id = ?')) {
      const [rfqId, vendorId] = args;
      return this.db.data.rfq_distributions.find(x => x.rfq_id === rfqId && x.vendor_id === vendorId);
    }

    if (sql.includes('FROM rfq_distributions WHERE vendor_id = ?') || sql.includes('FROM rfq_distributions WHERE vendor_id=?')) {
      const vendorId = args[0];
      return this.db.data.rfq_distributions.filter(x => x.vendor_id === vendorId);
    }

    if (sql.includes('FROM rfq_distributions WHERE rfq_id = ?') || sql.includes('FROM rfq_distributions WHERE rfq_id=?')) {
      const rfqId = args[0];
      return this.db.data.rfq_distributions.filter(x => x.rfq_id === rfqId);
    }

    if (sql.includes('FROM rfq_distributions') && !sql.includes('WHERE') && !sql.includes('ORDER BY') && !sql.includes('LIMIT')) {
      return [...this.db.data.rfq_distributions];
    }

    if (sql.includes('INSERT INTO rfq_distributions')) {
      let dist;
      if (args.length === 8) {
        const [rfq_id, vendor_id, token, status, sent_at, opened_at, submitted_at, final_cost] = args;
        dist = { rfq_id, vendor_id, token, status, sent_at, opened_at, submitted_at, final_cost: parseFloat(final_cost) || 0.0, cgst_applicable: 0, sgst_applicable: 0, transport_included: 0, transport_packaging: 0.0, transport_freight: 0.0, transport_loading: 0.0, transport_other: 0.0, reminder_60_sent: 0, reminder_30_sent: 0 };
        this.db.data.rfq_distributions.push(dist);
      } else if (args.length === 7) {
        const [rfq_id, vendor_id, token, status, sent_at, opened_at, submitted_at] = args;
        dist = { rfq_id, vendor_id, token, status, sent_at, opened_at, submitted_at, final_cost: 0.0, cgst_applicable: 0, sgst_applicable: 0, transport_included: 0, transport_packaging: 0.0, transport_freight: 0.0, transport_loading: 0.0, transport_other: 0.0, reminder_60_sent: 0, reminder_30_sent: 0 };
        this.db.data.rfq_distributions.push(dist);
      } else {
        const [rfq_id, vendor_id, token, status] = args;
        dist = { rfq_id, vendor_id, token, status, sent_at: null, opened_at: null, submitted_at: null, final_cost: 0.0, cgst_applicable: 0, sgst_applicable: 0, transport_included: 0, transport_packaging: 0.0, transport_freight: 0.0, transport_loading: 0.0, transport_other: 0.0, reminder_60_sent: 0, reminder_30_sent: 0 };
        this.db.data.rfq_distributions.push(dist);
      }

      if (mongoose.connection.readyState === 1) {
        RfqDistribution.create(dist)
          .catch(err => console.error('[MongoDB Error] Dist create failed:', err.message));
      }
      return;
    }

    if (sql.includes('UPDATE rfq_distributions SET status = \'Sent\'')) {
      const [rfq_id, vendor_id] = args;
      const d = this.db.data.rfq_distributions.find(x => x.rfq_id === rfq_id && x.vendor_id === vendor_id);
      if (d) {
        d.status = 'Sent';
        d.sent_at = new Date().toISOString();

        if (mongoose.connection.readyState === 1) {
          RfqDistribution.findOneAndUpdate({ rfq_id, vendor_id }, { status: 'Sent', sent_at: d.sent_at }).exec()
            .catch(err => console.error('[MongoDB Error] Dist update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('UPDATE rfq_distributions SET status = \'Opened\'')) {
      const [rfq_id, vendor_id] = args;
      const d = this.db.data.rfq_distributions.find(x => x.rfq_id === rfq_id && x.vendor_id === vendor_id);
      if (d) {
        d.status = 'Opened';
        d.opened_at = new Date().toISOString();

        if (mongoose.connection.readyState === 1) {
          RfqDistribution.findOneAndUpdate({ rfq_id, vendor_id }, { status: 'Opened', opened_at: d.opened_at }).exec()
            .catch(err => console.error('[MongoDB Error] Dist update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('UPDATE rfq_distributions SET') || sql.includes("UPDATE rfq_distributions SET")) {
      const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i);
      if (setMatch) {
        const setParts = setMatch[1].split(',').map(p => p.trim());
        let argIdx = 0;
        const updates = {};
        setParts.forEach(part => {
          const m = part.match(/([a-zA-Z0-9_]+)\s*=\s*(.+)/i);
          if (m) {
            const col = m[1].toLowerCase();
            const valExpr = m[2].trim();
            if (valExpr === '?') {
              updates[col] = args[argIdx++];
            } else if (valExpr.startsWith("'") && valExpr.endsWith("'")) {
              updates[col] = valExpr.slice(1, -1);
            } else if (valExpr.toLowerCase() === "datetime('now')") {
              updates[col] = new Date().toISOString();
            } else {
              updates[col] = valExpr;
            }
          }
        });

        const whereMatch = sql.match(/WHERE\s+(.+)$/i);
        let rfq_id, vendor_id;
        if (whereMatch) {
          const whereParts = whereMatch[1].split(/AND/i).map(p => p.trim());
          whereParts.forEach(part => {
            const m = part.match(/([a-zA-Z0-9_]+)\s*=\s*\?/i);
            if (m) {
              const col = m[1].toLowerCase();
              if (col === 'rfq_id') {
                rfq_id = args[argIdx++];
              } else if (col === 'vendor_id') {
                vendor_id = args[argIdx++];
              }
            }
          });
        }

        if (rfq_id && vendor_id) {
          const d = this.db.data.rfq_distributions.find(x => x.rfq_id === rfq_id && x.vendor_id === vendor_id);
          if (d) {
            Object.keys(updates).forEach(col => {
              if (['final_cost', 'transport_packaging', 'transport_freight', 'transport_loading', 'transport_other'].includes(col)) {
                d[col] = parseFloat(updates[col]) || 0.0;
              } else if (['cgst_applicable', 'sgst_applicable', 'transport_included'].includes(col)) {
                d[col] = parseInt(updates[col]) || 0;
              } else {
                d[col] = updates[col];
              }
            });

            if (mongoose.connection.readyState === 1) {
              RfqDistribution.findOneAndUpdate({ rfq_id, vendor_id }, d).exec()
                .catch(err => console.error('[MongoDB Error] Dist update failed:', err.message));
            }
          }
        }
      }
      return;
    }

    // ─── 6. QUOTES QUERIES ───
    if (sql.includes('FROM vendor_quotes q JOIN vendors v') && sql.includes('vendor_name')) {
      const rfqId = args[0];
      const quotes = this.db.data.vendor_quotes.filter(q => q.rfq_id === rfqId);
      return quotes.map(q => {
        const v = this.db.data.vendors.find(x => x.id === q.vendor_id) || {};
        return {
          ...q,
          vendor_name: v.name || ''
        };
      });
    }

    if (sql.includes('FROM vendor_quotes') && !sql.includes('WHERE') && !sql.includes('ORDER BY') && !sql.includes('LIMIT')) {
      return [...this.db.data.vendor_quotes];
    }

    if (sql.includes('FROM vendor_quotes q JOIN rfq_items i ON q.item_id = i.id') && sql.includes('i.rfq_id = ?')) {
      const rfqId = args[0];
      const items = this.db.data.rfq_items.filter(item => item.rfq_id === rfqId);
      const itemIds = items.map(i => i.id);
      const quotes = this.db.data.vendor_quotes.filter(q => itemIds.includes(q.item_id));
      return quotes;
    }

    if (sql.includes('INSERT INTO vendor_quotes')) {
      const [rfq_id, vendor_id, item_id, rate, lead_time_days, payment_terms, remarks] = args;
      const quote = {
        rfq_id, vendor_id, item_id: parseInt(item_id), rate: parseFloat(rate),
        lead_time_days: parseInt(lead_time_days), payment_terms, remarks, submitted_at: new Date().toISOString()
      };
      this.db.data.vendor_quotes.push(quote);

      // Track pending quote inserts for bulk MongoDB sync (avoids race with deleteMany)
      if (!this._pendingQuoteInserts) this._pendingQuoteInserts = {};
      const key = `${rfq_id}|${vendor_id}`;
      if (!this._pendingQuoteInserts[key]) this._pendingQuoteInserts[key] = [];
      this._pendingQuoteInserts[key].push(quote);

      // Schedule a debounced flush after all quotes for this rfq+vendor are inserted
      if (this._quoteFlushTimers) clearTimeout(this._quoteFlushTimers[key]);
      if (!this._quoteFlushTimers) this._quoteFlushTimers = {};
      this._quoteFlushTimers[key] = setTimeout(async () => {
        if (mongoose.connection.readyState === 1) {
          const toInsert = (this._pendingQuoteInserts || {})[key] || [];
          if (toInsert.length > 0) {
            try {
              // Delete existing + insert new atomically to avoid race conditions
              await VendorQuote.deleteMany({ rfq_id, vendor_id });
              await VendorQuote.insertMany(toInsert);
            } catch (err) {
              console.error('[MongoDB Error] Bulk quote sync failed:', err.message);
            } finally {
              if (this._pendingQuoteInserts) delete this._pendingQuoteInserts[key];
            }
          }
        }
      }, 150); // 150ms debounce to batch all item inserts for one submission
      return;
    }

    if (sql.includes('DELETE FROM vendor_quotes WHERE rfq_id = ? AND vendor_id = ?') || sql.includes('DELETE FROM vendor_quotes WHERE rfq_id=? AND vendor_id=?')) {
      const [rfq_id, vendor_id] = args;
      this.db.data.vendor_quotes = this.db.data.vendor_quotes.filter(x => !(x.rfq_id === rfq_id && x.vendor_id === vendor_id));

      // Clear any pending inserts for this key (will be re-added by subsequent INSERT calls)
      const key = `${rfq_id}|${vendor_id}`;
      if (this._pendingQuoteInserts) delete this._pendingQuoteInserts[key];
      if (this._quoteFlushTimers) {
        clearTimeout(this._quoteFlushTimers[key]);
        delete this._quoteFlushTimers[key];
      }
      // MongoDB delete is handled by the subsequent INSERT flush to avoid race conditions
      return;
    }

    // ─── 7. AUDIT & NOTIFICATIONS QUERIES ───
    if (sql.includes('INSERT INTO audit_trail')) {
      const [username, action, details, ip_address] = args;
      const audit = {
        id: this.db.data.audit_trail.length + 1,
        username, action, details, ip_address,
        timestamp: new Date().toISOString()
      };
      this.db.data.audit_trail.push(audit);

      if (mongoose.connection.readyState === 1) {
        AuditLog.create(audit)
          .catch(err => console.error('[MongoDB Error] Audit log failed:', err.message));
      }
      return;
    }

    if (sql.includes('INSERT INTO notifications')) {
      const [title, message, rfq_id, vendor_id] = args;
      const notification = {
        id: this.db.data.notifications.length + 1,
        title, message, status: 'Unread',
        rfq_id: rfq_id || null,
        vendor_id: vendor_id || null,
        timestamp: new Date().toISOString()
      };
      this.db.data.notifications.push(notification);

      if (mongoose.connection.readyState === 1) {
        Notification.create(notification)
          .catch(err => console.error('[MongoDB Error] Notification failed:', err.message));
      }
      return;
    }

    if (sql.includes('DELETE FROM notifications')) {
      this.db.data.notifications = [];

      if (mongoose.connection.readyState === 1) {
        Notification.deleteMany({}).exec()
          .catch(err => console.error('[MongoDB Error] Clear notifications failed:', err.message));
      }
      return;
    }

    if (sql.includes('FROM users WHERE email = ?') || sql.includes('FROM users WHERE email=?')) {
      const email = args[0];
      if (!this.db.data.users) this.db.data.users = [];
      const user = this.db.data.users.find(x => x.email && x.email.toLowerCase() === email.toLowerCase());
      if (user) {
        return { 
          ...user, 
          vendor_id: user.vendorId || user.vendor_id, 
          vendorId: user.vendorId || user.vendor_id,
          transporter_id: user.transporterId || user.transporter_id,
          transporterId: user.transporterId || user.transporter_id
        };
      }
      return null;
    }

    if (sql.includes('FROM users WHERE id = ?') || sql.includes('FROM users WHERE id=?')) {
      const id = args[0];
      if (!this.db.data.users) this.db.data.users = [];
      const user = this.db.data.users.find(x => x.id === id);
      if (user) {
        return { 
          ...user, 
          vendor_id: user.vendorId || user.vendor_id, 
          vendorId: user.vendorId || user.vendor_id,
          transporter_id: user.transporterId || user.transporter_id,
          transporterId: user.transporterId || user.transporter_id
        };
      }
      return null;
    }

    if (sql.includes('SELECT') && sql.includes('FROM users') && !sql.includes('WHERE')) {
      if (!this.db.data.users) this.db.data.users = [];
      return this.db.data.users.map(u => ({ 
        ...u, 
        vendor_id: u.vendorId || u.vendor_id, 
        vendorId: u.vendorId || u.vendor_id,
        transporter_id: u.transporterId || u.transporter_id,
        transporterId: u.transporterId || u.transporter_id
      }));
    }

    if (sql.includes('INSERT INTO users')) {
      const [id, email, password_hash, role, vendor_id, transporter_id] = args;
      if (!this.db.data.users) this.db.data.users = [];
      const idx = this.db.data.users.findIndex(x => x.id === id);
      const newUser = {
        id,
        email,
        password_hash,
        role,
        vendorId: vendor_id || null,
        vendor_id: vendor_id || null,
        transporterId: transporter_id || null,
        transporter_id: transporter_id || null,
        created_at: new Date().toISOString()
      };
      if (idx >= 0) {
        this.db.data.users[idx] = newUser;
      } else {
        this.db.data.users.push(newUser);
      }

      if (mongoose.connection.readyState === 1) {
        User.findOneAndUpdate({ id }, newUser, { upsert: true, returnDocument: 'after' }).exec()
          .catch(err => console.error('[MongoDB Error] User insert/update failed:', err.message));
      }
      return;
    }

    if (sql.includes('DELETE FROM users WHERE id = ?') || sql.includes('DELETE FROM users WHERE id=?')) {
      const id = args[0];
      if (!this.db.data.users) this.db.data.users = [];
      this.db.data.users = this.db.data.users.filter(x => x.id !== id);

      if (mongoose.connection.readyState === 1) {
        User.deleteOne({ id }).exec()
          .catch(err => console.error('[MongoDB Error] User delete failed:', err.message));
      }
      return;
    }

    if (sql.includes('DELETE FROM users WHERE vendor_id = ?') || sql.includes('DELETE FROM users WHERE vendor_id=?')) {
      const vendorId = args[0];
      if (!this.db.data.users) this.db.data.users = [];
      this.db.data.users = this.db.data.users.filter(x => x.vendorId !== vendorId && x.vendor_id !== vendorId);

      if (mongoose.connection.readyState === 1) {
        User.deleteMany({ $or: [{ vendorId }, { vendor_id: vendorId }] }).exec()
          .catch(err => console.error('[MongoDB Error] User delete failed:', err.message));
      }
      return;
    }

    if (sql.includes('DELETE FROM users WHERE transporter_id = ?') || sql.includes('DELETE FROM users WHERE transporter_id=?')) {
      const transporterId = args[0];
      if (!this.db.data.users) this.db.data.users = [];
      this.db.data.users = this.db.data.users.filter(x => x.transporterId !== transporterId && x.transporter_id !== transporterId);

      if (mongoose.connection.readyState === 1) {
        User.deleteMany({ $or: [{ transporterId }, { transporter_id: transporterId }] }).exec()
          .catch(err => console.error('[MongoDB Error] User delete failed:', err.message));
      }
      return;
    }

    if (sql.includes('DELETE FROM users') && !sql.includes('WHERE')) {
      this.db.data.users = [];

      if (mongoose.connection.readyState === 1) {
        User.deleteMany({}).exec()
          .catch(err => console.error('[MongoDB Error] Clear users failed:', err.message));
      }
      return;
    }

    if (sql.includes('FROM audit_trail ORDER BY timestamp DESC')) {
      const sorted = [...this.db.data.audit_trail].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
      return sorted.slice(0, 50);
    }

    if (sql.includes('FROM notifications ORDER BY timestamp DESC')) {
      const sorted = [...this.db.data.notifications].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
      return sorted.slice(0, 20);
    }

    if (sql.includes('FROM vendor_quotes q') && sql.includes('JOIN rfqs r ON') && sql.includes("d.status = 'Submitted'")) {
      const quotesDb = this.db.data.vendor_quotes || [];
      const distsDb = this.db.data.rfq_distributions || [];
      const rfqsDb = this.db.data.rfqs || [];
      const itemsDb = this.db.data.rfq_items || [];
      const vendorsDb = this.db.data.vendors || [];

      const joined = [];
      quotesDb.forEach(q => {
        const dist = distsDb.find(d => d.rfq_id === q.rfq_id && d.vendor_id === q.vendor_id);
        if (dist && dist.status === 'Submitted') {
          const rfq = rfqsDb.find(r => r.id === q.rfq_id);
          // Use == (loose equality) to handle Number vs String type mismatch from MongoDB/JSON
          const item = itemsDb.find(i => i.id == q.item_id);
          const vendor = vendorsDb.find(v => v.id === q.vendor_id);

          joined.push({
            rfq_id: q.rfq_id,
            vendor_id: q.vendor_id,
            item_id: q.item_id,
            rate: q.rate,
            lead_time_days: q.lead_time_days || q.lead_time || 0,
            remarks: q.remarks || '',
            payment_terms: dist.payment_terms || q.payment_terms || '',
            rfq_number: rfq ? rfq.rfq_number : 'RFQ-XXX',
            project_name: rfq ? rfq.project_name : 'N/A',
            description: item ? item.description : 'N/A',
            moc: item ? item.moc : 'N/A',
            make: item ? (item.make || '') : '',
            size: item ? item.size : 'N/A',
            quantity: item ? item.quantity : 0,
            unit: item ? item.unit : 'Nos',
            vendor_name: vendor ? vendor.name : 'Unknown Vendor',
            final_cost: dist.final_cost || 0,
            cgst_applicable: dist.cgst_applicable || 0,
            sgst_applicable: dist.sgst_applicable || 0,
            transport_included: dist.transport_included || 0,
            transport_packaging: dist.transport_packaging || 0,
            transport_freight: dist.transport_freight || 0,
            transport_loading: dist.transport_loading || 0,
            transport_other: dist.transport_other || 0,
            submitted_at: dist.submitted_at || ''
          });
        }
      });

      joined.sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''));
      return joined;
    }

    if (sql.includes('FROM vendor_quotes q JOIN rfqs r') || (sql.includes('FROM vendor_quotes q') && sql.includes('JOIN rfqs r'))) {
      const vendorId = args[0];
      const vendorQuotes = this.db.data.vendor_quotes.filter(q => q.vendor_id === vendorId);
      
      return vendorQuotes.map(q => {
        const r = this.db.data.rfqs.find(rfq => rfq.id === q.rfq_id);
        const i = this.db.data.rfq_items.find(item => item.id === q.item_id);
        const d = this.db.data.rfq_distributions.find(dist => dist.rfq_id === q.rfq_id && dist.vendor_id === q.vendor_id);
        return {
          ...q,
          rfq_number: r ? r.rfq_number : 'RFQ-XXX',
          project_name: r ? r.project_name : 'Unknown Project',
          description: i ? i.description : 'Unknown Item',
          moc: i ? i.moc : '',
          size: i ? i.size : '',
          quantity: i ? i.quantity : 0,
          unit: i ? i.unit : '',
          final_cost: d ? d.final_cost : 0.0,
          cgst_applicable: d ? (d.cgst_applicable || 0) : 0,
          sgst_applicable: d ? (d.sgst_applicable || 0) : 0,
          transport_included: d ? (d.transport_included || 0) : 0,
          transport_packaging: d ? (d.transport_packaging || 0) : 0,
          transport_freight: d ? (d.transport_freight || 0) : 0,
          transport_loading: d ? (d.transport_loading || 0) : 0,
          transport_other: d ? (d.transport_other || 0) : 0
        };
      });
    }

    // ─── 8. COPILOT STATISTICS QUERIES ───
    if (sql.includes('avg(q.lead_time_days) AS avg_lead')) {
      const groups = {};
      this.db.data.vendor_quotes.forEach(q => {
        if (!groups[q.vendor_id]) {
          groups[q.vendor_id] = { vendor_id: q.vendor_id, sum: 0, count: 0 };
        }
        groups[q.vendor_id].sum += q.lead_time_days || 0;
        groups[q.vendor_id].count++;
      });
      const list = Object.values(groups).map(g => {
        const v = this.db.data.vendors.find(x => x.id === g.vendor_id) || {};
        return {
          vendor_id: g.vendor_id,
          vendor_name: v.name || 'Unknown',
          avg_lead: g.count > 0 ? (g.sum / g.count) : 0
        };
      });
      list.sort((a, b) => a.avg_lead - b.avg_lead);
      return list.slice(0, 5);
    }

    if (sql.includes('MIN(q.lead_time_days) AS lt')) {
      const groups = {};
      this.db.data.vendor_quotes.forEach(q => {
        if (!groups[q.vendor_id] || q.lead_time_days < groups[q.vendor_id]) {
          groups[q.vendor_id] = q.lead_time_days;
        }
      });
      const list = Object.entries(groups).map(([vendor_id, lt]) => {
        const v = this.db.data.vendors.find(x => x.id === vendor_id) || {};
        return { name: v.name || 'Unknown', lt };
      });
      list.sort((a, b) => a.lt - b.lt);
      return list[0];
    }

    if (sql.includes('AVG(q.rate) OVER (PARTITION BY q.item_id) AS avg_rate')) {
      const itemAvgs = {};
      this.db.data.vendor_quotes.forEach(q => {
        if (!itemAvgs[q.item_id]) {
          itemAvgs[q.item_id] = { sum: 0, count: 0 };
        }
        itemAvgs[q.item_id].sum += q.rate || 0;
        itemAvgs[q.item_id].count++;
      });
      
      const res = [];
      this.db.data.vendor_quotes.forEach(q => {
        const v = this.db.data.vendors.find(x => x.id === q.vendor_id) || {};
        const item = this.db.data.rfq_items.find(x => x.id === q.item_id) || {};
        const avg = itemAvgs[q.item_id] && itemAvgs[q.item_id].count > 0 
          ? (itemAvgs[q.item_id].sum / itemAvgs[q.item_id].count) 
          : 0;
        res.push({
          name: v.name || 'Unknown',
          rate: q.rate || 0,
          description: item.description || '',
          avg_rate: avg
        });
      });
      return res;
    }

    if (sql.includes('FROM rfq_items i LEFT JOIN vendor_quotes q')) {
      const vendorId = args[0];
      const rfqId = args[1];
      const items = this.db.data.rfq_items.filter(x => x.rfq_id === rfqId);
      return items.map(item => {
        const quote = this.db.data.vendor_quotes.find(q => q.item_id == item.id && q.vendor_id === vendorId) || {};
        return {
          ...item,
          rate: quote.rate !== undefined ? quote.rate : null,
          lead_time_days: quote.lead_time_days !== undefined ? quote.lead_time_days : null,
          payment_terms: quote.payment_terms !== undefined ? quote.payment_terms : null,
          remarks: quote.remarks !== undefined ? quote.remarks : null
        };
      });
    }

    if (sql.includes('SUM(q.rate * i.quantity) AS total') && sql.includes('q.rfq_id = ?')) {
      const rfqId = args[0];
      const quotes = this.db.data.vendor_quotes.filter(q => q.rfq_id === rfqId);
      const groups = {};
      quotes.forEach(q => {
        const item = this.db.data.rfq_items.find(x => x.id === q.item_id);
        const qty = item ? item.quantity : 0;
        if (!groups[q.vendor_id]) {
          groups[q.vendor_id] = 0;
        }
        groups[q.vendor_id] += (q.rate || 0) * qty;
      });
      const list = Object.entries(groups).map(([vendor_id, total]) => {
        const v = this.db.data.vendors.find(x => x.id === vendor_id) || {};
        return { name: v.name || 'Unknown', total };
      });
      list.sort((a, b) => a.total - b.total);
      return list;
    }

    if (sql.includes('count(distinct q.rfq_id) AS total_rfqs')) {
      const groups = {};
      this.db.data.vendor_quotes.forEach(q => {
        const item = this.db.data.rfq_items.find(x => x.id === q.item_id);
        const qty = item ? item.quantity : 0;
        if (!groups[q.vendor_id]) {
          groups[q.vendor_id] = { vendor_id: q.vendor_id, rfqs: new Set(), total_value: 0 };
        }
        groups[q.vendor_id].rfqs.add(q.rfq_id);
        groups[q.vendor_id].total_value += (q.rate || 0) * qty;
      });
      return Object.values(groups).map(g => {
        const v = this.db.data.vendors.find(x => x.id === g.vendor_id) || {};
        return {
          vendor_id: g.vendor_id,
          vendor_name: v.name || 'Unknown',
          total_rfqs: g.rfqs.size,
          total_value: g.total_value
        };
      });
    }

    if (sql.includes('SUM(rate * quantity) AS total_val') || sql.includes('sum(rate * quantity) AS total_val')) {
      const vendorId = args[0];
      const quotes = this.db.data.vendor_quotes.filter(q => q.vendor_id === vendorId);
      const rfqMap = {};
      quotes.forEach(q => {
        const item = this.db.data.rfq_items.find(x => x.id === q.item_id);
        const qty = item ? item.quantity : 0;
        if (!rfqMap[q.rfq_id]) {
          rfqMap[q.rfq_id] = 0;
        }
        rfqMap[q.rfq_id] += (q.rate || 0) * qty;
      });
      return Object.entries(rfqMap).map(([rfq_id, total_val]) => ({ rfq_id, total_val }));
    }

    // ─── 9. TRANSPORTERS MODULE QUERIES ───
    if (sql.includes('SELECT count(*) AS c FROM transporters')) {
      return { c: this.db.data.transporters.filter(t => !t.archived).length };
    }

    if (sql.includes('SELECT id FROM transporters ORDER BY id DESC LIMIT 1')) {
      if (this.db.data.transporters.length === 0) return undefined;
      const sorted = [...this.db.data.transporters].sort((a, b) => (b.id || '').localeCompare(a.id || ''));
      return { id: sorted[0].id };
    }

    if (sql.includes('FROM transporters WHERE archived = 1')) {
      return [...this.db.data.transporters].filter(t => t.archived === 1).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    if (sql.includes('FROM transporters') && sql.includes('ORDER BY name')) {
      return [...this.db.data.transporters].filter(t => !t.archived).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    if (sql.includes('SELECT') && (sql.includes('FROM transporters WHERE id = ?') || sql.includes('FROM transporters WHERE id=?'))) {
      const id = args[0];
      const t = this.db.data.transporters.find(x => x.id === id);
      return t;
    }

    if (sql.includes('SELECT') && sql.includes('FROM transporters') && !sql.includes('WHERE') && !sql.includes('ORDER BY') && !sql.includes('LIMIT')) {
      return [...this.db.data.transporters].filter(t => !t.archived);
    }

    if (sql.includes('INSERT INTO transporters')) {
      const [id, name, contact_person, email, phone, company_name, gst_number, pan_number, address, category, rating] = args;
      const idx = this.db.data.transporters.findIndex(x => x.id === id);
      const newTransporter = {
        id, name, contact_person, email, phone, company_name, gst_number, pan_number, address, category,
        rating: rating || 4.0, archived: 0, created_at: new Date().toISOString()
      };
      if (idx >= 0) {
        this.db.data.transporters[idx] = newTransporter;
      } else {
        this.db.data.transporters.push(newTransporter);
      }

      if (mongoose.connection.readyState === 1) {
        Transporter.findOneAndUpdate({ id }, newTransporter, { upsert: true, returnDocument: 'after' }).exec()
          .catch(err => console.error('[MongoDB Error] Transporter insert failed:', err.message));
      }
      return;
    }

    if (sql.includes('UPDATE transporters SET archived = ?') || sql.includes('UPDATE transporters SET archived = 1') || sql.includes('UPDATE transporters SET archived = 0')) {
      const [archivedVal, id] = args.length === 2 ? args : [sql.includes('archived = 1') ? 1 : 0, args[0]];
      const archived = archivedVal ? 1 : 0;
      const t = this.db.data.transporters.find(x => x.id === id);
      if (t) {
        t.archived = archived;
        if (mongoose.connection.readyState === 1) {
          Transporter.findOneAndUpdate({ id }, { archived }).exec()
            .catch(err => console.error('[MongoDB Error] Transporter archive update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('UPDATE transporters SET') && sql.includes('name = ?') && sql.includes('email = ?') && sql.includes('bank_name = ?')) {
      const [name, email, contact_person, phone, address, bank_name, bank_address, account_name, account_type, account_number, ifsc_code, gst_number, pan_number, id] = args;
      const t = this.db.data.transporters.find(x => x.id === id);
      if (t) {
        t.name = name;
        t.company_name = name; // Maintain sync with company name
        t.email = email;
        t.contact_person = contact_person;
        t.phone = phone;
        t.address = address;
        t.bank_name = bank_name;
        t.bank_address = bank_address;
        t.account_name = account_name;
        t.account_type = account_type;
        t.account_number = account_number;
        t.ifsc_code = ifsc_code;
        t.gst_number = gst_number;
        t.pan_number = pan_number;

        if (mongoose.connection.readyState === 1) {
          const updateObj = { name, company_name: name, email, contact_person, phone, address, bank_name, bank_address, account_name, account_type, account_number, ifsc_code, gst_number, pan_number };
          Transporter.findOneAndUpdate({ id }, updateObj).exec()
            .catch(err => console.error('[MongoDB Error] Transporter registration update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('UPDATE transporters SET') && sql.includes('bank_name = ?')) {
      let contact_person, phone, address, bank_name, bank_address, account_name, account_type, account_number, ifsc_code, gst_number, pan_number, id;
      if (sql.includes('contact_person = ?')) {
        [contact_person, phone, address, bank_name, bank_address, account_name, account_type, account_number, ifsc_code, gst_number, pan_number, id] = args;
      } else {
        [phone, address, bank_name, bank_address, account_name, account_type, account_number, ifsc_code, gst_number, pan_number, id] = args;
      }
      const t = this.db.data.transporters.find(x => x.id === id);
      if (t) {
        if (contact_person !== undefined) t.contact_person = contact_person;
        t.phone = phone;
        t.address = address;
        t.bank_name = bank_name;
        t.bank_address = bank_address;
        t.account_name = account_name;
        t.account_type = account_type;
        t.account_number = account_number;
        t.ifsc_code = ifsc_code;
        t.gst_number = gst_number;
        t.pan_number = pan_number;

        if (mongoose.connection.readyState === 1) {
          const updateObj = { phone, address, bank_name, bank_address, account_name, account_type, account_number, ifsc_code, gst_number, pan_number };
          if (contact_person !== undefined) updateObj.contact_person = contact_person;
          Transporter.findOneAndUpdate({ id }, updateObj).exec()
            .catch(err => console.error('[MongoDB Error] Transporter registration update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('UPDATE transporters SET name')) {
      let name, contact_person, email, phone, company_name, gst_number, pan_number, address, rating, category, id;
      if (args.length === 11) {
        [name, contact_person, email, phone, company_name, gst_number, pan_number, address, rating, category, id] = args;
      } else {
        [name, contact_person, email, phone, company_name, gst_number, pan_number, address, rating, id] = args;
      }
      const t = this.db.data.transporters.find(x => x.id === id);
      if (t) {
        t.name = name;
        t.contact_person = contact_person;
        t.email = email;
        t.phone = phone;
        t.company_name = company_name;
        t.gst_number = gst_number;
        t.pan_number = pan_number;
        t.address = address;
        t.rating = rating;
        if (category !== undefined) t.category = category;

        if (mongoose.connection.readyState === 1) {
          Transporter.findOneAndUpdate({ id }, { name, contact_person, email, phone, company_name, gst_number, pan_number, address, rating, category: t.category }).exec()
            .catch(err => console.error('[MongoDB Error] Transporter update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('DELETE FROM transporters WHERE id = ?')) {
      const id = args[0];
      this.db.data.transporters = this.db.data.transporters.filter(x => x.id !== id);
      this.db.data.transport_distributions = this.db.data.transport_distributions.filter(x => x.transporter_id !== id);

      if (mongoose.connection.readyState === 1) {
        Transporter.deleteOne({ id }).exec()
          .catch(err => console.error('[MongoDB Error] Transporter delete failed:', err.message));
        TransportDistribution.deleteMany({ transporter_id: id }).exec()
          .catch(err => console.error('[MongoDB Error] TransportDistribution delete failed:', err.message));
      }
      return;
    }

    // ─── 10. TRANSPORT REQUESTS QUERIES ───
    if (sql.includes('SELECT count(*) AS c FROM transport_requests')) {
      return { c: this.db.data.transport_requests.length };
    }

    if (sql.includes('SELECT r.* FROM transport_requests r')) {
      const requests = [...this.db.data.transport_requests];
      requests.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      return requests.map(r => {
        const item_count = this.db.data.transport_request_items.filter(x => x.request_id === r.id).length;
        const sent_count = this.db.data.transport_distributions.filter(x => x.request_id === r.id).length;
        const response_count = this.db.data.transport_distributions.filter(x => x.request_id === r.id && x.status === 'Submitted').length;
        return {
          ...r,
          item_count,
          sent_count,
          response_count
        };
      });
    }

    if (sql.includes('SELECT * FROM transport_requests') && !sql.includes('WHERE')) {
      return [...this.db.data.transport_requests];
    }

    if (sql.includes('SELECT * FROM transport_requests WHERE id = ?') || sql.includes('SELECT * FROM transport_requests WHERE id=?') || sql.includes('SELECT request_number, from_location, to_location FROM transport_requests WHERE id = ?')) {
      const id = args[0];
      const r = this.db.data.transport_requests.find(x => x.id === id);
      return r;
    }

    if (sql.includes('INSERT INTO transport_requests')) {
      let newRequest = { created_at: new Date().toISOString() };
      const match = sql.match(/INSERT INTO transport_requests\s*\(([^)]+)\)/i);
      if (match) {
        const cols = match[1].split(',').map(c => c.trim().toLowerCase());
        cols.forEach((col, idx) => {
          let val = args[idx];
          if (['distance', 'vehicle_tonnage', 'actual_weight_charged', 'odc_charges', 'tax_bracket'].includes(col)) {
            val = parseFloat(val) || 0.0;
          }
          newRequest[col] = val;
        });
      } else {
        if (args.length > 8) {
          const [id, request_number, from_location, to_location, required_date, distance, vehicle_available_from, vehicle_size, vehicle_tonnage, actual_weight_charged, odc_charges, weight_unit, tax_bracket] = args;
          newRequest = {
            id, request_number, from_location, to_location, required_date, status: 'Draft',
            distance: parseFloat(distance) || 0.0,
            vehicle_available_from: vehicle_available_from || null,
            vehicle_size: vehicle_size || '',
            vehicle_tonnage: parseFloat(vehicle_tonnage) || 0.0,
            actual_weight_charged: parseFloat(actual_weight_charged) || 0.0,
            odc_charges: parseFloat(odc_charges) || 0.0,
            weight_unit: weight_unit || 'Tons',
            tax_bracket: parseFloat(tax_bracket) || 0.0,
            launched_at: null, expires_at: null,
            created_at: new Date().toISOString()
          };
        } else {
          const [id, request_number, from_location, to_location, required_date, status, launched_at, expires_at] = args;
          newRequest = {
            id, request_number, from_location, to_location, required_date, status,
            launched_at: launched_at || null, expires_at: expires_at || null,
            created_at: new Date().toISOString()
          };
        }
      }
      const idx = this.db.data.transport_requests.findIndex(x => x.id === newRequest.id);
      if (idx >= 0) {
        this.db.data.transport_requests[idx] = newRequest;
      } else {
        this.db.data.transport_requests.push(newRequest);
      }

      if (mongoose.connection.readyState === 1) {
        TransportRequest.findOneAndUpdate({ id: newRequest.id }, newRequest, { upsert: true, returnDocument: 'after' }).exec()
          .catch(err => console.error('[MongoDB Error] TransportRequest insert failed:', err.message));
      }
      return;
    }

    if (sql.includes('UPDATE transport_requests') && sql.includes('launched_at = ?')) {
      let status = 'Sent';
      let launched_at, expires_at, id;
      if (sql.includes("status = 'Sent'")) {
        [launched_at, expires_at, id] = args;
      } else {
        [status, launched_at, expires_at, id] = args;
      }
      const r = this.db.data.transport_requests.find(x => x.id === id);
      if (r) {
        r.status = status;
        r.launched_at = launched_at;
        r.expires_at = expires_at;

        if (mongoose.connection.readyState === 1) {
          TransportRequest.findOneAndUpdate({ id }, { status, launched_at, expires_at }).exec()
            .catch(err => console.error('[MongoDB Error] TransportRequest update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('UPDATE transport_requests') && (sql.includes('expires_at = ? WHERE id = ?') || sql.includes('expires_at=? WHERE id=?'))) {
      const [expires_at, id] = args;
      const r = this.db.data.transport_requests.find(x => x.id === id);
      if (r) {
        r.expires_at = expires_at;

        if (mongoose.connection.readyState === 1) {
          TransportRequest.findOneAndUpdate({ id }, { expires_at }).exec()
            .catch(err => console.error('[MongoDB Error] TransportRequest update expires_at failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('UPDATE transport_requests') && sql.includes('status = ? WHERE id = ?')) {
      const [status, id] = args;
      const r = this.db.data.transport_requests.find(x => x.id === id);
      if (r) {
        r.status = status;

        if (mongoose.connection.readyState === 1) {
          TransportRequest.findOneAndUpdate({ id }, { status }).exec()
            .catch(err => console.error('[MongoDB Error] TransportRequest status update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('UPDATE transport_requests') && sql.includes("status = 'Submitted'")) {
      const id = args[0];
      const r = this.db.data.transport_requests.find(x => x.id === id);
      if (r) {
        r.status = 'Submitted';

        if (mongoose.connection.readyState === 1) {
          TransportRequest.findOneAndUpdate({ id }, { status: 'Submitted' }).exec()
            .catch(err => console.error('[MongoDB Error] TransportRequest submit status update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('UPDATE transport_requests') && sql.includes("status = 'Closed'")) {
      const id = args[0];
      const r = this.db.data.transport_requests.find(x => x.id === id);
      if (r) {
        r.status = 'Closed';

        if (mongoose.connection.readyState === 1) {
          TransportRequest.findOneAndUpdate({ id }, { status: 'Closed' }).exec()
            .catch(err => console.error('[MongoDB Error] TransportRequest close status update failed:', err.message));
        }
      }
      return;
    }

    if (sql.includes('DELETE FROM transport_requests WHERE id = ?')) {
      const id = args[0];
      this.db.data.transport_requests = this.db.data.transport_requests.filter(x => x.id !== id);
      this.db.data.transport_request_items = this.db.data.transport_request_items.filter(x => x.request_id !== id);
      this.db.data.transport_distributions = this.db.data.transport_distributions.filter(x => x.request_id !== id);

      if (mongoose.connection.readyState === 1) {
        TransportRequest.deleteOne({ id }).exec()
          .catch(err => console.error('[MongoDB Error] TransportRequest delete failed:', err.message));
        TransportRequestItem.deleteMany({ request_id: id }).exec()
          .catch(err => console.error('[MongoDB Error] TransportRequestItem delete failed:', err.message));
        TransportDistribution.deleteMany({ request_id: id }).exec()
          .catch(err => console.error('[MongoDB Error] TransportDistribution delete failed:', err.message));
      }
      return;
    }

    // ─── 11. TRANSPORT REQUEST ITEMS QUERIES ───
    if (sql.includes('FROM transport_request_items WHERE request_id = ?') || sql.includes('FROM transport_request_items WHERE request_id=?')) {
      const requestId = args[0];
      return this.db.data.transport_request_items.filter(x => x.request_id === requestId);
    }

    if (sql.includes('INSERT INTO transport_request_items')) {
      let item;
      if (args.length === 9) {
        const [request_id, material_name, material_category, vehicle_type, size_ft, quantity, unit, odc_charges, remarks] = args;
        item = {
          id: this.db.data.transport_request_items.length + 1,
          request_id,
          material_name,
          material_category,
          vehicle_type: vehicle_type || '',
          size_ft: parseFloat(size_ft) || 0,
          quantity: parseFloat(quantity) || 0,
          unit,
          odc_charges: parseFloat(odc_charges) || 0,
          remarks
        };
      } else {
        const [request_id, material_name, material_category, quantity, unit, remarks] = args;
        item = {
          id: this.db.data.transport_request_items.length + 1,
          request_id,
          material_name,
          material_category,
          vehicle_type: '',
          size_ft: 0,
          quantity: parseFloat(quantity) || 0,
          unit,
          odc_charges: 0,
          remarks
        };
      }
      this.db.data.transport_request_items.push(item);

      if (mongoose.connection.readyState === 1) {
        queueMongo(TransportRequestItem.create(item)
          .catch(err => console.error('[MongoDB Error] TransportRequestItem create failed:', err.message)));
      }
      return;
    }

    if (sql.includes('DELETE FROM transport_request_items WHERE request_id = ?')) {
      const requestId = args[0];
      this.db.data.transport_request_items = this.db.data.transport_request_items.filter(x => x.request_id !== requestId);

      if (mongoose.connection.readyState === 1) {
        TransportRequestItem.deleteMany({ request_id: requestId }).exec()
          .catch(err => console.error('[MongoDB Error] TransportRequestItem delete failed:', err.message));
      }
      return;
    }

    // ─── 12. TRANSPORT DISTRIBUTIONS QUERIES ───
    if (sql.includes('FROM transport_distributions d JOIN transporters t') && sql.includes("d.status != 'Submitted'")) {
      const requestId = args[0];
      const dists = this.db.data.transport_distributions.filter(x => x.request_id === requestId && x.status !== 'Submitted');
      return dists.map(d => {
        const t = this.db.data.transporters.find(x => x.id === d.transporter_id) || {};
        return {
          ...d,
          transporter_name: t.name || 'Unknown Transporter',
          transporter_email: t.email || '',
          contact_person: t.contact_person || ''
        };
      });
    }

    if (sql.includes('FROM transport_distributions d JOIN transporters t') && sql.includes('d.request_id = ?')) {
      const requestId = args[0];
      const dists = this.db.data.transport_distributions.filter(x => x.request_id === requestId);
      return dists.map(d => {
        const t = this.db.data.transporters.find(x => x.id === d.transporter_id) || {};
        return {
          ...d,
          transporter_name: t.name || 'Unknown Transporter',
          transporter_email: t.email || '',
          contact_person: t.contact_person || ''
        };
      });
    }

    if (sql.includes('FROM transport_distributions d') && sql.includes('JOIN transport_requests r') && sql.includes("d.status = 'Scheduled'")) {
      const scheduledDists = this.db.data.transport_distributions.filter(x => x.status === 'Scheduled');
      return scheduledDists.map(d => {
        const r = this.db.data.transport_requests.find(x => x.id === d.request_id) || {};
        return {
          ...d,
          request_number: r.request_number || 'TRQ-XXX',
          expires_at: r.expires_at || null,
          vehicle_available_from: r.vehicle_available_from || null
        };
      });
    }

    if (sql.includes('FROM transport_distributions d') && sql.includes('JOIN transport_requests r') && sql.includes("d.status IN ('Sent', 'Opened')")) {
      const activeDists = this.db.data.transport_distributions.filter(x => x.status === 'Sent' || x.status === 'Opened');
      return activeDists.map(d => {
        const r = this.db.data.transport_requests.find(x => x.id === d.request_id) || {};
        const t = this.db.data.transporters.find(x => x.id === d.transporter_id) || {};
        return {
          ...d,
          request_number: r.request_number || 'TRQ-XXX',
          expires_at: r.expires_at || null,
          request_status: r.status || 'Draft',
          transporter_email: t.email || '',
          transporter_name: t.name || '',
          contact_person: t.contact_person || ''
        };
      });
    }

    if (sql.includes('FROM transport_distributions d JOIN transport_requests r') && sql.includes('d.token = ?')) {
      const token = args[0];
      const d = this.db.data.transport_distributions.find(x => x.token === token);
      if (!d) return undefined;
      const r = this.db.data.transport_requests.find(x => x.id === d.request_id);
      if (!r) return undefined;
      return {
        ...d,
        request_number: r.request_number,
        from_location: r.from_location,
        to_location: r.to_location,
        required_date: r.required_date,
        expires_at: r.expires_at,
        request_status: r.status
      };
    }

    if (sql.includes('FROM transport_distributions d') && sql.includes('JOIN transport_requests r') && sql.includes('JOIN transporters t') && sql.includes("d.status = 'Submitted'")) {
      const submitted = this.db.data.transport_distributions.filter(x => x.status === 'Submitted');
      return submitted.map(d => {
        const r = this.db.data.transport_requests.find(x => x.id === d.request_id) || {};
        const t = this.db.data.transporters.find(x => x.id === d.transporter_id) || {};
        return {
          ...d,
          request_number: r.request_number || 'TRQ-XXX',
          from_location: r.from_location || '',
          to_location: r.to_location || '',
          required_date: r.required_date || '',
          transporter_name: t.name || '',
          transporter_email: t.email || '',
          contact_person: t.contact_person || ''
        };
      });
    }

    if (sql.includes('SELECT') && sql.includes('FROM transport_distributions') && sql.includes('status != \'Submitted\'') && sql.includes('status != \'Expired\'')) {
      const dists = this.db.data.transport_distributions.filter(x => x.status !== 'Submitted' && x.status !== 'Expired');
      return dists.map(d => {
        const t = this.db.data.transporters.find(x => x.id === d.transporter_id) || {};
        return {
          ...d,
          transporter_email: t.email || '',
          transporter_name: t.name || '',
          contact_person: t.contact_person || ''
        };
      });
    }

    if (sql.includes('SELECT * FROM transport_distributions') && !sql.includes('WHERE')) {
      return [...this.db.data.transport_distributions];
    }

    if (sql.includes('FROM transport_distributions WHERE transporter_id = ?') || sql.includes('FROM transport_distributions WHERE transporter_id=?')) {
      const transporterId = args[0];
      return this.db.data.transport_distributions.filter(x => x.transporter_id === transporterId);
    }

    if (sql.includes('FROM transport_distributions WHERE request_id = ?') || sql.includes('FROM transport_distributions WHERE request_id=?')) {
      const requestId = args[0];
      return this.db.data.transport_distributions.filter(x => x.request_id === requestId);
    }

    if (sql.includes('DELETE FROM transport_distributions WHERE request_id = ?')) {
      const requestId = args[0];
      this.db.data.transport_distributions = this.db.data.transport_distributions.filter(x => x.request_id !== requestId);
      if (mongoose.connection.readyState === 1) {
        TransportDistribution.deleteMany({ request_id: requestId }).exec()
          .catch(err => console.error('[MongoDB Error] TransportDistribution delete failed:', err.message));
      }
      return;
    }

    if (sql.includes('INSERT INTO transport_distributions')) {
      const [request_id, transporter_id, token, status, sent_at, opened_at, submitted_at, distance, vehicle_available_from, vehicle_size, vehicle_tonnage, actual_weight_charged, rate_per_ton, final_cost, reminder_60_sent, reminder_30_sent] = args;
      const req = this.db.data.transport_requests.find(x => x.id === request_id);
      const dist = {
        request_id, transporter_id, token, status: status || 'Sent',
        sent_at: sent_at || new Date().toISOString(),
        opened_at: opened_at || null,
        submitted_at: submitted_at || null,
        distance: req ? parseFloat(req.distance) || 0.0 : (parseFloat(distance) || 0.0),
        vehicle_available_from: req ? req.vehicle_available_from || null : (vehicle_available_from || null),
        vehicle_size: req ? req.vehicle_size || '' : (vehicle_size || ''),
        vehicle_tonnage: req ? parseFloat(req.vehicle_tonnage) || 0.0 : (parseFloat(vehicle_tonnage) || 0.0),
        actual_weight_charged: req ? parseFloat(req.actual_weight_charged) || 0.0 : (parseFloat(actual_weight_charged) || 0.0),
        rate_per_ton: parseFloat(rate_per_ton) || 0.0,
        final_cost: parseFloat(final_cost) || 0.0,
        reminder_60_sent: parseInt(reminder_60_sent) || 0,
        reminder_30_sent: parseInt(reminder_30_sent) || 0,
        reminder_15_sent: 0,
        start_location: req ? req.from_location : '',
        end_location: req ? req.to_location : '',
        odc_charges: req ? parseFloat(req.odc_charges) || 0.0 : 0.0,
        weight_unit: req ? req.weight_unit || 'Tons' : 'Tons',
        tax_bracket: req ? parseFloat(req.tax_bracket) || 0.0 : 0.0,
        return_trip_included: 0,
        return_trip_rate: 0.0
      };
      this.db.data.transport_distributions.push(dist);

      if (mongoose.connection.readyState === 1) {
        queueMongo(TransportDistribution.create(dist)
          .catch(err => console.error('[MongoDB Error] TransportDistribution create failed:', err.message)));
      }
      return;
    }

    if (sql.includes('UPDATE transport_distributions SET') || sql.includes("UPDATE transport_distributions SET")) {
      const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i);
      if (setMatch) {
        const setParts = setMatch[1].split(',').map(p => p.trim());
        let argIdx = 0;
        const updates = {};
        setParts.forEach(part => {
          const m = part.match(/([a-zA-Z0-9_]+)\s*=\s*(.+)/i);
          if (m) {
            const col = m[1].toLowerCase();
            const valExpr = m[2].trim();
            if (valExpr === '?') {
              updates[col] = args[argIdx++];
            } else if (valExpr.startsWith("'") && valExpr.endsWith("'")) {
              updates[col] = valExpr.slice(1, -1);
            } else if (valExpr.toLowerCase() === "datetime('now')") {
              updates[col] = new Date().toISOString();
            } else {
              updates[col] = valExpr;
            }
          }
        });

        const whereMatch = sql.match(/WHERE\s+(.+)$/i);
        let token, request_id, transporter_id, statusNot;
        if (whereMatch) {
          const whereParts = whereMatch[1].split(/AND/i).map(p => p.trim());
          whereParts.forEach(part => {
            const m = part.match(/([a-zA-Z0-9_]+)\s*(?:=\s*(?:\?|'([^']+)')|!=\s*(?:\?|'([^']+)'))/i);
            if (m) {
              const col = m[1].toLowerCase();
              const isNot = part.includes('!=');
              const valExpr = m[2] || m[3] || '?';
              let val = valExpr === '?' ? args[argIdx++] : valExpr;
              
              if (isNot) {
                if (col === 'status') statusNot = val;
              } else {
                if (col === 'token') {
                  token = val;
                } else if (col === 'request_id') {
                  request_id = val;
                } else if (col === 'transporter_id') {
                  transporter_id = val;
                }
              }
            }
          });
        }

        this.db.data.transport_distributions.forEach(d => {
          let match = false;
          if (token && d.token === token) {
            match = true;
          } else if (request_id && transporter_id && d.request_id === request_id && d.transporter_id === transporter_id) {
            match = true;
          } else if (request_id && !transporter_id && d.request_id === request_id) {
            match = true;
          }

          if (match && statusNot && d.status === statusNot) {
            match = false;
          }

          if (match) {
            Object.keys(updates).forEach(col => {
              if (['distance', 'vehicle_tonnage', 'actual_weight_charged', 'rate_per_ton', 'final_cost', 'odc_charges', 'tax_bracket', 'return_trip_rate'].includes(col)) {
                d[col] = parseFloat(updates[col]) || 0.0;
              } else if (['return_trip_included', 'reminder_60_sent', 'reminder_30_sent', 'reminder_15_sent'].includes(col)) {
                d[col] = parseInt(updates[col]) || 0;
              } else {
                d[col] = updates[col];
              }
            });

            if (mongoose.connection.readyState === 1) {
              TransportDistribution.findOneAndUpdate({ token: d.token }, d).exec()
                .catch(err => console.error('[MongoDB Error] Transport dist update failed:', err.message));
            }
          }
        });
      }
      return;
    }

    if (sql.includes("UPDATE transport_requests SET status = 'Expired' WHERE id = ?")) {
      const id = args[0];
      const r = this.db.data.transport_requests.find(x => x.id === id);
      if (r) {
        r.status = 'Expired';
        if (mongoose.connection.readyState === 1) {
          TransportRequest.findOneAndUpdate({ id }, { status: 'Expired' }).exec()
            .catch(err => console.error('[MongoDB Error] Request expire update failed:', err.message));
        }
      }
      return;
    }

    console.warn(`[JSON DB] Unsupported SQL query: "${sql}" with args:`, args);
    return [];
  }
}

module.exports = Database;
