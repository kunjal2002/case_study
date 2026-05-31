"use client";

const ITEMS = [
  { icon: "🔧", title: "Install a Part",      sub: "Step-by-step with video",     fill: "How do I install part PS" },
  { icon: "✅", title: "Check Compatibility", sub: "Does this part fit?",          fill: "Is PS compatible with model " },
  { icon: "🩺", title: "Troubleshoot",        sub: "Diagnose & fix issues",       fill: "My " },
  { icon: "📋", title: "Parts for Model",     sub: "Browse compatible parts",     fill: "Show parts for model " },
  { icon: "🔍", title: "Search by Name",      sub: "Describe what you need",      fill: "I need a " },
  { icon: "📦", title: "Order Support",       sub: "Shipping & returns",          fill: "How do I track my order?" },
];

interface Props { onPrompt: (text: string) => void; disabled?: boolean; }

export function HeroSuggestions({ onPrompt, disabled }: Props) {
  return (
    <>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--ps-text-muted)" }}>
        How can I help?
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {ITEMS.map(item => (
          <button key={item.title} onClick={() => onPrompt(item.fill)} disabled={disabled}
            className="card-hover btn-press group flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left disabled:opacity-50"
            style={{ borderColor: "var(--ps-border)", background: "white" }}>
            <span className="text-base transition-transform duration-150 group-hover:scale-110">{item.icon}</span>
            <span className="text-[11px] font-semibold" style={{ color: "var(--ps-header)" }}>{item.title}</span>
            <span className="text-[9px] leading-tight" style={{ color: "var(--ps-text-muted)" }}>{item.sub}</span>
          </button>
        ))}
      </div>
    </>
  );
}
