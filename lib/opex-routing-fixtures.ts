import type { OpExRouteStatusV1 } from "@/types/opex-forecast-v1";
import { routeOpExLineDeterministic } from "@/lib/opex-routing-deterministic";

/**
 * Label-level expectations for the deterministic OpEx router (Phase 1 hardening).
 * Optional dev check: `verifyOpexDeterministicLabelFixtures()` after changing rules.
 */
export const OPEX_DETERMINISTIC_LABEL_FIXTURES: Array<{
  label: string;
  expectedRoute: OpExRouteStatusV1;
  note?: string;
}> = [
  { label: "Selling, General & Administrative", expectedRoute: "forecast_direct" },
  { label: "Corporate overhead and admin costs", expectedRoute: "forecast_direct" },
  { label: "Payroll and benefits", expectedRoute: "review_required" },
  { label: "Software and subscriptions", expectedRoute: "forecast_direct" },
  { label: "Rent and occupancy", expectedRoute: "forecast_direct" },
  { label: "Professional fees", expectedRoute: "forecast_direct" },
  { label: "Marketing and promotion", expectedRoute: "forecast_direct" },
  { label: "Other operating expense", expectedRoute: "review_required" },
  { label: "Operating expense, net", expectedRoute: "review_required" },
  { label: "Admin and other", expectedRoute: "review_required" },
  { label: "Depreciation", expectedRoute: "derive_schedule" },
  { label: "Depreciation and amortization", expectedRoute: "derive_schedule" },
  { label: "Amortization of intangible assets", expectedRoute: "derive_schedule" },
  { label: "Stock-based compensation", expectedRoute: "derive_schedule" },
  { label: "Restructuring costs", expectedRoute: "excluded_nonrecurring" },
  { label: "Goodwill impairment", expectedRoute: "excluded_nonrecurring" },
  { label: "Litigation settlement", expectedRoute: "excluded_nonrecurring" },
  { label: "Acquisition-related expenses", expectedRoute: "excluded_nonrecurring" },
  { label: "Interest expense", expectedRoute: "derive_schedule" },
  { label: "Interest income", expectedRoute: "derive_schedule" },
  { label: "Other income (expense), net", expectedRoute: "derive_schedule" },
];

export function verifyOpexDeterministicLabelFixtures(): void {
  for (const row of OPEX_DETERMINISTIC_LABEL_FIXTURES) {
    const got = routeOpExLineDeterministic(row.label);
    if (got.route !== row.expectedRoute) {
      throw new Error(
        `[opex fixture] "${row.label}" → expected ${row.expectedRoute}, got ${got.route} (${got.ruleId})`
      );
    }
  }
}
