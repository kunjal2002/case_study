/**
 * PartSelect Product Scraper
 * Scrapes real product data from partselect.com and stores it in a local JSON database.
 * Covers both Refrigerator and Dishwasher categories with detailed product information.
 */
import * as cheerio from "cheerio";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Allow self-signed certs (PartSelect's certificate sometimes fails validation)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "products.json");

const PARTSELECT_BASE = "https://www.partselect.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHTML(url, timeout = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseProductPage(html, partNumber = "") {
  const $ = cheerio.load(html);

  const h1 = $("h1").first().text().trim().replace(/\s+/g, " ");
  if (!h1) return null;

  const mpnMatch = h1.match(/\b([A-Z0-9]{6,})\s*$/);
  const manufacturerPartNumber = mpnMatch ? mpnMatch[1] : "";
  const title = manufacturerPartNumber
    ? h1.replace(manufacturerPartNumber, "").trim()
    : h1;

  const priceText = $(".js-partPrice").first().text().trim();
  const priceMatch = priceText.match(/([0-9]+\.?[0-9]*)/);
  const price = priceMatch ? parseFloat(priceMatch[1]) : null;

  const inStock = html.includes("InStock") || html.includes("In Stock");
  const rating = $("[itemprop=ratingValue]").attr("content") || null;
  const reviewCount = $("[itemprop=reviewCount]").attr("content") || null;

  const description = $(".pd__description, .js-partDescription")
    .text()
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 800);

  // Symptoms / fixes
  const symptoms = [];
  $(".pd__symptoms-list li, .pd__symptom").each((_, el) => {
    const s = $(el).text().trim();
    if (s && s.length > 2) symptoms.push(s);
  });

  // Also scan for "Fixes these symptoms" sections
  const fixesText = html.match(
    /Fixes these symptoms[\s\S]*?(?=Installation|$)/i
  );
  if (fixesText) {
    const symptomMatches = fixesText[0].match(
      /(?:^|\n)\s*[-•]\s*(.+?)(?:\n|$)/g
    );
    if (symptomMatches) {
      symptomMatches.forEach((m) => {
        const s = m.replace(/[-•]\s*/, "").trim();
        if (s && !symptoms.includes(s)) symptoms.push(s);
      });
    }
  }

  // Installation / repair stories
  const repairStories = [];
  $(
    ".repair-story, .installation-instruction, .repair-instruction"
  ).each((_, e) => {
    const text = $(e).text().trim().replace(/\s+/g, " ");
    if (text.length > 20) repairStories.push(text.slice(0, 300));
  });

  // Compatible models
  const modelRegex = /\b([A-Z]{2,5}\d{4,}[A-Z0-9]{0,8})\b/g;
  const pageText = $("body").text();
  const allModels = [...new Set((pageText.match(modelRegex) || []))].filter(
    (m) => !m.startsWith("PS") && m.length >= 8 && m.length <= 20
  );

  // Appliance type — detect from title and description, not full page HTML
  // (full page always contains both terms in navigation)
  const titleAndDesc = `${title} ${description}`.toLowerCase();
  let applianceType = "unknown";
  const isDishwasher = /dishwasher|dishrack|spray arm|dish rack/i.test(titleAndDesc);
  const isRefrigerator = /refrigerator|fridge|freezer|ice maker|crisper|door shelf bin|door bin|evaporator|water filter|condenser/i.test(titleAndDesc);
  if (isDishwasher && !isRefrigerator) applianceType = "dishwasher";
  else if (isRefrigerator && !isDishwasher) applianceType = "refrigerator";
  else if (isDishwasher) applianceType = "dishwasher";
  else if (isRefrigerator) applianceType = "refrigerator";

  // Brand detection
  const brands = [
    "Whirlpool",
    "KitchenAid",
    "Maytag",
    "Amana",
    "Samsung",
    "LG",
    "GE",
    "Frigidaire",
    "Bosch",
    "Kenmore",
  ];
  const brand =
    brands.find((b) => lowerText.includes(b.toLowerCase())) || "";

  // Image
  const imageUrl =
    $(".pd__main-image img, img[itemprop=image]").first().attr("src") || "";

  // PS number
  const psNum =
    html.match(/PS\d{7,8}/i)?.[0]?.toUpperCase() || "";

  // Replaces parts
  const replacesRaw = html.match(
    /replaces these[\s\S]*?(?=Customer|Back to|$)/i
  );
  const replaces = replacesRaw
    ? [...new Set((replacesRaw[0].match(/[A-Z0-9]{6,}/g) || []))]
        .filter((p) => p !== psNum)
        .slice(0, 20)
    : [];

  // Video URLs — capture install video and repair video links
  const videoUrls = [];
  let installVideoUrl = "";
  let repairVideoUrl = "";
  $("a[href*=youtube], iframe[src*=youtube]").each((_, el) => {
    const url = $(el).attr("href") || $(el).attr("src") || "";
    if (url) {
      videoUrls.push(url);
      if (!installVideoUrl) installVideoUrl = url;
    }
  });
  // Also check for video links near "Part Videos" section
  $("a:contains('Watch'), a:contains('Video'), a:contains('Install')").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (href.includes("youtube") || href.includes("youtu.be")) {
      if (!repairVideoUrl) repairVideoUrl = href;
    }
  });

  // PartSelect product URL
  const productUrl = psNum
    ? `https://www.partselect.com/${psNum}-Part.htm`
    : "";

  return {
    partSelectNumber: psNum,
    manufacturerPartNumber,
    title: title || `Part ${psNum}`,
    description,
    price,
    inStock,
    rating: rating ? parseFloat(rating) : null,
    reviewCount: reviewCount ? parseInt(reviewCount) : null,
    brand,
    applianceType,
    symptoms: [...new Set(symptoms)].slice(0, 10),
    compatibleModels: allModels.slice(0, 50),
    repairStories: repairStories.slice(0, 5),
    replaces,
    imageUrl: imageUrl.startsWith("http")
      ? imageUrl
      : imageUrl
      ? `${PARTSELECT_BASE}${imageUrl}`
      : "",
    videoUrls: videoUrls.slice(0, 3),
    installVideoUrl,
    repairVideoUrl,
    url: productUrl || (psNum ? `${PARTSELECT_BASE}/${psNum}-Part.htm` : ""),
    scrapedAt: new Date().toISOString(),
  };
}

// Well-known popular parts for Refrigerators and Dishwashers
const SEED_PART_NUMBERS = [
  // Refrigerator parts
  "PS11752778", // Door Shelf Bin
  "PS11739120", // Ice Maker Assembly
  "PS11750470", // Water Filter
  "PS12364199", // Evaporator Fan Motor
  "PS11739091", // Door Shelf Bin (white)
  "PS11749756", // Water Inlet Valve
  "PS11773741", // Light Bulb
  "PS11757023", // Crisper Drawer
  "PS11752778", // Door Bin (duplicate, will be deduped)
  "PS11752309", // Upper Door Bin
  "PS11750093", // Dishrack Adjuster Arm
  "PS11743427", // Defrost Timer
  "PS11748914", // Thermostat
  "PS11752927", // Door Shelf Retainer Bar
  "PS12076076", // Compressor Start Relay
  "PS11750694", // Condenser Fan Motor
  "PS11749827", // Door Gasket
  "PS11751667", // Water Dispenser Actuator

  // Dishwasher parts
  "PS11752776", // Door Balance Link Kit
  "PS11722152", // Upper Rack Adjuster
  "PS11749821", // Spray Arm Assembly
  "PS3406971",  // Lower Dishrack Wheel
  "PS10065979", // Upper Rack Adjuster Kit
  "PS11746591", // Rack Track Stop
  "PS11756150", // Upper Rack Adjuster
  "PS11750057", // Lower Dishrack Wheel Assembly
  "PS12585623", // Lower Spray Arm
  "PS8260087",  // Heating Element
  "PS8727387",  // Dishrack Roller
  "PS972325",   // Door Balance Link Kit
  "PS11745496", // Mounting Bracket
  "PS11753379", // Drain Pump
  "PS11755592", // Lower Spray Arm
  "PS11759673", // Dishwasher Filter
  "PS12348515", // Door Seal
  "PS11756967", // Door Latch
  "PS9494999",  // Heating Element (alt)
  "PS11750092", // Dishrack Adjuster
  "PS16217024", // Lower Rack Roller
  "PS17137081", // Lower Spray Arm (GE)
];

const SEED_MODEL_URLS = [
  "WDT780SAEM1",
  "WRS325SDHZ08",
  "WRF555SDFZ11",
  "WRX735SDHZ04",
  "WRS571CIHZ01",
  "KDTM354DSS4",
  "WDF520PADM7",
  "WDT750SAHZ0",
];

async function scrapePartPage(partNumber) {
  // Strategy: Use PartSelect's part number search which redirects to the product page
  // This is the most reliable approach since URL slugs are unpredictable
  
  // Try the direct part-number URL pattern first (fastest)
  const directUrl = `${PARTSELECT_BASE}/${partNumber}-Part.htm`;
  try {
    const html = await fetchHTML(directUrl, 20000);
    const data = parseProductPage(html, partNumber);
    if (data && data.title && data.title !== `Part ${partNumber}`) {
      data.partSelectNumber = data.partSelectNumber || partNumber;
      return data;
    }
  } catch {
    // URL might not exist in this format, try search
  }

  // Fallback: search for the part number
  const searchUrl = `${PARTSELECT_BASE}/Search.aspx?SearchTerm=${encodeURIComponent(partNumber)}`;
  try {
    const searchHtml = await fetchHTML(searchUrl, 25000);
    
    // Search might redirect to product page
    const directResult = parseProductPage(searchHtml, partNumber);
    if (directResult && directResult.title && directResult.title !== `Part ${partNumber}`) {
      directResult.partSelectNumber = directResult.partSelectNumber || partNumber;
      return directResult;
    }
    
    // Parse search results for link to this part
    const $ = cheerio.load(searchHtml);
    let partUrl = null;
    
    $(`a[href*="${partNumber}"]`).each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href.includes(partNumber) && href.endsWith(".htm")) {
        partUrl = href.startsWith("http") ? href : `${PARTSELECT_BASE}${href}`;
        return false;
      }
    });
    
    if (partUrl) {
      const partHtml = await fetchHTML(partUrl, 20000);
      const data = parseProductPage(partHtml, partNumber);
      if (data && data.title) {
        data.partSelectNumber = data.partSelectNumber || partNumber;
        return data;
      }
    }
  } catch {
    // Search also failed
  }

  return null;
}

async function scrapeModelPage(modelNumber) {
  const url = `${PARTSELECT_BASE}/Models/${modelNumber}/Parts/`;
  try {
    const html = await fetchHTML(url, 25000);
    const $ = cheerio.load(html);

    const parts = [];
    const seen = new Set();

    $("a[href*='/PS']").each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim().replace(/\s+/g, " ");
      const psMatch = href.match(/(PS\d{7,8})/i);

      if (psMatch && text.length > 4 && !seen.has(psMatch[1].toUpperCase())) {
        const pn = psMatch[1].toUpperCase();
        seen.add(pn);

        const parent = $(el).closest("li, article, div");
        const priceText = parent.find(".price, .js-partPrice").text() || "";
        const priceMatch = priceText.match(/([0-9]+\.[0-9]{2})/);

        parts.push({
          partNumber: pn,
          title: text.slice(0, 120),
          price: priceMatch ? parseFloat(priceMatch[1]) : null,
          url: href.startsWith("http") ? href : `${PARTSELECT_BASE}${href}`,
        });
      }
    });

    return { modelNumber, parts: parts.slice(0, 30) };
  } catch (e) {
    console.error(`  Failed to scrape model ${modelNumber}: ${e.message}`);
    return { modelNumber, parts: [] };
  }
}

export async function runScraper() {
  console.log("=== PartSelect Product Scraper ===\n");

  const db = {
    parts: {},
    models: {},
    metadata: { lastUpdated: null, totalParts: 0, totalModels: 0 },
  };

  // Load existing DB if available
  if (existsSync(DB_PATH)) {
    try {
      const existing = JSON.parse(readFileSync(DB_PATH, "utf-8"));
      Object.assign(db, existing);
      console.log(
        `Loaded existing DB: ${Object.keys(db.parts).length} parts, ${Object.keys(db.models).length} models\n`
      );
    } catch (_) {}
  }

  // Deduplicate seed part numbers
  const uniqueParts = [...new Set(SEED_PART_NUMBERS)];

  // Scrape individual parts
  console.log(`Scraping ${uniqueParts.length} part pages...\n`);
  let scraped = 0;
  for (const pn of uniqueParts) {
    if (db.parts[pn] && Date.now() - new Date(db.parts[pn].scrapedAt).getTime() < 24 * 60 * 60 * 1000) {
      console.log(`  [SKIP] ${pn} (cached)`);
      continue;
    }

    try {
      const data = await scrapePartPage(pn);
      if (data) {
        db.parts[data.partSelectNumber || pn] = data;
        scraped++;
        console.log(`  [OK]   ${data.partSelectNumber || pn}: ${data.title} - $${data.price}`);
      } else {
        console.log(`  [MISS] ${pn}: not found`);
      }
    } catch (e) {
      console.log(`  [ERR]  ${pn}: ${e.message}`);
    }
    await delay(800 + Math.random() * 400);
  }

  // Scrape model pages for additional part numbers
  console.log(`\nScraping ${SEED_MODEL_URLS.length} model pages...\n`);
  for (const model of SEED_MODEL_URLS) {
    try {
      const modelData = await scrapeModelPage(model);
      db.models[model] = {
        modelNumber: model,
        partNumbers: modelData.parts.map((p) => p.partNumber),
        parts: modelData.parts,
        scrapedAt: new Date().toISOString(),
      };
      console.log(`  [OK]   ${model}: ${modelData.parts.length} parts found`);

      // Scrape new part numbers we haven't seen
      for (const part of modelData.parts.slice(0, 5)) {
        if (!db.parts[part.partNumber]) {
          await delay(600 + Math.random() * 400);
          try {
            const partData = await scrapePartPage(part.partNumber);
            if (partData) {
              db.parts[partData.partSelectNumber || part.partNumber] = partData;
              scraped++;
              console.log(`    [OK]   ${part.partNumber}: ${partData.title}`);
            }
          } catch (_) {}
        }
      }
    } catch (e) {
      console.log(`  [ERR]  ${model}: ${e.message}`);
    }
    await delay(1000 + Math.random() * 500);
  }

  // Update metadata
  db.metadata = {
    lastUpdated: new Date().toISOString(),
    totalParts: Object.keys(db.parts).length,
    totalModels: Object.keys(db.models).length,
    scrapedThisRun: scraped,
  };

  // Write to file
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  console.log(
    `\n=== Done! ${db.metadata.totalParts} parts, ${db.metadata.totalModels} models saved to products.json ===`
  );
  return db;
}

// Export for use in other modules
export function loadProductDB() {
  if (!existsSync(DB_PATH)) {
    return { parts: {}, models: {}, metadata: {} };
  }
  return JSON.parse(readFileSync(DB_PATH, "utf-8"));
}
