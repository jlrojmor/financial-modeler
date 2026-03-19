# Growth phases (Revenue Forecast v1)

## Storage

- `growthPatternType`: `"constant"` | `"phases"` | `"by_year"`
- Phased rows: `growthPhases: { startYear, endYear, ratePercent }[]` plus `ratePercent` (first projection year’s rate, for validation/display).
- No separate projection path: the engine calls `expandPhasesToRatesByYear` then uses the same per-year growth loop as by-year.

## Mode switching (UI draft state)

| From → To | Behavior |
|-----------|----------|
| Constant → Phases | One phase covering full projection range, seeded with current constant %. |
| By year → Phases | One full-range phase seeded with the **first projection year’s** by-year rate (fallback: constant %). |
| Phases → By year | If phases validate, rates copied per year; else by-year fields default to constant %. |
| Phases ↔ Constant | Local phase rows stay in memory when switching away until **Reset** (reload from saved config) or **Apply** commits. |
