"use client";
import { useState, useEffect } from "react";

// This is baked in at Vercel build time from next.config.ts
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export function StatusIndicator() {
  const [status, setStatus] = useState<"online" | "offline" | "checking">("checking");

  useEffect(() => {
    const check = async () => {
      try {
        // 25s timeout handles Render free-tier cold starts (can take 10-30s on first request)
        const r = await fetch(`${API}/health`, {
          signal: AbortSignal.timeout(25000),
          cache: "no-store",
        });
        setStatus(r.ok ? "online" : "offline");
      } catch {
        setStatus("offline");
      }
    };
    check();
    // Re-check every 60 seconds
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, []);

  const color = status === "online" ? "#22c55e" : status === "offline" ? "#ef4444" : "#f3c04c";
  const label = status === "online" ? "Online" : status === "offline" ? "Offline" : "...";

  return (
    <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--ps-text-muted)" }}>
      <span className="relative flex h-2 w-2">
        {status === "online" && (
          <span className="absolute h-full w-full animate-ping rounded-full opacity-50" style={{ background: color }} />
        )}
        <span className="relative h-2 w-2 rounded-full" style={{ background: color }} />
      </span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}
