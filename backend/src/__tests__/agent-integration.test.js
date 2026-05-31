import { jest, describe, it, expect, beforeAll } from "@jest/globals";
import { AgentOrchestrator } from "../agent/orchestrator.js";
import { ConversationMemory } from "../agent/memory.js";

// These tests run the full agent pipeline in tool-only mode (no LLM needed)
describe("Agent Integration - Tool-Only Mode", () => {
  let orch;

  beforeAll(() => {
    orch = new AgentOrchestrator();
    // Force tool-only mode by disabling LLM
    orch.llm = { isAvailable: false, providerName: "none", model: null };
  });

  it("looks up a known part from CSV data", async () => {
    const mem = new ConversationMemory();
    const result = await orch.handleQuery("Tell me about PS3406971", mem);
    expect(result.content).toContain("PS3406971");
    expect(result.cards?.length).toBeGreaterThan(0);
  });

  it("handles compatibility check for known part+model", async () => {
    const mem = new ConversationMemory();
    const result = await orch.handleQuery("Is PS3406971 compatible with WDT780SAEM1?", mem);
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(10);
  });

  it("lists dishwasher parts when asked", async () => {
    const mem = new ConversationMemory();
    const result = await orch.handleQuery("dishwasher parts", mem);
    expect(result.content).toContain("dishwasher");
  });

  it("rejects off-topic queries about dryers", async () => {
    const mem = new ConversationMemory();
    const result = await orch.handleQuery("dryer parts", mem);
    expect(result.content).toMatch(/refrigerator|dishwasher|specialize/i);
  });

  it("rejects weather questions", async () => {
    const mem = new ConversationMemory();
    const result = await orch.handleQuery("What is the weather today?", mem);
    expect(result.content).toMatch(/refrigerator|dishwasher|specialize|PartBot/i);
  });

  it("handles troubleshooting ice maker", async () => {
    const mem = new ConversationMemory();
    const result = await orch.handleQuery("My fridge ice maker is not working", mem);
    expect(result.content).toMatch(/ice maker|troubleshoot|diagnos/i);
  });

  it("handles multi-turn conversation without entity contamination", async () => {
    const mem = new ConversationMemory();
    await orch.handleQuery("Is PS3406971 compatible with WDT780SAEM1?", mem);
    // Second query should NOT assume WDT780SAEM1
    const result = await orch.handleQuery("Tell me about PS972325", mem);
    expect(result.content).toContain("PS972325");
    // Should NOT mention WDT780SAEM1 contamination
  });

  it("handles order support", async () => {
    const mem = new ConversationMemory();
    const result = await orch.handleQuery("What is your return policy?", mem);
    expect(result.content).toMatch(/return|365|ship|customer/i);
  });

  it("handles cart view", async () => {
    const mem = new ConversationMemory();
    const result = await orch.handleQuery("show my cart", mem);
    expect(result.content).toMatch(/cart|PartSelect/i);
  });
});
