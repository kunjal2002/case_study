"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ChatMessage } from "@/lib/types";
import { sendMessage } from "@/lib/api";
import { MessageBubble } from "./MessageBubble";
import { ProductCardGrid } from "./ProductCardGrid";
import { SuggestionChips } from "./SuggestionChips";
import { ToolBadges } from "./ToolBadges";
import { HeroSuggestions } from "./HeroSuggestions";
import { FeedbackButtons } from "./FeedbackButtons";
import { StatusIndicator } from "./StatusIndicator";

const WELCOME: ChatMessage = {
  role: "assistant",
  content: "Hi! I'm your **PartSelect** assistant for **refrigerator** and **dishwasher** parts.\n\nI can find parts, check compatibility, provide installation guides with videos, and troubleshoot issues. How can I help?",
  suggestions: [],
};

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [isLoading, setIsLoading] = useState(false);
  const [showHero, setShowHero] = useState(true);
  const [sendDisabled, setSendDisabled] = useState(true);
  const [sessionId] = useState(() => `s_${Date.now()}`);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isLoading]);

  const getVal = () => inputRef.current?.value?.trim() || "";

  const send = useCallback(async (val?: string) => {
    const text = val?.trim() || getVal();
    if (!text || isLoading) return;
    setShowHero(false);
    if (inputRef.current) inputRef.current.value = "";
    setSendDisabled(true);
    setMessages(p => [...p, { role: "user", content: text, timestamp: Date.now() }]);
    setIsLoading(true);
    try {
      const res = await sendMessage(text, sessionId);
      setMessages(p => [...p, {
        role: "assistant", content: res.content, cards: res.cards,
        suggestions: res.suggestions, toolsUsed: res.toolsUsed,
        meta: res.meta, timestamp: Date.now(),
      }]);
    } catch (err) {
      const isTimeout = err instanceof Error && (err.message.includes("timeout") || err.message.includes("fetch"));
      setMessages(p => [...p, {
        role: "assistant",
        content: isTimeout
          ? "The server is waking up (it may take up to 30 seconds on first load). Please **try again in a moment**."
          : "I had trouble with that request. Please try again.",
        suggestions: ["Show parts for WDT780SAEM1", "My fridge ice maker isn't working"],
      }]);
    }
    setIsLoading(false);
    inputRef.current?.focus();
  }, [isLoading, sessionId]);

  const fillInput = (text: string) => {
    if (inputRef.current) {
      inputRef.current.value = text;
      inputRef.current.focus();
      // Move cursor to end
      inputRef.current.setSelectionRange(text.length, text.length);
      // Resize to fit content
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px";
      setSendDisabled(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--ps-bg)" }}>
      {/* PartSelect header — teal top stripe + white logo bar (matches partselect.com) */}
      <div className="fixed top-0 inset-x-0 z-50">
        {/* Teal accent stripe */}
        <div style={{ background: "var(--ps-header)", height: 4 }} />
        {/* White logo bar */}
        <div className="flex items-center px-4 border-b" style={{ background: "#fff", borderColor: "var(--ps-border)", height: 48 }}>
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between relative">
            <a href="https://www.partselect.com" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2.5 no-underline">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/ps-logo.svg" alt="PartSelect" style={{ height: 30 }} />
              <span className="rounded text-[9px] font-bold px-1.5 py-0.5"
                style={{ background: "var(--ps-header)", color: "#fff", letterSpacing: "0.03em" }}>AI CHAT</span>
            </a>
          <div className="hidden sm:flex items-center gap-3 text-[11px] absolute left-1/2 -translate-x-1/2" style={{ color: "var(--ps-text-2)" }}>
            <span>Refrigerators</span>
            <span style={{ color: "var(--ps-border)" }}>|</span>
            <span>Dishwashers</span>
          </div>
            <StatusIndicator />
          </div>
        </div>
      </div>

      {/* Chat area */}
      <main className="flex flex-1 justify-center" style={{ paddingTop: 52 }}>
        <div className="flex w-full max-w-3xl flex-col" style={{ height: "calc(100vh - 52px)" }}>

          {/* Messages */}
          <div className="scrollbar flex flex-1 flex-col overflow-y-auto px-4 py-4" style={{ background: "#fff" }}>
            {messages.map((msg, i) => (
              <div key={i} className="msg">
                <MessageBubble message={msg} />
                {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                  <div className="ml-9 mt-1"><ToolBadges tools={msg.toolsUsed} /></div>
                )}
                {msg.cards && msg.cards.length > 0 && (
                  <div className="ml-9 mt-2">
                    <ProductCardGrid cards={msg.cards} onAction={(c) => c.cta && send(c.cta)} />
                  </div>
                )}
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div className="ml-9 mt-2">
                    <SuggestionChips suggestions={msg.suggestions} onSelect={send} disabled={isLoading} />
                  </div>
                )}
                {/* Feedback for assistant messages (not welcome) */}
                {msg.role === "assistant" && i > 0 && (
                  <div className="ml-9 mt-1">
                    <FeedbackButtons sessionId={sessionId} messageIndex={i} query={messages[i - 1]?.content} />
                  </div>
                )}
              </div>
            ))}

            {showHero && messages.length <= 1 && (
              <div className="ml-9 mt-2">
                <HeroSuggestions onPrompt={fillInput} disabled={isLoading} />
              </div>
            )}

            {isLoading && (
              <div className="msg flex items-start gap-2 py-1">
                <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: "var(--ps-header)" }}>PS</div>
                <div className="rounded-2xl rounded-tl-sm border px-4 py-2.5 flex items-center gap-2"
                  style={{ borderColor: "var(--ps-border)" }}>
                  <div className="flex gap-1">
                    <span className="dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--ps-header)" }} />
                    <span className="dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--ps-header)" }} />
                    <span className="dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--ps-header)" }} />
                  </div>
                  <span className="text-xs italic" style={{ color: "var(--ps-text-muted)" }}>Searching PartSelect…</span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Input bar */}
          <div className="border-t px-4 py-2.5" style={{ borderColor: "var(--ps-border)", background: "#fafafa" }}>
            <div className="flex items-end gap-2">
              <textarea ref={inputRef}
                rows={1}
                onChange={() => {
                  setSendDisabled(!getVal());
                  if (inputRef.current) {
                    inputRef.current.style.height = "auto";
                    inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px";
                  }
                }}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                    setTimeout(() => {
                      if (inputRef.current) inputRef.current.style.height = "auto";
                    }, 10);
                  }
                }}
                placeholder="Ask about parts, compatibility, installation…"
                disabled={isLoading} autoFocus
                className="flex-1 rounded border px-3 py-2 text-sm bg-white outline-none transition-colors resize-none overflow-hidden"
                style={{ borderColor: "var(--ps-border)", color: "var(--ps-text)", lineHeight: "1.5" }}
                onFocus={e => e.currentTarget.style.borderColor = "var(--ps-header)"}
                onBlur={e => e.currentTarget.style.borderColor = "var(--ps-border)"}
              />
              <button onClick={() => send()} disabled={isLoading || sendDisabled}
                className="btn-press h-9 w-9 shrink-0 rounded flex items-center justify-center text-white disabled:opacity-40"
                style={{ background: "var(--ps-orange)" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white"
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
            <div className="mt-1 text-center text-[10px]" style={{ color: "var(--ps-text-muted)" }}>
              <a href="https://www.partselect.com" target="_blank" rel="noopener noreferrer"
                style={{ color: "var(--ps-link)" }} className="hover:underline">partselect.com</a>
              <span className="mx-2">·</span>
              <span>Enter to send · Shift+Enter for new line</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
