import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../server/app.js";
import { mapIntegrity } from "../server/booths.js";

test("the drawing has 207 squares, two booth 81s, and no booth 181", () => {
  const report = mapIntegrity();
  assert.equal(report.problems.length, 0, report.problems.join("; "));
  assert.equal(report.count, 207);
});

test("a vendor can book a square, pay, and both emails are written", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vendormap-"));
  const previous = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;
  delete process.env.STRIPE_SECRET_KEY;
  const app = createApp({ dbPath: path.join(dir, "test.sqlite") });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const map = await get(base, "/api/booths");
    assert.equal(map.booths.length, 207);
    const open = map.booths.filter((booth) => booth.status === "available");
    const anchor = open.find((booth) => map.booths.some((other) => adjacent(booth, other) && other.status === "available"));
    const neighbor = map.booths.find((other) => adjacent(anchor, other));

    const account = await post(base, "/api/register", {
      email: "cook@example.com",
      password: "festival-pass",
      name: "Ada Cook",
      phone: "845-555-0199",
      organization: "Ada's Dumplings",
    });
    assert.equal(account.body.user.email, "cook@example.com");

    const booking = await post(base, "/api/bookings", {
      boothIds: [anchor.id, neighbor.id],
      vendorType: "food",
      salesBand: "under-7500",
      electric: true,
      contactName: "Ada Cook",
      organization: "Ada's Dumplings",
      phone: "845-555-0199",
      address: "1 Front Street, Port Jervis, NY 12771",
      items: "Pork dumplings and scallion pancakes",
      photoOk: true,
      health: "will-obtain",
      insurance: "will-provide",
      holdHarmless: true,
      signature: "Ada Cook",
    }, account.cookie);
    assert.equal(booking.status, 200, JSON.stringify(booking.body));
    assert.equal(booking.body.booking.total, "$630");

    const paid = await post(base, `/api/bookings/${booking.body.booking.id}/pay`, { method: "demo" }, account.cookie);
    assert.equal(paid.body.booking.status, "paid");
    assert.equal(paid.body.emails.length, 2);
    assert.equal(paid.body.emails[0].to, "cook@example.com");
    assert.equal(paid.body.emails[1].to, "contact@newcenturyfestivals.com");
    assert.match(paid.body.emails[0].body, /Ada's Dumplings/);
    assert.match(paid.body.emails[1].subject, /Office copy/);

    const other = await post(base, "/api/register", {
      email: "second@example.com",
      password: "festival-pass",
      name: "Second Vendor",
      phone: "845-555-0101",
      organization: "Second Stand",
    });
    const conflict = await post(base, "/api/bookings", {
      boothIds: [anchor.id],
      vendorType: "retail-10",
      electric: false,
      contactName: "Second Vendor",
      organization: "Second Stand",
      phone: "845-555-0101",
      address: "2 Front Street, Port Jervis, NY 12771",
      items: "Prints",
      photoOk: false,
      insurance: "will-provide",
      holdHarmless: true,
      signature: "Second Vendor",
    }, other.cookie);
    assert.equal(conflict.status, 409);

    const retail = open.find((booth) => booth.id !== anchor.id && booth.id !== neighbor.id);
    const small = await post(base, "/api/bookings", {
      boothIds: [retail.id],
      vendorType: "handmade-10",
      electric: false,
      contactName: "Second Vendor",
      organization: "Second Stand",
      phone: "845-555-0101",
      address: "2 Front Street, Port Jervis, NY 12771",
      items: "Hand-printed cards",
      photoOk: true,
      insurance: "have-certificate",
      holdHarmless: true,
      signature: "Second Vendor",
    }, other.cookie);
    assert.equal(small.status, 200, JSON.stringify(small.body));
    assert.equal(small.body.booking.total, "$130");

    const office = await post(base, "/api/login", {
      email: "office@newcenturyfestivals.com",
      password: "moon-demo-office",
    });
    const list = await get(base, "/api/office/bookings", office.cookie);
    assert.ok(list.bookings.some((row) => row.organization === "Ada's Dumplings" && row.status === "paid"));
    const outbox = await get(base, "/api/office/outbox", office.cookie);
    assert.equal(outbox.messages.length, 2);
  } finally {
    server.close();
    if (previous) process.env.SMTP_HOST = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function adjacent(a, b) {
  return a.rowId === b.rowId && Math.abs(a.index - b.index) === 1;
}

async function get(base, url, cookie) {
  const response = await fetch(base + url, { headers: cookie ? { cookie } : {} });
  return response.json();
}

async function post(base, url, body, cookie) {
  const response = await fetch(base + url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie") || "";
  const sid = setCookie.split(";")[0];
  return { status: response.status, body: await response.json(), cookie: sid || cookie };
}
