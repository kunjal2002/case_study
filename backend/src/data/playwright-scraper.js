/**
 * Playwright-based PartSelect Scraper
 * 
 * Advantages over Cheerio:
 *  - Handles JavaScript-rendered content
 *  - Bypasses 403 blocks with real browser fingerprint
 *  - Built-in throttling and retry logic
 *  - Stealth mode for anti-bot detection
 */
import { chromium } from "playwright";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "products.json");
const PARTSELECT_BASE = "https://www.partselect.com";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let browser = null;
let context = null;

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
    });
  }
  return context;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
  }
}

async function scrapePartPage(partNumber, retries = 2) {
  const ctx = await getBrowser();
  const page = await ctx.newPage();

  try {
    const url = `${PARTSELECT_BASE}/${partNumber}-Part.htm`;
    console.log(`  Navigating to: ${url}`);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("h1", { timeout: 10000 }).catch(() => {});

    // Extract data using Playwright's built-in selectors
    const data = await page.evaluate((psBase) => {
      const h1 = document.querySelector("h1");
      if (!h1) return null;

      const h1Text = h1.textContent.trim().replace(/\s+/g, " ");
      const mpnMatch = h1Text.match(/\b([A-Z0-9]{6,})\s*$/);
      const manufacturerPartNumber = mpnMatch ? mpnMatch[1] : "";
      const title = manufacturerPartNumber
        ? h1Text.replace(manufacturerPartNumber, "").trim()
        : h1Text;

      // Price
      const priceEl = document.querySelector(".js-partPrice");
      const priceMatch = priceEl?.textContent?.match(/([0-9]+\.?[0-9]*)/);
      const price = priceMatch ? parseFloat(priceMatch[1]) : null;

      // Stock
      const inStock =
        document.body.innerHTML.includes("InStock") ||
        document.body.innerHTML.includes("In Stock");

      // Rating
      const ratingEl = document.querySelector("[itemprop=ratingValue]");
      const rating = ratingEl ? parseFloat(ratingEl.getAttribute("content")) : null;

      const reviewCountEl = document.querySelector("[itemprop=reviewCount]");
      const reviewCount = reviewCountEl ? parseInt(reviewCountEl.getAttribute("content")) : null;

      // Description
      const descEl = document.querySelector(".pd__description, .js-partDescription");
      const description = descEl
        ? descEl.textContent.trim().replace(/\s+/g, " ").slice(0, 800)
        : "";

      // Symptoms
      const symptoms = [];
      document.querySelectorAll(".pd__symptoms-list li, .pd__symptom").forEach((el) => {
        const s = el.textContent.trim();
        if (s && s.length > 2) symptoms.push(s);
      });

      // Repair stories
      const repairStories = [];
      document
        .querySelectorAll(".repair-story, .installation-instruction")
        .forEach((el) => {
          const text = el.textContent.trim().replace(/\s+/g, " ");
          if (text.length > 20) repairStories.push(text.slice(0, 300));
        });

      // Compatible models
      const modelRegex = /\b([A-Z]{2,5}\d{4,}[A-Z0-9]{0,8})\b/g;
      const pageText = document.body.textContent;
      const allModels = [...new Set((pageText.match(modelRegex) || []))].filter(
        (m) => !m.startsWith("PS") && m.length >= 8 && m.length <= 20
      );

      // Appliance type from title/desc
      const titleAndDesc = `${title} ${description}`.toLowerCase();
      const isDishwasher = /dishwasher|dishrack|spray arm/.test(titleAndDesc);
      const isRefrigerator = /refrigerator|fridge|freezer|ice maker|crisper|door shelf|door bin|evaporator|water filter/.test(titleAndDesc);
      let applianceType = "unknown";
      if (isDishwasher && !isRefrigerator) applianceType = "dishwasher";
      else if (isRefrigerator) applianceType = "refrigerator";
      else if (isDishwasher) applianceType = "dishwasher";

      // Brand
      const brands = ["Whirlpool", "KitchenAid", "Maytag", "Amana", "Samsung", "LG", "GE", "Frigidaire", "Bosch", "Kenmore"];
      const brand = brands.find((b) => pageText.toLowerCase().includes(b.toLowerCase())) || "";

      // Image
      const imgEl = document.querySelector(".pd__main-image img, img[itemprop=image]");
      const imageUrl = imgEl?.src || "";

      // PS number from page
      const psMatch = document.body.innerHTML.match(/PS\d{7,8}/i);
      const psNum = psMatch ? psMatch[0].toUpperCase() : "";

      return {
        partSelectNumber: psNum,
        manufacturerPartNumber,
        title: title || "",
        description,
        price,
        inStock,
        rating,
        reviewCount,
        brand,
        applianceType,
        symptoms: [...new Set(symptoms)].slice(0, 10),
        compatibleModels: allModels.slice(0, 50),
        repairStories: repairStories.slice(0, 5),
        imageUrl: imageUrl.startsWith("http") ? imageUrl : imageUrl ? `${psBase}${imageUrl}` : "",
        url: window.location.href,
      };
    }, PARTSELECT_BASE);

    await page.close();

    if (data && data.title) {
      data.partSelectNumber = data.partSelectNumber || partNumber;
      data.scrapedAt = new Date().toISOString();
      return data;
    }
    return null;
  } catch (err) {
    await page.close().catch(() => {});

    if (retries > 0) {
      console.log(`    Retrying ${partNumber} (${retries} left)...`);
      await delay(2000);
      return scrapePartPage(partNumber, retries - 1);
    }

    console.error(`    Failed: ${partNumber}: ${err.message}`);
    return null;
  }
}

async function scrapeModelPage(modelNumber) {
  const ctx = await getBrowser();
  const page = await ctx.newPage();

  try {
    const url = `${PARTSELECT_BASE}/Models/${modelNumber}/Parts/`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await delay(2000);

    const parts = await page.evaluate((psBase) => {
      const results = [];
      const seen = new Set();

      document.querySelectorAll("a[href*='/PS']").forEach((el) => {
        if (results.length >= 20) return;
        const href = el.getAttribute("href") || "";
        const text = el.textContent.trim().replace(/\s+/g, " ");
        const psMatch = href.match(/(PS\d{7,8})/i);

        if (psMatch && text.length > 4 && !seen.has(psMatch[1].toUpperCase())) {
          const pn = psMatch[1].toUpperCase();
          seen.add(pn);

          const parent = el.closest("li, article, div");
          const priceText = parent?.querySelector(".price, .js-partPrice")?.textContent || "";
          const priceMatch = priceText.match(/([0-9]+\.[0-9]{2})/);

          results.push({
            partNumber: pn,
            title: text.slice(0, 120),
            price: priceMatch ? parseFloat(priceMatch[1]) : null,
            url: href.startsWith("http") ? href : `${psBase}${href}`,
          });
        }
      });
      return results;
    }, PARTSELECT_BASE);

    await page.close();
    return { modelNumber, parts };
  } catch (err) {
    await page.close().catch(() => {});
    console.error(`  Model ${modelNumber} failed: ${err.message}`);
    return { modelNumber, parts: [] };
  }
}

// Part numbers to scrape
const SEED_PARTS = [
  "PS11752778", "PS11739120", "PS11750470", "PS12364199",
  "PS11739091", "PS11749756", "PS11752309", "PS12076076",
  "PS11749827", "PS11750694", "PS11751667",
  "PS3406971", "PS10065979", "PS11746591", "PS972325",
  "PS11753379", "PS11755592", "PS9494999", "PS11759673",
  "PS12348515", "PS11756967", "PS11750057", "PS12585623",
  "PS8727387", "PS11750092", "PS16217024", "PS17137081",
  "PS11745496", "PS11756150", "PS8260087",
];

const SEED_MODELS = [
  "WDT780SAEM1", "WRS325SDHZ08", "WRF555SDFZ11",
  "WRX735SDHZ04", "KDTM354DSS4", "WDF520PADM7",
];

export async function runPlaywrightScraper() {
  console.log("=== PartSelect Playwright Scraper ===\n");

  // Install browsers if needed
  try {
    await getBrowser();
  } catch {
    console.log("Installing Playwright browsers...");
    const { execSync } = await import("child_process");
    execSync("npx playwright install chromium", { stdio: "inherit" });
    await getBrowser();
  }

  const db = { parts: {}, models: {}, metadata: {} };

  // Load existing
  if (existsSync(DB_PATH)) {
    try {
      Object.assign(db, JSON.parse(readFileSync(DB_PATH, "utf-8")));
    } catch {}
  }

  // Scrape parts
  console.log(`Scraping ${SEED_PARTS.length} parts...\n`);
  let scraped = 0;
  for (const pn of SEED_PARTS) {
    if (db.parts[pn]) {
      console.log(`  [SKIP] ${pn} (cached)`);
      continue;
    }

    const data = await scrapePartPage(pn);
    if (data && data.title) {
      db.parts[data.partSelectNumber || pn] = data;
      scraped++;
      console.log(`  [OK]   ${data.partSelectNumber || pn}: ${data.title} - $${data.price}`);
    } else {
      console.log(`  [MISS] ${pn}`);
    }
    await delay(1500 + Math.random() * 1000);
  }

  // Scrape models
  console.log(`\nScraping ${SEED_MODELS.length} models...\n`);
  for (const model of SEED_MODELS) {
    const modelData = await scrapeModelPage(model);
    db.models[model] = {
      modelNumber: model,
      partNumbers: modelData.parts.map((p) => p.partNumber),
      parts: modelData.parts,
      scrapedAt: new Date().toISOString(),
    };
    console.log(`  [OK]   ${model}: ${modelData.parts.length} parts`);
    await delay(2000);
  }

  db.metadata = {
    lastUpdated: new Date().toISOString(),
    totalParts: Object.keys(db.parts).length,
    totalModels: Object.keys(db.models).length,
    scraper: "playwright",
    scrapedThisRun: scraped,
  };

  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  console.log(`\n=== Done! ${db.metadata.totalParts} parts, ${db.metadata.totalModels} models ===`);

  await closeBrowser();
  return db;
}
