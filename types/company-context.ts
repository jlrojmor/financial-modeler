/**
 * Company Context — structured profile for WACC, forecasting, benchmarking.
 * Design: user_inputs → AI enrichment → user_overrides.
 */

export type PublicPrivate = "public" | "private";

/** Primary business type (user-selected; drives benchmark family and comp strategy). */
export type PrimaryBusinessType =
  | "manufacturer"
  | "distributor_wholesaler"
  | "retailer"
  | "software_saas"
  | "marketplace_platform"
  | "services"
  | "financial_services"
  | "healthcare_pharma"
  | "infrastructure_industrial"
  | "other";

/** Main operating geography. */
export type MainOperatingGeography = "mexico" | "us" | "canada" | "latam" | "europe" | "global" | "other";

/** Customer type. */
export type CustomerType = "b2b" | "b2c" | "both";

/** Revenue model. */
export type RevenueModel = "product_sales" | "services" | "subscription" | "commission_marketplace" | "mixed";

export interface CompanyContextUserInputs {
  companyName: string;
  publicPrivate: PublicPrivate;
  ticker: string;
  headquartersCountry: string;
  industry: string;
  shortBusinessDescription: string;
  /** Optional hint for private companies: comma-separated comparable public company names/tickers. */
  manualComparableHints?: string;
  /** Known peers or public proxies (optional). Replaces manualComparableHints in UI. */
  knownPeersOrProxies?: string;
  primaryBusinessType?: PrimaryBusinessType;
  mainOperatingGeography?: MainOperatingGeography;
  customerType?: CustomerType;
  revenueModel?: RevenueModel;
  /** User override for reporting currency (e.g. USD, MXN). */
  reportingCurrency?: string;
}

/** Market type for WACC/ERP context. */
export type MarketType = "developed" | "emerging";

export interface CompanyContextMarketData {
  /** Beta estimate (for WACC). */
  beta?: number;
  /** Country risk premium if applicable. */
  countryRiskPremium?: number;
  /** Peer or industry benchmark identifiers. */
  peerTickers?: string[];
  /** Reporting currency (e.g. USD, EUR). Set from HQ country or user. */
  reportingCurrency?: string;
  /** Developed vs emerging market for ERP/CRP context. */
  marketType?: MarketType;
}

/** Market / WACC context for valuation (reference inputs). */
export interface WaccValuationContext {
  /** Risk-free rate reference (e.g. "10Y UST", "10Y Bund"). */
  riskFreeRateMarket?: string;
  /** Alias for riskFreeRateMarket. */
  riskFreeReference?: string;
  /** Country / sovereign risk context (e.g. "US", "Brazil + CRP 2%"). */
  countrySovereignRisk?: string;
  /** Alias for countrySovereignRisk. */
  countryRiskContext?: string;
  /** Equity risk premium basis (e.g. "Damodaran implied", "Historical"). */
  equityRiskPremiumBasis?: string;
  /** Beta estimate for cost of equity (company-specific from peer set). */
  betaEstimate?: number;
  /** Same as betaEstimate; preferred name for evidence. */
  selectedBetaEstimate?: number;
  /** Peer beta range (min). */
  peerBetaRangeMin?: number;
  /** Peer beta range (max). */
  peerBetaRangeMax?: number;
  /** Human-readable peer beta range (e.g. "0.9–1.3"). */
  peerBetaRange?: string;
  /** Leverage benchmark (e.g. "Net debt / EBITDA 1.0–2.0x"); company-specific. */
  leverageBenchmark?: string;
  /** Cost of debt context if available. */
  costOfDebtContext?: string;
  /** Basis for WACC context (e.g. "Proxy public peers; Mexico CRP"). */
  waccContextBasis?: string;
}

export interface CompanyContextAiContext {
  companyOverview: string;
  businessModelSummary: string;
  industryContext: string;
  geographyAndMacro: string;
  capitalStructureContext: string;
  aiModelingNotes: string;
}

/** Role of a comparable company in the set. */
export type CompRole = "operating_comp" | "valuation_comp" | "beta_comp";

/** Comp status: suggested = AI proposed (user can Accept/Replace/Remove); accepted = user accepted or added manually. */
export type CompStatus = "suggested" | "accepted";

/** Source/basis for a comp suggestion. */
export type CompSourceBasis = "ai_suggested" | "user_provided" | "user_hint" | "proxy_peer" | "direct_peer" | "sector_peer";

/** Confidence level for research outputs (gate misleading content when low). */
export type ConfidenceLevel = "high" | "medium" | "low";

/** Why a peer was selected: direct comp, proxy peer, user hint, or low-confidence suggestion. */
export type PeerSuggestionType = "direct_comp" | "proxy_peer" | "user_hint" | "low_confidence_suggestion";

/** Per-dimension confidence for company context generation. */
export interface ConfidenceDimension {
  level: ConfidenceLevel;
  message?: string;
}

/** Confidence across company identification, business model, peer generation, benchmark selection. */
export interface CompanyContextConfidence {
  companyIdentification: ConfidenceDimension;
  businessModelClassification: ConfidenceDimension;
  peerGeneration: ConfidenceDimension;
  benchmarkFamilySelection: ConfidenceDimension;
  /** Overall: low if any dimension is low. */
  overall: ConfidenceLevel;
}

/** Healthcare sector subtypes (avoid mixing labs with industrial). */
export type HealthcareSubtype =
  | "diagnostics_lab"
  | "clinical_testing"
  | "medical_device"
  | "pharma_biotech"
  | "healthcare_services"
  | "contract_lab"
  | "healthcare_generic";

export interface SuggestedComp {
  id: string;
  companyName: string;
  ticker?: string;
  reason: string;
  role: CompRole;
  /** suggested = proposed by AI; accepted = user accepted or added manually. */
  status?: CompStatus;
  /** How this comp was derived (AI-suggested, user-provided, proxy peer, etc.). */
  sourceBasis?: CompSourceBasis;
  /** Why this peer was selected; what matched (business model, geography, role). */
  matchSummary?: string;
  /** 0–1 relevance score from research. */
  relevanceScore?: number;
  /** high = strong match; low = weak or fallback. */
  suggestionConfidence?: ConfidenceLevel;
  /** Display label: direct comp, proxy peer, user hint, low-confidence suggestion. */
  suggestionType?: PeerSuggestionType;
  /** Resolution state after enrichment: resolved, unresolved, or needs review. */
  resolutionState?: CompResolutionState;
  /** Confidence in resolution (high / medium / low). */
  resolutionConfidence?: ConfidenceLevel;
  /** Best fuzzy match score (0–1) when resolved via similarity; for debugging. */
  resolutionMatchScore?: number;
  /** Enriched: country. */
  country?: string;
  /** Enriched: sector or industry. */
  sector?: string;
  /** Enriched: business type / subtype. */
  businessTypeSubtype?: string;
  /** Per-comp beta (for comp-derived metrics). */
  beta?: number;
  /** Per-comp net debt / EBITDA. */
  netDebtEbitda?: number;
  /** Per-comp revenue growth (e.g. %). */
  revenueGrowth?: number;
  /** Per-comp EBITDA margin (%). */
  ebitdaMargin?: number;
  /** Per-comp EBIT margin (%). */
  ebitMargin?: number;
  /** Per-comp capex / revenue (%). */
  capexPctRevenue?: number;
}

/** Resolution state for a comparable company after enrichment. */
export type CompResolutionState = "resolved" | "unresolved" | "needs_review";

/** Aggregated metrics derived from accepted comps (for WACC and benchmark context). */
export interface CompDerivedMetrics {
  acceptedCount: number;
  withDataCount: number;
  source: "accepted_comps" | "fallback";
  medianBeta?: number;
  betaRangeMin?: number;
  betaRangeMax?: number;
  medianNetDebtEbitda?: number;
  leverageRangeMin?: number;
  leverageRangeMax?: number;
  revenueGrowthMin?: number;
  revenueGrowthMax?: number;
  ebitdaMarginMin?: number;
  ebitdaMarginMax?: number;
  ebitMarginMin?: number;
  ebitMarginMax?: number;
  capexPctRevenueMin?: number;
  capexPctRevenueMax?: number;
}

/** Candidate peer from the peer research engine (before selection into displayed comp set). */
export interface CandidatePeer {
  name: string;
  ticker?: string;
  country?: string;
  businessModelRelevance?: string;
  role: CompRole;
  rationale: string;
  sourceBasis: CompSourceBasis;
  /** 0–1 relevance for ranking. */
  relevanceScore?: number;
}

/** How a benchmark range was derived (peer-derived > proxy-peer > family fallback). */
export type BenchmarkBasis = "peer_derived" | "proxy_peer_derived" | "benchmark_family_fallback";

/** Expanded research evidence (entity, peers, benchmarks, market, synthesis) for debugging and synthesis. */
export interface CompanyContextEvidenceV2 {
  entityEvidence: string[];
  peerEvidence: {
    candidatePeers: CandidatePeer[];
    selectedPeers: SuggestedComp[];
    selectionRationale?: string;
  };
  benchmarkEvidence: {
    ranges: IndustryBenchmarks;
    basis: Partial<Record<string, BenchmarkBasis>>;
    primaryBasis: BenchmarkBasis;
  };
  marketEvidence: {
    riskFreeReference?: string;
    countryRiskContext?: string;
    betaLogic?: string;
    leverageLogic?: string;
    waccContextBasis?: string;
  };
  synthesisBasis?: string;
}

/** Working capital intensity level for benchmark display. */
export type WcIntensityLevel = "low" | "medium" | "high";

/** Industry benchmark ranges (reference only; not final assumptions). */
export interface IndustryBenchmarks {
  revenueGrowthMin?: number;
  revenueGrowthMax?: number;
  grossMarginMin?: number;
  grossMarginMax?: number;
  ebitdaMarginMin?: number;
  ebitdaMarginMax?: number;
  ebitMarginMin?: number;
  ebitMarginMax?: number;
  capexPctRevenueMin?: number;
  capexPctRevenueMax?: number;
  /** Numeric range (legacy). */
  wcIntensityMin?: number;
  wcIntensityMax?: number;
  /** Display as Low / Medium / High. */
  wcIntensityLevel?: WcIntensityLevel;
  leverageNetDebtEbitdaMin?: number;
  leverageNetDebtEbitdaMax?: number;
  betaMin?: number;
  betaMax?: number;
  /** Optional: how each range was derived (for credibility). Keys match metric names. */
  basis?: Partial<Record<string, BenchmarkBasis>>;
}

/** Practical modeling guidance for analysts (structured sub-blocks). */
export interface ModelingImplications {
  /** Key forecast drivers (revenue, margins, etc.). */
  keyForecastDrivers: string;
  /** Working capital watchouts (DSO, DIO, DPO, intensity). */
  wcDrivers: string;
  /** Capex / reinvestment profile. */
  capexBehavior: string;
  /** Margin structure (gross, EBIT, leverage). */
  marginStructure: string;
  /** Valuation / WACC watchouts (terminal growth, beta, CRP). */
  valuationWatchouts: string;
}

/** Source of company research evidence (website, user text, or inferred). */
export type ResearchSourceType = "website" | "user_description" | "inferred" | "mixed";

/** Confidence in the company research (for overview / snapshot). */
export type ResearchConfidence = "research_backed" | "mixed_evidence" | "limited_evidence";

/** Lightweight company research output: evidence gathered before synthesis. */
export interface CompanyResearch {
  /** Likely official company name (cleaned from input). */
  resolvedEntityName: string;
  /** Likely website/domain (guessed or resolved). */
  resolvedWebsite?: string;
  /** Homepage/about summary if available (e.g. from fetch). */
  websiteSummary?: string;
  /** Business model clues from description or site. */
  businessModelEvidence: string[];
  /** Subtype clues (e.g. clinical lab, pharma). */
  subtypeEvidence: string[];
  /** Region/geography clues. */
  regionEvidence: string[];
  /** Overall research confidence for UI. */
  researchConfidence: ResearchConfidence;
  /** Primary source of evidence. */
  sourceType: ResearchSourceType;
}

/** Source of context content for labeling/badges. */
export type ContextSource = "user_input" | "ai_generated" | "benchmark" | "user_override";

/** User overrides for any AI/market field. Key = field path or identifier. */
export type CompanyContextUserOverrides = Record<string, string | number | undefined>;

export interface CompanyContext {
  user_inputs: CompanyContextUserInputs;
  market_data: CompanyContextMarketData;
  /** Market / WACC valuation context (risk-free, ERP, beta, leverage, cost of debt). */
  wacc_context: WaccValuationContext;
  ai_context: CompanyContextAiContext;
  /** Suggested comparable companies (proposed by AI; user Accept/Replace/Remove). */
  suggested_comps: SuggestedComp[];
  /** Industry benchmark ranges (reference; editable). */
  industry_benchmarks: IndustryBenchmarks;
  /** Modeling implications (forecast drivers, WC, capex, margins, watchouts). */
  modeling_implications: ModelingImplications;
  user_overrides: CompanyContextUserOverrides;
  /** True after "Generate Company Context" has been run at least once. */
  generatedAt: number | null;
  /** True when user_inputs changed after last generation; context should be regenerated. */
  isContextStale?: boolean;
  /** Hash/fingerprint of user_inputs at last generation; used to detect stale state. */
  lastGeneratedFromInputsHash?: string;
  /** Confidence per dimension; when overall is low, show notEnoughEvidenceMessage instead of misleading output. */
  confidence?: CompanyContextConfidence;
  /** Shown when confidence is low: what to add (known peers, specific description, subtype). */
  notEnoughEvidenceMessage?: string;
  /** Lightweight company research (entity, website, evidence) used for overview and subtype. */
  companyResearch?: CompanyResearch;
  /** Metrics derived from accepted comps (beta, leverage, operating ranges); recomputed when comps change. */
  compDerivedMetrics?: CompDerivedMetrics;
}

export const DEFAULT_COMPANY_CONTEXT_USER_INPUTS: CompanyContextUserInputs = {
  companyName: "",
  publicPrivate: "public",
  ticker: "",
  headquartersCountry: "",
  industry: "",
  shortBusinessDescription: "",
};

export const DEFAULT_COMPANY_CONTEXT_AI: CompanyContextAiContext = {
  companyOverview: "",
  businessModelSummary: "",
  industryContext: "",
  geographyAndMacro: "",
  capitalStructureContext: "",
  aiModelingNotes: "",
};

export const DEFAULT_INDUSTRY_BENCHMARKS: IndustryBenchmarks = {};

export const DEFAULT_MODELING_IMPLICATIONS: ModelingImplications = {
  keyForecastDrivers: "",
  wcDrivers: "",
  capexBehavior: "",
  marginStructure: "",
  valuationWatchouts: "",
};

export const DEFAULT_WACC_CONTEXT: WaccValuationContext = {};

/** Build a stable string from user_inputs for stale detection. */
export function getCompanyContextInputsHash(inputs: CompanyContextUserInputs): string {
  const u = inputs;
  return [
    u.companyName?.trim() ?? "",
    u.publicPrivate ?? "",
    u.ticker?.trim() ?? "",
    u.headquartersCountry ?? "",
    u.industry ?? "",
    u.shortBusinessDescription?.trim() ?? "",
    u.manualComparableHints?.trim() ?? "",
    u.knownPeersOrProxies?.trim() ?? "",
    u.primaryBusinessType ?? "",
    u.mainOperatingGeography ?? "",
    u.customerType ?? "",
    u.revenueModel ?? "",
    u.reportingCurrency ?? "",
  ].join("|");
}

export function getDefaultCompanyContext(): CompanyContext {
  return {
    user_inputs: { ...DEFAULT_COMPANY_CONTEXT_USER_INPUTS },
    market_data: {},
    wacc_context: { ...DEFAULT_WACC_CONTEXT },
    ai_context: { ...DEFAULT_COMPANY_CONTEXT_AI },
    suggested_comps: [],
    industry_benchmarks: { ...DEFAULT_INDUSTRY_BENCHMARKS },
    modeling_implications: { ...DEFAULT_MODELING_IMPLICATIONS },
    user_overrides: {},
    generatedAt: null,
  };
}

/**
 * Canonical company-aware modeling context for downstream suggestion systems.
 * Single source of truth: historicals, classification, CF, projections, DCF should consume this
 * rather than reading random pieces of companyContext. Context-weighted, not context-forced.
 */
export interface CompanyModelingProfile {
  companyName: string;
  publicPrivate: PublicPrivate;
  headquartersCountry: string;
  mainOperatingGeography: MainOperatingGeography | "";
  industry: string;
  primaryBusinessType: PrimaryBusinessType | "";
  revenueModel: RevenueModel | "";
  customerType: CustomerType | "";
  /** Benchmark family (e.g. premium_branded_retail, software_saas). */
  benchmarkFamily: string;
  /** Inferred business model type (e.g. branded_retail, wholesale_distribution). */
  businessModelType: string;
  /** Accepted comps only (status === "accepted"). */
  acceptedComps: SuggestedComp[];
  compDerivedMetrics?: CompDerivedMetrics;
  waccContext: WaccValuationContext;
  industryBenchmarks: IndustryBenchmarks;
  modelingImplications: ModelingImplications;
  /** Working capital profile: low / medium / high. */
  workingCapitalProfile: string;
  /** Margin profile: premium / scale / mixed. */
  marginProfile: string;
  /** Capex profile: light / moderate / heavy. */
  capexProfile: string;
  /** Evidence quality / confidence for suggestions. */
  confidence?: CompanyContextConfidence;
  /** Short business description (signals for classification). */
  shortBusinessDescription: string;
  /** Whether context was generated (has profile + benchmarks). */
  hasGeneratedContext: boolean;
}
