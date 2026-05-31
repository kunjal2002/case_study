/**
 * Troubleshooting Knowledge Base
 * 
 * Contains ONLY troubleshooting guides with symptom → cause → diagnostic steps.
 * NO hardcoded part numbers — all product data comes from the CSV database
 * and live scraping to ensure accuracy.
 */

// Troubleshooting guides — generic (no specific PS numbers, just part TYPE names)
const TROUBLESHOOTING_GUIDES = [
  {
    applianceType: "refrigerator",
    symptom: "ice maker not working",
    possibleCauses: [
      "Water inlet valve failure",
      "Ice maker assembly malfunction",
      "Freezer temperature too warm (should be 0°F / -18°C)",
      "Water filter clogged",
      "Water line frozen"
    ],
    diagnosticSteps: [
      "Check freezer temperature — it should be at 0°F (-18°C) or below",
      "Verify water supply: locate the shutoff valve and ensure it's fully open",
      "Inspect the water filter — replace if older than 6 months",
      "Listen for the ice maker cycling (clicking/buzzing every few hours)",
      "Check if the ice maker arm/switch is in the ON position"
    ],
    recommendedPartTypes: ["Ice Maker Assembly", "Water Inlet Valve", "Water Filter"]
  },
  {
    applianceType: "refrigerator",
    symptom: "not cooling",
    possibleCauses: [
      "Evaporator fan motor failure",
      "Condenser coils dirty",
      "Compressor relay failure",
      "Thermostat malfunction",
      "Defrost system failure"
    ],
    diagnosticSteps: [
      "Check if the freezer is still cold — if yes, the evaporator fan may be the issue",
      "Clean the condenser coils (located behind or underneath the fridge)",
      "Listen for compressor running — a clicking sound means the relay may be bad",
      "Verify thermostat settings haven't been changed accidentally",
      "Check for excessive frost on the evaporator (indicates defrost failure)"
    ],
    recommendedPartTypes: ["Evaporator Fan Motor", "Condenser Fan Motor", "Compressor Start Relay"]
  },
  {
    applianceType: "refrigerator",
    symptom: "leaking",
    possibleCauses: [
      "Door gasket worn or damaged",
      "Water inlet valve leaking",
      "Drain line clogged",
      "Ice maker overflow"
    ],
    diagnosticSteps: [
      "Check door gasket for cracks or gaps — close the door on a dollar bill, if it slides out easily the gasket needs replacing",
      "Inspect the water line connection behind the fridge",
      "Check the drain pan under the fridge for overflow",
      "Look for ice buildup in the freezer drain"
    ],
    recommendedPartTypes: ["Door Gasket", "Water Inlet Valve"]
  },
  {
    applianceType: "dishwasher",
    symptom: "not cleaning dishes",
    possibleCauses: [
      "Spray arm clogged or cracked",
      "Water inlet valve insufficient pressure",
      "Detergent dispenser not opening",
      "Wash motor failure",
      "Filter clogged"
    ],
    diagnosticSteps: [
      "Remove and inspect spray arms for clogs — clean holes with a toothpick",
      "Run hot water at the kitchen sink before starting the dishwasher",
      "Check that the detergent dispenser opens during the cycle",
      "Ensure dishes aren't blocking the spray arm rotation",
      "Clean the dishwasher filter (located at the bottom of the tub)"
    ],
    recommendedPartTypes: ["Spray Arm", "Water Inlet Valve", "Dishwasher Filter"]
  },
  {
    applianceType: "dishwasher",
    symptom: "not draining",
    possibleCauses: [
      "Drain pump motor failure",
      "Drain hose kinked or clogged",
      "Check valve stuck",
      "Garbage disposal knockout plug not removed"
    ],
    diagnosticSteps: [
      "Check the drain hose for kinks or clogs",
      "Run the garbage disposal to clear any blockage",
      "Listen for the drain pump running during the drain cycle",
      "Inspect the drain pump for debris",
      "Check if the knockout plug was removed from the garbage disposal connection"
    ],
    recommendedPartTypes: ["Drain Pump", "Check Valve"]
  },
  {
    applianceType: "dishwasher",
    symptom: "door problem",
    possibleCauses: [
      "Door balance link broken",
      "Door spring stretched or detached",
      "Hinge pin worn",
      "Door latch failure"
    ],
    diagnosticSteps: [
      "Open the door slowly and note if it falls open with no resistance",
      "Check for broken plastic links visible behind the toe-kick panel",
      "Listen for a snapping sound when opening — indicates a broken link",
      "Inspect both hinges for equal tension"
    ],
    recommendedPartTypes: ["Door Balance Link Kit", "Door Latch"]
  },
  {
    applianceType: "dishwasher",
    symptom: "leaking",
    possibleCauses: [
      "Door gasket/seal worn",
      "Spray arm cracked",
      "Pump seal failure",
      "Inlet valve dripping"
    ],
    diagnosticSteps: [
      "Inspect the door gasket for tears or hardening",
      "Check spray arms for cracks",
      "Look for water under the dishwasher during a cycle",
      "Check the water inlet valve connection for drips"
    ],
    recommendedPartTypes: ["Door Seal", "Spray Arm", "Water Inlet Valve"]
  },
  {
    applianceType: "dishwasher",
    symptom: "noisy",
    possibleCauses: [
      "Spray arm hitting dishes",
      "Wash pump motor bearings worn",
      "Drain pump debris",
      "Loose mounting brackets"
    ],
    diagnosticSteps: [
      "Check that dishes aren't blocking spray arm rotation",
      "Listen to identify if noise comes from the wash pump or drain pump",
      "Inspect the spray arm bearing ring for wear",
      "Check that the dishwasher is level and brackets are tight"
    ],
    recommendedPartTypes: ["Spray Arm", "Wash Arm Bearing Ring", "Mounting Bracket"]
  }
];

class ProductKnowledgeBase {
  constructor() {
    this.troubleshooting = TROUBLESHOOTING_GUIDES;
  }

  getByPartNumber(_partNumber) {
    // No hardcoded parts — all lookups go through the CSV database or live scraping
    return null;
  }

  getByModel(_modelNumber) {
    // No hardcoded models — all lookups go through the database
    return [];
  }

  searchBySymptom(symptom, applianceType = null) {
    const normalizedSymptom = symptom.toLowerCase();

    const guides = this.troubleshooting.filter((g) => {
      if (applianceType && g.applianceType !== applianceType) return false;
      return normalizedSymptom.includes(g.symptom) ||
        g.symptom.split(" ").some((word) => word.length > 3 && normalizedSymptom.includes(word));
    });

    return {
      guides: guides.slice(0, 2),
      recommendedParts: [] // No hardcoded part numbers — search the real DB instead
    };
  }

  search(query) {
    // No hardcoded search — return null so the caller uses the real database
    return null;
  }
}

export const productKnowledgeBase = new ProductKnowledgeBase();
