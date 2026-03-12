# Projections Architecture Audit

**Purpose:** Technical mapping of the current projection system and its relationship to the post–Historicals metadata architecture. **Analysis only — no code changes.**

**Context:** Projection logic was built before classification completeness, taxonomy, trust/review states, final row classification, cleaned CFS structure, and richer metadata for custom rows. This audit identifies what exists, what is outdated or risky, and what should drive Phase 2 design.

---

## 1. Existing Projection Logic by Statement

### 1.1 Income Statement

| Aspect | Current implementation |
|--------|------------------------|
| **What exists** | Revenue projection (streams + breakdowns), COGS as % of revenue by line, SG&A as % of revenue (top-level) or % of parent (nested). Projection **display** is driven by IS Build (revenue-projection-engine, COGS %, SG&A %) and fed into Excel preview via `projectedRevenue`, `projectedCogs`, `projectedCogsByCogsChild`, `projectedSgaBySgaChild`. |
| **Files / functions** | `lib/revenue-projection-engine.ts` (`computeRevenueProjections`), `components/excel-preview.tsx` (useMemo for projectedRevenue, projectedCogs, projectedSgaBySgaChild), `components/is-build-view.tsx` (COGS %, SG&A % inputs), `components/is-build-preview.tsx` (projectedCogsByYear), `store/useModelStore.ts` (revenueProjectionConfig, cogsPctByRevenueLine, sgaPctByItemId, setProjectionAllocation, etc.). |
| **User inputs / drivers** | `revenueProjectionConfig`: per-item method (growth_rate, price_volume, customers_arpu, pct_of_total, product_line, channel) + inputs; `projectionAllocations` (breakdown % for projection years); COGS % by revenue line (constant or per year); SG&A % of revenue by item (constant or per year); SG&A sub-items % of parent. |
| **Rows affected** | **Row-ID driven:** `rev`, direct children of `rev` (streams), and breakdown items under streams. COGS: `cogs` total and COGS children matched to streams by label heuristics. SG&A: children of `sga` (fixed categories from template + custom). Gross profit, EBIT, margins are **formula-driven** from rev/cogs/sga. |
| **Metadata used** | **Section/template:** Revenue uses `rev` + `rev.children` (structure). COGS/SG&A projection mapping uses **position and label** (e.g. “Subscription and support COGS” → stream “Subscription and support”); no use of `sectionOwner`, `taxonomyType`, or `taxonomyCategory` for projection. `parentIdsWithProjectionBreakdowns` = rev breakdown IDs + sga parent IDs with breakdowns so recompute does not overwrite parent with sum of children for those IDs. |
| **Conclusion** | **Row-ID and structure driven.** Relies on template shape (`rev`, `cogs`, `sga`, `operating_expenses`) and hardcoded IDs. Custom IS rows that are not under rev/cogs/sga have no projection path; taxonomy/sectionOwner are not used for forecasting. |

### 1.2 Balance Sheet

| Aspect | Current implementation |
|--------|------------------------|
| **What exists** | **No direct BS “projection engine” for most rows.** Projection values are written only for: (1) **WC items** (from WC schedule), (2) **PP&E** (from Capex/D&A schedule), (3) **Intangible assets** (from Intangibles schedule). These are applied by `applyBsBuildProjectionsToModel()`. All other BS rows (cash, debt, equity, etc.) are **not** projected by any schedule; they are either manual or derived elsewhere (e.g. cash from CFS net change). |
| **Files / functions** | `store/useModelStore.ts` (`applyBsBuildProjectionsToModel`), `lib/working-capital-schedule.ts` (`getWcScheduleItems`, `computeWcProjectedBalances`), `lib/capex-da-engine.ts` (`computeProjectedCapexByYear`, `computeCapexDaSchedule`, bucketed variant), `lib/intangibles-amort-engine.ts` (`computeIntangiblesAmortSchedule`). `lib/calculations.ts`: `getWcBsBalance`, `getDeltaWcBs` use `cashFlowBehavior === "working_capital"` and `getRowsForCategory`. |
| **User inputs / drivers** | WC: `wcDriverTypeByItemId` (days / pct_revenue / pct_cogs / manual), `wcDaysByItemId`, `wcDaysByItemIdByYear`, `wcPctByItemId`, etc. Capex: `capexForecastMethod` (pct_revenue, manual, growth), `capexPctRevenue`, `capexManualByYear`, `capexGrowthPct`, timing, useful life. Intangibles: `intangiblesForecastMethod`, `intangiblesPctRevenue`, `intangiblesManualByYear`, `intangiblesPctOfCapex`, life years. |
| **Rows affected** | **WC:** Only rows that are both (a) children of CFS `wc_change` and (b) in BS `current_assets` or `current_liabilities` (by `getRowsForCategory`). **PP&E / Intangibles:** Rows with `row.id === "ppe"` and `row.id === "intangible_assets"`. All by **row ID**. |
| **Metadata used** | **WC:** `getWcScheduleItems` uses CFS `wc_change.children` and BS category (current_assets / current_liabilities). `getWcBsBalance` / `getDeltaWcBs` use `cashFlowBehavior === "working_capital"` and exclude fixed IDs (cash, st_debt, totals). **Category:** `getRowsForCategory` is **position-based** (index between total_current_assets, total_assets, etc.) plus hardcoded `CATEGORY_MAPPINGS` in `bs-category-mapper.ts`; **no taxonomy**. |
| **Conclusion** | **Row-ID and position driven.** WC projection depends on wc_change children and BS category by index/mapping. PP&E and Intangibles are single-row IDs. Custom BS rows (e.g. other assets, other liabilities) have no projection logic. `cashFlowBehavior` is used only for WC sum and ΔWC; taxonomy is not used. |

### 1.3 Cash Flow Statement

| Aspect | Current implementation |
|--------|------------------------|
| **What exists** | **Operating:** net_income (from IS), danda (from D&A schedule or IS), sbc (disclosure/assumption), wc_change (from **BS ΔWC** in projection years), other_operating (manual), plus CFO Intelligence rows (cfo_* = BS change). **Investing:** Sum of items between `capex` and `investing_cf` by position, plus any row with `cfsLink.section === "investing"`. **Financing:** Sum of items between `investing_cf` and `financing_cf` by position; fallback by `cfsLink.section === "financing"`; final fallback hardcoded debt_issued, debt_repaid, etc. **Net change in cash:** operating_cf + investing_cf + financing_cf + cash_bridge. |
| **Files / functions** | `lib/calculations.ts` (`computeFormula`: operating_cf, wc_change projection, investing_cf, financing_cf, net_change_cash; `recomputeCalculations` writes wc_change projection from getDeltaWcBs). `lib/cfo-source-resolution.ts` (historical CFO values). `store/useModelStore.ts`: `applyBsBuildProjectionsToModel` recomputes CFS for projection years after writing WC/PP&E/Intangibles to BS. |
| **User inputs / drivers** | Historical: manual CFS inputs. Projection: **wc_change** from schedule (ΔWC from BS); **capex** from Capex schedule (when applied); **danda** from D&A schedule (IS danda row or embedded); **debt_issued / debt_repaid / equity / dividends / share repurchases**: **manual only** (no debt or financing schedule engine). |
| **Rows affected** | **Row-ID driven** for anchors: net_income, danda, sbc, wc_change, other_operating, operating_cf; capex … investing_cf; debt_issued, debt_repaid, … financing_cf; net_change_cash. **Section-driven** as fallback: `cfsLink.section` for investing_cf and financing_cf. Custom CFS rows are included if they sit between the anchor indices or have the right section. |
| **Metadata used** | `cfsLink.section` for section totals (investing_cf, financing_cf fallback). **historicalCfsNature** and **cfsForecastDriver** are **not** used in projection calculations; they are used for display (operating subgroups) and AI/classification. **cfsForecastDriver** is stored (e.g. debt_schedule, capex_schedule) but no engine uses it to compute values — debt_schedule rows are manual. |
| **Conclusion** | **Row-ID and position primary; section as fallback.** No taxonomy or cfsForecastDriver in the calculation path. Custom CFS rows get values from stored input or recompute; no schedule drives them by driver type. |

---

## 2. Projection-Related Files and Functions

### 2.1 Core calculation and recompute

| File | Role | Metadata relied on | Predates new historical architecture? |
|------|------|--------------------|----------------------------------------|
| `lib/calculations.ts` | `computeRowValue`, `computeFormula`, `recomputeCalculations`. Formulas for IS (gross_profit, ebit, ebt, net_income, margins), BS (totals by category), CFS (operating_cf, wc_change projection, investing_cf, financing_cf, net_change_cash). WC projection: `getDeltaWcBs` → `getWcBsBalance` (cashFlowBehavior, getRowsForCategory). | Row IDs, `cashFlowBehavior`, `getRowsForCategory` (position + CATEGORY_MAPPINGS), position between anchors. | Yes. Only recently used cashFlowBehavior for WC; no taxonomy. |
| `lib/bs-category-mapper.ts` | `getRowsForCategory`, `getBSCategoryForRow`. Determines which BS rows belong to current_assets, fixed_assets, etc. | Position relative to total_* rows; CATEGORY_MAPPINGS for known IDs. | Yes. Position-based; custom rows only by index. |
| `lib/is-classification.ts` | `isOperatingExpenseRow`, `isNonOperatingRow`, `isTaxRow`, `getIsSectionKey`. Used in formulas (operating_expenses, ebt, net_income). | `sectionOwner`, template row IDs. | Partially. sectionOwner used; taxonomy not. |

### 2.2 Revenue and IS projection

| File | Role | Metadata relied on | Predates? |
|------|------|--------------------|-----------|
| `lib/revenue-projection-engine.ts` | `computeRevenueProjections`: growth_rate, price_volume, customers_arpu, product_line/channel, pct_of_total. Output: itemId → year → value. | `rev` and `rev.children` (structure); config.items keyed by stream/breakdown id. | Yes. No sectionOwner/taxonomy. |
| `types/revenue-projection.ts` | RevenueProjectionConfig, methods, ProjectionAllocation. | N/A (types only). | Yes. |
| `components/revenue-projection-step.tsx` | Placeholder UI for projection years / drivers. | meta.years.projection. | Yes. |
| `components/revenue-forecast-inputs.tsx` | Growth % and driver inputs per stream. | revenueProjectionConfig. | Yes. |
| `components/revenue-breakdown-allocation.tsx` | Allocation % for projection years per breakdown. | projectionAllocations. | Yes. |
| `components/is-build-view.tsx` | COGS % by line, SG&A % by item; projection year selection. | rev children, cogs/sga structure, row IDs. | Yes. |
| `components/is-build-preview.tsx` | Projected COGS by year (from revenue × COGS %). | Same as above. | Yes. |

### 2.3 Excel preview and projection display

| File | Role | Metadata relied on | Predates? |
|------|------|--------------------|-----------|
| `components/excel-preview.tsx` | Renders all statements. For **projection years**: uses `projectedRevenue`, `projectedCogs`, `projectedCogsByCogsChild`, `projectedSgaBySgaChild` for IS; `bsBuildPreviewOverrides` / `bsBuildTotalsByYear` for BS Build; CFS uses stored/computed values from recomputeCalculations. | Row IDs (rev, cogs, sga, children), position. | Partially. IS projection props added later; logic still row-ID based. |

### 2.4 Working capital schedule

| File | Role | Metadata relied on | Predates? |
|------|------|--------------------|-----------|
| `lib/working-capital-schedule.ts` | `getWcScheduleItems` (from wc_change children + BS category). `computeWcProjectedBalance(s)`, `getRecommendedWcMethod`, `getDaysBaseForItemId`. | CFS `wc_change.children`, BS `getRowsForCategory` (position), item id/label for days base. | Yes. No taxonomy; label heuristics for days base. |

### 2.5 Capex and D&A

| File | Role | Metadata relied on | Predates? |
|------|------|--------------------|-----------|
| `lib/capex-da-engine.ts` | `computeProjectedCapexByYear`, `computeCapexDaSchedule`, bucketed PP&E by category. | Revenue by year (from IS), last historical PP&E and Capex. | Yes. No row metadata. |
| `lib/capex-defaults.ts` | Default bucket IDs and allocation. | N/A. | Yes. |
| `components/capex-da-schedule-card.tsx` | UI for method (pct_revenue / manual / growth), timing, useful life, bucketed allocation. | Store state (capexForecastMethod, etc.). | Yes. |

### 2.6 Intangibles

| File | Role | Metadata relied on | Predates? |
|------|------|--------------------|-----------|
| `lib/intangibles-amort-engine.ts` | `computeIntangiblesAmortSchedule`: beginning, additions, amort, ending. | Last historical intangibles, revenue/capex by year, life, timing. | Yes. |
| `lib/intangibles-guidance.ts` | Guidance for first-year implied additions. | Revenue. | Yes. |

### 2.7 CFS forecast drivers (metadata only)

| File | Role | Metadata relied on | Predates? |
|------|------|--------------------|-----------|
| `lib/cfs-forecast-drivers.ts` | Vocabulary for `cfsForecastDriver` and `historicalCfsNature`; `CFS_ANCHOR_FORECAST_DRIVER`, `applyAnchorForecastDriver`. | Row id → driver (e.g. wc_change → working_capital_schedule, capex → capex_schedule). | Yes. Used for classification/backfill; **not** used by any projection engine to compute values. |

### 2.8 Store: applying projections to the model

| File | Role | Metadata relied on | Predates? |
|------|------|--------------------|-----------|
| `store/useModelStore.ts` | `applyBsBuildProjectionsToModel`: gets revenue/cogs by year (from IS computeRowValue), WC schedule items from `getWcScheduleItems`, runs `computeWcProjectedBalances`, Capex engine, Intangibles engine; writes only to WC item IDs, `ppe`, `intangible_assets`; then recomputes BS and CFS for projection years. | Row IDs (rev, cogs, ppe, intangible_assets), wc_change children, getRowsForCategory. | Yes. |

### 2.9 Excel export

| File | Role | Metadata relied on | Predates? |
|------|------|--------------------|-----------|
| `lib/excel-export.ts`, `lib/excel-export-is-build.ts`, `app/api/generate-excel/route.ts` | Export IS Build (projection revenue/COGS) and Financial Model sheet; projection years from meta. | Row IDs, structure. | Yes. |

---

## 3. Projection Logic That Is Now Structurally Outdated or Risky

### 3.1 Hardcoded row IDs

- **IS:** `rev`, `cogs`, `sga`, `rd`, `operating_expenses`, `gross_profit`, `ebit`, `ebt`, `tax`, `net_income`. Revenue engine and COGS/SG&A projection only work for this structure. Adding a top-level “Other revenue” or moving items breaks projection unless duplicated in config.
- **BS:** `cash`, `ar`, `inventory`, `ppe`, `intangible_assets`, `total_current_assets`, etc. in `getRowsForCategory` and `getWcBsBalance`. WC schedule only writes to IDs that are both in `wc_change.children` and in category; PP&E and Intangibles are single IDs. Custom BS line items (e.g. “Strategic investments”, “Prepaid”) are only supported if they are wc_change children and in the right category by position.
- **CFS:** `net_income`, `danda`, `sbc`, `wc_change`, `other_operating`, `operating_cf`; `capex`, `investing_cf`; `debt_issued`, `debt_repaid`, `financing_cf`; `net_change_cash`. Operating/investing/financing totals use index between these anchors; custom rows are included by position or `cfsLink.section`, but no schedule uses `cfsForecastDriver` to assign values.

### 3.2 Fixed template-only structure

- **IS:** `IS_PARENT_ROW_IDS = rev, cogs, sga, rd` and parent/child rules assume exactly this tree. Custom operating expense rows under `operating_expenses` are summed structurally but have no dedicated projection method (no % of revenue, growth, etc.) unless they are SG&A children and use SG&A %.
- **BS:** `getRowsForCategory` relies on the presence and order of total_* rows. Companies with different BS layouts (e.g. no total_current_assets) get fallbacks that can misassign categories. Custom rows are categorized only by index.
- **CFS:** Order of anchors is assumed. Inserting a new section or renaming anchors would require code changes. No generic “sum all rows with cfsForecastDriver = X” logic.

### 3.3 Assumptions from before taxonomy/completeness

- **No use of taxonomy for projection:** `taxonomyType`, `taxonomyCategory`, `taxonomyStatus` are never read by projection or schedule code. Type-based forecasting (e.g. “all revenue-type rows get growth”) does not exist.
- **No use of sectionOwner for projection:** IS projection does not use `sectionOwner` to decide which rows get which method (e.g. all `sectionOwner === "sga"` get % of revenue). It uses tree position and IDs.
- **No use of cfsForecastDriver for calculation:** CFS rows have `cfsForecastDriver` (debt_schedule, capex_schedule, etc.) but no engine uses it to compute values. Debt and financing are manual; “debt_schedule” is a label only.
- **WC and category:** WC uses `cashFlowBehavior === "working_capital"` in calculations but WC schedule **item list** comes from wc_change children + BS category by position, not from a “all rows with cashFlowBehavior = working_capital” scan. So if a row is WC in behavior but not a wc_change child, it is not in the schedule.

### 3.4 Logic that breaks with different company rows

- **COGS by stream:** Projected COGS is mapped to COGS children by **label** (e.g. “Subscription and support COGS” → stream “Subscription and support”). Renamed or extra streams/COGS lines require matching logic; custom labels can fail.
- **SG&A projection:** Tied to children of `sga` and to `sgaPctByItemId` keyed by row id. Rows outside sga (e.g. custom under operating_expenses) are not in the SG&A % UI or projection.
- **Financing CF:** Fallback in `computeFormula` uses `debt_issued`, `debt_repayment`, `equity_issuance`, `dividends`. Template uses `debt_issued`/`debt_repaid`; alias handling exists but the set of IDs is fixed. User-added financing rows are summed by position/section but not by driver type.
- **BS Build preview:** Overrides and totals are keyed by row id. Adding/removing BS rows changes indices and can break category boundaries in `getRowsForCategory`.

---

## 4. New Source-of-Truth Metadata for Forecasting

Below is what **should** be treated as the correct source of truth for **future** forecasting design, given the current post-Historicals architecture. This is the set of fields that are now populated and trustworthy enough to drive Phase 2.

### 4.1 Income Statement

| Field | Reliable for forecasting? | Notes |
|-------|----------------------------|--------|
| `sectionOwner` | **Yes** | Set for template and custom rows; backfilled for custom. Drives placement and (in is-classification) operating vs non-operating. Should drive “which section gets which projection method.” |
| `isOperating` | **Yes** | Distinguishes operating vs interest/other. Use for EBT and for “operating expense” projection family. |
| `taxonomyCategory` / `taxonomyType` | **Yes, with status** | Available from row-taxonomy and backfill. Use with `taxonomyStatus === "trusted"` (or user-confirmed) to map row type to forecast method (e.g. revenue type → growth, opex type → % of revenue). |
| `taxonomyStatus` | **Yes** | Prefer trusted/confirmed taxonomy when auto-assigning forecast method; flag or restrict when needs_review/unresolved. |
| `classificationSource` | **Yes** | user > ai > fallback; use to avoid overwriting user intent when suggesting drivers. |
| `forecastMetadataStatus` | **Yes** | trusted vs needs_review; align with whether we auto-apply a driver or ask for review. |
| **Not yet used in projection** | — | No projection code reads these today; Phase 2 should. |

### 4.2 Balance Sheet

| Field | Reliable for forecasting? | Notes |
|-------|----------------------------|--------|
| `cashFlowBehavior` | **Yes** | working_capital, investing, financing, non_cash, unclassified. Already used in getWcBsBalance/getDeltaWcBs. **Should** drive: which rows get WC schedule, which are investing/financing (for CFS linking). |
| `taxonomyCategory` / `taxonomyType` | **Yes, with status** | Use to map BS line type to schedule (e.g. WC type → days vs %; PP&E type → capex schedule). |
| `scheduleOwner` | **Partial** | Set when applying BS Build (capex, intangibles). Could be extended to wc, debt. Not yet used to **decide** which schedule applies; only written after apply. |
| `taxonomyStatus` / `classificationSource` / `forecastMetadataStatus` | **Yes** | Same as IS: trust and override protection. |
| **Not yet used** | — | Taxonomy not used in getRowsForCategory or WC schedule item list; Phase 2 could use cashFlowBehavior + taxonomy for “which rows are WC” and “which schedule per row.” |

### 4.3 Cash Flow Statement

| Field | Reliable for forecasting? | Notes |
|-------|----------------------------|--------|
| `cfsLink.section` | **Yes** | operating, investing, financing, cash_bridge. Used in preview and in fallbacks for section totals. Primary for “which section does this row belong to.” |
| `historicalCfsNature` | **Yes** | Reported type (non_cash, working_capital_movement, etc.). Used for operating subgroups and backfill. Use for “which operating bucket” and for linking (e.g. non_cash → danda_schedule). |
| `cfsForecastDriver` | **Yes, as design** | income_statement, danda_schedule, working_capital_schedule, capex_schedule, debt_schedule, financing_assumption, manual_*. **Not used in any engine today.** Phase 2 should: for each row, if driver = X, take value from schedule X or manual. |
| `classificationSource` / `forecastMetadataStatus` / `taxonomyStatus` | **Yes** | Same as above for trust and review. |
| **Gap** | — | No engine currently dispatches on cfsForecastDriver to fill projection values; all non-schedule CFS rows are manual. |

---

## 5. Forecasting Ownership by Statement (Recommended View)

**Analysis only; no implementation.**

### 5.1 Income Statement

- **Projected directly on IS:**  
  - **Revenue:** Keep stream/breakdown-based engine; optionally extend to “all rows with sectionOwner === revenue (or taxonomy revenue)” and assign method by type.  
  - **COGS:** Keep % of revenue by line; consider driving by taxonomy (e.g. “cogs” type) so custom COGS rows get a method.  
  - **Operating expenses (SG&A, R&D, other_operating):** Keep % of revenue / % of parent where applicable; extend so **any row with sectionOwner in (sga, rd, other_operating)** and trusted taxonomy can receive a method (growth, % of revenue, flat).  
- **Derived from schedules (no direct IS projection):**  
  - **D&A (IS line):** From D&A schedule (PP&E + intangibles). Already linked conceptually; keep danda_schedule as source for CFS and IS danda row.  
  - **SBC:** Disclosure/assumption; keep as manual or separate disclosure model.  
- **Not forecast directly:** Subtotals and margins (gross_profit, ebit, ebt, net_income, margins) — formulas only, from projected revenue/COGS/opex and tax.

### 5.2 Balance Sheet

- **Projected via schedules (recommended):**  
  - **WC items:** Rows with `cashFlowBehavior === "working_capital"` (and optionally taxonomy) should be the **source of truth** for “WC schedule items,” not only wc_change children. Schedule computes balances; BS gets those balances for projection years; CFS wc_change = −ΔWC.  
  - **PP&E:** From Capex/D&A schedule (already).  
  - **Intangibles:** From Intangibles schedule (already).  
  - **Debt (ST/LT):** From a **future** debt schedule; schedule drives CFS debt_issued/debt_repaid and BS debt rows.  
- **Derived, not directly forecast:**  
  - **Cash:** From CFS net change in cash (beginning + net change).  
  - **Retained earnings:** From prior RE + net income − dividends (and other equity moves if modeled).  
- **Manual or assumption:** Other equity, other assets/liabilities unless new schedules are added.  
- **Do not forecast directly:** Total rows (formulas only).

### 5.3 Cash Flow Statement

- **From other statements/schedules (no direct CFS projection):**  
  - **Net income** ← IS.  
  - **D&A** ← D&A schedule (or IS).  
  - **SBC** ← disclosure/assumption.  
  - **WC change** ← ΔWC from BS (WC schedule).  
  - **Capex** ← Capex schedule.  
  - **Debt issued/repaid** ← (Future) debt schedule.  
- **From assumptions / manual:**  
  - **Other operating,** **acquisitions,** **asset sales,** **investments,** **equity issued,** **share repurchases,** **dividends,** **other financing,** **FX effect.**  
- **Ownership by driver:** Each CFS row should be filled by: `cfsForecastDriver` → either a schedule (income_statement, danda_schedule, working_capital_schedule, capex_schedule, debt_schedule) or “manual” (financing_assumption, manual_other, manual_mna). So **CFS projection = dispatch by cfsForecastDriver**, not by position.  
- **Never forecast directly:** Section totals and net change in cash (formulas only).

---

## 6. Existing Schedules and How They Connect

| Schedule | What it drives | Statement(s) affected | Uses new metadata? |
|----------|----------------|------------------------|---------------------|
| **Revenue (IS Build)** | Revenue streams and breakdowns; COGS % and SG&A % drive derived IS projection. | IS (rev, cogs, sga, then gross profit, EBIT, net income); BS/CFS indirectly via revenue/cogs for WC and Capex. | No. Row IDs and structure only. |
| **Working capital** | WC item list from wc_change children + BS category; projected balances from days/%/manual. | BS: projection-year balances for those items. CFS: wc_change in projection = −ΔWC (from getDeltaWcBs). | Partially. cashFlowBehavior used in getWcBsBalance; item list still from wc_change + position. |
| **Capex / D&A** | Capex by year; D&A and PP&E rollforward. | BS: `ppe` projection years. CFS: capex row could be filled from schedule when “apply” runs; danda from schedule feeds IS/CFS. | No. No taxonomy or scheduleOwner in engine. |
| **Intangibles** | Additions and amortization; ending intangibles. | BS: `intangible_assets` projection years. CFS: no direct intangibles line; amort can feed D&A. | No. |
| **Debt** | **None.** Template marks debt_issued/debt_repaid as `cfsForecastDriver: "debt_schedule"` but no engine implements it; values are manual. | Would affect CFS financing and BS debt rows. | N/A. |
| **Financing (dividends, repurchases, equity)** | **None.** Manual only. | CFS, and indirectly BS (equity, cash). | N/A. |

**Connection summary:**  
- Revenue → IS projection and → WC/Capex/Intangibles as inputs (revenue by year).  
- WC schedule → BS (WC item balances) and → CFS (wc_change via ΔWC).  
- Capex/D&A → BS (PP&E) and (conceptually) CFS capex and IS danda.  
- Intangibles → BS (intangible_assets).  
- Debt and other financing: no schedule; CFS and BS are manual.

---

## 7. Recommended Phase 2 Migration Path (Analysis Only)

### 7.1 Keep (with possible small refactors)

- **Revenue projection engine** and **revenueProjectionConfig** structure; extend to key by sectionOwner or taxonomy where useful, without breaking existing config.  
- **COGS % and SG&A %** projection logic; consider mapping “COGS-type” and “SG&A-type” rows by taxonomy so custom rows can participate.  
- **WC schedule math** (days, % of revenue/COGS, manual) and **computeWcProjectedBalances**.  
- **Capex and Intangibles engines** (inputs and formulas).  
- **getWcBsBalance / getDeltaWcBs** and use of `cashFlowBehavior === "working_capital"`.  
- **recomputeCalculations** and **computeRowValue** flow; keep wc_change projection branch (from BS ΔWC).  
- **applyBsBuildProjectionsToModel** pattern: run schedules, write to BS, then recompute BS and CFS.  
- **cfsForecastDriver** and **historicalCfsNature** vocabularies and backfill; they are the right hooks for Phase 2.

### 7.2 Refactor later

- **WC schedule item list:** Derive from “all BS rows with cashFlowBehavior === working_capital” (and optional taxonomy filter) instead of only wc_change children + category position. Keep wc_change children in sync with that set for display.  
- **BS category for projection:** Use taxonomy or explicit category metadata where available so custom rows are categorized without relying only on index and total_* positions.  
- **CFS section totals:** Prefer “sum all rows where cfsLink.section === X” over index-between-anchors, so custom rows are included by metadata.  
- **IS operating expense projection:** Extend so any row with sectionOwner in (sga, rd, other_operating) (and optionally trusted taxonomy) can get a forecast method, not only current sga children.  
- **Projection display (excel-preview):** Keep projectedRevenue/projectedCogs/projectedSgaBySgaChild but consider a single “projected values by row” map keyed by id (and maybe section/type) so new row types can plug in.

### 7.3 Deprecate or replace

- **Position-only category logic:** Reduce reliance on “between total_current_assets and total_assets” as the only way to know category; add taxonomy or explicit category for custom rows.  
- **Hardcoded CFS fallback IDs** in financing_cf (debt_issued, debt_repayment, etc.); replace with “all rows with cfsLink.section === financing” (and later cfsForecastDriver).  
- **Label-based COGS child → stream mapping** as the only way to assign COGS projection; add fallback by taxonomy or section.

### 7.4 Backbone of the new projection system

- **Single “forecast method per row” (or per row type):** For each statement, each row (or each taxonomy type) has a forecast method: growth, % of revenue, days, manual, from_schedule. Schedules (revenue, WC, Capex, D&A, Intangibles, future debt) produce values; the engine assigns them to rows by **metadata** (sectionOwner, cashFlowBehavior, cfsLink.section, cfsForecastDriver, taxonomy), not only by row ID.  
- **CFS as consumer of drivers:** CFS projection = for each row, if cfsForecastDriver is a schedule name, take value from that schedule; else manual/assumption. Keeps one place (driver) to decide source.  
- **BS as consumer of schedules:** BS projection = cash from CFS; WC items from WC schedule; PP&E from Capex; Intangibles from Intangibles; debt from debt schedule (future); rest manual or derived. Use cashFlowBehavior and taxonomy to know which schedule applies to which row.  
- **IS as driver + consumer:** Revenue and opex projected on IS (by sectionOwner/taxonomy); D&A consumed from schedule. Net income and margins stay formula-driven.  
- **Metadata as source of truth:** sectionOwner, isOperating, cashFlowBehavior, cfsLink.section, historicalCfsNature, cfsForecastDriver, taxonomyType/Category (with taxonomyStatus) drive which method and which schedule apply; row ID used only for known anchors or when metadata is missing (backward compatibility).

---

**End of audit.** Use this document to decide projection philosophy, statement-level ownership, direct vs derived forecasting, and how to make the system work for any company structure, not only template rows.
