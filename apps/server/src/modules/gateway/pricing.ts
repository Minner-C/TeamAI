import type { ProviderRow } from "../../types.js";

export interface ModelPrice {
  in: number;
  out: number;
}

const DEFAULT_PRICING: Record<string, ModelPrice> = {
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1-nano": { in: 0.1, out: 0.4 },
  "gpt-5": { in: 1.25, out: 10 },
  o3: { in: 2, out: 8 },
  "o4-mini": { in: 1.1, out: 4.4 },
  "claude-3-5-sonnet": { in: 3, out: 15 },
  "claude-3-5-haiku": { in: 0.8, out: 4 },
  "claude-3-7-sonnet": { in: 3, out: 15 },
  "claude-sonnet-4": { in: 3, out: 15 },
  "claude-opus-4": { in: 15, out: 75 },
  "claude-haiku-4": { in: 1, out: 5 },
  "deepseek-chat": { in: 0.27, out: 1.1 },
  "deepseek-reasoner": { in: 0.55, out: 2.19 },
  "qwen-max": { in: 2.4, out: 9.6 },
  "qwen-plus": { in: 0.4, out: 1.2 },
  "qwen-turbo": { in: 0.05, out: 0.2 },
  "glm-4-plus": { in: 0.7, out: 0.7 },
  "glm-4-air": { in: 0.07, out: 0.07 },
  "moonshot-v1-8k": { in: 1.6, out: 1.6 },
  "moonshot-v1-32k": { in: 3.2, out: 3.2 },
  "moonshot-v1-128k": { in: 8, out: 8 },
};

function lookup(table: Record<string, ModelPrice>, model: string): ModelPrice | null {
  if (table[model]) return table[model];
  const lower = model.toLowerCase();
  let best: ModelPrice | null = null;
  let bestLen = -1;
  for (const [key, price] of Object.entries(table)) {
    const k = key.toLowerCase();
    if (lower === k || lower.startsWith(k)) {
      if (k.length > bestLen) {
        best = price;
        bestLen = k.length;
      }
    }
  }
  return best;
}

export function parsePricing(json: string | undefined | null): Record<string, ModelPrice> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as Record<string, { in?: number; out?: number }>;
    const out: Record<string, ModelPrice> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v?.in === "number" && typeof v?.out === "number") out[k] = { in: v.in, out: v.out };
    }
    return out;
  } catch {
    return {};
  }
}

export function priceForModel(provider: ProviderRow, model: string): ModelPrice | null {
  const custom = lookup(parsePricing(provider.pricing_json), model);
  if (custom) return custom;
  return lookup(DEFAULT_PRICING, model);
}

export function estimateCost(provider: ProviderRow, model: string, tokensIn: number, tokensOut: number): number {
  const price = priceForModel(provider, model);
  if (!price) return 0;
  const cost = (tokensIn / 1_000_000) * price.in + (tokensOut / 1_000_000) * price.out;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
