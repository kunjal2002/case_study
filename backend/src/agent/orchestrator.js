/**
 * Agent Orchestrator - Core agentic loop using OpenAI function calling.
 *
 * Architecture: Multi-Agent ReAct (Reason + Act) pattern
 * 
 * Pipeline:
 *  1. Router Agent classifies intent and extracts entities
 *  2. Orchestrator builds context-aware messages with conversation memory
 *  3. OpenAI GPT-4o-mini autonomously selects tools via function calling
 *  4. Tool results feed back for synthesis (multi-step if needed)
 *  5. Response is structured with rich product cards + suggestions
 *
 * Agents (specialized through system prompt + tool selection):
 *  - Product Search: part lookup, keyword search
 *  - Compatibility: cross-reference part ↔ model
 *  - Installation: repair guides, step-by-step instructions
 *  - Troubleshooting: symptom diagnosis, part recommendations
 *  - Order Support: shipping, returns, policies
 */
import { TOOL_DEFINITIONS } from "./tools.js";
import { executeToolCall } from "./tool-executor.js";
import { productKnowledgeBase } from "./knowledge-base.js";
import { classifyIntent } from "../agents/router-agent.js";
import { llmProvider } from "./llm-provider.js";
import { loadProductDB } from "../data/scraper.js";

const SYSTEM_PROMPT = `You are PartBot, the official AI assistant for PartSelect.com — a trusted e-commerce site for genuine OEM appliance replacement parts. You specialize EXCLUSIVELY in refrigerator and dishwasher parts.

YOUR IDENTITY:
- You are knowledgeable, professional, and friendly
- You reference real PartSelect products, prices, and installation data
- You are powered by live PartSelect product data

CAPABILITIES (use tools to look up real data — never invent information):
1. **Part Lookup** — Search by PartSelect number (PS#) or manufacturer part number
2. **Model Search** — Find all compatible parts for a specific appliance model
3. **Compatibility Check** — Verify if a part fits a specific model
4. **Installation Guides** — Step-by-step repair instructions with difficulty ratings
5. **Troubleshooting** — Diagnose symptoms and recommend replacement parts
6. **Semantic Search** — Find parts by description when no part number is known
7. **Order Support** — Answer shipping, returns, warranty, and pricing questions

STRICT RULES:
1. SCOPE: Only discuss refrigerator and dishwasher parts. Politely decline other topics.
2. ACCURACY: Always use tools to fetch real data. Never fabricate part numbers, prices, or compatibility.
3. SAFETY: Always recommend disconnecting power before any repair.
4. HONESTY: If you can't find information, say so and suggest checking partselect.com.
5. PRODUCT DISPLAY: Include part numbers, prices, stock status, and compatibility when available.
6. TROUBLESHOOTING: Ask for model number and symptoms if not provided.
BROWSING: When users ask to "show parts" for a general appliance type (e.g. "show refrigerator parts", "dishwasher parts"), use the search_parts_by_keyword tool with the applianceType parameter set correctly. ALWAYS pass applianceType="refrigerator" for fridge queries and applianceType="dishwasher" for dishwasher queries. Do NOT ask for a model number — just show what's available. NEVER show dishwasher parts when user asks for refrigerator parts or vice versa.
7. FORMAT: Use markdown for readability. Keep responses concise. Use **bold** for emphasis, numbered lists for steps, bullet lists for options. Do NOT use #### headers or image markdown (![...]). Use ## or ### at most.
8. DO NOT ASSUME: Each query should be treated independently. Do NOT assume the user is referring to a previously mentioned model or part unless they explicitly say "this part" or "that model". A dishwasher part IS a dishwasher part — do not say "this is not a refrigerator part" unless the user asked about refrigerators.
9. PART IDENTITY: A part is what it is. PS972325 is a Dishwasher Door Balance Link Kit — present it as such. Do NOT add unnecessary commentary about what type of appliance it is NOT for.
10. CORRECT RESPONSES: When a user asks "Tell me about PS972325", simply show the part details. Do not say "this is not a refrigerator part" — just show the product info.

ORDER SUPPORT POLICIES (answer directly, no tool needed):
- Free shipping on orders over $25
- 365-day return policy on most parts  
- Parts ship same day if ordered by 8pm EST
- Price match guarantee against authorized dealers within 14 days
- 1-year warranty on all OEM parts
- Customer support: https://www.partselect.com/user/self-service/
- Customer service: 1-866-319-8402 (Mon-Sat 8am-8pm EST)`;

export class AgentOrchestrator {
  constructor() {
    this.llm = llmProvider;
    this.maxToolRounds = 3;
    this._dbCache = null; // Fresh cache per instance
  }

  async handleQuery(userQuery, memory) {
    memory.addUserMessage(userQuery);

    // Step 1: Route intent
    const routing = classifyIntent(userQuery, memory);
    console.log(`[Router] Intent: ${routing.intent} | Entities:`, routing.entities);

    // Only persist entities that are explicitly in the CURRENT query
    // Don't carry over stale entities from previous turns — this causes contamination
    // (e.g. user asks about WDT780SAEM1, then asks "troubleshoot refrigerator" — should NOT assume WDT780SAEM1)
    const currentHasEntities = routing.entities.partNumber || routing.entities.mpn || routing.entities.modelNumber;
    if (routing.entities.partNumber) memory.setEntity("partNumber", routing.entities.partNumber);
    if (routing.entities.mpn) memory.setEntity("mpn", routing.entities.mpn);
    if (routing.entities.modelNumber) memory.setEntity("modelNumber", routing.entities.modelNumber);
    if (routing.entities.applianceType) memory.setEntity("applianceType", routing.entities.applianceType);
    // If a new query has its own entities, clear old ones that aren't in the new query
    if (currentHasEntities) {
      if (!routing.entities.partNumber && memory.getEntity("partNumber")) {
        // New query has a model but no part — don't assume old part
      }
    }

    // Step 2: Handle off-topic
    if (routing.intent === "off_topic") {
      const response = this._buildOffTopicResponse(routing);
      memory.addAssistantMessage(response.content);
      return response;
    }

    // Step 3: Handle order support directly
    if (routing.intent === "order_support") {
      return this._handleOrderSupport(userQuery, memory);
    }

    // Handle cart view intent
    if (/\b(cart|my cart|shopping cart|view cart|checkout|show cart)\b/i.test(userQuery)) {
      const content = "Your cart management happens directly on PartSelect.com.\n\n" +
        "- 🛒 [View your cart on PartSelect](https://www.partselect.com/ShoppingCart.aspx)\n" +
        "- All parts you add from this chat open directly on the product page where you can add to cart\n\n" +
        "Would you like me to help you find a specific part?";
      memory.addAssistantMessage(content);
      return {
        content, cards: [], suggestions: ["Find parts for my model", "Check compatibility"],
        toolsUsed: [], meta: { agent: "cart-handler" },
      };
    }

    // Step 4: If no LLM, go straight to tool-only mode
    if (!this.llm.isAvailable) {
      return this._toolOnlyResponse(userQuery, memory, routing);
    }

    // Step 5: Run the agentic loop
    try {
      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...this._buildContextMessages(memory, routing),
      ];
      return await this._agentLoop(messages, memory);
    } catch (error) {
      console.error("Agent error:", error.message);
      // Quota exhausted or LLM failure → tool-only mode
      return this._toolOnlyResponse(userQuery, memory, routing);
    }
  }

  _buildContextMessages(memory, routing) {
    const recentMessages = memory.getContextForLLM();
    // Do NOT inject entity hints from memory — let the LLM read the conversation
    // naturally. Injecting stale entities causes hallucinations like
    // "this is not a refrigerator part" when nobody asked about refrigerators.
    return recentMessages;
  }

  async _agentLoop(messages, memory) {
    let rounds = 0;

    while (rounds < this.maxToolRounds) {
      rounds++;

      const result = await this.llm.chatCompletion(messages, TOOL_DEFINITIONS, {
        temperature: 0.3,
        max_tokens: 1200,
      });

      // Final text response — no more tools needed
      if (result.toolCalls.length === 0) {
        const content =
          result.content ||
          "I can help with refrigerator and dishwasher parts. Could you tell me more about what you need?";
        memory.addAssistantMessage(content);
        return this._formatResponse(content, memory);
      }

      // Build assistant message with tool calls for conversation history
      if (this.llm.providerName === "openai") {
        messages.push(result.raw);
      } else {
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: result.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        });
      }

      // Execute each tool call
      for (const toolCall of result.toolCalls) {
        console.log(`[Agent] Tool: ${toolCall.name}`, toolCall.args);

        const toolResult = await executeToolCall(toolCall.name, toolCall.args);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.name,
          content: JSON.stringify(toolResult),
        });

        memory.addToolResult(toolCall.name, toolResult);
      }
    }

    // Exhausted rounds — synthesize without tools
    const final = await this.llm.chatCompletion(messages, [], {
      temperature: 0.3,
      max_tokens: 1200,
    });

    const content = final.content || "";
    memory.addAssistantMessage(content);
    return this._formatResponse(content, memory);
  }

  async _handleOrderSupport(query, memory) {
    try {
      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...memory.getContextForLLM(),
      ];

      const result = await this.llm.chatCompletion(messages, [], {
        temperature: 0.3,
        max_tokens: 600,
      });

      const content = result.content || "";
      memory.addAssistantMessage(content);

      return {
        content,
        cards: [],
        suggestions: [
          "Find parts for my model",
          "Help me troubleshoot an issue",
        ],
        meta: { agent: "order-support", intent: "order_support" },
      };
    } catch {
      memory.addAssistantMessage("For order support, visit partselect.com/user/self-service/ or call 1-866-319-8402.");
      return {
        content:
          "For order-related questions, here are the key details:\n\n" +
          "- **Customer Support**: Visit [partselect.com/user/self-service](https://www.partselect.com/user/self-service/)\n" +
          "- **Returns**: 365-day return policy on most parts\n" +
          "- **Shipping**: Free shipping on orders over $25, same-day shipping if ordered by 8pm EST\n" +
          "- **Price Match**: We'll match authorized dealer prices within 14 days\n" +
          "- **Contact**: 1-866-319-8402 (Mon-Sat, 8am-8pm EST)\n\n" +
          "Is there anything else I can help with?",
        cards: [],
        suggestions: ["Find a part by number", "Troubleshoot an issue"],
        meta: { agent: "order-support" },
      };
    }
  }

  async _toolOnlyResponse(query, memory, routing) {
    const { intent, entities } = routing;
    let content = "";
    let toolsUsed = [];
    // Track cards for THIS turn only — don't pull from old memory
    const currentTurnCards = [];

    // Detect conversational follow-ups
    if (this._isConversationalFollowUp(query, memory)) {
      content = await this._buildFollowUpResponse(query, memory);
      memory.addAssistantMessage(content);
      return {
        content,
        cards: [],
        suggestions: this._generateSuggestions(content, memory),
        toolsUsed: [],
        meta: { agent: "tool-only-followup" },
      };
    }

    try {
      // ── Part lookup (PS# or MPN) ─────────────────────────────
      if (intent === "part_lookup" && (entities.partNumber || entities.mpn)) {
        const lookupKey = entities.partNumber || entities.mpn;
        const r = await this._smartPartSearch(lookupKey);
        toolsUsed.push("search_part");
        if (r) {
          const pn = r.partSelectNumber || r.partNumber;
          content = `## ${r.title}\n\n`;
          content += `**Part #:** ${pn}`;
          if (r.manufacturerPartNumber) content += `  ·  **MPN:** ${r.manufacturerPartNumber}`;
          content += `\n**Brand:** ${r.brand || "—"}  ·  **Appliance:** ${r.applianceType || "—"}`;
          if (r.price) content += `\n**Price:** $${r.price}`;
          content += `  ·  **Availability:** ${r.inStock ? "✅ In Stock — ships today if ordered by 8pm EST" : "Check availability on PartSelect"}\n`;
          if (r.rating) content += `**Rating:** ${"★".repeat(Math.round(r.rating))}${"☆".repeat(5 - Math.round(r.rating))} ${r.rating}/5 (${r.reviewCount || "verified"} reviews)\n`;
          if (r.description) content += `\n${r.description}`;
          if (r.symptoms?.length) content += `\n\n**Fixes these symptoms:** ${r.symptoms.slice(0, 4).join(", ")}`;
          if (r.compatibleModels?.length) content += `\n**Also compatible with:** ${r.compatibleModels.slice(0, 5).join(", ")}`;
          currentTurnCards.push(this._partToCard(r));
        } else {
          const key = entities.partNumber || entities.mpn;
          content = `I couldn't find **${key}** in my database. [Search on PartSelect →](https://www.partselect.com/Search.aspx?SearchTerm=${encodeURIComponent(key)})`;
        }

      // ── Compatibility ─────────────────────────────────────────
      } else if (intent === "compatibility_check" && entities.partNumber && entities.modelNumber) {
        const result = await executeToolCall("check_compatibility", {
          partNumber: entities.partNumber,
          modelNumber: entities.modelNumber,
        });
        toolsUsed.push("check_compatibility");
        if (result.compatible === true) {
          content = `✅ **Yes, ${entities.partNumber} is compatible with ${entities.modelNumber}.**\n\n${result.reason || ""}`;
          if (result.partData) currentTurnCards.push(this._partToCard({ ...result.partData, fitment: `✓ Compatible with ${entities.modelNumber}` }));
        } else if (result.compatible === false) {
          content = `❌ **${entities.partNumber} is not confirmed for ${entities.modelNumber}.**\n\n${result.reason || "Please verify on partselect.com."}`;
        } else {
          content = result.reason || "Could not determine compatibility. Please verify on partselect.com.";
        }

      // ── Model search ──────────────────────────────────────────
      } else if (intent === "model_search" && entities.modelNumber) {
        const db = this._getLocalDB();
        const mn = entities.modelNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
        let modelData = db.models?.[mn];

        // If not in local DB, try live scraping
        if (!modelData?.parts?.length) {
          try {
            const liveResult = await executeToolCall("search_by_model", { modelNumber: mn });
            if (liveResult?.parts?.length > 0) {
              modelData = liveResult;
            }
          } catch {}
        }

        if (modelData?.parts?.length > 0) {
          content = `Found **${modelData.parts.length} parts** for model **${mn}**:\n\n`;
          modelData.parts.slice(0, 8).forEach((p) => {
            content += `- **${p.title}** (${p.partNumber})${p.price ? ` — $${p.price}` : ""}\n`;
          });
          modelData.parts.slice(0, 4).forEach((p) => {
            const full = db.parts?.[p.partNumber];
            currentTurnCards.push(this._partToCard(full || p));
          });
          toolsUsed.push("search_by_model");
        } else {
          content = `I couldn't find parts for model **${mn}** right now. [Browse on PartSelect →](https://www.partselect.com/Models/${mn}/Parts/)`;
        }

      // ── Installation guide ────────────────────────────────────
      } else if (intent === "installation_help") {
        // Use current query part number, or fall back to last part in memory
        const partToLookup = entities.partNumber || memory.getEntity("partNumber");
        if (partToLookup) {
          const r = await this._smartPartSearch(partToLookup);
          toolsUsed.push("get_installation_guide");
          if (r) {
            const pn = r.partSelectNumber || r.partNumber || partToLookup;
            content = `## Installation Guide: ${r.title} (${pn})\n\n`;
            content += `**Difficulty:** ${r.installDifficulty || "Easy"}  ·  `;
            content += `**Time:** ${r.repairTime || "15-30 mins"}  ·  `;
            content += `**Price:** ${r.price ? `$${r.price}` : "—"}\n\n`;

            // Show description as step 0 (often contains install steps)
            if (r.description) {
              content += `**About this part:**\n${r.description}\n\n`;
            }

            // Show curated install steps if available
            if (r.installSteps?.length > 0) {
              content += "**Step-by-step installation:**\n";
              r.installSteps.forEach((step, i) => {
                content += `${i + 1}. ${step}\n`;
              });
              content += "\n";
            }

            // Customer repair stories (real-world install experiences)
            if (r.repairStories?.length > 0) {
              content += "**Customer installation experiences:**\n";
              r.repairStories.slice(0, 3).forEach((s) => {
                content += `> ${s.slice(0, 200)}\n\n`;
              });
            }

            // Video guide link — if not in seed data, try live scrape for real YouTube URL
            let videoUrl = r.installVideoUrl || r.repairVideoUrl || r.videoUrls?.[0];
            if (!videoUrl && r.partSelectNumber) {
              try {
                const liveData = await executeToolCall("search_part", { partNumber: r.partSelectNumber });
                videoUrl = liveData?.installVideoUrl || liveData?.videoUrls?.[0];
              } catch {}
            }
            if (videoUrl) {
              content += `\n\n**Installation Video**\n[Watch installation video on YouTube →](${videoUrl})`;
            }

            // Safety note
            content += "\n\n⚠️ **Safety:** Always disconnect power to your appliance before beginning any repair.";
            currentTurnCards.push(this._partToCard(r));
          } else {
            content = `I couldn't find installation info for **${partToLookup}** in my database.\n\n[Find it on PartSelect →](https://www.partselect.com/${partToLookup}-Part.htm)`;
          }
        } else {
          // No part number at all — list by appliance type or ask
          const appType = entities.applianceType || (/dishwasher/i.test(query) ? "dishwasher" : /refrigerator|fridge/i.test(query) ? "refrigerator" : null);
          if (appType) {
            const db = this._getLocalDB();
            const parts = Object.values(db.parts || {}).filter((p) => p.applianceType === appType).slice(0, 6);
            toolsUsed.push("search_parts_by_keyword");
            content = `Here are **${appType}** parts with installation guides:\n\n`;
            parts.forEach((p) => {
              content += `- **${p.title}** (${p.partSelectNumber || p.partNumber})${p.price ? ` — $${p.price}` : ""}\n`;
            });
            content += `\nAsk me about any specific part for step-by-step instructions.`;
            parts.slice(0, 4).forEach((p) => currentTurnCards.push(this._partToCard(p)));
          } else {
            content = "Which part would you like installation instructions for?\n\nPlease share:\n- A **part number** (e.g. PS11752778), or\n- Your **appliance model number** and I'll find the right parts for you.";
          }
        }

      // ── Troubleshooting & keyword search ─────────────────────
      } else if (intent === "troubleshooting" || intent === "keyword_search") {
        const appType = entities.applianceType ||
          (/dishwasher/i.test(query) ? "dishwasher" :
           /refrigerator|fridge|freezer|ice\s*maker/i.test(query) ? "refrigerator" : null);

        // Detect "browse all" requests
        const isBrowseAll = /catalog|list all|all parts|what parts|parts you have|parts do you (have|carry)|show (me )?all/i.test(query)
          || (appType && /^\s*(refrigerator|fridge|dishwasher)\s*(parts?|products?)?\s*$/i.test(query.trim()))
          || (appType && /^(show|find|get|list|give|browse)\s+(me\s+)?(the\s+)?(refrigerator|fridge|dishwasher)\s*(parts?)?/i.test(query.trim()))
          || (appType && /^(parts?|products?)\s+(of|for)\s+(a\s+)?(refrigerator|fridge|dishwasher)/i.test(query.trim()))
          || (appType && /show\s+parts?\s+(of|for)\s+(a\s+)?(refrigerator|fridge|dishwasher)/i.test(query.trim()));
        if (isBrowseAll) {
          toolsUsed.push("search_parts_by_keyword");
          const db = this._getLocalDB();
          const allParts = Object.values(db.parts || {})
            .filter((p) => !appType || p.applianceType === appType);
          const total = allParts.length;
          const label = appType ? `${appType} ` : "";
          content = `I have **${total} ${label}parts** in my database:\n\n`;
          allParts.forEach((p) => {
            content += `- **${p.title}** (${p.partSelectNumber || p.partNumber})${p.price ? ` — $${p.price}` : ""}\n`;
          });
          content += `\nFor the full PartSelect catalog, visit [partselect.com](https://www.partselect.com/${appType === "refrigerator" ? "Refrigerator" : appType === "dishwasher" ? "Dishwasher" : ""}-Parts.htm).`;
          allParts.slice(0, 4).forEach((p) => currentTurnCards.push(this._partToCard(p)));

        // MPN lookup (e.g. "W10190965 what is this")
        // Must contain at least one digit to be an MPN — pure words like "DISHWASHER" are not MPNs
        } else if (/^[A-Z][A-Z0-9]{5,}\s/i.test(query.trim()) && /\d/.test(query.trim().split(/\s/)[0])) {
          const mpnMatch = query.trim().match(/^([A-Z][A-Z0-9]{5,})/i);
          if (mpnMatch) {
            const mpn = mpnMatch[1].toUpperCase();
            const db = this._getLocalDB();
            const found = Object.values(db.parts || {}).find(
              (p) => p.manufacturerPartNumber?.toUpperCase().replace(/[^A-Z0-9]/g, "") === mpn.replace(/[^A-Z0-9]/g, "")
            );
            if (found) {
              toolsUsed.push("search_part");
              content = `**${found.title}** (${found.partSelectNumber || found.partNumber})\n\n`;
              content += `Manufacturer Part #: **${mpn}**\n`;
              if (found.price) content += `Price: **$${found.price}**  `;
              if (found.inStock) content += `Status: ✅ In Stock\n`;
              if (found.description) content += `\n${found.description.slice(0, 250)}`;
              const restOfQuery = query.slice(mpnMatch[0].length).trim();
              if (/not working|broken|fail|issue|problem/i.test(restOfQuery)) {
                const kbResult = productKnowledgeBase.searchBySymptom(restOfQuery + " " + found.title, found.applianceType);
                const guides = kbResult?.guides || [];
                if (guides.length > 0) {
                  const g = guides[0];
                  content += `\n\n**Troubleshooting: ${g.symptom}**\n`;
                  content += "Possible causes: " + g.possibleCauses.slice(0, 3).map(c => c).join(", ");
                }
              }
              currentTurnCards.push(this._partToCard(found));
            } else {
              content = `I couldn't find manufacturer part number **${mpn}** in my database. [Search on PartSelect](https://www.partselect.com/Search.aspx?SearchTerm=${encodeURIComponent(mpn)}).`;
            }
          }

        } else {
          // Try knowledge base for troubleshooting guides first
          const kbResult = productKnowledgeBase.searchBySymptom(query, appType);
          const guides = kbResult?.guides || [];
          const recParts = kbResult?.recommendedParts || [];

          if (guides.length > 0) {
            toolsUsed.push("troubleshoot_symptom");
            const g = guides[0];
            content = `**Troubleshooting: ${g.symptom}**\n\n`;
            content += "**Possible causes:**\n" + g.possibleCauses.map((c) => `- ${c}`).join("\n");
            content += "\n\n**Diagnostic steps:**\n" + g.diagnosticSteps.map((s, i) => `${i + 1}. ${s}`).join("\n");
            if (recParts.length > 0) {
              content += "\n\n**Recommended replacement parts:**\n" + recParts.map((p) => `- **${p.title}** (${p.partNumber})`).join("\n");
              recParts.forEach((p) => {
                const full = this._getLocalDB().parts?.[p.partNumber];
                if (full) currentTurnCards.push(this._partToCard(full));
              });
            }
          } else {
            // Keyword search: local DB first, then live scraping
            toolsUsed.push("search_parts_by_keyword");
            const db = this._getLocalDB();
            const cleanQuery = query.replace(/\b\d+\b|\b(parts?|units?|pieces?|items?|want|need|order|quantity|qty|in stock|available|is it|do you have)\b/gi, " ").trim();
            const keywords = cleanQuery.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const matches = Object.values(db.parts || {})
              .filter((p) => {
                if (appType && p.applianceType !== appType) return false;
                const text = `${p.title} ${p.description || ""} ${(p.symptoms || []).join(" ")}`.toLowerCase();
                return keywords.some(w => text.includes(w));
              })
              .slice(0, 5);

            if (matches.length > 0) {
              content = `Here are ${appType ? `**${appType}**` : ""} parts matching your search:\n\n`;
              matches.forEach((p) => {
                content += `- **${p.title}** (${p.partSelectNumber || p.partNumber})${p.price ? ` — $${p.price}` : ""}\n`;
              });
              matches.slice(0, 3).forEach((p) => currentTurnCards.push(this._partToCard(p)));
            } else {
              // Local DB empty for this query — try live scraping
              try {
                const liveResult = await executeToolCall("search_parts_by_keyword", { keyword: cleanQuery || query, applianceType: appType });
                if (liveResult?.parts?.length > 0) {
                  content = `Here are parts matching your search:\n\n`;
                  liveResult.parts.slice(0, 5).forEach((p) => {
                    content += `- **${p.title}** (${p.partNumber})${p.price ? ` — $${p.price}` : ""}\n`;
                  });
                  liveResult.parts.slice(0, 3).forEach((p) => currentTurnCards.push(this._partToCard(p)));
                } else {
                  const ps_url = `https://www.partselect.com/Search.aspx?SearchTerm=${encodeURIComponent(query)}`;
                  content = `I couldn't find matching parts right now.\n\n[Search on PartSelect →](${ps_url})`;
                }
              } catch {
                const ps_url = `https://www.partselect.com/Search.aspx?SearchTerm=${encodeURIComponent(query)}`;
                content = `I couldn't find matching parts right now.\n\n[Search on PartSelect →](${ps_url})`;
              }
            }
          }
        }

      } else {
        return await this._fallbackResponse(query, memory);
      }
    } catch (err) {
      console.error("Tool-only error:", err.message);
      return await this._fallbackResponse(query, memory);
    }

    memory.addAssistantMessage(content);
    const suggestions = this._generateSuggestions(content, memory);

    return {
      content,
      cards: currentTurnCards.filter(Boolean).slice(0, 5),
      suggestions,
      toolsUsed,
      meta: { agent: "tool-only", entities: { ...memory.entities } },
    };
  }

  // Search local DB first, then fall back to live scraping
  async _smartPartSearch(partNumber) {
    const normalized = partNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const db = this._getLocalDB();

    // 1. Direct PS# match in local DB
    if (db.parts?.[normalized]) return db.parts[normalized];

    // 2. Search by manufacturer part number (MPN)
    for (const p of Object.values(db.parts || {})) {
      if (p.manufacturerPartNumber?.toUpperCase().replace(/[^A-Z0-9]/g, "") === normalized) return p;
      if (p.replaces?.some?.((r) => r.toUpperCase().replace(/[^A-Z0-9]/g, "") === normalized)) return p;
    }

    // 3. Knowledge base
    const kb = productKnowledgeBase.getByPartNumber(partNumber);
    if (kb) return kb;

    // 4. Live scraping from PartSelect (the real deal — any part on the site)
    try {
      const result = await executeToolCall("search_part", { partNumber });
      if (result && result.title && !result.error) return result;
    } catch {}

    return null;
  }

  _getLocalDB() {
    if (!this._dbCache) {
      try {
        this._dbCache = loadProductDB();
      } catch {
        this._dbCache = { parts: {}, models: {} };
      }
    }
    return this._dbCache;
  }

  _partToCard(p) {
    if (!p) return null;
    const pn = p.partSelectNumber || p.partNumber;
    return {
      id: pn,
      title: p.title || pn,
      partNumber: pn,
      manufacturerPartNumber: p.manufacturerPartNumber || "",
      price: p.price || null,
      inStock: p.inStock !== false,
      rating: p.rating || null,
      fitment: p.fitment || (p.inStock ? "In Stock" : ""),
      summary: (p.description || p.summary || "").slice(0, 160),
      imageUrl: p.imageUrl || "",
      url: p.url || `https://www.partselect.com/${pn}-Part.htm`,
      cta: `How do I install ${pn}?`,
      ctaLabel: "Installation Guide",
    };
  }

  _formatResponse(content, memory) {
    const cards = this._extractCards(memory);
    const suggestions = this._generateSuggestions(content, memory);

    // Collect which tools were used in this turn
    const toolsUsed = memory.messages
      .filter((m) => m.role === "tool")
      .slice(-5)
      .map((m) => m.name)
      .filter(Boolean);

    return {
      content,
      cards,
      suggestions,
      toolsUsed: [...new Set(toolsUsed)],
      meta: {
        agent: "partbot-react",
        provider: this.llm.providerName,
        model: this.llm.model,
        entities: { ...memory.entities },
      },
    };
  }

  _extractCards(memory) {
    const cards = [];
    const recentTools = memory.messages
      .filter((m) => m.role === "tool")
      .slice(-4);

    for (const toolMsg of recentTools) {
      try {
        const data =
          typeof toolMsg.content === "string"
            ? JSON.parse(toolMsg.content)
            : toolMsg.content;

        // Single part result
        if (data.partSelectNumber || (data.partNumber && data.title)) {
          const pn = data.partSelectNumber || data.partNumber;
          cards.push({
            id: pn,
            title: data.title,
            partNumber: pn,
            manufacturerPartNumber: data.manufacturerPartNumber || "",
            price: data.price || null,
            inStock: data.inStock !== false,
            rating: data.rating || null,
            fitment: data.fitment || data.stockStatus || (data.inStock ? "In Stock" : ""),
            summary: (data.description || data.summary || "").slice(0, 180),
            imageUrl: data.imageUrl || "",
            url: data.url || `https://www.partselect.com/${pn}-Part.htm`,
            cta: `How do I install ${pn}?`,
            ctaLabel: "Installation Guide",
          });
        }

        // Compatibility result
        if (data.compatible !== undefined && data.partData) {
          const pd = data.partData;
          const pn = pd.partSelectNumber || pd.partNumber;
          cards.push({
            id: pn,
            title: pd.title,
            partNumber: pn,
            manufacturerPartNumber: pd.manufacturerPartNumber || "",
            price: pd.price || null,
            inStock: pd.inStock !== false,
            rating: pd.rating || null,
            fitment: data.compatible
              ? `✓ Compatible with ${data.modelNumber}`
              : `✗ Not confirmed for ${data.modelNumber}`,
            summary: (pd.description || "").slice(0, 180),
            imageUrl: pd.imageUrl || "",
            url: pd.url || "",
            cta: data.compatible
              ? `How do I install ${pn}?`
              : `Show parts for ${data.modelNumber}`,
            ctaLabel: data.compatible ? "Installation Guide" : "Compatible Parts",
          });
        }

        // Multiple parts (model search, keyword search)
        if (data.parts && Array.isArray(data.parts)) {
          for (const part of data.parts.slice(0, 4)) {
            const pn = part.partSelectNumber || part.partNumber;
            if (pn && !cards.find((c) => c.partNumber === pn)) {
              cards.push({
                id: pn,
                title: part.title,
                partNumber: pn,
                price: part.price || null,
                inStock: part.inStock !== false,
                fitment: part.fitment || "",
                summary: (part.description || part.summary || "").slice(0, 180),
                imageUrl: part.imageUrl || "",
                url: part.url || `https://www.partselect.com/${pn}-Part.htm`,
                cta: pn ? `Tell me about ${pn}` : "",
                ctaLabel: "View Details",
              });
            }
          }
        }

        // Semantic search results
        if (data.semanticResults && Array.isArray(data.semanticResults)) {
          for (const sr of data.semanticResults.slice(0, 3)) {
            if (!cards.find((c) => c.partNumber === sr.partNumber)) {
              cards.push({
                id: sr.partNumber,
                title: sr.title,
                partNumber: sr.partNumber,
                price: sr.price || null,
                fitment: `Relevance: ${Math.round(sr.score * 100)}%`,
                url: `https://www.partselect.com/${sr.partNumber}-Part.htm`,
                cta: `Tell me about ${sr.partNumber}`,
                ctaLabel: "View Details",
              });
            }
          }
        }
      } catch {
        // skip malformed
      }
    }

    // Deduplicate
    const seen = new Set();
    return cards
      .filter((c) => {
        if (!c.partNumber || seen.has(c.partNumber)) return false;
        seen.add(c.partNumber);
        return true;
      })
      .slice(0, 6);
  }

  _generateSuggestions(content, memory) {
    const suggestions = [];
    const pn = memory.getEntity("partNumber");
    const mn = memory.getEntity("modelNumber");

    if (pn && !/install/i.test(content)) {
      suggestions.push(`How do I install ${pn}?`);
    }
    if (pn && mn) {
      suggestions.push(`Is ${pn} compatible with ${mn}?`);
    }
    if (mn && !pn) {
      suggestions.push(`Show all parts for ${mn}`);
    }
    if (suggestions.length < 2) {
      if (!pn) suggestions.push("My fridge ice maker is not working");
      if (!mn) suggestions.push("Find parts for WDT780SAEM1");
    }

    return suggestions.slice(0, 3);
  }

  _buildOffTopicResponse(routing) {
    const isUnsupportedAppliance = routing?.entities?.unsupportedAppliance;
    const content = isUnsupportedAppliance
      ? "I specialize **only in refrigerator and dishwasher parts** on PartSelect. I'm not able to help with other appliances like dryers, ovens, washers, or microwaves.\n\n" +
        "For other appliances, please visit [partselect.com](https://www.partselect.com) directly.\n\n" +
        "Can I help you with a **refrigerator** or **dishwasher** part instead?"
      : "I'm **PartBot**, your PartSelect parts specialist! I can only help with **refrigerator** and **dishwasher** parts.\n\n" +
        "Here's what I can do:\n" +
        "- 🔍 Look up parts by number or model\n" +
        "- ✅ Check part compatibility\n" +
        "- 🔧 Provide installation instructions\n" +
        "- 🩺 Troubleshoot appliance issues\n" +
        "- 📦 Help with order & shipping\n\n" +
        "What can I help you with today?";
    return {
      content,
      cards: [],
      suggestions: [
        "My fridge ice maker isn't working",
        "Find parts for model WDT780SAEM1",
        "How do I install PS11752778?",
      ],
      meta: { agent: "scope-guard", intent: "off_topic" },
    };
  }

  _isConversationalFollowUp(query, memory) {
    const hasHistory = memory.messages.filter((m) => m.role === "assistant").length > 0;
    if (!hasHistory) return false;
    const hasPartNumber = /PS\d{6,}/i.test(query);
    const hasModelNumber = /\b[A-Z]{2,5}\d{3,}[A-Z0-9]*\b/i.test(query);
    // If the query has entities, it's a new query — BUT check if it's asking about
    // the same entity in context (e.g. "price for PS10065979" already handled elsewhere)
    const wordCount = query.trim().split(/\s+/).length;
    const q = query.trim().toLowerCase();

    // Pure context questions (no entities at all, very short)
    const isPureFollowUp = !hasPartNumber && !hasModelNumber && (
      /^(price\??|cost\??|reviews?\??|ratings?\??|how much\??|in stock\??|available\??|install\??|videos?\??|installation\??)$/i.test(q) ||
      /^(what can you do|what do you do|help|how (are|is) (this|that|it)|tell me more|more info|details|more details|show more|show all|only \w+\??|is this correct|is that right|how about|what about|any more|anything else)$/i.test(q) ||
      (wordCount <= 5 && /^(how (to|do|can)|what is|what are|tell me|show me|give me|any |are there)/i.test(q) && !hasPartNumber && !hasModelNumber)
    );

    return isPureFollowUp;
  }

  async _buildFollowUpResponse(query, memory) {
    const lastTool = memory.messages.filter((m) => m.role === "tool").slice(-1)[0];
    const queryLower = query.trim().toLowerCase();
    const db = this._getLocalDB();

    // Get last part context from memory
    const lastPartNumber = memory.getEntity("partNumber");
    const lastPart = lastPartNumber ? (db.parts?.[lastPartNumber] || productKnowledgeBase.getByPartNumber(lastPartNumber)) : null;

    // General knowledge questions about parts terminology
    if (/\b(what (is|does|are|means?|stand for)|explain|define|meaning of)\b.*(mpn|oem|part number|ps#|sku|compatibility)/i.test(queryLower) ||
        /^(what (is|does)?\s*(an?\s*)?(mpn|oem|ps number|part number|sku)\b)/i.test(queryLower)) {
      if (/mpn/i.test(queryLower)) {
        return "**MPN (Manufacturer Part Number)** is the part number assigned by the original manufacturer (e.g. Whirlpool, GE, Samsung).\n\n" +
          "- **PS#** (PartSelect Number) is our own catalog number (e.g. PS11752778)\n" +
          "- **MPN** is the manufacturer's number (e.g. WPW10321304)\n\n" +
          "Both refer to the same part. You can search by either one on PartSelect. If you have an MPN like `W10195416`, just enter it and I'll find the part for you.";
      }
      if (/oem/i.test(queryLower)) {
        return "**OEM (Original Equipment Manufacturer)** parts are made by the same company that built your appliance.\n\n" +
          "PartSelect sells **genuine OEM parts** — guaranteed to fit and backed by a 1-year warranty. They're more reliable than generic aftermarket parts.";
      }
    }

    // "what can you do" / "help" / capability question
    if (/^(what can you do|what do you do|help|capabilities|features?)$/i.test(queryLower)) {
      return (
        "I'm **PartBot**, your PartSelect appliance parts assistant! Here's what I can do:\n\n" +
        "- 🔍 **Look up any part** by PS number (e.g. PS11752778)\n" +
        "- 📋 **Find parts for your model** (e.g. WDT780SAEM1)\n" +
        "- ✅ **Check if a part fits** your specific appliance\n" +
        "- 🔧 **Provide installation guides** with step-by-step instructions\n" +
        "- 🩺 **Troubleshoot issues** like ice maker problems or door not closing\n" +
        "- 💰 **Show prices and availability** for any part\n" +
        "- 📦 **Answer order/shipping questions**\n\n" +
        "Try asking: _\"Show me parts for WDT780SAEM1\"_ or _\"How do I install PS11752778?\"_"
      );
    }

    // "price?" / "cost?" / "how much?" — use last part context
    if (/^(price\??|cost\??|how much\??|what.?s the price|pricing)$/i.test(queryLower)) {
      if (lastPart) {
        return `**${lastPart.title}** (${lastPart.partSelectNumber || lastPart.partNumber}) is priced at **$${lastPart.price || "—"}**${lastPart.inStock ? " and is ✅ in stock" : ""}.\n\n[View on PartSelect](https://www.partselect.com/${lastPart.partSelectNumber || lastPart.partNumber}-Part.htm)`;
      }
      return "Which part would you like the price for? Please provide a part number (e.g. PS11752778).";
    }

    // "reviews?" / "ratings?" / "how is this product?"
    if (/^(reviews?\??|ratings?\??|how (is|are) (this|that|it|the) (product|part)\??)$/i.test(queryLower) ||
        /how (good|bad|well)/i.test(queryLower)) {
      if (lastPart && lastPart.rating) {
        return `**${lastPart.title}** has a rating of **${lastPart.rating}/5** from ${lastPart.reviewCount || "verified"} customers.\n\n${lastPart.repairStories?.length ? "**Customer feedback:**\n" + lastPart.repairStories.slice(0, 2).map(s => `> ${s.slice(0, 120)}`).join("\n\n") : ""}\n\n[Read all reviews on PartSelect](${lastPart.url || `https://www.partselect.com/${lastPart.partSelectNumber}-Part.htm`})`;
      }
      if (lastPart) {
        return `I don't have review data for **${lastPart.title}** in my database. [Read reviews on PartSelect](https://www.partselect.com/${lastPart.partSelectNumber || lastPart.partNumber}-Part.htm).`;
      }
      return "Which part would you like reviews for? Please share the part number.";
    }

    // "video?" / "videos?" / "installation video" — show install video for last part
    if (/^(videos?\??|installation video|watch video|show video|play video)$/i.test(queryLower)) {
      if (lastPart) {
        const videoUrl = lastPart.installVideoUrl || lastPart.videoUrls?.[0];
        if (videoUrl) {
          return `📹 **Installation Video: ${lastPart.title}**\n\n[Watch on YouTube →](${videoUrl})\n\nThis video shows step-by-step how to install this part.`;
        }
        // Try live scraping to get the video
        try {
          const live = await this._smartPartSearch(lastPart.partSelectNumber || lastPart.partNumber);
          if (live?.installVideoUrl) {
            return `📹 **Installation Video: ${live.title}**\n\n[Watch on YouTube →](${live.installVideoUrl})\n\nThis video shows step-by-step how to install this part.`;
          }
        } catch {}
        return `I don't have a video for **${lastPart.title}** in my current data. You can find installation videos on the [product page](${lastPart.url || `https://www.partselect.com/${lastPart.partSelectNumber}-Part.htm`}).`;
      }
      return "Which part would you like to see an installation video for? Please share the part number.";
    }

    // "how to install" / "install?" / "installation?" without specifying part
    if (/^(install\??|installation\??|how (to|do i) install|how (to|do i) replace|how (to|do i) fix)$/i.test(queryLower)) {
      if (lastPart) {
        const steps = lastPart.installSteps || lastPart.repairStories;
        if (steps?.length) {
          return `**Installation Guide: ${lastPart.title}** (${lastPart.partSelectNumber || lastPart.partNumber})\n\n` +
            steps.slice(0, 3).map((s, i) => `${i + 1}. ${s.slice(0, 160)}`).join("\n");
        }
        return `For **${lastPart.title}**, please visit the PartSelect product page for installation videos:\n[${lastPart.url || `https://www.partselect.com/${lastPart.partSelectNumber}-Part.htm`}](${lastPart.url || `https://www.partselect.com/${lastPart.partSelectNumber}-Part.htm`})`;
      }
      return "Which part would you like installation instructions for? Please share the part number.";
    }

    // Quantity questions ("100 parts", "order 5", "bulk")
    if (/\b\d+\s+(part|unit|piece|item|pack|set|quantity|qty|order|need)\b/i.test(queryLower) ||
        /\b(bulk|quantity|how many|multiple|order \d+)/i.test(queryLower)) {
      if (lastPart) {
        return `**${lastPart.title}** (${lastPart.partSelectNumber || lastPart.partNumber}) is ${lastPart.inStock ? "✅ **in stock**" : "currently unavailable"}.\n\nFor bulk or quantity orders, please contact PartSelect directly:\n- 📞 **1-866-319-8402** (Mon-Sat 8am-8pm EST)\n- 🌐 [partselect.com](https://www.partselect.com)\n\nStandard orders ship same-day if placed by 8pm EST.`;
      }
      return "For bulk or quantity orders, please contact PartSelect at **1-866-319-8402** (Mon-Sat, 8am-8pm EST) or visit [partselect.com](https://www.partselect.com).";
    }

    // "in stock?" / "available?" / "[part name] available?"
    if (/\b(in stock|available|stock|availability)\b/i.test(queryLower) || /available\??$/i.test(queryLower)) {
      if (lastPart) {
        const pn = lastPart.partSelectNumber || lastPart.partNumber;
        const inStock = lastPart.inStock;
        return `**${lastPart.title}** (${pn}) — **$${lastPart.price || "—"}**\n\n` +
          (inStock
            ? `✅ **In Stock** — ready to ship. Order by 8pm EST for same-day shipping.\n\n[Buy on PartSelect →](https://www.partselect.com/${pn}-Part.htm)`
            : `❌ Currently out of stock. [Check PartSelect](https://www.partselect.com/${pn}-Part.htm) for updates.`);
      }
      return "Which part would you like to check availability for? Please share the part number.";
    }

    // "Only five?" / "Show more" / "Show all" / "How many?"
    if (/only \w+\??|show (me )?(more|all)|how many|more parts?|not enough/i.test(queryLower)) {
      const appType = memory.getEntity("applianceType");
      if (appType) {
        const allParts = Object.values(db.parts || {}).filter((p) => p.applianceType === appType);
        const total = allParts.length;
        return (
          `My local database has **${total} ${appType} parts** loaded.\n\n` +
          allParts.map((p) => `- **${p.title}** (${p.partSelectNumber || p.partNumber}) — $${p.price || "—"}`).join("\n") +
          `\n\nFor the complete PartSelect catalog with thousands of ${appType} parts, visit [partselect.com](https://www.partselect.com/${appType === "refrigerator" ? "Refrigerator" : "Dishwasher"}-Parts.htm).`
        );
      }
      const totalParts = Object.keys(db.parts || {}).length;
      return `I have **${totalParts} parts** in my local database (${Object.values(db.parts || {}).filter(p => p.applianceType === "refrigerator").length} refrigerator, ${Object.values(db.parts || {}).filter(p => p.applianceType === "dishwasher").length} dishwasher).\n\nFor the full catalog, browse [partselect.com](https://www.partselect.com).`;
    }

    // "Is this correct?" / "Right?" / "Accurate?"
    if (/is this (correct|right|accurate)\??|correct\??|right\??/i.test(queryLower)) {
      return "Yes, this information comes directly from PartSelect's product database. For the most up-to-date details, you can verify on [partselect.com](https://www.partselect.com).";
    }

    // "Did all" / "Tried everything" / "Nothing works"
    if (/did all|tried (all|that|everything)|nothing (work|help)/i.test(queryLower)) {
      // User tried the diagnostic steps and nothing worked
      const lastPartNumber = memory.getEntity("partNumber");
      const appType = memory.getEntity("applianceType") || "refrigerator";

      if (lastTool) {
        try {
          const toolData = JSON.parse(lastTool.content);
          const recParts = toolData.knowledgeBaseMatches?.recommendedParts || [];
          if (recParts.length > 0) {
            return (
              "Since the diagnostic steps didn't resolve the issue, the problem is likely a **faulty part** that needs replacement.\n\n" +
              "**Recommended replacement parts:**\n" +
              recParts.map((p) => `- **${p.title}** (${p.partNumber}) — $${p.price || "check site"}`).join("\n") +
              "\n\nWould you like installation instructions for any of these parts?"
            );
          }
        } catch {}
      }

      return (
        `If you've checked everything and the issue persists, you likely need to replace a part. ` +
        `For a ${appType}, I recommend searching on [PartSelect.com](https://www.partselect.com) for your model's parts, ` +
        `or provide your **model number** (found inside the door) and I'll look up compatible replacement parts for you.`
      );
    }

    if (/still (not|won't)|doesn't (work|fix)|same (problem|issue)/i.test(queryLower)) {
      return (
        "If the issue persists after trying those steps, the component itself is likely faulty and needs replacement. " +
        "Can you share your **appliance model number**? I'll find the exact replacement part for you."
      );
    }

    if (/yes|ok|okay|done|sure|got it/i.test(queryLower)) {
      return (
        "Great! What else can I help you with? If you need a replacement part, just share the **part number** or **model number** and I'll look it up."
      );
    }

    // Generic contextual follow-up
    return (
      "I understand. Could you tell me more about what you're experiencing? " +
      "Sharing your **appliance model number** would help me find the exact parts you need."
    );
  }

  async _fallbackResponse(query, memory) {
    // Try knowledge base first
    const result = productKnowledgeBase.search(query);
    if (result) {
      memory.addAssistantMessage(result.content);
      return result;
    }

    // Try a keyword search as last resort
    try {
      const searchResult = await executeToolCall("search_parts_by_keyword", {
        keyword: query,
      });
      if (searchResult.parts?.length > 0) {
        const content = `Here are some results for **"${query}"**:\n\n` +
          searchResult.parts.slice(0, 4).map((p) =>
            `- **${p.title}** (${p.partNumber})${p.price ? ` — $${p.price}` : ""}`
          ).join("\n");
        memory.addAssistantMessage(content);
        memory.addToolResult("search_parts_by_keyword", searchResult);
        return {
          content,
          cards: this._extractCards(memory),
          suggestions: this._generateSuggestions(content, memory),
          toolsUsed: ["search_parts_by_keyword"],
          meta: { agent: "fallback-search" },
        };
      }
    } catch {}

    const content =
      "I'd be happy to help! Try one of these:\n\n" +
      "- Enter a **part number** (e.g. PS11752778)\n" +
      "- Enter a **model number** (e.g. WDT780SAEM1)\n" +
      "- Describe your **appliance problem**";
    memory.addAssistantMessage(content);

    return {
      content,
      cards: [],
      suggestions: [
        "How do I install PS11752778?",
        "Show parts for WDT780SAEM1",
        "My fridge ice maker isn't working",
      ],
      meta: { agent: "fallback" },
    };
  }
}
