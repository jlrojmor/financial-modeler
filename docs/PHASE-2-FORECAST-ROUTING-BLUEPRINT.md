# Phase 2 Forecast Routing Blueprint

**Purpose:** Design document for how forecasting should route and own rows using the post-Historicals metadata architecture. **Analysis only — no code, no formulas, no implementation.**

**Context:** Historicals cleanup (classification completeness, taxonomy, trust states, final row classification, CFS structure, review workflow) is done. The projection architecture audit showed current logic is still row-ID, position, and structure driven. This blueprint defines the routing design so Phase 2 can be implemented against a single source of truth.

---

## 1. Forecast Routing Principles

1. **Forecasting is metadata-driven, not label-driven.**  
   Routing (which forecast method or schedule applies to a row) must be determined by stored metadata (`sectionOwner`, `cashFlowBehavior`, `cfsLink.section`, `cfsForecastDriver`, `taxonomyCategory`/`taxonomyType`) whenever present and trusted. Label or position may be used only as fallback when metadata is missing or unresolved, and that fallback must be explicitly marked as backward compatibility.

2. **Totals and margins are always derived, never forecast directly.**  
   No row that is a subtotal, total, or margin (e.g. gross_profit, ebit, net_income, total_current_assets, operating_cf, net_change_cash) receives a forecast method. Its value is computed from other rows. The routing layer must never assign a direct or schedule-driven method to such rows.

3. **Schedules own specific row families.**  
   Working capital, Capex/D&A, Intangibles, and (future) Debt schedules are the single source of projected values for the rows they own. The model does not forecast those rows directly on the statement; it assigns them the method “schedule_driven” (or the equivalent driver) and consumes the schedule output. BS and CFS rows that are schedule-owned are written from schedule results, not from a separate “BS projection engine.”

4. **Historical metadata determines forecast routing eligibility.**  
   A row is eligible for a given forecast family only if its stored classification supports it. For example: a BS row is eligible for the WC schedule only if `cashFlowBehavior === "working_capital"` (or equivalent taxonomy). A CFS row is eligible to receive values from a schedule only if its `cfsForecastDriver` matches that schedule. Rows with `classificationSource === "unresolved"` or missing required metadata should not be auto-routed into active forecast logic; they should remain manual or trigger review.

5. **Trust state gates automatic routing.**  
   When suggesting or applying a forecast method based on taxonomy or section, the routing layer should respect `taxonomyStatus` and `forecastMetadataStatus`. Rows with `taxonomyStatus === "unresolved"` or `forecastMetadataStatus === "needs_review"` may receive a suggested method but should not be silently treated as fully routed until the user confirms or the metadata is trusted. This avoids forecasting ambiguous rows with fallback heuristics as if they were certain.

6. **Row ID is temporary / backward compatibility only.**  
   Known anchor row IDs (e.g. net_income, wc_change, capex, debt_issued) may be used to assign a default driver or method when metadata is missing, so existing projects and templates continue to work. The target state is: routing is driven by metadata first; row ID is used only for anchors when no metadata exists, or for deterministic template rows that will always have metadata from backfill.

7. **One owner per row.**  
   Each row has exactly one routing outcome: direct forecast, derived, or schedule-driven (with a single schedule). No row is both “direct” and “schedule-driven”; no row is “derived” and “direct.” The routing matrix must be unambiguous.

8. **CFS is a consumer, not a source.**  
   Cash flow statement projection does not “own” any forecast method for line items other than manual/assumption. Operating, investing, and financing line values are either pulled from IS, from BS (ΔWC), or from schedules (D&A, Capex, Debt), or are manual/assumption. CFS section totals and net change in cash are always derived.

---

## 2. Row Routing by Statement

### 2.1 Income Statement

**A. Rows that should be forecast directly**

- **Revenue-family rows:** Rows with `sectionOwner === "revenue"` (or taxonomy category `revenue`). These receive a direct IS forecast method: growth_rate, percent_of_revenue, price_volume, customers_arpu, product_line, etc. Revenue streams and breakdowns are the primary example; any custom row classified as revenue should be routable into the same family.
- **COGS-family rows:** Rows with `sectionOwner === "cogs"` (or taxonomy category `cost_of_revenue`). These receive a direct IS forecast method: typically percent_of_revenue (or percent by stream), or manual. Each COGS line is forecast directly; the total COGS is derived.
- **Operating-expense rows (SG&A, R&D, other_operating):** Rows with `sectionOwner` in `sga`, `rd`, `other_operating` (or taxonomy category `operating_expense` and types like opex_sga, opex_rd). These receive a direct IS forecast method: percent_of_revenue, percent_of_parent, growth_rate, or manual. D&A (opex_danda) is not forecast directly on IS; it is schedule-driven (see below).
- **Non-operating and tax rows:** Rows with `sectionOwner === "non_operating"` or `sectionOwner === "tax"` (or corresponding taxonomy). Non-operating: interest expense/income, other income/expense — direct methods such as manual, growth, or assumption. Tax: direct method such as tax_rate_based or manual.

**B. Rows that should be derived**

- **Gross profit, gross margin:** From revenue − COGS and margin formula.
- **Operating expenses (structural parent), EBIT, EBIT margin:** From sum of operating expense rows and revenue.
- **EBT, EBT margin:** From EBIT + non-operating items (sign-adjusted).
- **Net income, net income margin:** From EBT − tax.
- **EBITDA, EBITDA margin:** From EBIT + D&A (D&A from schedule or IS line).
- Any row with `kind === "calc"` or `kind === "subtotal"` or `kind === "total"` or taxonomy type `calc_*`: always derived.

**C. Rows that should be driven by schedules**

- **D&A (income statement line):** The single D&A line on the IS (e.g. Depreciation and amortization) should be driven by the D&A schedule (Capex + Intangibles amortization). The schedule owns the value; the IS row and the CFS danda row consume it. No direct forecast method on the IS D&A row itself.

---

### 2.2 Balance Sheet

**A. Rows that should be forecast directly**

- **None for “direct” in the sense of an IS-style growth or % method.** BS line items that are not schedule-owned are either derived (cash, retained earnings) or manual input. So “direct” here means only: **manual_input** as the method. Rows such as “Other assets,” “Other liabilities,” equity line items other than retained earnings, etc., are manual unless a schedule is added later.

**B. Rows that should be derived**

- **Cash:** From prior-year cash + net change in cash (from CFS). Never forecast directly on the BS.
- **Retained earnings:** From prior RE + net income − dividends (and other equity movements if modeled). Never forecast directly.
- **All total/subtotal rows:** total_current_assets, total_assets, total_current_liabilities, total_liabilities, total_equity, total_liab_and_equity — formulas only.

**C. Rows that should be driven by schedules**

- **Working-capital items:** Rows with `cashFlowBehavior === "working_capital"` (and in current_assets or current_liabilities). Owned by the Working Capital schedule. Schedule produces projected balances by year; BS receives those values for projection years. Excludes cash and short-term debt (which are not WC in the CF sense).
- **PP&E (and optionally land/other buckets):** Owned by the Capex/D&A schedule. Schedule produces ending PP&E by year; BS row(s) receive those values.
- **Intangible assets:** Owned by the Intangibles schedule. Schedule produces ending intangibles by year; BS row receives those values.
- **Short-term and long-term debt (future):** When a debt schedule exists, rows with `cashFlowBehavior === "financing"` (or taxonomy/future scheduleOwner) that represent debt are owned by the debt schedule. Schedule produces balances and flows; BS and CFS consume them.

---

### 2.3 Cash Flow Statement

**A. Rows that should be “forecast” directly (manual/assumption only)**

- **Other operating:** Rows with `cfsForecastDriver === "manual_other"` in the operating section — user input.
- **Acquisitions, asset sales, investments, other investing:** Rows with `cfsForecastDriver === "manual_mna"` or `"manual_other"` in investing — user input.
- **Equity issued, share repurchases, dividends, other financing:** Rows with `cfsForecastDriver === "financing_assumption"` or `"manual_other"` — user input or assumption.
- **SBC (if not from disclosure):** Treated as disclosure_or_assumption — can be manual or from a separate disclosure model.
- **FX effect on cash (cash_bridge):** Manual or assumption.

**B. Rows that should be derived**

- **Net income (CFS line):** From IS net income. Not forecast on CFS.
- **Operating CF total (operating_cf):** Sum of all operating section lines (net income, D&A, SBC, wc_change, other_operating, plus any cfo_* intelligence rows). Derived.
- **Investing CF total (investing_cf):** Sum of all investing section lines. Derived.
- **Financing CF total (financing_cf):** Sum of all financing section lines. Derived.
- **Net change in cash:** operating_cf + investing_cf + financing_cf + cash_bridge items. Derived.

**C. Rows that should be driven by schedules (or IS)**

- **Net income:** From IS (income_statement driver).
- **D&A:** From D&A schedule (danda_schedule driver).
- **SBC:** From disclosure or assumption (disclosure_or_assumption); can be manual.
- **WC change:** From BS ΔWC, which is produced by the Working Capital schedule (working_capital_schedule driver). The CFS row does not have its own forecast; it is the negative of the change in WC balance.
- **Capex:** From Capex schedule (capex_schedule driver).
- **Debt issued / Debt repaid:** From (future) debt schedule (debt_schedule driver). Until then, manual.

---

## 3. Source-of-Truth Metadata for Forecast Routing

### 3.1 Income Statement

**Order of precedence for routing decisions:**

1. **sectionOwner** — Primary. Determines which “section” the row belongs to (revenue, cogs, sga, rd, other_operating, non_operating, tax, operating_expenses). Routing assigns forecast method family by section (e.g. revenue → growth/percent_of_revenue; sga → percent_of_revenue or percent_of_parent). If present and not overridden by user, use it first.
2. **isOperating** — Resolves operating vs non-operating when sectionOwner is non_operating or when distinguishing EBT components. Used together with sectionOwner.
3. **taxonomyCategory / taxonomyType** — Secondary. When sectionOwner is missing or row is custom, taxonomy can assign the row to a forecast family (e.g. taxonomyCategory `revenue` → revenue methods; `operating_expense` + type opex_sga → SG&A methods). Only use for routing when `taxonomyStatus === "trusted"` (or user-confirmed); otherwise treat as suggestion or fallback.
4. **taxonomyStatus** — Gate. If `taxonomyStatus === "unresolved"`, do not auto-route by taxonomy; row remains manual or needs_review until classification is set. If `needs_review`, routing can suggest a method but should not silently apply it as trusted.
5. **classificationSource** — Override protection. If `classificationSource === "user"`, do not overwrite the row’s assigned method or section with AI/fallback. User intent wins.
6. **forecastMetadataStatus** — Trust. When suggesting method from taxonomy/section, `forecastMetadataStatus === "trusted"` means the row is fully eligible for automatic routing; `needs_review` means the row may be shown in review until confirmed.

**Fields that do not drive IS routing:** Row ID and label are not source of truth; they are fallback for template anchors only (e.g. known rev, cogs, sga IDs when metadata is missing).

---

### 3.2 Balance Sheet

**Order of precedence for routing decisions:**

1. **cashFlowBehavior** — Primary. Determines whether the row is working_capital (→ WC schedule), investing (→ Capex/Intangibles or future schedule), financing (→ debt schedule when present), or non_cash/unclassified (→ manual or derived). This is the main routing key for “which schedule owns this row.”
2. **scheduleOwner** — When set (e.g. by apply step or backfill), indicates which schedule already owns the row (wc, capex, intangibles, debt). Use to confirm or assign schedule-driven method. Can be secondary to cashFlowBehavior when both exist.
3. **taxonomyCategory / taxonomyType** — Secondary. For custom rows without cashFlowBehavior, taxonomy can infer category (e.g. current_assets + type → WC vs cash). Use only when `taxonomyStatus === "trusted"` for routing.
4. **taxonomyStatus** — Gate. Same as IS: unresolved taxonomy does not auto-route; needs_review can suggest but not silently trust.
5. **classificationSource** — Override protection. User-classified rows are not overwritten by schedule assignment.
6. **forecastMetadataStatus** — Trust. Same as IS.

**Fields that do not drive BS routing:** Position (index between total_* rows) is not source of truth; it remains for backward compatibility only. Row ID is fallback for known anchors (cash, ppe, intangible_assets).

---

### 3.3 Cash Flow Statement

**Order of precedence for routing decisions:**

1. **cfsForecastDriver** — Primary. Directly states how the row is forecast: income_statement, danda_schedule, working_capital_schedule, capex_schedule, debt_schedule, disclosure_or_assumption, financing_assumption, manual_mna, manual_other. Routing: if driver is a schedule name, take value from that schedule; if income_statement, take from IS; otherwise manual/assumption. This is the actual routing key for CFS.
2. **cfsLink.section** — Determines which section the row belongs to (operating, investing, financing, cash_bridge). Used for section totals and for validating that a row’s driver is consistent with its section. Not sufficient alone to assign value source; cfsForecastDriver is required for that.
3. **historicalCfsNature** — Describes the line type (reported_non_cash_adjustment, reported_working_capital_movement, etc.). Used for display (operating subgroups) and for inferring driver when cfsForecastDriver is missing (e.g. reported_working_capital_movement → working_capital_schedule). Secondary to cfsForecastDriver.
4. **taxonomyCategory / taxonomyType** — Secondary. When cfsForecastDriver and historicalCfsNature are missing, taxonomy can suggest driver (e.g. cff_debt_issued → debt_schedule). Only when taxonomyStatus is trusted.
5. **taxonomyStatus** — Gate. Unresolved → do not auto-route by taxonomy.
6. **classificationSource / forecastMetadataStatus** — Override and trust. Same as IS/BS.

**Fields that do not drive CFS routing:** Row order (position between capex and investing_cf, etc.) is not source of truth; section totals should be “sum all rows where cfsLink.section === X,” not “sum rows between index i and j.” Row ID is fallback for known anchors when driver is missing.

---

## 4. Forecast Method Families (Vocabulary Only)

No formulas or implementation — only the recommended vocabulary of forecast method families for Phase 2.

### 4.1 Income Statement

| Method family | Meaning (conceptual) | Typical use |
|---------------|---------------------|-------------|
| **growth_rate** | Value grows by a constant or time-varying rate from a base. | Revenue streams, some opex. |
| **percent_of_revenue** | Value = specified % of (total or stream) revenue that year. | COGS, SG&A, some opex. |
| **percent_of_parent** | Value = specified % of parent row that year. | Nested opex (e.g. sub-line of SG&A). |
| **price_volume** | Value from price × volume with optional growth. | Revenue. |
| **customers_arpu** | Value from customers × ARPU with optional growth. | Revenue. |
| **product_line / channel** | Value from share and growth of product/channel mix. | Revenue breakdowns. |
| **manual_input** | User enters value per year. | Any row when no driver is chosen. |
| **schedule_driven** | Value comes from a schedule (e.g. D&A from D&A schedule). | D&A line on IS. |
| **margin_based** | Value implied by target margin (e.g. target EBIT margin → opex). | Optional opex method. |
| **tax_rate_based** | Tax from EBT × rate or similar. | Tax line. |

### 4.2 Balance Sheet

| Method family | Meaning (conceptual) | Typical use |
|---------------|---------------------|-------------|
| **days_based** | Balance from days × (revenue or COGS) / 365. | AR, inventory, AP (WC schedule). |
| **percent_of_revenue** | Balance = % of revenue. | Some WC items. |
| **percent_of_cogs** | Balance = % of COGS. | Some WC items. |
| **manual_input** | User enters balance per year. | Other assets/liabilities, equity. |
| **rollforward** | Balance = prior balance + inflows − outflows. | PP&E, intangibles, debt (schedule output). |
| **schedule_driven** | Value from a schedule (WC, Capex, Intangibles, Debt). | WC items, PP&E, intangibles, debt. |
| **derived** | Value from other statements (e.g. cash from CFS, RE from NI − dividends). | Cash, retained earnings. |

No “plug” method in the vocabulary unless explicitly designed (e.g. a single plug row for balancing); plug logic is a separate design decision.

### 4.3 Cash Flow Statement

| Method family | Meaning (conceptual) | Typical use |
|---------------|---------------------|-------------|
| **from_income_statement** | Value from IS (e.g. net income). | net_income line. |
| **from_working_capital_schedule** | Value from BS ΔWC (WC schedule output). | wc_change. |
| **from_capex_schedule** | Value from Capex schedule. | capex line. |
| **from_danda_schedule** | Value from D&A schedule. | danda line. |
| **from_debt_schedule** | Value from debt schedule. | debt_issued, debt_repaid. |
| **disclosure_or_assumption** | Value from SBC/disclosure model or assumption. | sbc. |
| **manual_input** | User enters value per year. | other_operating, acquisitions, etc. |
| **financing_assumption** | User or model assumption (e.g. dividends, repurchases). | dividends, share_repurchases, equity_issued. |
| **derived_total** | Sum of section or full CFS. | operating_cf, investing_cf, financing_cf, net_change_cash. |

---

## 5. Routing Matrix by Row Family

Conceptual: for each row family (by metadata / type), what owns it.

| Row family (conceptual) | Statement | Owner / method |
|-------------------------|-----------|----------------|
| Revenue (sectionOwner revenue / taxonomy revenue) | IS | Direct IS forecast (growth_rate, percent_of_revenue, price_volume, etc.). |
| COGS (sectionOwner cogs / taxonomy cost_of_revenue) | IS | Direct IS forecast (percent_of_revenue or by stream). |
| SG&A / R&D / other operating (sectionOwner sga, rd, other_operating) | IS | Direct IS forecast (percent_of_revenue, percent_of_parent, growth, manual). |
| D&A (IS line) (opex_danda) | IS | Schedule-driven (D&A schedule). |
| Non-operating (interest, other income/expense) | IS | Direct IS forecast (manual, growth, assumption). |
| Tax | IS | Direct IS forecast (tax_rate_based or manual). |
| Gross profit, EBIT, EBT, net income, margins | IS | Derived (formulas). |
| WC items (cashFlowBehavior working_capital) | BS | WC schedule (schedule_driven). |
| PP&E | BS | Capex/D&A schedule (schedule_driven). |
| Intangible assets | BS | Intangibles schedule (schedule_driven). |
| Debt (ST/LT) (when schedule exists) | BS | Debt schedule (schedule_driven). |
| Cash | BS | Derived (from CFS net change). |
| Retained earnings | BS | Derived (prior RE + NI − dividends, etc.). |
| Other BS assets/liabilities/equity | BS | Manual (manual_input). |
| BS totals | BS | Derived (formulas). |
| CFS net income | CFS | From IS (from_income_statement). |
| CFS D&A | CFS | From D&A schedule (from_danda_schedule). |
| CFS SBC | CFS | Disclosure/assumption (disclosure_or_assumption) or manual. |
| CFS wc_change | CFS | From WC schedule / BS ΔWC (from_working_capital_schedule). |
| CFS other_operating | CFS | Manual (manual_input). |
| CFS operating_cf | CFS | Derived total. |
| CFS capex | CFS | From Capex schedule (from_capex_schedule). |
| CFS other investing (acquisitions, etc.) | CFS | Manual (manual_input / manual_mna). |
| CFS investing_cf | CFS | Derived total. |
| CFS debt_issued / debt_repaid | CFS | From debt schedule (from_debt_schedule) or manual until schedule exists. |
| CFS equity/dividends/repurchases/other financing | CFS | Financing assumption or manual (financing_assumption / manual_input). |
| CFS financing_cf | CFS | Derived total. |
| CFS cash_bridge (e.g. FX) | CFS | Manual (manual_input). |
| CFS net_change_cash | CFS | Derived total. |

---

## 6. Statement Ownership and Dependencies

**Execution order (conceptual):**

1. **Income Statement (revenue and opex) first.**  
   Project revenue, COGS, and operating expenses (including non-operating and tax) using direct IS methods. D&A on the IS is not computed here; it will be filled from the D&A schedule. Result: projected revenue, COGS, opex, non-op, tax; then derived gross profit, EBIT, EBT, net income (with D&A placeholder or zero until schedule runs).

2. **Schedules that depend on IS (and last historical BS).**  
   - **Working Capital schedule:** Uses revenue and COGS by year (from IS) and last historical WC balances; produces projected WC balances by item and year.  
   - **Capex/D&A schedule:** Uses revenue by year (from IS), last historical PP&E and Capex; produces Capex by year, D&A by year, ending PP&E by year.  
   - **Intangibles schedule:** Uses revenue (and optionally Capex) by year; produces additions, amortization, ending intangibles.  
   - **(Future) Debt schedule:** Would use financing assumptions and existing debt; produces debt balances and debt_issued/debt_repaid by year.

3. **BS updated from schedules and derived.**  
   Write WC schedule output to BS WC rows (by cashFlowBehavior or scheduleOwner). Write Capex output to PP&E, Intangibles output to intangible_assets. (Later: debt schedule to debt rows.) Compute cash from prior cash + CFS net change (see step 5); compute retained earnings from prior RE + net income − dividends. Recompute BS totals.

4. **D&A and net income (IS) finalized.**  
   D&A schedule output is written to the IS D&A row (and used in CFS). Net income can then be recomputed if it depends on D&A (e.g. EBITDA − D&A = EBIT, then down to NI). Order may depend on whether net income is before or after D&A in the IS; typically D&A is above EBIT so net income is already correct once revenue and opex are set, and D&A is filled from schedule for display and for CFS.

5. **CFS filled by driver.**  
   For each CFS line: if cfsForecastDriver is income_statement → take from IS (net income). If danda_schedule → take from D&A schedule. If working_capital_schedule → take −ΔWC from BS (WC schedule result). If capex_schedule → take from Capex schedule. If debt_schedule → take from debt schedule (or manual). If financing_assumption / manual_other / manual_mna → use user input. Section totals and net change in cash are derived (sums).

6. **Cash and retained earnings (BS) closed.**  
   Net change in cash is now known from CFS. Cash = prior cash + net change. Retained earnings = prior RE + net income − dividends (and other equity moves). These derived BS rows are updated last so that the model balances.

**Dependency summary:**

- IS (revenue, COGS, opex, tax) does not depend on BS/CFS for its direct forecasts.  
- WC schedule depends on IS (revenue, COGS) and historical BS.  
- Capex/Intangibles depend on IS (revenue) and historical BS.  
- BS WC, PP&E, Intangibles depend on those schedules.  
- CFS depends on IS (net income), D&A schedule, WC (via BS ΔWC), Capex schedule, debt schedule (or manual), and manual inputs.  
- BS cash and retained earnings depend on CFS and IS.

---

## 7. Backward Compatibility Strategy

**What old logic can remain temporarily:**

- **Row ID for known anchors:** Template row IDs (rev, cogs, sga, net_income, wc_change, capex, debt_issued, debt_repaid, etc.) can continue to be recognized so that existing projects and templates get a default driver or method when metadata is missing. The routing layer should first check metadata; if missing, fall back to “if row.id === X then driver = Y.”
- **Position-based section totals (CFS):** Until CFS totals are refactored to “sum by cfsLink.section,” the existing “sum rows between index i and j” can remain, provided it does not exclude custom rows that have the correct section. Prefer adding a parallel path: “if section metadata exists, sum by section; else use position.”
- **WC schedule item list from wc_change children + BS category:** The current way of building the WC item list (intersection of wc_change.children and BS current_assets/current_liabilities by position) can remain until the new path “all BS rows with cashFlowBehavior === working_capital” is implemented. Then both can run: new path for routing, old path as fallback when cashFlowBehavior is missing.
- **Revenue/COGS/SG&A config keyed by row id:** Existing revenueProjectionConfig and COGS/SG&A percent config keyed by stream id or row id can stay. Phase 2 can add a parallel “method by sectionOwner or taxonomy” so new rows get a method; existing rows keep id-based config.

**What should be wrapped behind metadata-based routing:**

- **Assignment of “which schedule owns this row”:** The decision “this BS row gets WC schedule output” should be made by cashFlowBehavior (and optionally scheduleOwner), not only by “row is in wc_change.children and in category by index.” The engine can still write to the same set of rows, but the set should be computed from metadata first, with row ID/position as fallback.
- **Assignment of “which forecast method for this IS row”:** The decision “this IS row gets percent_of_revenue” should be made by sectionOwner (or taxonomy when trusted), not only by “row is child of sga.” So the routing layer returns “method = percent_of_revenue” for any row with sectionOwner === sga (or equivalent), and the existing engine can then apply that method.
- **Assignment of “where does this CFS row get its value”:** The decision “this CFS row gets value from Capex schedule” should be made by cfsForecastDriver === capex_schedule, not by “row is the capex row by position.” So the engine dispatches by driver; for existing data without driver, fall back to row ID (e.g. id === "capex" → capex_schedule).

**Where row-ID logic is still acceptable:**

- **Deterministic template anchors:** Rows that are created from the statement template and always have a fixed id (net_income, operating_cf, etc.) can use row ID for formula and total logic, because those rows are structural and will have metadata from backfill. The important point is that *routing* (which method/schedule) should not rely only on ID for custom rows.
- **Formula references:** References like “get net income from IS” can still resolve by row id "net_income" when the IS has a single net income row. This is reference resolution, not routing. Routing is “how do we get the value for this row”; the formula that consumes it can still use id.

**What should eventually be deprecated:**

- **Exclusive use of position for BS category:** getRowsForCategory and WC item list built only from position (between total_* rows) should be deprecated in favor of cashFlowBehavior + taxonomy/category metadata. Position can remain as fallback.
- **Exclusive use of “between capex and investing_cf” for investing total:** Should be replaced by “sum all rows where cfsLink.section === investing.” Same for financing and operating.
- **Label-based COGS child → stream mapping:** Should be deprecated as the only way to assign COGS projection; add sectionOwner/taxonomy so custom COGS rows get a method without label matching.
- **Hardcoded list of financing row IDs in fallback:** Should be deprecated in favor of “all rows with cfsLink.section === financing” (and later cfsForecastDriver).

---

## 8. Risk Areas / Traps to Avoid

1. **Forecasting CFS by row order instead of driver.**  
   If the engine sums “rows between index i and j” without checking cfsLink.section or cfsForecastDriver, custom rows inserted in the wrong place can be missed or double-counted. Section totals must be driven by section metadata (or at least include all rows with that section), not by position alone.

2. **Double-counting D&A and amortization disclosures.**  
   D&A on the IS and CFS should come from a single source (the D&A schedule). If the model also has embedded disclosures (e.g. depreciation vs amortization breakdown), those should feed the same schedule or be clearly additive components, not a second standalone D&A forecast. Avoid two independent “D&A” values.

3. **Projecting BS cash directly.**  
   Cash must be derived from prior cash + net change in cash (from CFS). Projecting cash as a standalone line (e.g. % of revenue or manual) breaks the cash flow tie and can make the model inconsistent. The routing layer must never assign a direct or schedule-driven method to the cash row; it is always derived.

4. **Using taxonomy fallback as trusted routing.**  
   When taxonomy comes from label-based fallback (taxonomySource === "fallback") and taxonomyStatus is needs_review, the routing layer must not silently treat the row as fully routed. Either require user confirmation or mark the row as “suggested method” until trusted. Otherwise, misclassified rows get wrong forecasts.

5. **Projecting totals directly.**  
   No subtotal, total, or margin row (e.g. gross_profit, ebit, operating_cf, net_change_cash, total_assets) should ever receive a forecast method that writes a value. They are always derived. The routing layer must exclude these by kind (calc, subtotal, total) or by taxonomy (calc_*).

6. **Leaving ambiguous rows in active forecast logic.**  
   Rows with classificationSource === "unresolved" or missing sectionOwner/cashFlowBehavior/cfsForecastDriver should not be auto-included in schedule output or in “sum all operating rows” as if they were fully classified. Either exclude them from automatic routing (treat as manual) or surface them for review so the user assigns a driver.

7. **Overwriting user-classified rows.**  
   When classificationSource === "user", the routing layer must not replace the user’s assigned method or driver with an AI/fallback suggestion. User intent is the highest priority.

8. **WC schedule and wc_change children out of sync.**  
   If the WC schedule is driven by cashFlowBehavior but the CFS wc_change row still has “children” for display, the set of WC items in the schedule must match the set of wc_change children (or the schedule must drive both). Otherwise BS and CFS can show different WC detail or ΔWC can be wrong.

9. **Debt schedule and manual debt rows.**  
   When a debt schedule is added, rows that are currently manual (debt_issued, debt_repaid on CFS; st_debt, lt_debt on BS) must be clearly either “schedule-owned” or “manual.” Mixing both without a single source of truth causes double-counting or confusion. Routing must assign one owner per row.

10. **Ignoring trust state.**  
    Rows with forecastMetadataStatus === "needs_review" or taxonomyStatus === "needs_review" should be visible in review and not silently given a forecast method that the user has not confirmed. Avoid “quiet” application of fallback methods to unreviewed rows.

---

## 9. Recommended Implementation Order for Phase 2

Still analysis only; no coding.

1. **Define the routing layer.**  
   Implement a single module (or set of helpers) that, given a row and its statement, returns: forecast method family (or “derived” or “schedule_driven” + schedule name). Use metadata (sectionOwner, cashFlowBehavior, cfsForecastDriver, taxonomy) with the precedence defined in section 3; fallback to row ID for anchors. No value computation yet — only “how would this row be forecast.”

2. **Implement IS forecast method assignment from routing.**  
   For each IS row that is not derived, use the routing layer to assign a method family (growth_rate, percent_of_revenue, etc.). Extend existing revenue/COGS/SG&A config so that rows are keyed by id and/or by sectionOwner/taxonomy, and the engine uses routing to decide which rows get which method. Keep existing id-based config working; add metadata-based assignment for new/custom rows.

3. **Upgrade BS WC routing.**  
   Change “which rows are WC schedule items” from “wc_change.children + category by position” to “all BS rows with cashFlowBehavior === working_capital” (with fallback to current logic). Keep WC schedule math unchanged; only the *list* of items is metadata-driven. Ensure wc_change children stay in sync with that list for display.

4. **Connect CFS to cfsForecastDriver.**  
   For each CFS line item (excluding totals), use cfsForecastDriver to decide source: income_statement → pull net income from IS; danda_schedule → pull from D&A schedule; working_capital_schedule → pull −ΔWC from BS; capex_schedule → pull from Capex schedule; debt_schedule → pull from debt schedule (or manual); manual_other / financing_assumption / manual_mna → user input. Implement this dispatch so CFS projection is driver-based, not position-based. Keep position-based section totals as fallback until refactored to sum-by-section.

5. **Refactor CFS section totals to metadata.**  
   Replace “sum rows between index i and j” with “sum all rows where cfsLink.section === X” for operating_cf, investing_cf, financing_cf. Ensures custom rows are included.

6. **Add debt schedule (when scope allows).**  
   Introduce a debt schedule that produces debt balances and debt_issued/debt_repaid by year. Route BS debt rows and CFS debt_issued/debt_repaid to this schedule (by cashFlowBehavior or cfsForecastDriver). Before this, debt remains manual.

7. **Connect retained earnings and cash (derived).**  
   Ensure cash is always computed as prior cash + net change in cash, and retained earnings as prior RE + net income − dividends (and other moves). Confirm no path allows these to be forecast directly.

8. **BS category from metadata (optional refinement).**  
   Use taxonomy or explicit category for “which rows are current_assets” etc., so getRowsForCategory and WC/BS logic work for custom layouts. Position remains fallback.

9. **Review and trust gating.**  
   When applying a forecast method from taxonomy or section for rows with needs_review status, surface them in the review panel and do not treat as fully trusted until the user confirms. Optional: add “suggested method” in the UI so the user can accept or change.

10. **Deprecate legacy paths.**  
    Once metadata-based routing is stable, document and eventually remove or narrow: position-only category logic, label-only COGS mapping, hardcoded financing ID fallbacks. Keep row-ID fallback for known anchors only.

---

## 10. Migration Checklist (Optional)

**Before coding Phase 2:**

- [ ] Backfill and classification completeness are running on load and init (already in place).
- [ ] Taxonomy backfill and taxonomyStatus are applied (already in place).
- [ ] cfsForecastDriver and historicalCfsNature are set for template CFS rows and backfilled where section exists (already in place).
- [ ] All three statements have rows with sectionOwner, cashFlowBehavior, or cfsLink.section populated for template and backfilled for custom where possible.
- [ ] Review panel and confirm flow exist so that needs_review rows can be confirmed before trusting routing.

**Metadata readiness:**

- [ ] For IS: sectionOwner (or taxonomy category) is set for revenue, cogs, sga, rd, other_operating, non_operating, tax rows.
- [ ] For BS: cashFlowBehavior is set for WC, investing, financing rows; scheduleOwner can be set when apply runs.
- [ ] For CFS: cfsForecastDriver is set for every row that should receive value from a schedule or from IS (income_statement, danda_schedule, working_capital_schedule, capex_schedule, debt_schedule, manual_other, financing_assumption, etc.).

**After each Phase 2 milestone:**

- [ ] **After routing layer:** For a sample of rows (IS, BS, CFS), routing returns the expected method or driver; fallback to row ID works for template anchors when metadata is stripped.
- [ ] **After IS method assignment:** Custom IS rows with sectionOwner get a method; existing projects still project correctly with id-based config.
- [ ] **After WC routing:** BS rows with cashFlowBehavior === working_capital are included in WC schedule; wc_change and BS balances stay consistent.
- [ ] **After CFS driver connection:** CFS rows with cfsForecastDriver get values from the correct source (IS, schedules, manual); section totals include all rows in that section.
- [ ] **After debt schedule (if built):** Debt rows on BS and CFS are driven by the schedule; no double-count with manual.
- [ ] **After derived cash/RE:** Cash and retained earnings are never written by a direct or schedule method; they are always derived. Model balances.

---

**End of Phase 2 Forecast Routing Blueprint.** Use this document to implement the routing layer and Phase 2 forecasting in order, without breaking existing behavior, and to support any company structure via metadata.
