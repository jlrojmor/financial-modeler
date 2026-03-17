/**
 * Company-aware global modeling context.
 * Single canonical builder for downstream suggestion systems (historicals, classification,
 * CF, projections, DCF). Consumers use this normalized object instead of reading companyContext directly.
 * Design: context-weighted suggestions, not context-forced — improve ranking and reasoning, don't lock the user.
 */

import type { CompanyContext, CompanyModelingProfile } from "@/types/company-context";
import { interpretCompanyFromInputs } from "@/lib/company-context-interpretation";

/**
 * Build the canonical company modeling profile from the current company context.
 * Call this whenever a suggestion system needs company-aware input (IS classify, CF classify, projections, etc.).
 */
export function buildModelingContext(companyContext: CompanyContext | null | undefined): CompanyModelingProfile | null {
  if (!companyContext?.user_inputs) return null;

  const u = companyContext.user_inputs;
  const profile = interpretCompanyFromInputs(u);
  const acceptedComps = (companyContext.suggested_comps ?? []).filter((c) => c.status === "accepted");

  return {
    companyName: u.companyName?.trim() ?? "",
    publicPrivate: u.publicPrivate ?? "public",
    headquartersCountry: u.headquartersCountry?.trim() ?? "",
    mainOperatingGeography: u.mainOperatingGeography ?? profile.main_operating_geography ?? "",
    industry: u.industry?.trim() ?? profile.industry ?? "",
    primaryBusinessType: u.primaryBusinessType ?? profile.business_type ?? "",
    revenueModel: u.revenueModel ?? profile.revenue_model ?? "",
    customerType: u.customerType ?? profile.customer_type ?? "",
    benchmarkFamily: profile.benchmark_family ?? "",
    businessModelType: profile.business_model_type ?? "",
    acceptedComps,
    compDerivedMetrics: companyContext.compDerivedMetrics,
    waccContext: companyContext.wacc_context ?? {},
    industryBenchmarks: companyContext.industry_benchmarks ?? {},
    modelingImplications: companyContext.modeling_implications ?? {
      keyForecastDrivers: "",
      wcDrivers: "",
      capexBehavior: "",
      marginStructure: "",
      valuationWatchouts: "",
    },
    workingCapitalProfile: profile.working_capital_profile ?? "medium",
    marginProfile: profile.margin_profile ?? "mixed",
    capexProfile: profile.capex_profile ?? "moderate",
    confidence: companyContext.confidence,
    shortBusinessDescription: u.shortBusinessDescription?.trim() ?? "",
    hasGeneratedContext: companyContext.generatedAt != null,
  };
}

/**
 * Build a short, LLM-friendly summary of the company modeling context for injection into classification prompts.
 * Use this so AI suggestions are informed by company profile, peer set, and benchmarks without forcing one answer.
 */
export function getModelingContextSummaryForPrompt(profile: CompanyModelingProfile | null): string {
  if (!profile) return "";

  const parts: string[] = [];
  parts.push(`Company: ${profile.companyName || "Unset"}. ${profile.publicPrivate === "private" ? "Private company; use proxy peers for benchmarks." : "Public."}`);
  if (profile.headquartersCountry) parts.push(`HQ: ${profile.headquartersCountry}.`);
  if (profile.industry) parts.push(`Industry: ${profile.industry}.`);
  if (profile.businessModelType) parts.push(`Business model: ${profile.businessModelType.replace(/_/g, " ")}.`);
  if (profile.benchmarkFamily) parts.push(`Benchmark family: ${profile.benchmarkFamily.replace(/_/g, " ")}.`);
  if (profile.revenueModel) parts.push(`Revenue model: ${profile.revenueModel.replace(/_/g, " ")}.`);
  if (profile.workingCapitalProfile) parts.push(`Working capital profile: ${profile.workingCapitalProfile}.`);
  if (profile.shortBusinessDescription) parts.push(`Description: ${profile.shortBusinessDescription.slice(0, 300)}.`);
  if (profile.acceptedComps.length > 0) {
    parts.push(`Accepted comp set (${profile.acceptedComps.length}): ${profile.acceptedComps.map((c) => c.companyName || c.ticker).filter(Boolean).join(", ")}.`);
  }
  if (profile.modelingImplications.wcDrivers) parts.push(`WC context: ${profile.modelingImplications.wcDrivers.slice(0, 200)}.`);
  if (profile.modelingImplications.keyForecastDrivers) parts.push(`Forecast drivers: ${profile.modelingImplications.keyForecastDrivers.slice(0, 200)}.`);

  return parts.join(" ");
}

/**
 * Optional reasoning string when a suggestion is driven by company context (for display).
 * Use for fallback or AI suggestions: "Suggested because ..." to make the system feel transparent.
 */
export function getSuggestionReasoningFromContext(
  profile: CompanyModelingProfile | null,
  kind: "is_classification" | "cf_classification" | "projection"
): string | undefined {
  if (!profile?.hasGeneratedContext) return undefined;

  const business = profile.businessModelType?.replace(/_/g, " ") || "";
  const benchmark = profile.benchmarkFamily?.replace(/_/g, " ") || "";
  const wc = profile.workingCapitalProfile;

  if (kind === "is_classification") {
    if (profile.revenueModel === "subscription" || business.includes("saas") || business.includes("software")) {
      return "Suggested from SaaS-style revenue model and subscription/deferred-revenue pattern.";
    }
    if (business.includes("wholesale") || business.includes("distribution") || business.includes("consumer_staples")) {
      return "Suggested because this looks like a wholesale/distribution business with inventory-heavy working capital.";
    }
    if (benchmark) return `Suggested due to selected benchmark family (${benchmark}).`;
    if (profile.acceptedComps.length > 0) {
      return "Suggested because accepted comp set implies similar operating structure.";
    }
  }

  if (kind === "cf_classification") {
    if (wc === "high") return "Suggested because accepted comp set implies inventory-heavy working capital.";
    if (wc === "low" && (business.includes("saas") || business.includes("software"))) {
      return "Suggested from SaaS-style model; working capital typically low, deferred revenue relevant.";
    }
    if (profile.modelingImplications.wcDrivers) {
      return "Suggested from company WC drivers and peer profile.";
    }
  }

  if (kind === "projection") {
    if (benchmark) return `Suggested due to benchmark family (${benchmark}) and typical forecast drivers.`;
    if (profile.compDerivedMetrics?.source === "accepted_comps") {
      return "Suggested from comp-derived metrics and benchmark ranges.";
    }
  }

  return undefined;
}

/**
 * Projection scaffolding: defaults and hints derived from CompanyModelingProfile for use by
 * the projection engine (Phase 2). Not a full implementation — provides suggested methods,
 * benchmark ranges, and WACC/DCF warnings so the same profile drives forecasting later.
 */
export interface ProjectionDefaultsFromProfile {
  /** Suggested primary revenue forecast approach (e.g. "pct_growth", "days_based", "manual"). */
  suggestedRevenueMethod: "pct_growth" | "days_based" | "manual" | "schedule_driven";
  /** Suggested capex approach. */
  suggestedCapexMethod: "pct_revenue" | "manual" | "growth";
  /** Working capital intensity hint for WC schedule (low / medium / high). */
  wcIntensityHint: "low" | "medium" | "high";
  /** Whether to use industry/comp benchmark ranges for sanity checks. */
  useBenchmarkRanges: boolean;
  /** Optional WACC/DCF warning from profile (e.g. "Use regional comps for beta; country risk premium"). */
  dcfWaccWarning: string | undefined;
  /** Percent-of-revenue vs days-based hint for WC (e.g. "DIO/DPO typical for distribution"). */
  wcForecastHint: string | undefined;
  /** Benchmark family for range lookups. */
  benchmarkFamily: string;
}

export function getProjectionDefaultsFromProfile(profile: CompanyModelingProfile | null): ProjectionDefaultsFromProfile | null {
  if (!profile) return null;
  const business = profile.businessModelType ?? "";
  const wc = profile.workingCapitalProfile ?? "medium";
  const implications = profile.modelingImplications;
  const hasComps = (profile.compDerivedMetrics?.source === "accepted_comps") && (profile.compDerivedMetrics?.withDataCount ?? 0) > 0;

  let suggestedRevenueMethod: ProjectionDefaultsFromProfile["suggestedRevenueMethod"] = "pct_growth";
  let suggestedCapexMethod: ProjectionDefaultsFromProfile["suggestedCapexMethod"] = "pct_revenue";
  let wcIntensityHint: ProjectionDefaultsFromProfile["wcIntensityHint"] = wc === "high" ? "high" : wc === "low" ? "low" : "medium";
  let wcForecastHint: string | undefined;

  if (business.includes("software") || business.includes("saas")) {
    suggestedRevenueMethod = "pct_growth";
    suggestedCapexMethod = "pct_revenue";
    wcForecastHint = "Deferred revenue and minimal inventory; DSO if relevant.";
  } else if (business.includes("wholesale") || business.includes("distribution")) {
    suggestedRevenueMethod = "pct_growth";
    wcForecastHint = "DIO/DPO typical for distribution; use days-based WC schedule.";
  } else if (business.includes("retail")) {
    suggestedCapexMethod = "pct_revenue";
    wcForecastHint = "Inventory days and store capex; days-based for WC.";
  } else if (business.includes("industrial")) {
    suggestedCapexMethod = "pct_revenue";
    wcForecastHint = "Capex and D&A schedules; DIO/DSO/DPO for WC.";
  }

  const dcfWaccWarning =
    implications.valuationWatchouts?.slice(0, 200) ??
    (profile.waccContext.waccContextBasis ? undefined : "Set WACC context for DCF.");

  return {
    suggestedRevenueMethod,
    suggestedCapexMethod,
    wcIntensityHint,
    useBenchmarkRanges: hasComps || (profile.industryBenchmarks?.revenueGrowthMin != null),
    dcfWaccWarning,
    wcForecastHint,
    benchmarkFamily: profile.benchmarkFamily ?? "",
  };
}

/**
 * Revenue forecast v1: suggest role, method, and reason per revenue row from CompanyModelingProfile.
 * Used in Forecast Drivers → Revenue to prefill or show "Suggested: ...". Does not force the user.
 */
export interface RevenueForecastSuggestionV1 {
  role: "independent_driver" | "derived_sum" | "allocation_of_parent";
  method?: "growth_rate" | "fixed_value";
  reason: string;
}

export function getRevenueForecastSuggestionsFromProfile(
  profile: CompanyModelingProfile | null,
  revRowId: string,
  isTotalRev: boolean,
  isTopLevelStream: boolean,
  hasChildren: boolean
): RevenueForecastSuggestionV1 | null {
  if (!profile) return null;

  const business = (profile.businessModelType ?? "").toLowerCase();
  const revenueModel = (profile.revenueModel ?? "").toLowerCase();

  if (isTotalRev) {
    return { role: "derived_sum", reason: "Total Revenue is always the sum of streams." };
  }

  if (isTopLevelStream) {
    // Stable diversified business → independent_driver + growth_rate
    if (business.includes("diversified") || business.includes("conglomerate")) {
      return {
        role: "independent_driver",
        method: "growth_rate",
        reason: "Diversified business: forecast each stream independently with growth rate.",
      };
    }
    // Detailed segment splits (e.g. multiple segments) → can be derived_sum with independent children
    if (hasChildren && (business.includes("segment") || revenueModel.includes("multi"))) {
      return {
        role: "derived_sum",
        reason: "Segment mix: total stream as sum of child segments.",
      };
    }
    // Parent with brand/channel mix → independent_driver parent + allocation children
    if (hasChildren && (business.includes("retail") || business.includes("channel") || revenueModel.includes("subscription"))) {
      return {
        role: "independent_driver",
        method: "growth_rate",
        reason: "Forecast stream total with growth; allocate to children by share.",
      };
    }
    // Default: independent_driver + growth_rate
    return {
      role: "independent_driver",
      method: "growth_rate",
      reason: "Stable revenue stream: use growth rate from last historic year.",
    };
  }

  // Child of a stream
  return {
    role: "allocation_of_parent",
    reason: "Child line: set allocation % of parent stream.",
  };
}
