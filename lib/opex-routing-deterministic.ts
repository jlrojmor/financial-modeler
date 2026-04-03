import type { OpExLinkedFutureScheduleTypeV1, OpExRouteStatusV1 } from "@/types/opex-forecast-v1";

export type DeterministicOpExRouteResult = {
  route: OpExRouteStatusV1;
  ruleId: string;
  linkedFutureScheduleType?: OpExLinkedFutureScheduleTypeV1;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ordered rules: first match wins. Conservative on ambiguous / mixed labels → review.
 */
export function routeOpExLineDeterministic(label: string): DeterministicOpExRouteResult {
  const n = norm(label);

  const nonRecurring: Array<{ re: RegExp; id: string }> = [
    { re: /\brestructuring\b/, id: "nr_restructuring" },
    { re: /\bimpairment\b/, id: "nr_impairment" },
    { re: /\blitigation\b/, id: "nr_litigation" },
    { re: /\bseverance\b/, id: "nr_severance" },
    { re: /\bacquisition[- ]related\b/, id: "nr_acquisition" },
    { re: /\btransaction cost\b/, id: "nr_transaction" },
    { re: /\bone[- ]time\b/, id: "nr_onetime" },
    { re: /\bunusual\b/, id: "nr_unusual" },
    { re: /\bmerger\b/, id: "nr_merger" },
  ];
  for (const { re, id } of nonRecurring) {
    if (re.test(n)) {
      return { route: "excluded_nonrecurring", ruleId: id };
    }
  }

  const schedule: Array<{ re: RegExp; id: string; link: OpExLinkedFutureScheduleTypeV1 }> = [
    { re: /\bdepreciation\b/, id: "sch_depreciation", link: "depreciation_amortization" },
    { re: /\bamortization\b/, id: "sch_amortization", link: "depreciation_amortization" },
    { re: /\bd\s*&\s*a\b/, id: "sch_da", link: "depreciation_amortization" },
    { re: /\bd\s+and\s+a\b/, id: "sch_da_words", link: "depreciation_amortization" },
    { re: /\binterest expense\b/, id: "sch_interest_exp", link: "interest" },
    { re: /\binterest income\b/, id: "sch_interest_inc", link: "interest" },
    { re: /\binterest,\s*net\b/, id: "sch_interest_net", link: "interest" },
    { re: /\bincome tax\b/, id: "sch_income_tax", link: "tax" },
    { re: /\btax provision\b/, id: "sch_tax_prov", link: "tax" },
    { re: /\btax expense\b/, id: "sch_tax_exp", link: "tax" },
    { re: /\bprovision for income taxes\b/, id: "sch_fit", link: "tax" },
    { re: /\bstock[- ]based compensation\b/, id: "sch_sbc", link: "stock_compensation" },
    { re: /\bsbc\b/, id: "sch_sbc_abbr", link: "stock_compensation" },
    { re: /\bshare[- ]based compensation\b/, id: "sch_share_based", link: "stock_compensation" },
  ];
  for (const { re, id, link } of schedule) {
    if (re.test(n)) {
      return { route: "derive_schedule", ruleId: id, linkedFutureScheduleType: link };
    }
  }

  const review: Array<{ re: RegExp; id: string }> = [
    { re: /\bother operating expense\b/, id: "rv_other_opex" },
    { re: /\boperating expense,\s*net\b/, id: "rv_opex_net" },
    { re: /\bgeneral corporate\b/, id: "rv_gen_corp" },
    { re: /\badmin and other\b/, id: "rv_admin_other" },
    { re: /\bmiscellaneous\b/, id: "rv_misc" },
    { re: /\band\b.*\band\b.*\band\b/, id: "rv_triple_and" },
  ];
  for (const { re, id } of review) {
    if (re.test(n)) {
      return { route: "review_required", ruleId: id };
    }
  }

  if (/\bdepreciation\b.*\bamortization\b|\bamortization\b.*\bdepreciation\b/.test(n)) {
    return {
      route: "derive_schedule",
      ruleId: "sch_da_combined",
      linkedFutureScheduleType: "depreciation_amortization",
    };
  }

  return { route: "forecast_direct", ruleId: "default_forecast_direct" };
}
