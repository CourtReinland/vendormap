import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'vendor',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  vendor_type TEXT NOT NULL,
  sales_band TEXT,
  electric INTEGER NOT NULL DEFAULT 0,
  booth_cents INTEGER NOT NULL,
  electric_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  organization TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL,
  photo_ok INTEGER NOT NULL,
  health_note TEXT NOT NULL,
  insurance_note TEXT NOT NULL,
  signature TEXT NOT NULL,
  payment_method TEXT,
  stripe_session_id TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS booking_booths (
  booking_id INTEGER NOT NULL,
  booth_id TEXT NOT NULL,
  PRIMARY KEY (booking_id, booth_id)
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  error TEXT
);
`;

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newToken() {
  return randomBytes(32).toString("hex");
}

export function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  seed(db);
  return db;
}

function seed(db) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count > 0) return;
  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO users (email, password_hash, name, phone, organization, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    (process.env.OFFICE_EMAIL || "office@newcenturyfestivals.com").toLowerCase(),
    hashPassword(process.env.OFFICE_PASSWORD || "moon-demo-office"),
    "Festival office",
    "845-236-5535",
    "New Century Festivals",
    "office",
    now,
  );
  insert.run(
    "vendor@example.com",
    hashPassword("vendormap-demo"),
    "Demo Vendor",
    "845-555-0100",
    "Sample Crafts",
    "vendor",
    now,
  );
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    organization: row.organization,
    role: row.role,
  };
}
