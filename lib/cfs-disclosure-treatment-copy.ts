/**
 * Shared copy for Cash flow disclosure: treatment overrides and Projected Statements traceability.
 * Keep in sync with docs/CFS-PROJECTION-DISCLOSURE-PRINCIPLES.md (high level).
 */

export const CFS_DISCLOSURE_TREATMENT_LEGEND = [
  {
    title: "Flat to last actual",
    body: "Projection years use the last historical value on this same CFS line. Stored as flat_last_historical; preview and Excel write-through match.",
  },
  {
    title: "% of revenue",
    body: "Each projection year = (pct ÷ 100) × forecast revenue. Stored as pct_of_revenue.",
  },
  {
    title: "Zero",
    body: "Forces 0 in all projection years.",
  },
  {
    title: "Exclude (rollup)",
    body: "0 in the model; optional hide from rolled-up CFS preview when enabled.",
  },
  {
    title: "Manual by year",
    body: "You enter each projection year; values stored on the policy.",
  },
  {
    title: "Map to balance sheet / Use IS bridge (Historicals)",
    body:
      "Not a numeric policy from this tab. Link the CFS row in Historicals so classification moves off disclosure-only; then the engine bridges.",
  },
] as const;
