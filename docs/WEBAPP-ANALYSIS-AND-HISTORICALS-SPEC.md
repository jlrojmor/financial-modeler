# Financial Model Builder — Webapp Analysis and Historicals Specification

This document is a **technical analysis and specification** of the Financial Model Builder webapp. It is written for consumption by another AI or developer who needs to understand: (1) the application’s goal and architecture, (2) the technology and language used, (3) the workflow and navigation model, and (4) an extremely detailed description of how the **Historicals** section is built and how all of its functionalities work. Terminology and file paths are precise so that an AI can reason about the codebase without ambiguity.

---

## Part 1: Application Goal and High-Level Architecture

### 1.1 Purpose of the Application

The **Financial Model Builder** is a **single-page-style web application** (with client-side routing) that guides a user through building an **investment-banking-style financial model** (DCF/LBO). The goal is to:

1. **Capture company context** (Company Context step) — minimal inputs plus AI enrichment for WACC, benchmarking, and comps.
2. **Capture and normalize historical financials** (Historicals step) — Income Statement (IS), Balance Sheet (BS), and Cash Flow Statement (CFS) with classification, taxonomy, and review.
3. **Structure the model** (IS Build, BS Build, CFS Build steps) — define revenue streams, BS structure, and CFS structure.
4. **Define schedules** (Schedules step) — Working Capital, Capex/D&A, optional intangibles.
5. **Project** (Projections step) — forecast revenue, COGS, SG&A, and link to schedules.
6. **Value** (DCF step) — UFCF, WACC, terminal value.

The app follows a **wizard workflow**: one current step, a sidebar of steps, and “Continue” to advance only after the current step is marked complete (saved). **No long intake forms**; the design favors **minimal input → enrichment → editable context** where possible.

### 1.2 Technology Stack and Language

- **Framework:** Next.js 16 (App Router). React 19. TypeScript 5.
- **State:** Zustand 5 with persistence (localStorage). Single global store; no Redux or React Context for model data.
- **Styling:** Tailwind CSS 4 (PostCSS). No component library; custom UI with `slate`-based dark theme.
- **Font:** Plus Jakarta Sans (Next.js `next/font/google`).
- **Other:** ExcelJS for Excel export; nanoid for IDs; Zod for validation where used; lucide-react for icons.

**Conventions:**

- **File layout:** `app/` for routes and layout; `components/` for React components; `lib/` for pure logic, helpers, and engines; `store/` for Zustand store; `types/` for TypeScript interfaces and shared types.
- **Data flow:** Components read from `useModelStore(selector)` and call store actions. No prop-drilling of full statement trees; the store is the single source of truth.
- **Immutability:** The store uses functional updates (e.g. `set((s) => ({ ...s, incomeStatement: newRows }))`). Row trees are updated by mapping over arrays and returning new objects; `recomputeCalculations` returns a new tree with updated `values` per year.
- **Controlled vocabulary:** Row metadata (e.g. `sectionOwner`, `cashFlowBehavior`, `historicalCfsNature`, `taxonomyType`) uses string literal unions defined in `types/finance.ts` and related libs. Free-text is avoided for classification.

### 1.3 Routing and Entry Points

- **Route `/`:** Renders `LandingPage` (`components/landing-page.tsx`). User sees existing projects (from store) or can start a “New model”; “New model” opens `ModelSetup` to set company name and basic meta, then calls `createProject(name, meta, { fromCurrentState: true })` and navigates to `/project/[id]`.
- **Route `/project/[id]`:** Main workspace (`app/project/[id]/page.tsx`). Loads project by ID from `projectStates[id]` via `loadProject(id)`. Renders:
  - A **header** with “Financial Model Builder”, project name, and current step label (from explicit `STEP_LABEL` map by `currentStepId`).
  - **Sidebar:** `SidebarSteps` — lists all steps from `WIZARD_STEPS`; highlights `currentStepId` and `completedStepIds`; each step is a button calling `goToStep(step.id)`.
  - **Main area:** Two-column grid: left = `BuilderPanel`, right = `ExcelPreview` (or `ISBuildPreview` when step is `is_build`, or `CompanyContextPreview` when step is `company_context`).

**Wizard steps (order):** Defined in `types/finance.ts` as `WIZARD_STEPS`. Current sequence: `company_context` → `historicals` → `is_build` → `bs_build` → `cfs_build` → `schedules` → `projections` → `dcf`. Step IDs are the single source for sidebar and navigation; display labels in the header come from `STEP_LABEL` in the project page (e.g. `historicals` → `"Historicals"`).

### 1.4 Persistence and Multi-Project

- **Store shape:** `projectStates: Record<string, ProjectSnapshot>` — each key is a project ID. `currentProjectId` is the active project when in `/project/[id]`.
- **ProjectSnapshot:** Contains `meta`, `incomeStatement`, `balanceSheet`, `cashFlow`, `schedules`, all step-related and schedule-related state (e.g. `revenueProjectionConfig`, `cogsPctByRevenueLine`, `companyContext`, etc.). Built by `getProjectSnapshot(state)` in the store; applied by `applyProjectSnapshot(set, snapshot)` on load.
- **Persistence:** Zustand `persist` middleware serializes the store (including `projectStates`) to localStorage. On load, `loadProject(id)` applies the snapshot for that ID to the global state and sets `currentProjectId`, `isInitialized`, and recalculates; backfills (classification, taxonomy, CFS metadata) run in `applyProjectSnapshot` or immediately after.

---

## Part 2: Workflow and Step Mechanics

### 2.1 Step Completion and Continue

- **completedStepIds:** Array of step IDs the user has “saved”. Updated by `saveCurrentStep()` and `completeCurrentStep()`.
- **Continue button:** Enabled only when `completedStepIds.includes(currentStepId)` and step-specific guards pass (e.g. Historicals: balance sheet must balance and no IS rows missing classification). Clicking it calls `continueToNextStep()`, which sets `currentStepId` to the next step in `WIZARD_STEPS`.
- **Save button:** Calls `saveCurrentStep()` (marks current step complete) and `saveCurrentProject()` (writes current state into `projectStates[currentProjectId]`). No server; all persistence is client-side (localStorage via Zustand persist).

### 2.2 Builder Panel and Step-Specific Content

**File:** `components/builder-panel.tsx`

- **YearsEditor** is rendered for all steps **except** `company_context`. It edits `meta.years.historical` and `meta.years.projection` (base year and count).
- Step-specific blocks:
  - `company_context` → `CompanyContextTab`
  - `historicals` → Workflow guide, Rows Requiring Review panel (if any), IncomeStatementBuilder, BalanceSheetBuilder with `stepId="historicals"`, CashFlowBuilder
  - `is_build` → `ISBuildView`
  - `bs_build` → BalanceSheetBuilder with `stepId="bs_build"`
  - `cfs_build` → CashFlowBuilder
  - `projections` → `RevenueProjectionStep`
  - Other steps → placeholder “coming soon” message.
- **Reset inputs:** Modal to choose scope (all, IS only, BS only, CFS only); resets values and optionally custom rows; structure and years are preserved.
- **Review panel (Historicals only):** Renders when `currentStepId === "historicals"`. Uses `getReviewItemsForHistoricals(classificationReport, { incomeStatement, balanceSheet, cashFlow })` to show only **actionable** rows (e.g. needs setup, needs confirmation). Each item can have a “Confirm” button that calls `confirmRowReview(statement, rowId)` to set the row to trusted and remove it from the list.

---

## Part 3: Very Detailed Specification of the Historicals Section

The **Historicals** step is the core data-entry step for the three financial statements. Every concept below is implemented in the codebase as described; an AI can use this to locate and reason about behavior.

### 3.1 Step Identity and Activation

- **Step ID:** `"historicals"` (type `WizardStepId` in `types/finance.ts`).
- **When active:** `currentStepId === "historicals"` in the store. Builder panel then renders the Historicals-specific layout; the right panel shows `ExcelPreview` with `focusStatement` default (full model: IS, BS, CFS in one scrollable table).
- **Entry:** User can land here by opening a project that was saved with `currentStepId === "historicals"` or by clicking the “Historicals” step in the sidebar. New projects initialize with `currentStepId === "company_context"`; after completing Company Context the user continues to Historicals.

### 3.2 Data Model: The Row Type

**File:** `types/finance.ts` — interface `Row`.

Every line item in IS, BS, or CFS is a **Row** with:

- **Core:** `id` (string, unique within statement), `label` (display), `kind`: `"input" | "calc" | "subtotal" | "total"`, `valueType`: `"currency" | "percent" | "number" | "text"`, `values?: Record<string, number>` (year → value in **stored/base units**), `children?: Row[]`, `excelFormula?`.
- **IS-specific:** `sectionOwner?` (e.g. `"revenue" | "cogs" | "sga" | "rd" | "other_operating" | "non_operating" | "tax" | "operating_expenses"`), `isOperating?` (boolean), `isTemplateRow?`.
- **BS-specific:** `cashFlowBehavior?` (`"working_capital" | "investing" | "financing" | "non_cash" | "unclassified"`), `scheduleOwner?` (`"wc" | "capex" | "intangibles" | "debt" | "none"`).
- **CFS-specific:** `cfsLink?` (`section`, `impact`, `description`, etc.), `historicalCfsNature?` (e.g. `"reported_non_cash_adjustment"`, `"reported_working_capital_movement"`, `"reported_operating_other"`, `"reported_investing"`, `"reported_financing"`, `"reported_meta"`), `cfsForecastDriver?`, `cfsUserSetYears?` (years where user explicitly set a value for this CFS row), `cfoSource?`.
- **Classification and taxonomy:** `classificationSource?` (`"user" | "ai" | "fallback" | "unresolved"`), `classificationReason?`, `classificationConfidence?`, `forecastMetadataStatus?` (`"trusted" | "needs_review"`), `taxonomyType?`, `taxonomyCategory?`, `taxonomySource?`, `taxonomyStatus?`.

**Year keys:** Historical years use suffix `A` (e.g. `2022A`, `2023A`); projection years use `E`. Stored values are in a **base unit** (e.g. millions); display conversion is done in UI via `lib/currency-utils.ts` (`storedToDisplay`, `displayToStored`, `getUnitLabel`).

### 3.3 Store State Relevant to Historicals

**File:** `store/useModelStore.ts`

- **incomeStatement: Row[]** — tree of IS rows (top-level and nested, e.g. under `operating_expenses`, `rev`, `cogs`).
- **balanceSheet: Row[]** — tree of BS rows.
- **cashFlow: Row[]** — tree of CFS rows. **Structural rule:** Rows with final operating subgroup `working_capital` must be **children of the row with id `wc_change`**. Top-level operating rows are either `net_income`, `danda`, `sbc`, `wc_change` (and its children), `other_operating` (placeholder), or custom rows in non_cash/other_operating.
- **meta.years.historical: string[]** — list of historical year keys.
- **embeddedDisclosures**, **sbcDisclosureEnabled**, **danaBreakdowns**, **danaLocation** — used for CFS value resolution (SBC, D&A, amortization from disclosures).
- **sectionLocks**, **sectionExpanded**, **confirmedRowIds**, **wcExcludedIds** — UI and WC exclusion state.

**Key actions used in Historicals:**

- **updateRowValue(statement, rowId, year, value):** Recursively finds the row by `id`, sets `values[year] = value`; for CFS, adds `year` to `cfsUserSetYears` for that row; then calls `recomputeCalculations` on the updated statement (and on cashFlow if statement was balanceSheet).
- **updateIncomeStatementRowMetadata(rowId, patch):** Sets `sectionOwner`, `isOperating`, `classificationSource`, etc., on an IS row.
- **updateBalanceSheetRowMetadata** (if used) / **setBalanceSheetRowCashFlowBehavior(rowId, behavior):** Sets `cashFlowBehavior` on a BS row.
- **updateCashFlowRowMetadata(rowId, patch):** Sets `cfsForecastDriver`, `historicalCfsNature`, `cfsLink`, etc., on a CFS row. After update, **normalizeWcStructure** is called so that any top-level row whose final subgroup is `working_capital` is moved into `wc_change.children`.
- **addChildRow**, **insertRow**, **removeRow**, **moveRow:** All apply taxonomy (and for CFS, normalization) as needed; CFS inserts/removals/moves trigger **normalizeWcStructure**.
- **moveCashFlowRowOutOfWc(rowId, insertAtTopLevelIndex?, targetSubgroup?):** Removes row from `wc_change.children`, inserts it at top-level operating, and sets metadata to the target subgroup (`reported_non_cash_adjustment` or `reported_operating_other`).
- **moveCashFlowRowIntoWc(rowId):** Removes row from top-level, adds it as child of `wc_change` with `historicalCfsNature: "reported_working_capital_movement"`.
- **renameRow(statement, rowId, newLabel):** Updates label and, for non-template rows, re-applies taxonomy and sets `forecastMetadataStatus` / `taxonomyStatus` to `needs_review` so the row re-enters review.
- **confirmRowReview(statement, rowId):** Sets the row’s `forecastMetadataStatus`, `taxonomyStatus` to `"trusted"` and `classificationSource` to `"user"` so it leaves the review panel and no longer shows a confirmation badge.

### 3.4 Income Statement in Historicals

**Template:** `lib/statement-templates.ts` — `createIncomeStatementTemplate()`. Order: Revenue (`rev`) → COGS (`cogs`) → Gross Profit / Gross Margin % → Operating Expenses parent (`operating_expenses`) with children (e.g. `sga`, `rd`, `other_opex`, `danda`) → EBIT / EBIT Margin % → Interest & Other (non-operating) → EBT → Tax → Net Income / Net Income Margin %. Template rows have `sectionOwner` and `isOperating` set; they are “deterministic” and never require classification.

**Display order:** `lib/is-classification.ts` — `getIncomeStatementDisplayOrder(incomeStatement)` returns rows in the order they should appear in the builder and preview. Custom rows are grouped by `sectionOwner`; section keys like `sga`, `rd`, `other_operating` under operating expenses are grouped under one “Operating Expenses” block.

**Builder:** `components/income-statement-builder.tsx` — `IncomeStatementBuilder`. Renders sections (Revenue, COGS, Operating Expenses, Interest & Other, Tax) and uses **UnifiedItemCard** for each row. For each row it passes:

- **reviewState:** from `getFinalRowClassificationState(row, "income")` in `lib/final-row-classification.ts` — one of `trusted`, `needs_confirmation`, `setup_required`.
- **onConfirmSuggestion:** calls `confirmRowReview("incomeStatement", row.id)`.
- **showEditRow:** true for custom/removable rows (not calculated, not protected).
- **onEditRow**, **editingLabelRowId**, **editingLabelValue**, **onSaveEditLabel**, **onCancelEditLabel:** inline label editing; on save, `renameRow("incomeStatement", rowId, value)` is called.

**Classification:** Custom IS rows must have `sectionOwner` and `isOperating` set. `getIsRowsMissingClassification(incomeStatement)` returns rows missing either. The builder panel blocks “Continue” when this list is non-empty and shows a warning. Classification can be set via metadata UI (section dropdown, operating toggle) or by confirming an AI suggestion. **Final row classification** (for badges and review panel) is computed by `getFinalRowClassificationState(row, "income", context)` which combines user override, template, placement, AI, and fallback, and returns `reviewState` and `suggestedLabel`.

**Optional disclosure sections:** SBC, Amortization, Depreciation, Restructuring (e.g. `SbcOptionalSection`, `AmortizationOptionalSection`) are note-level breakdowns stored in `embeddedDisclosures`; they do **not** change reported IS line values. They feed CFS resolvers when enabled (e.g. SBC disclosure → CFS SBC when `sbcDisclosureEnabled`).

**Formulas:** `lib/calculations.ts` — for IS, `computeFormula` implements gross_profit (rev − cogs), gross_margin, operating_expenses (sum of children or legacy sum), ebit, ebit_margin, ebt (ebit + non-operating items), tax, net_income, net_income_margin. Parent rows with children (e.g. `rev`, `cogs`, `sga`) use **sum of children** in `computeRowValue`; no stored parent value is used for those.

### 3.5 Balance Sheet in Historicals

**Template:** `lib/statement-templates.ts` — `createBalanceSheetTemplate()`. Categories: Current Assets → Fixed Assets → Total Assets → Current Liabilities → Non-Current Liabilities → Total Liabilities → Equity → Total Liab & Equity. Rows are mapped to categories (e.g. current_assets, fixed_assets) via `lib/bs-category-mapper.ts` — `getBSCategoryForRow`, `getRowsForCategory` (position relative to total_* rows).

**Builder:** `components/balance-sheet-builder-unified.tsx` — `BalanceSheetBuilderUnified({ stepId })`. When **stepId === "historicals"** it only shows “Balance Sheet (Historical)” and the list of rows with value inputs; no WC schedule, no Capex/D&A schedule, no “missing required rows” block. Each row is rendered with **UnifiedItemCard**; for non-total rows it can show **cashFlowBehaviorDropdown** (Working Capital, Investing, Financing, Non-cash) which calls `setBalanceSheetRowCashFlowBehavior(rowId, behavior)`. **reviewState** and **onConfirmSuggestion** come from `getFinalRowClassificationState(row, "balance")` and `confirmRowReview("balanceSheet", row.id)`. Label editing is supported; on save, `renameRow("balanceSheet", rowId, value)`.

**Balance check:** `lib/calculations.ts` — `checkBalanceSheetBalance(balanceSheet, years)`. For each year, computes total assets and total liabilities + equity; returns per-year `balances` (true if within tolerance), `difference`, `incomplete`. The builder panel runs this when `currentStepId === "historicals"` and blocks “Continue” if `balanceCheck.hasData && !balanceCheck.isBalanced`.

**cashFlowBehavior:** Used for (1) CFS Working Capital derivation in projections (WC-tagged BS rows → getWcBsBalance, getDeltaWcBs), (2) CFI/CFF classification and suggestions, (3) “Rows Requiring Review” when a BS row has `cashFlowBehavior === "unclassified"` (in BS Build step; in Historicals, BS builder still allows setting behavior).

### 3.6 Cash Flow Statement in Historicals

**Template:** `lib/statement-templates.ts` — `createCashFlowTemplate()`. Sections: Operating (net_income, danda, sbc, wc_change, other_operating, operating_cf) → Investing (capex, acquisitions, …) → Financing (debt_issued, …) → Cash bridge (e.g. fx_effect_on_cash) → net_change_cash. The row with **id `other_operating`** is a **placeholder container** only; it is not rendered as a line item. The “Other Operating Activities” **subgroup** is a block that contains custom rows with subgroup other_operating; the fixed `other_operating` row itself is excluded from display.

**Operating subgroups — single source of truth:** `lib/cfs-operating-subgroups.ts`.

- **getFinalOperatingSubgroup(row, parentId):** The **only** function used by builder and preview to assign an operating row to a subgroup. Priority: (1) Canonical: net_income → earnings_base; danda | sbc → non_cash; wc_change or parentId === "wc_change" → working_capital; other_operating (id) → other_operating; operating_cf → total. (2) Metadata: historicalCfsNature → non_cash | working_capital | other_operating. (3) Fallback: other_operating.
- **OPERATING_SUBGROUP_ORDER:** earnings_base → non_cash → working_capital → other_operating. **Structural rule:** Any row whose final subgroup is `working_capital` must live under **wc_change.children**. The store’s **normalizeWcStructure** moves such rows from top-level into `wc_change.children` whenever CFS is updated (insert, addChild, move, remove, metadata update).

**Builder:** `components/cash-flow-builder.tsx` — `CashFlowBuilder`. Operating section is rendered as **subgroup blocks** (Earnings Base, Non-Cash Adjustments, Working Capital Adjustments, Other Operating Activities). For each subgroup it filters rows with `getFinalOperatingSubgroup(r) === subgroupId`. Working Capital block shows the **wc_change** row and its **children** (from `wc_change.children`). User can drag a row out of WC into Non-Cash or Other Operating; the drop handler calls `moveCashFlowRowOutOfWc(rowId, index, targetSubgroup)` so the row is structurally moved and metadata updated. Conversely, dragging into WC calls `moveCashFlowRowIntoWc(rowId)`. Adding a custom row from a subgroup sets `historicalCfsNature` via `getDefaultNatureForOperatingSubgroup`; if the subgroup is working_capital, the new row is added as a child of wc_change via `addWcChild`.

**Net Change in Cash card:** Does **not** use `row.values` for the net_change_cash row. For each year it computes: operating_cf + investing_cf + financing_cf + cash_bridge (each via `computeRowValue` for the corresponding section total or bridge rows). Displays the result; zero is shown as 0, missing as "—".

**Cash Reconciliation table:** Beginning Cash (prior year BS cash) + Net Change in Cash (same computed value) vs. Balance Sheet ending cash; shows Pass/Mismatch/Insufficient data. Uses `formatIntegerWithSeparators` from `lib/currency-utils.ts` for numeric display (thousands separators, negatives in parentheses).

**SBC row editability:** The CFS SBC row is read-only for a given year **only if** `hasSbcDisclosureValueForYear(year, embeddedDisclosures, sbcDisclosureEnabled)` is true (i.e. there is meaningful SBC disclosure data for that year). Otherwise the user can edit the cell; user-set values are respected via the CFO source hierarchy.

**CFS value resolution (CFO source):** `lib/cfo-source-resolution.ts`.

- **net_income:** Always from Income Statement; CFS never stores a separate net_income value. `resolveHistoricalCfoValueOnly("net_income", year, context)` returns IS net_income.
- **danda:** (1) Meaningful user-set CFS value (same year in cfsUserSetYears and values[year] defined), (2) IS danda row, (3) danaBreakdowns[year], (4) 0.
- **sbc:** (1) Meaningful user-set CFS value, (2) if sbcDisclosureEnabled then total from embeddedDisclosures (SBC), (3) 0.
- **wc_change:** Historical = stored CFS value or sum of children (with special rule for other_wc_reclass: only count if hasMeaningfulHistoricalValue). Projection = -getDeltaWcBs(balanceSheet, year, prevYear).

`hasMeaningfulHistoricalValue(row, year)` is true only when the user has explicitly set that cell (year in cfsUserSetYears and value defined). So “reported CFS” wins only when the user has entered a value; otherwise IS or disclosure is used.

### 3.7 Excel Preview and Flattening

**File:** `components/excel-preview.tsx`

- **flattenRows(rows, depth, expandedRows, options, parentId):** Produces a flat list of `{ row, depth, parentId }`. `options.forStatement`: "income" | "balance" | "cashflow". For **income**, children of SG&A are **not** expanded (Historicals show one SG&A line). For CFS, operating rows are later re-ordered by subgroup.
- **Income Statement in preview:** Uses `getIncomeStatementDisplayOrder` then flattens. Each cell value uses `computeRowValue(row, year, ...)` so calculated rows (gross profit, EBIT, net income, etc.) are computed. Section headers (e.g. Operating Expenses) come from `getISDisplaySection`. **Anchor row styling:** Rows with id in `["rev", "gross_profit", "ebit", "ebt", "net_income"]` get stronger styling (e.g. bg-slate-900/35, border-t, font-semibold); net_income gets slightly stronger (bg-slate-900/50, font-bold). Margin rows (gross_margin, ebit_margin, net_income_margin) stay de-emphasized (lighter, italic).
- **Balance Sheet in preview:** Flatten by tree; section/category from `getBSSection`, `getBSCategory`; collapse toggles per section/category.
- **CFS in preview — operating order:** The flat list is **not** used as-is for operating. (1) **operatingBuckets:** For each entry with section === "operating", assign to bucket by `getFinalOperatingSubgroup(entry.row, entry.parentId)`. The row with id `other_operating` is not added to any bucket. **Working capital bucket** includes only entries where `entry.row.id === "wc_change"` or `entry.parentId === "wc_change"` (structural rule). (2) **operatingOrdered:** Concatenate buckets in order earnings_base → non_cash → working_capital → other_operating. (3) **flatForRender:** The full flat list with the operating segment replaced by operatingOrdered. So each subgroup header (Earnings Base, Non-Cash Adjustments, Working Capital Adjustments, Other Operating Activities) appears **at most once**. Values for CFS calculated rows (net_income, danda, sbc, wc_change, operating_cf, etc.) come from `computeRowValue`, which uses the same CFO resolver for net_income, danda, sbc.

### 3.8 Calculations Engine

**File:** `lib/calculations.ts`

- **computeRowValue(row, year, allRows, statementRows, allStatements, ...):** Returns the effective value for that row/year. Logic: (1) Parent with children (rev, cogs, sga, rd, wc_change when applicable) → sum of children (with wc_change/other_wc_reclass rules). (2) Input row → row.values[year]. (3) Calc/subtotal/total → computeFormula(...). For CFS net_income, danda, sbc, computeFormula uses **resolveHistoricalCfoValueOnly** when allStatements is provided.
- **computeFormula(row, year, statementRows, allStatements, ...):** Implements formulas by row id (IS, BS, CFS). Uses findRowValue for most dependencies; for CFS net_income, danda, sbc uses the CFO resolver. **net_change_cash** = operating_cf + investing_cf + financing_cf + cash_bridge; section totals are obtained via **computeRowValue** for the section total rows.
- **findRowValue(rows, rowId, year):** Recursive search by id; returns stored or summed value; does **not** call the CFO resolver (that is only inside computeFormula for specific CFS row ids).
- **recomputeCalculations(rows, year, statementRows, allStatements, ...):** For every row in the tree, sets values[year] = result of computeRowValue (or sum of children for parent rows). Returns **new** row tree with updated values. Called after updateRowValue, after BS/CFS structural changes, and on load/recalc.

### 3.9 Classification Completeness and Review Panel

**File:** `lib/classification-completeness.ts`

- **getFullClassificationReport({ incomeStatement, balanceSheet, cashFlow }):** Returns a report per statement (income, balance, cash_flow) with entries per row, state (deterministic, ai_classified, user_classified, unresolved), and taxonomy aggregates (hasTaxonomyUnresolved, hasTaxonomyNeedsReview).
- **getReviewItemsForHistoricals(report, { incomeStatement, balanceSheet, cashFlow }):** Returns only **actionable** items. Excludes deterministic template rows, subtotals, totals, margin rows, and rows that are already trusted. Includes rows with reviewState `needs_confirmation` or `setup_required` from **getFinalRowClassificationState**. Each item has `statementKey`, `rowId`, `label`, `reviewState`, `canConfirm`, `issueText`, `reason`, `suggestedLabel`. Used by the builder panel to render the “Rows Requiring Review” list and the “Confirm” button; clicking Confirm calls `confirmRowReview(statementKey, rowId)`.

**File:** `lib/final-row-classification.ts`

- **getFinalRowClassificationState(row, statementKey, context?):** Single canonical resolver for **review state** and suggested label. Priority: (1) User override (classificationSource === "user" and trusted), (2) Deterministic (template/anchor), (3) Placement (e.g. in WC block → working_capital), (4) AI, (5) Standard label match (strong pattern match → trusted), (6) Fallback. Returns `FinalRowClassificationState`: section, category, type, source, confidence, **reviewState** (`trusted` | `needs_confirmation` | `setup_required`), suggestedLabel, reason. **reviewState** is what the UI uses for badges and the review panel; **trusted** means no badge and no panel entry.

### 3.10 Taxonomy Layer

**File:** `lib/row-taxonomy.ts`

- Defines **taxonomyType** and **taxonomyCategory** for IS, BS, CFS (e.g. revenue_product, cogs_direct, asset_cash, cfo_net_income). Deterministic maps (e.g. IS_TAXONOMY_BY_ID) for template rows; **getIsTaxonomy**, **getBsTaxonomy**, **getCfsTaxonomy** for any row (label-based fallback for custom rows). **applyTaxonomyToRow(row, statementKey)** returns a new row with taxonomyType, taxonomyCategory, taxonomySource, taxonomyStatus set. Taxonomy is applied when rows are added (addChildRow, insertRow, addWcChild) and on backfill (load/init). **taxonomyStatus** is "trusted" for template/user/high-confidence AI, "needs_review" for fallback/low-confidence, "unresolved" when missing.

### 3.11 CFS Metadata Backfill and WC Normalization

**File:** `lib/cfs-metadata-backfill.ts` — **backfillCfsMetadataNature(cashFlow):** For rows with `cfsLink.section` but missing `historicalCfsNature`, sets nature from section: investing → reported_investing, financing → reported_financing, cash_bridge → reported_meta; operating only when parentId === "wc_change" → reported_working_capital_movement. Run on load/init; does not overwrite existing or user-set values.

**Store:** **normalizeWcStructure(cashFlow):** (1) Find top-level rows (excluding wc_change) whose **getFinalOperatingSubgroup** is `working_capital`. (2) Remove them from top-level and append to `wc_change.children` (preserving order). (3) Return the new array. Called after any CFS update that could leave a WC row at top-level (insertRow, addChildRow, updateCashFlowRowMetadata, moveRow, removeRow).

### 3.12 Row Actions (UnifiedItemCard)

**File:** `components/unified-item-card.tsx`

- **Edit values:** Button “Edit values” when collapsed; expands the card to show year inputs. Collapse is via header chevron, not a “Done” button.
- **Edit row:** Shown when `showEditRow && onEditRow`; opens inline label edit (input + Save/Cancel) when `editingLabelRowId === row.id`.
- **Confirm:** Shown only when `reviewState === "needs_confirmation"` and `onConfirmSuggestion`; clicking calls `onConfirmSuggestion(row.id)`.
- **Remove:** Shown when `showRemove`; calls `onRemove(row.id)`. Template/total rows have showRemove false.
- No “Done” label; “Confirm” is only for accepting a suggested classification. Margin/calculated rows do not show Edit row or Remove.

### 3.13 Help and Header

- **HistoricalsHelpModal** (`components/historicals-help-modal.tsx`): Opened by “How this works” link when `currentStepId === "historicals"`. Tabs: Overview, Classification, Income Statement, Balance Sheet, Cash Flow, Row actions, Review panel, Renaming rows. Content is in-app only.
- **Builder panel header:** “Builder Panel”; subtitle “Current step: historicals”; then “How this works” link; then actions (Reset Inputs, Download Excel, Save, Continue). Save is dark blue; Continue is primary CTA; Reset is tertiary.

### 3.14 File and Function Index (Historicals)

| Concern | File | Key symbols |
|--------|------|-------------|
| Row type, WizardStepId, WIZARD_STEPS | types/finance.ts | Row, WizardStepId, WIZARD_STEPS, ModelMeta |
| Store state and actions | store/useModelStore.ts | incomeStatement, balanceSheet, cashFlow, updateRowValue, updateIncomeStatementRowMetadata, updateCashFlowRowMetadata, setBalanceSheetRowCashFlowBehavior, moveCashFlowRowOutOfWc, moveCashFlowRowIntoWc, addWcChild, normalizeWcStructure, confirmRowReview, renameRow, recomputeCalculations |
| IS/BS/CFS templates | lib/statement-templates.ts | createIncomeStatementTemplate, createBalanceSheetTemplate, createCashFlowTemplate |
| Calculations | lib/calculations.ts | computeRowValue, computeFormula, findRowValue, recomputeCalculations, checkBalanceSheetBalance, getWcBsBalance, getDeltaWcBs |
| CFO source resolution | lib/cfo-source-resolution.ts | resolveHistoricalCfoValue, resolveHistoricalCfoValueOnly, hasMeaningfulHistoricalValue, hasSbcDisclosureValueForYear |
| CFS operating subgroups | lib/cfs-operating-subgroups.ts | getFinalOperatingSubgroup, groupOperatingRowsIntoBuckets, OPERATING_SUBGROUP_ORDER, OPERATING_SUBGROUP_LABELS, validateOperatingCfsStructure |
| IS classification and display order | lib/is-classification.ts | getIncomeStatementDisplayOrder, getIsSectionKey, getIsRowsMissingClassification |
| BS categories | lib/bs-category-mapper.ts | getBSCategoryForRow, getRowsForCategory |
| Classification completeness | lib/classification-completeness.ts | getFullClassificationReport, getReviewItemsForHistoricals |
| Final row classification (review state) | lib/final-row-classification.ts | getFinalRowClassificationState, FinalReviewState |
| Row taxonomy | lib/row-taxonomy.ts | getIsTaxonomy, getBsTaxonomy, getCfsTaxonomy, applyTaxonomyToRow |
| CFS metadata backfill | lib/cfs-metadata-backfill.ts | backfillCfsMetadataNature |
| Builder panel | components/builder-panel.tsx | currentStepId === "historicals", IncomeStatementBuilder, BalanceSheetBuilder stepId="historicals", CashFlowBuilder, balanceCheck, reviewItems, YearsEditor |
| IS builder | components/income-statement-builder.tsx | IncomeStatementBuilder, getFinalRowClassificationState, confirmRowReview, renameRow |
| BS builder | components/balance-sheet-builder-unified.tsx | BalanceSheetBuilderUnified, stepId, setBalanceSheetRowCashFlowBehavior |
| CFS builder | components/cash-flow-builder.tsx | CashFlowBuilder, getFinalOperatingSubgroup, moveCashFlowRowOutOfWc, moveCashFlowRowIntoWc, addWcChild, Net Change in Cash card, Cash Reconciliation |
| Excel preview | components/excel-preview.tsx | flattenRows, operatingBuckets, flatForRender, getCFSSection, getCFOSign, computeRowValue |
| Unified item card | components/unified-item-card.tsx | UnifiedItemCard, reviewState, onConfirmSuggestion, showEditRow, onEditRow, editingLabelRowId, onSaveEditLabel |
| Years editor | components/years-editor.tsx | YearsEditor, meta.years.historical |
| Currency/display | lib/currency-utils.ts | storedToDisplay, displayToStored, getUnitLabel, formatIntegerWithSeparators |

---

This specification and analysis reflect the codebase as of the date of writing. An AI or developer can use it to locate logic, infer behavior, and implement changes without contradicting the existing architecture.
