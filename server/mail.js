import nodemailer from "nodemailer";
import { money } from "./pricing.js";

export function officeAddress() {
  return process.env.MAIL_TO_OFFICE || "contact@newcenturyfestivals.com";
}

export function fromAddress() {
  return process.env.MAIL_FROM || "New Century Festivals <bookings@newcenturyfestivals.com>";
}

function boothLine(booths) {
  return booths.map((booth) => `${booth.label} (${booth.zone})`).join("; ");
}

export function confirmationBodies(booking, booths) {
  const payLine = booking.payment_method === "stripe"
    ? `Paid by card: ${money(booking.total_cents)}.`
    : `Recorded in the demo: ${money(booking.total_cents)}. No card was charged. Before this goes on the live site, Stripe collects the same amount payable to New Century Film.`;
  const shared = [
    "2026 Moon Festival — booth confirmation",
    "",
    "Saturday, September 19, 2026, 11am–9pm",
    "Sunday, September 20, 2026, 11am–6pm",
    "New Century, 517 Neversink Drive, Port Jervis, NY 12771",
    "",
    `Booth${booths.length > 1 ? "s" : ""}: ${boothLine(booths)}`,
    `Vendor type: ${booking.type_name} (${booking.size})`,
    booking.sales_label ? `Expected sales: ${booking.sales_label}` : null,
    booking.electric
      ? "Electricity: yes. One 20-amp outlet, $30. Bring your own extension cord. Outlets are limited."
      : "Electricity: no.",
    payLine,
    "",
    `Contact: ${booking.contact_name}, ${booking.organization}`,
    `Email: ${booking.email}`,
    `Phone: ${booking.phone}`,
    `Mailing address: ${booking.address}`,
    booking.website ? `Website: ${booking.website}` : null,
    "",
    "What you plan to sell:",
    booking.items,
    "",
    `Photographs of the booth for festival publicity: ${booking.photo_ok ? "yes" : "no"}.`,
    `Health permit: ${booking.health_note}`,
    `Insurance: ${booking.insurance_note}`,
    `Signed: ${booking.signature}`,
    "",
    "Still required before you sell:",
    "- Food vendors file an Orange County temporary food permit at least 30 days ahead, and carry a $1,000,000 liability policy naming New Century Film and the Town of Deerpark as additional insured.",
    "- Other vendors send a certificate of insurance.",
    "- Vendors selling taxable goods send a tax ID.",
    "- A check, if you pay that way, is payable to New Century Film and mailed to 517 Neversink Drive.",
    "",
    "The vendor policies and hold-harmless terms on newcenturyfestivals.com apply.",
    "Questions: contact@newcenturyfestivals.com or (845) 236-5535.",
  ].filter((line) => line !== null);

  const subject = `Moon Festival booth ${booths.map((booth) => booth.label).join(" & ")} — ${booking.organization}`;
  return {
    vendor: {
      to: booking.email,
      subject,
      body: [...shared, "", `A copy of this confirmation was addressed to ${officeAddress()}.`].join("\n"),
    },
    office: {
      to: officeAddress(),
      subject: `Office copy: ${subject}`,
      body: ["Office copy — new Moon Festival booth booking", "", ...shared, "", `Booking #${booking.id}.`].join("\n"),
    },
  };
}

export function rememberEmails(db, bookingId, messages) {
  const insert = db.prepare(`
    INSERT INTO outbox (booking_id, to_addr, subject, body, created_at, delivered_at, error)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
  `);
  const saved = messages.map((message) => {
    const pending = Boolean(process.env.SMTP_HOST);
    const result = insert.run(
      bookingId,
      message.to,
      message.subject,
      message.body,
      Date.now(),
      pending ? "sending" : "demo-outbox",
    );
    return { id: Number(result.lastInsertRowid), ...message };
  });
  if (process.env.SMTP_HOST) {
    deliver(db, saved).catch((err) => console.error(err));
  }
  return saved;
}

async function deliver(db, saved) {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" }
      : undefined,
  });
  for (const message of saved) {
    try {
      await transport.sendMail({
        from: fromAddress(),
        to: message.to,
        subject: message.subject,
        text: message.body,
      });
      db.prepare("UPDATE outbox SET delivered_at = ?, error = NULL WHERE id = ?").run(Date.now(), message.id);
    } catch (err) {
      db.prepare("UPDATE outbox SET error = ? WHERE id = ?").run(String(err.message || err), message.id);
    }
  }
}
