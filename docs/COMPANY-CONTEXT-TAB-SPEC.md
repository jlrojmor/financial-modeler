# Company Context Tab — Complete Specification for AI/LLM

This document explains exactly how the **Company Context** tab is built and how it works, so an AI or another developer can reason about or extend it without reading all the code.

---

## 1. Where the tab lives in the app

- **Step id:** `company_context` (first step in the modeling wizard).
- **Route:** Project page at `/project/[id]`. The main area is a two-column layout: left = **BuilderPanel**, right = **preview**.
- **When `currentStepId === "company_context"`:**
  - **Left column (BuilderPanel):** Renders **CompanyContextTab** (the full form/editor). The **Years Editor** is hidden on this step.
  - **Right column:** Renders **CompanyContextPreview** (read-only “Intelligence” summary). Other steps use `ExcelPreview` or `ISBuildPreview` instead.
- **Layout:** `app/project/[id]/page.tsx` uses a grid; `components/builder-panel.tsx` conditionally renders `{currentStepId === "company_context" && <CompanyContextTab />}` and does not render `YearsEditor` for this step.

---

## 2. Data model: `CompanyContext`

All Company Context state lives in the global Zustand store under **`companyContext`**. The type is **`CompanyContext`** from `types/company-context.ts`.

### 2.1 Top-level shape

```ts
CompanyContext = {
  user_inputs: CompanyContextUserInputs;   // User-editable company details
  market_data: CompanyContextMarketData;    // Beta, currency, market type (set/updated by generation + overrides)
  wacc_context: WaccValuationContext;        // Risk-free, ERP, beta, peer beta range, leverage, etc.
  ai_context: CompanyContextAiContext;      // Six text cards (overview, business model, industry, etc.)
  suggested_comps: SuggestedComp[];         // Comps: suggested + accepted, user can edit/accept/remove
  industry_benchmarks: IndustryBenchmarks; // Min/max ranges (revenue growth, margins, capex, leverage, beta, WC intensity)
  modeling_implications: ModelingImplications; // Five text blocks (forecast drivers, WC, capex, margins, valuation)
  user_overrides: CompanyContextUserOverrides; // Key-value overrides (e.g. "beta", "ai_context.companyOverview")
  generatedAt: number | null;               // Timestamp of last "Generate"; null = never generated
  lastGeneratedFromInputsHash?: string;     // Hash of user_inputs at generation (for staleness)
  isContextStale?: boolean;                 // True when user_inputs changed after last generation
  confidence?: CompanyContextConfidence;    // Per-dimension and overall (company, business, peers, benchmarks)
  notEnoughEvidenceMessage?: string;       // Shown when confidence is low
  companyResearch?: CompanyResearch;        // Lightweight research (entity, evidence, researchConfidence)
  compDerivedMetrics?: CompDerivedMetrics;  // From accepted comps: median beta, leverage, ranges, etc.
}
```

### 2.2 User inputs (`user_inputs`)

- **companyName** (required for generation), **publicPrivate**, **ticker** (if public), **headquartersCountry**, **industry** (dropdown), **shortBusinessDescription** (textarea).
- **primaryBusinessType**, **mainOperatingGeography**, **customerType**, **revenueModel** (dropdowns).
- **knownPeersOrProxies** (same as legacy **manualComparableHints**): comma-separated peer names/tickers.
- **reportingCurrency** (optional, e.g. USD, MXN).

### 2.3 AI context (`ai_context`)

Six string cards, each editable by the user (edits stored in **user_overrides** under `ai_context.<key>` and mirrored into **ai_context**):

- companyOverview, businessModelSummary, industryContext, geographyAndMacro, capitalStructureContext, aiModelingNotes.

### 2.4 Suggested comps (`suggested_comps`)

Each **SuggestedComp** has: **id**, **companyName**, **ticker**, **reason**, **role** (operating_comp | valuation_comp | beta_comp), **status** (suggested | accepted), **sourceBasis**, **suggestionType** (e.g. direct_comp, proxy_peer), **resolutionState**, and optional enriched fields (country, sector, beta, netDebtEbitda, revenueGrowth, margins, etc.). **CompDerivedMetrics** is recomputed from comps whose **status === "accepted"** and with data (e.g. median beta, beta range, leverage range).

### 2.5 Industry benchmarks (`industry_benchmarks`)

Numeric min/max pairs: revenue growth, gross margin, EBITDA margin, EBIT margin, capex/revenue %, net debt/EBITDA, beta; plus **wcIntensityLevel** (low | medium | high). All editable in the tab.

### 2.6 Modeling implications (`modeling_implications`)

Five text blocks: keyForecastDrivers, wcDrivers, capexBehavior, marginStructure, valuationWatchouts. All editable.

---

## 3. Store actions used by the tab

From **`store/useModelStore.ts`**:

- **updateCompanyContextInputs(patch)** — Merges into `user_inputs`; recomputes **isContextStale** by comparing current **getCompanyContextInputsHash(user_inputs)** to **lastGeneratedFromInputsHash**.
- **generateCompanyContext()** — Async. Runs the full pipeline (see below) and sets **market_data**, **wacc_context**, **ai_context**, **suggested_comps**, **industry_benchmarks**, **modeling_implications**, **compDerivedMetrics**, **confidence**, **notEnoughEvidenceMessage**, **companyResearch**, **generatedAt**, **lastGeneratedFromInputsHash**, **isContextStale: false**. Preserves **user_overrides**.
- **updateCompanyContextCard(key, value)** — Updates one **ai_context** card and stores override **`ai_context.${key}`** in **user_overrides**.
- **updateCompanyContextOverride(key, value)** — Sets **user_overrides[key]**; if key is **"beta"**, also updates **market_data.beta**.
- **setSuggestedComps(comps)** — Replaces **suggested_comps**, recomputes **compDerivedMetrics**, and applies comp-derived WACC/market updates.
- **updateSuggestedComp(id, patch)** — Merges **patch** into the comp with **id**; recomputes **compDerivedMetrics** and WACC/market.
- **enrichSuggestedComp(id)** — Resolves comp by name/ticker (e.g. **resolveComp**), merges enrichment into that comp, recomputes **compDerivedMetrics** and WACC/market.
- **addSuggestedComp(comp)** — Appends a new comp (with generated **id**, **status: "accepted"**), runs enrichment, updates comp-derived metrics and WACC/market. Returns the new **id**.
- **removeSuggestedComp(id)** — Removes comp, recomputes **compDerivedMetrics** and WACC/market.
- **acceptSuggestedComp(id)** — Sets **status** of that comp to **"accepted"**; recomputes **compDerivedMetrics** and WACC/market.
- **updateIndustryBenchmarks(patch)** — Deep-merges **patch** into **industry_benchmarks**.
- **updateModelingImplications(patch)** — Merges **patch** into **modeling_implications**.
- **updateWaccContext(patch)** — Merges **patch** into **wacc_context**.

---

## 4. Generate pipeline (what runs when user clicks “Generate company context”)

**generateCompanyContext** in the store does the following (order matters):

1. **runCompanyResearch(user_inputs)** (`lib/company-research.ts`) — Builds **CompanyResearch** from name, description, HQ (no external fetch yet): entity name, optional domain guess, **businessModelEvidence**, **subtypeEvidence**, **regionEvidence**, **researchConfidence**, **sourceType**.
2. **interpretCompanyFromInputs(user_inputs)** (`lib/company-context-interpretation.ts`) — Produces **InterpretedCompanyProfile**: business_model_type, company_listing_type, market_region_type, comp_selection_strategy, wacc_reference_region, working_capital_profile, margin_profile, capex_profile, benchmark_family, descriptionSignals, manualCompHints, plus user-selected business_type, revenue_model, customer_type, main_operating_geography, reportingCurrency, etc.
3. **classifySubtype** (internal) — Healthcare and other subtypes from inputs + profile.
4. **getAllowedBusinessModelsForPeers(profile, subtypeResult)** — Restricts which business models are allowed for peer selection.
5. **runPeerResearch(user_inputs, profile, ts, allowedBusinessModels)** — Returns **candidatePeers** and **recommendedComps** (SuggestedComp[]). Uses profile, manual hints, and a curated peer universe; no live API.
6. **computeConfidence(...)** — Returns **CompanyContextConfidence** (per-dimension and overall). **getNotEnoughEvidenceMessage(confidence)** used when overall is low.
7. **getBenchmarksFromEvidence(profile, recommendedComps)** — Returns **ranges** (IndustryBenchmarks) and basis info.
8. **getWaccContextFromProfile(profile, recommendedComps)** — Returns **WaccValuationContext** (risk-free, ERP, beta, peer beta range, leverage, etc.).
9. **getModelingImplicationsFromProfile(profile)** — Returns **ModelingImplications** (five text blocks).
10. **buildResearchEvidenceV2(...)** — Builds full evidence structure (for debugging / future use).
11. **getAiContextFromProfile(user_inputs, profile, evidence, companyResearch)** — Produces the six **ai_context** strings.
12. **getCompDerivedMetrics(suggested_comps)** — From accepted comps with data: median beta, beta range, median leverage, leverage range, revenue growth range, EBITDA/EBIT margin ranges, capex/revenue range.
13. **set** — Writes **market_data**, **wacc_context**, **ai_context**, **suggested_comps**, **compDerivedMetrics**, **industry_benchmarks**, **modeling_implications**, **generatedAt**, **lastGeneratedFromInputsHash**, **isContextStale: false**, **confidence**, **notEnoughEvidenceMessage**, **companyResearch**; **user_overrides** are preserved.

So: **user_inputs → research + profile → peers + benchmarks + WACC + implications + AI text → comp-derived metrics → single store update.**

---

## 5. UI structure of Company Context tab

**Component:** `components/company-context-tab.tsx`. Single page, scrollable; no sub-routes.

### 5.1 Section order (after “Company details”)

1. **Company details** (collapsible)  
   - All **user_inputs** fields (company name, public/private, ticker, HQ, industry, primary business type, main geography, customer type, revenue model, known peers, reporting currency, short business description).  
   - Button: **“Generate company context”** (or “Regenerate…” if **generatedAt** set). Disabled if company name is empty or while **generating**.  
   - If **isContextStale**, a banner says company details changed and suggests regenerate.

2. **Pre-generate message**  
   - If **!hasGenerated**, a short message tells the user to enter details and click Generate.

3. **Post-generate only (hasGenerated)**  
   - Stale banner (if **isContextStale**) with Regenerate button.  
   - Low-confidence banner (if **confidence.overall === "low"** and **notEnoughEvidenceMessage**) with suggestion to add peers or description.  
   - **Snapshot bar** — Tags: research confidence, industry, public/private, HQ, reporting currency, market type, risk-free, ERP, beta, peer beta range, leverage.  
   - **Market & valuation context** — Editable table: risk-free reference, country/sovereign risk, ERP basis, beta estimate (also in **user_overrides.beta**), peer beta range min/max, leverage benchmark, cost of debt context. Uses **updateWaccContext** and **updateCompanyContextOverride("beta", v)**.  
   - **Comparable companies** — List of **suggested_comps**. Each comp: view mode (name, ticker, role, reason, badges, Accept/Edit/Remove) or edit mode (name, ticker, role, reason + Save/Cancel). “Add manual comp” calls **addSuggestedComp**. Accept sets **status: "accepted"** and recomputes comp-derived metrics. **enrichSuggestedComp** runs on Save when editing (resolve by name/ticker). Comp-derived metrics block explains whether beta/leverage come from accepted comps or fallback.  
   - **Comp-derived metrics** (if any accepted comps) — Accepted count, with-data count, median beta, beta range, median net debt/EBITDA, leverage range, revenue growth range, EBITDA margin range, capex/revenue range.  
   - **Industry benchmarks** — Table of min/max inputs per metric (revenue growth, gross margin, EBITDA margin, EBIT margin, capex/revenue, net debt/EBITDA, beta) plus working capital intensity dropdown. Uses **updateIndustryBenchmarks**.  
   - **Modeling guidance** — Five textareas for **modeling_implications** (keyForecastDrivers, wcDrivers, capexBehavior, marginStructure, valuationWatchouts). Uses **updateModelingImplications**.  
   - **Company snapshot** — Six textareas for **ai_context** cards (same keys as **CARD_KEYS**). Display value: **user_overrides[`ai_context.${key}`] ?? ai[key]**; onChange calls **updateCompanyContextCard(key, value)**.

### 5.2 Source badges

- **SourceBadge**: user_input, ai_generated, benchmark, user_override (colors and labels).  
- **PeerSuggestionBadge**: direct_comp, proxy_peer, user_hint, low_confidence_suggestion.  
- **ResolutionBadge**: resolved, unresolved, needs_review (for comp resolution state).

---

## 6. Right-hand preview: CompanyContextPreview

**Component:** `components/company-context-preview.tsx`. Read-only.

- **Company** — Name, public/private, ticker, industry, HQ, reporting currency from **user_inputs** and **market_data**.  
- **WACC Snapshot** — Risk-free, ERP, beta, peer beta range, leverage from **wacc_context**; beta can come from **user_overrides.beta** or **wacc.betaEstimate** or **market.beta**.  
- **Comp Set** — Accepted comps only (**status === "accepted"**), up to 8 shown with name, ticker, role.  
- **Status** — Generated timestamp, stale vs up-to-date, count of overrides.

---

## 7. Downstream use of Company Context

- **CompanyModelingProfile** — Built by **buildModelingContext(companyContext)** in `lib/modeling-context.ts`. Consumed by forecast/revenue suggestion logic (e.g. **getRevenueForecastSuggestionsFromProfile**), classification, and other company-aware features.  
- **WACC / DCF** — **wacc_context** and **market_data** (and comp-derived metrics) feed into WACC and valuation steps.  
- **Industry benchmarks** — Reference ranges for revenue growth, margins, leverage, etc., used in modeling guidance and suggestions.  
- **AI classification APIs** — Some routes (e.g. IS/CF/CFS classify) accept **companyContext** in the request body for company-aware classification.

---

## 8. File map

| Purpose | File |
|--------|------|
| Tab UI | `components/company-context-tab.tsx` |
| Right preview | `components/company-context-preview.tsx` |
| Types & defaults | `types/company-context.ts` |
| Interpretation, peers, WACC, benchmarks, implications, AI text, confidence | `lib/company-context-interpretation.ts` |
| Lightweight research from inputs | `lib/company-research.ts` |
| Build CompanyModelingProfile from CompanyContext | `lib/modeling-context.ts` |
| Store state & actions | `store/useModelStore.ts` (companyContext, generateCompanyContext, update*, setSuggestedComps, etc.) |
| Project layout & step routing | `app/project/[id]/page.tsx` |
| Step content routing | `components/builder-panel.tsx` |

---

## 9. Summary for an LLM

- **Company Context** is the first wizard step (`company_context`). It collects **user_inputs** and, on **Generate**, runs a **deterministic pipeline** (no LLM call in the current implementation): interpret profile from inputs → run peer research from a curated universe → compute benchmarks, WACC context, modeling implications, and AI snapshot text → write everything into **companyContext** and set **generatedAt**.
- **Staleness:** Changing **user_inputs** after generation sets **isContextStale**; the UI prompts the user to regenerate.
- **Comps:** Suggested list is generated; user can **Accept**, **Edit** (then **Save** to enrich), **Remove**, or **Add manual comp**. Only **accepted** comps with data drive **compDerivedMetrics** and WACC/market updates.
- **Overrides:** User edits to AI cards go to **user_overrides** and **ai_context**; beta override goes to **user_overrides.beta** and **market_data.beta**. Overrides are kept across regeneration.
- **Preview** on the right shows company, WACC snapshot, accepted comp set, and generation status; it does not edit state.

This spec, plus the types in `types/company-context.ts` and the store actions listed above, is enough to understand and modify the Company Context tab and its pipeline.
