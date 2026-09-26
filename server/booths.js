// Schematic of the hand-drawn "2026 Moon Festival Booths" map.
// Not a survey. Booth 81 is drawn twice. Booth 181 is not on the sheet.
// Two booths are adjacent only when they share a row and sit next to each other,
// which is what a 20×10 rental needs.

const CELL = 30;
const STEP = 34;

const booths = [];

function range(from, to) {
  const numbers = [];
  const step = from <= to ? 1 : -1;
  for (let n = from; step > 0 ? n <= to : n >= to; n += step) numbers.push(n);
  return numbers;
}

function addBooth(rowId, number, index, x, y, zone, extra = {}) {
  booths.push({
    id: extra.id || `b${number}`,
    number,
    label: extra.label || String(number),
    zone,
    rowId,
    index,
    x,
    y,
    w: CELL,
    h: CELL,
    powerAisle: Boolean(extra.powerAisle),
  });
}

function addRow(rowId, numbers, x, y, zone, extra = {}) {
  numbers.forEach((number, index) => {
    addBooth(rowId, number, index, x + index * STEP, y, zone, {
      powerAisle: extra.powerAisle,
      id: extra.idFor?.(number, index),
      label: extra.labelFor?.(number, index),
    });
  });
}

function addColumn(rowId, numbers, x, y, zone) {
  numbers.forEach((number, index) => {
    addBooth(rowId, number, index, x, y + index * STEP, zone);
  });
}

// End caps sit on the ends of a double aisle, with the power mark between them.
// They are not neighbors of each other.
function addCaps(rowId, leftNumber, rightNumber, leftX, rightX, y, zone) {
  addBooth(rowId, leftNumber, 0, leftX, y, zone, { powerAisle: true });
  addBooth(rowId, rightNumber, 2, rightX, y, zone, { powerAisle: true });
}

addRow("nw-row", [81, 180, 179, 178, 177, 176], 196, 78, "Northwest row", {
  idFor: (number, index) => (index === 0 ? "b81nw" : `b${number}`),
  labelFor: (number, index) => (index === 0 ? "81" : String(number)),
});
addColumn("nw-col", [182, 183, 184, 185], 78, 118, "Northwest column");

addRow("north-a", range(175, 163), 430, 78, "North marketplace");
// 148 and 162 are the end stalls of the 149–161 line, with the power mark in that aisle.
addRow("north-b", [148, ...range(149, 161), 162], 430 - STEP, 78 + STEP, "North marketplace", { powerAisle: true });
addRow("north-c", range(147, 135), 430, 78 + STEP * 2, "North marketplace");

[
  ["upper", 121, 133, 120, 134, 119, 107],
  ["middle", 93, 105, 92, 106, 91, 79],
  ["lower", 65, 77, 64, 78, 63, 51],
].forEach(([name, topFrom, topTo, capLeft, capRight, botFrom, botTo], block) => {
  const y = 248 + block * 170;
  const zone = `Center marketplace, ${name}`;
  const top = range(topFrom, topTo);
  addRow(`c-${name}-a`, top, 430, y, zone);
  addCaps(`c-${name}-b`, capLeft, capRight, 430 - STEP, 430 + top.length * STEP, y + STEP, zone);
  addRow(`c-${name}-c`, range(botFrom, botTo), 430, y + STEP * 2, zone);
});

addRow("east-a", range(9, 1), 980, 196, "East marketplace, upper");
addCaps("east-b", 10, 20, 980 - STEP, 980 + 9 * STEP, 196 + STEP, "East marketplace, upper");
addRow("east-c", range(11, 19), 980, 196 + STEP * 2, "East marketplace, upper");

addRow("east2-a", range(29, 21), 980, 366, "East marketplace, middle");
addCaps("east2-b", 30, 40, 980 - STEP, 980 + 9 * STEP, 366 + STEP, "East marketplace, middle");
addRow("east2-c", range(31, 39), 980, 366 + STEP * 2, "East marketplace, middle");

addRow("east3-a", [...range(47, 41), 48], 1048, 536, "East marketplace, lower");
addRow("east3-b", [50, 49], 1048 + 6 * STEP, 536 + STEP, "East marketplace, lower");

addRow("front", range(196, 205), 396, 748, "Front row");
addBooth("front-206", 206, 0, 396 + 10 * STEP + 22, 748, "Front row");
addBooth("front-207", 207, 0, 396 + 12 * STEP + 8, 748, "Front row", { powerAisle: true });

addColumn("stage-col", [186, 187, 188, 189], 78, 560, "Stage-side column");
addRow("stage-row", range(190, 195), 78, 706, "Stage-side row");

export const landmarks = [
  { kind: "stage", x: 36, y: 330, w: 130, h: 180, label: "Stage" },
  { kind: "tent", x: 196, y: 292, w: 190, h: 200, label: "Audience tent 40×80" },
  { kind: "play", x: 1090, y: 28, w: 280, h: 140, label: "Children’s playground" },
  { kind: "horse", x: 1260, y: 470, w: 140, h: 160, label: "Horse ride" },
  { kind: "building", x: 24, y: 824, w: 1380, h: 90, label: "" },
  { kind: "note", x: 360, y: 868, label: "Restrooms" },
  { kind: "note", x: 760, y: 868, label: "VIP room" },
  { kind: "note", x: 1140, y: 868, label: "Restrooms" },
  { kind: "roundabout", x: 78, y: 790 },
  { kind: "power", x: 430 + 6 * STEP, y: 78 + STEP + 2 },
  { kind: "power", x: 430 + 6 * STEP, y: 248 + STEP + 2 },
  { kind: "power", x: 430 + 6 * STEP, y: 418 + STEP + 2 },
  { kind: "power", x: 430 + 6 * STEP, y: 588 + STEP + 2 },
  { kind: "power", x: 980 + 4 * STEP, y: 196 + STEP + 2 },
  { kind: "power", x: 980 + 4 * STEP, y: 366 + STEP + 2 },
  { kind: "power", x: 396 + 12 * STEP + 8, y: 748 - 28 },
];

export function allBooths() {
  return booths.map((booth) => ({ ...booth }));
}

export function boothById(id) {
  return booths.find((booth) => booth.id === id) || null;
}

export function areAdjacent(a, b) {
  if (!a || !b || a.id === b.id) return false;
  return a.rowId === b.rowId && Math.abs(a.index - b.index) === 1;
}

export function mapIntegrity() {
  const ids = new Set();
  const problems = [];
  for (const booth of booths) {
    if (ids.has(booth.id)) problems.push(`duplicate id ${booth.id}`);
    ids.add(booth.id);
  }
  for (let i = 0; i < booths.length; i += 1) {
    for (let j = i + 1; j < booths.length; j += 1) {
      const a = booths[i];
      const b = booths[j];
      const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      if (overlap) problems.push(`overlap ${a.label} (${a.id}) and ${b.label} (${b.id})`);
    }
  }
  if (booths.some((booth) => booth.number === 181)) problems.push("181 should not be on the map");
  if (booths.filter((booth) => booth.number === 81).length !== 2) problems.push("81 should be drawn twice");
  if (areAdjacent(boothById("b148"), boothById("b162"))) problems.push("148 and 162 are opposite ends");
  if (areAdjacent(boothById("b10"), boothById("b20"))) problems.push("10 and 20 are opposite ends");
  if (areAdjacent(boothById("b120"), boothById("b134"))) problems.push("120 and 134 are opposite ends");
  if (!areAdjacent(boothById("b148"), boothById("b149"))) problems.push("148 should pair with 149");
  if (!areAdjacent(boothById("b149"), boothById("b150"))) problems.push("149 and 150 should be a pair");
  if (!areAdjacent(boothById("b121"), boothById("b122"))) problems.push("121 and 122 should be a pair");
  return { count: booths.length, problems };
}
