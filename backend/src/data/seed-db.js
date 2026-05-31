/**
 * Seed Database — merges models into existing DB.
 * NO product data — all products come from CSV import or live scraping.
 * Model data comes from previously scraped model pages.
 */
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "products.json");

function buildDB() {
  let db = { parts: {}, models: {}, metadata: {} };
  if (existsSync(DB_PATH)) {
    try { db = JSON.parse(readFileSync(DB_PATH, "utf-8")); } catch {}
  }

  // Only add models if they don't exist yet — these are just part number lists
  // Actual part details come from the CSV database, not hardcoded here
  const defaultModels = {
    WDT780SAEM1: { modelNumber: "WDT780SAEM1", brand: "Whirlpool", type: "Dishwasher",
      partNumbers: ["PS3406971", "PS10065979", "PS11746591", "PS972325", "PS11753379", "PS11755592", "PS9494999", "PS11759673", "PS12348515", "PS11756967", "PS11750092"] },
    KDTM354DSS4: { modelNumber: "KDTM354DSS4", brand: "KitchenAid", type: "Dishwasher",
      partNumbers: ["PS3406971", "PS10065979", "PS11746591", "PS11753379", "PS11755592", "PS9494999", "PS11759673", "PS11756967"] },
  };

  for (const [key, val] of Object.entries(defaultModels)) {
    if (!db.models[key]) {
      // Build parts list from actual DB entries
      const parts = val.partNumbers
        .map(pn => {
          const p = db.parts[pn];
          return p ? { partNumber: pn, title: p.title, price: p.price, url: p.url } : null;
        })
        .filter(Boolean);
      db.models[key] = { ...val, parts, scrapedAt: new Date().toISOString() };
    }
  }

  db.metadata = {
    lastUpdated: new Date().toISOString(),
    totalParts: Object.keys(db.parts).length,
    totalModels: Object.keys(db.models).length,
    source: "csv-import",
  };

  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

  const refCount = Object.values(db.parts).filter(p => p.applianceType === "refrigerator").length;
  const dwCount = Object.values(db.parts).filter(p => p.applianceType === "dishwasher").length;
  console.log(`Database: ${db.metadata.totalParts} parts (${refCount} refrigerator, ${dwCount} dishwasher), ${db.metadata.totalModels} models`);
}

buildDB();
