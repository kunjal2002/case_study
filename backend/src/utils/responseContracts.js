/**
 * Structured response contracts — ensures consistent API output shape.
 * All responses follow these contracts so the frontend can rely on a stable interface.
 */

export function createChatResponse(content, options = {}) {
  return {
    content: content || "",
    cards: options.cards || [],
    suggestions: options.suggestions || [],
    toolsUsed: options.toolsUsed || [],
    intent: options.intent || null,
    meta: {
      agent: options.agent || "partbot",
      provider: options.provider || null,
      model: options.model || null,
      entities: options.entities || {},
      timestamp: new Date().toISOString(),
    },
  };
}

export function createPartCard(part) {
  if (!part) return null;
  const pn = part.partSelectNumber || part.partNumber || part.part_number;
  return {
    id: pn,
    title: part.title || part.name || pn,
    partNumber: pn,
    manufacturerPartNumber: part.manufacturerPartNumber || part.mpn || "",
    price: part.price != null ? Number(part.price) : null,
    inStock: part.inStock !== false,
    rating: part.rating ? Number(part.rating) : null,
    reviewCount: part.reviewCount || null,
    fitment: part.fitment || (part.inStock ? "In Stock" : ""),
    summary: (part.description || part.summary || "").slice(0, 200),
    imageUrl: part.imageUrl || part.image_url || "",
    url: part.url || (pn ? `https://www.partselect.com/${pn}-Part.htm` : ""),
    cta: pn ? `How do I install ${pn}?` : null,
    ctaLabel: "Installation Guide",
    brand: part.brand || "",
    applianceType: part.applianceType || part.category || "",
  };
}

export function createProductResponse(part) {
  const card = createPartCard(part);
  return {
    found: !!part,
    part: card,
    timestamp: new Date().toISOString(),
  };
}

export function createSearchResponse(parts, query, total) {
  return {
    query,
    total: total || parts.length,
    results: parts.map(createPartCard).filter(Boolean),
    timestamp: new Date().toISOString(),
  };
}

export function createCompatibilityResponse(compatible, part, modelNumber, reason) {
  return {
    compatible,
    partNumber: part?.partSelectNumber || part?.partNumber || null,
    modelNumber,
    reason: reason || "",
    part: part ? createPartCard(part) : null,
    timestamp: new Date().toISOString(),
  };
}

export function createErrorResponse(message, details = null) {
  return {
    error: message,
    details: details || null,
    timestamp: new Date().toISOString(),
  };
}
