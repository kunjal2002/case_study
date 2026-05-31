/**
 * Tool definitions for OpenAI function calling.
 * Each tool represents a capability the agent can invoke autonomously.
 */
export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_part",
      description:
        "Look up a specific part by its PartSelect number (PS#) or manufacturer part number. Returns detailed product info including price, description, compatibility list, and installation guidance from live PartSelect data.",
      parameters: {
        type: "object",
        properties: {
          partNumber: {
            type: "string",
            description:
              "The PartSelect part number (e.g. PS11752778) or manufacturer part number (e.g. WPW10321304)",
          },
        },
        required: ["partNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_by_model",
      description:
        "Find all compatible replacement parts for a specific appliance model number. Returns a list of parts with names, prices, and part numbers.",
      parameters: {
        type: "object",
        properties: {
          modelNumber: {
            type: "string",
            description:
              "The appliance model number (e.g. WDT780SAEM1, WRS325SDHZ08)",
          },
        },
        required: ["modelNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_compatibility",
      description:
        "Verify whether a specific part is compatible with a specific appliance model. Cross-references the part's compatibility list and the model's parts list.",
      parameters: {
        type: "object",
        properties: {
          partNumber: {
            type: "string",
            description: "The PartSelect part number (e.g. PS11752778)",
          },
          modelNumber: {
            type: "string",
            description: "The appliance model number (e.g. WDT780SAEM1)",
          },
        },
        required: ["partNumber", "modelNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_installation_guide",
      description:
        "Get step-by-step installation instructions for a specific part, including difficulty rating, time estimate, tools needed, and customer repair experiences.",
      parameters: {
        type: "object",
        properties: {
          partNumber: {
            type: "string",
            description: "The PartSelect part number to get installation guide for",
          },
        },
        required: ["partNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "troubleshoot_symptom",
      description:
        "Diagnose an appliance issue based on described symptoms. Returns possible causes, diagnostic steps, and recommended replacement parts. Works best when appliance type and model number are provided.",
      parameters: {
        type: "object",
        properties: {
          symptom: {
            type: "string",
            description:
              "Description of the problem (e.g. 'ice maker not working', 'dishwasher not draining', 'fridge warm but freezer cold')",
          },
          applianceType: {
            type: "string",
            enum: ["refrigerator", "dishwasher"],
            description: "Type of appliance experiencing the issue",
          },
          modelNumber: {
            type: "string",
            description: "Optional model number for model-specific diagnostics",
          },
        },
        required: ["symptom", "applianceType"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_parts_by_keyword",
      description:
        "Search for parts by descriptive keywords when no part number is known. Uses both text matching and semantic search. Example: 'dishwasher spray arm', 'refrigerator water filter', 'ice maker assembly'.",
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description:
              "Search keywords describing the part (e.g. 'ice maker assembly', 'lower spray arm', 'door shelf bin')",
          },
          applianceType: {
            type: "string",
            enum: ["refrigerator", "dishwasher"],
            description: "Optional filter by appliance type",
          },
        },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "semantic_search",
      description:
        "Find parts using natural language description via AI-powered semantic search. Best for vague queries like 'my fridge door shelves keep breaking' or 'something to fix dishwasher rack falling'. Returns parts ranked by relevance.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language description of what the user is looking for",
          },
          applianceType: {
            type: "string",
            enum: ["refrigerator", "dishwasher"],
            description: "Optional filter by appliance type",
          },
        },
        required: ["query"],
      },
    },
  },
];
