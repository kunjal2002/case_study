"use client";
const L: Record<string, string> = {
  search_part: "Part Lookup", search_by_model: "Model Search",
  check_compatibility: "Compatibility", get_installation_guide: "Install Guide",
  troubleshoot_symptom: "Diagnosis", search_parts_by_keyword: "Search", semantic_search: "AI Search",
};

export function ToolBadges({ tools }: { tools: string[] }) {
  if (!tools?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tools.map(t => (
        <span key={t} className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold"
          style={{ background: "rgba(51,119,120,0.08)", color: "var(--ps-header)", border: "1px solid rgba(51,119,120,0.15)" }}>
          {L[t] || t}
        </span>
      ))}
    </div>
  );
}
