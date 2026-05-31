/**
 * Vector Store - In-process semantic search using OpenAI embeddings.
 * 
 * OPTIONAL — only activates if OPENAI_API_KEY (sk-...) is present.
 * The system works fine without it using keyword search and local DB.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMBEDDINGS_PATH = join(__dirname, "embeddings.json");

export class VectorStore {
  constructor() {
    this._openai = null;
    this.embeddings = new Map();
    this._loaded = false;
  }

  async _getOpenAI() {
    if (!this._openai) {
      const key = process.env.OPENAI_API_KEY;
      if (!key || !key.startsWith("sk-")) {
        throw new Error("OpenAI API key required for embeddings (must start with sk-)");
      }
      const { default: OpenAI } = await import("openai");
      this._openai = new OpenAI({ apiKey: key });
    }
    return this._openai;
  }

  async initialize(products) {
    this._loadFromDisk();

    if (!products || Object.keys(products).length === 0) {
      console.log("[VectorStore] No products to index");
      return;
    }

    const toEmbed = [];
    for (const [pn, product] of Object.entries(products)) {
      if (this.embeddings.has(pn)) continue;
      const text = this._buildEmbeddingText(product);
      toEmbed.push({ partNumber: pn, text, product });
    }

    if (toEmbed.length === 0) {
      console.log(`[VectorStore] All ${this.embeddings.size} products already indexed`);
      return;
    }

    let openai;
    try {
      openai = await this._getOpenAI();
    } catch {
      console.log("[VectorStore] Skipped — no valid OpenAI key for embeddings");
      return;
    }

    console.log(`[VectorStore] Generating embeddings for ${toEmbed.length} new products...`);

    const batchSize = 20;
    for (let i = 0; i < toEmbed.length; i += batchSize) {
      const batch = toEmbed.slice(i, i + batchSize);
      try {
        const response = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: batch.map((b) => b.text),
        });

        for (let j = 0; j < batch.length; j++) {
          this.embeddings.set(batch[j].partNumber, {
            vector: response.data[j].embedding,
            text: batch[j].text,
            metadata: {
              partNumber: batch[j].partNumber,
              title: batch[j].product.title,
              applianceType: batch[j].product.applianceType,
              brand: batch[j].product.brand,
              price: batch[j].product.price,
            },
          });
        }
      } catch (err) {
        console.error(`  Embedding batch failed: ${err.message}`);
      }
    }

    this._saveToDisk();
    console.log(`[VectorStore] Total indexed: ${this.embeddings.size} products`);
  }

  async search(query, options = {}) {
    const { topK = 5, applianceType = null, minScore = 0.3 } = options;

    if (this.embeddings.size === 0) return [];

    let openai;
    try {
      openai = await this._getOpenAI();
    } catch {
      return [];
    }

    try {
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: query,
      });
      const queryVector = response.data[0].embedding;

      const results = [];
      for (const [pn, entry] of this.embeddings) {
        if (applianceType && entry.metadata.applianceType !== applianceType) continue;
        const score = cosineSimilarity(queryVector, entry.vector);
        if (score >= minScore) {
          results.push({ partNumber: pn, score, ...entry.metadata });
        }
      }

      results.sort((a, b) => b.score - a.score);
      return results.slice(0, topK);
    } catch {
      return [];
    }
  }

  _buildEmbeddingText(product) {
    const parts = [
      product.title || "",
      product.applianceType || "",
      product.brand || "",
      product.description || "",
      (product.symptoms || []).join(", "),
      (product.compatibleModels || []).slice(0, 10).join(", "),
    ];
    return parts.filter(Boolean).join(" | ").slice(0, 2000);
  }

  _loadFromDisk() {
    if (this._loaded) return;
    this._loaded = true;

    if (!existsSync(EMBEDDINGS_PATH)) return;
    try {
      const data = JSON.parse(readFileSync(EMBEDDINGS_PATH, "utf-8"));
      for (const [key, value] of Object.entries(data)) {
        this.embeddings.set(key, value);
      }
      console.log(`[VectorStore] Loaded ${this.embeddings.size} embeddings from disk`);
    } catch {}
  }

  _saveToDisk() {
    const obj = {};
    for (const [key, value] of this.embeddings) {
      obj[key] = value;
    }
    writeFileSync(EMBEDDINGS_PATH, JSON.stringify(obj));
  }
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const vectorStore = new VectorStore();
