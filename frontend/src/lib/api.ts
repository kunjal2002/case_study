import type { ChatResponse } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function sendMessage(
  query: string,
  sessionId: string
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, sessionId }),
    signal: AbortSignal.timeout(35000), // 35s to handle Render cold starts
  });

  if (!res.ok) {
    throw new Error(`Backend returned ${res.status}`);
  }

  const data = await res.json();

  return {
    content:
      data.content ||
      "I can help with refrigerator and dishwasher parts. What would you like to know?",
    cards: data.cards || [],
    suggestions: data.suggestions || [],
    toolsUsed: data.toolsUsed || [],
    meta: data.meta || {},
  };
}

export async function sendMessageStream(
  query: string,
  sessionId: string,
  onContent: (text: string) => void,
  onCards: (cards: ChatResponse["cards"]) => void,
  onSuggestions: (suggestions: string[]) => void,
  onDone: () => void,
  onError: (error: string) => void
) {
  try {
    const res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, sessionId }),
    });

    if (!res.ok || !res.body) {
      const fallback = await sendMessage(query, sessionId);
      onContent(fallback.content);
      onCards(fallback.cards);
      onSuggestions(fallback.suggestions);
      onDone();
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          const eventType = line.slice(7).trim();
          const dataLineIdx = lines.indexOf(line) + 1;
          if (dataLineIdx < lines.length && lines[dataLineIdx].startsWith("data: ")) {
            try {
              const data = JSON.parse(lines[dataLineIdx].slice(6));
              switch (eventType) {
                case "content":
                  onContent(data.text);
                  break;
                case "cards":
                  onCards(data.cards);
                  break;
                case "suggestions":
                  onSuggestions(data.suggestions);
                  break;
                case "done":
                  onDone();
                  break;
                case "error":
                  onError(data.message);
                  break;
              }
            } catch {
              // skip malformed SSE data
            }
          }
        }
      }
    }
  } catch {
    // Fall back to non-streaming
    try {
      const fallback = await sendMessage(query, sessionId);
      onContent(fallback.content);
      onCards(fallback.cards);
      onSuggestions(fallback.suggestions);
      onDone();
    } catch {
      onError("Unable to connect to the server. Please ensure the backend is running on port 4000.");
    }
  }
}
