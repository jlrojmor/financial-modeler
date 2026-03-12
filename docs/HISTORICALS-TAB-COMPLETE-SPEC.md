# Historicals Tab — Complete Technical Specification (for AI)

This document describes **every aspect** of how the Historicals tab of the financial modeler webapp is programmed: data model, Income Statement (IS), Balance Sheet (BS), Cash Flow Statement (CFS), their builders and previews, calculations, cross-statement links, and all interactions. It is intended for AI consumption and human reference.

---

## 1. Overview and Entry Points

### 1.1 Wizard and Historicals Step

- **Step ID:** `"historicals"` (from `types/finance.ts`: `WizardStepId`, `WIZARD_STEPS`).
- **Store:** `currentStepId` in `store/useModelStore.ts`; default `"historicals"` on init.
- **Navigation:** Sidebar (`components/sidebar-steps.tsx`) and `goToStep(stepId)`; project page (`app/project/[id]/page.tsx`) shows `BuilderPanel` + `ExcelPreview` (or `ISBuildPreview` when step is `is_build`).

### 1.2 When Historicals Is Active

- **Builder panel** (`components/builder-panel.tsx`): When `currentStepId === "historicals"`, it renders:
  1. **YearsEditor** (always shown in all steps).
  2. A **Workflow Guide** (static text: IS → Disclosures → BS → CFS).
  3. **IncomeStatementBuilder** (unified IS builder).
  4. **BalanceSheetBuilder** with `stepId="historicals"` (historical BS only; no WC/Capex schedules).
  5. **CashFlowBuilder** (full CFS builder).

- **Excel preview** (right panel): Shows all three statements (IS, BS, CFS) in tabs or a single scrollable view; data comes from the same store (`incomeStatement`, `balanceSheet`, `cashFlow`). Which statement is shown depends on `focusStatement` and the preview component’s props (`allStatements`, `rows` per statement).

### 1.3 Validation and Continue

- **Balance check (Historicals only):** `checkBalanceSheetBalance(balanceSheet, historicalYears)` from `lib/calculations.ts`. Run in builder panel only when `currentStepId === "historicals"`. Result: per-year `totalAssets`, `totalLiabAndEquity`, `balances` (true if |difference| within tolerance), `incomplete` (missing data). Continue is blocked if `balanceCheck.hasData && !balanceCheck.isBalanced`.
- **IS classification:** `getIsRowsMissingClassification(incomeStatement)` from `lib/is-classification.ts`. Custom rows must have `sectionOwner` and `isOperating` set. Warning shown when `rowsMissingIsClassification.length > 0`; continue also blocked until resolved.
- **Reset inputs:** `resetAllFinancialInputs`, `resetIncomeStatementInputs`, `resetBalanceSheetInputs`, `resetCashFlowInputs` clear values (and optionally custom rows) per scope; structure and years are preserved.

---

## 2. Data Model and Store

### 2.1 Store Location and Persistence

- **File:** `store/useModelStore.ts` (Zustand store with persistence).
- **State:** `incomeStatement: Row[]`, `balanceSheet: Row[]`, `cashFlow: Row[]`; `meta: ModelMeta` including `meta.years.historical: string[]` (e.g. `["2022A","2023A","2024A"]`).
- **Persistence:** State is serialized into `ProjectSnapshot` / `projectStates`; `loadProject(id)` and `saveCurrentProject()` read/write by project id. Rehydration can run after mount (`_hasHydrated`).

### 2.2 Row Type and Fields

**File:** `types/finance.ts`

- **Core:** `id`, `label`, `kind` (`"input" | "calc" | "subtotal" | "total"`), `valueType`, `values?: Record<string, number>` (year → stored value in base units), `children?: Row[]`, `excelFormula?`.
- **CFS-specific:** `cfsForecastDriver?`, `cfsLink?` (`section`, `cfsItemId`, `impact`, `description`, `forecastDriver`), `historicalCfsNature?` (e.g. `"reported_non_cash_adjustment"`, `"reported_working_capital_movement"`, `"reported_operating_other"`, `"reported_meta"`), `cfsUserSetYears?: string[]` (years where user explicitly set value; used by CFO source resolution), `cfoSource?`, `forecastMetadataStatus?`, `classificationSource?`, `classificationReason?`, `classificationConfidence?`.
- **IS-specific:** `sectionOwner?` (`"revenue" | "cogs" | "sga" | "rd" | "other_operating" | "non_operating" | "tax" | "operating_expenses"`), `isOperating?`, `isTemplateRow?`.
- **BS-specific:** `cashFlowBehavior?` (`"working_capital" | "investing" | "financing" | "non_cash" | "unclassified"`), `scheduleOwner?`.
- **Links:** `isLink?` (`isItemId`, `description`) for linking a row to another statement (e.g. CFS row → IS line).

### 2.3 Updating Values: updateRowValue

**File:** `store/useModelStore.ts` (e.g. `updateRowValue(statement, rowId, year, value)`).

- **Statements:** `"incomeStatement" | "balanceSheet" | "cashFlow"`.
- **Behavior:**
  1. **updateRowValueDeep(rows, rowId, year, value):** Recursively finds the row by `id` and sets `row.values[year] = value`; returns new tree (immutable update).
  2. **Cash flow only:** `addCfsUserSetYearDeep(updated, rowId, year)` so `row.cfsUserSetYears` includes that year for the updated row. This marks the cell as “user-set” for CFO source resolution (reported CFS wins only when user has entered a value).
  3. Build `allStatements` (current IS, BS, CFS after update).
  4. Call `recomputeCalculations(updated, year, updated, allStatements, sbcBreakdowns, danaBreakdowns, ...)` for the **updated statement**.
  5. If the updated statement was **balanceSheet**, run `recomputeCalculations` again on **cashFlow** (WC and other BS-derived CFS logic depend on BS).

Helpers: `updateRowValueDeep` (lines ~117–135), `addCfsUserSetYearDeep` (lines ~138–150).

---

## 3. Historical Years

- **Source:** `meta.years.historical` (string array). Typically `["YYYYA", ...]` (suffix `A` = actual/historical).
- **Editing:** `YearsEditor` (`components/years-editor.tsx`): user sets “base year” and “number of historical years”; new array is computed (e.g. base 2024, 3 years → 2022A, 2023A, 2024A) and persisted via store action that updates `meta.years.historical`.
- **Convention:** Projection years use suffix `E` (e.g. 2025E). Code checks `year.endsWith("A")` or `year.endsWith("E")` to distinguish historical vs projection for formulas and display.

---

## 4. Income Statement (IS)

### 4.1 Structure and Template

**File:** `lib/statement-templates.ts` — `createIncomeStatementTemplate()`.

- **Order/sections:** Revenue (`rev`) → COGS (`cogs`) → Gross Profit / Gross Margin % → Operating Expenses (parent `operating_expenses` with children: `sga`, `rd`, `other_opex`, `danda`) → EBIT / EBIT Margin % → Interest & Other (non-operating) → EBT → Tax → Net Income / Net Income Margin %.
- **sectionOwner** is set on template rows (e.g. `rev` → `"revenue"`, `cogs` → `"cogs"`, `sga`/`rd`/`other_operating` under operating expenses, non-operating rows → `"non_operating"`, tax → `"tax"`). Custom rows get `sectionOwner` from AI classification or fallback (`lib/is-classification.ts`, `lib/is-fallback-classify.ts`).

### 4.2 IS Builder (Historicals)

**Component:** `components/income-statement-builder.tsx` — `IncomeStatementBuilder`.

- **Data:** Reads `incomeStatement`, `meta`, `updateRowValue`, `insertRow`, `removeRow`, `addChildRow`, `reorderIncomeStatementChildren`, `reorderIncomeStatementRows`, `updateIncomeStatementRowMetadata` from store.
- **Sections:** Rendered as collapsible sections (Revenue, COGS, Operating Expenses, Interest & Other, Tax, etc.). Rows displayed in **display order** from `getIncomeStatementDisplayOrder(incomeStatement)` (from `lib/is-classification.ts`).
- **Per row:** Edit label, values per year (inputs call `updateRowValue("incomeStatement", rowId, year, value)`), confirm/remove, classification (sectionOwner, isOperating). Optional blocks: SBC, Amortization, Depreciation, Restructuring disclosures (`SbcOptionalSection`, `AmortizationOptionalSection`, etc.) — these do **not** change reported IS line values; they are note-level breakdowns.
- **Classification:** `getIsRowsMissingClassification`, `getIsRowsClassifiedCustom`; fallback classification and AI classification (e.g. `app/api/ai/is-classify/route.ts`) can set `sectionOwner` and `isOperating`.

### 4.3 IS Display Order and Sections

**File:** `lib/is-classification.ts`.

- **getIncomeStatementDisplayOrder(rows):** Returns rows in the order they should appear: template rows by fixed order; custom rows grouped by `sectionOwner` (revenue, cogs, sga, rd, other_operating, non_operating, tax, operating_expenses).
- **getIsSectionKey(row):** Maps row to section key (e.g. sga/rd/other_operating → `"operating_expenses"` for display grouping).

### 4.4 IS in Excel Preview

**File:** `components/excel-preview.tsx`.

- **Rows:** Uses `getIncomeStatementDisplayOrder(incomeStatement ?? [])` then **flattenRows**(..., `{ forStatement: "income" }`). For income, `flattenRows` **does not expand children of SG&A**: under `parentId === "sga"` it shows only the SG&A row itself, not its children (so Historicals show a single SG&A line with user values; IS Build breakdowns appear only in IS Build step). EBITDA and EBITDA Margin (and SBC when not CFS) are skipped in the main table.
- **Values:** Each cell uses `computeRowValue(row, year, incomeStatement, incomeStatement, allStatements, sbcBreakdowns, danaBreakdowns, embeddedDisclosures, sbcDisclosureEnabled)` so calculated rows (gross profit, EBIT, net income, etc.) are computed, not only stored.
- **Sections:** `getISDisplaySection(row, parentId, rows)` maps sectionOwner to display section (e.g. sga/rd/other_operating → one “Operating Expenses” header).

### 4.5 IS Formulas (Calculations)

**File:** `lib/calculations.ts` — `computeFormula` for IS row IDs.

- **gross_profit:** rev − cogs (via findRowValue).
- **gross_margin:** (gross_profit / revenue) * 100.
- **operating_expenses:** Sum of children of `operating_expenses` row, or legacy sum of rows with `isOperatingExpenseRow(r)`.
- **ebit:** gross_profit − operating_expenses.
- **ebit_margin:** (ebit / revenue) * 100.
- **ebt:** ebit + non-operating items (interest income, other income, minus interest expense, etc.) from statement rows.
- **tax:** ebt − sum of tax rows (isTaxRow).
- **net_income:** ebt − tax (or structural net_income from children).
- **net_income_margin:** (net_income / revenue) * 100.

Parent-child enforcement: For `rev`, `cogs`, `sga`, `rd` with children, `computeRowValue` always returns sum of children (no manual parent value).

---

## 5. Balance Sheet (BS)

### 5.1 Structure and Template

**File:** `lib/statement-templates.ts` — `createBalanceSheetTemplate()`.

- **Categories:** Current Assets (cash, ar, inventory, other_ca, total_current_assets) → Fixed Assets (ppe, intangible_assets, goodwill, other_assets, total_fixed_assets) → total_assets → Current Liabilities (ap, accrued_liabilities, deferred_revenue, st_debt, other_cl, total_current_liabilities) → Non-Current Liabilities (lt_debt, other_liab, total_non_current_liabilities) → total_liabilities → Equity (common_stock, apic, treasury_stock, retained_earnings, other_equity, total_equity) → total_liab_and_equity.
- **Category mapping:** `lib/bs-category-mapper.ts` — `getBSCategoryForRow`, `getRowsForCategory` (position-based relative to total_* rows).

### 5.2 cashFlowBehavior and CFS

- **Values:** `"working_capital" | "investing" | "financing" | "non_cash" | "unclassified"` (on each BS row).
- **Working capital:** Rows with `cashFlowBehavior === "working_capital"` are used in `lib/calculations.ts`:
  - **getWcBsBalance(balanceSheet, year):** Sum of WC-tagged current assets (excluding cash, total_*) − sum of WC-tagged current liabilities (excluding st_debt, total_*). Defines “WC” from BS.
  - **getDeltaWcBs(balanceSheet, year, previousYear):** WC_BS(year) − WC_BS(previousYear). Used for **projection** `wc_change` = −getDeltaWcBs (increase in WC = use of cash).
- **Historical wc_change:** Not computed from BS in the same way; it uses **stored** CFS value (or sum of wc_change.children). So historical WC in CFS is “reported”; projection WC is BS-derived.
- **Investing / financing / non_cash:** Used for CFO intelligence (`cfo_*` rows from BS deltas), CFI/CFF classification, and impact rules (`lib/bs-impact-rules.ts`, `lib/financial-terms-knowledge.ts`).

### 5.3 BS Builder (Historicals Step)

**Component:** `components/balance-sheet-builder-unified.tsx` — `BalanceSheetBuilderUnified({ stepId })`.

- When **stepId === "historicals"**: Title “Balance Sheet (Historical)”. Only structure and value inputs; **no** WC schedule, no Capex & D&A schedule, no “missing required rows” block. User enters historical values per year; `updateRowValue("balanceSheet", rowId, year, value)`.
- When **stepId === "bs_build"**: Full builder with missing-required-rows, cash flow treatment (cashFlowBehavior), and optional schedules.

### 5.4 BS in Excel Preview

- **Flatten:** `flattenRows(balanceSheet ?? [], 0, expandedRows, { forStatement: "balance" })`.
- **Sections/Categories:** `getBSSection(rowId, rows)` (assets / liabilities / equity by position); `getBSCategory(rowId, rows)` (current_assets, fixed_assets, current_liabilities, etc.). Section and category headers drive styling and collapse.
- **Values:** Stored values and computed totals via `computeRowValue` (and for BS Build preview, overrides like `bsBuildTotalsByYear`).

### 5.5 Balance Check

**File:** `lib/calculations.ts` — `checkBalanceSheetBalance(balanceSheet, years)`.

- For each year: sum assets (total_assets or sum of asset categories), sum liabilities + equity (total_liab_and_equity or equivalent). Compares total assets vs total liab + equity; returns per-year `balances`, `difference`, `incomplete` (missing data). Used in builder panel to block “Continue” when out of balance.

---

## 6. Cash Flow Statement (CFS)

### 6.1 Structure and Template

**File:** `lib/statement-templates.ts` — `createCashFlowTemplate()`.

- **Sections (order):**
  - **Operating:** net_income, danda, sbc, wc_change, other_operating, operating_cf (total).
  - **Investing:** capex, acquisitions, asset_sales, investments, other_investing, investing_cf.
  - **Financing:** debt_issued, debt_repaid, equity_issued, share_repurchases, dividends, other_financing, financing_cf.
  - **Cash bridge:** fx_effect_on_cash (and any row with `cfsLink.section === "cash_bridge"`).
  - **Meta/total:** net_change_cash.

The fixed row **other_operating** (id `"other_operating"`) is a **placeholder container** only: it is not rendered as a line item in builder or preview; its **children** are the real “other operating” rows. Subgroup “Other Operating Activities” is still shown when there are rows with subgroup other_operating.

### 6.2 Operating Subgroups — Single Source of Truth

**File:** `lib/cfs-operating-subgroups.ts`.

- **Subgroup IDs:** `earnings_base` | `non_cash` | `working_capital` | `other_operating` | `total`.
- **Order:** `OPERATING_SUBGROUP_ORDER`: earnings_base → non_cash → working_capital → other_operating. Labels: `OPERATING_SUBGROUP_LABELS`.
- **getFinalOperatingSubgroup(row, parentId?):** **Only** function used by builder and preview to assign a row to a subgroup.
  - **Priority 1 (canonical):** net_income → earnings_base; danda | sbc → non_cash; wc_change or parentId === "wc_change" → working_capital; other_operating (row id) → other_operating; operating_cf → total.
  - **Priority 2 (metadata):** historicalCfsNature === "reported_non_cash_adjustment" → non_cash; "reported_working_capital_movement" → working_capital; "reported_operating_other" → other_operating.
  - **Priority 3:** default → other_operating.
- **groupOperatingRowsIntoBuckets(entries):** Puts each operating entry into exactly one bucket (earnings_base, non_cash, working_capital, other_operating) using `getFinalOperatingSubgroup`. Used to build the **ordered** list for preview (no duplicate headers).

### 6.3 CFS Builder

**Component:** `components/cash-flow-builder.tsx` — `CashFlowBuilder`, inner `CFSSectionComponent`.

- **Sections:** Four blocks from `CFS_SECTIONS`: Operating, Investing, Financing, Cash Bridge. Each section has `sectionId`, `totalRowId` (e.g. operating_cf, investing_cf, financing_cf); cash_bridge section ends before net_change_cash (net_change_cash is not inside any section’s “items”).
- **Operating section:** Rendered by **subgroup blocks** (not raw list). Uses `operatingDisplayBlocks`: for each subgroup in `CFO_OPERATING_SUBGROUPS` (earnings_base, non_cash, working_capital, other_operating, total), filter rows with `getFinalOperatingSubgroup(r) === sg.id`. **Working capital:** Only the **wc_change** row is shown as the WC block; its **children** are rendered inside that block (from `wc_change.children`). The fixed **other_operating** row is **excluded** from the “Other Operating” block (so no duplicate line); the block is still shown so user can add items. Rows in “Other Operating” are only those with subgroup other_operating and id !== "other_operating".
- **Investing/Financing/Cash Bridge:** Flat list of section items (excluding total row), with add/remove/reorder.
- **Net Change in Cash card:** Does **not** use `row.values` for net_change_cash. For each year it computes: operating_cf + investing_cf + financing_cf + cash_bridge (each via `computeRowValue` for the corresponding row or bridge rows). Same formula as in `lib/calculations.ts` for net_change_cash. Displays the result (or "—" if unavailable); zero shown as 0.
- **Cash Reconciliation table:** Beginning Cash (prior year BS cash) + Net Change in Cash (same computed value) vs. Balance Sheet ending cash; status Pass/Mismatch/Insufficient data.
- **Add custom row:** When adding from an operating subgroup, `addingFromOperatingSubgroup` and `subgroupWithNature` (narrowed to non_cash | working_capital | other_operating) set `newRow.historicalCfsNature` via `getDefaultNatureForOperatingSubgroup(subgroupWithNature)`. AI classification (`/api/ai/cfs-classify`) can suggest section, forecastDriver, historicalCfsNature; conservative override keeps row in the subgroup unless AI confidence is high. WC-classified rows are added as **children of wc_change** via `addWcChild(newRow)` when `addIntentSubgroupRef.current === "working_capital"` or `addingFromOperatingSubgroup === "working_capital"`.

### 6.4 wc_change and Children

- **Structure:** `wc_change` is a top-level CFS row with `children?: Row[]`. Children can be BS-derived (e.g. Change in AR, Inventory, AP) or custom (e.g. other_wc_reclass).
- **Sync from BS:** `ensureWcChildrenFromBS` / `ensureWcChildrenInCashFlow` (store): suggest WC rows from BS (WC-tagged CA/CL) as children of wc_change if not already present. User can add/remove/reorder via `addWcChild`, `moveCashFlowRowIntoWc`, `moveCashFlowRowOutOfWc`, `reorderWcChildren`.
- **Historical value:** In `computeRowValue`, for wc_change with children, historical year = sum of children’s values (with special rule for other_wc_reclass: only count if `hasMeaningfulHistoricalValue(child, year)`). Without children, historical = `row.values[year]`.
- **Projection value:** In `computeFormula`, wc_change for projection year = `-getDeltaWcBs(balanceSheet, year, previousYear)` (BS-derived; children not summed for projection).

### 6.5 CFS in Excel Preview — True Bucketed Operating

**File:** `components/excel-preview.tsx`.

- **Operating segment replacement:** For CFS, the **flat** list is not used as-is for operating rows. Instead:
  1. **operatingBuckets** = from flat: for each entry with section === "operating", assign to bucket by `getFinalOperatingSubgroup(entry.row, entry.parentId)`. The placeholder row (id `"other_operating"`) is **not** added to any bucket.
  2. **operatingOrdered** = concatenation: earnings_base, then non_cash, then working_capital, then other_operating (each bucket’s entries in original order).
  3. **flatForRender** = flat with the operating **segment** (contiguous operating indices) replaced by operatingOrdered. So the preview iterates an ordered list where each subgroup appears once and in fixed order.
- **Subgroup headers:** Rendered when the **subgroup changes** from the previous row (prevSubgroup !== currentSubgroup). Because order is bucketed, each of Earnings Base, Non-Cash Adjustments, Working Capital Adjustments, Other Operating Activities appears **at most once**.
- **Values:** Same as elsewhere: `computeRowValue(row, year, rows, rows, allStatements, ...)` for calculated rows (net_income, danda, sbc, wc_change, operating_cf, investing_cf, financing_cf, net_change_cash). CFS-specific: for net_income, danda, sbc, wc_change the preview uses the same resolution as the calculation engine (see Cross-Statement below).

### 6.6 CFS Formulas (Calculations)

**File:** `lib/calculations.ts` — `computeFormula` for CFS row IDs.

- **net_income (in CFS):** Always `resolveHistoricalCfoValueOnly("net_income", year, context)` → IS net_income (no stored CFS value).
- **danda:** Resolver: 1) user-set CFS value, 2) IS danda, 3) danaBreakdowns[year], 4) 0.
- **sbc:** Resolver: 1) user-set CFS value, 2) SBC disclosure total (if sbcDisclosureEnabled), 3) 0.
- **wc_change:** Historical: stored or sum of children (with other_wc_reclass only if meaningful). Projection: -getDeltaWcBs(...).
- **operating_cf:** Sum of top-level operating rows between net_income and operating_cf (each item’s value from findRowValue or resolver for net_income/danda/sbc). Fallback: net_income + danda + sbc + wc_change + other_operating + cfo_* items from BS deltas.
- **investing_cf:** Sum of investing section items (between capex and investing_cf, plus any cfsLink.section === "investing").
- **financing_cf:** Sum of financing section items (between debt_issued and financing_cf, plus any cfsLink.section === "financing").
- **net_change_cash:** operating_cf + investing_cf + financing_cf + cash_bridge. Section totals are obtained via **computeRowValue** for operating_cf, investing_cf, financing_cf (so they are always computed, not only findRowValue); cash_bridge = sum of fx_effect_on_cash and rows with cfsLink.section === "cash_bridge" (findRowValue).
- **cfo_* rows:** From BS row deltas (current − previous year), sign from cfsLink.impact.

---

## 7. Cross-Statement Interactions

### 7.1 Net Income: IS → CFS

- CFS **never** stores or displays a separate “net_income” value. Whenever the calculation or preview needs net_income for CFS, it calls `resolveHistoricalCfoValueOnly("net_income", year, context)` which returns `incomeStatement.find(r => r.id === "net_income")?.values?.[year] ?? 0`. So CFS net_income is always the **current IS net_income**.

### 7.2 D&A and SBC: Resolver Hierarchy

**File:** `lib/cfo-source-resolution.ts` — `resolveHistoricalCfoValue(rowId, year, context)` and `resolveHistoricalCfoValueOnly`.

- **D&A (danda):** 1) If CFS row has a **meaningful** user-set value for that year (`hasMeaningfulHistoricalValue(dandaRow, year)` → row.cfsUserSetYears includes year and values[year] is defined), return reported CFS value. 2) Else Income Statement `danda` row values[year]. 3) Else `danaBreakdowns[year]`. 4) Else 0.
- **SBC (sbc):** 1) If CFS row has meaningful user-set value, return reported CFS. 2) Else if `sbcDisclosureEnabled`, return `getTotalSbcForYearFromEmbedded(embeddedDisclosures, year)`. 3) Else 0.
- **Amortization (e.g. contract costs):** 1) User-set CFS value. 2) Else `getTotalAmortizationForYearFromEmbedded(embeddedDisclosures, year)`. 3) Else 0.
- **wc_change:** Historical: stored CFS value (reported). Projection: not resolved here; formula uses -getDeltaWcBs.
- **other_operating:** Stored CFS value only.

`hasMeaningfulHistoricalValue` is true only when the user has explicitly set that cell (cfsUserSetYears includes the year and value is defined). So “reported CFS” wins only when the user has entered a value; otherwise IS or disclosure is used.

### 7.3 When Resolver Is Used

- **computeFormula** (in calculations.ts): For rowId net_income, danda, sbc when `isInCFS && allStatements`, it uses `resolveHistoricalCfoValueOnly(...)`.
- **operating_cf** formula: Uses resolver for net_income, danda, sbc in its fallback path; primary path sums items via findRowValue (which for those rows may still be 0 if not stored; recomputeCalculations writes computed values back so after recompute, findRowValue sees them).
- **Preview:** For CFS calculated items (net_income, danda, sbc, wc_change, operating_cf, etc.) the preview calls `computeRowValue`, which in turn uses computeFormula and thus the resolver where applicable.

### 7.4 Balance Sheet → CFS

- **WC:** BS rows with `cashFlowBehavior === "working_capital"` feed getWcBsBalance and getDeltaWcBs. Projection wc_change = -getDeltaWcBs. Historical wc_change is user/reported only (or sum of wc children).
- **CFO intelligence:** Rows with id `cfo_<bsRowId>` and cfsLink are computed from BS row year-over-year change; sign from cfsLink.impact. They contribute to operating_cf in the fallback sum.
- **ensureWcChildrenFromBS:** Suggests WC children in CFS from BS WC-tagged rows so structure stays in sync.

---

## 8. Calculations Engine

### 8.1 computeRowValue

**File:** `lib/calculations.ts`.

- **Signature:** (row, year, allRows, statementRows, allStatements?, sbcBreakdowns?, danaBreakdowns?, embeddedDisclosures?, sbcDisclosureEnabled?).
- **Logic:** Parent-child (rev/cogs/sga/rd with children → sum of children). Special: wc_change historical = children sum or stored; projection → computeFormula. Input → row.values[year]. Calc/subtotal/total with children → sum of children. Otherwise → computeFormula(row, year, statementRows, allStatements, ...).

### 8.2 computeFormula

- Implements all formula row IDs (CFS, IS, BS). Uses **findRowValue(statementRows, id, year)** for most dependencies; for CFS net_income, danda, sbc uses **resolveHistoricalCfoValueOnly** when isInCFS && allStatements. **findValueAnywhere** (when allStatements) checks IS, BS, CFS in order for cross-statement lookups.

### 8.3 findRowValue

**File:** `lib/calculations.ts`.

- **Signature:** (rows, rowId, year) → number.
- **Behavior:** Recursive search by id. If input with stored value → return it. If calc/subtotal/total with children → sum children (recursing for nested). If input with children but no stored value → sum children. Else row.values?.[year] ?? 0. Does **not** call the CFO resolver; that is only inside computeFormula for specific CFS row IDs.

### 8.4 recomputeCalculations

**File:** `lib/calculations.ts`.

- **Role:** For a given **year** and **statement**, updates every row’s `values[year]`: for input rows with children (e.g. rev, cogs, sga, rd, wc_change), writes sum of children (with wc_change/other_wc_reclass rules); for calc/subtotal/total, writes `computeRowValue(...)`. Returns new row tree with updated values.
- **Called after:** updateRowValue (for the changed statement and, if BS changed, for cashFlow); initializeModel (per year); addRowFromCfsSuggestions; moveCashFlowRowIntoWc/OutOfWc; reorderWcChildren; addWcChild; year add/remove; setSbcDisclosureEnabled; persistBSBuildIntoGlobal; and other state changes that affect statement values.

---

## 9. Embedded Disclosures

- **Types:** SBC, amortization_intangibles, depreciation_embedded, restructuring_charges (`types/finance.ts`). Stored in `state.embeddedDisclosures: EmbeddedDisclosureItem[]`. Also `sbcBreakdowns`, `danaBreakdowns`, `danaLocation` in store.
- **SBC:** Feeds CFS sbc via resolver when sbcDisclosureEnabled. IS optional section shows breakdown (SG&A/COGS/R&D); does not change reported IS line values.
- **D&A:** IS danda row holds user or migrated value; CFS danda uses resolver (reported → IS → danaBreakdowns). Amortization disclosure feeds CFS amortization row via resolver.
- **Restructuring / Depreciation (embedded):** Used in disclosure preview and optional sections; do not override reported IS/CFS line values.

---

## 10. Flatten and Preview Details

### 10.1 flattenRows

**File:** `components/excel-preview.tsx`.

- **Signature:** (rows, depth, expandedRows, options?, parentId?) → Array<{ row, depth, parentId }>.
- **options.forStatement:** "income" | "balance" | "cashflow".
- **Income:** Skips EBITDA, EBITDA Margin; skips SBC-only rows when not CFS; **does not expand children of SG&A** (skipExpandUnderSga) so Historicals show one SG&A line.
- **Balance:** Expands all children when expandedRows has parent.
- **Cashflow:** Expands all children when expanded; no SBC skip. Result is tree order.

### 10.2 CFS Section and Sign in Preview

- **getCFSSection(rowId, rows, parentId):** If parentId, use parent’s section; else cfsLink.section, else CFS_SECTION_BY_ROW_ID, else position-based (operating between net_income and operating_cf, etc.). Returns operating | investing | financing | cash_bridge | meta.
- **getCFOSign(rowId, row, section, parentId):** Returns "+" or "-" for display. Uses row id (net_income, danda, sbc, wc_change, other_operating), parentId for WC children (label-based), and cfsLink.impact for custom rows.

---

## 11. AI Classification and Metadata

- **CFS:** POST `/api/ai/cfs-classify` with label, sectionContext, optional operatingSubgroup (non_cash | working_capital | other_operating). Returns section, forecastDriver, historicalCfsNature, sign, reason, confidence. Builder applies suggestion with override: if confidence &lt; threshold and AI would move row out of subgroup, keep subgroup default nature.
- **IS:** Classification sets sectionOwner and isOperating for custom rows so display order and formulas (operating expenses, EBT) are correct.
- **Default nature for subgroup:** getDefaultNatureForOperatingSubgroup(subgroup) → reported_non_cash_adjustment (non_cash), reported_working_capital_movement (working_capital), reported_operating_other (other_operating). Used when adding a row from a subgroup so it lands in the right bucket before AI runs.

---

## 12. File and Function Index

| Topic | File | Key symbols |
|-------|------|-------------|
| Row, Meta, Steps | `types/finance.ts` | Row, ModelState, ModelMeta, WizardStepId, WIZARD_STEPS, EmbeddedDisclosureItem |
| Store, updateRowValue, recompute | `store/useModelStore.ts` | incomeStatement, balanceSheet, cashFlow, meta.years.historical, updateRowValue, updateRowValueDeep, addCfsUserSetYearDeep, recomputeCalculations, ensureCFSAnchorRows, ensureWcChildrenFromBS |
| IS template | `lib/statement-templates.ts` | createIncomeStatementTemplate |
| BS template | `lib/statement-templates.ts` | createBalanceSheetTemplate |
| CFS template | `lib/statement-templates.ts` | createCashFlowTemplate |
| Calculations | `lib/calculations.ts` | computeRowValue, computeFormula, findRowValue, recomputeCalculations, getWcBsBalance, getDeltaWcBs, checkBalanceSheetBalance |
| CFO source | `lib/cfo-source-resolution.ts` | resolveHistoricalCfoValue, resolveHistoricalCfoValueOnly, hasMeaningfulHistoricalValue |
| CFS subgroups | `lib/cfs-operating-subgroups.ts` | getFinalOperatingSubgroup, groupOperatingRowsIntoBuckets, OPERATING_SUBGROUP_ORDER, OPERATING_SUBGROUP_LABELS |
| IS classification | `lib/is-classification.ts` | getIncomeStatementDisplayOrder, getIsSectionKey, getIsRowsMissingClassification |
| BS categories | `lib/bs-category-mapper.ts` | getBSCategoryForRow, getRowsForCategory |
| SBC disclosure | `lib/embedded-disclosure-sbc.ts` | getTotalSbcForYearFromEmbedded |
| Amortization disclosure | `lib/embedded-disclosure-amortization.ts` | getTotalAmortizationForYearFromEmbedded |
| CFS forecast drivers | `lib/cfs-forecast-drivers.ts` | HISTORICAL_CFS_NATURE_VOCABULARY, getHistoricalNatureForAnchor |
| Builder panel | `components/builder-panel.tsx` | currentStepId === "historicals", IncomeStatementBuilder, BalanceSheetBuilder stepId="historicals", CashFlowBuilder, balanceCheck, rowsMissingIsClassification |
| IS builder | `components/income-statement-builder.tsx` | IncomeStatementBuilder |
| BS builder | `components/balance-sheet-builder-unified.tsx` | BalanceSheetBuilderUnified, stepId historicals | bs_build |
| CFS builder | `components/cash-flow-builder.tsx` | CashFlowBuilder, CFSSectionComponent, operatingDisplayBlocks, getFinalOperatingSubgroup, Net Change in Cash card, Cash Reconciliation |
| Excel preview | `components/excel-preview.tsx` | flattenRows, flatForRender (CFS), operatingBuckets, getCFSSection, getISDisplaySection, getBSSection, getCFOSign, computeRowValue |
| Years | `components/years-editor.tsx` | YearsEditor, meta.years.historical |
| CFS classify API | `app/api/ai/cfs-classify/route.ts` | POST, operatingSubgroup, OperatingSubgroup |

---

This specification reflects the codebase behavior of the Historicals tab and the interactions among IS, BS, and CFS as implemented in the referenced files.
