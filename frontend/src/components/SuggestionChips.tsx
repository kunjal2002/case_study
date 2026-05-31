"use client";
interface Props { suggestions: string[]; onSelect: (s: string) => void; disabled?: boolean; }

export function SuggestionChips({ suggestions, onSelect, disabled }: Props) {
  if (!suggestions?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {suggestions.map((s, i) => (
        <button key={i} onClick={() => onSelect(s)} disabled={disabled}
          className="chip-hover btn-press rounded-full border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50"
          style={{ borderColor: "var(--ps-border)", color: "var(--ps-header)", background: "white" }}>
          {s}
        </button>
      ))}
    </div>
  );
}
