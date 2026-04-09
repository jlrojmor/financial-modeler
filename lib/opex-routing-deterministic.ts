import type { OpExLinkedFutureScheduleTypeV1, OpExRouteStatusV1 } from "@/types/opex-forecast-v1";

export type DeterministicOpExRouteResult = {
  route: OpExRouteStatusV1;
  ruleId: string;
  linkedFutureScheduleType?: OpExLinkedFutureScheduleTypeV1;
  /** 0–100 for UI; schedule/non-recurring hits typically high; default direct moderate; review lower-medium */
  confidencePct: number;
  /** Stable bucket name for display / AI alignment */
  normalizedCategory: string;
  /** Short banker-grade reason shown in UI */
  explanation: string;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

type PatternRule = {
  route: OpExRouteStatusV1;
  ruleId: string;
  re: RegExp;
  normalizedCategory: string;
  explanation: string;
  confidencePct: number;
  linkedFutureScheduleType?: OpExLinkedFutureScheduleTypeV1;
};

type SchedulePatternRule = PatternRule & { link: OpExLinkedFutureScheduleTypeV1 };

function hit(
  route: OpExRouteStatusV1,
  ruleId: string,
  normalizedCategory: string,
  explanation: string,
  confidencePct: number,
  linkedFutureScheduleType?: OpExLinkedFutureScheduleTypeV1
): DeterministicOpExRouteResult {
  return {
    route,
    ruleId,
    normalizedCategory,
    explanation,
    confidencePct,
    ...(linkedFutureScheduleType !== undefined ? { linkedFutureScheduleType } : {}),
  };
}

/**
 * Ordered rules: first match wins.
 * Conservative: ambiguous / broad “other” / multi-concept → review_required before generic direct.
 * Phase 1 scope: only operating-expense tree lines; interest/tax/other income routed away if mis-placed under OpEx.
 * Label expectations: see `lib/opex-routing-fixtures.ts` (`verifyOpexDeterministicLabelFixtures`).
 */
export function routeOpExLineDeterministic(label: string): DeterministicOpExRouteResult {
  const n = norm(label);

  // ─── D) Excluded / non-recurring / unusual (high confidence) ───
  const nonRecurring: PatternRule[] = [
    {
      route: "excluded_nonrecurring",
      ruleId: "nr_restructuring",
      normalizedCategory: "non_recurring",
      explanation: "Restructuring charges are typically non-recurring; exclude from normalized OpEx.",
      confidencePct: 92,
      re: /\b(restructuring|reorganization)\b/,
    },
    {
      route: "excluded_nonrecurring",
      ruleId: "nr_impairment",
      normalizedCategory: "non_recurring",
      explanation: "Impairment or write-down language indicates a non-recurring or non-cash charge.",
      confidencePct: 90,
      re: /\b(impairment|goodwill write[- ]?down|asset write[- ]?down|write[- ]?down of|writeoff|write[- ]?off)\b/,
    },
    {
      route: "excluded_nonrecurring",
      ruleId: "nr_litigation",
      normalizedCategory: "non_recurring",
      explanation: "Litigation or settlement items are usually episodic, not run-rate OpEx.",
      confidencePct: 88,
      re: /\b(litigation|settlement|legal settlement|contingenc(y|ies))\b/,
    },
    {
      route: "excluded_nonrecurring",
      ruleId: "nr_severance",
      normalizedCategory: "non_recurring",
      explanation: "Severance and related workforce actions are typically one-time or episodic.",
      confidencePct: 88,
      re: /\b(severance|termination benefit|workforce reduction)\b/,
    },
    {
      route: "excluded_nonrecurring",
      ruleId: "nr_acquisition",
      normalizedCategory: "non_recurring",
      explanation: "Acquisition- or transaction-related costs are usually non-recurring.",
      confidencePct: 90,
      re: /\b(acquisition[- ]related|m and a|m&a cost|purchase accounting|integration cost|deal cost)\b/,
    },
    {
      route: "excluded_nonrecurring",
      ruleId: "nr_transaction",
      normalizedCategory: "non_recurring",
      explanation: "Transaction or offering costs are typically non-recurring.",
      confidencePct: 87,
      re: /\b(transaction cost|ipo cost|offering cost|financing cost)\b/,
    },
    {
      route: "excluded_nonrecurring",
      ruleId: "nr_onetime",
      normalizedCategory: "non_recurring",
      explanation: "Explicitly flagged one-time, unusual, or special charges are excluded from run-rate OpEx.",
      confidencePct: 86,
      re: /\b(one[- ]time|unusual item|special item|extraordinary|non[- ]recurring)\b/,
    },
    {
      route: "excluded_nonrecurring",
      ruleId: "nr_disposal",
      normalizedCategory: "non_recurring",
      explanation: "Gain/loss on disposal is typically non-operating or non-recurring in nature.",
      confidencePct: 85,
      re: /\b(gain|loss)\s+on\s+disposal|disposal of|divestiture\b/,
    },
  ];
  for (const row of nonRecurring) {
    if (row.re.test(n)) {
      return hit(
        row.route,
        row.ruleId,
        row.normalizedCategory,
        row.explanation,
        row.confidencePct,
        row.linkedFutureScheduleType
      );
    }
  }

  // ─── B) Schedule-derived (not Phase 1 direct forecast) ───
  const schedule: SchedulePatternRule[] = [
    {
      route: "derive_schedule",
      ruleId: "sch_da_combined",
      link: "depreciation_amortization",
      normalizedCategory: "depreciation_amortization",
      explanation: "Combined depreciation and amortization is normally tied to asset schedules.",
      confidencePct: 94,
      re: /\bdepreciation\b.*\bamortization\b|\bamortization\b.*\bdepreciation\b/,
    },
    {
      route: "derive_schedule",
      ruleId: "sch_depreciation",
      link: "depreciation_amortization",
      normalizedCategory: "depreciation",
      explanation: "Depreciation is typically schedule-driven from PP&E.",
      confidencePct: 93,
      re: /\bdepreciation\b/,
    },
    {
      route: "derive_schedule",
      ruleId: "sch_amortization",
      link: "depreciation_amortization",
      normalizedCategory: "amortization",
      explanation: "Amortization (including intangibles) is normally schedule-driven.",
      confidencePct: 92,
      re: /\bamortization\b|\bamort\.?\b(?!\s+of\s+debt)/,
    },
    {
      route: "derive_schedule",
      ruleId: "sch_amort_intangibles",
      link: "depreciation_amortization",
      normalizedCategory: "amortization_intangibles",
      explanation: "Amortization of intangible assets is tied to intangible / M&A schedules.",
      confidencePct: 93,
      re: /\bamortization of intangible|intangible amortization\b/,
    },
    {
      route: "derive_schedule",
      ruleId: "sch_da_abbr",
      link: "depreciation_amortization",
      normalizedCategory: "depreciation_amortization",
      explanation: "D&A notation maps to depreciation and amortization schedules.",
      confidencePct: 91,
      re: /\bd\s*&\s*a\b|\bd\s+and\s+a\b/,
    },
    {
      route: "derive_schedule",
      ruleId: "sch_sbc",
      link: "stock_compensation",
      normalizedCategory: "stock_based_compensation",
      explanation: "Stock-based compensation is usually modeled via equity / non-cash schedules, not direct OpEx growth.",
      confidencePct: 90,
      re: /\bstock[- ]based compensation|share[- ]based compensation|equity[- ]based compensation\b/,
    },
    {
      route: "derive_schedule",
      ruleId: "sch_sbc_abbr",
      link: "stock_compensation",
      normalizedCategory: "stock_based_compensation",
      explanation: "SBC abbreviation indicates stock-based comp — defer to schedule treatment.",
      confidencePct: 85,
      re: /(^|\s)sbc(\s|$)/i,
    },
    {
      route: "derive_schedule",
      ruleId: "sch_lease_rou",
      link: "leases_financing",
      normalizedCategory: "leases",
      explanation: "Right-of-use / ROU lease expense is typically lease-schedule driven.",
      confidencePct: 88,
      re: /\b(right[- ]of[- ]use|rou asset|rou expense|asc 842|ifrs 16)\b/,
    },
    {
      route: "derive_schedule",
      ruleId: "sch_interest_exp",
      link: "interest",
      normalizedCategory: "interest_expense",
      explanation: "Interest expense is below-the-line / debt schedule — not Phase 1 operating expense forecast.",
      confidencePct: 95,
      re: /\binterest expense\b|\binterest cost\b/,
    },
    {
      route: "derive_schedule",
      ruleId: "sch_interest_inc",
      link: "interest",
      normalizedCategory: "interest_income",
      explanation: "Interest income is non-operating / treasury — not direct OpEx.",
      confidencePct: 95,
      re: /\binterest income\b/,
    },
    {
      route: "derive_schedule",
      ruleId: "sch_interest_net",
      link: "interest",
      normalizedCategory: "interest_net",
      explanation: "Net interest is financing-related; route away from Phase 1 OpEx.",
      confidencePct: 90,
      re: /\binterest,\s*net\b|\bnet interest\b/,
    },
    {
      route: "derive_schedule",
      ruleId: "sch_interest_only",
      link: "interest",
      normalizedCategory: "interest",
      explanation: "Standalone “interest” under OpEx is treated as financing-related pending schedules.",
      confidencePct: 78,
      re: /^interest$/,
    },
    {
      route: "derive_schedule",
      ruleId: "sch_other_income_expense",
      link: "other_schedule",
      normalizedCategory: "other_income_expense",
      explanation: "Other income/expense (net) is non-core operating; not Phase 1 OpEx direct forecast.",
      confidencePct: 82,
      re: /\bother income\b|\bother expense\b|other income\s*\(\s*expense\s*\)|other\s+income\s*\(\s*expense\s*\)|other\s*\(income\)\s*expense/i,
    },
    {
      route: "derive_schedule",
      ruleId: "sch_income_tax",
      link: "tax",
      normalizedCategory: "income_tax",
      explanation: "Income tax is tax-module / EBT — not operating expense direct forecast.",
      confidencePct: 95,
      re: /\b(income tax|tax provision|tax expense|provision for income taxes|current tax|deferred tax)\b/,
    },
  ];
  for (const row of schedule) {
    if (row.re.test(n)) {
      return hit(
        row.route,
        row.ruleId,
        row.normalizedCategory,
        row.explanation,
        row.confidencePct,
        row.link
      );
    }
  }

  // ─── D) Ambiguous / review (before broad direct families) ───
  const review: PatternRule[] = [
    {
      route: "review_required",
      ruleId: "rv_other_opex",
      normalizedCategory: "ambiguous_other",
      explanation: "Broad “other operating” labels often mix recurring and non-recurring items.",
      confidencePct: 55,
      re: /\bother operating expense\b|\bmiscellaneous operating\b|\boperating misc\b/,
    },
    {
      route: "review_required",
      ruleId: "rv_opex_net",
      normalizedCategory: "ambiguous_net",
      explanation: "“Operating expense, net” is compressed and may bundle multiple natures.",
      confidencePct: 52,
      re: /\boperating expense,\s*net\b|\boperating costs?,\s*net\b/,
    },
    {
      route: "review_required",
      ruleId: "rv_admin_other",
      normalizedCategory: "ambiguous_admin",
      explanation: "“Admin and other” / corporate-other buckets are often mixed-cost.",
      confidencePct: 54,
      re: /\badmin and other\b|\bcorporate and other\b|\bgeneral corporate\b|\bcorporate other\b/,
    },
    {
      route: "review_required",
      ruleId: "rv_mixed_and",
      normalizedCategory: "ambiguous_mixed",
      explanation: "Label combines multiple cost themes; confirm treatment before direct forecast.",
      confidencePct: 50,
      re: /\band\b.*\band\b.*\band\b/,
    },
    {
      route: "review_required",
      ruleId: "rv_payroll_and_benefits",
      normalizedCategory: "mixed_payroll_benefits",
      explanation: "Payroll and benefits together can include variable vs fixed components — confirm method.",
      confidencePct: 62,
      re: /\bpayroll\b.*\bbenefits\b|\bbenefits\b.*\bpayroll\b/,
    },
    {
      route: "review_required",
      ruleId: "rv_rent_occupancy_util",
      normalizedCategory: "mixed_facilities",
      explanation: "Rent or occupancy bundled with utilities (or triple buckets) may warrant split drivers — review.",
      confidencePct: 58,
      re: /\brent\b.*\butilities\b|\boccupancy\b.*\butilities\b|\butilities\b.*\brent\b|\butilities\b.*\boccupancy\b|\brent\b.*\boccupancy\b.*\butilities\b|\brent\b.*\butilities\b.*\boccupancy\b/,
    },
  ];
  for (const row of review) {
    if (row.re.test(n)) {
      return hit(
        row.route,
        row.ruleId,
        row.normalizedCategory,
        row.explanation,
        row.confidencePct,
        row.linkedFutureScheduleType
      );
    }
  }

  // ─── A) Recurring OpEx — direct forecast families ───
  const directFamilies: PatternRule[] = [
    {
      route: "forecast_direct",
      ruleId: "fd_sga_banner",
      normalizedCategory: "sga",
      explanation: "Classic SG&A-style banner; treat as recurring operating overhead.",
      confidencePct: 82,
      re: /\bsg\s*&\s*a\b|\bselling,?\s+general\b|\bgeneral and administrative\b|\bg&a\b/,
    },
    {
      route: "forecast_direct",
      ruleId: "fd_payroll_hr",
      normalizedCategory: "payroll",
      explanation: "Payroll, wages, or compensation language suggests recurring people cost.",
      confidencePct: 80,
      re: /\b(salary|salaries|wage|wages|payroll|compensation|employee[- ]related|headcount cost)\b/,
    },
    {
      route: "forecast_direct",
      ruleId: "fd_benefits_bonus",
      normalizedCategory: "benefits",
      explanation: "Benefits or bonus language is typically recurring employment cost.",
      confidencePct: 76,
      re: /\b(benefits?|bonus|bonuses|incentive comp|commissions?)\b/,
    },
    {
      route: "forecast_direct",
      ruleId: "fd_marketing",
      normalizedCategory: "marketing",
      explanation: "Marketing / advertising / demand-gen language scales with go-to-market.",
      confidencePct: 78,
      re: /\b(marketing|advertis|advertisement|promotion|demand gen|demand generation|brand)\b/,
    },
    {
      route: "forecast_direct",
      ruleId: "fd_software_it",
      normalizedCategory: "software_it",
      explanation: "Software, SaaS, cloud, or IT spend is typically recurring OpEx.",
      confidencePct: 78,
      re: /\b(software|saas|subscriptions?|license fees?|cloud|it expense|information technology|hosting)\b/,
    },
    {
      route: "forecast_direct",
      ruleId: "fd_rent_occ",
      normalizedCategory: "facilities",
      explanation: "Rent, occupancy, or facilities cost is recurring overhead.",
      confidencePct: 78,
      re: /\b(rent|occupancy|facilities|lease expense|real estate expense)\b/,
    },
    {
      route: "forecast_direct",
      ruleId: "fd_util_maint",
      normalizedCategory: "utilities_maintenance",
      explanation: "Utilities or maintenance is typically recurring site cost.",
      confidencePct: 74,
      re: /\b(utilities|utility|maintenance|repairs?)\b/,
    },
    {
      route: "forecast_direct",
      ruleId: "fd_office_admin",
      normalizedCategory: "office_admin",
      explanation: "Office or corporate overhead language maps to recurring G&A.",
      confidencePct: 72,
      re: /\b(office expense|office admin|corporate overhead|administrative expense|overhead)\b/,
    },
    {
      route: "forecast_direct",
      ruleId: "fd_insurance",
      normalizedCategory: "insurance",
      explanation: "Insurance is typically recurring OpEx.",
      confidencePct: 76,
      re: /\binsurance\b/,
    },
    {
      route: "forecast_direct",
      ruleId: "fd_travel_ent",
      normalizedCategory: "travel_entertainment",
      explanation: "Travel, meals, or entertainment is usually recurring SG&A.",
      confidencePct: 72,
      re: /\b(travel|meals|entertainment|t&e)\b/,
    },
    {
      route: "forecast_direct",
      ruleId: "fd_professional",
      normalizedCategory: "professional_fees",
      explanation: "Professional, legal, audit, or consulting fees are recurring OpEx (run-rate).",
      confidencePct: 74,
      re: /\b(professional fees?|legal fees?|audit fees?|consulting|advisory fees?)\b/,
    },
    {
      route: "forecast_direct",
      ruleId: "fd_rd",
      normalizedCategory: "research_development",
      explanation: "R&D or product development (OpEx) is typically forecast directly.",
      confidencePct: 80,
      re: /\b(research and development|r\s*&\s*d\b|\br&d\b|product development)\b/,
    },
  ];
  for (const row of directFamilies) {
    if (row.re.test(n)) {
      return hit(
        row.route,
        row.ruleId,
        row.normalizedCategory,
        row.explanation,
        row.confidencePct,
        row.linkedFutureScheduleType
      );
    }
  }

  // Default: allow direct forecast with moderate confidence; user/AI can refine
  return hit(
    "forecast_direct",
    "default_forecast_direct",
    "unclassified_operating",
    "No high-certainty rule matched; defaulting to direct forecast — review or run AI if ambiguous.",
    58
  );
}
