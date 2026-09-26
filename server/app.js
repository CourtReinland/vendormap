import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allBooths, areAdjacent, boothById, landmarks } from "./booths.js";
import { checkPassword, hashPassword, newToken, openDatabase, publicUser, tokenHash } from "./db.js";
import { confirmationBodies, rememberEmails } from "./mail.js";
import { ELECTRIC_CENTS, SALES_BANDS, VENDOR_TYPES, money, quote } from "./pricing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOLD_MS = 20 * 60 * 1000;

const HEALTH = {
  "will-obtain": "Will obtain an Orange County permit and send a copy at least 30 days before selling.",
  "have-permit": "Already has a valid health permit and will send a copy.",
  "not-needed": "No health permit required for this booth.",
};
const INSURANCE = {
  "will-provide": "Will send a certificate of insurance.",
  "have-certificate": "Already has a certificate of insurance and will send a copy.",
};

export function createApp(options = {}) {
  const dbPath = options.dbPath || path.join(__dirname, "..", "data", "vendormap.sqlite");
  const db = options.db || openDatabase(dbPath);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "80kb" }));

  app.use((req, res, next) => {
    const token = readCookie(req, "sid");
    if (!token) return next();
    const row = db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?
    `).get(tokenHash(token));
    req.user = publicUser(row);
    next();
  });

  app.get("/api/catalog", (_req, res) => {
    res.json({
      types: VENDOR_TYPES,
      salesBands: SALES_BANDS,
      electricCents: ELECTRIC_CENTS,
      policiesUrl: "https://newcenturyfestivals.com/product/vendor-registration-2026-moon-festival-september-19-20-2026/",
    });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, stripe: Boolean(process.env.STRIPE_SECRET_KEY), smtp: Boolean(process.env.SMTP_HOST) });
  });

  app.get("/api/me", (req, res) => {
    res.json({ user: req.user || null, stripe: Boolean(process.env.STRIPE_SECRET_KEY) });
  });

  app.post("/api/register", (req, res) => {
    const email = cleanEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const name = clip(req.body?.name, 120);
    const phone = clip(req.body?.phone, 40);
    const organization = clip(req.body?.organization, 160);
    if (!email || !email.includes("@")) return res.status(400).json({ error: "Enter a real email address." });
    if (password.length < 8) return res.status(400).json({ error: "Use a password of at least 8 characters." });
    if (!name || !organization) return res.status(400).json({ error: "Name and business name are required." });
    try {
      const result = db.prepare(`
        INSERT INTO users (email, password_hash, name, phone, organization, role, created_at)
        VALUES (?, ?, ?, ?, ?, 'vendor', ?)
      `).run(email, hashPassword(password), name, phone, organization, Date.now());
      const user = publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid));
      login(res, user.id);
      res.json({ user });
    } catch (err) {
      if (String(err.message).includes("UNIQUE")) {
        return res.status(409).json({ error: "That email already has an account. Log in instead." });
      }
      throw err;
    }
  });

  app.post("/api/login", (req, res) => {
    const email = cleanEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!row || !checkPassword(password, row.password_hash)) {
      return res.status(401).json({ error: "Email or password does not match." });
    }
    login(res, row.id);
    res.json({ user: publicUser(row) });
  });

  app.post("/api/logout", (req, res) => {
    const token = readCookie(req, "sid");
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
    res.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    res.json({ ok: true });
  });

  app.get("/api/booths", (req, res) => {
    expirePending();
    const holds = activeHolds();
    const byBooth = new Map(holds.map((hold) => [hold.boothId, hold]));
    res.json({
      booths: allBooths().map((booth) => decorate(booth, byBooth.get(booth.id), req.user)),
      landmarks,
      stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    });
  });

  app.post("/api/bookings", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Log in before you reserve a booth." });
    expirePending();
    const parsed = parseBooking(req.body, req.user);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { booths, priced, fields } = parsed;
    try {
      db.exec("BEGIN IMMEDIATE");
      const taken = boothTaken(booths.map((booth) => booth.id));
      if (taken) {
        db.exec("ROLLBACK");
        return res.status(409).json({ error: `Booth ${taken} was just taken. Pick another square.` });
      }
      const now = Date.now();
      const result = db.prepare(`
        INSERT INTO bookings (
          user_id, status, vendor_type, sales_band, electric, booth_cents, electric_cents, total_cents,
          organization, contact_name, phone, address, website, items, photo_ok, health_note, insurance_note,
          signature, created_at, expires_at
        ) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.user.id,
        fields.vendorType,
        fields.salesBand,
        fields.electric ? 1 : 0,
        priced.boothCents,
        priced.electricCents,
        priced.totalCents,
        fields.organization,
        fields.contactName,
        fields.phone,
        fields.address,
        fields.website,
        fields.items,
        fields.photoOk ? 1 : 0,
        fields.healthNote,
        fields.insuranceNote,
        fields.signature,
        now,
        now + HOLD_MS,
      );
      const link = db.prepare("INSERT INTO booking_booths (booking_id, booth_id) VALUES (?, ?)");
      for (const booth of booths) link.run(result.lastInsertRowid, booth.id);
      db.exec("COMMIT");
      res.json({
        booking: presentBooking(loadBooking(Number(result.lastInsertRowid))),
        stripe: Boolean(process.env.STRIPE_SECRET_KEY),
      });
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch { /* already closed */ }
      throw err;
    }
  });

  app.post("/api/bookings/:id/pay", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Log in again to pay." });
    const booking = loadBooking(Number(req.params.id));
    if (!booking || booking.user_id !== req.user.id) return res.status(404).json({ error: "Booking not found." });
    if (booking.status === "paid") return res.json({ booking: presentBooking(booking), emails: emailsFor(booking.id) });
    if (booking.status !== "pending" || booking.expires_at <= Date.now()) {
      return res.status(409).json({ error: "That hold expired. Choose the booth again." });
    }
    if (process.env.STRIPE_SECRET_KEY && req.body?.method !== "demo") {
      const view = presentBooking(booking);
      const description = `Moon Festival booth ${view.booths.map((booth) => booth.label).join(" & ")}`;
      const session = await stripeCheckout(booking, req, description);
      if (session.error) return res.status(502).json({ error: session.error });
      db.prepare("UPDATE bookings SET stripe_session_id = ? WHERE id = ?").run(session.id, booking.id);
      return res.json({ checkoutUrl: session.url });
    }
    const paid = markPaid(booking.id, "demo", null);
    res.json({ booking: presentBooking(paid.booking), emails: paid.emails });
  });

  app.get("/api/stripe/return", async (req, res) => {
    const sessionId = String(req.query.session_id || "");
    if (!sessionId || !process.env.STRIPE_SECRET_KEY) return res.redirect("/?paid=0");
    const session = await stripeGet(sessionId);
    const bookingId = Number(session?.metadata?.booking_id || session?.client_reference_id);
    if (session?.payment_status === "paid" && bookingId) {
      const existing = loadBooking(bookingId);
      if (existing && existing.status !== "paid") markPaid(bookingId, "stripe", sessionId);
      return res.redirect(`/?booking=${bookingId}&paid=1`);
    }
    res.redirect(`/?booking=${bookingId || ""}&paid=0`);
  });

  app.get("/api/bookings/mine", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Log in to see your booths." });
    expirePending();
    const rows = db.prepare(`
      SELECT * FROM bookings WHERE user_id = ? ORDER BY id DESC
    `).all(req.user.id);
    res.json({ bookings: rows.map((row) => presentBooking(row)) });
  });

  app.get("/api/bookings/:id", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Log in to see this booking." });
    const booking = loadBooking(Number(req.params.id));
    if (!booking) return res.status(404).json({ error: "Booking not found." });
    if (booking.user_id !== req.user.id && req.user.role !== "office") {
      return res.status(404).json({ error: "Booking not found." });
    }
    res.json({ booking: presentBooking(booking), emails: emailsFor(booking.id) });
  });

  app.post("/api/bookings/:id/release", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Log in again." });
    const booking = loadBooking(Number(req.params.id));
    if (!booking || booking.user_id !== req.user.id) return res.status(404).json({ error: "Booking not found." });
    if (booking.status !== "pending") return res.status(409).json({ error: "A paid booth stays reserved. Write the office to cancel." });
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);
    res.json({ ok: true });
  });

  app.get("/api/office/bookings", (req, res) => {
    if (req.user?.role !== "office") return res.status(403).json({ error: "Office login required." });
    expirePending();
    const rows = db.prepare("SELECT * FROM bookings ORDER BY id DESC").all();
    res.json({ bookings: rows.map((row) => presentBooking(row)) });
  });

  app.get("/api/office/outbox", (req, res) => {
    if (req.user?.role !== "office") return res.status(403).json({ error: "Office login required." });
    const rows = db.prepare("SELECT * FROM outbox ORDER BY id DESC LIMIT 100").all();
    res.json({
      messages: rows.map((row) => ({
        id: row.id,
        bookingId: row.booking_id,
        to: row.to_addr,
        subject: row.subject,
        body: row.body,
        createdAt: row.created_at,
        deliveredAt: row.delivered_at,
        error: row.error,
      })),
    });
  });

  app.use(express.static(path.join(__dirname, "..", "public")));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Something broke on the server. Try that again." });
  });

  function login(res, userId) {
    const token = newToken();
    db.prepare("INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)").run(tokenHash(token), userId, Date.now());
    const secure = (process.env.APP_URL || "").startsWith("https://") ? "; Secure" : "";
    res.setHeader("Set-Cookie", `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600${secure}`);
  }

  function expirePending() {
    db.prepare("UPDATE bookings SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?").run(Date.now());
  }

  function activeHolds() {
    return db.prepare(`
      SELECT bb.booth_id AS boothId, b.status AS status, b.user_id AS userId
      FROM booking_booths bb
      JOIN bookings b ON b.id = bb.booking_id
      WHERE b.status = 'paid' OR (b.status = 'pending' AND b.expires_at > ?)
    `).all(Date.now());
  }

  function boothTaken(ids) {
    const holds = activeHolds();
    for (const id of ids) {
      const hit = holds.find((hold) => hold.boothId === id);
      if (hit) return boothById(id)?.label || id;
    }
    return null;
  }

  function loadBooking(id) {
    return db.prepare("SELECT b.*, u.email AS email FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.id = ?").get(id);
  }

  function presentBooking(row) {
    if (!row) return null;
    const links = db.prepare("SELECT booth_id FROM booking_booths WHERE booking_id = ?").all(row.id);
    const booths = links.map((link) => boothById(link.booth_id)).filter(Boolean);
    const priced = quote({
      typeId: row.vendor_type,
      salesBandId: row.sales_band,
      electric: Boolean(row.electric),
    });
    return {
      id: row.id,
      status: row.status === "pending" && row.expires_at <= Date.now() ? "expired" : row.status,
      vendorType: row.vendor_type,
      typeName: priced.type?.name || row.vendor_type,
      size: priced.type?.size || "",
      salesBand: row.sales_band,
      salesLabel: priced.band?.label || null,
      electric: Boolean(row.electric),
      totalCents: row.total_cents,
      total: money(row.total_cents),
      organization: row.organization,
      contactName: row.contact_name,
      email: row.email,
      phone: row.phone,
      address: row.address,
      items: row.items,
      paymentMethod: row.payment_method,
      booths: booths.map((booth) => ({ id: booth.id, label: booth.label, zone: booth.zone })),
      expiresAt: row.expires_at,
      paidAt: row.paid_at,
    };
  }

  function markPaid(bookingId, method, stripeSessionId) {
    const existing = loadBooking(bookingId);
    if (existing.status === "paid") {
      return { booking: existing, emails: emailsFor(bookingId) };
    }
    db.prepare(`
      UPDATE bookings SET status = 'paid', payment_method = ?, stripe_session_id = ?, paid_at = ? WHERE id = ?
    `).run(method, stripeSessionId, Date.now(), bookingId);
    const booking = loadBooking(bookingId);
    const booths = db.prepare("SELECT booth_id FROM booking_booths WHERE booking_id = ?").all(bookingId)
      .map((row) => boothById(row.booth_id))
      .filter(Boolean);
    const priced = quote({
      typeId: booking.vendor_type,
      salesBandId: booking.sales_band,
      electric: Boolean(booking.electric),
    });
    const messages = confirmationBodies({
      ...booking,
      type_name: priced.type?.name || booking.vendor_type,
      size: priced.type?.size || "",
      sales_label: priced.band?.label || null,
      electric: Boolean(booking.electric),
      photo_ok: Boolean(booking.photo_ok),
    }, booths);
    const emails = rememberEmails(db, bookingId, [messages.vendor, messages.office]);
    return { booking, emails };
  }

  function emailsFor(bookingId) {
    return db.prepare("SELECT id, to_addr AS `to`, subject, body, error, delivered_at AS deliveredAt FROM outbox WHERE booking_id = ? ORDER BY id").all(bookingId);
  }

  return app;
}

function decorate(booth, hold, user) {
  let status = "available";
  if (hold?.status === "paid") status = "booked";
  else if (hold?.status === "pending") status = "held";
  return {
    ...booth,
    status,
    mine: Boolean(user && hold && hold.userId === user.id),
  };
}

function parseBooking(body, user) {
  const ids = Array.isArray(body?.boothIds) ? [...new Set(body.boothIds.map(String))] : [];
  const booths = ids.map((id) => boothById(id));
  if (booths.some((booth) => !booth)) return { error: "One of those squares is not on the map." };
  const priced = quote({
    typeId: body?.vendorType,
    salesBandId: body?.salesBand,
    electric: Boolean(body?.electric),
  });
  if (priced.error) return priced;
  if (priced.type.needsPair) {
    if (booths.length !== 2 || !areAdjacent(booths[0], booths[1])) {
      return { error: "A 20×10 booth is two squares that share a side. Pick a square, then add its neighbor." };
    }
  } else if (booths.length !== 1) {
    return { error: "A 10×10 booth is one square." };
  }
  if (priced.type.id === "food" && body?.health !== "will-obtain" && body?.health !== "have-permit") {
    return { error: "Food booths need an Orange County health permit, or a promise to get one 30 days ahead." };
  }
  const health = priced.type.id === "food" ? body.health : "not-needed";
  if (!INSURANCE[body?.insurance]) return { error: "Tell us whether you already have insurance or will send it." };
  if (!body?.holdHarmless) return { error: "Accept the vendor policies and the hold-harmless agreement to reserve." };
  const contactName = clip(body?.contactName || user.name, 120);
  const organization = clip(body?.organization || user.organization, 160);
  const phone = clip(body?.phone || user.phone, 40);
  const address = clip(body?.address, 240);
  const items = clip(body?.items, 1200);
  const signature = clip(body?.signature, 160);
  if (!contactName || !organization || !phone || !address || !items || signature.length < 3) {
    return { error: "Contact name, business, phone, mailing address, what you sell, and a typed signature are required." };
  }
  if (body?.photoOk !== true && body?.photoOk !== false) {
    return { error: "Say whether the festival may photograph the booth." };
  }
  return {
    booths,
    priced,
    fields: {
      vendorType: priced.type.id,
      salesBand: priced.band?.id || null,
      electric: Boolean(body?.electric),
      organization,
      contactName,
      phone,
      address,
      website: clip(body?.website, 200),
      items,
      photoOk: Boolean(body.photoOk),
      healthNote: HEALTH[health],
      insuranceNote: INSURANCE[body.insurance],
      signature,
    },
  };
}

async function stripeCheckout(booking, req, description) {
  const origin = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
  const labels = description;
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", `${origin}/api/stripe/return?session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${origin}/?booking=${booking.id}&paid=0`);
  params.set("customer_email", booking.email);
  params.set("client_reference_id", String(booking.id));
  params.set("metadata[booking_id]", String(booking.id));
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(booking.total_cents));
  params.set("line_items[0][price_data][product_data][name]", `Moon Festival booth ${labels}`);
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const payload = await response.json();
  if (!response.ok) return { error: payload?.error?.message || "Stripe did not open a checkout." };
  return payload;
}

async function stripeGet(sessionId) {
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  if (!response.ok) return null;
  return response.json();
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}
