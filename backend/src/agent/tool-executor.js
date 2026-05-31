/**
 * Tool Executor - Dispatches tool calls to data services.
 * 
 * Data resolution order:
 *  1. Local product database (pre-scraped, fastest)
 *  2. Vector store semantic search (for fuzzy/natural language queries)
 *  3. Live PartSelect scraping (real-time, slower but most current)
 *  4. Knowledge base fallback (curated, always available)
 */
import {
  fetchPartByNumber,
  fetchPartsByModel,
  searchPartsByKeyword,
  checkPartModelCompatibility,
} from "./partselect-service.js";
import { productKnowledgeBase } from "./knowledge-base.js";
import { loadProductDB } from "../data/scraper.js";
import { vectorStore } from "../data/vector-store.js";

let productDB = null;

function getDB() {
  if (!productDB) {
    try {
      productDB = loadProductDB();
    } catch {
      productDB = { parts: {}, models: {} };
    }
  }
  return productDB;
}

export async function executeToolCall(toolName, args) {
  switch (toolName) {
    case "search_part":
      return handleSearchPart(args);
    case "search_by_model":
      return handleSearchByModel(args);
    case "check_compatibility":
      return handleCheckCompatibility(args);
    case "get_installation_guide":
      return handleGetInstallation(args);
    case "troubleshoot_symptom":
      return handleTroubleshoot(args);
    case "search_parts_by_keyword":
      return handleSearchByKeyword(args);
    case "semantic_search":
      return handleSemanticSearch(args);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

function buildInstallGuide(part) {
  const lines = [];
  if (part.description) lines.push(part.description);
  if (part.repairStories?.length) {
    lines.push("\n**Customer installation experiences:**");
    part.repairStories.slice(0, 3).forEach(s => lines.push(`> ${s.slice(0, 200)}`));
  }
  return lines.join("\n") || "";
}

async function handleSearchPart({ partNumber }) {
  const normalized = partNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // 1. Check local product DB first
  const db = getDB();
  if (db.parts[normalized]) {
    console.log(`  [DB] Found ${normalized} in local database`);
    return { ...db.parts[normalized], source: "local-database" };
  }

  // Also search by manufacturer part number in local DB
  for (const [pn, data] of Object.entries(db.parts)) {
    if (
      data.manufacturerPartNumber &&
      data.manufacturerPartNumber.toUpperCase().replace(/[^A-Z0-9]/g, "") === normalized
    ) {
      console.log(`  [DB] Found ${pn} by MPN ${normalized}`);
      return { ...data, source: "local-database" };
    }
  }

  // 2. Try live scraping
  try {
    const liveResult = await fetchPartByNumber(partNumber);
    if (liveResult) {
      console.log(`  [LIVE] Found ${partNumber} from PartSelect`);
      return liveResult;
    }
  } catch (e) {
    console.error(`  [LIVE] Scrape failed: ${e.message}`);
  }

  // 3. Knowledge base fallback
  const kbResult = productKnowledgeBase.getByPartNumber(partNumber);
  if (kbResult) {
    return { ...kbResult, source: "knowledge-base" };
  }

  return {
    error: `Could not find part ${partNumber}. Please verify the part number or try searching by keyword.`,
    partNumber: normalized,
    suggestion: "Try searching by part name instead, e.g. 'dishwasher spray arm'",
  };
}

async function handleSearchByModel({ modelNumber }) {
  const normalized = modelNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // 1. Check local DB
  const db = getDB();
  if (db.models[normalized]?.parts?.length > 0) {
    console.log(`  [DB] Found model ${normalized} in local database`);
    return {
      source: "local-database",
      modelNumber: normalized,
      parts: db.models[normalized].parts,
      totalFound: db.models[normalized].parts.length,
    };
  }

  // 2. Try live scraping
  try {
    const liveResult = await fetchPartsByModel(modelNumber);
    if (liveResult?.parts?.length > 0) {
      console.log(`  [LIVE] Found ${liveResult.parts.length} parts for ${modelNumber}`);
      return liveResult;
    }
  } catch (e) {
    console.error(`  [LIVE] Model scrape failed: ${e.message}`);
  }

  // 3. Knowledge base fallback
  const kbResults = productKnowledgeBase.getByModel(modelNumber);
  if (kbResults.length > 0) {
    return {
      source: "knowledge-base",
      modelNumber: normalized,
      parts: kbResults,
      totalFound: kbResults.length,
    };
  }

  return {
    error: `Could not find parts for model ${modelNumber}. Please verify the model number.`,
    modelNumber: normalized,
    suggestion: "Check the model number on your appliance's data plate (usually inside the door or on the back).",
  };
}

async function handleCheckCompatibility({ partNumber, modelNumber }) {
  const db = getDB();
  const normalizedPart = partNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const normalizedModel = modelNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Check local DB first
  const partData = db.parts[normalizedPart];
  if (partData?.compatibleModels) {
    const isCompatible = partData.compatibleModels.some(
      (m) => m.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(normalizedModel) ||
        normalizedModel.includes(m.toUpperCase().replace(/[^A-Z0-9]/g, ""))
    );

    if (isCompatible) {
      return {
        compatible: true,
        reason: `${normalizedPart} is confirmed compatible with ${normalizedModel} based on PartSelect product data.`,
        partData: { ...partData, source: "local-database" },
        partNumber: normalizedPart,
        modelNumber: normalizedModel,
      };
    }
  }

  // Check model page in local DB
  if (db.models[normalizedModel]?.partNumbers) {
    if (db.models[normalizedModel].partNumbers.includes(normalizedPart)) {
      return {
        compatible: true,
        reason: `${normalizedPart} appears in the parts list for model ${normalizedModel}.`,
        partData: partData || { partNumber: normalizedPart, title: "Part found in model listing" },
        partNumber: normalizedPart,
        modelNumber: normalizedModel,
      };
    }
  }

  // Fall back to live check
  try {
    return await checkPartModelCompatibility(partNumber, modelNumber);
  } catch (e) {
    console.error(`  [LIVE] Compatibility check failed: ${e.message}`);
  }

  // KB fallback
  const kbPart = productKnowledgeBase.getByPartNumber(partNumber);
  if (kbPart?.models?.includes(normalizedModel)) {
    return {
      compatible: true,
      reason: `${normalizedPart} is compatible with ${normalizedModel}.`,
      partData: kbPart,
      partNumber: normalizedPart,
      modelNumber: normalizedModel,
    };
  }

  return {
    compatible: null,
    reason: `Could not confirm compatibility between ${normalizedPart} and ${normalizedModel}. Please verify on partselect.com.`,
    partNumber: normalizedPart,
    modelNumber: normalizedModel,
  };
}

async function handleGetInstallation({ partNumber }) {
  const db = getDB();
  const normalized = partNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Always try live scraping first to get the most complete installation data
  // (includes real repair stories and video URLs from PartSelect)
  try {
    const liveResult = await fetchPartByNumber(partNumber);
    if (liveResult && liveResult.title) {
      const localPart = db.parts[normalized] || {};
      return {
        partNumber: liveResult.partSelectNumber || liveResult.partNumber || normalized,
        title: liveResult.title,
        description: liveResult.description || localPart.description || "",
        installationGuide: buildInstallGuide(liveResult),
        installSteps: localPart.installSteps || [],
        installDifficulty: liveResult.installDifficulty || localPart.installDifficulty || "Easy",
        repairTime: liveResult.repairTime || localPart.repairTime || "15-30 mins",
        repairStories: liveResult.repairStories || [],
        price: liveResult.price,
        inStock: liveResult.inStock,
        url: liveResult.url,
        installVideoUrl: liveResult.installVideoUrl || localPart.installVideoUrl || "",
        videoUrls: liveResult.videoUrls || [],
        source: "partselect-live",
      };
    }
  } catch {}

  // Local DB fallback
  const localPart = db.parts[normalized];
  if (localPart) {
    return {
      partNumber: localPart.partSelectNumber || normalized,
      title: localPart.title,
      description: localPart.description || "",
      installationGuide: localPart.description || "",
      installSteps: localPart.installSteps || [],
      installDifficulty: localPart.installDifficulty || "Easy",
      repairTime: localPart.repairTime || "15-30 mins",
      repairStories: localPart.repairStories || [],
      price: localPart.price,
      inStock: localPart.inStock,
      url: localPart.url,
      installVideoUrl: localPart.installVideoUrl || "",
      videoUrls: localPart.videoUrls || [],
      source: "local-database",
    };
  }

  // KB fallback
  const kbResult = productKnowledgeBase.getByPartNumber(partNumber);
  if (kbResult?.installSteps) {
    return {
      partNumber: kbResult.partNumber,
      title: kbResult.title,
      installationGuide: kbResult.installSteps.join("\n"),
      installDifficulty: kbResult.installDifficulty,
      price: kbResult.price,
      source: "knowledge-base",
    };
  }

  return {
    error: `Could not find installation info for ${partNumber}.`,
    suggestion: "Visit the product page on partselect.com for installation videos and guides.",
  };
}

async function handleTroubleshoot({ symptom, applianceType, modelNumber }) {
  // Knowledge base symptom matching
  const kbResults = productKnowledgeBase.searchBySymptom(symptom, applianceType);

  // Semantic search for related parts
  let semanticResults = [];
  try {
    semanticResults = await vectorStore.search(
      `${applianceType || ""} ${symptom}`.trim(),
      { topK: 3, applianceType }
    );
  } catch {}

  // Live keyword search
  let liveResults = [];
  try {
    const live = await searchPartsByKeyword(`${applianceType} ${symptom}`, applianceType);
    liveResults = live?.parts || [];
  } catch {}

  // Model-specific parts
  let modelParts = [];
  if (modelNumber) {
    try {
      const modelResult = await fetchPartsByModel(modelNumber);
      modelParts = modelResult?.parts?.slice(0, 5) || [];
    } catch {}
  }

  return {
    symptom,
    applianceType,
    modelNumber: modelNumber || null,
    knowledgeBaseMatches: kbResults,
    semanticResults,
    modelParts,
    searchResults: liveResults.slice(0, 5),
    source: "multi-source-diagnosis",
  };
}

async function handleSearchByKeyword({ keyword, applianceType }) {
  const db = getDB();
  const lowerKeyword = (keyword || "").toLowerCase().trim();

  // If keyword IS just the appliance type name, return all parts of that type
  const isGenericBrowse = applianceType && (
    lowerKeyword === applianceType ||
    lowerKeyword === "parts" ||
    lowerKeyword === applianceType + " parts" ||
    lowerKeyword === "all " + applianceType + " parts" ||
    lowerKeyword === "" ||
    lowerKeyword === "all parts"
  );

  if (isGenericBrowse) {
    const allTypeParts = Object.values(db.parts)
      .filter(p => p.applianceType === applianceType)
      .slice(0, 8)
      .map(p => ({
        partNumber: p.partSelectNumber || p.partNumber,
        title: p.title,
        price: p.price,
        inStock: p.inStock,
        url: p.url,
        description: (p.description || "").slice(0, 150),
      }));
    return {
      keyword,
      applianceType,
      parts: allTypeParts,
      totalFound: allTypeParts.length,
      source: "local-database-browse",
    };
  }

  // Semantic search from vector store
  let semanticResults = [];
  try {
    semanticResults = await vectorStore.search(keyword, {
      topK: 5,
      applianceType,
    });
  } catch {}

  // Local DB keyword match
  const localMatches = [];
  for (const [pn, data] of Object.entries(db.parts)) {
    if (applianceType && data.applianceType !== applianceType) continue;
    const searchText = `${data.title} ${data.description || ""} ${(data.symptoms || []).join(" ")}`.toLowerCase();
    if (searchText.includes(lowerKeyword)) {
      localMatches.push({
        partNumber: pn,
        title: data.title,
        price: data.price,
        inStock: data.inStock,
        url: data.url,
        description: (data.description || "").slice(0, 150),
      });
    }
  }

  // Only try live search if local has very few results (avoid timeouts)
  let liveResults = { parts: [] };
  if (localMatches.length < 3 && semanticResults.length < 3) {
    try {
      liveResults = await searchPartsByKeyword(keyword, applianceType);
    } catch {}
  }

  // Merge and deduplicate
  const allParts = new Map();

  // Priority: local DB > semantic > live
  for (const p of localMatches) allParts.set(p.partNumber, { ...p, source: "local-database" });
  for (const p of semanticResults) {
    if (!allParts.has(p.partNumber)) allParts.set(p.partNumber, { ...p, source: "semantic-search" });
  }
  for (const p of (liveResults.parts || [])) {
    if (!allParts.has(p.partNumber)) allParts.set(p.partNumber, { ...p, source: "live-search" });
  }

  return {
    keyword,
    applianceType,
    parts: Array.from(allParts.values()).slice(0, 8),
    semanticResults: semanticResults.slice(0, 3),
    totalFound: allParts.size,
    source: "multi-source-search",
  };
}

async function handleSemanticSearch({ query, applianceType }) {
  try {
    const results = await vectorStore.search(query, {
      topK: 5,
      applianceType,
    });

    // Enrich with full product data from local DB
    const db = getDB();
    const enriched = results.map((r) => {
      const fullData = db.parts[r.partNumber];
      return {
        ...r,
        title: fullData?.title || r.title,
        description: (fullData?.description || "").slice(0, 200),
        price: fullData?.price || r.price,
        inStock: fullData?.inStock,
        imageUrl: fullData?.imageUrl || "",
        url: fullData?.url || `https://www.partselect.com/${r.partNumber}-Part.htm`,
      };
    });

    return {
      query,
      applianceType,
      results: enriched,
      totalFound: enriched.length,
      source: "semantic-search",
    };
  } catch (err) {
    console.error(`[SemanticSearch] Error: ${err.message}`);
    return {
      query,
      results: [],
      error: "Semantic search temporarily unavailable",
      source: "error",
    };
  }
}
