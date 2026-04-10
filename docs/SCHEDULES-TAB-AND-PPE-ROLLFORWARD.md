# Schedules Tab & PP&E Roll-Forward (Capex and Depreciation)

**Purpose:** Complete technical description of the **Schedules** wizard step, how it is wired in the app, and how the **PP&E roll-forward** (capital expenditures + depreciation) is built, what inputs it consumes, and how results flow to preview vs applied model state.

**Audience:** Engineers and power users who need an exact map from UI → store → pure functions → statements.

**Scope:** Current implementation as of the repo containing this file. Analysis describes behavior; it does not prescribe future product changes.

---

## 1. Where “Schedules” Lives vs “Forecast Drivers”

### 1.1 Wizard steps

In `types/finance.ts`, **`schedules`** is a distinct **`WizardStepId`**, listed **after** **`forecast_drivers`** in `WIZARD_STEPS`. Schedules is **not** a sub-tab inside Forecast Drivers.

| Step ID | Label (sidebar) | Left panel content (`components/builder-panel.tsx`) |
|---------|-----------------|-----------------------------------------------------|
| `forecast_drivers` | Forecast Drivers | `ForecastDriversShell` |
| `schedules` | Schedules | `SchedulesShell` |

The right-hand preview column switches with the step: on Forecast Drivers, `ISBuildPreview` is shown; on other steps including Schedules, `ExcelPreview` is typical (`app/(app)/page.tsx`).

### 1.2 Takeaway

When documentation or users say “under Forecast Drivers” in the sidebar, they usually mean **the next step below** Forecast Drivers, i.e. **Schedules**. The Schedules UI is implemented by **`SchedulesShell`**, not by a nested tab under Forecast Drivers.

---

## 2. Schedules Shell — Sub-Tabs and What Actually Renders

**File:** `components/schedules-shell.tsx`

### 2.1 Sub-tabs

| Sub-tab ID | Label | Rendered content |
|------------|--------|------------------|
| `wc` | Working Capital | `BalanceSheetBuilder` with `stepId="bs_build"` |
| `capex` | Capex & Depreciation | Same |
| `intangibles` | Intangibles & Amortization | Same |
| `debt` | Debt Schedule | Placeholder: “Debt Schedule — coming in Phase 2.” |

### 2.2 Critical behavior: sub-tab state does not filter the builder

For **Working Capital**, **Capex & Depreciation**, and **Intangibles**, the component is **always** `BalanceSheetBuilder stepId="bs_build"`. Local state `subTab` only chooses between:

- **Debt** → placeholder panel, or  
- **Anything else** → full BS Build experience.

**Implication:** Switching between WC, Capex, and Intangibles **does not** show a different page, scroll to a section, or hide other schedule cards. All three tabs present the **same** combined view: BS Build plus embedded schedule cards (see Section 3).

The file comment states this explicitly: WC, Capex, and Intangibles “are still in `BalanceSheetBuilder` (`bs_build`)” so schedules remain usable in one place.

---

## 3. Balance Sheet Builder (`bs_build`) — Where Schedules Appear

**File:** `components/balance-sheet-builder-unified.tsx`

### 3.1 When schedule sections show

- **`stepId === "historicals"`** — Historical BS only; **no** Working Capital or Capex & D&A schedule cards (comment: schedules are set up in the Schedules step).
- **`stepId === "bs_build"`** — “Balance Sheet Builder” mode: **shows** schedule cards **above** the main BS sections (Assets / Liabilities / Equity).

`showScheduleSection` is `stepId === "bs_build"`.

### 3.2 Order of schedule UI on the page

When `showScheduleSection` is true (and not on the historicals-only step):

1. Optional banner: forecasts preview-only until **Apply Forecasts to Model**; button calls `applyBsBuildProjectionsToModel()`.
2. **CF Treatment Check** (collapsible) — classify `cashFlowBehavior` for custom BS rows.
3. **`WorkingCapitalScheduleCard`** — WC drivers and projected balances.
4. **`CapexDaScheduleCard`** — Capex forecast, D&A / useful life, bucket allocation, Capex Allocation Helper, and **Intangibles & Amortization** (Section 3 of that card).

Then the full BS grid (current assets, non-current assets, etc.) follows.

### 3.3 Related modules (non–PP&E)

| Concern | Primary files |
|---------|----------------|
| Working capital schedule | `components/working-capital-schedule-card.tsx`, `lib/working-capital-schedule.ts` |
| Applying WC + PP&E + intangibles to stored BS/CFS | `store/useModelStore.ts` — `applyBsBuildProjectionsToModel` |
| Debt schedule | Not implemented (placeholder in `SchedulesShell` only) |

---

## 4. PP&E Roll-Forward — Problem Statement

The engine answers:

> Given **ending historical net PP&E**, a **path of total capex** by projection year, **useful life** (single or per bucket), and a **timing convention** for when new capex begins depreciating, what are **depreciation (as modeled)** and **ending PP&E** each projection year?

This is a **simplified** model: straight-line on **opening** balance plus straight-line on **new capex** with a first-year fraction, **not** a full asset ledger with multiple in-service dates per asset.

**Pure logic (no I/O, no store writes):** `lib/capex-da-engine.ts`.

---

## 5. Inputs the PP&E Engine Consumes

### 5.1 Historical anchors (row IDs are fixed)

Used inside `applyBsBuildProjectionsToModel` and mirrored conceptually in `CapexDaScheduleCard` for display:

| Input | Source | Row / field |
|-------|--------|-------------|
| Last historical year | `meta.years.historical` | Last element of the array |
| **Last historical PP&E** | `balanceSheet` | `row.id === "ppe"`, `values[lastHistYear]` |
| **Last historical Capex** | `cashFlow` | `row.id === "capex"`, `values[lastHistYear]` |

**Sign convention:** Cash flow statement stores **capex as negative** (outflow). The projection engine uses **`Math.abs(lastHistCapex)`** when seeding the **growth** method so growth is applied to a positive capex amount.

### 5.2 Projection-year revenue (for % of revenue capex)

- Built in `applyBsBuildProjectionsToModel` from the income statement **`rev`** row via `computeRowValue` (and aligned structure) for each projection year.
- Feeds `revenueByYear` on `CapexEngineInput` when method is `pct_revenue`.

### 5.3 Zustand state (forecast drivers)

| State key(s) | Role |
|--------------|------|
| `capexForecastMethod` | `"pct_revenue"` \| `"manual"` \| `"growth"` |
| `capexPctRevenue` | % of revenue per year when method is pct_revenue |
| `capexManualByYear` | Per-year total capex when method is manual |
| `capexGrowthPct` | YoY % when method is growth (chains from abs(lastHistCapex)) |
| `capexTimingConvention` | `"mid"` \| `"start"` \| `"end"` — first-year depreciation weight on **new** capex |
| `ppeUsefulLifeSingle` | Single useful life (years) when **not** using buckets |
| `capexSplitByBucket` | If true, use bucketed engine and per-bucket lives |
| `capexBucketAllocationPct` | Weight per bucket (non-land); normalized in engine |
| `ppeUsefulLifeByBucket` | Useful life per bucket when split is on |
| `capexHelperPpeByBucketByYear` | Optional helper grid (display units); used to derive **initial land balance** for bucketed mode |
| `capexCustomBucketIds`, `capexBucketLabels` | Extra buckets and labels |
| `meta.years.projection` | Ordered projection years |

### 5.4 Default buckets and lives

**File:** `lib/capex-defaults.ts`

- **`CAPEX_DEFAULT_BUCKET_IDS`** — e.g. `cap_b1` … `cap_b10` (Land, Buildings, Machinery, …).
- **`CAPEX_IB_DEFAULT_USEFUL_LIVES`** — Land and CIP = 0 (no depreciation in this model); other buckets have IB-style default years.
- **`CAPEX_HELPER_LAND_ID`** (`cap_b1`), **`CAPEX_HELPER_CIP_ID`** (`cap_b9`).
- **`isLegacyWrongUsefulLives`** — detects bad persisted lives so the UI can reset to defaults.

### 5.5 Historical diagnostics only (do not drive the engine)

**File:** `lib/capex-da-diagnostics.ts` — `computeCapexDiagnostics`

**Inputs:** `incomeStatement`, `balanceSheet`, `cashFlow`, `historicalYears`, optional `danaBreakdowns`.

Used by **`CapexDaScheduleCard`** Section 1 (“Historical Diagnostics”) to **guide** the user. It does **not** write schedule outputs into the projection engine.

---

## 6. Projected Total Capex by Year

**Function:** `computeProjectedCapexByYear` — `lib/capex-da-engine.ts`

| Method | Formula (conceptual) |
|--------|----------------------|
| `pct_revenue` | For each projection year `y`: `(revenueByYear[y] ?? 0) * (pctRevenue / 100)` |
| `manual` | `(manualByYear[y] ?? 0)` |
| `growth` | Start from `prevCapex = abs(lastHistCapex)`; each year `prevCapex * (1 + growthPct/100)`, then update `prevCapex` |

Output: **`capexByYear: Record<year, number>`** — always a **single total** series before bucket allocation.

---

## 7. Timing Convention (New Capex in Year One)

**Function:** `timingFactor` — `lib/capex-da-engine.ts`

| Convention | Factor | Meaning for new capex in the same year |
|------------|--------|----------------------------------------|
| `mid` | `0.5` | Half-year (half of full-year straight-line on that year’s additions) |
| `start` | `1` | Full year’s worth of depreciation on additions in the first year |
| `end` | `0` | No depreciation on additions until the next period (in this annual step model) |

This factor applies only to the **`capex * (factor / life)`** term, not to a separate mid-year convention on the opening balance (opening is fully depreciated at `begPPE / life`).

---

## 8. Aggregate (Non-Bucketed) PP&E Roll-Forward

**Function:** `computeCapexDaSchedule` — `lib/capex-da-engine.ts`

**Input type:** `CapexEngineInput` (includes `lastHistPPE`, `usefulLifeYears`, `timingConvention`, plus capex method fields).

**Per projection year:**

1. `capex = capexByYear[y]`
2. `life = max(0.5, usefulLifeYears)`
3. `depOnOpening = begPPE / life`
4. `depOnNew = capex * (factor / life)` where `factor = timingFactor(timingConvention)`
5. `danda = depOnOpening + depOnNew` (then clamped ≥ 0)
6. `endPPE = begPPE + capex - danda` (then clamped ≥ 0)
7. `begPPE` for next year = `endPPE`

**Outputs:** `{ capexByYear, dandaByYear, ppeByYear }`.

### 8.1 Effective useful life when buckets are enabled in the store but path is “single”

In `applyBsBuildProjectionsToModel`, when **`capexSplitByBucket`** is false, the store passes **`ppeUsefulLifeSingle`** (with a minimum life of 0.5 in the engine).

When **`capexSplitByBucket`** is true, the store does **not** use this aggregate path for PP&E; it uses the bucketed function (Section 9). A separate **`effectiveUsefulLife`** average is computed in the UI (`CapexDaScheduleCard`) for display/diagnostics-style use, not as the bucketed engine’s source of truth.

---

## 9. Bucketed PP&E Roll-Forward

**Function:** `computeCapexDaScheduleByBucket` — `lib/capex-da-engine.ts`

**Input type:** `CapexEngineInputBucketed`

### 9.1 Total capex

- **`totalCapexByYear`** is the same series as `computeProjectedCapexByYear` output (computed once in the store, then passed in).

### 9.2 Land bucket (`cap_b1`)

- **`initialLandBalance`** — from last historical year’s Land column in the Capex Helper (`capexHelperPpeByBucketByYear["cap_b1"][lastHistYear]`), converted with **`displayToStored`** in the store when building input.
- For every projection year: **Beginning = End = initialLandBalance**, **Capex = 0**, **D&A = 0**.
- Land is **not** allocated a share of total dollar capex in this engine.

### 9.3 Non-land buckets

- **`nonLandIds`** = all bucket IDs except `cap_b1`.
- **`allocationSumNonLand`** = sum of `allocationPct[id]` over non-land IDs, or **100** if zero (avoid divide-by-zero).
- **`depreciableOpening = max(0, lastHistPPE - initialLandBalance)`** — total opening PP&E net of land.
- For each non-land bucket `id`:
  - **`pct = (allocationPct[id] ?? 0) / allocationSumNonLand`**
  - **Opening balance for first projection year:** `beg = depreciableOpening * pct`
  - Each year: **`capex = totalCapexByYear[y] * pct`**
  - **`life = usefulLifeByBucket[id]`** (max with 0 in code); if `life <= 0`, **D&A = 0**
  - Else: same straight-line split as aggregate: `depOnOpening = beg / life`, `depOnNew = capex * (factor / life)`, `end = beg + capex - danda`, then roll `beg` to `end`.

### 9.4 Totals

- **`totalDandaByYear[y]`** — sum of bucket D&A.
- **`totalPpeByYear[y]`** — sum of bucket ending balances (includes land each year).

**Output:** `{ byBucket, totalCapexByYear, totalDandaByYear, totalPpeByYear }`.

---

## 10. Capex Da Schedule Card (UI)

**File:** `components/capex-da-schedule-card.tsx`

### 10.1 Top-level wrapper

- **`CollapsibleSection`** `sectionId="capex_da_schedule"`, title **“Capex & D&A Schedule”**.

### 10.2 Section 1 — Historical Diagnostics

- Calls **`computeCapexDiagnostics`** when IS/BS/CF and historical years exist.
- Tables / copy include:
  - Capex intensity (Capex % of revenue), recommended % (average of **last two** historical ratios), trend (↑/↓/→) if change &gt; 0.5 ppt.
  - Observed D&A from IS row **`danda`** and/or **`danaBreakdowns`**.
  - If no observed D&A: **implied D&A** from **`max(0, BegPP&E + Capex − EndPP&E)`** per historical year.
  - PP&E / revenue (and PP&E / COGS).
  - Intangibles / revenue (supports the intangibles subsection later).

### 10.3 Section 2 — Capex forecast setup

- Method select: % of revenue, manual by year, growth.
- Optional **Use categories (buckets)** — allocation % table, must sum to ~100%; custom buckets add/remove.
- **Timing convention** buttons: Mid-year, Start of period, End of period.

### 10.4 Section 3 — Depreciation / amortization setup

- Single useful life vs **per-bucket** lives (when categories on).
- **Capex Allocation Helper (optional):** user-entered **historical PP&E by bucket**; weights derived from **implied maintenance** `PPE_bucket / life` (not proportional to balance alone). Land/CIP inclusion toggles; **Apply weights to forecast Capex buckets** writes allocation %.
- **Intangibles & Amortization** (same section): additions method (% revenue, manual, % of capex), amortization life, optional historical amortization inputs, guidance from `lib/intangibles-guidance.ts`.

### 10.5 Section 4 — Schedule output (documentation vs code)

The card’s intro text references **four** sections including **“Schedule output.”** In the current source, the collapsible **Section 4** table of projected Beginning / Capex / D&A / Ending **is not present** in this file; the roll-forward numbers are consumed elsewhere (**Excel preview** and **apply** path below).

### 10.6 Store flag not used in engine

- **`capexForecastBucketsIndependently`** exists in the store and is subscribed in the card but **is not** referenced in `capex-da-engine.ts` or in the `applyBsBuildProjectionsToModel` capex branch as of this audit. Treat as reserved / future unless wired later.

---

## 11. Where Results Appear: Excel Preview vs Apply

### 11.1 Excel preview

**File:** `components/excel-preview.tsx`

- Rebuilds the same **`computeProjectedCapexByYear`**, **`computeCapexDaSchedule`**, and **`computeCapexDaScheduleByBucket`** inputs/outputs (see grep targets `capexScheduleOutput`, `totalDandaByYear`, `ppeByYear`).
- Shows projected **capex**, **D&A**, and **PP&E** (and bucket totals when applicable) for projection columns even **before** the user clicks Apply.

### 11.2 Apply Forecasts to Model

**Function:** `applyBsBuildProjectionsToModel` — `store/useModelStore.ts`

**Balance sheet writes (projection years only):**

| Row ID | Source |
|--------|--------|
| WC items | `computeWcProjectedBalances` for IDs in `getWcScheduleItems` |
| `ppe` | `ppeByYear` from aggregate schedule **or** `totalPpeByYear` from bucketed schedule |
| `intangible_assets` | `computeIntangiblesAmortSchedule` when `capexModelIntangibles` and amort life &gt; 0 |

**Historical years** for these rows are **not** overwritten by this action.

**PP&E row metadata on apply:** `scheduleOwner` defaults toward **`"capex"`**, `cashFlowBehavior` toward **`"investing"`** if unset.

**Income statement `danda`:** The capex engine **does** compute **`dandaByYear`** / **`totalDandaByYear`**, and the **Excel preview** can show schedule-based D&A in projection columns. **`applyBsBuildProjectionsToModel` does not write those values into the IS `danda` row** in the excerpted flow: apply focuses on pushing **BS** PP&E (and intangibles) and then **recomputing** BS totals and CFS via `recomputeCalculations`. Any link from schedule D&A to IS/CFS in projection depends on existing formula/recompute behavior and preview overrides, not on a direct “write danda from engine” step in that function.

**After BS update:** The store loops projection years and recomputes **cashFlow** so items like **Δ working capital** and **operating cash flow** reflect new BS balances.

---

## 12. Intangibles (Same Card, Separate Engine)

**Engine:** `lib/intangibles-amort-engine.ts` — `computeIntangiblesAmortSchedule`

**Triggered from apply when:** `capexModelIntangibles` is true and `intangiblesAmortizationLifeYears > 0`.

**Uses:** Last historical **`intangible_assets`**, additions driver (% revenue, manual, % of capex — the latter uses **`totalCapexByYear`** from the capex path), **`capexTimingConvention`** for new-addition timing, amortization life.

**Writes:** Projection-year values on BS row **`intangible_assets`** (see store block adjacent to PP&E in `applyBsBuildProjectionsToModel`).

---

## 13. File Reference Summary

| File | Responsibility |
|------|----------------|
| `components/schedules-shell.tsx` | Schedules step sub-tabs; Debt placeholder; otherwise `BalanceSheetBuilder bs_build`. |
| `components/balance-sheet-builder-unified.tsx` | Hosts WC + Capex cards when `stepId === "bs_build"`. |
| `components/capex-da-schedule-card.tsx` | All user-facing capex/D&A/bucket/intangibles inputs and historical diagnostics UI. |
| `lib/capex-da-engine.ts` | `computeProjectedCapexByYear`, `computeCapexDaSchedule`, `computeCapexDaScheduleByBucket`. |
| `lib/capex-da-diagnostics.ts` | Historical diagnostics only. |
| `lib/capex-defaults.ts` | Bucket IDs, default useful lives, land/CIP constants, legacy-life detection. |
| `lib/intangibles-amort-engine.ts` | Intangibles roll-forward. |
| `lib/intangibles-guidance.ts` | Suggested % and implied additions hints. |
| `lib/working-capital-schedule.ts` | WC schedule items and projected balances (sibling concern on same screen). |
| `store/useModelStore.ts` | `applyBsBuildProjectionsToModel` — wires revenue, WC, capex engine, intangibles engine → BS + CFS recompute. |
| `components/excel-preview.tsx` | Displays schedule-based capex, D&A, PP&E in preview. |

---

## 14. Formula Cheat Sheet (Aggregate Path)

For each projection year \(y\), with opening PP&E \(B_y\), capex \(C_y\), useful life \(L \ge 0.5\), timing factor \(f \in \{0, 0.5, 1\}\):

\[
\text{D\&A}_y = \frac{B_y}{L} + \frac{f \cdot C_y}{L}
\]

\[
E_y = B_y + C_y - \text{D\&A}_y
\]

\[
B_{y+1} = E_y
\]

\(B_0\) is last historical net PP&E. Values are clamped to \(\ge 0\) in code.

Bucketed path: same structure **per bucket**, with land fixed and opening depreciable PP&E split by normalized allocation weights.

---

*End of document.*
