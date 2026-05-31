/**
 * Conversation Memory - Maintains multi-turn context for the agent.
 * Stores recent messages and extracted entities across the conversation.
 */
export class ConversationMemory {
  constructor(maxTurns = 20) {
    this.messages = [];
    this.maxTurns = maxTurns;
    this.entities = {}; // Extracted entities persisted across turns
    this.lastActivity = Date.now();
  }

  addUserMessage(content) {
    this.messages.push({ role: "user", content });
    this._trim();
    this.lastActivity = Date.now();
  }

  addAssistantMessage(content) {
    this.messages.push({ role: "assistant", content });
    this._trim();
    this.lastActivity = Date.now();
  }

  addToolResult(toolName, result) {
    this.messages.push({
      role: "tool",
      content: JSON.stringify(result),
      name: toolName
    });
    this._trim();
  }

  setEntity(key, value) {
    if (value) {
      this.entities[key] = value;
    }
  }

  getEntity(key) {
    return this.entities[key] || null;
  }

  getRecentMessages(count = 10) {
    return this.messages.slice(-count);
  }

  getContextForLLM() {
    // Return messages formatted for OpenAI chat completions
    return this.messages.slice(-12).map((msg) => {
      if (msg.role === "tool") {
        return { role: "assistant", content: `[Tool: ${msg.name}] ${msg.content}` };
      }
      return { role: msg.role, content: msg.content };
    });
  }

  _trim() {
    if (this.messages.length > this.maxTurns * 2) {
      this.messages = this.messages.slice(-this.maxTurns * 2);
    }
  }
}
