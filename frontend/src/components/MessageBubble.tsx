"use client";
import type { ChatMessage } from "@/lib/types";

function renderMd(text: string): string {
  // Pre-process: normalize line endings
  let s = text.replace(/\r\n/g, "\n");

  // Remove image markdown
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");

  // Bold and italic
  s = s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

  // Inline code
  s = s.replace(/`(.*?)`/g, "<code>$1</code>");

  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Headers — render as styled bold text (no raw #### showing)
  s = s.replace(/^#{2,}\s+(.+)$/gm, '<strong class="block mt-2 mb-0.5">$1</strong>');

  // Blockquotes
  s = s.replace(/^>\s+(.+)$/gm, "<blockquote>$1</blockquote>");

  // Process lists: split into lines, group consecutive list items
  const lines = s.split("\n");
  const processed: string[] = [];
  let inOl = false;
  let inUl = false;

  for (const line of lines) {
    const olMatch = line.match(/^(\d+)\.\s+(.+)$/);
    const ulMatch = line.match(/^[-•]\s+(.+)$/);

    if (olMatch) {
      const num = olMatch[1];
      if (!inUl) { if (inOl) { processed.push("</ul>"); inOl = false; } processed.push("<ul style='list-style:none;padding:0;margin:.2rem 0'>"); inUl = true; }
      processed.push(`<li style='display:flex;gap:.4rem;margin:.15rem 0;line-height:1.5'><span style='font-weight:700;color:#337778;min-width:1.2rem;flex-shrink:0'>${num}.</span><span>${olMatch[2]}</span></li>`);
    } else if (ulMatch) {
      if (!inUl) { if (inOl) { processed.push("</ul>"); inOl = false; } processed.push("<ul style='list-style:none;padding:0;margin:.2rem 0'>"); inUl = true; }
      processed.push(`<li style='display:flex;gap:.4rem;margin:.15rem 0;line-height:1.5'><span style='font-weight:700;color:#337778;flex-shrink:0'>·</span><span>${ulMatch[1]}</span></li>`);
    } else {
      if (inOl) { processed.push("</ol>"); inOl = false; }
      if (inUl) { processed.push("</ul>"); inUl = false; }

      if (line.trim() === "") {
        processed.push("<br/>");
      } else if (line.startsWith("<")) {
        processed.push(line);
      } else {
        processed.push(`<p>${line}</p>`);
      }
    }
  }
  if (inOl) processed.push("</ol>");
  if (inUl) processed.push("</ul>");

  return processed.join("");
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex items-end gap-2 py-1 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
        style={{
          background: isUser ? "#e0e0e0" : "var(--ps-header)",
          color: isUser ? "#666" : "white",
        }}>
        {isUser
          ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          : "PS"}
      </div>
      <div className={`max-w-[78%] rounded-2xl text-sm leading-relaxed ${isUser ? "rounded-br-sm px-3.5 py-2.5" : "rounded-bl-sm border px-3.5 py-2.5"}`}
        style={{
          background: isUser ? "var(--ps-header)" : "var(--ps-surface)",
          color: isUser ? "white" : "var(--ps-text)",
          borderColor: isUser ? undefined : "var(--ps-border)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
        }}>
        <div className={isUser ? "md md-w" : "md"}
          dangerouslySetInnerHTML={{ __html: renderMd(message.content) }} />
      </div>
    </div>
  );
}
