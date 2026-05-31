"use client";
import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface Props {
  sessionId: string;
  messageIndex: number;
  query?: string;
}

export function FeedbackButtons({ sessionId, messageIndex, query }: Props) {
  const [voted, setVoted] = useState<"up" | "down" | null>(null);

  const submit = async (rating: 1 | 5) => {
    const type = rating === 5 ? "up" : "down";
    setVoted(type);
    try {
      await fetch(`${API}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, rating, message: query || "", query }),
      });
    } catch {}
  };

  if (voted) {
    return (
      <span className="text-[10px] italic" style={{ color: "var(--ps-text-muted)" }}>
        {voted === "up" ? "Thanks for the feedback!" : "Thanks — we'll improve."}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1 mt-1">
      <span className="text-[9px]" style={{ color: "var(--ps-text-muted)" }}>Helpful?</span>
      <button
        onClick={() => submit(5)}
        className="rounded px-1.5 py-0.5 text-[11px] transition-all hover:bg-green-50 active:scale-95"
        title="Helpful"
      >👍</button>
      <button
        onClick={() => submit(1)}
        className="rounded px-1.5 py-0.5 text-[11px] transition-all hover:bg-red-50 active:scale-95"
        title="Not helpful"
      >👎</button>
    </div>
  );
}
