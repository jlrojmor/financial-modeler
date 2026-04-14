import { NextResponse } from "next/server";
import type { CompanyContext } from "@/types/company-context";
import type { CapexDaAiSuggestion } from "@/types/capex-da-ai";
import { buildModelingContext, getModelingContextSummaryForPrompt } from "@/lib/modeling-context";
import {
  CAPEX_DEFAULT_BUCKET_IDS,
  CAPEX_IB_DEFAULT_USEFUL_LIVES,
  CAPEX_IB_TYPICAL_RANGE,
} from "@/lib/capex-defaults";

const BUCKET_LABELS: Record<string, string> = {
  cap_b1: "Land",
  cap_b2: "Buildings & Improvements",
  cap_b3: "Machinery & Equipment",
  cap_b4: "Computer Hardware",
  cap_b5: "Software (Capitalized)",
  cap_b6: "Furniture & Fixtures",
  cap_b7: "Leasehold Improvements",
  cap_b8: "Vehicles",
  cap_b9: "Construction in Progress (CIP)",
  cap_b10: "Other PP&E",
};

const NON_DEPRECIABLE_BUCKETS = new Set(["cap_b1", "cap_b9"]); // Land, CIP

interface RequestBody {
  companyContext?: CompanyContext;
  historicalCapexPctRevenue: number[];
  historicalPpePctRevenue: number[];
  lastHistPPE: number;
  lastHistRevenue: number;
  projectionYears: string[];
  currencyUnit: string;
}

interface RawAiResponse {
  suggestedCapexPctRevenue?: unknown;
  suggestedUsefulLifeSingle?: unknown;
  suggestedUsefulLifeByBucket?: unknown;
  suggestedAllocationPct?: unknown;
  rationaleCapex?: unknown;
  rationaleUsefulLife?: unknown;
  confidence?: unknown;
}

function buildIbRangesBlock(): string {
  return CAPEX_DEFAULT_BUCKET_IDS.filter((id) => !NON_DEPRECIABLE_BUCKETS.has(id))
    .map((id) => `  ${BUCKET_LABELS[id] ?? id}: typical life ${CAPEX_IB_TYPICAL_RANGE[id] ?? "N/A"} years, IB default ${CAPEX_IB_DEFAULT_USEFUL_LIVES[id] ?? "N/A"} years`)
    .join("\n");
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeUsefulLifeByBucket(raw: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return result;
  const obj = raw as Record<string, unknown>;
  for (const id of CAPEX_DEFAULT_BUCKET_IDS) {
    const def = CAPEX_IB_DEFAULT_USEFUL_LIVES[id] ?? 0;
    if (NON_DEPRECIABLE_BUCKETS.has(id)) {
      result[id] = 0;
    } else if (obj[id] != null) {
      result[id] = clamp(obj[id], 1, 100, def);
    } else {
      result[id] = def;
    }
  }
  return result;
}

function normalizeAllocationPct(raw: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  for (const id of CAPEX_DEFAULT_BUCKET_IDS) result[id] = 0;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return result;
  const obj = raw as Record<string, unknown>;
  let total = 0;
  for (const id of CAPEX_DEFAULT_BUCKET_IDS) {
    if (NON_DEPRECIABLE_BUCKETS.has(id)) { result[id] = 0; continue; }
    const v = clamp(obj[id], 0, 100, 0);
    result[id] = v;
    total += v;
  }
  // Normalize so depreciable buckets sum to 100
  if (total > 0) {
    for (const id of CAPEX_DEFAULT_BUCKET_IDS) {
      if (!NON_DEPRECIABLE_BUCKETS.has(id)) result[id] = Math.round((result[id] / total) * 100 * 10) / 10;
    }
  }
  return result;
}

function normalizeConfidence(v: unknown): "high" | "medium" | "low" {
  if (v === "high" || v === "medium" || v === "low") return v;
  return "medium";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const {
      companyContext,
      historicalCapexPctRevenue = [],
      historicalPpePctRevenue = [],
      lastHistPPE = 0,
      lastHistRevenue = 0,
    } = body;

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.AI_MODEL || "gpt-4o-mini";

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured", suggestion: null },
        { status: 503 }
      );
    }

    const modelingProfile = buildModelingContext(companyContext);
    const contextSummary = getModelingContextSummaryForPrompt(modelingProfile ?? null);

    const histCapexStr =
      historicalCapexPctRevenue.length > 0
        ? historicalCapexPctRevenue.map((v) => `${v.toFixed(1)}%`).join(", ")
        : "not provided";
    const histPpeStr =
      historicalPpePctRevenue.length > 0
        ? historicalPpePctRevenue.map((v) => `${v.toFixed(1)}%`).join(", ")
        : "not provided";

    const capexImplications = modelingProfile?.modelingImplications?.capexBehavior ?? "";
    const ibRanges = buildIbRangesBlock();

    const prompt = `You are an investment banking financial modeling expert. Suggest Capex forecast assumptions and PP&E depreciation schedule inputs for this company.

${contextSummary ? `COMPANY CONTEXT:\n${contextSummary}\n` : ""}${capexImplications ? `CAPEX MODELING GUIDANCE:\n${capexImplications}\n` : ""}
HISTORICAL DATA:
- Capex as % of Revenue (recent years): ${histCapexStr}
- PP&E as % of Revenue (recent years): ${histPpeStr}
- Last historical PP&E (net): ${lastHistPPE > 0 ? lastHistPPE.toLocaleString() : "N/A"}
- Last historical Revenue: ${lastHistRevenue > 0 ? lastHistRevenue.toLocaleString() : "N/A"}

IB STANDARD USEFUL LIFE RANGES (straight-line depreciation):
${ibRanges}

BUCKET IDs for your response (use these exact keys):
${CAPEX_DEFAULT_BUCKET_IDS.filter((id) => !NON_DEPRECIABLE_BUCKETS.has(id)).map((id) => `  ${id}: ${BUCKET_LABELS[id]}`).join("\n")}
Note: cap_b1 (Land) and cap_b9 (CIP) are non-depreciable — set their usefulLife=0 and allocationPct=0.

Return STRICT JSON only (no markdown, no explanation outside JSON):
{
  "suggestedCapexPctRevenue": <number, e.g. 6.5>,
  "suggestedUsefulLifeSingle": <number, e.g. 12>,
  "suggestedUsefulLifeByBucket": {
    "cap_b1": 0, "cap_b2": <years>, "cap_b3": <years>, "cap_b4": <years>,
    "cap_b5": <years>, "cap_b6": <years>, "cap_b7": <years>, "cap_b8": <years>,
    "cap_b9": 0, "cap_b10": <years>
  },
  "suggestedAllocationPct": {
    "cap_b1": 0, "cap_b2": <pct>, "cap_b3": <pct>, "cap_b4": <pct>,
    "cap_b5": <pct>, "cap_b6": <pct>, "cap_b7": <pct>, "cap_b8": <pct>,
    "cap_b9": 0, "cap_b10": <pct>
  },
  "rationaleCapex": "<max 240 chars: why this Capex % makes sense for this company>",
  "rationaleUsefulLife": "<max 240 chars: why these useful lives and allocation % fit this industry>",
  "confidence": "<high|medium|low>"
}

Rules:
- suggestedCapexPctRevenue: use historical data as anchor; adjust for industry norms. Range: 1–30%.
- Allocation % across depreciable buckets (excl. Land cap_b1, CIP cap_b9) must sum to ~100%.
- Use IB default useful lives as anchor; adjust ±20% for industry specifics (e.g. tech = shorter lives, infrastructure = longer).
- Reflect the primary business type in allocation: e.g. retailer → heavier on Leasehold Improvements and Furniture; manufacturer → Machinery & Equipment; tech → Software and Computer Hardware.
- confidence: high if historical data corroborates industry norms; medium if some signals missing; low if no data.
- Keep rationale concise (max 240 chars each).`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[capex-da-suggest] OpenAI error:", res.status, err);
      return NextResponse.json({ error: "LLM request failed", suggestion: null }, { status: 502 });
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const rawText = data?.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: RawAiResponse;
    try {
      const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned) as RawAiResponse;
    } catch {
      console.error("[capex-da-suggest] Invalid JSON:", rawText.slice(0, 400));
      return NextResponse.json({ error: "Invalid LLM response", suggestion: null }, { status: 502 });
    }

    const suggestion: CapexDaAiSuggestion = {
      suggestedCapexPctRevenue: clamp(parsed.suggestedCapexPctRevenue, 0.5, 30, 5),
      suggestedUsefulLifeSingle: clamp(parsed.suggestedUsefulLifeSingle, 3, 50, 12),
      suggestedUsefulLifeByBucket: normalizeUsefulLifeByBucket(parsed.suggestedUsefulLifeByBucket),
      suggestedAllocationPct: normalizeAllocationPct(parsed.suggestedAllocationPct),
      rationaleCapex: typeof parsed.rationaleCapex === "string" ? parsed.rationaleCapex.slice(0, 240) : "",
      rationaleUsefulLife: typeof parsed.rationaleUsefulLife === "string" ? parsed.rationaleUsefulLife.slice(0, 240) : "",
      confidence: normalizeConfidence(parsed.confidence),
    };

    return NextResponse.json({ suggestion });
  } catch (e) {
    console.error("[capex-da-suggest]", e);
    return NextResponse.json({ error: "Server error", suggestion: null }, { status: 500 });
  }
}
