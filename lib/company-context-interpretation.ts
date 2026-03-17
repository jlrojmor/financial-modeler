/**
 * Company interpretation layer: derive a structured internal profile from user_inputs
 * so that generation (comps, WACC, benchmarks, modeling guidance) is company-specific.
 * Architecture: Layer A (user facts) → Layer B (research evidence) → Layer C (synthesized context).
 */

import type { CompanyContextUserInputs, CompanyContextAiContext, SuggestedComp, CompSourceBasis, CompRole, ConfidenceLevel, CompanyContextConfidence, ConfidenceDimension, HealthcareSubtype, PeerSuggestionType } from "@/types/company-context";
import type { PrimaryBusinessType, MainOperatingGeography, CustomerType, RevenueModel } from "@/types/company-context";
import type { IndustryBenchmarks, BenchmarkBasis, CandidatePeer, CompanyContextEvidenceV2, CompanyResearch, CompDerivedMetrics, CompResolutionState } from "@/types/company-context";
import type { ModelingImplications } from "@/types/company-context";
import type { WaccValuationContext } from "@/types/company-context";
import { distance } from "fastest-levenshtein";

/** Inferred business model archetype (drives comps, benchmarks, modeling notes). */
export type BusinessModelType =
  | "branded_retail"
  | "wholesale_distribution"
  | "consumer_staples_distribution"
  | "software_saas"
  | "industrial_manufacturing"
  | "healthcare_services"
  | "marketplace"
  | "logistics"
  | "financial_services"
  | "generic";

/** Benchmark family — used to select benchmark ranges (not broad industry label). */
export type BenchmarkFamily =
  | "premium_branded_retail"
  | "wholesale_distribution"
  | "consumer_staples_distribution"
  | "saas"
  | "industrial_manufacturing"
  | "healthcare_services"
  | "marketplace_platform"
  | "logistics"
  | "financial_services"
  | "generic";

/** Public vs private — affects framing and comp strategy. */
export type CompanyListingType = "public" | "private";

/** Developed vs emerging — affects WACC, CRP, currency. */
export type MarketRegionType = "developed" | "emerging";

/** How to select comps: direct peers vs proxy public peers. */
export type CompSelectionStrategy = "direct_peers" | "proxy_public_peers" | "sector_peers";

/** WACC reference region (for Rf, ERP, CRP framing). */
export type WaccReferenceRegion = "us" | "canada" | "mexico" | "latam" | "europe" | "other_developed" | "emerging";

/** Working capital intensity profile. */
export type WorkingCapitalProfile = "low" | "medium" | "high";

/** Margin profile (premium vs scale-driven). */
export type MarginProfile = "premium" | "scale" | "mixed";

/** Capex intensity. */
export type CapexProfile = "light" | "moderate" | "heavy";

export interface InterpretedCompanyProfile {
  business_model_type: BusinessModelType;
  company_listing_type: CompanyListingType;
  market_region_type: MarketRegionType;
  comp_selection_strategy: CompSelectionStrategy;
  wacc_reference_region: WaccReferenceRegion;
  working_capital_profile: WorkingCapitalProfile;
  margin_profile: MarginProfile;
  capex_profile: CapexProfile;
  /** User-selected or inferred primary business type. */
  business_type: PrimaryBusinessType;
  /** User-selected or inferred revenue model. */
  revenue_model: RevenueModel;
  /** User-selected or inferred customer type. */
  customer_type: CustomerType;
  /** User-selected or inferred main operating geography. */
  main_operating_geography: MainOperatingGeography;
  /** Benchmark family used for range selection (not broad industry). */
  benchmark_family: BenchmarkFamily;
  headquartersCountry: string;
  industry: string;
  reportingCurrency: string;
  descriptionSignals: string[];
  /** Parsed known peers / proxy hints (from knownPeersOrProxies or manualComparableHints). */
  manualCompHints: string[];
}

/** Layer B: research evidence (legacy shape; use CompanyContextEvidenceV2 for full evidence). */
export interface CompanyContextEvidence {
  entityClues: string[];
  peerClues: string[];
  countryRegionContext: string;
  benchmarkFamily: BenchmarkFamily;
  valuationContextBasis: string;
  peerCandidates: { name: string; ticker?: string; role: string; basis: CompSourceBasis }[];
}

/** Single peer row in the curated universe (region = geography preference). */
interface PeerRow {
  name: string;
  ticker: string;
  country: string;
  business_model_type: BusinessModelType;
  role: CompRole;
  rationale: string;
}

/** Curated peer universe: real public companies by business model and region. */
const PEER_UNIVERSE: PeerRow[] = [
  // Premium branded retail / apparel — US & Canada
  { name: "Lululemon Athletica", ticker: "LULU", country: "Canada", business_model_type: "branded_retail", role: "operating_comp", rationale: "Premium athletic apparel; direct peer for branded retail." },
  { name: "Nike Inc", ticker: "NKE", country: "United States", business_model_type: "branded_retail", role: "valuation_comp", rationale: "Global athletic leader; scale and margin benchmark." },
  { name: "Deckers Outdoor", ticker: "DECK", country: "United States", business_model_type: "branded_retail", role: "valuation_comp", rationale: "Premium footwear/apparel; margin comp." },
  { name: "On Holding AG", ticker: "ONON", country: "Switzerland", business_model_type: "branded_retail", role: "beta_comp", rationale: "High-growth athletic brand; growth comp." },
  { name: "Adidas AG", ticker: "ADS", country: "Germany", business_model_type: "branded_retail", role: "beta_comp", rationale: "Large strategic competitor; global comp." },
  { name: "Ulta Beauty", ticker: "ULTA", country: "United States", business_model_type: "branded_retail", role: "operating_comp", rationale: "Beauty specialty retail; margin structure." },
  // Wholesale / distribution — US
  { name: "Sysco Corporation", ticker: "SYY", country: "United States", business_model_type: "wholesale_distribution", role: "operating_comp", rationale: "Broadline food distribution; scale and margins." },
  { name: "US Foods Holding", ticker: "USFD", country: "United States", business_model_type: "wholesale_distribution", role: "valuation_comp", rationale: "Food distribution peer." },
  { name: "Performance Food Group", ticker: "PFGC", country: "United States", business_model_type: "wholesale_distribution", role: "beta_comp", rationale: "Distribution and logistics." },
  { name: "Core-Mark Holding", ticker: "CORE", country: "United States", business_model_type: "wholesale_distribution", role: "operating_comp", rationale: "Wholesale distribution." },
  // Wholesale / distribution — Mexico & LATAM
  { name: "Organización Soriana", ticker: "SORIANA.MX", country: "Mexico", business_model_type: "wholesale_distribution", role: "operating_comp", rationale: "Mexican retail/distribution; proxy for regional scale." },
  { name: "Grupo Comercial Chedraui", ticker: "CHEDRAUI.MX", country: "Mexico", business_model_type: "wholesale_distribution", role: "valuation_comp", rationale: "Mexican grocery and general merchandise." },
  { name: "Wal-Mart de México", ticker: "WALMEX.MX", country: "Mexico", business_model_type: "wholesale_distribution", role: "beta_comp", rationale: "Large-scale retail/distribution in Mexico." },
  { name: "Grupo Bimbo", ticker: "BIMBOA.MX", country: "Mexico", business_model_type: "consumer_staples_distribution", role: "operating_comp", rationale: "Distribution and consumer staples." },
  // SaaS / software
  { name: "Microsoft Corporation", ticker: "MSFT", country: "United States", business_model_type: "software_saas", role: "operating_comp", rationale: "Enterprise software scale; margin and growth benchmark." },
  { name: "Salesforce Inc", ticker: "CRM", country: "United States", business_model_type: "software_saas", role: "valuation_comp", rationale: "SaaS leader; multiple and growth comp." },
  { name: "ServiceNow Inc", ticker: "NOW", country: "United States", business_model_type: "software_saas", role: "valuation_comp", rationale: "High-growth workflow software." },
  { name: "Adobe Inc", ticker: "ADBE", country: "United States", business_model_type: "software_saas", role: "beta_comp", rationale: "Subscription mix; margin structure comp." },
  { name: "Workday Inc", ticker: "WDAY", country: "United States", business_model_type: "software_saas", role: "operating_comp", rationale: "HCM / ERP SaaS." },
  { name: "Snowflake Inc", ticker: "SNOW", country: "United States", business_model_type: "software_saas", role: "operating_comp", rationale: "Data cloud SaaS." },
  // Industrial / manufacturing
  { name: "3M Company", ticker: "MMM", country: "United States", business_model_type: "industrial_manufacturing", role: "operating_comp", rationale: "Industrial diversified; margin and capital profile." },
  { name: "Honeywell International", ticker: "HON", country: "United States", business_model_type: "industrial_manufacturing", role: "valuation_comp", rationale: "Industrial and automation." },
  { name: "Emerson Electric", ticker: "EMR", country: "United States", business_model_type: "industrial_manufacturing", role: "beta_comp", rationale: "Industrial peer." },
  { name: "Caterpillar", ticker: "CAT", country: "United States", business_model_type: "industrial_manufacturing", role: "valuation_comp", rationale: "Industrial / machinery." },
  { name: "Deere & Co", ticker: "DE", country: "United States", business_model_type: "industrial_manufacturing", role: "operating_comp", rationale: "Agricultural and construction." },
  // Healthcare services
  { name: "UnitedHealth Group", ticker: "UNH", country: "United States", business_model_type: "healthcare_services", role: "operating_comp", rationale: "Healthcare services; scale and margin." },
  { name: "Anthem Inc", ticker: "ELV", country: "United States", business_model_type: "healthcare_services", role: "valuation_comp", rationale: "Health benefits and services." },
  { name: "Cigna Group", ticker: "CI", country: "United States", business_model_type: "healthcare_services", role: "beta_comp", rationale: "Healthcare and pharmacy services." },
  { name: "Bayer AG", ticker: "BAYN", country: "Germany", business_model_type: "healthcare_services", role: "operating_comp", rationale: "Pharma and life sciences." },
  { name: "CVS Health", ticker: "CVS", country: "United States", business_model_type: "healthcare_services", role: "operating_comp", rationale: "PBM and retail pharmacy." },
  // Marketplace
  { name: "eBay Inc", ticker: "EBAY", country: "United States", business_model_type: "marketplace", role: "operating_comp", rationale: "Marketplace and classifieds." },
  { name: "Etsy Inc", ticker: "ETSY", country: "United States", business_model_type: "marketplace", role: "valuation_comp", rationale: "Niche marketplace." },
  { name: "MercadoLibre", ticker: "MELI", country: "Argentina", business_model_type: "marketplace", role: "beta_comp", rationale: "Latam marketplace and fintech." },
  // Logistics
  { name: "XPO Logistics", ticker: "XPO", country: "United States", business_model_type: "logistics", role: "operating_comp", rationale: "Asset-light logistics and freight." },
  { name: "CH Robinson", ticker: "CHRW", country: "United States", business_model_type: "logistics", role: "valuation_comp", rationale: "Freight brokerage and logistics." },
  { name: "Expeditors International", ticker: "EXPD", country: "United States", business_model_type: "logistics", role: "beta_comp", rationale: "Global logistics." },
  // Financial services
  { name: "JPMorgan Chase", ticker: "JPM", country: "United States", business_model_type: "financial_services", role: "operating_comp", rationale: "Diversified financial services." },
  { name: "Bank of America", ticker: "BAC", country: "United States", business_model_type: "financial_services", role: "valuation_comp", rationale: "Banking peer." },
  { name: "Wells Fargo", ticker: "WFC", country: "United States", business_model_type: "financial_services", role: "beta_comp", rationale: "Banking peer." },
];

/** Per-ticker reference metrics for comp-derived beta, leverage, and operating benchmarks (approximate). */
const PEER_METRICS: Record<
  string,
  { beta: number; netDebtEbitda: number; revenueGrowthMin: number; revenueGrowthMax: number; ebitdaMarginMin: number; ebitdaMarginMax: number; ebitMarginMin: number; ebitMarginMax: number; capexPctRevenueMin: number; capexPctRevenueMax: number }
> = {
  LULU: { beta: 1.2, netDebtEbitda: 0.2, revenueGrowthMin: 10, revenueGrowthMax: 20, ebitdaMarginMin: 18, ebitdaMarginMax: 24, ebitMarginMin: 14, ebitMarginMax: 18, capexPctRevenueMin: 3, capexPctRevenueMax: 6 },
  NKE: { beta: 1.1, netDebtEbitda: 0, revenueGrowthMin: 5, revenueGrowthMax: 12, ebitdaMarginMin: 14, ebitdaMarginMax: 18, ebitMarginMin: 11, ebitMarginMax: 14, capexPctRevenueMin: 2, capexPctRevenueMax: 4 },
  DECK: { beta: 1.3, netDebtEbitda: -0.1, revenueGrowthMin: 12, revenueGrowthMax: 25, ebitdaMarginMin: 20, ebitdaMarginMax: 26, ebitMarginMin: 15, ebitMarginMax: 20, capexPctRevenueMin: 2, capexPctRevenueMax: 5 },
  ONON: { beta: 1.4, netDebtEbitda: 0.1, revenueGrowthMin: 20, revenueGrowthMax: 40, ebitdaMarginMin: 12, ebitdaMarginMax: 18, ebitMarginMin: 8, ebitMarginMax: 12, capexPctRevenueMin: 2, capexPctRevenueMax: 5 },
  ADS: { beta: 1.1, netDebtEbitda: 0.3, revenueGrowthMin: 0, revenueGrowthMax: 8, ebitdaMarginMin: 8, ebitdaMarginMax: 12, ebitMarginMin: 4, ebitMarginMax: 8, capexPctRevenueMin: 2, capexPctRevenueMax: 4 },
  ULTA: { beta: 1.1, netDebtEbitda: 0.5, revenueGrowthMin: 4, revenueGrowthMax: 12, ebitdaMarginMin: 14, ebitdaMarginMax: 18, ebitMarginMin: 10, ebitMarginMax: 13, capexPctRevenueMin: 3, capexPctRevenueMax: 6 },
  SYY: { beta: 0.9, netDebtEbitda: 1.2, revenueGrowthMin: 4, revenueGrowthMax: 10, ebitdaMarginMin: 4, ebitdaMarginMax: 6, ebitMarginMin: 2, ebitMarginMax: 4, capexPctRevenueMin: 0.5, capexPctRevenueMax: 1.5 },
  USFD: { beta: 1.0, netDebtEbitda: 1.5, revenueGrowthMin: 3, revenueGrowthMax: 8, ebitdaMarginMin: 4, ebitdaMarginMax: 6, ebitMarginMin: 2, ebitMarginMax: 3, capexPctRevenueMin: 0.5, capexPctRevenueMax: 2 },
  PFGC: { beta: 0.95, netDebtEbitda: 1.0, revenueGrowthMin: 3, revenueGrowthMax: 9, ebitdaMarginMin: 3, ebitdaMarginMax: 5, ebitMarginMin: 1.5, ebitMarginMax: 3, capexPctRevenueMin: 0.5, capexPctRevenueMax: 1.5 },
  CORE: { beta: 0.85, netDebtEbitda: 1.2, revenueGrowthMin: 2, revenueGrowthMax: 8, ebitdaMarginMin: 2, ebitdaMarginMax: 4, ebitMarginMin: 1, ebitMarginMax: 2.5, capexPctRevenueMin: 0.5, capexPctRevenueMax: 1.5 },
  "SORIANA.MX": { beta: 0.8, netDebtEbitda: 1.5, revenueGrowthMin: 2, revenueGrowthMax: 10, ebitdaMarginMin: 5, ebitdaMarginMax: 8, ebitMarginMin: 2, ebitMarginMax: 5, capexPctRevenueMin: 1, capexPctRevenueMax: 3 },
  "CHEDRAUI.MX": { beta: 0.75, netDebtEbitda: 1.2, revenueGrowthMin: 4, revenueGrowthMax: 12, ebitdaMarginMin: 6, ebitdaMarginMax: 9, ebitMarginMin: 3, ebitMarginMax: 6, capexPctRevenueMin: 1, capexPctRevenueMax: 3 },
  "WALMEX.MX": { beta: 0.7, netDebtEbitda: 0.8, revenueGrowthMin: 4, revenueGrowthMax: 10, ebitdaMarginMin: 7, ebitdaMarginMax: 9, ebitMarginMin: 4, ebitMarginMax: 6, capexPctRevenueMin: 2, capexPctRevenueMax: 4 },
  "BIMBOA.MX": { beta: 0.75, netDebtEbitda: 1.0, revenueGrowthMin: 3, revenueGrowthMax: 8, ebitdaMarginMin: 8, ebitdaMarginMax: 12, ebitMarginMin: 5, ebitMarginMax: 8, capexPctRevenueMin: 1, capexPctRevenueMax: 3 },
  MSFT: { beta: 1.0, netDebtEbitda: -0.3, revenueGrowthMin: 10, revenueGrowthMax: 14, ebitdaMarginMin: 42, ebitdaMarginMax: 48, ebitMarginMin: 38, ebitMarginMax: 44, capexPctRevenueMin: 3, capexPctRevenueMax: 6 },
  CRM: { beta: 1.2, netDebtEbitda: 0.2, revenueGrowthMin: 10, revenueGrowthMax: 18, ebitdaMarginMin: 18, ebitdaMarginMax: 24, ebitMarginMin: 12, ebitMarginMax: 18, capexPctRevenueMin: 2, capexPctRevenueMax: 4 },
  NOW: { beta: 1.25, netDebtEbitda: -0.2, revenueGrowthMin: 20, revenueGrowthMax: 28, ebitdaMarginMin: 22, ebitdaMarginMax: 28, ebitMarginMin: 16, ebitMarginMax: 22, capexPctRevenueMin: 1, capexPctRevenueMax: 3 },
  ADBE: { beta: 1.15, netDebtEbitda: 0.1, revenueGrowthMin: 10, revenueGrowthMax: 14, ebitdaMarginMin: 35, ebitdaMarginMax: 42, ebitMarginMin: 28, ebitMarginMax: 35, capexPctRevenueMin: 1, capexPctRevenueMax: 4 },
  WDAY: { beta: 1.2, netDebtEbitda: -0.1, revenueGrowthMin: 16, revenueGrowthMax: 22, ebitdaMarginMin: 20, ebitdaMarginMax: 26, ebitMarginMin: 12, ebitMarginMax: 18, capexPctRevenueMin: 1, capexPctRevenueMax: 3 },
  SNOW: { beta: 1.3, netDebtEbitda: -0.5, revenueGrowthMin: 25, revenueGrowthMax: 40, ebitdaMarginMin: 2, ebitdaMarginMax: 10, ebitMarginMin: -5, ebitMarginMax: 5, capexPctRevenueMin: 2, capexPctRevenueMax: 5 },
  MMM: { beta: 1.0, netDebtEbitda: 0.8, revenueGrowthMin: 0, revenueGrowthMax: 5, ebitdaMarginMin: 18, ebitdaMarginMax: 24, ebitMarginMin: 14, ebitMarginMax: 18, capexPctRevenueMin: 3, capexPctRevenueMax: 6 },
  HON: { beta: 1.05, netDebtEbitda: 0.5, revenueGrowthMin: 2, revenueGrowthMax: 8, ebitdaMarginMin: 18, ebitdaMarginMax: 22, ebitMarginMin: 14, ebitMarginMax: 18, capexPctRevenueMin: 2, capexPctRevenueMax: 5 },
  EMR: { beta: 1.0, netDebtEbitda: 0.6, revenueGrowthMin: 2, revenueGrowthMax: 6, ebitdaMarginMin: 18, ebitdaMarginMax: 22, ebitMarginMin: 14, ebitMarginMax: 17, capexPctRevenueMin: 2, capexPctRevenueMax: 5 },
  CAT: { beta: 1.1, netDebtEbitda: 1.2, revenueGrowthMin: 2, revenueGrowthMax: 10, ebitdaMarginMin: 16, ebitdaMarginMax: 22, ebitMarginMin: 12, ebitMarginMax: 17, capexPctRevenueMin: 3, capexPctRevenueMax: 6 },
  DE: { beta: 1.0, netDebtEbitda: 0.8, revenueGrowthMin: 2, revenueGrowthMax: 8, ebitdaMarginMin: 18, ebitdaMarginMax: 24, ebitMarginMin: 14, ebitMarginMax: 19, capexPctRevenueMin: 3, capexPctRevenueMax: 7 },
  UNH: { beta: 0.85, netDebtEbitda: 0.4, revenueGrowthMin: 6, revenueGrowthMax: 12, ebitdaMarginMin: 7, ebitdaMarginMax: 9, ebitMarginMin: 5, ebitMarginMax: 7, capexPctRevenueMin: 1, capexPctRevenueMax: 3 },
  ELV: { beta: 0.9, netDebtEbitda: 0.5, revenueGrowthMin: 4, revenueGrowthMax: 10, ebitdaMarginMin: 5, ebitdaMarginMax: 7, ebitMarginMin: 3, ebitMarginMax: 5, capexPctRevenueMin: 1, capexPctRevenueMax: 2 },
  CI: { beta: 0.9, netDebtEbitda: 0.6, revenueGrowthMin: 4, revenueGrowthMax: 10, ebitdaMarginMin: 5, ebitdaMarginMax: 7, ebitMarginMin: 3, ebitMarginMax: 5, capexPctRevenueMin: 1, capexPctRevenueMax: 2 },
  BAYN: { beta: 0.9, netDebtEbitda: 0.7, revenueGrowthMin: 2, revenueGrowthMax: 6, ebitdaMarginMin: 18, ebitdaMarginMax: 24, ebitMarginMin: 12, ebitMarginMax: 18, capexPctRevenueMin: 4, capexPctRevenueMax: 8 },
  CVS: { beta: 0.75, netDebtEbitda: 1.0, revenueGrowthMin: 4, revenueGrowthMax: 8, ebitdaMarginMin: 5, ebitdaMarginMax: 7, ebitMarginMin: 3, ebitMarginMax: 5, capexPctRevenueMin: 1, capexPctRevenueMax: 3 },
  EBAY: { beta: 1.0, netDebtEbitda: -0.2, revenueGrowthMin: 2, revenueGrowthMax: 6, ebitdaMarginMin: 28, ebitdaMarginMax: 34, ebitMarginMin: 22, ebitMarginMax: 28, capexPctRevenueMin: 1, capexPctRevenueMax: 3 },
  ETSY: { beta: 1.2, netDebtEbitda: -0.5, revenueGrowthMin: 8, revenueGrowthMax: 18, ebitdaMarginMin: 22, ebitdaMarginMax: 28, ebitMarginMin: 14, ebitMarginMax: 20, capexPctRevenueMin: 1, capexPctRevenueMax: 4 },
  MELI: { beta: 1.3, netDebtEbitda: -0.3, revenueGrowthMin: 20, revenueGrowthMax: 35, ebitdaMarginMin: 12, ebitdaMarginMax: 20, ebitMarginMin: 6, ebitMarginMax: 14, capexPctRevenueMin: 2, capexPctRevenueMax: 5 },
  XPO: { beta: 1.2, netDebtEbitda: 1.0, revenueGrowthMin: 4, revenueGrowthMax: 12, ebitdaMarginMin: 8, ebitdaMarginMax: 14, ebitMarginMin: 4, ebitMarginMax: 10, capexPctRevenueMin: 2, capexPctRevenueMax: 5 },
  CHRW: { beta: 0.95, netDebtEbitda: 0.3, revenueGrowthMin: 2, revenueGrowthMax: 8, ebitdaMarginMin: 6, ebitdaMarginMax: 10, ebitMarginMin: 4, ebitMarginMax: 7, capexPctRevenueMin: 1, capexPctRevenueMax: 3 },
  EXPD: { beta: 0.9, netDebtEbitda: -0.2, revenueGrowthMin: 2, revenueGrowthMax: 8, ebitdaMarginMin: 8, ebitdaMarginMax: 12, ebitMarginMin: 6, ebitMarginMax: 9, capexPctRevenueMin: 1, capexPctRevenueMax: 3 },
  JPM: { beta: 1.1, netDebtEbitda: 0.8, revenueGrowthMin: 4, revenueGrowthMax: 10, ebitdaMarginMin: 35, ebitdaMarginMax: 42, ebitMarginMin: 28, ebitMarginMax: 35, capexPctRevenueMin: 1, capexPctRevenueMax: 3 },
  BAC: { beta: 1.15, netDebtEbitda: 0.6, revenueGrowthMin: 2, revenueGrowthMax: 8, ebitdaMarginMin: 30, ebitdaMarginMax: 38, ebitMarginMin: 24, ebitMarginMax: 30, capexPctRevenueMin: 1, capexPctRevenueMax: 2 },
  WFC: { beta: 1.1, netDebtEbitda: 0.5, revenueGrowthMin: 2, revenueGrowthMax: 6, ebitdaMarginMin: 32, ebitdaMarginMax: 40, ebitMarginMin: 26, ebitMarginMax: 32, capexPctRevenueMin: 1, capexPctRevenueMax: 2 },
};

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein-based similarity in [0, 1]: 1 = identical, 0 = max distance. */
function normalizedSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length, 1);
  const d = distance(a, b);
  return 1 - d / maxLen;
}

type ResolveResult = Partial<SuggestedComp> & { resolutionState: CompResolutionState; resolutionConfidence: ConfidenceLevel };

function enrichFromRow(row: PeerRow, opts: { resolutionState: CompResolutionState; resolutionConfidence: ConfidenceLevel; resolutionMatchScore?: number }): ResolveResult {
  const metrics = PEER_METRICS[row.ticker];
  return {
    companyName: row.name,
    ticker: row.ticker,
    country: row.country,
    businessTypeSubtype: row.business_model_type.replace(/_/g, " "),
    sector: row.business_model_type,
    role: row.role,
    reason: row.rationale,
    sourceBasis: "user_provided",
    resolutionState: opts.resolutionState,
    resolutionConfidence: opts.resolutionConfidence,
    ...(opts.resolutionMatchScore != null && { resolutionMatchScore: opts.resolutionMatchScore }),
    ...(metrics && {
      beta: metrics.beta,
      netDebtEbitda: metrics.netDebtEbitda,
      revenueGrowth: (metrics.revenueGrowthMin + metrics.revenueGrowthMax) / 2,
      ebitdaMargin: (metrics.ebitdaMarginMin + metrics.ebitdaMarginMax) / 2,
      ebitMargin: (metrics.ebitMarginMin + metrics.ebitMarginMax) / 2,
      capexPctRevenue: (metrics.capexPctRevenueMin + metrics.capexPctRevenueMax) / 2,
    }),
  };
}

/** Fuzzy match thresholds: >= RESOLVED_THRESHOLD → resolved, >= NEEDS_REVIEW_THRESHOLD → needs_review, else unresolved. */
const FUZZY_RESOLVED_THRESHOLD = 0.75;
const FUZZY_NEEDS_REVIEW_THRESHOLD = 0.6;

/**
 * Resolve and enrich a manual comp from the peer universe (name or ticker).
 * Resolution order: (1) exact ticker, (2) exact normalized name, (3) contains, (4) fuzzy similarity.
 * Returns enrichment patch + resolutionState, resolutionConfidence, and optional resolutionMatchScore for debugging.
 */
export function resolveComp(companyName: string, ticker?: string): ResolveResult {
  const name = (companyName ?? "").trim();
  const tick = (ticker ?? "").trim().toUpperCase();
  if (!name && !tick) {
    return { resolutionState: "unresolved", resolutionConfidence: "low" };
  }

  // 1. Exact ticker match
  if (tick) {
    const row = PEER_UNIVERSE.find((r) => r.ticker.toUpperCase() === tick);
    if (row) return enrichFromRow(row, { resolutionState: "resolved", resolutionConfidence: "high" });
  }

  const norm = normalizeName(name);
  if (norm.length < 2) return { resolutionState: "unresolved", resolutionConfidence: "low" };

  // 2. Exact normalized name match
  const exactRow = PEER_UNIVERSE.find((r) => normalizeName(r.name) === norm);
  if (exactRow) return enrichFromRow(exactRow, { resolutionState: "resolved", resolutionConfidence: "high" });

  // 3. Contains match (input contained in peer name or vice versa)
  const containsRow = PEER_UNIVERSE.find((r) => {
    const peerNorm = normalizeName(r.name);
    return peerNorm.includes(norm) || norm.includes(peerNorm);
  });
  if (containsRow) {
    return enrichFromRow(containsRow, {
      resolutionState: "resolved",
      resolutionConfidence: name.length >= 3 ? "high" : "medium",
    });
  }

  // 4. Fuzzy similarity match (space-stripped so "Bayerm" ≈ "Bayer AG"; also compare to first word so "Microsfot" ≈ "Microsoft")
  const normCompact = norm.replace(/\s/g, "");
  let bestScore = 0;
  let bestRow: PeerRow | undefined;
  for (const r of PEER_UNIVERSE) {
    const peerNorm = normalizeName(r.name);
    const peerCompact = peerNorm.replace(/\s/g, "");
    const fullScore = normalizedSimilarity(normCompact, peerCompact);
    const firstWord = (peerNorm.split(/\s+/)[0] ?? "").replace(/\s/g, "");
    const firstWordScore = firstWord.length >= 2 ? normalizedSimilarity(normCompact, firstWord) : 0;
    const score = Math.max(fullScore, firstWordScore);
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }

  if (typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.log("[resolveComp] fuzzy best score:", bestScore.toFixed(3), bestRow ? `→ ${bestRow.name} (${bestRow.ticker})` : "(no match)");
  }

  if (bestRow && bestScore >= FUZZY_NEEDS_REVIEW_THRESHOLD) {
    if (bestScore >= FUZZY_RESOLVED_THRESHOLD) {
      return enrichFromRow(bestRow, {
        resolutionState: "resolved",
        resolutionConfidence: "medium",
        resolutionMatchScore: Math.round(bestScore * 1000) / 1000,
      });
    }
    return enrichFromRow(bestRow, {
      resolutionState: "needs_review",
      resolutionConfidence: "medium",
      resolutionMatchScore: Math.round(bestScore * 1000) / 1000,
    });
  }

  return {
    resolutionState: "unresolved",
    resolutionConfidence: "low",
    resolutionMatchScore: bestScore > 0 ? Math.round(bestScore * 1000) / 1000 : undefined,
  };
}

/**
 * Compute comp-derived metrics from accepted comps that have tickers in PEER_METRICS.
 * Used for beta/leverage/operating context and for the Comp-derived metrics UI block.
 */
export function getCompDerivedMetrics(comps: SuggestedComp[]): CompDerivedMetrics {
  const accepted = comps.filter((c) => c.status === "accepted");
  const withTicker = accepted.filter((c) => c.ticker?.trim());
  const metricsList = withTicker
    .map((c) => {
      const ticker = (c.ticker ?? "").trim().toUpperCase();
      const m = PEER_METRICS[ticker];
      if (!m) return null;
      return m;
    })
    .filter(Boolean) as Array<{ beta: number; netDebtEbitda: number; revenueGrowthMin: number; revenueGrowthMax: number; ebitdaMarginMin: number; ebitdaMarginMax: number; ebitMarginMin: number; ebitMarginMax: number; capexPctRevenueMin: number; capexPctRevenueMax: number }>;

  if (metricsList.length === 0) {
    return { acceptedCount: accepted.length, withDataCount: 0, source: "fallback" };
  }

  const betas = metricsList.map((m) => m.beta).filter((n) => n != null);
  const leverage = metricsList.map((m) => m.netDebtEbitda).filter((n) => n != null);
  const sort = (a: number, b: number) => a - b;
  const median = (arr: number[]) => (arr.length ? arr.slice().sort(sort)[Math.floor(arr.length / 2)]! : undefined);

  return {
    acceptedCount: accepted.length,
    withDataCount: metricsList.length,
    source: "accepted_comps",
    medianBeta: median(betas),
    betaRangeMin: betas.length ? Math.min(...betas) : undefined,
    betaRangeMax: betas.length ? Math.max(...betas) : undefined,
    medianNetDebtEbitda: median(leverage),
    leverageRangeMin: leverage.length ? Math.min(...leverage) : undefined,
    leverageRangeMax: leverage.length ? Math.max(...leverage) : undefined,
    revenueGrowthMin: metricsList.length ? Math.min(...metricsList.map((m) => m.revenueGrowthMin)) : undefined,
    revenueGrowthMax: metricsList.length ? Math.max(...metricsList.map((m) => m.revenueGrowthMax)) : undefined,
    ebitdaMarginMin: metricsList.length ? Math.min(...metricsList.map((m) => m.ebitdaMarginMin)) : undefined,
    ebitdaMarginMax: metricsList.length ? Math.max(...metricsList.map((m) => m.ebitdaMarginMax)) : undefined,
    ebitMarginMin: metricsList.length ? Math.min(...metricsList.map((m) => m.ebitMarginMin)) : undefined,
    ebitMarginMax: metricsList.length ? Math.max(...metricsList.map((m) => m.ebitMarginMax)) : undefined,
    capexPctRevenueMin: metricsList.length ? Math.min(...metricsList.map((m) => m.capexPctRevenueMin)) : undefined,
    capexPctRevenueMax: metricsList.length ? Math.max(...metricsList.map((m) => m.capexPctRevenueMax)) : undefined,
  };
}

const DEVELOPED_COUNTRIES = new Set([
  "United States", "United Kingdom", "Canada", "Germany", "France", "Japan", "Australia",
  "Netherlands", "Switzerland", "Singapore", "Ireland",
]);
const CURRENCY_MAP: Record<string, string> = {
  "United States": "USD", "United Kingdom": "GBP", "Canada": "CAD", "Germany": "EUR",
  "France": "EUR", "Japan": "JPY", "China": "CNY", "India": "INR", "Australia": "AUD",
  "Brazil": "BRL", "Netherlands": "EUR", "Switzerland": "CHF", "Singapore": "SGD",
  "Ireland": "EUR", "Mexico": "MXN", "Chile": "CLP", "Colombia": "COP", "Argentina": "ARS",
};

/** Keywords in description that imply business model (order matters: first match can set priority). */
const DESCRIPTION_TO_BUSINESS_MODEL: { keywords: string[]; model: BusinessModelType }[] = [
  { keywords: ["wholesale", "wholesaler", "mayoreo", "distributor", "distribution", "distribución"], model: "wholesale_distribution" },
  { keywords: ["grocery", "grocer", "abarrotes", "consumer staples", "staples", "food distribution"], model: "consumer_staples_distribution" },
  { keywords: ["logistics", "logística", "supply chain", "fulfillment"], model: "logistics" },
  { keywords: ["marketplace", "platform", "two-sided"], model: "marketplace" },
  { keywords: ["saas", "subscription", "software as a service", "recurring revenue"], model: "software_saas" },
  { keywords: ["manufacturing", "manufacturer", "industrial", "fabricación"], model: "industrial_manufacturing" },
  { keywords: ["healthcare", "health care", "pharma", "medical", "hospital"], model: "healthcare_services" },
  { keywords: ["licensing", "royalty", "franchise"], model: "branded_retail" },
  { keywords: ["retail", "store", "stores", "branded", "premium", "apparel", "athletic"], model: "branded_retail" },
];

/** Industry dropdown value → business model hint when description is empty or generic. */
const INDUSTRY_TO_MODEL: Record<string, BusinessModelType> = {
  "Software": "software_saas",
  "Technology": "software_saas",
  "Consumer Retail": "branded_retail",
  "Healthcare": "healthcare_services",
  "Biotechnology": "healthcare_services",
  "Industrial & Manufacturing": "industrial_manufacturing",
  "Financial Services": "financial_services",
  "Energy": "industrial_manufacturing",
  "Telecommunications": "industrial_manufacturing",
  "Media & Entertainment": "generic",
  "Real Estate": "generic",
};

/** Map user primary business type to internal business model and benchmark family. */
function primaryBusinessTypeToModelAndFamily(
  primary: PrimaryBusinessType | undefined,
  fromDescription: BusinessModelType
): { business_model_type: BusinessModelType; benchmark_family: BenchmarkFamily } {
  if (!primary || primary === "other") return { business_model_type: fromDescription, benchmark_family: modelToBenchmarkFamily(fromDescription) };
  const map: Record<PrimaryBusinessType, { business_model_type: BusinessModelType; benchmark_family: BenchmarkFamily }> = {
    manufacturer: { business_model_type: "industrial_manufacturing", benchmark_family: "industrial_manufacturing" },
    distributor_wholesaler: { business_model_type: "wholesale_distribution", benchmark_family: "wholesale_distribution" },
    retailer: { business_model_type: "branded_retail", benchmark_family: "premium_branded_retail" },
    software_saas: { business_model_type: "software_saas", benchmark_family: "saas" },
    marketplace_platform: { business_model_type: "marketplace", benchmark_family: "marketplace_platform" },
    services: { business_model_type: "generic", benchmark_family: "generic" },
    financial_services: { business_model_type: "financial_services", benchmark_family: "financial_services" },
    healthcare_pharma: { business_model_type: "healthcare_services", benchmark_family: "healthcare_services" },
    infrastructure_industrial: { business_model_type: "industrial_manufacturing", benchmark_family: "industrial_manufacturing" },
    other: { business_model_type: fromDescription, benchmark_family: modelToBenchmarkFamily(fromDescription) },
  };
  return map[primary];
}

function modelToBenchmarkFamily(m: BusinessModelType): BenchmarkFamily {
  const map: Record<BusinessModelType, BenchmarkFamily> = {
    branded_retail: "premium_branded_retail",
    wholesale_distribution: "wholesale_distribution",
    consumer_staples_distribution: "consumer_staples_distribution",
    software_saas: "saas",
    industrial_manufacturing: "industrial_manufacturing",
    healthcare_services: "healthcare_services",
    marketplace: "marketplace_platform",
    logistics: "logistics",
    financial_services: "financial_services",
    generic: "generic",
  };
  return map[m];
}

/** Infer main operating geography from HQ if user did not set it. */
function inferMainGeography(hq: string, userGeo: MainOperatingGeography | undefined): MainOperatingGeography {
  if (userGeo && userGeo !== "other") return userGeo;
  if (!hq) return "other";
  const c = hq.toLowerCase();
  if (c.includes("mexico")) return "mexico";
  if (c.includes("united states") || c === "us") return "us";
  if (c.includes("canada")) return "canada";
  if (c.includes("brazil") || c.includes("argentina") || c.includes("chile") || c.includes("colombia") || c.includes("peru")) return "latam";
  if (c.includes("germany") || c.includes("france") || c.includes("united kingdom") || c.includes("uk")) return "europe";
  return "other";
}

// --- Subtype classification (healthcare and others) ---

/** Result of subtype classification for segment-strict peer selection. */
export interface SubtypeResult {
  /** Healthcare only for now; other sectors can be added. */
  healthcareSubtype: HealthcareSubtype | null;
  confidence: ConfidenceLevel;
}

/** Classify healthcare into subtypes from description + primary type + optional research evidence. Avoids mixing labs with industrial. */
export function classifySubtype(
  inputs: CompanyContextUserInputs,
  profile: InterpretedCompanyProfile,
  research?: CompanyResearch
): SubtypeResult {
  const desc = (inputs.shortBusinessDescription ?? "").toLowerCase();
  const primary = inputs.primaryBusinessType;
  const industry = (inputs.industry ?? "").toLowerCase();
  const isHealthcare =
    primary === "healthcare_pharma" ||
    profile.business_model_type === "healthcare_services" ||
    industry.includes("health") ||
    industry.includes("biotech");

  if (!isHealthcare) {
    return { healthcareSubtype: null, confidence: "high" };
  }

  if (research?.subtypeEvidence?.length) {
    const first = research.subtypeEvidence[0];
    if (
      first === "diagnostics_lab" || first === "clinical_testing" || first === "contract_lab" ||
      first === "medical_device" || first === "pharma_biotech" || first === "healthcare_services"
    ) {
      return { healthcareSubtype: first, confidence: "high" };
    }
  }

  if (desc.includes("lab") || desc.includes("laboratory") || desc.includes("diagnostic") || desc.includes("diagnóstic")) {
    if (desc.includes("clinical") || desc.includes("testing") || desc.includes("prueba")) return { healthcareSubtype: "clinical_testing", confidence: "high" };
    if (desc.includes("contract") || desc.includes("cro") || desc.includes("research")) return { healthcareSubtype: "contract_lab", confidence: "high" };
    return { healthcareSubtype: "diagnostics_lab", confidence: "medium" };
  }
  if (desc.includes("device") || desc.includes("medical device") || desc.includes("equipo médico")) return { healthcareSubtype: "medical_device", confidence: "high" };
  if (desc.includes("pharma") || desc.includes("biotech") || desc.includes("drug") || desc.includes("farmac") || desc.includes("biofarmac")) return { healthcareSubtype: "pharma_biotech", confidence: "high" };
  if (desc.includes("service") || desc.includes("hospital") || desc.includes("payor") || desc.includes("insurance") || desc.includes("seguro")) return { healthcareSubtype: "healthcare_services", confidence: "high" };
  if (desc.length >= 10) return { healthcareSubtype: "healthcare_generic", confidence: "medium" };
  return { healthcareSubtype: "healthcare_generic", confidence: "low" };
}

/**
 * Allowed business model types for peer selection. Ensures we never suggest industrial peers for healthcare.
 * When generic, only allow industry-based segment (e.g. Healthcare → healthcare_services only).
 */
export function getAllowedBusinessModelsForPeers(
  profile: InterpretedCompanyProfile,
  subtypeResult: SubtypeResult
): BusinessModelType[] {
  const { business_model_type, business_type } = profile;
  const industry = (profile.industry ?? "").toLowerCase();

  if (subtypeResult.healthcareSubtype != null) {
    return ["healthcare_services"];
  }
  if (business_type === "healthcare_pharma" || business_model_type === "healthcare_services") {
    return ["healthcare_services"];
  }
  if (business_type === "infrastructure_industrial" || business_type === "manufacturer" || business_model_type === "industrial_manufacturing") {
    return ["industrial_manufacturing"];
  }
  if (business_model_type !== "generic") {
    if (business_model_type === "wholesale_distribution") return ["wholesale_distribution", "consumer_staples_distribution"];
    return [business_model_type];
  }
  if (industry.includes("health") || industry.includes("biotech") || industry.includes("healthcare")) return ["healthcare_services"];
  if (industry.includes("industrial") || industry.includes("manufacturing")) return ["industrial_manufacturing"];
  if (industry.includes("software") || industry.includes("technology")) return ["software_saas"];
  if (industry.includes("consumer") || industry.includes("retail")) return ["branded_retail"];
  if (industry.includes("financial")) return ["financial_services"];
  return [];
}

/**
 * Compute confidence per dimension. When overall is low, do not show misleading peers/benchmarks.
 */
export function computeConfidence(
  inputs: CompanyContextUserInputs,
  profile: InterpretedCompanyProfile,
  subtypeResult: SubtypeResult,
  candidatePeerCount: number,
  hasUserHints: boolean
): CompanyContextConfidence {
  const name = (inputs.companyName ?? "").trim();
  const hasName = name.length >= 2;
  const hasCountry = (inputs.headquartersCountry ?? "").trim().length > 0;
  const hasIndustry = (inputs.industry ?? "").trim().length > 0;
  const hasDescription = (inputs.shortBusinessDescription ?? "").trim().length >= 10;
  const hasPrimaryType = inputs.primaryBusinessType != null && inputs.primaryBusinessType !== "other";
  const isGeneric = profile.business_model_type === "generic" && profile.benchmark_family === "generic";

  const companyIdentification: ConfidenceDimension = {
    level: hasName && (hasCountry || hasIndustry) ? "high" : hasName ? "medium" : "low",
    message: !hasName ? "Add company name." : !hasCountry && !hasIndustry ? "Add country or industry for better context." : undefined,
  };
  const businessModelClassification: ConfidenceDimension = {
    level: hasPrimaryType && !isGeneric ? "high" : hasPrimaryType || !isGeneric ? "medium" : "low",
    message: isGeneric && !hasPrimaryType ? "Set primary business type or add a more specific description." : undefined,
  };
  const peerGeneration: ConfidenceDimension = {
    level: hasUserHints ? "high" : candidatePeerCount >= 2 ? "high" : candidatePeerCount >= 1 ? "medium" : "low",
    message:
      candidatePeerCount === 0 && !hasUserHints
        ? "Add 1–2 known peer names or a more specific business description to get relevant comps."
        : candidatePeerCount < 2 && !hasUserHints
          ? "Add known peers or refine business type for a stronger peer set."
          : undefined,
  };
  const benchmarkFamilySelection: ConfidenceDimension = {
    level: profile.benchmark_family !== "generic" ? "high" : "medium",
    message: profile.benchmark_family === "generic" ? "Benchmark ranges are generic; set business type for segment-specific ranges." : undefined,
  };

  const dims = [companyIdentification, businessModelClassification, peerGeneration, benchmarkFamilySelection];
  const overall: ConfidenceLevel = dims.some((d) => d.level === "low") ? "low" : dims.some((d) => d.level === "medium") ? "medium" : "high";

  return {
    companyIdentification,
    businessModelClassification,
    peerGeneration,
    benchmarkFamilySelection,
    overall,
  };
}

/** Build the "not enough evidence" message when confidence is low. */
export function getNotEnoughEvidenceMessage(confidence: CompanyContextConfidence): string {
  const parts: string[] = [];
  if (confidence.companyIdentification.level === "low" && confidence.companyIdentification.message) parts.push(confidence.companyIdentification.message);
  if (confidence.businessModelClassification.level === "low" && confidence.businessModelClassification.message) parts.push(confidence.businessModelClassification.message);
  if (confidence.peerGeneration.level === "low" && confidence.peerGeneration.message) parts.push(confidence.peerGeneration.message);
  if (confidence.benchmarkFamilySelection.level === "low" && confidence.benchmarkFamilySelection.message) parts.push(confidence.benchmarkFamilySelection.message);
  if (parts.length === 0) return "We could not confidently identify the right peer set from current inputs. Add 1–2 known peer names or a more specific business description.";
  return parts.join(" ");
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().trim().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function getDescriptionSignals(description: string): string[] {
  if (!description || !description.trim()) return [];
  const normalized = normalizeForMatch(description);
  const signals: string[] = [];
  for (const { keywords } of DESCRIPTION_TO_BUSINESS_MODEL) {
    for (const kw of keywords) {
      if (normalized.includes(normalizeForMatch(kw))) signals.push(kw);
    }
  }
  return signals;
}

function inferBusinessModel(inputs: CompanyContextUserInputs, descriptionSignals: string[]): BusinessModelType {
  for (const { keywords, model } of DESCRIPTION_TO_BUSINESS_MODEL) {
    for (const kw of keywords) {
      if (descriptionSignals.some((s) => normalizeForMatch(s).includes(normalizeForMatch(kw)))) return model;
    }
  }
  return INDUSTRY_TO_MODEL[inputs.industry] ?? "generic";
}

function getWaccRegion(country: string): WaccReferenceRegion {
  if (!country) return "us";
  const c = country.toLowerCase();
  if (c.includes("united states") || c === "us") return "us";
  if (c.includes("canada")) return "canada";
  if (c.includes("mexico")) return "mexico";
  if (c.includes("brazil") || c.includes("argentina") || c.includes("chile") || c.includes("colombia") || c.includes("peru")) return "latam";
  if (c.includes("germany") || c.includes("france") || c.includes("united kingdom") || c.includes("netherlands") || c.includes("switzerland") || c.includes("ireland")) return "europe";
  if (DEVELOPED_COUNTRIES.has(country)) return "other_developed";
  return "emerging";
}

/**
 * Build the interpreted company profile from current user inputs.
 * Layer A (user facts) → profile. Used by Layer B (evidence) and Layer C (synthesis).
 */
export function interpretCompanyFromInputs(inputs: CompanyContextUserInputs): InterpretedCompanyProfile {
  const descriptionSignals = getDescriptionSignals(inputs.shortBusinessDescription ?? "");
  const fromDescription = inferBusinessModel(inputs, descriptionSignals);
  const { business_model_type, benchmark_family } = primaryBusinessTypeToModelAndFamily(inputs.primaryBusinessType, fromDescription);

  const company_listing_type: CompanyListingType = inputs.publicPrivate === "public" ? "public" : "private";
  const hq = inputs.headquartersCountry?.trim() || "";
  const market_region_type = DEVELOPED_COUNTRIES.has(hq) ? "developed" : "emerging";
  const wacc_reference_region = getWaccRegion(hq);
  const comp_selection_strategy = company_listing_type === "private" ? "proxy_public_peers" : "direct_peers";
  const industry = inputs.industry?.trim() || "";

  const peerHintRaw = (inputs.knownPeersOrProxies ?? inputs.manualComparableHints)?.trim() ?? "";
  const manualCompHints: string[] = peerHintRaw
    ? peerHintRaw.split(/[,;]/).map((s) => s.trim()).filter(Boolean).map((s) => s.toLowerCase())
    : [];

  const main_operating_geography = inferMainGeography(hq, inputs.mainOperatingGeography);
  const revenue_model: RevenueModel = inputs.revenueModel ?? (business_model_type === "software_saas" ? "subscription" : business_model_type === "marketplace" ? "commission_marketplace" : "product_sales");
  const customer_type: CustomerType = inputs.customerType ?? "both";
  const business_type: PrimaryBusinessType = inputs.primaryBusinessType ?? (business_model_type === "branded_retail" ? "retailer" : business_model_type === "wholesale_distribution" || business_model_type === "consumer_staples_distribution" ? "distributor_wholesaler" : business_model_type === "software_saas" ? "software_saas" : business_model_type === "industrial_manufacturing" ? "manufacturer" : "other");

  let working_capital_profile: WorkingCapitalProfile = "medium";
  let margin_profile: MarginProfile = "mixed";
  let capex_profile: CapexProfile = "moderate";

  switch (business_model_type) {
    case "wholesale_distribution":
    case "consumer_staples_distribution":
    case "logistics":
      working_capital_profile = "high";
      margin_profile = "scale";
      capex_profile = "light";
      break;
    case "branded_retail":
      working_capital_profile = "medium";
      margin_profile = "premium";
      capex_profile = "heavy";
      break;
    case "software_saas":
      working_capital_profile = "low";
      margin_profile = "premium";
      capex_profile = "light";
      break;
    case "industrial_manufacturing":
      working_capital_profile = "high";
      margin_profile = "scale";
      capex_profile = "heavy";
      break;
    case "marketplace":
      working_capital_profile = "low";
      margin_profile = "mixed";
      capex_profile = "light";
      break;
    case "healthcare_services":
      working_capital_profile = "medium";
      margin_profile = "mixed";
      capex_profile = "moderate";
      break;
    default:
      break;
  }

  const reportingCurrency = inputs.reportingCurrency?.trim() || CURRENCY_MAP[hq] || "USD";

  return {
    business_model_type,
    company_listing_type,
    market_region_type,
    comp_selection_strategy,
    wacc_reference_region,
    working_capital_profile,
    margin_profile,
    capex_profile,
    business_type,
    revenue_model,
    customer_type,
    main_operating_geography,
    benchmark_family,
    headquartersCountry: hq,
    industry,
    reportingCurrency,
    descriptionSignals,
    manualCompHints,
  };
}

/** Debug: log the interpreted profile (for development validation). */
export function debugInterpretedProfile(profile: InterpretedCompanyProfile): void {
  if (typeof window === "undefined") return;
  const debug = {
    business_model_type: profile.business_model_type,
    company_listing_type: profile.company_listing_type,
    market_region_type: profile.market_region_type,
    comp_selection_strategy: profile.comp_selection_strategy,
    wacc_reference_region: profile.wacc_reference_region,
    benchmark_family: profile.benchmark_family,
    business_type: profile.business_type,
    revenue_model: profile.revenue_model,
    customer_type: profile.customer_type,
    main_operating_geography: profile.main_operating_geography,
    working_capital_profile: profile.working_capital_profile,
    margin_profile: profile.margin_profile,
    capex_profile: profile.capex_profile,
    headquartersCountry: profile.headquartersCountry,
    industry: profile.industry,
    reportingCurrency: profile.reportingCurrency,
    descriptionSignals: profile.descriptionSignals,
    manualCompHints: profile.manualCompHints,
  };
  console.log("[Company Context] Interpreted profile:", debug);
}

/** Layer B: build research evidence from profile + inputs (for synthesis and debug). */
export function buildResearchEvidence(profile: InterpretedCompanyProfile, inputs: CompanyContextUserInputs, peerCandidates: SuggestedComp[]): CompanyContextEvidence {
  const entityClues: string[] = [
    profile.business_model_type !== "generic" ? `Business model: ${profile.business_model_type}` : "",
    profile.main_operating_geography !== "other" ? `Geography: ${profile.main_operating_geography}` : "",
    profile.customer_type ? `Customer: ${profile.customer_type}` : "",
    profile.revenue_model ? `Revenue: ${profile.revenue_model}` : "",
    ...profile.descriptionSignals.map((s) => `Description: ${s}`),
  ].filter(Boolean);

  const peerClues: string[] = [];
  if (profile.manualCompHints.length > 0) peerClues.push("User-provided peer hints: " + profile.manualCompHints.join(", "));
  if (profile.comp_selection_strategy === "proxy_public_peers") peerClues.push("Comp strategy: proxy public peers (private company)");

  let countryRegionContext = profile.headquartersCountry ? `HQ: ${profile.headquartersCountry}. ` : "";
  countryRegionContext += profile.market_region_type === "emerging" ? "Emerging market; CRP and regional comps relevant." : "Developed market.";
  if (profile.wacc_reference_region === "mexico" || profile.wacc_reference_region === "latam") countryRegionContext += " Latam/Mexico WACC basis.";

  const valuationContextBasis = profile.company_listing_type === "private"
    ? "Valuation context from proxy public peers; beta and leverage from listed comps in same business model and region."
    : "Valuation context from direct peers and market data.";

  return {
    entityClues,
    peerClues,
    countryRegionContext,
    benchmarkFamily: profile.benchmark_family,
    valuationContextBasis,
    peerCandidates: peerCandidates.map((c) => ({
      name: c.companyName,
      ticker: c.ticker,
      role: c.role,
      basis: c.sourceBasis ?? "ai_suggested",
    })),
  };
}

/**
 * Build expanded evidence (entity, peer, benchmark, market, synthesis) for debugging and synthesis.
 */
export function buildResearchEvidenceV2(
  profile: InterpretedCompanyProfile,
  inputs: CompanyContextUserInputs,
  candidatePeers: CandidatePeer[],
  selectedPeers: SuggestedComp[],
  benchmarkResult: { ranges: IndustryBenchmarks; basis: Partial<Record<string, BenchmarkBasis>>; primaryBasis: BenchmarkBasis },
  waccContext: WaccValuationContext
): CompanyContextEvidenceV2 {
  const entityEvidence: string[] = [
    profile.business_model_type !== "generic" ? `Business model: ${profile.business_model_type}` : "",
    profile.benchmark_family !== "generic" ? `Benchmark family: ${profile.benchmark_family}` : "",
    profile.main_operating_geography !== "other" ? `Geography: ${profile.main_operating_geography}` : "",
    profile.customer_type ? `Customer: ${profile.customer_type}` : "",
    profile.revenue_model ? `Revenue: ${profile.revenue_model}` : "",
    ...profile.descriptionSignals.map((s) => `Signal: ${s}`),
  ].filter(Boolean);

  const selectionRationale =
    selectedPeers.length >= 2
      ? profile.company_listing_type === "private"
        ? "Recommended set blends user hints with proxy public peers in same business model/region."
        : "Recommended set blends user hints with direct peers in same segment/region."
      : "Limited peer set; expand known peers or refine business type for better comps.";

  const marketEvidence = {
    riskFreeReference: waccContext.riskFreeReference ?? waccContext.riskFreeRateMarket,
    countryRiskContext: waccContext.countryRiskContext ?? waccContext.countrySovereignRisk,
    betaLogic: waccContext.waccContextBasis ?? `Beta ${waccContext.peerBetaRange ?? ""} from ${profile.comp_selection_strategy}.`,
    leverageLogic: waccContext.leverageBenchmark,
    waccContextBasis: waccContext.waccContextBasis,
  };

  const synthesisBasis = [
    profile.company_listing_type === "public" ? "Public" : "Private",
    profile.main_operating_geography !== "other" ? profile.main_operating_geography.toUpperCase() : profile.headquartersCountry || "",
    profile.benchmark_family,
    benchmarkResult.primaryBasis,
  ].filter(Boolean).join(" · ");

  return {
    entityEvidence,
    peerEvidence: {
      candidatePeers,
      selectedPeers,
      selectionRationale,
    },
    benchmarkEvidence: {
      ranges: benchmarkResult.ranges,
      basis: benchmarkResult.basis,
      primaryBasis: benchmarkResult.primaryBasis,
    },
    marketEvidence,
    synthesisBasis,
  };
}

// --- Peer research engine ---

/** Geography preference for peer filtering (HQ/operating). */
function regionPreference(geo: MainOperatingGeography, waccRegion: WaccReferenceRegion): string[] {
  if (geo === "mexico" || waccRegion === "mexico") return ["Mexico", "LATAM", "United States"];
  if (geo === "latam" || waccRegion === "latam") return ["Mexico", "LATAM", "Argentina", "United States"];
  if (geo === "us") return ["United States", "Canada"];
  if (geo === "canada") return ["Canada", "United States"];
  if (geo === "europe") return ["Europe", "Germany", "France", "United Kingdom", "Switzerland"];
  return ["United States", "Canada", "Europe"];
}

function countryInPreference(country: string, pref: string[]): boolean {
  const c = country.toLowerCase();
  if (pref.some((p) => p.toLowerCase() === c)) return true;
  if (pref.includes("LATAM") && ["argentina", "brazil", "chile", "colombia", "peru"].some((r) => c.includes(r))) return true;
  if (pref.includes("Europe") && ["germany", "france", "united kingdom", "switzerland", "netherlands"].some((r) => c.includes(r))) return true;
  return false;
}

/**
 * Map sourceBasis to UI-facing suggestion type and match summary.
 */
function toSuggestionType(sourceBasis: CompSourceBasis, isPrivate: boolean): PeerSuggestionType {
  if (sourceBasis === "user_hint" || sourceBasis === "user_provided") return "user_hint";
  if (isPrivate && (sourceBasis === "proxy_peer" || sourceBasis === "direct_peer")) return "proxy_peer";
  if (!isPrivate && (sourceBasis === "direct_peer" || sourceBasis === "ai_suggested")) return "direct_comp";
  return "low_confidence_suggestion";
}

function matchSummaryFor(c: CandidatePeer, profile: InterpretedCompanyProfile, suggestionType: PeerSuggestionType): string {
  if (suggestionType === "user_hint") return "From your list; verify business model and geography match.";
  const parts: string[] = [];
  if (c.businessModelRelevance) parts.push(`Segment: ${c.businessModelRelevance.replace(/_/g, " ")}`);
  if (c.country) parts.push(`Country: ${c.country}`);
  parts.push(`Role: ${c.role.replace(/_/g, " ")}`);
  return parts.join(". ");
}

/**
 * Peer research engine: build candidate peer universe from inputs + profile, then derive recommended comp set.
 * Filter by allowedBusinessModels only (segment-strict: e.g. healthcare never gets industrial).
 * When allowed is empty, no universe peers are added — only user hints if any.
 */
export function runPeerResearch(
  inputs: CompanyContextUserInputs,
  profile: InterpretedCompanyProfile,
  ts: number,
  allowedBusinessModels: BusinessModelType[]
): { candidatePeers: CandidatePeer[]; recommendedComps: SuggestedComp[] } {
  const prefix = `comp_${ts}_`;
  const { company_listing_type, manualCompHints, main_operating_geography, wacc_reference_region } = profile;
  const isPrivate = company_listing_type === "private";
  const sourceBasis: CompSourceBasis = isPrivate ? "proxy_peer" : "direct_peer";
  const preference = regionPreference(main_operating_geography, wacc_reference_region);

  const candidatePeers: CandidatePeer[] = [];

  // 1. User hints as candidates (strong evidence; always allowed)
  const hintRoles: CompRole[] = ["operating_comp", "valuation_comp", "beta_comp"];
  manualCompHints.forEach((h, i) => {
    const name = h.charAt(0).toUpperCase() + h.slice(1);
    candidatePeers.push({
      name,
      ticker: undefined,
      country: undefined,
      businessModelRelevance: profile.business_model_type,
      role: hintRoles[Math.min(i, 2)],
      rationale: "From your known peers / proxy list.",
      sourceBasis: "user_hint",
      relevanceScore: 1,
    });
  });

  // 2. Curated universe: only allowed business models (never industrial for healthcare)
  const modelMatch = (r: PeerRow) => allowedBusinessModels.length > 0 && allowedBusinessModels.includes(r.business_model_type);
  const fromUniverse = PEER_UNIVERSE.filter(modelMatch);
  const sorted = [...fromUniverse].sort((a, b) => {
    const aMatch = preference.some((p) => countryInPreference(a.country, [p]));
    const bMatch = preference.some((p) => countryInPreference(b.country, [p]));
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    return 0;
  });
  sorted.forEach((r, i) => {
    candidatePeers.push({
      name: r.name,
      ticker: r.ticker,
      country: r.country,
      businessModelRelevance: r.business_model_type,
      role: r.role,
      rationale: r.rationale,
      sourceBasis,
      relevanceScore: 1 - i * 0.05,
    });
  });

  // 3. Build recommended comp set with matchSummary and suggestionType
  const recommendedComps: SuggestedComp[] = [];
  const usedNames = new Set<string>();

  const addComp = (c: CandidatePeer, idx: number, basis: CompSourceBasis, suggestionType: PeerSuggestionType, conf: ConfidenceLevel) => {
    const key = c.name.toLowerCase();
    if (usedNames.has(key)) return;
    usedNames.add(key);
    recommendedComps.push({
      id: `${prefix}${basis}_${idx}`,
      companyName: c.name,
      ticker: c.ticker,
      reason: c.rationale,
      role: c.role,
      status: "suggested",
      sourceBasis: basis,
      matchSummary: matchSummaryFor(c, profile, suggestionType),
      relevanceScore: c.relevanceScore,
      suggestionConfidence: conf,
      suggestionType,
    });
  };

  const userHintConfs: ConfidenceLevel = "high";
  candidatePeers.filter((c) => c.sourceBasis === "user_hint").slice(0, 4).forEach((c, i) => addComp(c, i, "user_hint", "user_hint", userHintConfs));

  const fromUniverseCandidates = candidatePeers.filter((c) => c.sourceBasis !== "user_hint");
  const universeConf: ConfidenceLevel = fromUniverseCandidates.length >= 2 ? "high" : fromUniverseCandidates.length === 1 ? "medium" : "low";
  const needRoles: CompRole[] = ["operating_comp", "valuation_comp", "beta_comp"];
  for (const role of needRoles) {
    if (recommendedComps.some((r) => r.role === role)) continue;
    const cand = fromUniverseCandidates.find((c) => c.role === role && !usedNames.has(c.name.toLowerCase()));
    if (cand) addComp(cand, recommendedComps.length, cand.sourceBasis, toSuggestionType(cand.sourceBasis, isPrivate), universeConf);
  }
  for (const c of fromUniverseCandidates) {
    if (recommendedComps.length >= 6) break;
    addComp(c, recommendedComps.length, c.sourceBasis, toSuggestionType(c.sourceBasis, isPrivate), universeConf);
  }

  return { candidatePeers, recommendedComps };
}

// --- Generation helpers that use the profile ---

const TS = () => Date.now();

function comp(
  id: string,
  companyName: string,
  ticker: string,
  reason: string,
  role: CompRole,
  sourceBasis: CompSourceBasis = "ai_suggested"
): SuggestedComp {
  return { id, companyName, ticker, reason, role, status: "suggested", sourceBasis };
}

/**
 * Generate suggested comps from profile + manual hints.
 * Private companies get proxy public peers; geography and business model drive selection.
 */
export function getCompsFromProfile(profile: InterpretedCompanyProfile, ts: number): SuggestedComp[] {
  const prefix = `comp_${ts}_`;
  const { business_model_type, company_listing_type, wacc_reference_region, industry, manualCompHints } = profile;

  const isPrivate = company_listing_type === "private";
  const sourceBasis: CompSourceBasis = isPrivate ? "proxy_peer" : "ai_suggested";

  if (manualCompHints.length > 0) {
    const names = manualCompHints.slice(0, 6);
    return names.map((name, i) =>
      comp(prefix + `hint_${i}`, name.charAt(0).toUpperCase() + name.slice(1), "", "From your known peers / proxy list", "operating_comp", "user_provided")
    );
  }

  const isMexicoOrLatam = wacc_reference_region === "mexico" || wacc_reference_region === "latam";

  switch (business_model_type) {
    case "wholesale_distribution":
    case "consumer_staples_distribution":
      return isMexicoOrLatam
        ? [
            comp(prefix + "1", "Organización Soriana", "SORIANA.MX", "Mexican retail/distribution; proxy for regional scale", "operating_comp", sourceBasis),
            comp(prefix + "2", "Grupo Comercial Chedraui", "CHEDRAUI.MX", "Mexican grocery and general merchandise", "valuation_comp", sourceBasis),
            comp(prefix + "3", "Wal-Mart de México", "WALMEX.MX", "Large-scale retail/distribution in Mexico", "beta_comp", sourceBasis),
            comp(prefix + "4", "Grupo Bimbo", "BIMBOA.MX", "Distribution and consumer staples", "operating_comp", sourceBasis),
          ]
        : [
            comp(prefix + "1", "Sysco Corporation", "SYY", "Broadline food distribution; scale and margins", "operating_comp", sourceBasis),
            comp(prefix + "2", "US Foods Holding", "USFD", "Food distribution peer", "valuation_comp", sourceBasis),
            comp(prefix + "3", "Performance Food Group", "PFGC", "Distribution and logistics", "beta_comp", sourceBasis),
            comp(prefix + "4", "Core-Mark Holding", "CORE", "Wholesale distribution", "operating_comp", sourceBasis),
          ];
    case "logistics":
      return [
        comp(prefix + "1", "XPO Logistics", "XPO", "Asset-light logistics and freight", "operating_comp", sourceBasis),
        comp(prefix + "2", "CH Robinson", "CHRW", "Freight brokerage and logistics", "valuation_comp", sourceBasis),
        comp(prefix + "3", "Expeditors International", "EXPD", "Global logistics", "beta_comp", sourceBasis),
      ];
    case "software_saas":
      return [
        comp(prefix + "1", "Microsoft Corporation", "MSFT", "Enterprise software scale; margin and growth benchmark", "operating_comp", sourceBasis),
        comp(prefix + "2", "Salesforce Inc", "CRM", "SaaS leader; multiple and growth comp", "valuation_comp", sourceBasis),
        comp(prefix + "3", "ServiceNow Inc", "NOW", "High-growth workflow software", "valuation_comp", sourceBasis),
        comp(prefix + "4", "Adobe Inc", "ADBE", "Subscription mix; margin structure comp", "beta_comp", sourceBasis),
      ];
    case "industrial_manufacturing":
      return [
        comp(prefix + "1", "3M Company", "MMM", "Industrial diversified; margin and capital profile", "operating_comp", sourceBasis),
        comp(prefix + "2", "Honeywell International", "HON", "Industrial and automation", "valuation_comp", sourceBasis),
        comp(prefix + "3", "Emerson Electric", "EMR", "Industrial peer", "beta_comp", sourceBasis),
      ];
    case "healthcare_services":
      return [
        comp(prefix + "1", "UnitedHealth Group", "UNH", "Healthcare services; scale and margin", "operating_comp", sourceBasis),
        comp(prefix + "2", "Anthem Inc", "ELV", "Health benefits and services", "valuation_comp", sourceBasis),
        comp(prefix + "3", "Cigna Group", "CI", "Healthcare and pharmacy services", "beta_comp", sourceBasis),
      ];
    case "marketplace":
      return [
        comp(prefix + "1", "eBay Inc", "EBAY", "Marketplace and classifieds", "operating_comp", sourceBasis),
        comp(prefix + "2", "Etsy Inc", "ETSY", "Niche marketplace", "valuation_comp", sourceBasis),
        comp(prefix + "3", "MercadoLibre", "MELI", "Latam marketplace and fintech", "beta_comp", sourceBasis),
      ];
    case "branded_retail":
      if (industry === "Consumer Retail" || industry === "Technology") {
        return [
          comp(prefix + "1", "Nike Inc", "NKE", "Global athletic apparel leader; scale and margin benchmark", "operating_comp", sourceBasis),
          comp(prefix + "2", "Deckers Outdoor", "DECK", "Premium footwear/apparel peer; margin comp", "valuation_comp", sourceBasis),
          comp(prefix + "3", "On Holding AG", "ONON", "High-growth athletic brand; growth comp", "valuation_comp", sourceBasis),
          comp(prefix + "4", "Adidas AG", "ADS", "Large strategic competitor; global comp", "beta_comp", sourceBasis),
        ];
      }
      return [
        comp(prefix + "1", "Nike Inc", "NKE", "Branded retail; scale and margin", "operating_comp", sourceBasis),
        comp(prefix + "2", "Lululemon Athletica", "LULU", "Premium athletic retail", "valuation_comp", sourceBasis),
        comp(prefix + "3", "Deckers Outdoor", "DECK", "Footwear/apparel peer", "beta_comp", sourceBasis),
      ];
    case "financial_services":
      return [
        comp(prefix + "1", "JPMorgan Chase", "JPM", "Diversified financial services", "operating_comp", sourceBasis),
        comp(prefix + "2", "Bank of America", "BAC", "Banking peer", "valuation_comp", sourceBasis),
        comp(prefix + "3", "Wells Fargo", "WFC", "Banking peer", "beta_comp", sourceBasis),
      ];
    default:
      return [
        comp(prefix + "1", "Peer A Inc", "PEER-A", "Same segment, similar scale", "operating_comp", sourceBasis),
        comp(prefix + "2", "Peer B Corp", "PEER-B", "Closest valuation multiple", "valuation_comp", sourceBasis),
        comp(prefix + "3", "Peer C Ltd", "PEER-C", "Similar leverage and beta", "beta_comp", sourceBasis),
      ];
  }
}

/**
 * Company-specific beta and leverage by profile + peer set (public vs private, geography, business type).
 */
export function getWaccContextFromProfile(
  profile: InterpretedCompanyProfile,
  recommendedComps?: SuggestedComp[]
): WaccValuationContext {
  const { wacc_reference_region, market_region_type, company_listing_type, headquartersCountry, business_model_type, benchmark_family } = profile;
  const isPrivate = company_listing_type === "private";
  const hasPeerSet = recommendedComps && recommendedComps.length >= 2;

  let riskFreeRateMarket: string;
  let countrySovereignRisk: string;
  let equityRiskPremiumBasis: string;
  let costOfDebtContext: string;
  let peerBetaRangeMin: number;
  let peerBetaRangeMax: number;
  let selectedBetaEstimate: number;
  let leverageBenchmark: string;
  let waccContextBasis: string;

  switch (wacc_reference_region) {
    case "mexico":
      riskFreeRateMarket = "Mexican government bonds (10Y)";
      countrySovereignRisk = "Mexico";
      equityRiskPremiumBasis = "Damodaran implied ERP + Mexico country risk premium";
      costOfDebtContext = "Peso-denominated or USD hedged; monitor sovereign and FX.";
      break;
    case "latam":
      riskFreeRateMarket = "US 10Y Treasury (often used as base for Latam)";
      countrySovereignRisk = headquartersCountry || "Latam";
      equityRiskPremiumBasis = "Damodaran implied ERP + country risk premium for region";
      costOfDebtContext = "Sovereign and FX risk; refinancing in local or USD.";
      break;
    case "canada":
      riskFreeRateMarket = "Canada 10Y government bond";
      countrySovereignRisk = "Canada";
      equityRiskPremiumBasis = "Damodaran implied ERP";
      costOfDebtContext = "Refinance when rates allow; track credit spread.";
      break;
    case "us":
      riskFreeRateMarket = "US 10Y Treasury";
      countrySovereignRisk = "United States";
      equityRiskPremiumBasis = "Damodaran implied ERP";
      costOfDebtContext = "Refinance when rates allow; track credit spread.";
      break;
    case "europe":
    case "other_developed":
      riskFreeRateMarket = "10Y Bund / OAT or local sovereign";
      countrySovereignRisk = headquartersCountry || "Europe";
      equityRiskPremiumBasis = "Damodaran implied ERP";
      costOfDebtContext = "Euro or local currency debt; track spreads.";
      break;
    default:
      riskFreeRateMarket = "US 10Y Treasury";
      countrySovereignRisk = headquartersCountry || "Emerging";
      equityRiskPremiumBasis = "Damodaran implied ERP + country risk premium";
      costOfDebtContext = "Sovereign and FX; refinancing context.";
  }

  // Company-specific beta range and selected beta by business type and geography
  if (benchmark_family === "saas" || business_model_type === "software_saas") {
    peerBetaRangeMin = 1.0;
    peerBetaRangeMax = 1.5;
    selectedBetaEstimate = hasPeerSet ? 1.2 : 1.15;
    leverageBenchmark = "Net debt / EBITDA typically -0.5x to 1.0x for software/SaaS; use peer set.";
  } else if (benchmark_family === "premium_branded_retail" || business_model_type === "branded_retail") {
    peerBetaRangeMin = 0.9;
    peerBetaRangeMax = 1.4;
    selectedBetaEstimate = hasPeerSet ? 1.1 : 1.05;
    leverageBenchmark = wacc_reference_region === "canada" || wacc_reference_region === "us"
      ? "Net debt / EBITDA 0–1.5x (branded retail norm); check peer set."
      : "Net debt / EBITDA 0.5–2.0x";
  } else if (benchmark_family === "wholesale_distribution" || benchmark_family === "consumer_staples_distribution" || business_model_type === "wholesale_distribution" || business_model_type === "consumer_staples_distribution") {
    peerBetaRangeMin = 0.7;
    peerBetaRangeMax = 1.2;
    selectedBetaEstimate = hasPeerSet ? 1.0 : 0.95;
    leverageBenchmark = (wacc_reference_region === "mexico" || wacc_reference_region === "latam")
      ? "Net debt / EBITDA 1.0–2.5x (regional distribution/retail norms); proxy peers."
      : "Net debt / EBITDA 0.5–2.5x (distribution); use peer set.";
  } else if (benchmark_family === "industrial_manufacturing") {
    peerBetaRangeMin = 0.9;
    peerBetaRangeMax = 1.4;
    selectedBetaEstimate = hasPeerSet ? 1.1 : 1.05;
    leverageBenchmark = "Net debt / EBITDA 0.5–2.5x; industrial comps.";
  } else if (benchmark_family === "marketplace_platform" || benchmark_family === "healthcare_services") {
    peerBetaRangeMin = 0.9;
    peerBetaRangeMax = 1.4;
    selectedBetaEstimate = 1.1;
    leverageBenchmark = "Net debt / EBITDA 0–2.0x; segment peers.";
  } else {
    peerBetaRangeMin = 0.9;
    peerBetaRangeMax = 1.3;
    selectedBetaEstimate = 1.05;
    leverageBenchmark = "Net debt / EBITDA 0.5–2.0x";
  }

  if (isPrivate) {
    waccContextBasis = "Private company: beta and leverage from proxy public peers in same business model and region.";
    costOfDebtContext = `${waccContextBasis} ${costOfDebtContext || ""}`;
    return {
      riskFreeRateMarket,
      riskFreeReference: riskFreeRateMarket,
      countrySovereignRisk,
      countryRiskContext: countrySovereignRisk,
      equityRiskPremiumBasis,
      betaEstimate: selectedBetaEstimate,
      selectedBetaEstimate,
      peerBetaRangeMin,
      peerBetaRangeMax,
      peerBetaRange: `${peerBetaRangeMin}–${peerBetaRangeMax}`,
      leverageBenchmark,
      costOfDebtContext,
      waccContextBasis,
    };
  }

  waccContextBasis = hasPeerSet
    ? "Direct peer set used for beta range and leverage benchmark."
    : "Beta and leverage from segment/benchmark family until peer set is refined.";
  return {
    riskFreeRateMarket,
    riskFreeReference: riskFreeRateMarket,
    countrySovereignRisk,
    countryRiskContext: countrySovereignRisk,
    equityRiskPremiumBasis,
    betaEstimate: selectedBetaEstimate,
    selectedBetaEstimate,
    peerBetaRangeMin,
    peerBetaRangeMax,
    peerBetaRange: `${peerBetaRangeMin}–${peerBetaRangeMax}`,
    leverageBenchmark,
    costOfDebtContext,
    waccContextBasis,
  };
}

/**
 * Derive benchmark ranges from peer set when possible; fall back to benchmark_family.
 * Priority: peer_derived (public, 2+ peers) → proxy_peer_derived (private, 2+ peers) → benchmark_family_fallback.
 */
export function getBenchmarksFromEvidence(
  profile: InterpretedCompanyProfile,
  recommendedComps: SuggestedComp[]
): { ranges: IndustryBenchmarks; basis: Partial<Record<string, BenchmarkBasis>>; primaryBasis: BenchmarkBasis } {
  const ranges = getBenchmarksFromProfile(profile);
  const hasPeerSet = recommendedComps.length >= 2;
  const isPrivate = profile.company_listing_type === "private";
  const primaryBasis: BenchmarkBasis = hasPeerSet
    ? (isPrivate ? "proxy_peer_derived" : "peer_derived")
    : "benchmark_family_fallback";
  const basis: Partial<Record<string, BenchmarkBasis>> = {
    revenueGrowth: primaryBasis,
    grossMargin: primaryBasis,
    ebitdaMargin: primaryBasis,
    ebitMargin: primaryBasis,
    capexPctRevenue: primaryBasis,
    leverageNetDebtEbitda: primaryBasis,
    beta: primaryBasis,
  };
  return { ranges: { ...ranges, basis }, basis, primaryBasis };
}

/**
 * Industry benchmarks from profile (benchmark_family). Used as fallback and for getBenchmarksFromEvidence ranges.
 */
export function getBenchmarksFromProfile(profile: InterpretedCompanyProfile): IndustryBenchmarks {
  const { benchmark_family, margin_profile, working_capital_profile, capex_profile } = profile;

  switch (benchmark_family) {
    case "wholesale_distribution":
    case "consumer_staples_distribution":
      return {
        revenueGrowthMin: 3,
        revenueGrowthMax: 12,
        grossMarginMin: 12,
        grossMarginMax: 25,
        ebitdaMarginMin: 3,
        ebitdaMarginMax: 8,
        ebitMarginMin: 2,
        ebitMarginMax: 5,
        capexPctRevenueMin: 0.5,
        capexPctRevenueMax: 2,
        wcIntensityLevel: "high",
        leverageNetDebtEbitdaMin: 0.5,
        leverageNetDebtEbitdaMax: 2.5,
        betaMin: 0.7,
        betaMax: 1.2,
      };
    case "logistics":
      return {
        revenueGrowthMin: 4,
        revenueGrowthMax: 15,
        grossMarginMin: 8,
        grossMarginMax: 20,
        ebitdaMarginMin: 4,
        ebitdaMarginMax: 12,
        ebitMarginMin: 2,
        ebitMarginMax: 8,
        capexPctRevenueMin: 1,
        capexPctRevenueMax: 4,
        wcIntensityLevel: "medium",
        leverageNetDebtEbitdaMin: 0.5,
        leverageNetDebtEbitdaMax: 2.0,
        betaMin: 0.9,
        betaMax: 1.4,
      };
    case "saas":
      return {
        revenueGrowthMin: 10,
        revenueGrowthMax: 30,
        grossMarginMin: 65,
        grossMarginMax: 85,
        ebitdaMarginMin: 15,
        ebitdaMarginMax: 35,
        ebitMarginMin: 10,
        ebitMarginMax: 28,
        capexPctRevenueMin: 1,
        capexPctRevenueMax: 5,
        wcIntensityLevel: "low",
        leverageNetDebtEbitdaMin: -0.5,
        leverageNetDebtEbitdaMax: 1.0,
        betaMin: 1.0,
        betaMax: 1.5,
      };
    case "premium_branded_retail":
      return {
        revenueGrowthMin: 5,
        revenueGrowthMax: 18,
        grossMarginMin: 50,
        grossMarginMax: 72,
        ebitdaMarginMin: 12,
        ebitdaMarginMax: 22,
        ebitMarginMin: 8,
        ebitMarginMax: 16,
        capexPctRevenueMin: 2,
        capexPctRevenueMax: 8,
        wcIntensityLevel: "medium",
        leverageNetDebtEbitdaMin: 0,
        leverageNetDebtEbitdaMax: 1.5,
        betaMin: 0.9,
        betaMax: 1.4,
      };
    case "industrial_manufacturing":
      return {
        revenueGrowthMin: 2,
        revenueGrowthMax: 10,
        grossMarginMin: 25,
        grossMarginMax: 45,
        ebitdaMarginMin: 10,
        ebitdaMarginMax: 22,
        ebitMarginMin: 6,
        ebitMarginMax: 16,
        capexPctRevenueMin: 3,
        capexPctRevenueMax: 10,
        wcIntensityLevel: "high",
        leverageNetDebtEbitdaMin: 0.5,
        leverageNetDebtEbitdaMax: 2.5,
        betaMin: 0.9,
        betaMax: 1.4,
      };
    case "marketplace_platform":
      return {
        revenueGrowthMin: 8,
        revenueGrowthMax: 25,
        grossMarginMin: 55,
        grossMarginMax: 78,
        ebitdaMarginMin: 10,
        ebitdaMarginMax: 28,
        ebitMarginMin: 6,
        ebitMarginMax: 20,
        capexPctRevenueMin: 1,
        capexPctRevenueMax: 5,
        wcIntensityLevel: "low",
        leverageNetDebtEbitdaMin: -0.5,
        leverageNetDebtEbitdaMax: 1.5,
        betaMin: 1.0,
        betaMax: 1.5,
      };
    case "healthcare_services":
      return {
        revenueGrowthMin: 4,
        revenueGrowthMax: 12,
        grossMarginMin: 25,
        grossMarginMax: 45,
        ebitdaMarginMin: 6,
        ebitdaMarginMax: 14,
        ebitMarginMin: 4,
        ebitMarginMax: 10,
        capexPctRevenueMin: 2,
        capexPctRevenueMax: 6,
        wcIntensityLevel: "medium",
        leverageNetDebtEbitdaMin: 0.5,
        leverageNetDebtEbitdaMax: 2.0,
        betaMin: 0.7,
        betaMax: 1.2,
      };
    default:
      return {
        revenueGrowthMin: 4,
        revenueGrowthMax: 15,
        grossMarginMin: 35,
        grossMarginMax: 60,
        ebitdaMarginMin: 10,
        ebitdaMarginMax: 22,
        ebitMarginMin: 6,
        ebitMarginMax: 16,
        capexPctRevenueMin: 2,
        capexPctRevenueMax: 6,
        wcIntensityLevel: working_capital_profile === "high" ? "high" : working_capital_profile === "low" ? "low" : "medium",
        leverageNetDebtEbitdaMin: 0.5,
        leverageNetDebtEbitdaMax: 2.0,
        betaMin: 0.9,
        betaMax: 1.3,
      };
  }
}

/**
 * Modeling implications from profile (distributor vs branded retail vs software etc.).
 */
export function getModelingImplicationsFromProfile(profile: InterpretedCompanyProfile): ModelingImplications {
  const { business_model_type, company_listing_type, wacc_reference_region } = profile;
  const isPrivate = company_listing_type === "private";
  const isEmerging = wacc_reference_region === "mexico" || wacc_reference_region === "latam" || wacc_reference_region === "emerging";

  switch (business_model_type) {
    case "wholesale_distribution":
    case "consumer_staples_distribution":
      return {
        keyForecastDrivers: "Revenue: volume and mix; pricing power often limited. Margins: scale and operating leverage; supplier terms and logistics efficiency.",
        wcDrivers: "Inventory days (DIO) and payables (DPO) are core; compare DIO vs listed distribution peers. AR/AP and working capital intensity drive cash flow.",
        capexBehavior: "Capex typically light vs retail; focus on distribution and IT rather than store rollouts. Reinvestment rate modest.",
        marginStructure: "Gross margin in low-to-mid range; EBIT sensitive to volume and opex discipline. Compare to listed distribution comps.",
        valuationWatchouts: isPrivate
          ? "Beta and leverage benchmark from proxy public distribution peers. Terminal growth should stay near GDP or sector. Regional peer set for Mexico/Latam."
          : (isEmerging ? "Use regional comps for beta and leverage. Country risk premium for WACC. Terminal growth in line with regional GDP." : "Use distribution comps for beta; terminal growth near GDP."),
      };
    case "logistics":
      return {
        keyForecastDrivers: "Revenue: volume and pricing; mix of asset-light vs owned assets. Margins: utilization and cost per unit.",
        wcDrivers: "Working capital often moderate; receivables and payables timing. Compare DSO/DPO to freight and logistics peers.",
        capexBehavior: "Capex depends on asset intensity; asset-light models have lower capex. Fleet and facility investments if owned.",
        marginStructure: "Margins from benchmark range; scale and operating leverage matter. Compare to logistics comps.",
        valuationWatchouts: isPrivate ? "Beta benchmark from proxy public logistics peers. Leverage benchmark from listed freight/logistics comps." : "Use logistics peers for beta and leverage.",
      };
    case "software_saas":
      return {
        keyForecastDrivers: "Revenue: ARR growth, retention, and net revenue retention. Margins: gross margin stability; opex leverage as scale grows.",
        wcDrivers: "Working capital typically low; deferred revenue and minimal inventory. Watch contract duration and billings timing.",
        capexBehavior: "Capex light; data center and software spend. Reinvestment in R&D and sales capacity.",
        marginStructure: "High gross margin; EBIT margin expansion with scale. Compare to SaaS comps for sanity check.",
        valuationWatchouts: "Use SaaS/software peers for beta. Terminal growth often above GDP; align with sector.",
      };
    case "branded_retail":
      return {
        keyForecastDrivers: "Revenue: volume and price; product mix and geographic exposure. Margins: opex discipline and mix shift; link to industry benchmarks.",
        wcDrivers: "Inventory days likely a core driver; compare DIO vs peer set. AR/AP tied to revenue; watch DSO/DPO.",
        capexBehavior: "Capex tied to store growth and remodel cadence; separate maintenance vs growth capex. Reinvestment rate drives FCF.",
        marginStructure: "Gross margin from benchmark range; EBIT sensitive to opex leverage. Compare to comps.",
        valuationWatchouts: "Use branded/segment peers for beta; terminal growth should stay near GDP/inflation range. Check peer beta range and leverage norm.",
      };
    case "industrial_manufacturing":
      return {
        keyForecastDrivers: "Revenue: volume and mix; pricing and input costs. Margins: capacity utilization and fixed cost leverage.",
        wcDrivers: "Inventory and receivables are material; DIO and DSO vs industrial peers. Working capital intensity high.",
        capexBehavior: "Capex material for maintenance and capacity; separate maintenance vs growth. Reinvestment rate drives FCF.",
        marginStructure: "Gross margin and EBIT from benchmark range; compare to industrial comps.",
        valuationWatchouts: isPrivate ? "Beta and leverage benchmark from proxy public industrial peers." : "Use industrial peers for beta and leverage.",
      };
    case "marketplace":
      return {
        keyForecastDrivers: "Revenue: GMV and take rate; growth and monetization. Margins: take rate and opex leverage.",
        wcDrivers: "Working capital often low; focus on payment timing and float if applicable.",
        capexBehavior: "Capex typically light; tech and product investment. Reinvestment in growth.",
        marginStructure: "Margins from benchmark; take rate and opex discipline. Compare to marketplace comps.",
        valuationWatchouts: "Use marketplace peers for beta; terminal growth can be above GDP.",
      };
    case "healthcare_services":
      return {
        keyForecastDrivers: "Revenue: volume and reimbursement mix; regulatory and utilization. Margins: cost structure and scale.",
        wcDrivers: "Receivables and reimbursement timing; DSO vs healthcare peers. Working capital moderate.",
        capexBehavior: "Capex for facilities and equipment; moderate intensity. Reinvestment in capacity and tech.",
        marginStructure: "Margins from benchmark range; compare to healthcare services comps.",
        valuationWatchouts: "Use healthcare services peers for beta; regulatory and reimbursement risk in terminal assumptions.",
      };
    default:
      return {
        keyForecastDrivers: "Revenue: volume and price; segment and geographic mix. Margins: opex discipline and mix shift; tie to industry benchmark ranges.",
        wcDrivers: "AR/AP tied to revenue; inventory days-based if applicable. Watch DSO/DIO/DPO vs peers.",
        capexBehavior: "Capex as % revenue from benchmark; distinguish maintenance vs growth. Reinvestment rate drives FCF.",
        marginStructure: "Gross margin from benchmark range; EBIT sensitive to opex leverage. Compare to comps.",
        valuationWatchouts: isPrivate ? "Beta benchmark from proxy public peers. Terminal growth near GDP/sector." : "Use segment peers for beta; terminal growth near GDP.",
      };
  }
}

const BUSINESS_MODEL_LABELS: Record<BusinessModelType, string> = {
  branded_retail: "Branded retail",
  wholesale_distribution: "Wholesale / distribution",
  consumer_staples_distribution: "Consumer staples distribution",
  software_saas: "Software / SaaS",
  industrial_manufacturing: "Industrial / manufacturing",
  healthcare_services: "Healthcare services",
  marketplace: "Marketplace",
  logistics: "Logistics",
  financial_services: "Financial services",
  generic: "General",
};

/**
 * Build Company Overview from research evidence first, then user description, then interpreted profile.
 * If no external/company evidence, state that clearly and fall back gracefully.
 */
export function synthesizeCompanySnapshotFromEvidence(
  inputs: CompanyContextUserInputs,
  profile: InterpretedCompanyProfile,
  evidence: CompanyContextEvidenceV2,
  research?: CompanyResearch
): string {
  const name = research?.resolvedEntityName || inputs.companyName?.trim() || "Company";
  const isPrivate = profile.company_listing_type === "private";
  const geoMap: Record<string, string> = { mexico: "Mexican", us: "US", canada: "Canadian", latam: "LATAM", europe: "European", global: "Global" };
  const geoLabel = profile.main_operating_geography && profile.main_operating_geography !== "other"
    ? geoMap[profile.main_operating_geography] ?? profile.main_operating_geography
    : profile.headquartersCountry?.replace(/United States/i, "US").replace(/United Kingdom/i, "UK") ?? "";
  const modelLabel = BUSINESS_MODEL_LABELS[profile.business_model_type];
  const familyLabel = profile.benchmark_family.replace(/_/g, " ");
  const nPeers = evidence.peerEvidence.selectedPeers.length;
  const benchmarkNote = evidence.benchmarkEvidence.primaryBasis === "peer_derived" || evidence.benchmarkEvidence.primaryBasis === "proxy_peer_derived"
    ? `Benchmarks from ${nPeers} peer(s); ${isPrivate ? "proxy" : "direct"} set.`
    : `Benchmarks from ${familyLabel} family (fallback).`;
  const wcNote = profile.working_capital_profile === "high" ? "Inventory-heavy WC" : profile.working_capital_profile === "low" ? "Light WC" : "Moderate WC";
  const valuationNote = isPrivate ? "Valuation via proxy public peers" : "Valuation via direct peers and market.";

  const parts: string[] = [];
  if (research?.websiteSummary && research.websiteSummary.length > 20) {
    parts.push(research.websiteSummary.trim());
  } else if ((inputs.shortBusinessDescription ?? "").trim().length >= 15) {
    parts.push((inputs.shortBusinessDescription ?? "").trim());
  }
  if (research?.researchConfidence === "limited_evidence" && !research?.websiteSummary) {
    parts.push("(Limited evidence — no external company source found; overview based on your description and inferred profile.)");
  }
  parts.push(`${name}: ${isPrivate ? "Private" : "Public"} ${geoLabel || "—"} ${modelLabel}. ${benchmarkNote} ${wcNote}; ${valuationNote}.`);
  return parts.join(" ");
}

/** Fallback when evidence not available (e.g. legacy path). */
function synthesizeCompanySnapshot(inputs: CompanyContextUserInputs, profile: InterpretedCompanyProfile): string {
  const name = inputs.companyName?.trim() || "Company";
  const isPrivate = profile.company_listing_type === "private";
  const geoMap: Record<string, string> = { mexico: "Mexican", us: "US", canada: "Canadian", latam: "LATAM", europe: "European", global: "Global" };
  const geoLabel = profile.main_operating_geography && profile.main_operating_geography !== "other"
    ? geoMap[profile.main_operating_geography] ?? profile.main_operating_geography
    : profile.headquartersCountry?.replace(/United States/i, "US").replace(/United Kingdom/i, "UK") ?? "";
  const modelLabel = BUSINESS_MODEL_LABELS[profile.business_model_type].toLowerCase();
  const wcNote = profile.working_capital_profile === "high" ? "inventory-heavy working capital" : profile.working_capital_profile === "low" ? "light working capital" : "moderate working capital";
  const marginNote = profile.margin_profile === "premium" ? "premium margins" : profile.margin_profile === "scale" ? "scale-driven margins" : "mixed margin structure";
  const valuationNote = isPrivate ? "proxy-peer-based valuation context" : "direct peer and market-based valuation context";
  const lead = geoLabel && modelLabel
    ? `${isPrivate ? "Private" : "Public"} ${geoLabel} ${modelLabel} business`
    : `${name}: ${isPrivate ? "private" : "public"} ${modelLabel}`;
  return `${lead} with likely ${wcNote}, ${marginNote}, and ${valuationNote}.`;
}

/**
 * AI context cards (overview, business model, industry, geography, capital structure, notes) from profile + inputs + research.
 * When evidence and research are provided, overview is built from research first (website summary → description → profile).
 */
export function getAiContextFromProfile(
  inputs: CompanyContextUserInputs,
  profile: InterpretedCompanyProfile,
  evidence?: CompanyContextEvidenceV2,
  research?: CompanyResearch
): CompanyContextAiContext {
  const name = research?.resolvedEntityName || inputs.companyName?.trim() || "The company";
  const desc = inputs.shortBusinessDescription?.trim();
  const industry = profile.industry || "the industry";
  const hq = profile.headquartersCountry;
  const isPrivate = profile.company_listing_type === "private";
  const modelLabel = BUSINESS_MODEL_LABELS[profile.business_model_type];
  const regionLabel = profile.market_region_type === "emerging" ? "emerging market" : "developed market";

  const companyOverview = evidence
    ? synthesizeCompanySnapshotFromEvidence(inputs, profile, evidence, research)
    : synthesizeCompanySnapshot(inputs, profile);

  let businessModelSummary = desc || `Revenue primarily from ${industry} operations.`;
  if (profile.business_model_type !== "generic") {
    businessModelSummary += ` Model type: ${modelLabel}. Benchmark and comp selection should align with this profile.`;
  }

  let industryContext = `Industry: ${industry}.`;
  if (profile.descriptionSignals.length > 0) {
    industryContext += ` Description signals: ${profile.descriptionSignals.join(", ")}.`;
  }
  industryContext += " Competitive dynamics and growth drivers; refine with historical data.";

  let geographyAndMacro = hq ? `Primary operations in ${hq}.` : "Geography to be populated.";
  if (profile.wacc_reference_region === "mexico" || profile.wacc_reference_region === "latam") {
    geographyAndMacro += " Regional/Latam exposure; WACC and comps should reflect country risk and local peers where relevant.";
  } else if (profile.market_region_type === "emerging") {
    geographyAndMacro += " Emerging market context; consider country risk premium and regional comps for WACC.";
  } else {
    geographyAndMacro += " Regional mix and macro sensitivity from segment data.";
  }

  let capitalStructureContext: string;
  if (isPrivate) {
    capitalStructureContext = "Private company. Beta and leverage benchmark from proxy public peers. Use listed comps in same business model and region for valuation and WACC context.";
  } else if (inputs.ticker?.trim()) {
    capitalStructureContext = `Listed equity (${inputs.ticker.trim()}). Beta and leverage from market and comps.`;
  } else {
    capitalStructureContext = "Public company. Capital structure and beta from comparables or manual input.";
  }

  const aiModelingNotes = profile.business_model_type !== "generic"
    ? `Context generated from interpreted profile (${modelLabel}). Modeling guidance and benchmarks are aligned to this archetype. Re-run after historicals for finer tuning.`
    : "Context from minimal inputs. Re-run after historicals for sharper modeling notes.";

  return {
    companyOverview,
    businessModelSummary,
    industryContext,
    geographyAndMacro,
    capitalStructureContext,
    aiModelingNotes,
  };
}
