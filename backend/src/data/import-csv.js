/**
 * Import real PartSelect product data from scraped CSV files.
 * CSV contains product data scraped from partselect.com.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "products.json");
const PARTS_CSV = join(__dirname, "all_parts.csv");

function parseCSV(text) {
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h.trim()] = (values[i] || "").trim(); });
    return row;
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

function run() {
  if (!existsSync(PARTS_CSV)) {
    console.error("all_parts.csv not found at:", PARTS_CSV);
    console.error("Run npm run scrape first to generate the CSV data.");
    process.exit(1);
  }

  console.log("Loading CSV...");
  const csv = readFileSync(PARTS_CSV, "utf-8");
  const rows = parseCSV(csv);
  console.log(`Parsed ${rows.length} rows from CSV`);

  // Load existing DB to merge
  let db = { parts: {}, models: {}, metadata: {} };
  if (existsSync(DB_PATH)) {
    try { db = JSON.parse(readFileSync(DB_PATH, "utf-8")); } catch {}
  }

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const psNumber = row.part_id;
    if (!psNumber || !psNumber.startsWith("PS")) { skipped++; continue; }

    // Detect appliance type from TITLE (more reliable than CSV's appliance_types column)
    const titleLower = (row.part_name || "").toLowerCase();
    const csvType = (row.appliance_types || "").toLowerCase();
    let applianceType = "unknown";

    // Trust title first — "Dishwasher" in the name means dishwasher regardless of CSV column
    if (titleLower.includes("dishwasher") || titleLower.includes("dishrack") || titleLower.includes("dish rack")) {
      applianceType = "dishwasher";
    } else if (titleLower.includes("refrigerator") || titleLower.includes("fridge") || titleLower.includes("freezer") || titleLower.includes("ice maker") || titleLower.includes("crisper")) {
      applianceType = "refrigerator";
    } else if (csvType.includes("dishwasher")) {
      applianceType = "dishwasher";
    } else if (csvType.includes("refrigerator")) {
      applianceType = "refrigerator";
    }

    // Only import refrigerator and dishwasher parts
    if (applianceType === "unknown") { skipped++; continue; }

    // Don't overwrite existing seed data which has richer info
    if (db.parts[psNumber]) { skipped++; continue; }

    db.parts[psNumber] = {
      partSelectNumber: psNumber,
      manufacturerPartNumber: row.mpn_id || "",
      title: row.part_name || psNumber,
      description: "",
      price: row.part_price ? parseFloat(row.part_price) : null,
      inStock: (row.availability || "").includes("In Stock"),
      rating: null,
      reviewCount: null,
      brand: row.brand || "",
      applianceType,
      symptoms: row.symptoms ? row.symptoms.split(",").map(s => s.trim()).filter(Boolean) : [],
      compatibleModels: [],
      repairStories: [],
      installSteps: [],
      installDifficulty: row.install_difficulty || "",
      repairTime: row.install_time || "",
      installVideoUrl: (row.install_video_url || "").split("?")[0],
      replaces: row.replace_parts ? row.replace_parts.split(",").map(s => s.trim()).filter(Boolean) : [],
      imageUrl: "",
      videoUrls: row.install_video_url ? [row.install_video_url] : [],
      url: (row.product_url || `https://www.partselect.com/${psNumber}-Part.htm`).split("?")[0],
      scrapedAt: new Date().toISOString(),
      source: "csv-import",
    };
    imported++;
  }

  // Update metadata
  const refCount = Object.values(db.parts).filter(p => p.applianceType === "refrigerator").length;
  const dwCount = Object.values(db.parts).filter(p => p.applianceType === "dishwasher").length;

  db.metadata = {
    lastUpdated: new Date().toISOString(),
    totalParts: Object.keys(db.parts).length,
    totalModels: Object.keys(db.models).length,
    source: "csv-import+seed",
  };

  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

  console.log(`\n=== Import Complete ===`);
  console.log(`Imported: ${imported} new parts`);
  console.log(`Skipped: ${skipped} (duplicates, non-scope, or already in DB)`);
  console.log(`Total parts: ${Object.keys(db.parts).length} (${refCount} refrigerator, ${dwCount} dishwasher)`);
  console.log(`Total models: ${Object.keys(db.models).length}`);
  console.log(`Saved to: ${DB_PATH}`);
}

run();
