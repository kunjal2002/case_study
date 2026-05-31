import { jest, describe, it, expect } from "@jest/globals";
import { classifyIntent } from "../agents/router-agent.js";

describe("Router Agent - Intent Classification", () => {
  describe("Part Lookup", () => {
    it("detects PS part number", () => {
      const result = classifyIntent("Tell me about PS11752778");
      expect(result.intent).toBe("part_lookup");
      expect(result.entities.partNumber).toBe("PS11752778");
    });

    it("detects part number query", () => {
      const result = classifyIntent("Find part PS3406971");
      expect(result.intent).toBe("part_lookup");
      expect(result.entities.partNumber).toBe("PS3406971");
    });
  });

  describe("Model Search", () => {
    it("detects model number search", () => {
      const result = classifyIntent("Show me parts for WDT780SAEM1");
      expect(result.intent).toBe("model_search");
      expect(result.entities.modelNumber).toBe("WDT780SAEM1");
    });

    it("detects model-only query", () => {
      const result = classifyIntent("What parts fit model WRS325SDHZ08?");
      expect(result.intent).toBe("model_search");
      expect(result.entities.modelNumber).toBe("WRS325SDHZ08");
    });
  });

  describe("Compatibility Check", () => {
    it("detects part + model compatibility", () => {
      const result = classifyIntent(
        "Is PS11752778 compatible with WDT780SAEM1?"
      );
      expect(result.intent).toBe("compatibility_check");
      expect(result.entities.partNumber).toBe("PS11752778");
      expect(result.entities.modelNumber).toBe("WDT780SAEM1");
    });

    it("detects 'does it fit' query", () => {
      const result = classifyIntent(
        "Does PS3406971 fit my WDT780SAEM1 model?"
      );
      expect(result.intent).toBe("compatibility_check");
    });
  });

  describe("Installation Help", () => {
    it("detects install query with part number", () => {
      const result = classifyIntent("How can I install part PS11752778?");
      expect(result.intent).toBe("installation_help");
      expect(result.entities.partNumber).toBe("PS11752778");
    });

    it("detects replacement guide request", () => {
      const result = classifyIntent("Step by step guide to replace my ice maker");
      expect(result.intent).toBe("installation_help");
    });
  });

  describe("Troubleshooting", () => {
    it("detects ice maker problem", () => {
      const result = classifyIntent(
        "The ice maker on my Whirlpool fridge is not working"
      );
      expect(result.intent).toBe("troubleshooting");
      expect(result.entities.applianceType).toBe("refrigerator");
    });

    it("detects dishwasher not draining", () => {
      const result = classifyIntent("My dishwasher won't drain");
      expect(result.intent).toBe("troubleshooting");
      expect(result.entities.applianceType).toBe("dishwasher");
    });

    it("detects leaking problem", () => {
      const result = classifyIntent("My refrigerator is leaking water");
      expect(result.intent).toBe("troubleshooting");
    });
  });

  describe("Order Support", () => {
    it("detects shipping question", () => {
      const result = classifyIntent("How long does shipping take?");
      expect(result.intent).toBe("order_support");
    });

    it("detects return policy question", () => {
      const result = classifyIntent("What is your return policy?");
      expect(result.intent).toBe("order_support");
    });

    it("detects order tracking", () => {
      const result = classifyIntent("Where is my order?");
      expect(result.intent).toBe("order_support");
    });
  });

  describe("Off-topic Rejection", () => {
    it("rejects weather questions", () => {
      const result = classifyIntent("What's the weather like today?");
      expect(result.intent).toBe("off_topic");
    });

    it("rejects sports questions", () => {
      const result = classifyIntent("Who won the football game?");
      expect(result.intent).toBe("off_topic");
    });

    it("rejects recipe questions", () => {
      const result = classifyIntent("How do I bake a chocolate cake?");
      expect(result.intent).toBe("off_topic");
    });

    it("does NOT reject appliance-related queries", () => {
      const result = classifyIntent("My refrigerator temperature is wrong");
      expect(result.intent).not.toBe("off_topic");
    });
  });

  describe("Entity Extraction", () => {
    it("extracts appliance type from context", () => {
      const result = classifyIntent("My dishwasher door is broken");
      expect(result.entities.applianceType).toBe("dishwasher");
    });

    it("extracts refrigerator from 'fridge'", () => {
      const result = classifyIntent("My fridge is making noise");
      expect(result.entities.applianceType).toBe("refrigerator");
    });

    it("extracts both part and model from complex query", () => {
      const result = classifyIntent(
        "Will PS11752778 work with my WRS325SDHZ08 refrigerator?"
      );
      expect(result.entities.partNumber).toBe("PS11752778");
      expect(result.entities.modelNumber).toBe("WRS325SDHZ08");
    });
  });
});
