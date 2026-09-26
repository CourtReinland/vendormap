const NS = "http://www.w3.org/2000/svg";
const state = {
  user: null,
  stripe: false,
  booths: [],
  landmarks: [],
  catalog: null,
  selected: [],
  typeId: "retail-10",
  salesBand: "under-7500",
  electric: false,
  draft: {},
  onlyOpen: false,
  scale: 1,
  mode: "book",
  message: "",
  error: "",
  emails: [],
  booking: null,
  officeBookings: [],
  outbox: [],
};

const panel = document.querySelector("#panel");
const who = document.querySelector("#who");
const map = document.querySelector("#map");

document.querySelector("#zoom-in").onclick = () => setScale(state.scale + 0.2);
document.querySelector("#zoom-out").onclick = () => setScale(state.scale - 0.2);
document.querySelector("#only-open").onchange = (event) => {
  state.onlyOpen = event.target.checked;
  drawMap();
};
document.querySelector("#find").addEventListener("input", (event) => {
  const query = event.target.value.trim();
  if (!query) return;
  const hits = state.booths.filter((booth) => booth.label === query || String(booth.number) === query);
  if (hits.length === 1) focusBooth(hits[0]);
});

init();

async function init() {
  const [me, catalog] = await Promise.all([api("/api/me"), api("/api/catalog")]);
  state.user = me.user;
  state.stripe = me.stripe;
  state.catalog = catalog;
  await reloadMap();
  const params = new URLSearchParams(location.search);
  if (params.get("booking")) {
    const data = await api(`/api/bookings/${params.get("booking")}`);
    if (!data.error) {
      state.booking = data.booking;
      state.emails = data.emails || [];
      state.mode = data.booking.status === "paid" ? "done" : "pay";
      state.message = params.get("paid") === "1" ? "Payment recorded." : "";
      state.error = params.get("paid") === "0" ? "Payment was not completed. The booth is still on hold." : "";
    }
  }
  render();
}

async function reloadMap() {
  const data = await api("/api/booths");
  state.booths = data.booths;
  state.landmarks = data.landmarks;
  state.stripe = data.stripe;
  drawMap();
  render();
}

function setScale(next) {
  state.scale = Math.min(2.2, Math.max(0.7, next));
  map.style.width = `${1440 * state.scale}px`;
}

function drawMap() {
  map.replaceChildren();
  for (const mark of state.landmarks) drawLandmark(mark);
  for (const booth of state.booths) {
    if (state.onlyOpen && booth.status !== "available" && !state.selected.includes(booth.id)) continue;
    const group = svg("g", { class: "booth", tabindex: "0", role: "button" });
    const fill = fillFor(booth);
    group.append(
      svg("rect", {
        x: booth.x, y: booth.y, width: booth.w, height: booth.h, rx: 3,
        fill, stroke: state.selected.includes(booth.id) ? "#1c1915" : "#1c1915",
        "stroke-width": state.selected.includes(booth.id) ? 2.5 : 0.6,
      }),
      svg("text", {
        x: booth.x + booth.w / 2,
        y: booth.y + booth.h / 2 + 3,
        "text-anchor": "middle",
        fill: state.selected.includes(booth.id) || (booth.status === "booked" && !booth.mine) ? "#fffdf8" : "#1c1915",
      }, booth.label),
    );
    group.addEventListener("click", () => onBooth(booth));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") onBooth(booth);
    });
    const title = svg("title", {}, `Booth ${booth.label}, ${booth.zone}. ${statusLabel(booth)}`);
    group.append(title);
    map.append(group);
  }
}

function drawLandmark(mark) {
  if (mark.kind === "power") {
    map.append(svg("text", { class: "mark", x: mark.x, y: mark.y + 14 }, "⚡"));
    return;
  }
  if (mark.kind === "note") {
    map.append(svg("text", { class: "mark", x: mark.x, y: mark.y }, mark.label));
    return;
  }
  if (mark.kind === "roundabout") {
    map.append(svg("circle", { cx: mark.x, cy: mark.y, r: 28, class: "landmark" }));
    return;
  }
  const rect = svg("rect", { x: mark.x, y: mark.y, width: mark.w, height: mark.h, rx: 6, class: "landmark" });
  map.append(rect);
  if (mark.label) {
    map.append(svg("text", { class: "mark", x: mark.x + 8, y: mark.y + 18 }, mark.label));
  }
}

function fillFor(booth) {
  if (state.selected.includes(booth.id)) return "#1e4a38";
  if (booth.mine && booth.status === "booked") return "#c4a15a";
  if (booth.status === "booked") return "#8c3d2f";
  if (booth.status === "held") return "#e7c39a";
  if (booth.powerAisle) return "#f4e7c4";
  return "#d7eadc";
}

function statusLabel(booth) {
  if (booth.mine && booth.status !== "available") return "Your booth";
  if (booth.status === "booked") return "Taken";
  if (booth.status === "held") return "On hold";
  return booth.powerAisle ? "Open, power symbol in this aisle" : "Open";
}

function onBooth(booth) {
  state.error = "";
  state.message = "";
  state.booking = null;
  state.emails = [];
  const type = currentType();
  if (!type?.needsPair) {
    state.selected = [booth.id];
  } else if (state.selected.length === 1 && neighborIds(state.selected[0]).includes(booth.id)) {
    state.selected = [state.selected[0], booth.id];
  } else if (state.selected.includes(booth.id) && state.selected.length === 1) {
    state.selected = [];
  } else {
    state.selected = [booth.id];
  }
  state.mode = "book";
  drawMap();
  render();
  focusBooth(booth);
}

function focusBooth(booth) {
  const frame = document.querySelector("#map-frame");
  frame.scrollTo({ left: Math.max(0, booth.x * state.scale - 40), top: Math.max(0, booth.y * state.scale - 40), behavior: "smooth" });
}

function neighborIds(id) {
  const booth = state.booths.find((item) => item.id === id);
  if (!booth) return [];
  return state.booths
    .filter((item) => item.rowId === booth.rowId && Math.abs(item.index - booth.index) === 1)
    .map((item) => item.id);
}

function currentType() {
  return state.catalog?.types.find((type) => type.id === state.typeId) || null;
}

function render() {
  who.replaceChildren();
  if (state.user) {
    who.append(text(state.user.organization || state.user.name));
    if (state.user.role === "office") {
      const office = button("Office", () => { state.mode = "office"; loadOffice(); });
      office.className = "ghost";
      who.append(office);
    }
    const mine = button("My booths", () => { state.mode = "mine"; render(); });
    mine.className = "ghost";
    const out = button("Log out", logout);
    out.className = "ghost";
    who.append(mine, out);
  } else {
    const enter = button("Log in", () => { state.mode = "login"; render(); });
    who.append(enter);
  }
  panel.replaceChildren();
  if (state.mode === "login") return renderLogin();
  if (state.mode === "register") return renderRegister();
  if (state.mode === "done") return renderDone();
  if (state.mode === "pay") return renderPay();
  if (state.mode === "mine") return renderMine();
  if (state.mode === "office") return renderOffice();
  renderBook();
}

function renderBook() {
  const type = currentType();
  panel.append(h2(state.selected.length ? `Booth ${labels(state.selected)}` : "Pick a square"));
  if (!state.selected.length) {
    panel.append(p("Click an open square. A 10×10 booth is one square. Food and 20×10 booths are two squares that share a side."));
    panel.append(p("Booth 81 is drawn twice on the paper map, once in the northwest row and once in the center. The zone name tells them apart. There is no booth 181."));
    return;
  }
  const chosen = state.selected.map(byId);
  panel.append(p(chosen.map((booth) => `${booth.label} · ${booth.zone}`).join(" and ") + ". " + statusLabel(chosen[0])));
  if (chosen.some((booth) => booth.status === "booked" && !booth.mine)) {
    panel.append(note("That square is already booked.", true));
    return;
  }
  if (!state.user) {
    panel.append(p("Log in to reserve it. The square stays open until you do."));
    panel.append(button("Log in", () => { state.mode = "login"; render(); }));
    return;
  }
  const form = document.createElement("form");
  form.className = "stack";
  form.append(field("Vendor type", select(state.catalog.types.map((item) => ({
    value: item.id,
    label: `${item.name} · ${item.size}${item.cents ? ` · ${dollars(item.cents)}` : ""}`,
  })), state.typeId, (value) => {
    state.typeId = value;
    if (!currentType().needsPair && state.selected.length > 1) state.selected = [state.selected[0]];
    drawMap();
    render();
  }, "vendorType")));
  panel.append(form);
  const live = currentType();
  form.append(p(live.blurb));
  if (live.needsPair && state.selected.length < 2) {
    const neighbors = neighborIds(state.selected[0]).map(byId).filter((booth) => booth.status === "available" || booth.mine);
    form.append(p("Add the neighboring square for this 20×10 space."));
    if (!neighbors.length) form.append(note("No open neighbor. Pick a different square.", true));
    for (const neighbor of neighbors) {
      form.append(button(`Add booth ${neighbor.label}`, () => onBooth(neighbor)));
    }
    return;
  }
  if (live.id === "food") {
    form.append(field("Expected sales", select(state.catalog.salesBands.map((band) => ({
      value: band.id,
      label: `${band.label} · ${dollars(band.cents)}`,
    })), state.salesBand, (value) => { state.salesBand = value; render(); }, "salesBand")));
    form.append(p("Food fee follows the festival’s published table. If sales finish in a higher band, the office can invoice the difference."));
  }
  const electric = document.createElement("label");
  electric.className = "check";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = state.electric;
  box.onchange = () => { state.electric = box.checked; render(); };
  electric.append(box, document.createTextNode(" 20-amp outlet, $30. Bring your own cord. Power is limited."));
  form.append(electric);
  if (chosen.some((booth) => booth.powerAisle)) {
    form.append(p("A power symbol is drawn in this aisle. It is not a promise that this square gets the outlet."));
  }
  form.append(field("Contact name", input("text", state.draft.contact || state.user.name, "contact")));
  form.append(field("Business", input("text", state.draft.org || state.user.organization, "org")));
  form.append(field("Phone", input("tel", state.draft.phone || state.user.phone, "phone")));
  form.append(field("Mailing address", input("text", state.draft.address || "", "address")));
  form.append(field("Website, if you have one", input("text", state.draft.website || "", "website")));
  form.append(field("What you will sell", area("items", state.draft.items || "")));
  form.addEventListener("input", () => rememberDraft(form));
  form.append(field("May we photograph the booth?", select([
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ], "yes", () => {}, "photo")));
  if (live.id === "food") {
    form.append(field("Health permit", select([
      { value: "will-obtain", label: "I will get the Orange County permit 30 days ahead" },
      { value: "have-permit", label: "I already have a permit and will send a copy" },
    ], "will-obtain", () => {}, "health")));
  }
  form.append(field("Insurance", select([
    { value: "will-provide", label: "I will send a certificate of insurance" },
    { value: "have-certificate", label: "I already have one and will send a copy" },
  ], "will-provide", () => {}, "insurance")));
  const harm = document.createElement("label");
  harm.className = "check";
  const harmBox = document.createElement("input");
  harmBox.type = "checkbox";
  harmBox.id = "harm";
  harm.append(harmBox, document.createTextNode(" I accept the vendor policies and the hold-harmless agreement."));
  form.append(harm);
  const policy = document.createElement("a");
  policy.href = state.catalog.policiesUrl;
  policy.target = "_blank";
  policy.rel = "noreferrer";
  policy.textContent = "Read the published policies";
  form.append(policy);
  form.append(field("Type your full name as a signature", input("text", state.draft.signature || "", "signature")));
  form.append(el("div", "price", dollars(totalCents())));
  if (state.error) form.append(note(state.error, true));
  const submit = button("Reserve and pay", null, "submit");
  form.append(submit);
  form.onsubmit = async (event) => {
    event.preventDefault();
    state.error = "";
    const payload = {
      boothIds: state.selected,
      vendorType: state.typeId,
      salesBand: state.salesBand,
      electric: state.electric,
      contactName: value(form, "contact"),
      organization: value(form, "org"),
      phone: value(form, "phone"),
      address: value(form, "address"),
      website: value(form, "website"),
      items: value(form, "items"),
      photoOk: value(form, "photo") === "yes",
      health: live.id === "food" ? value(form, "health") : "not-needed",
      insurance: value(form, "insurance"),
      holdHarmless: harmBox.checked,
      signature: value(form, "signature"),
    };
    const data = await api("/api/bookings", { method: "POST", body: payload });
    if (data.error) {
      state.error = data.error;
      render();
      return;
    }
    state.booking = data.booking;
    state.stripe = data.stripe;
    state.mode = "pay";
    await reloadMap();
    state.mode = "pay";
    render();
  };
}

function renderPay() {
  const booking = state.booking;
  panel.append(h2(`Pay for booth ${booking.booths.map((booth) => booth.label).join(" & ")}`));
  panel.append(p(`${booking.typeName}, ${booking.size}. ${booking.salesLabel || ""}`));
  panel.append(el("div", "price", booking.total));
  panel.append(p(state.stripe
    ? "Card checkout is on. You will go to Stripe and come back here."
    : "Demo checkout: the button records the booking and writes both emails. No card is charged. Add a Stripe key before this goes on the live site."));
  if (state.error) panel.append(note(state.error, true));
  const pay = button(state.stripe ? `Pay ${booking.total}` : `Confirm ${booking.total}`, async () => {
    const data = await api(`/api/bookings/${booking.id}/pay`, { method: "POST", body: { method: state.stripe ? "stripe" : "demo" } });
    if (data.checkoutUrl) {
      location.href = data.checkoutUrl;
      return;
    }
    if (data.error) { state.error = data.error; render(); return; }
    state.booking = data.booking;
    state.emails = data.emails || [];
    state.mode = "done";
    state.selected = [];
    await reloadMap();
    state.mode = "done";
    render();
  });
  const release = button("Release the hold", async () => {
    await api(`/api/bookings/${booking.id}/release`, { method: "POST", body: {} });
    state.mode = "book";
    state.selected = [];
    await reloadMap();
  });
  release.className = "ghost";
  panel.append(pay, document.createElement("br"), release);
}

function renderDone() {
  const booking = state.booking;
  panel.append(h2("You’re booked"));
  panel.append(note(`Booth ${booking.booths.map((booth) => booth.label).join(" & ")} is reserved for ${booking.organization}.`));
  panel.append(p(`${booking.total} · ${booking.paymentMethod === "stripe" ? "card" : "demo record, no card charged"}`));
  panel.append(p("Two emails were written: one to you, and one to contact@newcenturyfestivals.com. With no mail server configured, they stay in this outbox instead of being delivered."));
  for (const message of state.emails) {
    panel.append(el("h3", "", message.to));
    panel.append(el("div", "mail", message.body));
  }
  const again = button("Book another square", () => { state.mode = "book"; state.booking = null; render(); });
  again.className = "ghost";
  panel.append(again);
}

function renderLogin() {
  panel.append(h2("Vendor login"));
  const form = document.createElement("form");
  form.className = "stack";
  form.append(field("Email", input("email", "", "email")));
  form.append(field("Password", input("password", "", "password")));
  if (state.error) form.append(note(state.error, true));
  form.append(button("Log in", null, "submit"));
  form.onsubmit = async (event) => {
    event.preventDefault();
    const data = await api("/api/login", { method: "POST", body: { email: value(form, "email"), password: value(form, "password") } });
    if (data.error) { state.error = data.error; render(); return; }
    state.user = data.user;
    state.error = "";
    state.mode = "book";
    render();
  };
  panel.append(form);
  const reg = button("Create an account", () => { state.mode = "register"; state.error = ""; render(); });
  reg.className = "ghost";
  panel.append(reg);
  panel.append(p("Demo vendor: vendor@example.com / vendormap-demo. Office: office@newcenturyfestivals.com / moon-demo-office."));
}

function renderRegister() {
  panel.append(h2("Create a vendor account"));
  const form = document.createElement("form");
  form.className = "stack";
  form.append(field("Your name", input("text", "", "name")));
  form.append(field("Business", input("text", "", "organization")));
  form.append(field("Phone", input("tel", "", "phone")));
  form.append(field("Email", input("email", "", "email")));
  form.append(field("Password", input("password", "", "password")));
  if (state.error) form.append(note(state.error, true));
  form.append(button("Create account", null, "submit"));
  form.onsubmit = async (event) => {
    event.preventDefault();
    const data = await api("/api/register", {
      method: "POST",
      body: {
        name: value(form, "name"),
        organization: value(form, "organization"),
        phone: value(form, "phone"),
        email: value(form, "email"),
        password: value(form, "password"),
      },
    });
    if (data.error) { state.error = data.error; render(); return; }
    state.user = data.user;
    state.mode = "book";
    state.error = "";
    render();
  };
  panel.append(form);
}

async function renderMine() {
  panel.append(h2("Your booths"));
  const data = await api("/api/bookings/mine");
  if (data.error) { panel.append(note(data.error, true)); return; }
  if (!data.bookings.length) panel.append(p("No booths yet."));
  for (const booking of data.bookings) {
    const line = document.createElement("p");
    line.textContent = `#${booking.id} · ${booking.booths.map((booth) => booth.label).join(" & ")} · ${booking.status} · ${booking.total}`;
    panel.append(line);
  }
}

async function loadOffice() {
  const [bookings, outbox] = await Promise.all([api("/api/office/bookings"), api("/api/office/outbox")]);
  state.officeBookings = bookings.bookings || [];
  state.outbox = outbox.messages || [];
  state.error = bookings.error || outbox.error || "";
  render();
}

function renderOffice() {
  panel.append(h2("Office"));
  if (state.error) panel.append(note(state.error, true));
  panel.append(el("h3", "", "Bookings"));
  const table = document.createElement("table");
  table.innerHTML = "<tr><th>#</th><th>Booth</th><th>Who</th><th>Status</th><th>Fee</th></tr>";
  for (const booking of state.officeBookings) {
    const row = document.createElement("tr");
    for (const value of [
      booking.id,
      booking.booths.map((booth) => booth.label).join(", "),
      `${booking.organization} <${booking.email}>`,
      booking.status,
      booking.total,
    ]) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.append(cell);
    }
    table.append(row);
  }
  panel.append(table);
  panel.append(el("h3", "", "Email outbox"));
  for (const message of state.outbox) {
    panel.append(el("p", "", `${message.error || "sent"} → ${message.to}`));
    panel.append(el("div", "mail", message.body));
  }
}

function totalCents() {
  const type = currentType();
  if (!type) return 0;
  const base = type.id === "food"
    ? state.catalog.salesBands.find((band) => band.id === state.salesBand).cents
    : type.cents;
  return base + (state.electric ? state.catalog.electricCents : 0);
}

function dollars(cents) {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

function labels(ids) {
  return ids.map((id) => byId(id)?.label || id).join(" & ");
}

function byId(id) {
  return state.booths.find((booth) => booth.id === id);
}

function h2(value) { return el("h2", "", value); }
function p(value) { return el("p", "muted", value); }
function note(value, bad) { return el("div", bad ? "error" : "ok", value); }

function el(tag, className, textValue) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textValue != null) node.textContent = textValue;
  return node;
}

function text(value) {
  return document.createTextNode(value);
}

function button(label, onClick, type = "button") {
  const node = document.createElement("button");
  node.type = type;
  node.textContent = label;
  if (onClick) node.onclick = onClick;
  return node;
}

function field(label, control) {
  const wrap = document.createElement("label");
  wrap.className = "stack";
  wrap.append(document.createTextNode(label), control);
  return wrap;
}

function input(type, valueText, name) {
  const node = document.createElement("input");
  node.type = type;
  node.value = valueText || "";
  node.name = name;
  node.required = type !== "text" || name !== "website";
  if (name === "website") node.required = false;
  return node;
}

function area(name, valueText) {
  const node = document.createElement("textarea");
  node.name = name;
  node.required = true;
  node.value = valueText || "";
  return node;
}

function rememberDraft(form) {
  for (const name of ["contact", "org", "phone", "address", "website", "items", "signature"]) {
    if (form.elements[name]) state.draft[name] = form.elements[name].value;
  }
}

function select(options, current, onChange, name) {
  const node = document.createElement("select");
  node.name = name || "";
  for (const option of options) {
    const item = document.createElement("option");
    item.value = option.value;
    item.textContent = option.label;
    if (option.value === current) item.selected = true;
    node.append(item);
  }
  node.onchange = () => onChange(node.value);
  return node;
}

function value(form, name) {
  return form.elements[name]?.value?.trim() || "";
}

async function logout() {
  await api("/api/logout", { method: "POST", body: {} });
  state.user = null;
  state.mode = "book";
  render();
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return response.json();
}

function svg(name, attrs, textValue) {
  const node = document.createElementNS(NS, name);
  for (const [key, attr] of Object.entries(attrs || {})) node.setAttribute(key, attr);
  if (textValue != null) node.textContent = textValue;
  return node;
}
