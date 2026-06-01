/**
 * Router Agent - Intent classification and query routing.
 * 
 * Classifies user intent and routes to the appropriate specialist agent.
 * Acts as the first layer in the multi-agent pipeline.
 * 
 * Intents:
 *  - part_lookup: user wants info about a specific part number
 *  - model_search: user wants parts for a specific model
 *  - compatibility_check: user wants to know if a part fits a model
 *  - installation_help: user wants install/repair instructions
 *  - troubleshooting: user describes a problem/symptom
 *  - keyword_search: user searches by part name/description
 *  - order_support: shipping, returns, tracking questions
 *  - off_topic: unrelated to refrigerator/dishwasher parts
 */

const INTENT_PATTERNS = {
  part_lookup: [
    /\bPS\d{6,8}\b/i,
    /\bpart\s*(?:number|#|no\.?)\s*[:.]?\s*\w/i,
    /\btell me about\s+\w/i,
    /\bfind\s+part/i,
    /\blook\s*up\s+(?:part|PS)/i,
  ],
  model_search: [
    /\bparts?\s+for\s+(?:model\s+)?[A-Z]{2,5}\d{4,}/i,
    /\bmodel\s*(?:#|number)?\s*[:.]?\s*[A-Z]{2,5}\d{4,}/i,
    /\bshow\s+(?:me\s+)?parts?\s+for/i,
    /\bwhat\s+parts?\s+(?:does?|are|fit)/i,
  ],
  compatibility_check: [
    /\bcompatib(?:le|ility)\b/i,
    /\bfit(?:s)?\s+(?:my|the|a|model)\b/i,
    /\bwork(?:s)?\s+with\b/i,
    /\bfit\s+(?:in|on|with)\b/i,
    /\bis\s+(?:this|that|it)\s+(?:the\s+right|correct)\b/i,
  ],
  installation_help: [
    /\binstall(?:ation|ing)?\b/i,
    /\bhow\s+(?:do\s+I|can\s+I|to)\s+(?:install|replace|fix|change|put|mount)\b/i,
    /\breplace(?:ment)?\s+(?:guide|instruction|step|how)/i,
    /\brepair\s+(?:guide|instruction|video|step)/i,
    /\bstep[\s-]by[\s-]step/i,
  ],
  troubleshooting: [
    /\bnot\s+(?:working|cooling|draining|cleaning|drying|dispensing|making)/i,
    /\bbroken\b/i,
    /\bleaking\b/i,
    /\bnoisy\b/i,
    /\bwon't\b/i,
    /\bdoesn't\b/i,
    /\bproblem\b/i,
    /\bissue\b/i,
    /\bsymptom/i,
    /\btroubleshoot/i,
    /\bdiagnos/i,
    /\berror\s+code/i,
  ],
  order_support: [
    /\border\b/i,
    /\btrack(?:ing)?\b/i,
    /\bshipp(?:ing|ed)\b/i,
    /\breturn\b/i,
    /\brefund\b/i,
    /\bcancel/i,
    /\bdelivery\b/i,
    /\bwarranty\b/i,
    /\bprice\s+match/i,
  ],
  off_topic: [
    /\b(?:weather|forecast)\b/i,
    /\b(?:stock\s+market|crypto|bitcoin)\b/i,
    /\b(?:sports?|football|basketball|soccer|baseball)\b/i,
    /\b(?:politic|election|president|congress)\b/i,
    /\b(?:recipe|how\s+to\s+cook|bake|cooking\s+ingredients)\b/i,
    /\b(?:movie|film|tv\s+show|netflix|music\s+song|song\s+lyrics)\b/i,
    /\b(?:write\s+a\s+poem|tell\s+a\s+joke|tell\s+me\s+a\s+story)\b/i,
  ],
};

// Appliance-related terms that override off-topic classification
const APPLIANCE_TERMS = /refrigerator|fridge|dishwasher|freezer|ice\s*maker|compressor|thermostat|spray\s*arm|door\s*(?:bin|shelf|latch|gasket)|filter|drain|rack|pump|PS\d/i;

// Unsupported appliances — these should be politely declined
const UNSUPPORTED_APPLIANCES = /\b(dryer|washing\s*machine|washer\b(?!\s*dispenser)|oven|stove|range|microwave|air\s*conditioner|heater|vacuum|toaster|blender|coffee\s*maker|tv|television|furnace|boiler|heat\s*pump)\b/i;

// Known MPN prefixes — these are part numbers, NOT model numbers
// Must be specific enough to not match model numbers like WDT780SAEM1
const MPN_PREFIXES = /^(WPW|WP[^A-Z]|W10|W11|AP6|EAP|B00|EDR|ADQ|5303|134[0-9]{3}|279[0-9]{3})/i;

export function classifyIntent(query, memory = null) {
  const text = query.trim();

  // Check for explicit PS part number
  const psMatch = text.match(/\bPS\d{6,8}\b/i);

  // Check for standalone MPN (alphanumeric, looks like a part number not a model)
  // MPNs: WP8565925, 8194001, W10195416, WPW10321304 etc.
  // Models: WDT780SAEM1, WRS325SDHZ08 etc.
  const standaloneCode = text.match(/\b([A-Z0-9]{6,})\b/gi) || [];
  const mpnCandidate = standaloneCode.find((c) =>
    MPN_PREFIXES.test(c) && !/^PS\d+/i.test(c) && !/^[A-Z]{3,5}\d{4}[A-Z]/i.test(c)
  ) || standaloneCode.find((c) => /^\d{6,}$/.test(c)); // pure numeric like 8194001

  const modelMatch = text.match(/\b[A-Z]{2,5}\d{3,}[A-Z0-9]*\b/gi);
  // Exclude PS numbers and MPN-looking codes from model detection
  const modelNumber = modelMatch?.find((m) =>
    !/^PS\d+/i.test(m) &&
    !MPN_PREFIXES.test(m) &&
    m.length >= 8 &&
    /[A-Z].*\d.*[A-Z0-9]/.test(m) // model numbers have letters-digits-letters pattern
  );

  // Has appliance context?
  const hasApplianceContext = APPLIANCE_TERMS.test(text);

  // Explicitly unsupported appliances get off-topic even if has some appliance terms
  if (UNSUPPORTED_APPLIANCES.test(text) && !hasApplianceContext) {
    return { intent: "off_topic", entities: { unsupportedAppliance: true }, confidence: 0.95 };
  }

  // Check general off-topic patterns
  if (!hasApplianceContext) {
    for (const pattern of INTENT_PATTERNS.off_topic) {
      if (pattern.test(text)) {
        return { intent: "off_topic", entities: {}, confidence: 0.9 };
      }
    }
  }

  // Detect appliance type from text keywords first
  let applianceType = null;
  if (/dishwasher/i.test(text)) applianceType = "dishwasher";
  else if (/refrigerator|fridge|freezer|ice\s*maker/i.test(text))
    applianceType = "refrigerator";

  // Use entity memory from previous turns
  const memoryEntities = {};
  if (memory) {
    if (memory.getEntity("partNumber"))
      memoryEntities.partNumber = memory.getEntity("partNumber");
    if (memory.getEntity("modelNumber"))
      memoryEntities.modelNumber = memory.getEntity("modelNumber");
    if (memory.getEntity("applianceType"))
      memoryEntities.applianceType = memory.getEntity("applianceType");
  }

  // Entities found in THIS query only (not from memory)
  const currentPartNumber = psMatch?.[0]?.toUpperCase() || null;
  const currentMPN = mpnCandidate?.toUpperCase() || null;
  const currentModelNumber = modelNumber?.toUpperCase() || null;

  // Infer appliance type from model number prefix if not yet detected from text
  // WDT/WDF/KDTM/GDF = dishwasher; WRS/WRF/WRT/WRX = refrigerator
  if (!applianceType && currentModelNumber) {
    if (/^(WDT|WDF|WDH|KDTM|KDPE|GDF|SHE|MDB|DW|FPHD|FDB)/i.test(currentModelNumber)) applianceType = "dishwasher";
    else if (/^(WRS|WRF|WRT|WRX|WRB|ED[0-9]|WRV|WRP)/i.test(currentModelNumber)) applianceType = "refrigerator";
  }

  const entities = {
    partNumber: currentPartNumber || memoryEntities.partNumber || null,
    mpn: currentMPN || null,
    modelNumber: currentModelNumber || memoryEntities.modelNumber || null,
    applianceType: applianceType || memoryEntities.applianceType || null,
  };

  // Score each intent based on text patterns
  const scores = {};
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (intent === "off_topic") continue;
    scores[intent] = patterns.filter((p) => p.test(text)).length;
  }

  // Boost based on entities found in CURRENT query
  // Compatibility check wins when BOTH a part AND a model are present
  if ((currentPartNumber || currentMPN) && currentModelNumber) {
    scores.compatibility_check += 8; // strong boost — having both almost always means compatibility
  } else if ((currentPartNumber || currentMPN) && /install|replace|how (do|can|to)|step/i.test(text)) {
    scores.installation_help += 3;
  } else if (currentPartNumber) {
    scores.part_lookup += 3;
  } else if (currentMPN && !currentModelNumber) {
    scores.part_lookup += 3;
  } else if (currentModelNumber) {
    scores.model_search += 3;
  }

  // Pick highest scoring intent
  let bestIntent = "keyword_search";
  let bestScore = 0;
  for (const [intent, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  if (bestScore === 0) {
    if ((currentPartNumber || currentMPN) && currentModelNumber) bestIntent = "compatibility_check";
    else if (currentPartNumber || currentMPN) bestIntent = "part_lookup";
    else if (currentModelNumber) bestIntent = "model_search";
    else if (hasApplianceContext) bestIntent = "keyword_search";
  }

  return {
    intent: bestIntent,
    entities,
    confidence: Math.min(bestScore / 3, 1),
  };
}
