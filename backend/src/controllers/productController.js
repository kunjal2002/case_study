import { Router } from "express";
import { loadProductDB } from "../data/scraper.js";
import { productKnowledgeBase } from "../agent/knowledge-base.js";
import { fetchPartByNumber, fetchPartsByModel, searchPartsByKeyword } from "../agent/partselect-service.js";
import { createProductResponse, createSearchResponse, createCompatibilityResponse, createErrorResponse } from "../utils/responseContracts.js";
import { validatePartNumber, validateSearchQuery } from "../middleware/inputValidators.js";
import logger from "../utils/logger.js";

const router = Router();

let dbCache = null;
function getDB() {
  if (!dbCache) {
    try { dbCache = loadProductDB(); } catch { dbCache = { parts: {}, models: {} }; }
  }
  return dbCache;
}

// GET /api/products/search?q=dishwasher+spray+arm&limit=5
router.get("/search", validateSearchQuery, async (req, res) => {
  const { q, limit = 5, applianceType } = req.query;
  try {
    const db = getDB();
    const keywords = q.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const matches = Object.values(db.parts || {})
      .filter(p => {
        if (applianceType && p.applianceType !== applianceType) return false;
        const text = `${p.title} ${p.description || ""} ${(p.symptoms || []).join(" ")}`.toLowerCase();
        return keywords.some(w => text.includes(w));
      })
      .slice(0, Number(limit));

    // Fallback to live search if local DB is sparse
    if (matches.length < 3) {
      try {
        const live = await searchPartsByKeyword(q, applianceType);
        if (live?.parts?.length > 0) {
          logger.info(`Live search fallback for: ${q}`);
          return res.json(createSearchResponse(live.parts, q, live.parts.length));
        }
      } catch {}
    }

    logger.info(`Product search: "${q}" → ${matches.length} results`);
    res.json(createSearchResponse(matches, q, matches.length));
  } catch (err) {
    logger.error("Product search error:", err);
    res.status(500).json(createErrorResponse("Search failed"));
  }
});

// GET /api/products/:partNumber
router.get("/:partNumber", validatePartNumber, async (req, res) => {
  const { partNumber } = req.params;
  const normalized = partNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");

  try {
    const db = getDB();
    let part = db.parts?.[normalized];

    // Check by MPN
    if (!part) {
      for (const p of Object.values(db.parts || {})) {
        if (p.manufacturerPartNumber?.toUpperCase().replace(/[^A-Z0-9]/g, "") === normalized) {
          part = p; break;
        }
      }
    }

    // KB fallback
    if (!part) {
      part = productKnowledgeBase.getByPartNumber(partNumber);
    }

    // Live scrape fallback
    if (!part) {
      try {
        part = await fetchPartByNumber(partNumber);
      } catch {}
    }

    if (!part) {
      return res.status(404).json(createErrorResponse(`Part ${partNumber} not found`));
    }

    logger.info(`Part lookup: ${partNumber} → ${part.title}`);
    res.json(createProductResponse(part));
  } catch (err) {
    logger.error(`Part lookup error for ${partNumber}:`, err);
    res.status(500).json(createErrorResponse("Lookup failed"));
  }
});

// GET /api/products/:partNumber/compatibility?model=WDT780SAEM1
router.get("/:partNumber/compatibility", validatePartNumber, async (req, res) => {
  const { partNumber } = req.params;
  const { model } = req.query;

  if (!model) {
    return res.status(400).json(createErrorResponse("model query parameter is required"));
  }

  try {
    const db = getDB();
    const normalized = partNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const modelNorm = model.toUpperCase().replace(/[^A-Z0-9]/g, "");

    const part = db.parts?.[normalized];
    const isCompatible = part?.compatibleModels?.some(m =>
      m.replace(/[^A-Z0-9]/g, "").includes(modelNorm) ||
      modelNorm.includes(m.replace(/[^A-Z0-9]/g, ""))
    );

    if (isCompatible !== undefined) {
      return res.json(createCompatibilityResponse(isCompatible, part, model,
        isCompatible
          ? `${partNumber} is confirmed compatible with ${model}`
          : `${partNumber} is not listed for ${model}`
      ));
    }

    // Check model page
    const modelData = db.models?.[modelNorm];
    if (modelData?.partNumbers?.includes(normalized)) {
      return res.json(createCompatibilityResponse(true, part, model,
        `${partNumber} appears in the parts list for ${model}`
      ));
    }

    res.json(createCompatibilityResponse(null, part, model,
      "Compatibility could not be confirmed from local data. Please verify on partselect.com."
    ));
  } catch (err) {
    logger.error("Compatibility check error:", err);
    res.status(500).json(createErrorResponse("Compatibility check failed"));
  }
});

export default router;
