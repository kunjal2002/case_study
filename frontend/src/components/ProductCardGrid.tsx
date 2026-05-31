"use client";
import type { ProductCard } from "@/lib/types";

interface Props { cards: ProductCard[]; onAction: (c: ProductCard) => void; }

export function ProductCardGrid({ cards, onAction }: Props) {
  if (!cards?.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {cards.map((c) => <Card key={c.id || c.partNumber} card={c} onAction={onAction} />)}
    </div>
  );
}

function Card({ card, onAction }: { card: ProductCard; onAction: (c: ProductCard) => void }) {
  return (
    <div className="card-hover overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--ps-border)", background: "var(--ps-surface)" }}>

      {/* Title row */}
      <div className="border-b px-3 py-2.5 flex items-start justify-between gap-2"
        style={{ borderColor: "#eee", background: "linear-gradient(to bottom, #fafafa, #f5f5f5)" }}>
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold leading-snug truncate" style={{ color: "var(--ps-header)" }}>
            {card.title}
          </h4>
          <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--ps-text-muted)" }}>
            PS# {card.partNumber}{card.manufacturerPartNumber && <> · MPN: {card.manufacturerPartNumber}</>}
          </p>
        </div>
        {card.price != null && (
          <div className="shrink-0 text-right">
            <span className="block rounded px-2 py-0.5 text-[13px] font-bold whitespace-nowrap"
              style={{ background: "var(--ps-gold)", color: "#333" }}>
              ${card.price.toFixed(2)}
            </span>
            <span className="text-[8px] block mt-0.5" style={{ color: "var(--ps-text-muted)" }}>
              verify on site
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        {card.fitment && (
          <span className="mb-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{
              background: card.fitment.includes("✓") || card.fitment.includes("In Stock") ? "#e8f5e9" :
                card.fitment.includes("✗") ? "#ffebee" : "#f5f5f5",
              color: card.fitment.includes("✓") || card.fitment.includes("In Stock") ? "var(--ps-green)" :
                card.fitment.includes("✗") ? "var(--ps-red)" : "var(--ps-text-2)",
              border: `1px solid ${card.fitment.includes("✓") || card.fitment.includes("In Stock") ? "#c8e6c9" :
                card.fitment.includes("✗") ? "#ffcdd2" : "#e0e0e0"}`,
            }}>{card.fitment}</span>
        )}
        {card.summary && (
          <p className="text-[11px] leading-relaxed line-clamp-2 mt-1" style={{ color: "var(--ps-text-2)" }}>
            {card.summary}
          </p>
        )}
        {card.rating != null && card.rating > 0 && (
          <div className="mt-1.5 flex items-center gap-1">
            {[1,2,3,4,5].map(s => (
              <svg key={s} width="10" height="10" viewBox="0 0 20 20"
                fill={s <= Math.round(card.rating!) ? "var(--ps-gold)" : "none"}
                stroke="var(--ps-gold)" strokeWidth="1.5">
                <path d="M10 1l2.39 4.84 5.34.78-3.87 3.77.91 5.32L10 13.27l-4.77 2.51.91-5.32L2.27 6.69l5.34-.78L10 1z"/>
              </svg>
            ))}
            <span className="text-[10px]" style={{ color: "var(--ps-text-muted)" }}>{card.rating.toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 border-t px-3 py-2"
        style={{ borderColor: "#eee", background: "#fafafa" }}>
        {card.cta && (
          <button onClick={() => onAction(card)}
            className="btn-press rounded px-2.5 py-1.5 text-[10px] font-semibold text-white"
            style={{ background: "var(--ps-header)" }}>
            {card.ctaLabel || "Details"}
          </button>
        )}
        {card.url && (
          <a href={card.url} target="_blank" rel="noopener noreferrer"
            className="btn-press inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-[10px] font-semibold text-white no-underline"
            style={{ background: "var(--ps-orange)" }}>
            Buy on PartSelect →
          </a>
        )}
      </div>
    </div>
  );
}
