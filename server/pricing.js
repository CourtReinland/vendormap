// Fees published on the 2026 Moon Festival vendor registration page.
// Food is charged from the published sales table. The prose on that page
// also says "$600 base + $250 per extra $2,500 after $5,000, cap $1,350".
// The table below is what the booth fee is calculated from.

export const ELECTRIC_CENTS = 3000;

export const SALES_BANDS = [
  { id: "under-7500", label: "Expected sales $0 – $7,499", cents: 60000 },
  { id: "7500", label: "Expected sales $7,500 – $9,999", cents: 85000 },
  { id: "10000", label: "Expected sales $10,000 – $12,499", cents: 110000 },
  { id: "12500", label: "Expected sales $12,500 or more", cents: 135000 },
];

export const VENDOR_TYPES = [
  {
    id: "food",
    name: "Food",
    size: "20×10 ft",
    needsPair: true,
    blurb: "Cooked food. Orange County health permit required at least 30 days before the festival. $1,000,000 liability policy naming New Century Film and the Town of Deerpark.",
  },
  {
    id: "retail-20",
    name: "Retail, prepackaged, or service",
    size: "20×10 ft",
    needsPair: true,
    cents: 42000,
    blurb: "No food or drinks except New York State certified prepackaged food.",
  },
  {
    id: "retail-10",
    name: "Retail, prepackaged, or service",
    size: "10×10 ft",
    needsPair: false,
    cents: 26000,
    blurb: "One square on the map. No food or drinks except certified prepackaged food.",
  },
  {
    id: "handmade-20",
    name: "Nonprofit or handcrafted",
    size: "20×10 ft",
    needsPair: true,
    cents: 23000,
    blurb: "Nonprofit organization, or merchandise made by the vendor.",
  },
  {
    id: "handmade-10",
    name: "Nonprofit or handcrafted",
    size: "10×10 ft",
    needsPair: false,
    cents: 13000,
    blurb: "One square on the map. Nonprofit, or goods made by the vendor.",
  },
];

export function vendorType(id) {
  return VENDOR_TYPES.find((type) => type.id === id) || null;
}

export function salesBand(id) {
  return SALES_BANDS.find((band) => band.id === id) || null;
}

export function quote({ typeId, salesBandId, electric }) {
  const type = vendorType(typeId);
  if (!type) return { error: "Choose a vendor type." };
  let boothCents;
  let band = null;
  if (type.id === "food") {
    band = salesBand(salesBandId);
    if (!band) return { error: "Food vendors choose an expected sales band. The fee follows the festival’s published table." };
    boothCents = band.cents;
  } else {
    boothCents = type.cents;
  }
  const electricCents = electric ? ELECTRIC_CENTS : 0;
  return {
    type,
    band,
    boothCents,
    electricCents,
    totalCents: boothCents + electricCents,
  };
}

export function money(cents) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
