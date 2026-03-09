import { NextResponse } from "next/server";
import {
  CFS_FORECAST_DRIVER_VOCABULARY,
  HISTORICAL_CFS_NATURE_VOCABULARY,
} from "@/lib/cfs-forecast-drivers";

export type CFSSection = "operating" | "investing" | "financing" | "cash_bridge";

export type OperatingSubgroup = "non_cash" | "working_capital" | "other_operating";

export interface CFSClassifyItemInput {
  label: string;
  /** Section context where the user is adding the row (default hint). */
  sectionContext: CFSSection;
  /** When sectionContext is operating: which subgroup the user is adding from. Strong prior for historicalCfsNature. */
  operatingSubgroup?: OperatingSubgroup;
}

export interface CFSClassifySuggestion {
  section: CFSSection;
  forecastDriver: (typeof CFS_FORECAST_DRIVER_VOCABULARY)[number];
  historicalCfsNature: (typeof HISTORICAL_CFS_NATURE_VOCABULARY)[number];
  sign: "positive" | "negative";
  reason: string;
  confidence: number;
}

const FORECAST_DRIVERS_STR = CFS_FORECAST_DRIVER_VOCABULARY.join(", ");
const HISTORICAL_NATURE_STR = HISTORICAL_CFS_NATURE_VOCABULARY.join(", ");

const PROMPT = `You are a financial modeling expert. Classify a Cash Flow Statement line item for both historical nature and forecasting.

RULES:
- Return STRICT JSON only: a single object with keys: section, forecastDriver, historicalCfsNature, sign, reason (max 200 chars), confidence (0-1).
- section must be exactly one of: operating, investing, financing, cash_bridge. Use cash_bridge for items that affect net change in cash but are not CFO/CFI/CFF (e.g. effect of exchange rate changes, restricted cash reconciliation).
- forecastDriver must be exactly one of: ${FORECAST_DRIVERS_STR}.
- historicalCfsNature must be exactly one of: ${HISTORICAL_NATURE_STR}.
- sign must be exactly one of: positive, negative (cash inflow vs outflow).
- Do not invent categories; use only the values listed.

HISTORICAL NATURE DEFINITIONS:
- reported_non_cash_adjustment: Non-cash addback (D&A, SBC, stock comp, amortization, etc.).
- reported_working_capital_movement: Change in operating working capital (AR, AP, inventory, etc.).
- reported_operating_other: Other operating cash flow (not non-cash addback, not WC).
- reported_investing: CapEx, acquisitions, asset sales, investments.
- reported_financing: Debt/equity issuance or repayment, dividends, share repurchases.
- reported_meta: Section total or net change (e.g. Cash from Operating, Net Change in Cash).

FORECAST DRIVER: same as before (income_statement, danda_schedule, working_capital_schedule, capex_schedule, debt_schedule, financing_assumption, manual_mna, manual_other, disclosure_or_assumption).

Input (JSON):
`;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let item: CFSClassifyItemInput | null = null;
    if (body.label != null && body.sectionContext != null) {
      const operatingSubgroup =
        body.operatingSubgroup != null && ["non_cash", "working_capital", "other_operating"].includes(body.operatingSubgroup)
          ? (body.operatingSubgroup as OperatingSubgroup)
          : undefined;
      item = {
        label: String(body.label).trim(),
        sectionContext: body.sectionContext,
        ...(operatingSubgroup !== undefined ? { operatingSubgroup } : {}),
      };
    }

    if (!item?.label) {
      return NextResponse.json({ suggestion: null });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.AI_MODEL || "gpt-4o-mini";

    if (process.env.NODE_ENV !== "production") {
      console.log("[cfs-classify] OPENAI_API_KEY present:", !!apiKey, "| AI_MODEL:", model);
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured", suggestion: null },
        { status: 503 }
      );
    }

    const sectionContext = item.sectionContext || "operating";
    const operatingSubgroup = item.operatingSubgroup;
    const subgroupPrior =
      sectionContext === "operating" && operatingSubgroup
        ? `\nOPERATING SUBGROUP CONTEXT: The user is adding this row inside the "${operatingSubgroup}" subgroup. Prefer historicalCfsNature: ${operatingSubgroup === "non_cash" ? "reported_non_cash_adjustment" : operatingSubgroup === "working_capital" ? "reported_working_capital_movement" : "reported_operating_other"}. Only suggest a different nature if the label clearly does not fit (e.g. "Depreciation" in working_capital).\n`
        : "";
    const prompt =
      PROMPT +
      subgroupPrior +
      `{ "label": "${item.label.replace(/"/g, '\\"')}", "sectionContext": "${sectionContext}"${operatingSubgroup ? `, "operatingSubgroup": "${operatingSubgroup}"` : ""} }\n\n` +
      "Respond with ONLY one JSON object (section, forecastDriver, historicalCfsNature, sign, reason, confidence), no markdown.";

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
        max_tokens: 512,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[cfs-classify] OpenAI error:", res.status, err);
      return NextResponse.json(
        { error: "LLM request failed", suggestion: null },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data?.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: CFSClassifySuggestion;
    try {
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned) as CFSClassifySuggestion;
    } catch {
      console.error("[cfs-classify] Invalid JSON:", raw.slice(0, 300));
      return NextResponse.json(
        { error: "Invalid LLM response", suggestion: null },
        { status: 502 }
      );
    }

    const section: CFSSection = ["operating", "investing", "financing", "cash_bridge"].includes(parsed.section)
      ? parsed.section
      : (sectionContext === "cash_bridge" ? "cash_bridge" : sectionContext);
    const forecastDriver = CFS_FORECAST_DRIVER_VOCABULARY.includes(parsed.forecastDriver)
      ? parsed.forecastDriver
      : "manual_other";
    const rawNature = (parsed as { historicalCfsNature?: string }).historicalCfsNature;
    const fallbackNatureBySubgroup =
      section === "operating" && operatingSubgroup
        ? (operatingSubgroup === "non_cash"
            ? "reported_non_cash_adjustment"
            : operatingSubgroup === "working_capital"
              ? "reported_working_capital_movement"
              : "reported_operating_other")
        : null;
    const historicalCfsNature = typeof rawNature === "string" && HISTORICAL_CFS_NATURE_VOCABULARY.includes(rawNature as any)
      ? (rawNature as (typeof HISTORICAL_CFS_NATURE_VOCABULARY)[number])
      : (fallbackNatureBySubgroup ?? (section === "cash_bridge" ? "reported_meta" : section === "operating" ? "reported_operating_other" : section === "investing" ? "reported_investing" : "reported_financing"));
    const sign = parsed.sign === "positive" || parsed.sign === "negative" ? parsed.sign : "negative";
    const suggestion: CFSClassifySuggestion = {
      section,
      forecastDriver,
      historicalCfsNature,
      sign,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "",
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    };

    return NextResponse.json({ suggestion });
  } catch (e) {
    console.error("[cfs-classify]", e);
    return NextResponse.json(
      { error: "Server error", suggestion: null },
      { status: 500 }
    );
  }
}
