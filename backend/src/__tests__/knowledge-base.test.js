import { jest, describe, it, expect } from "@jest/globals";
import { productKnowledgeBase } from "../agent/knowledge-base.js";

describe("Knowledge Base", () => {
  describe("Part Lookup", () => {
    it("returns null for any part number (no hardcoded parts)", () => {
      const result = productKnowledgeBase.getByPartNumber("PS11752778");
      expect(result).toBeNull();
    });

    it("returns null for unknown parts", () => {
      const result = productKnowledgeBase.getByPartNumber("PS99999999");
      expect(result).toBeNull();
    });
  });

  describe("Model Search", () => {
    it("returns empty array (no hardcoded models)", () => {
      const results = productKnowledgeBase.getByModel("WDT780SAEM1");
      expect(results.length).toBe(0);
    });
  });

  describe("Symptom Search", () => {
    it("finds ice maker troubleshooting guide", () => {
      const result = productKnowledgeBase.searchBySymptom(
        "ice maker not working",
        "refrigerator"
      );
      expect(result.guides.length).toBeGreaterThan(0);
      expect(result.guides[0].symptom).toBe("ice maker not working");
    });

    it("finds dishwasher not cleaning guide", () => {
      const result = productKnowledgeBase.searchBySymptom(
        "not cleaning dishes",
        "dishwasher"
      );
      expect(result.guides.length).toBeGreaterThan(0);
    });

    it("finds dishwasher not draining guide", () => {
      const result = productKnowledgeBase.searchBySymptom(
        "not draining",
        "dishwasher"
      );
      expect(result.guides.length).toBeGreaterThan(0);
    });

    it("finds refrigerator not cooling guide", () => {
      const result = productKnowledgeBase.searchBySymptom(
        "not cooling",
        "refrigerator"
      );
      expect(result.guides.length).toBeGreaterThan(0);
      expect(result.guides[0].possibleCauses.length).toBeGreaterThan(0);
    });

    it("filters by appliance type", () => {
      const result = productKnowledgeBase.searchBySymptom(
        "door problem",
        "dishwasher"
      );
      expect(result.guides.length).toBeGreaterThan(0);
      result.guides.forEach((g) => {
        expect(g.applianceType).toBe("dishwasher");
      });
    });

    it("returns diagnostic steps", () => {
      const result = productKnowledgeBase.searchBySymptom(
        "leaking",
        "refrigerator"
      );
      expect(result.guides.length).toBeGreaterThan(0);
      expect(result.guides[0].diagnosticSteps.length).toBeGreaterThan(0);
    });

    it("returns recommended part types (not specific PS numbers)", () => {
      const result = productKnowledgeBase.searchBySymptom(
        "ice maker not working",
        "refrigerator"
      );
      expect(result.guides[0].recommendedPartTypes).toBeDefined();
      expect(result.guides[0].recommendedPartTypes.length).toBeGreaterThan(0);
      // Should be generic names, not PS numbers
      result.guides[0].recommendedPartTypes.forEach((t) => {
        expect(t).not.toMatch(/^PS\d+/);
      });
    });
  });

  describe("Full Text Search", () => {
    it("returns null (no hardcoded search results)", () => {
      const result = productKnowledgeBase.search("PS11752778");
      expect(result).toBeNull();
    });
  });
});
