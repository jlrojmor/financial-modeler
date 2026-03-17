# Revenue Forecasting: Methodology and Implementation Analysis

**Audience:** AI/LLM systems that need to understand the existing revenue forecasting logic, data structures, and integration points. This document is written in precise, technical language suitable for programmatic or reasoning use.

**Scope:** Revenue projection only. COGS and SG&A projection (percent-of-revenue) are referenced where they consume revenue output but are not fully specified here.

---

## 1. Purpose and Scope

The application implements a **revenue projection system** that:

- Operates on **projection years only** (e.g. 2026E, 2027E). Historical years are read from the Income Statement and never overwritten.
- Produces **per-item, per-year projected values** for: (a) Total Revenue (`rev`), (b) Revenue streams (direct children of `rev`), and (c) Optional breakdown items under each stream.
- Output is keyed by **item ID** and **year**: `Record<itemId, Record<year, storedValue>>`. Stored values use the model’s internal currency representation (e.g. display millions → stored in base units).
- The engine is **deterministic** and **pure**: it takes Income Statement rows, config, projection years, last historic year, and currency unit; it does not mutate the store. Downstream components (Excel preview, IS Build preview) call the engine and use the result for display and for driving COGS/SG&A projection.

**Out of scope for this document:** Working capital, Capex, Intangibles, CFS projection, and DCF. Those are documented in `PROJECTIONS-ARCHITECTURE-AUDIT.md` and `PHASE-2-FORECAST-ROUTING-BLUEPRINT.md`.

---

## 2. Data Model and Types

**Location:** `types/revenue-projection.ts`.

### 2.1 Projection Methods (Enumeration)

The following methods are supported. Each item (stream or breakdown) has exactly one method and one corresponding input shape.

| Method             | Description                                                                 | Primary use case                          |
|--------------------|-----------------------------------------------------------------------------|-------------------------------------------|
| `growth_rate`      | Year-over-year growth from a prior value (constant % or custom % per year).| Single stream or breakdown line.          |
| `price_volume`     | Revenue = price × volume, with optional annualization (×12).                | Unit economics, price/volume builds.      |
| `customers_arpu`   | Revenue = customers × ARPU (average revenue per user).                       | Subscriber / user-based models.          |
| `pct_of_total`     | Item = reference total × fixed percentage (reference = Total Revenue or a stream). | Share of total or of parent stream. |
| `product_line`     | Multiple sub-lines with base-year share (%) and per-line growth %.          | Product or segment mix.                   |
| `channel`          | Same structure as `product_line` (share + growth per line).                 | Channel or geography mix.                 |

### 2.2 Input Shapes (Per Method)

- **growth_rate:** `GrowthRateInputs`: `growthType` ("constant" | "custom_per_year"), `ratePercent`, optional `ratesByYear` (year → %), optional `baseYear`, optional `baseAmount` (display units; when set, overrides allocation-derived base).
- **price_volume:** `PriceVolumeInputs`: `baseYear`, `price`, `volume`, optional `priceGrowthPercent`, `volumeGrowthPercent`, optional `annualizeFromMonthly` (if true, base revenue = price × volume × 12).
- **customers_arpu:** `CustomersArpuInputs`: `baseYear`, `customers`, `arpu`, optional `customerGrowthPercent`, `arpuGrowthPercent`.
- **pct_of_total:** `PctOfTotalInputs`: `referenceId` (e.g. "rev" or stream id), `pctOfTotal` (0–100).
- **product_line / channel:** `ProductLineInputs`: `items` array of `{ id, label, sharePercent, growthPercent }` (sum of sharePercent = 100), optional `baseAmount` (display units).

### 2.3 Configuration Structure

- **RevenueProjectionConfig** (persisted in store as `revenueProjectionConfig`):
  - **items:** `Record<itemId, { method, inputs }>` — one entry per stream id and per breakdown item id.
  - **breakdowns:** `Record<parentStreamId, RevenueBreakdownItem[]>` — breakdown items under each stream (id, label).
  - **allocations:** Legacy: allocation of historic base per year (percentages or amounts).
  - **projectionAllocations:** `Record<parentStreamId, { percentages: Record<breakdownId, number> }>` — for projection years only; share of stream total per breakdown (sum = 100%).

- **Breakdown rules (for validation):** At most two of the following types may coexist in one stream: (1) **growth** (growth_rate, product_line, channel), (2) **dollar** (price_volume, customers_arpu), (3) **pct_of_stream** (pct_of_total with referenceId = parent stream). The helper `hasInvalidBreakdownMix` enforces this.

### 2.4 Structural Assumptions

- Revenue structure is **tree-shaped**: one row `id === "rev"` (Total Revenue) and its **children** are the top-level streams. Streams may have **breakdowns** defined in config (breakdowns are not required to exist as child rows in the tree; they are logical sub-items keyed by id).
- All IDs used in config (stream ids, breakdown ids) refer to either: (a) direct children of `rev`, or (b) breakdown items listed in `config.breakdowns[streamId]`. The engine uses `incomeStatement` to read historic values via `computeRowValue` and to discover stream ids from `rev.children`.

---

## 3. Engine Algorithm (computeRevenueProjections)

**Location:** `lib/revenue-projection-engine.ts`. Entry point: `computeRevenueProjections(incomeStatement, config, projectionYears, lastHistoricYear, allStatements, sbcBreakdowns, danaBreakdowns, currencyUnit)`.

### 3.1 Inputs and Outputs

- **Inputs:** Income statement rows (for structure and historic values), full config, ordered list of projection years, last historic year string, all statements (for `computeRowValue`), SBC/D&A breakdowns (for historic value resolution), currency unit (for display→stored conversion).
- **Output:** `ProjectedRevenueResult` = `Record<itemId, Record<year, storedValue>>`. Keys include: `"rev"`, each stream id, each breakdown id, and for product_line/channel the synthetic keys `parentId::lineKey` for sub-lines.

### 3.2 Prior Value and Base Year

- For **year index 0** (first projection year), the “prior” value for growth-based methods is either:
  - The **historic value** of that item in `lastHistoricYear` (from `computeRowValue`), or
  - An **override base** when the method’s inputs specify `baseAmount` (e.g. growth_rate, product_line/channel). Then that base is converted from display to stored using `currencyUnit`.
- For **subsequent projection years**, prior = the projected value of that item in the previous projection year (from the result object being built).

### 3.3 Per-Method Computation (Single Item, Single Year)

- **growth_rate:** `priorValue * (1 + rate)`. Rate is constant or from `ratesByYear[year]`.
- **price_volume:** Base year and projection years are ordered; for each year index, price and volume are compounded by their growth rates from base, then `displayRevenue = price * volume * (12 if annualizeFromMonthly else 1)`; converted to stored.
- **customers_arpu:** Same idea: customers and ARPU compounded by growth; `displayRevenue = customers * arpu`; converted to stored.
- **product_line / channel:** For each sub-line, `baseTotal * share * (1 + g)^yearIndex`; item value = sum of sub-lines. Sub-line values are also written to `result[parentId::lineKey][year]` for preview.
- **pct_of_total:** Not computed in the first pass for the item itself; it is applied in a later pass once the reference total exists.

### 3.4 Pass Order (High Level)

1. **Streams without breakdowns:** Each such stream is projected independently; prior = historic or baseAmount for year 0, then growth/price_volume/customers_arpu/product_line/channel. product_line/channel also write sub-line keys.
2. **Streams with breakdowns:** For each breakdown item, base for year 0 = parent stream historic × `projectionAllocations.percentages[breakdownId]` (or baseAmount if set). Then project that breakdown item with its method; product_line/channel again write sub-lines.
3. **Circular resolution (Mode B / pct_of_stream):** If a stream has breakdowns that include “% of this stream” (pct_of_total with referenceId = stream id), the stream total T is solved so that: independents (non–pct_of_parent items) sum to a known value, and pct_of_parent items = T × their method %. So T = independentSum / (1 - sum(pct_of_parent %)). Stream total and each pct_of_parent breakdown are set accordingly.
4. **Driver / residual (Mode A):** If a stream has price_volume or customers_arpu (driver) breakdowns and the rest are residuals, the stream total T can be derived so that driver total + residuals (by allocation %) = T; residuals without their own base become a plug. Logic handles one plug or multiple plugs by allocation share.
5. **Second pass:** For every stream that has breakdowns, stream total = sum of breakdown values (after circular/driver resolution).
6. **Total revenue:** `result["rev"][year]` = sum of all stream values for that year.
7. **Third pass — pct_of_total (reference = Total Revenue or another stream):** For any item (stream or breakdown) with method pct_of_total and referenceId ≠ own parent stream, set `result[itemId][year] = result[referenceId][year] * (pctOfTotal/100)`. Breakdowns whose reference is their parent are skipped (already set in circular resolution).
8. **Fourth pass:** Recompute stream totals when stream has pct_of_parent breakdowns that were not fully resolved in Mode B (e.g. no driver); again T = otherSum / (1 - pct_of_parent_sum). Then total revenue recomputed.
9. **Final pass — product_line/channel parent = sum of children:** For items using product_line or channel, set the item’s value to the sum of its sub-line keys (`parentId::lineKey`) so that reported growth of each sub-line matches the configured growth % (no rescaling). Then stream totals and total revenue are recomputed one more time.

### 3.5 Currency and Stored Values

- User-facing inputs (e.g. baseAmount, price, volume, ARPU) are in **display units** (e.g. millions). The engine uses `displayToStored(value, currencyUnit)` from `lib/currency-utils` before writing to `ProjectedRevenueResult`. Downstream consumers (Excel, IS Build) use the stored values from the result; display conversion happens at render time.

---

## 4. Store and State Integration

**Location:** `store/useModelStore.ts`.

- **State:** `revenueProjectionConfig: RevenueProjectionConfig` (default: `DEFAULT_REVENUE_PROJECTION_CONFIG` with empty items, breakdowns, allocations, projectionAllocations).
- **Actions:** 
  - `setRevenueProjectionMethod(itemId, method, inputs)` — set or update method and inputs for one item.
  - `setRevenueProjectionInputs(itemId, inputs)` — update inputs only.
  - `setRevenueBreakdowns(parentStreamId, breakdownItems)` — set breakdown list for a stream.
  - `removeRevenueBreakdown(parentStreamId, itemId)` — remove one breakdown.
  - `renameRevenueBreakdown(parentStreamId, itemId, label)` — rename.
  - `setProjectionAllocation(parentStreamId, percentages)` — set projection-year allocation % per breakdown (sum = 100).
  - Legacy allocation setters for historic base (optional).
- **Recompute:** When income statement structure or config changes, the store does not call the revenue engine directly. The **consumers** (e.g. Excel preview, IS Build preview) call `computeRevenueProjections` in a `useMemo` that depends on `incomeStatement`, `revenueProjectionConfig`, `meta.years.projection`, and related state. So the engine runs in the UI layer; the store only holds config and historic data.

### 4.1 Parent/Child and Breakdown Protection

- The store maintains `parentIdsWithProjectionBreakdowns`: set of row ids that have projection breakdowns (revenue breakdown ids + SG&A parent ids with breakdowns). When computing row values, parents in this set are not overwritten with the sum of children for projection years; their value comes from the revenue engine or from COGS/SG&A projection logic. This avoids overwriting stream totals with a sum of breakdowns when the engine has already set the stream total (e.g. after circular resolution).

---

## 5. Downstream Consumers

### 5.1 Excel Preview (`components/excel-preview.tsx`)

- **projectedRevenue:** Built in a `useMemo` that calls `computeRevenueProjections(...)` with store state. Passed as a prop to the statement renderer.
- **Usage:** For projection years and for rows that are revenue rows (rev or its descendants), the displayed value is `projectedRevenue[row.id]?.[year] ?? storedValue`. So the engine output overrides stored values for revenue lines in projection years.
- **projectedCogs / projectedCogsByCogsChild:** Derived from `projectedRevenue` and COGS % by revenue line (and by year if per-year COGS % is used). COGS total and COGS-by-child are then used to display and to compute gross profit/margin in projection years.
- **projectedSgaBySgaChild:** Derived from revenue total by year and SG&A % by item (and optionally % of parent). So revenue projection is the **upstream input** for COGS and SG&A projection in the preview.

### 5.2 IS Build Preview (`components/is-build-preview.tsx`)

- Calls `computeRevenueProjections` in the same way and uses the result for:
  - Revenue totals and per-stream/breakdown values in projection years.
  - COGS projection (revenue × COGS % per line) and COGS-by-child mapping.
  - Display of projected COGS, gross profit, and margins.

### 5.3 Revenue Projection Step (`components/revenue-projection-step.tsx`)

- Displays **historic** revenue (and subcategories) from the Income Statement. Does not run the engine itself; it is the “step 1” of projections and explains that drivers are set elsewhere (IS Build). Real-time preview is in Excel preview.

### 5.4 Revenue Forecast Inputs (`components/revenue-forecast-inputs.tsx`)

- Presentational component: given a **method** and **inputs**, it renders the appropriate form (growth rate, price/volume, customers/ARPU, % of total, product line/channel). On change, it calls `onChange(inputs)`. Used by the parent that holds `revenueProjectionConfig` and `setRevenueProjectionMethod` / `setRevenueProjectionInputs`.

### 5.5 Revenue Breakdown Allocation (`components/revenue-breakdown-allocation.tsx`)

- Manages **projection allocations** for a stream: % per breakdown for projection years (sum = 100). Uses `setProjectionAllocation`. Also shows “% of stream” for pct_of_total breakdowns and validates against `hasInvalidBreakdownMix`.

---

## 6. Where Revenue Projection Is Not Used

- **Calculations (lib/calculations.ts):** `computeRowValue` and `computeFormula` do **not** call the revenue engine. For projection years, revenue row values are typically provided by the **caller** (e.g. Excel preview) via the stored `row.values` that were previously written, or the caller injects projected values when resolving displayed value. The store’s `recomputeCalculations` does not write revenue projection; it writes WC change, formula-derived rows, etc. So the revenue engine is **only** invoked in the UI (Excel preview, IS Build preview) and its result is used for display and for deriving COGS/SG&A. If the store is later updated to persist projected revenue into `incomeStatement[].values` for projection years, that would be a separate flow (e.g. “Apply projections” or auto-sync).
- **Company modeling context:** `CompanyModelingProfile` and `getProjectionDefaultsFromProfile` suggest a **suggestedRevenueMethod** (e.g. "pct_growth") for future use; they do **not** currently call the revenue engine or override config. So company-aware revenue defaults are scaffolding only until Phase 2.

---

## 7. Summary for LLM Consumption

- **What exists:** A full revenue projection engine with six methods (growth_rate, price_volume, customers_arpu, pct_of_total, product_line, channel), config stored in Zustand (`revenueProjectionConfig`), and deterministic `computeRevenueProjections()` producing itemId → year → stored value. Streams and breakdowns are supported; circular resolution for “% of stream” and driver/residual logic for price_volume/customers_arpu are implemented.
- **Where it runs:** In the UI only (excel-preview, is-build-preview), via useMemo that depends on income statement, config, projection years, and currency. The store does not run the engine.
- **What consumes it:** Excel preview (revenue display, COGS/SG&A derivation), IS Build preview (same). Revenue step shows historics only.
- **Structure:** Row-id and tree-structure driven: `rev`, `rev.children` (streams), and config.breakdowns (logical breakdowns). No taxonomy or sectionOwner in the engine.
- **Phase 2:** Forecast routing and metadata-driven assignment (sectionOwner, taxonomy, CompanyModelingProfile) are designed in PHASE-2-FORECAST-ROUTING-BLUEPRINT.md and PROJECTIONS-ARCHITECTURE-AUDIT.md; revenue engine can later be fed by routing (e.g. which rows get which method) and by company-aware defaults from `getProjectionDefaultsFromProfile`.

This document is the single reference for the **revenue forecasting methodology and implementation** as currently built; use it together with the projections audit and Phase 2 blueprint for routing and extensions.
