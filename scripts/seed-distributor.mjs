#!/usr/bin/env node
/**
 * Development seed: a $25M-ARR window and door distributor with Ply Gem as its primary
 * vendor.
 *
 * The dataset is generated demand-first and then supplied, so every derived number the app
 * shows is internally consistent: receipts always precede the shipments they cover, balances
 * equal the sum of their movements, FIFO layers sum to on-hand, and invoices reconcile to
 * their lines. `verify()` asserts all of that before a single line of SQL is written.
 *
 *   node scripts/seed-distributor.mjs            # write SQL to .wrangler/tmp
 *   node scripts/seed-distributor.mjs --apply    # ...and apply it to the local D1
 *
 * Development only. It truncates operational tables before reseeding.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(root, ".wrangler", "tmp");

// ---------------------------------------------------------------------------------------
// Deterministic randomness. A fixed seed keeps reruns byte-identical so the dataset can be
// reasoned about and diffed.
// ---------------------------------------------------------------------------------------
// mulberry32. A plain LCG was tried first and produced a badly skewed customer mix: the
// generator is sampled at a near-fixed stride inside the order loop, and an LCG sampled that
// way falls on a lattice, so a handful of accounts received most of the orders.
let seed = 20260809;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(random() * list.length)];

/** Cumulative-weight table so a weighted pick costs one draw instead of one per candidate. */
const weightedTable = (list, weightOf) => {
  const cumulative = [];
  let total = 0;
  for (const item of list) { total += weightOf(item); cumulative.push(total); }
  return { list, cumulative, total };
};
const pickWeighted = (table) => {
  const target = random() * table.total;
  let low = 0;
  let high = table.cumulative.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (table.cumulative[mid] < target) low = mid + 1; else high = mid;
  }
  return table.list[low];
};
const between = (min, max) => min + random() * (max - min);
const intBetween = (min, max) => Math.floor(between(min, max + 1));
const chance = (probability) => random() < probability;

const TODAY = new Date("2026-08-09T00:00:00.000Z");
const day = 86400000;
const dayString = (date) => new Date(date).toISOString().slice(0, 10);
const stamp = (date, hour = 9) => new Date(new Date(date).getTime() + hour * 3600000).toISOString();
const addDays = (date, count) => new Date(new Date(date).getTime() + count * day);
const daysAgo = (count) => addDays(TODAY, -count);
const money = (cents) => `$${(cents / 100).toLocaleString("en-CA", { maximumFractionDigits: 0 })}`;

// ---------------------------------------------------------------------------------------
// Targets. Everything else is generated until these are met.
// ---------------------------------------------------------------------------------------
const TARGET_REVENUE_CENTS = 25_000_000_00;
const GROSS_MARGIN = 0.31;
const TAX_RATE_BPS = 500; // Alberta: 5% GST, no PST.

const rows = {
  warehouses: [], locations: [], partners: [], partnerAddresses: [], products: [],
  purchaseOrders: [], purchaseOrderLines: [], receipts: [], receiptLines: [],
  salesOrders: [], salesOrderLines: [], shipments: [], shipmentLines: [], reservations: [],
  movements: [], balances: [], costLayers: [], valueEntries: [],
  customerInvoices: [], customerInvoiceLines: [], payments: [],
  vendorBills: [], vendorBillLines: [],
  priceLists: [], priceListEntries: [], priceListAssignments: [],
  sequences: [],
};

const counters = {};
const nextNumber = (prefix) => {
  counters[prefix] = (counters[prefix] ?? 0) + 1;
  return `${prefix}-${String(counters[prefix]).padStart(6, "0")}`;
};

// ---------------------------------------------------------------------------------------
// Warehouses and locations
// ---------------------------------------------------------------------------------------
rows.warehouses.push(
  { id: "warehouse-main", code: "YYC", name: "Calgary Distribution Centre", timezone: "America/Edmonton" },
  { id: "warehouse-north", code: "YEG", name: "Edmonton Cross-dock", timezone: "America/Edmonton" },
);

const addLocation = (id, code, name, type, status, warehouseId) =>
  rows.locations.push({ id, code, name, locationType: type, inventoryStatus: status, warehouseId });

addLocation("loc-yyc-recv", "WH1-RECV", "Receiving dock", "receiving", "usable", "warehouse-main");
addLocation("loc-yyc-stage", "WH1-STAGE", "Outbound staging", "shipping", "usable", "warehouse-main");
addLocation("loc-yyc-qa", "WH1-QA", "Quality quarantine", "quarantine", "quarantine", "warehouse-main");
addLocation("loc-yyc-ret", "WH1-RET", "Customer returns", "quarantine", "quarantine", "warehouse-main");
addLocation("loc-yyc-dmg", "WH1-DMG", "Damaged goods", "quarantine", "damaged", "warehouse-main");
addLocation("loc-transit", "TRANSIT-YYC-YEG", "Calgary to Edmonton transit", "in_transit", "in_transit", "warehouse-main");

const storageBins = [];
for (const aisle of ["A", "B", "C", "D", "E", "F"]) {
  for (let rack = 1; rack <= 5; rack += 1) {
    const code = `WH1-${aisle}-${String(rack).padStart(2, "0")}`;
    const id = `loc-yyc-${aisle.toLowerCase()}${rack}`;
    addLocation(id, code, `Aisle ${aisle} · Rack ${String(rack).padStart(2, "0")}`, "storage", "usable", "warehouse-main");
    storageBins.push(id);
  }
}
addLocation("loc-yeg-recv", "YEG-RECV", "Edmonton receiving", "receiving", "usable", "warehouse-north");
addLocation("loc-yeg-stage", "YEG-STAGE", "Edmonton staging", "shipping", "usable", "warehouse-north");
addLocation("loc-yeg-qa", "YEG-QA", "Edmonton quarantine", "quarantine", "quarantine", "warehouse-north");
const northBins = [];
for (const aisle of ["A", "B"]) {
  for (let rack = 1; rack <= 4; rack += 1) {
    const code = `YEG-${aisle}-${String(rack).padStart(2, "0")}`;
    const id = `loc-yeg-${aisle.toLowerCase()}${rack}`;
    addLocation(id, code, `Edmonton aisle ${aisle} · Rack ${String(rack).padStart(2, "0")}`, "storage", "usable", "warehouse-north");
    northBins.push(id);
  }
}

// ---------------------------------------------------------------------------------------
// Vendors. Ply Gem is the primary line and carries the majority of purchase spend.
// ---------------------------------------------------------------------------------------
const vendors = [
  { id: "vendor-plygem", code: "V-PLYGEM", name: "Ply Gem Canada", share: 0.62, email: "orders@plygem.example", phone: "1-888-975-9436", city: "Calgary", region: "AB", postalCode: "T2C 4X9", address: "6120 76 Ave SE", terms: "Net 30" },
  { id: "vendor-andersen", code: "V-ANDERSEN", name: "Andersen Distribution", share: 0.11, email: "orders@andersen.example", phone: "1-800-426-4261", city: "Edmonton", region: "AB", postalCode: "T5S 2W6", address: "18103 111 Ave NW", terms: "Net 30" },
  { id: "vendor-allweather", code: "V-ALLWEATHER", name: "All Weather Windows", share: 0.09, email: "orders@allweather.example", phone: "1-800-638-5700", city: "Edmonton", region: "AB", postalCode: "T6E 5V2", address: "10905 48 St SE", terms: "Net 30" },
  { id: "vendor-jeldwen", code: "V-JELDWEN", name: "Jeld-Wen Canada", share: 0.07, email: "orders@jeldwen.example", phone: "1-800-535-3936", city: "Calgary", region: "AB", postalCode: "T2H 2H8", address: "5820 2 St SE", terms: "Net 45" },
  { id: "vendor-durabuilt", code: "V-DURABUILT", name: "Durabuilt Windows & Doors", share: 0.06, email: "sales@durabuilt.example", phone: "1-800-661-8792", city: "Edmonton", region: "AB", postalCode: "T5V 1E5", address: "12750 170 St NW", terms: "Net 30" },
  { id: "vendor-cascadia", code: "V-CASCADIA", name: "Cascadia Windows", share: 0.04, email: "orders@cascadia.example", phone: "1-604-559-0122", city: "Langley", region: "BC", postalCode: "V2Y 1N5", address: "19125 96 Ave", terms: "Net 30" },
  { id: "vendor-milgard", code: "V-MILGARD", name: "Milgard Manufacturing", share: 0.03, email: "orders@milgard.example", phone: "1-800-645-4273", city: "Surrey", region: "BC", postalCode: "V3S 6K1", address: "18860 96 Ave", terms: "Net 30" },
  { id: "vendor-northglass", code: "V-NORTHGLASS", name: "Northern Glass Supply", share: 0.02, email: "service@northernglass.example", phone: "1-780-555-0166", city: "Edmonton", region: "AB", postalCode: "T6P 1M8", address: "9803 34 Ave NW", terms: "Net 15" },
];

for (const vendor of vendors) {
  rows.partners.push({
    id: vendor.id, code: vendor.code, name: vendor.name, partnerType: "vendor", email: vendor.email, phone: vendor.phone,
    addressLine1: vendor.address, city: vendor.city, region: vendor.region, postalCode: vendor.postalCode, country: "CA",
    paymentTerms: vendor.terms, creditLimitCents: 0, creditHold: 0,
  });
}

// ---------------------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------------------
const builderFirst = ["Aspen", "Bowmont", "Cedarcrest", "Deerfoot", "Elbow River", "Foothills", "Glenmore", "Hawkstone", "Inglewood", "Jumping Pound", "Kananaskis", "Legacy", "Mahogany", "Nolan Hill", "Okotoks", "Panorama", "Quarry Park", "Ridgeview", "Silverado", "Tuscany", "University Heights", "Valley Ridge", "Westbrook", "Auburn Bay", "Bearspaw", "Chestermere", "Cochrane", "Discovery Ridge", "Evanston", "Fish Creek", "Garrison", "Heritage Pointe", "Airdrie", "Bridgeland", "Copperfield", "Cranston", "Douglasdale", "Edgemont", "Livingston", "Mount Royal", "Northstar", "Oakridge", "Prairie Sky", "Redstone", "Sage Hill", "Seton", "Springbank", "Strathcona", "Sundance", "Varsity", "Walden", "Wolf Willow", "Copperstone", "Rockyview", "Saddleridge", "Millrise", "Somerset", "Shawnessy", "Coventry", "Harvest Hills"];
// Order sizes in cents. A distributor's book is mostly small service and renovation work
// with a tail of large builder packages, so the mix matters more than the average.
const builderKind = [
  { suffix: "Homes", weight: 3, segment: "Production builder", minOrder: 700_000, maxOrder: 3_800_000 },
  { suffix: "Custom Homes", weight: 3, segment: "Custom builder", minOrder: 400_000, maxOrder: 2_400_000 },
  { suffix: "Developments", weight: 2, segment: "Developer", minOrder: 1_400_000, maxOrder: 7_500_000 },
  { suffix: "Renovations", weight: 4, segment: "Renovator", minOrder: 60_000, maxOrder: 620_000 },
  { suffix: "Construction", weight: 2, segment: "General contractor", minOrder: 350_000, maxOrder: 2_300_000 },
  { suffix: "Contracting", weight: 3, segment: "Trade contractor", minOrder: 90_000, maxOrder: 850_000 },
  { suffix: "Millwork", weight: 1, segment: "Dealer", minOrder: 150_000, maxOrder: 1_200_000 },
  { suffix: "Building Supply", weight: 1, segment: "Dealer", minOrder: 220_000, maxOrder: 1_600_000 },
];
const weightedKinds = builderKind.flatMap((kind) => Array.from({ length: kind.weight }, () => kind));
const cities = [
  { city: "Calgary", region: "AB", prefix: "T2" }, { city: "Calgary", region: "AB", prefix: "T3" },
  { city: "Edmonton", region: "AB", prefix: "T5" }, { city: "Edmonton", region: "AB", prefix: "T6" },
  { city: "Airdrie", region: "AB", prefix: "T4B" }, { city: "Okotoks", region: "AB", prefix: "T1S" },
  { city: "Cochrane", region: "AB", prefix: "T4C" }, { city: "Red Deer", region: "AB", prefix: "T4N" },
  { city: "Lethbridge", region: "AB", prefix: "T1K" }, { city: "Chestermere", region: "AB", prefix: "T1X" },
];
const streets = ["Ave SE", "St NW", "Blvd SW", "Trail NE", "Way SE", "Cres NW", "Road SE", "Drive SW"];
const postal = () => `${pick(["A", "B", "C", "E", "G", "H", "J", "K"])}${intBetween(0, 9)}${pick(["A", "B", "C", "E", "G", "H", "J", "K"])}`;

const customers = [];
const usedNames = new Set();
for (let index = 0; customers.length < 180 && index < 4000; index += 1) {
  const kind = pick(weightedKinds);
  const name = `${pick(builderFirst)} ${kind.suffix}`;
  if (usedNames.has(name)) continue;
  usedNames.add(name);
  const place = pick(cities);
  const number = customers.length + 1;
  const customer = {
    id: `customer-${String(number).padStart(3, "0")}`,
    code: `C-${String(1000 + number)}`,
    name,
    partnerType: chance(0.04) ? "both" : "customer",
    email: `ap@${name.toLowerCase().replace(/[^a-z]+/g, "")}.example`,
    phone: `${pick(["403", "587", "780", "825"])}-555-${String(intBetween(100, 999))}`,
    addressLine1: `${intBetween(20, 19999)} ${intBetween(1, 199)} ${pick(streets)}`,
    city: place.city, region: place.region, postalCode: `${place.prefix}${place.prefix.length === 2 ? intBetween(0, 9) : ""} ${postal()}`.replace(/\s+/g, " ").trim(),
    country: "CA",
    paymentTerms: chance(0.72) ? "Net 30" : pick(["Net 15", "Net 45", "Net 60", "Due on receipt"]),
    creditLimitCents: Math.round(between(50_000_00, 750_000_00) / 500_00) * 500_00,
    creditHold: 0,
    segment: kind.segment,
    minOrder: kind.minOrder,
    maxOrder: kind.maxOrder,
  };
  customers.push(customer);
  rows.partners.push(customer);
}
// A handful of accounts sit on credit hold, which the AR aging report flags.
for (const customer of [customers[7], customers[41], customers[96], customers[153]]) customer.creditHold = 1;
// Roughly one account in twelve pays well past terms, and a couple are genuine problem
// accounts sitting in collections. Together they give the aging report a realistic tail.
for (const customer of customers) {
  customer.slowPayer = chance(0.08);
  customer.problemAccount = !customer.slowPayer && chance(0.022);
}

// Job-site ship-to addresses for the builders that run multiple sites.
const siteWords = ["Phase 1", "Phase 2", "Phase 3", "Show Home", "Lot 14", "Lot 32", "Block C", "Yard", "Main Site"];
for (const customer of customers) {
  if (!chance(0.45)) continue;
  const count = intBetween(1, 3);
  const labels = new Set();
  for (let index = 0; index < count; index += 1) {
    const place = pick(cities);
    const label = `${pick(builderFirst)} ${pick(siteWords)}`;
    if (labels.has(label)) continue;
    labels.add(label);
    rows.partnerAddresses.push({
      id: `paddr-${rows.partnerAddresses.length + 1}`,
      partnerId: customer.id, label,
      contactName: `${pick(["Dave", "Sarah", "Mike", "Jen", "Rob", "Priya", "Tom", "Alysha"])} ${pick(["Kim", "Nguyen", "Patel", "Boucher", "Reid", "Moreau", "Cardinal", "Whitford"])}`,
      addressLine1: `${intBetween(20, 19999)} ${intBetween(1, 199)} ${pick(streets)}`,
      city: place.city, region: place.region, postalCode: `${place.prefix}${place.prefix.length === 2 ? intBetween(0, 9) : ""} ${postal()}`.replace(/\s+/g, " ").trim(),
      country: "CA",
      deliveryInstructions: chance(0.5) ? pick(["Crane on site Tue/Thu, call ahead", "Gate code 4417, deliver to rear", "Site foreman must sign", "Deliver before 10am, no afternoon access", "Boom truck required"]) : null,
      isDefault: index === 0 ? 1 : 0,
    });
  }
}

// ---------------------------------------------------------------------------------------
// Product catalog
// ---------------------------------------------------------------------------------------
const seriesByVendor = {
  "vendor-plygem": [
    { code: "PG1500", name: "1500 Series Vinyl", material: "Vinyl", tier: 0.85 },
    { code: "PGPRO", name: "Pro Series Vinyl", material: "Vinyl", tier: 1.0 },
    { code: "PGPREM", name: "Premium Vinyl", material: "Vinyl", tier: 1.25 },
    { code: "PGMIRA", name: "Mira Premium", material: "Fiberglass", tier: 1.65 },
    { code: "PGBLD", name: "Builders Series", material: "Vinyl", tier: 0.72 },
  ],
  "vendor-andersen": [
    { code: "AW100", name: "100 Series", material: "Fibrex composite", tier: 1.15 },
    { code: "AW200", name: "200 Series", material: "Wood clad", tier: 1.4 },
    { code: "AW400", name: "400 Series", material: "Wood clad", tier: 1.85 },
  ],
  "vendor-allweather": [
    { code: "AWW-ECO", name: "Ecolite", material: "Vinyl", tier: 0.9 },
    { code: "AWW-SS", name: "Solarstar", material: "Vinyl", tier: 1.1 },
  ],
  "vendor-jeldwen": [
    { code: "JW-PREM", name: "Premium Vinyl", material: "Vinyl", tier: 1.2 },
    { code: "JW-BLD", name: "Builders Vinyl", material: "Vinyl", tier: 0.78 },
  ],
  "vendor-durabuilt": [{ code: "DB-END", name: "Endure", material: "Vinyl", tier: 0.95 }],
  "vendor-cascadia": [{ code: "CAS-UNI", name: "Universal Series", material: "Fiberglass", tier: 1.55 }],
  "vendor-milgard": [{ code: "MG-TRIN", name: "Trinsic", material: "Vinyl", tier: 1.05 }],
  "vendor-northglass": [{ code: "NG-SEAL", name: "Sealed Unit", material: "Glass", tier: 0.6 }],
};

const windowTypes = [
  { code: "CAS", name: "Casement", base: 520_00, sizes: ["24 × 36", "24 × 48", "30 × 36", "30 × 48", "36 × 48", "36 × 60"] },
  { code: "AWN", name: "Awning", base: 430_00, sizes: ["24 × 24", "24 × 36", "30 × 24", "36 × 24", "36 × 36"] },
  { code: "SH", name: "Single Hung", base: 340_00, sizes: ["30 × 48", "30 × 54", "30 × 60", "36 × 48", "36 × 60"] },
  { code: "DH", name: "Double Hung", base: 410_00, sizes: ["30 × 54", "30 × 60", "36 × 54", "36 × 60", "36 × 72"] },
  { code: "SL", name: "Slider", base: 380_00, sizes: ["48 × 36", "48 × 48", "60 × 48", "72 × 48", "72 × 60"] },
  { code: "PIC", name: "Picture", base: 460_00, sizes: ["48 × 60", "60 × 60", "72 × 60", "96 × 60"] },
  { code: "BAY", name: "Bay", base: 1_650_00, sizes: ["72 × 60", "96 × 60"] },
  { code: "BOW", name: "Bow", base: 1_980_00, sizes: ["96 × 60", "120 × 60"] },
  { code: "PATIO", name: "Patio Slider", base: 1_280_00, sizes: ["60 × 80", "72 × 80", "96 × 80"] },
  { code: "FRENCH", name: "French Door", base: 1_820_00, sizes: ["60 × 80", "72 × 80"] },
  { code: "ENTRY", name: "Entry Door", base: 940_00, sizes: ["36 × 80", "42 × 80"] },
];
const finishes = ["White / White", "White / Almond", "Sandtone", "Clay", "Black / White", "Bronze / White", "Sable", "Iron Ore"];

const products = [];
const usedSkus = new Set();
for (const [vendorId, seriesList] of Object.entries(seriesByVendor)) {
  const vendor = vendors.find((item) => item.id === vendorId);
  // Catalog depth follows purchase share: the primary line carries the most SKUs.
  const targetSkus = Math.max(12, Math.round(520 * vendor.share));
  let made = 0;
  let guard = 0;
  while (made < targetSkus && guard < targetSkus * 40) {
    guard += 1;
    const series = pick(seriesList);
    const type = pick(windowTypes);
    const size = pick(type.sizes);
    const finish = pick(finishes);
    const sku = `${series.code}-${type.code}-${size.replace(/[^0-9]/g, "")}-${finish.slice(0, 2).toUpperCase()}`;
    if (usedSkus.has(sku)) continue;
    usedSkus.add(sku);
    const area = size.split("×").map((part) => Number(part.trim()));
    const sizeFactor = (area[0] * area[1]) / (36 * 48);
    const cost = Math.round((type.base * series.tier * (0.55 + 0.45 * sizeFactor) * between(0.94, 1.06)) / 100) * 100;
    const margin = between(GROSS_MARGIN - 0.05, GROSS_MARGIN + 0.07);
    const policy = chance(0.72) ? "stocked" : chance(0.7) ? "special_order" : "drop_ship";
    const product = {
      id: `prod-${String(products.length + 1).padStart(4, "0")}`,
      sku,
      manufacturerSku: `${series.code}${intBetween(1000, 9999)}`,
      name: `${series.name} ${type.name} · ${size}`,
      category: ["PATIO", "FRENCH", "ENTRY"].includes(type.code) ? "Doors" : "Windows",
      material: series.material,
      dimensions: `${size} in`,
      finish,
      inventoryPolicy: policy,
      standardCostCents: cost,
      sellingPriceCents: Math.round(cost / (1 - margin) / 100) * 100,
      reorderPoint: policy === "stocked" ? intBetween(4, 24) : 0,
      vendorId,
      popularity: (policy === "stocked" ? between(0.4, 1) : between(0.05, 0.35)) * (vendorId === "vendor-plygem" ? 1.22 : 1),
    };
    products.push(product);
    rows.products.push(product);
    made += 1;
  }
}
const stockedProducts = products.filter((product) => product.inventoryPolicy === "stocked");
const sellableProducts = products.filter((product) => product.inventoryPolicy !== "drop_ship");
const stockedByPopularity = weightedTable(stockedProducts, (product) => product.popularity);
const sellableByPopularity = weightedTable(sellableProducts, (product) => product.popularity);

// Primary storage bin per stocked product, with a minority double-binned.
const primaryBin = new Map();
stockedProducts.forEach((product, index) => {
  primaryBin.set(product.id, chance(0.12) ? northBins[index % northBins.length] : storageBins[index % storageBins.length]);
});

// ---------------------------------------------------------------------------------------
// Sales demand: generate orders until trailing-twelve-month revenue reaches the target.
// ---------------------------------------------------------------------------------------
const monthWeight = [0.55, 0.6, 0.85, 1.1, 1.35, 1.4, 1.35, 1.25, 1.15, 1.0, 0.8, 0.6];
const weightedDay = () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const offset = intBetween(0, 364);
    const date = daysAgo(offset);
    if (random() < monthWeight[date.getUTCMonth()] / 1.4) return date;
  }
  return daysAgo(intBetween(0, 364));
};

const salesReps = ["Elena Rossi", "Darren Lee", "Nina Patel", "Marcus Webb", "Chloe Tremblay", "Sam Rivera"];
const orders = [];
let bookedRevenue = 0;
let orderGuard = 0;
while (bookedRevenue < TARGET_REVENUE_CENTS && orderGuard < 4000) {
  orderGuard += 1;
  const customer = pick(customers);
  const orderDate = weightedDay();
  const ageDays = Math.round((TODAY - orderDate) / day);
  const targetValue = between(customer.minOrder, customer.maxOrder);
  const lines = [];
  let subtotal = 0;
  let attempts = 0;
  while (subtotal < targetValue && lines.length < 9 && attempts < 40) {
    attempts += 1;
    const product = random() < 0.82 ? pickWeighted(stockedByPopularity) : pickWeighted(sellableByPopularity);
    if (lines.some((line) => line.productId === product.id)) continue;
    const quantity = intBetween(1, product.sellingPriceCents > 120_000 ? 4 : 14);
    // Volume accounts buy at contract pricing below the catalog list price.
    const discountRate = customer.segment === "Production builder" || customer.segment === "Developer"
      ? between(0.06, 0.14) : customer.segment === "Dealer" ? between(0.04, 0.1) : between(0, 0.06);
    const unitPrice = Math.round((product.sellingPriceCents * (1 - discountRate)) / 100) * 100;
    lines.push({ productId: product.id, quantity, unitPriceCents: unitPrice, route: product.inventoryPolicy === "drop_ship" ? "drop_ship" : product.inventoryPolicy === "special_order" ? "special_order" : "stock" });
    subtotal += quantity * unitPrice;
  }
  if (!lines.length) continue;

  // Lifecycle follows age: old orders are shipped, invoiced, and mostly paid; recent ones
  // are still working through reservation and fulfillment.
  let lifecycle = "confirmed";
  let shipFraction = 0;
  if (ageDays > 45) { lifecycle = "confirmed"; shipFraction = 1; }
  else if (ageDays > 21) { lifecycle = "confirmed"; shipFraction = chance(0.88) ? 1 : between(0.3, 0.8); }
  else if (ageDays > 8) { lifecycle = "confirmed"; shipFraction = chance(0.55) ? 1 : chance(0.5) ? between(0.2, 0.7) : 0; }
  else if (ageDays > 2) { lifecycle = chance(0.9) ? "confirmed" : "draft"; shipFraction = chance(0.25) ? between(0.3, 1) : 0; }
  else { lifecycle = chance(0.72) ? "confirmed" : "draft"; shipFraction = 0; }
  if (chance(0.015)) { lifecycle = "canceled"; shipFraction = 0; }

  const order = {
    id: `so-${String(orders.length + 1).padStart(5, "0")}`,
    number: nextNumber("SO"),
    customerId: customer.id,
    customer,
    lifecycle,
    orderDate,
    requestedDate: addDays(orderDate, intBetween(7, 45)),
    ownerName: pick(salesReps),
    lines: lines.map((line, index) => ({ ...line, id: `sol-${String(orders.length + 1).padStart(5, "0")}-${index + 1}` })),
    shipFraction,
    subtotalCents: subtotal,
  };
  orders.push(order);
  if (lifecycle !== "canceled" && shipFraction > 0) bookedRevenue += Math.round(subtotal * shipFraction);
}

// Resolve shipped quantity per line and record the demand each product must be supplied for.
const demandByProduct = new Map();
for (const order of orders) {
  if (order.lifecycle === "canceled") { order.lines.forEach((line) => { line.canceledQty = line.quantity; line.shippedQty = 0; }); continue; }
  const shipDate = addDays(order.orderDate, intBetween(3, 18));
  order.shipDate = shipDate > TODAY ? TODAY : shipDate;
  for (const line of order.lines) {
    line.canceledQty = 0;
    // Drop-ship never touches internal stock.
    line.shippedQty = line.route === "drop_ship" ? 0 : Math.floor(line.quantity * order.shipFraction);
    if (line.shippedQty > 0) {
      if (!demandByProduct.has(line.productId)) demandByProduct.set(line.productId, []);
      demandByProduct.get(line.productId).push({ date: order.shipDate, quantity: line.shippedQty, line, order });
    }
  }
}

// ---------------------------------------------------------------------------------------
// Supply: replenishment events sized to cover demand and land on a healthy ending stock.
// ---------------------------------------------------------------------------------------
const replenishments = [];
for (const product of products) {
  const demand = (demandByProduct.get(product.id) ?? []).sort((left, right) => left.date - right.date);
  const annualDemand = demand.reduce((total, event) => total + event.quantity, 0);
  // Buy in lots sized to a few weeks of supply. Lot buying leaves roughly half a lot on the
  // shelf on average, which is what puts inventory turns in a believable range; special
  // orders and drop-ships are bought to the order and carry nothing.
  const stocked = product.inventoryPolicy === "stocked";
  // Buyers hold a safety stock and replenish in economic lots. Average inventory is roughly
  // safety + half a lot, which is what sets the turn rate; special orders carry neither.
  const safety = stocked ? Math.max(1, Math.round((annualDemand * between(3, 5)) / 52)) : 0;
  const lot = stocked ? Math.max(1, Math.round((annualDemand * between(6, 10)) / 52)) : 0;
  if (stocked) product.reorderPoint = safety;
  let onHand = 0;
  // The business existed before the reporting window, so stocked SKUs open with a position
  // dated outside it. Without this the first year would carry the whole inventory build and
  // trailing purchases would read far above steady state.
  if (stocked) {
    const opening = safety + Math.round(lot * between(0.3, 0.8));
    replenishments.push({ product, quantity: opening, date: daysAgo(intBetween(368, 400)) });
    onHand += opening;
  }
  for (const event of demand) {
    if (onHand - event.quantity >= safety) { onHand -= event.quantity; continue; }
    const shortfall = event.quantity + safety - onHand;
    const batch = stocked && lot > 0 ? Math.ceil(shortfall / lot) * lot : Math.max(shortfall, event.quantity - onHand);
    replenishments.push({ product, quantity: batch, date: addDays(event.date, -intBetween(2, 16)) });
    onHand += batch - event.quantity;
  }
}
replenishments.sort((left, right) => left.date - right.date);

// Group replenishments into purchase orders by vendor and week.
const buyers = ["Maya Chen", "Jon Bell", "Priya Rao", "Curtis Nakamura"];
const poGroups = new Map();
for (const replenishment of replenishments) {
  const week = Math.floor(replenishment.date.getTime() / (7 * day));
  const key = `${replenishment.product.vendorId}:${week}`;
  if (!poGroups.has(key)) poGroups.set(key, { vendorId: replenishment.product.vendorId, date: replenishment.date, items: [] });
  poGroups.get(key).items.push(replenishment);
}

const receivedLines = [];
for (const group of [...poGroups.values()].sort((left, right) => left.date - right.date)) {
  // A weekly buy can exceed one truck; split oversized groups into separate orders.
  for (let offset = 0; offset < group.items.length; offset += 8) {
    const items = group.items.slice(offset, offset + 8);
    const orderDate = addDays(group.date, -intBetween(5, 21));
    const poId = `po-${String(rows.purchaseOrders.length + 1).padStart(5, "0")}`;
    let total = 0;
    const lines = items.map((item, index) => {
      const unitCost = Math.round(item.product.standardCostCents * between(0.97, 1.03) / 100) * 100;
      total += unitCost * item.quantity;
      return { id: `pol-${poId}-${index + 1}`, purchaseOrderId: poId, productId: item.product.id, orderedQty: item.quantity, unitCostCents: unitCost, product: item.product, receiveDate: group.date };
    });
    const vendor = vendors.find((item) => item.id === group.vendorId);
    rows.purchaseOrders.push({
      id: poId, number: nextNumber("PO"), vendorId: group.vendorId, lifecycleStatus: "approved",
      billingStatus: "not_billed", expectedDate: dayString(group.date), totalCents: total,
      buyerName: pick(buyers), createdAt: stamp(orderDate), paymentTerms: vendor.terms,
      dueDate: dayString(addDays(group.date, vendor.terms === "Net 45" ? 45 : vendor.terms === "Net 15" ? 15 : 30)),
      receiveDate: group.date, received: true,
    });
    for (const line of lines) { rows.purchaseOrderLines.push(line); receivedLines.push(line); }
  }
}

// Open purchase orders: inbound work that has not landed yet, plus a few running late.
for (let index = 0; index < 34; index += 1) {
  const vendor = random() < 0.6 ? vendors[0] : pick(vendors);
  const late = index < 6;
  const expected = late ? daysAgo(intBetween(1, 12)) : addDays(TODAY, intBetween(1, 40));
  const poId = `po-open-${String(index + 1).padStart(3, "0")}`;
  const items = Array.from({ length: intBetween(2, 6) }, () => pick(products.filter((product) => product.vendorId === vendor.id)) ?? pick(products));
  let total = 0;
  const seen = new Set();
  const lines = [];
  items.forEach((product, lineIndex) => {
    if (seen.has(product.id)) return;
    seen.add(product.id);
    const quantity = intBetween(4, 40);
    const unitCost = Math.round(product.standardCostCents * between(0.97, 1.03) / 100) * 100;
    total += unitCost * quantity;
    lines.push({ id: `pol-${poId}-${lineIndex + 1}`, purchaseOrderId: poId, productId: product.id, orderedQty: quantity, unitCostCents: unitCost, product, receiveDate: null });
  });
  if (!lines.length) continue;
  rows.purchaseOrders.push({
    id: poId, number: nextNumber("PO"), vendorId: vendor.id,
    lifecycleStatus: index >= 28 ? "pending_approval" : "approved",
    billingStatus: "not_billed", expectedDate: dayString(expected), totalCents: total,
    buyerName: pick(buyers), createdAt: stamp(addDays(expected, -intBetween(10, 35))), paymentTerms: vendor.terms,
    dueDate: dayString(addDays(expected, 30)), receiveDate: null, received: false,
  });
  rows.purchaseOrderLines.push(...lines);
}

// ---------------------------------------------------------------------------------------
// Physical postings: receipts, then shipments, in date order so stock never goes negative.
// ---------------------------------------------------------------------------------------
const events = [];
for (const po of rows.purchaseOrders.filter((order) => order.received)) {
  events.push({ kind: "receipt", date: po.receiveDate, po });
}
for (const order of orders) {
  if (order.lifecycle === "canceled") continue;
  const shipped = order.lines.filter((line) => line.shippedQty > 0);
  if (shipped.length) events.push({ kind: "shipment", date: order.shipDate, order, lines: shipped });
}
events.sort((left, right) => left.date - right.date);

const balanceKey = (productId, locationId) => `${productId}::${locationId}`;
const balances = new Map();
const adjustBalance = (productId, locationId, delta) => {
  const key = balanceKey(productId, locationId);
  const current = balances.get(key) ?? { productId, locationId, onHand: 0, reserved: 0 };
  current.onHand += delta;
  balances.set(key, current);
  return current;
};
const layersByProduct = new Map();
let movementSequence = 0;
const addMovement = (movement) => {
  movementSequence += 1;
  const id = `mv-${String(movementSequence).padStart(6, "0")}`;
  rows.movements.push({ id, ...movement });
  return id;
};

for (const event of events) {
  if (event.kind === "receipt") {
    const po = event.po;
    const receiptId = `rcpt-${po.id}`;
    const lines = rows.purchaseOrderLines.filter((line) => line.purchaseOrderId === po.id);
    rows.receipts.push({ id: receiptId, number: nextNumber("RCV"), purchaseOrderId: po.id, postedAt: stamp(event.date, 10) });
    for (const line of lines) {
      const destination = primaryBin.get(line.productId) ?? storageBins[0];
      rows.receiptLines.push({ id: `rl-${line.id}`, receiptId, purchaseOrderLineId: line.id, productId: line.productId, locationId: destination, quantity: line.orderedQty, condition: "usable" });
      const movementId = addMovement({
        movementType: "purchase_receipt", productId: line.productId, quantity: line.orderedQty,
        fromLocationId: null, toLocationId: destination, inventoryStatus: "usable",
        sourceDocumentType: "receipt", sourceDocumentId: receiptId, sourceLineId: `rl-${line.id}`,
        purchaseOrderLineId: line.id, salesOrderLineId: null, postedAt: stamp(event.date, 10),
        postedBy: pick(["Sam Rivera", "Tyler Boucher", "Andre Cardinal"]), unitCostCents: line.unitCostCents,
      });
      adjustBalance(line.productId, destination, line.orderedQty);
      const layer = { id: `layer-${movementId}`, productId: line.productId, receiptMovementId: movementId, receivedQty: line.orderedQty, remainingQty: line.orderedQty, unitCostCents: line.unitCostCents, receivedAt: stamp(event.date, 10), status: "open" };
      rows.costLayers.push(layer);
      if (!layersByProduct.has(line.productId)) layersByProduct.set(line.productId, []);
      layersByProduct.get(line.productId).push(layer);
      rows.valueEntries.push({ id: `ive-in-${movementId}`, productId: line.productId, movementId, entryType: "receipt", quantity: line.orderedQty, unitCostCents: line.unitCostCents, valueCents: line.unitCostCents * line.orderedQty, costMethod: "fifo", referenceType: "receipt", referenceId: receiptId, postedAt: stamp(event.date, 10), postedBy: "System" });
      line.receivedQty = line.orderedQty;
    }
    continue;
  }

  const order = event.order;
  const shipmentId = `shp-${order.id}`;
  rows.shipments.push({
    id: shipmentId, number: nextNumber("SHP"), salesOrderId: order.id, postedAt: stamp(event.date, 14),
    carrier: pick(["Bison Transport", "Rosenau Transport", "Day & Ross", "Company fleet"]),
    serviceLevel: pick(["LTL", "Flatbed", "Local delivery"]),
    trackingNumber: `PRO${intBetween(100000, 999999)}`,
  });
  for (const line of event.lines) {
    const source = primaryBin.get(line.productId) ?? storageBins[0];
    rows.shipmentLines.push({ id: `sl-${line.id}`, shipmentId, salesOrderLineId: line.id, productId: line.productId, locationId: source, quantity: line.shippedQty });
    const movementId = addMovement({
      movementType: "sales_shipment", productId: line.productId, quantity: -line.shippedQty,
      fromLocationId: source, toLocationId: null, inventoryStatus: "usable",
      sourceDocumentType: "shipment", sourceDocumentId: shipmentId, sourceLineId: `sl-${line.id}`,
      purchaseOrderLineId: null, salesOrderLineId: line.id, postedAt: stamp(event.date, 14),
      postedBy: pick(["Nina Patel", "Tyler Boucher", "Andre Cardinal"]), unitCostCents: 0,
    });
    adjustBalance(line.productId, source, -line.shippedQty);
    // FIFO consumption drives both the remaining layers and the COGS value entry.
    let remaining = line.shippedQty;
    let cogs = 0;
    for (const layer of layersByProduct.get(line.productId) ?? []) {
      if (remaining <= 0) break;
      const taken = Math.min(layer.remainingQty, remaining);
      if (taken <= 0) continue;
      layer.remainingQty -= taken;
      if (layer.remainingQty === 0) layer.status = "consumed";
      cogs += taken * layer.unitCostCents;
      remaining -= taken;
    }
    rows.valueEntries.push({ id: `ive-out-${movementId}`, productId: line.productId, movementId, entryType: "shipment", quantity: -line.shippedQty, unitCostCents: line.shippedQty ? Math.round(cogs / line.shippedQty) : 0, valueCents: -cogs, costMethod: "fifo", referenceType: "shipment", referenceId: shipmentId, postedAt: stamp(event.date, 14), postedBy: "System" });
  }
}

// Reservations for confirmed demand that has not shipped, capped at what is on the shelf.
for (const order of orders) {
  if (order.lifecycle !== "confirmed") continue;
  for (const line of order.lines) {
    const outstanding = line.quantity - line.canceledQty - line.shippedQty;
    if (outstanding <= 0 || line.route === "drop_ship") continue;
    if (!chance(0.72)) continue;
    const location = primaryBin.get(line.productId) ?? storageBins[0];
    const balance = balances.get(balanceKey(line.productId, location));
    if (!balance) continue;
    const free = balance.onHand - balance.reserved;
    const quantity = Math.min(outstanding, free);
    if (quantity <= 0) continue;
    balance.reserved += quantity;
    rows.reservations.push({ id: `res-${line.id}`, salesOrderLineId: line.id, productId: line.productId, locationId: location, quantity, status: "active", createdAt: stamp(order.orderDate, 11) });
  }
}

for (const balance of balances.values()) {
  if (balance.onHand === 0 && balance.reserved === 0) continue;
  rows.balances.push(balance);
}

// ---------------------------------------------------------------------------------------
// Customer invoices and receipts of payment, aged to produce a realistic AR ledger.
// ---------------------------------------------------------------------------------------
for (const order of orders) {
  const shipped = order.lines.filter((line) => line.shippedQty > 0);
  if (!shipped.length) continue;
  const invoiceDate = addDays(order.shipDate, intBetween(0, 3));
  if (invoiceDate > TODAY) continue;
  const termDays = order.customer.paymentTerms === "Net 15" ? 15 : order.customer.paymentTerms === "Net 45" ? 45 : order.customer.paymentTerms === "Net 60" ? 60 : order.customer.paymentTerms === "Due on receipt" ? 0 : 30;
  const subtotal = shipped.reduce((total, line) => total + line.shippedQty * line.unitPriceCents, 0);
  const tax = Math.round((subtotal * TAX_RATE_BPS) / 10000);
  const total = subtotal + tax;
  const invoiceId = `inv-${order.id}`;
  const ageDays = Math.round((TODAY - invoiceDate) / day);
  // Older invoices are settled; the recent tail plus a slow-paying minority makes the aging.
  // Draw an actual days-to-pay per invoice rather than layering probabilities: terms plus a
  // small skew, a occasional long tail, and a multiplier for chronically slow accounts. DSO
  // then falls out of the distribution instead of having to be guessed at.
  const settleDays = order.customer.problemAccount
    ? Math.round(between(95, 260))
    : Math.max(1, Math.round(
      (termDays + between(-6, 13) + (chance(0.12) ? between(10, 40) : 0)) * (order.customer.slowPayer ? between(1.6, 2.6) : 1),
    ));
  let paid = 0;
  if (settleDays <= ageDays) paid = total;
  else if (ageDays > termDays && chance(0.14)) paid = Math.round((total * between(0.25, 0.7)) / 100) * 100;
  const status = paid >= total ? "paid" : paid > 0 ? "partially_paid" : "posted";
  rows.customerInvoices.push({
    id: invoiceId, number: nextNumber("INV"), customerId: order.customerId, salesOrderId: order.id, status,
    invoiceDate: dayString(invoiceDate), dueDate: dayString(addDays(invoiceDate, termDays)),
    subtotalCents: subtotal, taxCents: tax, totalCents: total, paidCents: paid,
    taxRateBps: TAX_RATE_BPS, taxCode: "GST", paymentTerms: order.customer.paymentTerms,
    postedAt: stamp(invoiceDate, 16), postedBy: pick(["Morgan Liu", "Alysha Reid"]),
  });
  shipped.forEach((line) => rows.customerInvoiceLines.push({
    id: `cil-${line.id}`, customerInvoiceId: invoiceId, salesOrderLineId: line.id, productId: line.productId,
    quantity: line.shippedQty, unitPriceCents: line.unitPriceCents, lineTotalCents: line.shippedQty * line.unitPriceCents,
  }));
  if (paid > 0) {
    const paymentDate = addDays(invoiceDate, Math.min(settleDays, ageDays));
    rows.payments.push({
      id: `pay-${invoiceId}`, number: nextNumber("PAY"), direction: "inbound", partnerId: order.customerId,
      documentType: "customer_invoice", documentId: invoiceId, amountCents: paid, paymentDate: dayString(paymentDate),
      method: pick(["eft", "cheque", "credit_card"]), reference: `${order.customer.code} ${dayString(paymentDate).replaceAll("-", "")}`,
      postedAt: stamp(paymentDate, 15), postedBy: "Morgan Liu",
    });
  }
  order.billingStatus = paid >= total ? "invoiced" : "partially_invoiced";
}

// Sales-order billing status reflects invoiced versus shipped quantity.
for (const order of orders) {
  const shippedUnits = order.lines.reduce((total, line) => total + line.shippedQty, 0);
  const orderedUnits = order.lines.reduce((total, line) => total + line.quantity - line.canceledQty, 0);
  order.billingStatus = shippedUnits === 0 ? "not_invoiced" : shippedUnits >= orderedUnits ? "invoiced" : "partially_invoiced";
}

// ---------------------------------------------------------------------------------------
// Vendor bills, including the match exceptions the AP workspace exists to resolve.
// ---------------------------------------------------------------------------------------
for (const po of rows.purchaseOrders.filter((order) => order.received)) {
  if (!chance(0.93)) continue;
  const lines = rows.purchaseOrderLines.filter((line) => line.purchaseOrderId === po.id);
  if (!lines.length) continue;
  const vendor = vendors.find((item) => item.id === po.vendorId);
  const billDate = addDays(po.receiveDate, intBetween(1, 9));
  if (billDate > TODAY) continue;
  const exception = chance(0.06);
  const billId = `vb-${po.id}`;
  let subtotal = 0;
  const billLines = lines.map((line, index) => {
    const unitCost = exception && index === 0 ? Math.round(line.unitCostCents * between(1.04, 1.18) / 100) * 100 : line.unitCostCents;
    subtotal += unitCost * line.orderedQty;
    return { id: `vbl-${line.id}`, vendorBillId: billId, purchaseOrderLineId: line.id, productId: line.productId, quantity: line.orderedQty, unitCostCents: unitCost, lineTotalCents: unitCost * line.orderedQty, matchStatus: unitCost === line.unitCostCents ? "matched" : "price_variance" };
  });
  const tax = Math.round((subtotal * TAX_RATE_BPS) / 10000);
  const total = subtotal + tax;
  const ageDays = Math.round((TODAY - billDate) / day);
  const paid = exception ? 0 : ageDays > 40 ? total : ageDays > 20 && chance(0.5) ? total : 0;
  rows.vendorBills.push({
    id: billId, number: nextNumber("VB"), vendorId: po.vendorId, purchaseOrderId: po.id,
    status: exception ? "on_hold" : paid >= total ? "paid" : "posted",
    matchStatus: exception ? "price_variance" : "matched",
    totalCents: total, subtotalCents: subtotal, taxCents: tax, paidCents: paid,
    dueDate: dayString(addDays(billDate, vendor.terms === "Net 45" ? 45 : vendor.terms === "Net 15" ? 15 : 30)),
    vendorInvoiceNumber: `${vendor.code.split("-")[1]}-${intBetween(100000, 999999)}`,
    invoiceDate: dayString(billDate), postedAt: stamp(billDate, 11),
    holdReason: exception ? "Vendor unit price exceeds the approved purchase-order cost" : null,
    taxRateBps: TAX_RATE_BPS, taxCode: "GST", paymentTerms: vendor.terms,
  });
  rows.vendorBillLines.push(...billLines);
  po.billingStatus = paid >= total ? "fully_billed" : "partially_billed";
}

// ---------------------------------------------------------------------------------------
// Contract price lists
// ---------------------------------------------------------------------------------------
const tiers = [
  { id: "pl-production", code: "PROD-BUILDER", name: "Production builder program", priority: 30, discount: 0.14, segments: ["Production builder", "Developer"] },
  { id: "pl-preferred", code: "PREFERRED", name: "Preferred contractor", priority: 20, discount: 0.09, segments: ["Custom builder", "General contractor"] },
  { id: "pl-trade", code: "TRADE", name: "Standard trade", priority: 10, discount: 0.05, segments: ["Trade contractor", "Renovator"] },
  { id: "pl-dealer", code: "DEALER", name: "Dealer net", priority: 25, discount: 0.11, segments: ["Dealer"] },
];
const contractProducts = stockedProducts.slice(0, 150);
for (const tier of tiers) {
  rows.priceLists.push({ id: tier.id, code: tier.code, name: tier.name, priority: tier.priority });
  for (const product of contractProducts) {
    rows.priceListEntries.push({ id: `ple-${tier.id}-${product.id}`, priceListId: tier.id, productId: product.id, uomId: "uom-each", minimumQuantity: 1, unitPriceCents: Math.round(product.sellingPriceCents * (1 - tier.discount) / 100) * 100 });
    if (chance(0.35)) rows.priceListEntries.push({ id: `ple-${tier.id}-${product.id}-b`, priceListId: tier.id, productId: product.id, uomId: "uom-each", minimumQuantity: 10, unitPriceCents: Math.round(product.sellingPriceCents * (1 - tier.discount - 0.03) / 100) * 100 });
  }
  for (const customer of customers.filter((item) => tier.segments.includes(item.segment))) {
    rows.priceListAssignments.push({ id: `pla-${tier.id}-${customer.id}`, priceListId: tier.id, partnerId: customer.id, priority: tier.priority });
  }
}

// Continue numbering past the seeded documents.
for (const [prefix, value] of Object.entries(counters)) rows.sequences.push({ prefix, nextValue: value });

// ---------------------------------------------------------------------------------------
// Invariant checks. Nothing is written unless the dataset is internally consistent.
// ---------------------------------------------------------------------------------------
function verify() {
  const problems = [];
  const movementTotals = new Map();
  for (const movement of rows.movements) {
    const location = movement.toLocationId ?? movement.fromLocationId;
    const key = balanceKey(movement.productId, location);
    movementTotals.set(key, (movementTotals.get(key) ?? 0) + movement.quantity);
  }
  for (const balance of rows.balances) {
    const key = balanceKey(balance.productId, balance.locationId);
    if (Math.abs((movementTotals.get(key) ?? 0) - balance.onHand) > 1e-9) problems.push(`balance ${key} does not equal its movements`);
    if (balance.onHand < 0) problems.push(`negative on-hand at ${key}`);
    if (balance.reserved < 0 || balance.reserved > balance.onHand) problems.push(`reserved exceeds on-hand at ${key}`);
  }
  for (const [key, quantity] of movementTotals) {
    if (Math.abs(quantity) > 1e-9 && !rows.balances.some((balance) => balanceKey(balance.productId, balance.locationId) === key)) problems.push(`movements at ${key} have no balance row`);
  }
  const onHandByProduct = new Map();
  for (const balance of rows.balances) onHandByProduct.set(balance.productId, (onHandByProduct.get(balance.productId) ?? 0) + balance.onHand);
  const layerRemaining = new Map();
  for (const layer of rows.costLayers) layerRemaining.set(layer.productId, (layerRemaining.get(layer.productId) ?? 0) + layer.remainingQty);
  for (const [productId, quantity] of onHandByProduct) {
    if (Math.abs((layerRemaining.get(productId) ?? 0) - quantity) > 1e-9) problems.push(`FIFO layers for ${productId} do not sum to on-hand`);
  }
  for (const invoice of rows.customerInvoices) {
    if (invoice.subtotalCents + invoice.taxCents !== invoice.totalCents) problems.push(`invoice ${invoice.number} total does not equal subtotal plus tax`);
    if (invoice.paidCents > invoice.totalCents) problems.push(`invoice ${invoice.number} is overpaid`);
    const lineTotal = rows.customerInvoiceLines.filter((line) => line.customerInvoiceId === invoice.id).reduce((total, line) => total + line.lineTotalCents, 0);
    if (lineTotal !== invoice.subtotalCents) problems.push(`invoice ${invoice.number} lines do not equal its subtotal`);
  }
  for (const line of rows.purchaseOrderLines) {
    if ((line.receivedQty ?? 0) > line.orderedQty + 1e-9) problems.push(`purchase line ${line.id} received more than ordered`);
  }
  // Guards against a skewed generator quietly piling the whole book onto a few accounts.
  const ordersPerCustomer = new Map();
  for (const order of orders) ordersPerCustomer.set(order.customerId, (ordersPerCustomer.get(order.customerId) ?? 0) + 1);
  const busiest = Math.max(...ordersPerCustomer.values());
  if (ordersPerCustomer.size < customers.length * 0.9) problems.push(`only ${ordersPerCustomer.size} of ${customers.length} customers have orders`);
  if (busiest > (orders.length / customers.length) * 4) problems.push(`order distribution is skewed: one customer holds ${busiest} of ${orders.length} orders`);
  const productsSold = new Set(orders.flatMap((order) => order.lines.map((line) => line.productId)));
  if (productsSold.size < products.length * 0.6) problems.push(`only ${productsSold.size} of ${products.length} products ever sold`);

  const productIds = new Set(products.map((product) => product.id));
  const locationIds = new Set(rows.locations.map((location) => location.id));
  for (const movement of rows.movements) {
    if (!productIds.has(movement.productId)) problems.push(`movement ${movement.id} references an unknown product`);
    const location = movement.toLocationId ?? movement.fromLocationId;
    if (!locationIds.has(location)) problems.push(`movement ${movement.id} references an unknown location`);
  }
  return problems;
}

const problems = verify();
if (problems.length) {
  console.error(`Seed aborted: ${problems.length} consistency problem(s).`);
  for (const problem of problems.slice(0, 15)) console.error(`  - ${problem}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------
// SQL emission
// ---------------------------------------------------------------------------------------
const quote = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
};

const statements = [];
const insert = (table, columns, list, project) => {
  for (let index = 0; index < list.length; index += 400) {
    const chunk = list.slice(index, index + 400);
    const values = chunk.map((item) => `(${project(item).map(quote).join(",")})`).join(",");
    statements.push(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${values};`);
  }
};

// Operational tables are cleared in dependency order before reseeding. The movement ledger
// is deliberately append-only in normal operation, so its immutability triggers are dropped
// for the reseed and restored verbatim afterwards.
statements.push(
  "PRAGMA defer_foreign_keys=TRUE;",
  "DROP TRIGGER IF EXISTS stock_movements_immutable_delete;",
  "DROP TRIGGER IF EXISTS stock_movements_immutable_update;",
  ...["payments", "customer_invoice_lines", "customer_invoices", "customer_credits", "vendor_bill_lines", "vendor_bills", "vendor_credits",
    "inventory_value_entries", "landed_cost_allocation_lines", "landed_cost_allocations", "cost_layers", "movement_assignments",
    "returnable_events", "returnable_obligations", "inventory_counts", "customer_returns", "vendor_returns", "drop_ship_deliveries",
    "shipment_lines", "shipments", "reservations", "receipt_lines", "receipts", "inventory_transfer_lines", "inventory_transfers",
    "stock_movements", "inventory_balances", "inventory_units", "inventory_lots", "sales_order_lines", "sales_orders",
    "purchase_order_revisions", "purchase_order_lines", "purchase_orders", "price_list_entries", "price_list_assignments", "price_lists",
    "partner_addresses", "document_charges", "approvals", "outbox_events", "audit_events", "command_log", "valuation_policies", "uom_conversions",
    "products", "business_partners", "locations", "warehouses", "document_sequences"].map((table) => `DELETE FROM ${table};`),
);

const now = TODAY.toISOString();

insert("warehouses", ["id", "code", "name", "timezone", "active", "version"], rows.warehouses, (item) => [item.id, item.code, item.name, item.timezone, 1, 1]);
insert("locations", ["id", "code", "name", "location_type", "inventory_status", "warehouse_id", "active", "version"], rows.locations, (item) => [item.id, item.code, item.name, item.locationType, item.inventoryStatus, item.warehouseId, 1, 1]);
insert("business_partners", ["id", "code", "name", "partner_type", "email", "phone", "address_line_1", "city", "region", "postal_code", "country", "payment_terms", "currency", "credit_limit_cents", "credit_hold", "active", "version", "created_at"], rows.partners,
  (item) => [item.id, item.code, item.name, item.partnerType, item.email, item.phone, item.addressLine1, item.city, item.region, item.postalCode, item.country ?? "CA", item.paymentTerms, "CAD", item.creditLimitCents ?? 0, item.creditHold ?? 0, 1, 1, now]);
insert("partner_addresses", ["id", "partner_id", "label", "contact_name", "address_line_1", "city", "region", "postal_code", "country", "delivery_instructions", "is_default", "active", "version", "created_at", "updated_at"], rows.partnerAddresses,
  (item) => [item.id, item.partnerId, item.label, item.contactName, item.addressLine1, item.city, item.region, item.postalCode, item.country, item.deliveryInstructions, item.isDefault, 1, 1, now, now]);
insert("products", ["id", "sku", "manufacturer_sku", "name", "category", "material", "dimensions", "finish", "tracking_policy", "inventory_policy", "standard_cost_cents", "selling_price_cents", "reorder_point", "base_uom_id", "purchase_uom_id", "sales_uom_id", "active", "version", "created_at"], rows.products,
  (item) => [item.id, item.sku, item.manufacturerSku, item.name, item.category, item.material, item.dimensions, item.finish, "quantity", item.inventoryPolicy, item.standardCostCents, item.sellingPriceCents, item.reorderPoint, "uom-each", "uom-each", "uom-each", 1, 1, now]);
insert("purchase_orders", ["id", "number", "vendor_id", "lifecycle_status", "billing_status", "expected_date", "currency", "exchange_rate_to_base", "base_total_cents", "payment_terms", "due_date", "total_cents", "buyer_name", "revision_number", "version", "created_at"], rows.purchaseOrders,
  (item) => [item.id, item.number, item.vendorId, item.lifecycleStatus, item.billingStatus, item.expectedDate, "CAD", 1, item.totalCents, item.paymentTerms, item.dueDate, item.totalCents, item.buyerName, 1, 1, item.createdAt]);
insert("purchase_order_lines", ["id", "purchase_order_id", "product_id", "ordered_qty", "closed_qty", "unit_cost_cents", "configuration_snapshot", "fulfillment_route", "version", "ordered_uom_id", "ordered_uom_qty", "ordered_uom_unit_cost_cents"], rows.purchaseOrderLines,
  (item) => [item.id, item.purchaseOrderId, item.productId, item.orderedQty, 0, item.unitCostCents, `${item.product.name} · ${item.product.finish}`, "stock", 1, "uom-each", item.orderedQty, item.unitCostCents]);
insert("receipts", ["id", "number", "purchase_order_id", "status", "posted_at", "version"], rows.receipts, (item) => [item.id, item.number, item.purchaseOrderId, "posted", item.postedAt, 1]);
insert("receipt_lines", ["id", "receipt_id", "purchase_order_line_id", "product_id", "location_id", "quantity", "condition"], rows.receiptLines, (item) => [item.id, item.receiptId, item.purchaseOrderLineId, item.productId, item.locationId, item.quantity, item.condition]);
insert("sales_orders", ["id", "number", "customer_id", "lifecycle_status", "billing_status", "requested_date", "currency", "exchange_rate_to_base", "base_total_cents", "payment_terms", "due_date", "total_cents", "owner_name", "version", "created_at", "ship_to_name", "ship_to_address_line_1", "ship_to_city", "ship_to_region", "ship_to_postal_code", "ship_to_country"], orders,
  (item) => {
    const total = item.lines.reduce((sum, line) => sum + (line.quantity - line.canceledQty) * line.unitPriceCents, 0);
    const withTax = total + Math.round((total * TAX_RATE_BPS) / 10000);
    return [item.id, item.number, item.customerId, item.lifecycle, item.billingStatus ?? "not_invoiced", dayString(item.requestedDate), "CAD", 1, withTax, item.customer.paymentTerms, dayString(addDays(item.requestedDate, 30)), withTax, item.ownerName, 1, stamp(item.orderDate),
      item.customer.name, item.customer.addressLine1, item.customer.city, item.customer.region, item.customer.postalCode, "CA"];
  });
insert("sales_order_lines", ["id", "sales_order_id", "product_id", "ordered_qty", "canceled_qty", "unit_price_cents", "configuration_snapshot", "fulfillment_route", "discount_cents", "taxable", "tax_rate_bps", "ordered_uom_id", "ordered_uom_qty", "ordered_uom_unit_price_cents"], orders.flatMap((order) => order.lines.map((line) => ({ ...line, salesOrderId: order.id }))),
  (item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    return [item.id, item.salesOrderId, item.productId, item.quantity, item.canceledQty ?? 0, item.unitPriceCents, `${product.name} · ${product.finish}`, item.route, 0, 1, TAX_RATE_BPS, "uom-each", item.quantity, item.unitPriceCents];
  });
insert("shipments", ["id", "number", "sales_order_id", "status", "posted_at", "version", "carrier", "service_level", "tracking_number"], rows.shipments, (item) => [item.id, item.number, item.salesOrderId, "posted", item.postedAt, 1, item.carrier, item.serviceLevel, item.trackingNumber]);
insert("shipment_lines", ["id", "shipment_id", "sales_order_line_id", "product_id", "location_id", "quantity"], rows.shipmentLines, (item) => [item.id, item.shipmentId, item.salesOrderLineId, item.productId, item.locationId, item.quantity]);
insert("reservations", ["id", "sales_order_line_id", "product_id", "location_id", "quantity", "status", "created_at"], rows.reservations, (item) => [item.id, item.salesOrderLineId, item.productId, item.locationId, item.quantity, item.status, item.createdAt]);
insert("stock_movements", ["id", "movement_type", "product_id", "quantity", "from_location_id", "to_location_id", "inventory_status", "source_document_type", "source_document_id", "source_line_id", "purchase_order_line_id", "sales_order_line_id", "posted_at", "posted_by", "unit_cost_cents", "currency", "idempotency_key"], rows.movements,
  (item) => [item.id, item.movementType, item.productId, item.quantity, item.fromLocationId, item.toLocationId, item.inventoryStatus, item.sourceDocumentType, item.sourceDocumentId, item.sourceLineId, item.purchaseOrderLineId, item.salesOrderLineId, item.postedAt, item.postedBy, item.unitCostCents, "CAD", `seed-${item.id}`]);
insert("inventory_balances", ["product_id", "location_id", "on_hand_qty", "reserved_qty", "version"], rows.balances, (item) => [item.productId, item.locationId, item.onHand, item.reserved, 1]);
insert("cost_layers", ["id", "product_id", "receipt_movement_id", "received_qty", "remaining_qty", "unit_cost_cents", "landed_cost_cents", "received_at", "status"], rows.costLayers, (item) => [item.id, item.productId, item.receiptMovementId, item.receivedQty, item.remainingQty, item.unitCostCents, 0, item.receivedAt, item.status]);
insert("inventory_value_entries", ["id", "product_id", "movement_id", "entry_type", "quantity", "unit_cost_cents", "value_cents", "cost_method", "reference_type", "reference_id", "posted_at", "posted_by"], rows.valueEntries,
  (item) => [item.id, item.productId, item.movementId, item.entryType, item.quantity, item.unitCostCents, item.valueCents, item.costMethod, item.referenceType, item.referenceId, item.postedAt, item.postedBy]);
insert("customer_invoices", ["id", "number", "customer_id", "sales_order_id", "status", "invoice_date", "due_date", "subtotal_cents", "tax_cents", "total_cents", "paid_cents", "currency", "exchange_rate_to_base", "base_total_cents", "tax_rate_bps", "tax_code", "payment_terms", "posted_at", "posted_by", "version"], rows.customerInvoices,
  (item) => [item.id, item.number, item.customerId, item.salesOrderId, item.status, item.invoiceDate, item.dueDate, item.subtotalCents, item.taxCents, item.totalCents, item.paidCents, "CAD", 1, item.totalCents, item.taxRateBps, item.taxCode, item.paymentTerms, item.postedAt, item.postedBy, 1]);
insert("customer_invoice_lines", ["id", "customer_invoice_id", "sales_order_line_id", "product_id", "quantity", "unit_price_cents", "line_total_cents"], rows.customerInvoiceLines, (item) => [item.id, item.customerInvoiceId, item.salesOrderLineId, item.productId, item.quantity, item.unitPriceCents, item.lineTotalCents]);
insert("payments", ["id", "number", "direction", "partner_id", "document_type", "document_id", "amount_cents", "payment_date", "method", "reference", "posted_at", "posted_by", "currency", "exchange_rate_to_base", "base_amount_cents"], rows.payments,
  (item) => [item.id, item.number, item.direction, item.partnerId, item.documentType, item.documentId, item.amountCents, item.paymentDate, item.method, item.reference, item.postedAt, item.postedBy, "CAD", 1, item.amountCents]);
insert("vendor_bills", ["id", "number", "vendor_id", "purchase_order_id", "status", "match_status", "total_cents", "due_date", "currency", "version", "vendor_invoice_number", "invoice_date", "posted_at", "subtotal_cents", "tax_cents", "paid_cents", "hold_reason", "exchange_rate_to_base", "base_total_cents", "tax_rate_bps", "tax_code", "payment_terms"], rows.vendorBills,
  (item) => [item.id, item.number, item.vendorId, item.purchaseOrderId, item.status, item.matchStatus, item.totalCents, item.dueDate, "CAD", 1, item.vendorInvoiceNumber, item.invoiceDate, item.postedAt, item.subtotalCents, item.taxCents, item.paidCents, item.holdReason, 1, item.totalCents, item.taxRateBps, item.taxCode, item.paymentTerms]);
insert("vendor_bill_lines", ["id", "vendor_bill_id", "purchase_order_line_id", "product_id", "quantity", "unit_cost_cents", "line_total_cents", "match_status", "match_details_json"], rows.vendorBillLines, (item) => [item.id, item.vendorBillId, item.purchaseOrderLineId, item.productId, item.quantity, item.unitCostCents, item.lineTotalCents, item.matchStatus, "{}"]);
insert("price_lists", ["id", "code", "name", "currency", "priority", "active", "version", "created_at", "updated_at"], rows.priceLists, (item) => [item.id, item.code, item.name, "CAD", item.priority, 1, 1, now, now]);
insert("price_list_entries", ["id", "price_list_id", "product_id", "uom_id", "minimum_quantity", "unit_price_cents", "active", "version", "created_at", "updated_at"], rows.priceListEntries, (item) => [item.id, item.priceListId, item.productId, item.uomId, item.minimumQuantity, item.unitPriceCents, 1, 1, now, now]);
insert("price_list_assignments", ["id", "price_list_id", "partner_id", "priority", "active", "version", "created_at"], rows.priceListAssignments, (item) => [item.id, item.priceListId, item.partnerId, item.priority, 1, 1, now]);
insert("document_sequences", ["prefix", "next_value", "updated_at"], rows.sequences, (item) => [item.prefix, item.nextValue, now]);

// Audit trail. The activity feed and the audit timeline both read this table, so the
// seeded documents get the same trail the live commands would have written.
const auditEvents = [];
const auditFor = (entityType, entityId, action, summary, actor, createdAt) =>
  auditEvents.push({ id: `audit-${auditEvents.length + 1}`, entityType, entityId, action, summary, actor, createdAt });
for (const receipt of rows.receipts) {
  const po = rows.purchaseOrders.find((order) => order.id === receipt.purchaseOrderId);
  const units = rows.receiptLines.filter((line) => line.receiptId === receipt.id).reduce((total, line) => total + line.quantity, 0);
  auditFor("receipt", receipt.id, "receipt_posted", `${units} units received against ${po?.number ?? "a purchase order"}`, pick(["Sam Rivera", "Tyler Boucher", "Andre Cardinal"]), receipt.postedAt);
}
for (const shipment of rows.shipments) {
  const order = orders.find((item) => item.id === shipment.salesOrderId);
  const units = rows.shipmentLines.filter((line) => line.shipmentId === shipment.id).reduce((total, line) => total + line.quantity, 0);
  auditFor("shipment", shipment.id, "shipment_posted", `${units} units shipped to ${order?.customer.name ?? "a customer"}`, pick(["Nina Patel", "Tyler Boucher"]), shipment.postedAt);
}
for (const invoice of rows.customerInvoices) {
  auditFor("customer_invoice", invoice.id, "customer_invoice_posted", `${invoice.number} posted for ${money(invoice.totalCents)}`, invoice.postedBy, invoice.postedAt);
}
for (const bill of rows.vendorBills.filter((item) => item.status === "on_hold")) {
  auditFor("vendor_bill", bill.id, "match_exception", `Vendor price on ${bill.number} exceeds the approved purchase-order cost`, "System", bill.postedAt);
}
for (const payment of rows.payments) {
  auditFor("payment", payment.id, "payment_recorded", `${money(payment.amountCents)} received`, payment.postedBy, payment.postedAt);
}
// The feed only needs the recent tail; keeping the whole year would bloat the seed.
auditEvents.sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
insert("audit_events", ["id", "entity_type", "entity_id", "action", "summary", "actor", "metadata_json", "created_at"], auditEvents.slice(0, 600),
  (item) => [item.id, item.entityType, item.entityId, item.action, item.summary, item.actor, "{}", item.createdAt]);

// Windows ship on crates; one crate holds six units on the standard lines.
statements.push("INSERT INTO uom_conversions (id,product_id,from_uom_id,to_uom_id,numerator,denominator,rounding_mode) VALUES ('uomc-crate-each',NULL,'uom-crate','uom-each',6,1,'nearest');");

// Restore the append-only guarantees exactly as the migration defines them.
statements.push(
  "CREATE TRIGGER `stock_movements_immutable_update`\nBEFORE UPDATE ON `stock_movements`\nBEGIN SELECT RAISE(ABORT, 'stock movement ledger is immutable'); END;",
  "CREATE TRIGGER `stock_movements_immutable_delete`\nBEFORE DELETE ON `stock_movements`\nBEGIN SELECT RAISE(ABORT, 'stock movement ledger is immutable'); END;",
);

mkdirSync(outputDir, { recursive: true });
const sqlPath = join(outputDir, "seed-distributor.sql");
writeFileSync(sqlPath, statements.join("\n"), "utf8");

// ---------------------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------------------
const revenue = rows.customerInvoices.reduce((total, invoice) => total + invoice.subtotalCents, 0);
const receivable = rows.customerInvoices.reduce((total, invoice) => total + Math.max(invoice.totalCents - invoice.paidCents, 0), 0);
const inventoryValue = rows.costLayers.reduce((total, layer) => total + layer.remainingQty * layer.unitCostCents, 0);
const receivedPos = rows.purchaseOrders.filter((po) => po.received);
const inWindow = receivedPos.filter((po) => po.receiveDate >= daysAgo(365));
const purchases = inWindow.reduce((total, po) => total + po.totalCents, 0);
const openingStock = receivedPos.filter((po) => po.receiveDate < daysAgo(365)).reduce((total, po) => total + po.totalCents, 0);
const plyGemShare = inWindow.filter((po) => po.vendorId === "vendor-plygem").reduce((total, po) => total + po.totalCents, 0) / (purchases || 1);
const cogs = rows.valueEntries.filter((entry) => entry.entryType === "shipment").reduce((total, entry) => total - entry.valueCents, 0);

console.log("PaneFlow distributor seed");
console.log(`  Trailing-12-month revenue   ${money(revenue)}`);
console.log(`  Cost of goods sold          ${money(cogs)}  (gross margin ${(((revenue - cogs) / revenue) * 100).toFixed(1)}%)`);
console.log(`  Purchases, last 12 months   ${money(purchases)}  (Ply Gem ${(plyGemShare * 100).toFixed(1)}%)`);
console.log(`  Opening inventory build     ${money(openingStock)}  (dated before the window)`);
console.log(`  Inventory at cost           ${money(inventoryValue)}  (${(cogs / (inventoryValue || 1)).toFixed(1)} turns)`);
console.log(`  Accounts receivable         ${money(receivable)}  (DSO ${Math.round((receivable / (revenue * 1.05)) * 365)} days)`);
console.log(`  Customers ${customers.length} · Vendors ${vendors.length} · Products ${products.length} · Locations ${rows.locations.length}`);
console.log(`  Sales orders ${orders.length} · Purchase orders ${rows.purchaseOrders.length} · Movements ${rows.movements.length}`);
console.log(`  Invoices ${rows.customerInvoices.length} · Payments ${rows.payments.length} · Vendor bills ${rows.vendorBills.length}`);
console.log(`  SQL written to ${sqlPath} (${statements.length} statements)`);

if (process.argv.includes("--apply")) {
  console.log("Applying to the local D1 database…");
  execFileSync("npx", ["wrangler", "d1", "execute", "site-creator-d1", "--local", "--config", "wrangler.local.jsonc", "--file", sqlPath, "-y"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  console.log("Seed applied.");
}
