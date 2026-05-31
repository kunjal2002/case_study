export interface ProductCard {
  id: string;
  title: string;
  partNumber: string;
  manufacturerPartNumber?: string;
  price: number | null;
  inStock?: boolean;
  rating?: number | null;
  fitment?: string;
  summary?: string;
  imageUrl?: string;
  url?: string;
  cta?: string;
  ctaLabel?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  cards?: ProductCard[];
  suggestions?: string[];
  toolsUsed?: string[];
  meta?: Record<string, unknown>;
  timestamp?: number;
}

export interface ChatResponse {
  content: string;
  cards: ProductCard[];
  suggestions: string[];
  toolsUsed: string[];
  meta: Record<string, unknown>;
}
