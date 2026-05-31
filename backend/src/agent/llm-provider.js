/**
 * LLM Provider - Provider-agnostic interface supporting OpenAI, Gemini, and Ollama.
 * 
 * Selection priority (reliability-first for interview demos):
 *   1. OPENAI_API_KEY → OpenAI GPT-4o-mini (paid, $0.15/1M tokens, NEVER rate-limited)
 *   2. GEMINI_API_KEY → Google Gemini 2.0 Flash (free but has daily limits)
 *   3. OLLAMA_HOST   → Local Ollama (free, requires local install)
 * 
 * All providers expose the same interface for tool-calling agent loops.
 */
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

export class LLMProvider {
  constructor() {
    this.provider = null;
    this.gemini = null;
    this.openai = null;
    this.ollamaHost = null;

    const isValidKey = (key) =>
      key && key.length > 10 && !/your|here|example|xxx/i.test(key);

    // Auto-detect: if a key is in the wrong env var, fix it
    // Gemini keys start with "AI" or contain dots; OpenAI keys start with "sk-"
    const geminiKey = process.env.GEMINI_API_KEY;
    let openaiKey = process.env.OPENAI_API_KEY;

    // Auto-detect: if OPENAI_API_KEY doesn't look like an OpenAI key, treat as Gemini
    if (isValidKey(openaiKey) && !openaiKey.startsWith("sk-")) {
      if (!isValidKey(geminiKey)) {
        process.env.GEMINI_API_KEY = openaiKey;
        console.log("[LLM] Auto-detected: OPENAI_API_KEY looks like a Gemini key, using it as Gemini.");
      }
      openaiKey = null;
    }

    // Priority: OpenAI (reliable, paid) → Gemini (free) → Ollama (local)
    if (isValidKey(openaiKey) && openaiKey.startsWith("sk-")) {
      this.provider = "openai";
      this.openai = new OpenAI({ apiKey: openaiKey });
      this.model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    } else if (isValidKey(process.env.GEMINI_API_KEY)) {
      this.provider = "gemini";
      this.gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      this.model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
      this.fallbackModel = "gemini-2.0-flash-lite";
      this._quotaExhaustedForModel = {};
    } else if (process.env.OLLAMA_HOST) {
      this.provider = "ollama";
      this.ollamaHost = process.env.OLLAMA_HOST;
      this.model = process.env.OLLAMA_MODEL || "llama3.1";
    } else {
      console.warn(
        "[LLM] No valid API key found. Please set one in backend/.env:\n" +
        "  GEMINI_API_KEY=... (free at https://aistudio.google.com/apikey)\n" +
        "  OPENAI_API_KEY=sk-...\n" +
        "  OLLAMA_HOST=http://localhost:11434"
      );
      this.provider = "none";
    }

    console.log(`[LLM] Provider: ${this.provider} | Model: ${this.model || "none"}`);
  }

  get isAvailable() {
    return this.provider !== "none";
  }

  get providerName() {
    return this.provider;
  }

  /**
   * Run a chat completion with optional tool calling.
   * Includes automatic retry with backoff for transient errors (503, rate limits).
   * Returns { content: string, toolCalls: Array<{name, args, id}> }
   */
  async chatCompletion(messages, tools = [], options = {}) {
    const maxRetries = 1;
    let lastError;

    // For Gemini, try primary then lite model on quota exhaustion
    const modelsToTry = (this.provider === "gemini" && this.fallbackModel)
      ? [this.model, this.fallbackModel]
      : [this.model];

    for (const modelToUse of modelsToTry) {
      // Skip models we know are quota-exhausted this session
      if (this._quotaExhaustedForModel?.[modelToUse]) continue;

      const optionsWithModel = { ...options, _modelOverride: modelToUse };

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          switch (this.provider) {
            case "gemini":
              return await this._geminiCompletion(messages, tools, optionsWithModel);
            case "openai":
              return await this._openaiCompletion(messages, tools, optionsWithModel);
            case "ollama":
              return await this._ollamaCompletion(messages, tools, optionsWithModel);
            default:
              throw new Error("No LLM provider configured");
          }
        } catch (err) {
          lastError = err;
          const errText = String(err?.status || "") + String(err?.message || "");
          const isQuota = /429|RESOURCE_EXHAUSTED|quota/i.test(errText);
          const isTransient = /503|UNAVAILABLE|overloaded/i.test(errText);

          if (isQuota) {
            console.log(`[LLM] Quota exhausted for ${modelToUse}, trying fallback...`);
            if (this._quotaExhaustedForModel) this._quotaExhaustedForModel[modelToUse] = true;
            break; // Try next model
          }
          if (isTransient && attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          throw err;
        }
      }
    }
    throw lastError || new Error("All LLM models exhausted");
  }

  async _geminiCompletion(messages, tools, options) {
    const activeModel = options._modelOverride || this.model;
    const geminiTools = tools.length > 0
      ? [{ functionDeclarations: tools.map((t) => this._toGeminiTool(t)) }]
      : undefined;

    // Convert messages to Gemini format
    const contents = [];
    let systemInstruction = undefined;

    for (const msg of messages) {
      if (msg.role === "system") {
        systemInstruction = msg.content;
        continue;
      }
      if (msg.role === "user") {
        contents.push({ role: "user", parts: [{ text: msg.content }] });
      } else if (msg.role === "assistant") {
        if (msg.tool_calls) {
          const parts = msg.tool_calls.map((tc) => ({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments),
            },
          }));
          contents.push({ role: "model", parts });
        } else {
          contents.push({ role: "model", parts: [{ text: msg.content || "" }] });
        }
      } else if (msg.role === "tool") {
        contents.push({
          role: "user",
          parts: [{
            functionResponse: {
              name: msg.name || "tool_result",
              response: { result: msg.content },
            },
          }],
        });
      }
    }

    const config = {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.max_tokens ?? 1200,
    };

    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    if (geminiTools) {
      config.tools = geminiTools;
    }

    if (activeModel !== this.model) {
      console.log(`[LLM] Using fallback model: ${activeModel}`);
    }

    const response = await this.gemini.models.generateContent({
      model: activeModel,
      contents,
      config,
    });

    // Extract function calls if present
    const functionCalls = response.functionCalls || [];
    if (functionCalls.length > 0) {
      return {
        content: null,
        toolCalls: functionCalls.map((fc, idx) => ({
          id: fc.id || `call_${Date.now()}_${idx}`,
          name: fc.name,
          args: fc.args || {},
        })),
        raw: response,
      };
    }

    return {
      content: response.text || "",
      toolCalls: [],
      raw: response,
    };
  }

  async _openaiCompletion(messages, tools, options) {
    const openaiTools = tools.length > 0
      ? tools.map((t) => ({
          type: "function",
          function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          },
        }))
      : undefined;

    const completion = await this.openai.chat.completions.create({
      model: this.model,
      messages,
      tools: openaiTools,
      tool_choice: openaiTools ? "auto" : undefined,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.max_tokens ?? 1200,
    });

    const choice = completion.choices[0];
    const assistantMsg = choice.message;

    if (assistantMsg.tool_calls?.length > 0) {
      return {
        content: null,
        toolCalls: assistantMsg.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        })),
        raw: assistantMsg,
      };
    }

    return {
      content: assistantMsg.content || "",
      toolCalls: [],
      raw: assistantMsg,
    };
  }

  async _ollamaCompletion(messages, tools, options) {
    const body = {
      model: this.model,
      messages,
      stream: false,
      options: { temperature: options.temperature ?? 0.3 },
    };

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }));
    }

    const response = await fetch(`${this.ollamaHost}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    const msg = data.message;

    if (msg.tool_calls?.length > 0) {
      return {
        content: null,
        toolCalls: msg.tool_calls.map((tc, idx) => ({
          id: `ollama_${Date.now()}_${idx}`,
          name: tc.function.name,
          args: tc.function.arguments,
        })),
        raw: msg,
      };
    }

    return {
      content: msg.content || "",
      toolCalls: [],
      raw: msg,
    };
  }

  _toGeminiTool(openaiTool) {
    const fn = openaiTool.function;
    return {
      name: fn.name,
      description: fn.description,
      parameters: this._convertSchemaToGemini(fn.parameters),
    };
  }

  _convertSchemaToGemini(schema) {
    if (!schema) return undefined;
    const result = { type: schema.type?.toUpperCase() || "OBJECT" };
    if (schema.description) result.description = schema.description;
    if (schema.properties) {
      result.properties = {};
      for (const [key, val] of Object.entries(schema.properties)) {
        result.properties[key] = this._convertSchemaToGemini(val);
      }
    }
    if (schema.required) result.required = schema.required;
    if (schema.enum) result.enum = schema.enum;
    if (schema.items) result.items = this._convertSchemaToGemini(schema.items);
    return result;
  }
}

export const llmProvider = new LLMProvider();
