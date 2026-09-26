# Moon Festival vendor map

A demo of booth booking for the 2026 Moon Festival at New Century, 517 Neversink Drive, Port Jervis. A vendor logs in, picks a square on the map traced from the hand-drawn booth sheet, chooses a vendor type, pays the published fee, and gets a confirmation. The same confirmation is addressed to contact@newcenturyfestivals.com.

This is the demo. It is not on newcenturyfestivals.com yet.

## Run it

```bash
npm install
npm start
```

Open http://localhost:8787

Demo vendor: `vendor@example.com` / `vendormap-demo`

Office view: `office@newcenturyfestivals.com` / `moon-demo-office`

`npm test` checks the map and a full booking.

## What a vendor does

1. Create an account or log in.
2. Click an open square. Food and other 20×10 booths need two squares that share a side.
3. Choose the vendor type. Fees match the 2026 Moon Festival registration page:
   - Food, from the published sales table: $600, $850, $1,100, or $1,350
   - Retail or service: $420 for 20×10, $260 for 10×10
   - Nonprofit or handcrafted: $230 for 20×10, $130 for 10×10
   - Electricity is $30 extra. The vendor brings the cord.
4. Accept the published vendor policies and type a name.
5. Pay.

Booth 81 is on the drawing twice. Booth 181 is not on it. The blank squares and flower marks are not for sale.

## Payment and email

With no Stripe key, **Confirm** records the booking and writes both emails into the office outbox. No card is charged. That is so the demo can be clicked through.

To charge cards, set `STRIPE_SECRET_KEY` (a test key until go-live) and `APP_URL`. Checkout then runs through Stripe, and the return marks the booth paid.

To actually deliver mail, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM`. Each booking sends one message to the vendor and one to `MAIL_TO_OFFICE` (default `contact@newcenturyfestivals.com`). Until SMTP is set, nothing leaves the machine.

Copy `.env.example` to `.env`.

## Before the live site

- Replace the demo office password.
- Use a live Stripe key only when New Century Film should receive the money.
- Point SMTP at a mailbox allowed to send as the from-address.
- The clickable map is a schematic of the paper drawing, not a measured survey. If a number on the sheet was misread, it is one entry in `server/booths.js`.
