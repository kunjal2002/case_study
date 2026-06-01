/**
 * PartSelect Data Service - Fetches live product data from partselect.com
 * Uses Cheerio for HTML parsing (lightweight, no browser needed).
 */
import * as cheerio from "cheerio";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const PARTSELECT_BASE = "https://www.partselect.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const REQUEST_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity"
};

// Simple in-memory cache with TTL
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

async function fetchHTML(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  // Rotate user agents to reduce blocking
  const agents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  ];
  const headers = {
    ...REQUEST_HEADERS,
    "User-Agent": agents[Math.floor(Math.random() * agents.length)],
  };

  try {
    const response = await fetch(url, {
      headers,
      redirect: "follow",
      signal: controller.signal
    });
    if (response.status === 403) {
      throw new Error(`BLOCKED_403: PartSelect returned 403 for ${url}`);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch part details by part number from PartSelect
 */
export async function fetchPartByNumber(partNumber) {
  const normalized = partNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const cacheKey = `part:${normalized}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    // Try direct PS# URL pattern first (works for PS numbers)
    const directUrl = `${PARTSELECT_BASE}/${normalized}-Part.htm`;
    try {
      const html = await fetchHTML(directUrl);
      const result = parseProductPage(html, normalized);
      if (result && result.title) {
        setCache(cacheKey, result);
        return result;
      }
    } catch (_) {
      // Direct URL failed — try search
    }

    // Search fallback — works for MPNs, partial numbers, names
    try {
      const searchUrl = `${PARTSELECT_BASE}/Search.aspx?SearchTerm=${encodeURIComponent(normalized)}`;
      const html = await fetchHTML(searchUrl, 20000);

      // Check if search redirected to a product page
      const result = parseProductPage(html, normalized);
      if (result && result.title) {
        setCache(cacheKey, result);
        return result;
      }

      // Parse search results to find the first matching part
      const $ = cheerio.load(html);
      let partUrl = null;
      $("a[href*='/PS']").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (href.includes("/PS") && href.endsWith(".htm") && !partUrl) {
          partUrl = href.startsWith("http") ? href : `${PARTSELECT_BASE}${href}`;
        }
      });

      if (partUrl) {
        const partHtml = await fetchHTML(partUrl, 15000);
        const partResult = parseProductPage(partHtml, normalized);
        if (partResult && partResult.title) {
          setCache(cacheKey, partResult);
          return partResult;
        }
      }
    } catch (_) {
      // Search also failed
    }

    return null;
  } catch (error) {
    console.error(`[Scraper] Error fetching part ${partNumber}:`, error.message);
    return null;
  }
}

/**
 * Parse a PartSelect product page HTML
 */
function parseProductPage(html, partNumber) {
  const $ = cheerio.load(html);

  // Title from h1
  const h1Text = $("h1").first().text().trim().replace(/\s+/g, " ");
  if (!h1Text) return null;

  // Remove MPN from title to get clean product name
  const mpnMatch = h1Text.match(/\b([A-Z0-9]{6,})\s*$/);
  const manufacturerPartNumber = mpnMatch ? mpnMatch[1] : "";
  const title = manufacturerPartNumber
    ? h1Text.replace(manufacturerPartNumber, "").trim()
    : h1Text;

  // Price from .js-partPrice
  const priceText = $(".js-partPrice").first().text().trim();
  const priceMatch = priceText.match(/([0-9]+\.?[0-9]*)/);
  const price = priceMatch ? parseFloat(priceMatch[1]) : null;

  // Stock status
  const inStock = html.includes("InStock") || html.includes("In Stock");

  // Rating
  const rating = $("[itemprop=ratingValue]").attr("content") || null;

  // Description
  const description = $(".pd__description").text().trim().replace(/\s+/g, " ").slice(0, 600);

  // Repair stories (user installation experiences)
  const repairStories = $(".repair-story")
    .map((_, e) => $(e).text().trim().replace(/\s+/g, " ").slice(0, 200))
    .get()
    .slice(0, 5);

  // Build installation guide from repair stories and description
  const installationGuide = buildInstallGuide(description, repairStories, title);

  // Symptoms/fixes from page
  const symptomsText = $("h3:contains('fixes the following'), .pd__symptoms-list")
    .next()
    .text()
    .trim();
  const symptoms = symptomsText
    ? symptomsText.split(/\n|,/).map((s) => s.trim()).filter(Boolean).slice(0, 8)
    : [];

  // Compatible models - extract from full page text
  const modelRegex = /\b([A-Z]{2,5}\d{4,}[A-Z0-9]{0,8})\b/g;
  const pageText = $("body").text();
  const allModelsRaw = [...new Set((pageText.match(modelRegex) || []))];
  const compatibleModels = allModelsRaw
    .filter((m) => !m.startsWith("PS") && m.length >= 8 && m.length <= 20)
    .slice(0, 30);

  // Appliance type — detect from title/description, not full page
  const titleAndDesc = `${title} ${description}`.toLowerCase();
  let applianceType = "unknown";
  const isDishwasher = /dishwasher|dishrack|spray arm|dish rack/i.test(titleAndDesc);
  const isRefrigerator = /refrigerator|fridge|freezer|ice maker|crisper|door shelf|door bin|evaporator|water filter|condenser/i.test(titleAndDesc);
  if (isDishwasher && !isRefrigerator) applianceType = "dishwasher";
  else if (isRefrigerator && !isDishwasher) applianceType = "refrigerator";
  else if (isDishwasher) applianceType = "dishwasher";
  else if (isRefrigerator) applianceType = "refrigerator";

  // Image
  const imageUrl = $(".pd__main-image img, img[itemprop=image]").first().attr("src") || "";

  // PartSelect part number from page
  const psFromPage = html.match(/PS\d{7,8}/i)?.[0]?.toUpperCase() || partNumber;

  // Extract REAL YouTube video IDs from thumbnail URLs on the page
  // PartSelect uses: https://img.youtube.com/vi/{VIDEO_ID}/maxresdefault.jpg
  const videoIds = new Set();
  const ytThumbRegex = /img\.youtube\.com\/vi\/([A-Za-z0-9_-]{11})\//g;
  let ytMatch;
  while ((ytMatch = ytThumbRegex.exec(html)) !== null) {
    videoIds.add(ytMatch[1]);
  }
  const installVideoUrl = videoIds.size > 0
    ? `https://www.youtube.com/watch?v=${[...videoIds][0]}`
    : "";
  const videoUrls = [...videoIds].map((id) => `https://www.youtube.com/watch?v=${id}`);

  return {
    source: "partselect-live",
    partNumber: psFromPage,
    partSelectNumber: psFromPage,
    manufacturerPartNumber,
    title: title || `Part ${partNumber}`,
    description,
    price,
    inStock,
    stockStatus: inStock ? "In Stock" : "Check availability",
    rating: rating ? parseFloat(rating) : null,
    brand: detectBrand(html),
    applianceType,
    installationGuide,
    repairStories,
    symptoms,
    compatibleModels,
    imageUrl: imageUrl.startsWith("http") ? imageUrl : imageUrl ? `${PARTSELECT_BASE}${imageUrl}` : "",
    installVideoUrl,
    videoUrls,
    url: `${PARTSELECT_BASE}/${psFromPage}-Part.htm`
  };
}

function detectBrand(html) {
  const lower = html.toLowerCase();
  const brands = ["Whirlpool", "KitchenAid", "Maytag", "Amana", "Samsung", "LG", "GE", "Frigidaire", "Bosch", "Kenmore"];
  for (const brand of brands) {
    if (lower.includes(brand.toLowerCase())) return brand;
  }
  return "";
}

function buildInstallGuide(description, repairStories, title) {
  const parts = [];

  // Check if description mentions installation
  if (/install|snap|replace|remove/i.test(description)) {
    parts.push(description);
  }

  // Extract useful install info from repair stories
  const installStories = repairStories
    .filter((s) => /install|replace|remove|tool|screw|snap|pop|pull|push|easy|minute/i.test(s))
    .map((s) => s.slice(0, 200));

  if (installStories.length > 0) {
    parts.push("\n\n**Customer installation experiences:**\n" + installStories.map((s) => `- ${s}`).join("\n"));
  }

  if (parts.length === 0) {
    return `For detailed installation instructions for ${title}, visit the product page on PartSelect.com. Always disconnect power before beginning any repair.`;
  }

  return parts.join("\n\n");
}

/**
 * Fetch parts compatible with a model number
 */
export async function fetchPartsByModel(modelNumber) {
  const normalized = modelNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const cacheKey = `model:${normalized}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    // Use search to find parts for a model
    const searchUrl = `${PARTSELECT_BASE}/Models/${normalized}/Parts/`;
    let html;
    try {
      html = await fetchHTML(searchUrl, 20000);
    } catch (_) {
      // Try search as fallback
      const altUrl = `${PARTSELECT_BASE}/Search.aspx?SearchTerm=${encodeURIComponent(normalized)}`;
      html = await fetchHTML(altUrl, 20000);
    }

    const $ = cheerio.load(html);

    // Extract parts from links
    const parts = [];
    const seen = new Set();

    $("a[href*='/PS']").each((_, el) => {
      if (parts.length >= 12) return false;
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim().replace(/\s+/g, " ");
      const psMatch = href.match(/(PS\d{7,8})/i);

      if (psMatch && text && text.length > 4 && !seen.has(psMatch[1].toUpperCase())) {
        const pn = psMatch[1].toUpperCase();
        seen.add(pn);

        // Try to find price near this element
        const parent = $(el).closest("li, article, div, .part, .mega-m__part");
        const priceText = parent.find(".price, .js-partPrice").text() || "";
        const priceMatch = priceText.match(/([0-9]+\.[0-9]{2})/);

        parts.push({
          partNumber: pn,
          title: text.slice(0, 100),
          price: priceMatch ? parseFloat(priceMatch[1]) : null,
          url: href.startsWith("http") ? href : `${PARTSELECT_BASE}${href}`,
          fitment: `Compatible with ${normalized}`
        });
      }
    });

    const result = {
      source: "partselect-live",
      modelNumber: normalized,
      parts,
      totalFound: parts.length
    };

    if (result.parts.length > 0) {
      setCache(cacheKey, result);
    }
    return result;
  } catch (error) {
    console.error(`[Scraper] Error fetching model ${modelNumber}:`, error.message);
    return { source: "error", modelNumber: normalized, parts: [], error: error.message };
  }
}

/**
 * Search parts by keyword on PartSelect
 */
export async function searchPartsByKeyword(keyword, applianceType = null) {
  const cacheKey = `search:${keyword}:${applianceType || "all"}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    let searchQuery = keyword;
    if (applianceType) searchQuery = `${applianceType} ${keyword}`;

    const searchUrl = `${PARTSELECT_BASE}/Search.aspx?SearchTerm=${encodeURIComponent(searchQuery)}`;
    const html = await fetchHTML(searchUrl);
    const $ = cheerio.load(html);

    const parts = [];
    const seen = new Set();

    $("a[href*='/PS']").each((_, el) => {
      if (parts.length >= 8) return false;
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim().replace(/\s+/g, " ");
      const psMatch = href.match(/(PS\d{7,8})/i);

      if (psMatch && text && text.length > 5 && !seen.has(psMatch[1].toUpperCase())) {
        const pn = psMatch[1].toUpperCase();
        seen.add(pn);
        parts.push({
          partNumber: pn,
          title: text.slice(0, 120),
          price: null,
          url: href.startsWith("http") ? href : `${PARTSELECT_BASE}${href}`
        });
      }
    });

    const result = { source: "partselect-search", keyword, applianceType, parts };
    if (parts.length > 0) setCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error(`[Scraper] Error searching "${keyword}":`, error.message);
    return { source: "error", keyword, parts: [], error: error.message };
  }
}

/**
 * Check compatibility between a part and a model
 */
export async function checkPartModelCompatibility(partNumber, modelNumber) {
  const partData = await fetchPartByNumber(partNumber);
  if (!partData) {
    return { compatible: null, reason: "Could not retrieve part data", partNumber, modelNumber };
  }

  const normalizedModel = modelNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Check if model appears in the part's compatible models list
  const modelInList = partData.compatibleModels?.some(
    (m) => m.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(normalizedModel) ||
      normalizedModel.includes(m.toUpperCase().replace(/[^A-Z0-9]/g, ""))
  );

  if (modelInList) {
    return {
      compatible: true,
      reason: `${partNumber} is confirmed compatible with ${modelNumber} based on PartSelect product data.`,
      partData,
      partNumber: partData.partNumber,
      modelNumber
    };
  }

  // Also try fetching the model's parts to cross-reference
  try {
    const modelData = await fetchPartsByModel(modelNumber);
    const partInModelList = modelData?.parts?.some(
      (p) => p.partNumber === partData.partNumber
    );

    if (partInModelList) {
      return {
        compatible: true,
        reason: `${partNumber} appears in the parts list for model ${modelNumber}.`,
        partData,
        partNumber: partData.partNumber,
        modelNumber
      };
    }
  } catch (_) {
    // Cross-reference failed, report based on part page only
  }

  return {
    compatible: false,
    reason: `Could not confirm compatibility between ${partNumber} and ${modelNumber}. The part may still be compatible — please verify on partselect.com.`,
    partData,
    partNumber: partData.partNumber,
    modelNumber
  };
}
