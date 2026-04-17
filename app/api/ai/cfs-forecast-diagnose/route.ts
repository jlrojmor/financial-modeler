import { NextResponse } from "next/server";
import type { CompanyContext } from "@/types/company-context";
import { buildModelingContext, getModelingContextSummaryForPrompt } from "@/lib/modeling-context";
import type { ForecastDriversCoverageSnapshot } from "@/lib/forecast-drivers-coverage-snapshot";
import type { CfsLineCoverageCompare } from "@/lib/forecast-drivers-coverage-snapshot";
import type { Row } from "@/types/finance";
import { validateAiCfsSuggestion, type RawAiCfsLineSuggestion } from "@/lib/cfs-forecast-diagnose-validate";
import type { CfsLineAiDiagnosisPayload } from "@/types/cfs-forecast-diagnosis-v1";
import { isCfsComputedRollupRowId } from "@/lib/cfs-structural-row-ids";

export type CfsForecastDiagnoseRequestBody = {
  companyContext?: CompanyContext;
  coverageSnapshot: ForecastDriversCoverageSnapshot;
  /** Rows needing AI (typically cf_disclosure_only or with gaps). */
  compares: Pick<CfsLineCoverageCompare, "cfsRowId" | "label" | "deterministicClass" | "gaps" | "likelyCoveredByForecastDrivers">[];
  balanceSheet: Row[];
  incomeStatement: Row[];
};

const PROMPT = `You are a sell-side equity research team (senior analyst + VP review). For EACH Cash Flow Statement line below, produce a decision-quality recommendation that minimizes double-counting and aligns with a three-statement integrated model.

The product already forecasts: Revenue, COGS, OpEx (Forecast Drivers), WC (BS-linked), Capex/D&A schedules, Debt, Equity roll-forward, Other BS, Taxes where configured.

Rubric (apply in order):
1) Is the economic item already captured in forecast IS or BS or a schedule? If yes, prefer bridge (map_to_bs / use_is_bridge) not a standalone CFS assumption.
2) If no clean bridge: is the line material? Immaterial disclosure may be flat_last, zero, or exclude.
3) Call out double-count risk if the user might also reflect this P&L or BS movement elsewhere.
4) Be decisive: pick ONE recommendedTreatment; explain rejected alternatives briefly.

For EACH line, output ONE object in "suggestions" with:
- cfsRowId (string, required)
- suggestedMapping: none | balance_sheet | income_statement | schedule | unmapped
- linkedRowId: optional; MUST be an id from the BS_IDS or IS_IDS lists below when set; otherwise omit
- rationale: short technical note (max 400 chars)
- recommendedTreatment: map_to_bs | use_is_bridge | flat_last | pct_revenue | zero | exclude | manual_grid
- confidence: 0-1
- flags: optional string array e.g. non_recurring, immaterial
- executiveSummary: 2-4 sentences (max 900 chars): economic meaning, how IS/BS/CFS tie, recommended stance
- bridgeRecommendation: 1-3 sentences (max 600 chars): prefer BS vs IS bridge vs CFS-only assumption and why
- doubleCountRisk: one sentence (max 400 chars): overlap risk with other forecast lines
- rejectedAlternatives: array of 1-3 strings; each explains a treatment you did NOT pick and why (max 200 chars each)
- materialityNote: exactly one of: immaterial | standard | material

Rules:
- Do not invent row ids for linkedRowId.
- If issuer-specific disclosure with no bridge: unmapped + flat_last or pct_revenue or zero as appropriate.

COVERAGE_FLAGS (JSON):
LISTS (ids only, for validation):
`;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<CfsForecastDiagnoseRequestBody>;
    const comparesRaw = Array.isArray(body.compares) ? body.compares : [];
    const compares = comparesRaw.filter((c) => c?.cfsRowId && !isCfsComputedRollupRowId(c.cfsRowId));
    const coverageSnapshot = body.coverageSnapshot;
    const balanceSheet = Array.isArray(body.balanceSheet) ? body.balanceSheet : [];
    const incomeStatement = Array.isArray(body.incomeStatement) ? body.incomeStatement : [];

    if (!coverageSnapshot || compares.length === 0) {
      return NextResponse.json({ suggestions: {} as Record<string, CfsLineAiDiagnosisPayload>, error: null });
    }

    const bsIds = coverageSnapshot.balanceSheetRowIds?.join(", ") ?? "";
    const isIds = coverageSnapshot.incomeStatementRowIds?.join(", ") ?? "";
    const linesBlock = compares
      .map(
        (c) =>
          `- ${c.cfsRowId}: "${c.label}" [class=${c.deterministicClass}, fdLikely=${c.likelyCoveredByForecastDrivers}, gaps=${(c.gaps ?? []).join("; ")}]`
      )
      .join("\n");

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.AI_MODEL || "gpt-4o-mini";

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured", suggestions: {} },
        { status: 503 }
      );
    }

    const companyContext = body.companyContext;
    const modelingProfile = buildModelingContext(companyContext);
    const contextSummary = getModelingContextSummaryForPrompt(modelingProfile ?? null);
    const companyBlock = contextSummary ? `\nCOMPANY:\n${contextSummary}\n` : "";

    const flagsJson = JSON.stringify(coverageSnapshot.flags);
    const prompt =
      PROMPT +
      companyBlock +
      `\n${flagsJson}\n\nBS_IDS (sample): ${bsIds.slice(0, 4000)}\n\nIS_IDS (sample): ${isIds.slice(0, 4000)}\n\nLINES:\n${linesBlock}\n\nRespond with ONLY valid JSON. Example shape:\n{"suggestions":[{"cfsRowId":"x","suggestedMapping":"unmapped","linkedRowId":null,"rationale":"...","recommendedTreatment":"flat_last","confidence":0.75,"executiveSummary":"...","bridgeRecommendation":"...","doubleCountRisk":"...","rejectedAlternatives":["..."],"materialityNote":"standard"}]}\n`;

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
        max_tokens: 8192,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[cfs-forecast-diagnose] OpenAI error:", res.status, err);
      return NextResponse.json({ error: "LLM request failed", suggestions: {} }, { status: 502 });
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data?.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: { suggestions?: RawAiCfsLineSuggestion[] };
    try {
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned) as { suggestions?: RawAiCfsLineSuggestion[] };
    } catch {
      console.error("[cfs-forecast-diagnose] Invalid JSON:", raw.slice(0, 400));
      return NextResponse.json({ error: "Invalid LLM response", suggestions: {} }, { status: 502 });
    }

    const out: Record<string, CfsLineAiDiagnosisPayload> = {};
    for (const s of parsed.suggestions ?? []) {
      if (!s?.cfsRowId || isCfsComputedRollupRowId(s.cfsRowId)) continue;
      out[s.cfsRowId] = validateAiCfsSuggestion(s, balanceSheet, incomeStatement);
    }

    return NextResponse.json({ suggestions: out, error: null });
  } catch (e) {
    console.error("[cfs-forecast-diagnose]", e);
    return NextResponse.json({ error: "Server error", suggestions: {} }, { status: 500 });
  }
}
