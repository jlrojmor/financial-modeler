# Forecast Workflow Architecture & Tab Structure

**Purpose:** Define the post-Historicals workflow and tab structure before implementing more forecasting formulas. Historicals remains **untouched**. This document is the single source of truth for the target architecture and migration plan.

---

## 1. Constraint: Do Not Touch Historicals

- The **Historicals** tab, its step id (`historicals`), and all components used only there (e.g. `IncomeStatementBuilder` when `currentStepId === "historicals"`, `BalanceSheetBuilder` with `stepId="historicals"`, `CashFlowBuilder` in Historicals, classification/review, balance check, help modal) **must stay as-is**.
- No changes to Historicals content, routing, or data entry. The redesign **starts after** Historicals.

---

## 2. Current vs Target Tab Structure

### 2.1 Current (8 steps)

| Order | Step ID       | Label          | Notes |
|-------|---------------|----------------|-------|
| 1     | company_context | Company Context | OK |
| 2     | historicals   | Historicals    | **Leave unchanged** |
| 3     | is_build      | IS Build       | Structure + revenue + COGS + SG&A mixed |
| 4     | bs_build      | BS Build       | Structure + WC + Capex + Intangibles |
| 5     | cfs_build     | CFS Build      | Structure only (no forecast drivers) |
| 6     | schedules     | Schedules      | Placeholder / “coming soon” in BuilderPanel |
| 7     | projections   | Projections    | Revenue projection step only |
| 8     | dcf           | DCF Valuation  | “Coming soon” in BuilderPanel |

### 2.2 Target (7 steps)

| Order | Step ID             | Label               | Purpose (short) |
|-------|---------------------|---------------------|------------------|
| 1     | company_context     | Company Context     | Unchanged |
| 2     | historicals         | Historicals         | Unchanged |
| 3     | statement_structure | Statement Structure | Define forecastable rows, confirm structure, assign metadata/row roles. No forecast values. |
| 4     | forecast_drivers   | Forecast Drivers    | Assign methods, set assumptions, review suggestions. Direct forecast inputs only. |
| 5     | schedules          | Schedules           | Rollforwards and schedule logic (WC, Capex, Intangibles, Debt). |
| 6     | projected_statements | Projected Statements | Integrated IS/BS/CFS review; direct vs derived vs schedule-fed. |
| 7     | dcf                | DCF Valuation       | Unchanged conceptually. |

---

## 3. What Each New Tab Owns

### 3.1 Statement Structure (replaces is_build, bs_build, cfs_build at workflow level)

- **Single top-level tab** with **internal subtabs** (or sub-sections):
  - **Income Statement** — Define forecastable revenue/COGS/opex rows, confirm hierarchy, assign metadata (e.g. `sectionOwner`, row roles). No revenue growth %, no COGS %, no SG&A %.
  - **Balance Sheet** — Confirm BS structure, row roles, cash flow treatment (e.g. `cashFlowBehavior`). No WC rollforward inputs, no Capex/Intangibles schedule inputs.
  - **Cash Flow** — Confirm CFS structure, anchors, links to IS/BS/schedules. No forecast driver inputs.
- **Purpose:** Prepare rows for forecasting; no actual forecast values or assumption inputs here.

### 3.2 Forecast Drivers (replaces “projections” as the home for direct assumptions)

- **Subsections** (internal subtabs or accordions):
  - **Revenue** — Assign revenue forecast method per stream/breakdown (growth_rate, price_volume, customers_arpu, pct_of_total, product_line, channel), set assumptions, review AI suggestions. This is where current “IS Build — Revenue” and `revenueProjectionConfig` live.
  - **Operating Costs** — COGS % of revenue (per line/mode), SG&A % of revenue and % of parent, R&D and other opex methods. All direct IS operating cost assumptions.
  - **Working Capital Drivers** — Method selection per WC item (days, % of revenue, % of COGS, manual balance). Does **not** contain the detailed rollforward; that lives in Schedules → Working Capital.
  - **Financing / Taxes** — High-level assumptions: interest, tax rate, and (when applicable) debt assumptions that feed the Debt schedule. Detailed debt rollforward lives in Schedules → Debt Schedule.
- **Purpose:** One place for “how we forecast this row” (method + inputs); direct vs derived vs schedule-driven is clarified here (and in Phase 2, metadata-driven).

### 3.3 Schedules (unchanged as a tab; clarified subsections)

- **Subsections:**
  - **Working Capital** — Detailed WC rollforward; produces projected WC balances that feed BS and CFS (ΔWC).
  - **Capex & Depreciation** — Capex and D&A rollforward; feeds BS PP&E and CFS Capex/D&A.
  - **Intangibles & Amortization** — Intangibles rollforward; feeds BS intangibles and CFS amortization.
  - **Debt Schedule** — Debt rollforward; feeds BS debt rows and CFS interest/debt issued/repaid.
- **Purpose:** Build the schedules that own specific row families; projected statements consume schedule output.

### 3.4 Projected Statements (new tab)

- Single view (or subtabs) showing **projected IS, BS, and CFS** together.
- **Purpose:** Integrated review, sanity checks, and ability to see which rows are direct vs derived vs schedule-fed. Read-only (or with minimal overrides); no primary assumption entry here.

### 3.5 DCF Valuation

- No major change. Final valuation layer (UFCF, WACC, terminal value, etc.).

---

## 4. Mapping: Where Each Row Family Is Forecast

| Row family | Where method/assumptions are set | Where detailed logic lives (if different) |
|------------|----------------------------------|------------------------------------------|
| **Revenue** (streams, breakdowns) | Forecast Drivers → Revenue | — (engine in lib; results consumed in Projected Statements / Excel) |
| **COGS / gross-margin-related** | Forecast Drivers → Operating Costs | — |
| **SG&A / R&D / other operating expense** | Forecast Drivers → Operating Costs | — |
| **Working capital rows** | Forecast Drivers → Working Capital Drivers (method per item) | Schedules → Working Capital (rollforward) |
| **PP&E / Capex / Depreciation** | Optional high-level in Forecast Drivers | Schedules → Capex & Depreciation (rollforward) |
| **Intangibles / Amortization** | — | Schedules → Intangibles & Amortization |
| **Debt / Interest** | Forecast Drivers → Financing / Taxes (high-level) | Schedules → Debt Schedule (rollforward) |
| **Taxes** | Forecast Drivers → Financing / Taxes | — |
| **Cash** | Not forecast directly | Derived in Projected Statements (prior cash + net change in cash) |
| **Retained earnings** | Not forecast directly | Derived in Projected Statements |
| **D&A (IS line)** | Not forecast directly | Schedule-driven (Capex + Intangibles amortization) |

---

## 5. Reuse vs Replace: Current Tabs and Components

### 5.1 Reused (with possible mode or context change)

| Current artifact | New home | How reused |
|------------------|----------|-------------|
| **Income Statement builder (structure)** | Statement Structure → Income Statement | Same tree builder; used in “structure + metadata only” mode (no revenue/COGS/SG&A assumption UI). May need a prop like `mode="structure_only"` or `stepId="statement_structure"` to hide forecast inputs. |
| **Balance Sheet builder (structure)** | Statement Structure → Balance Sheet | Same `BalanceSheetBuilder`; when step is Statement Structure, show only structure + metadata/CF treatment (no WC/Capex/Intangibles schedule panels). Today’s `stepId="historicals"` vs `stepId="bs_build"` pattern can extend to `stepId="statement_structure"`. |
| **Cash Flow builder** | Statement Structure → Cash Flow | Same `CashFlowBuilder`; no change to content if it’s already structure-only. |
| **Revenue projection config + engine** | Forecast Drivers → Revenue | Same `revenueProjectionConfig`, `computeRevenueProjections`, and existing revenue UI (streams, breakdowns, methods, allocation). Move from IS Build to Forecast Drivers → Revenue. |
| **COGS % / SG&A % config and UI** | Forecast Drivers → Operating Costs | Same store state (`cogsPctByRevenueLine`, `sgaPctByItem`, etc.) and same UI blocks; move from IS Build to Forecast Drivers. |
| **WC driver type per item** | Forecast Drivers → Working Capital Drivers | Same store state (e.g. WC driver type per row); currently in BS Build / WC card; move to Forecast Drivers → WC Drivers. |
| **Working Capital schedule (rollforward)** | Schedules → Working Capital | Same WC schedule component and logic; today shown in BS Build; move to Schedules tab as first subsection. |
| **Capex & D&A schedule** | Schedules → Capex & Depreciation | Same Capex/D&A component; move from BS Build to Schedules. |
| **Intangibles & Amortization schedule** | Schedules → Intangibles & Amortization | Same Intangibles component; move from BS Build to Schedules. |
| **Excel preview (IS/BS/CFS)** | Projected Statements (and elsewhere) | Reuse `ExcelPreview` to show projected statements; can be passed a “projection-only” or “integrated view” context. |
| **Years editor** | All steps after Company Context | Already global to steps; no change. |

### 5.2 Replaced or removed at workflow level

| Current artifact | Fate |
|------------------|------|
| **is_build** step id | Removed. Content split: structure → Statement Structure (IS subtab); revenue → Forecast Drivers → Revenue; COGS/SG&A → Forecast Drivers → Operating Costs. |
| **bs_build** step id | Removed. Structure → Statement Structure (BS subtab); WC method selection → Forecast Drivers → WC Drivers; WC/Capex/Intangibles rollforward → Schedules. |
| **cfs_build** step id | Removed. Content → Statement Structure (CFS subtab). |
| **projections** step id | Removed. Revenue step content → Forecast Drivers → Revenue. “Projections” as a single vague tab is replaced by Forecast Drivers + Projected Statements. |
| **ISBuildView** (single component) | Split: structure-only part used in Statement Structure; revenue part → Forecast Drivers → Revenue; COGS/SG&A part → Forecast Drivers → Operating Costs. Implement as either one component with mode/subsection or separate containers that reuse the same subcomponents. |
| **BS Build “Apply to model”** | Still needed: either in Schedules (apply schedule outputs to model) or in Projected Statements. Exact placement can stay “apply from schedules” and need not live in Statement Structure. |

### 5.3 New

| New artifact | Purpose |
|--------------|---------|
| **statement_structure** step | One step with subtabs: Income Statement, Balance Sheet, Cash Flow. Uses existing builders in structure-only mode. |
| **forecast_drivers** step | One step with subsections: Revenue, Operating Costs, Working Capital Drivers, Financing/Taxes. Hosts all current “driver” UIs moved from IS Build / BS Build. |
| **projected_statements** step | New step; integrated projected IS/BS/CFS view (reusing ExcelPreview or similar). |
| **Sub-navigation** (optional) | For Statement Structure and Forecast Drivers (and Schedules), a small sub-nav or tabs to switch between Income Statement / Balance Sheet / Cash Flow or Revenue / Operating Costs / WC / Financing. |

---

## 6. Migration Plan (Without Breaking Historicals)

### 6.1 Principles

- **Historicals:** No code changes to Historicals step, its components, or the data it writes.
- **Backward compatibility:** Existing projects may have `currentStepId` and `completedStepIds` with old step ids. On load, map old → new so users land in the correct place and completion state is preserved.
- **Incremental implementation:** Prefer adding new steps and mapping old ids to new, then hiding or retiring old steps, rather than big-bang replace.

### 6.2 Step ID and completion mapping (for persisted state)

When loading a project (e.g. in `loadProject` or wherever snapshot is applied):

- If `currentStepId` is `is_build` or `bs_build` or `cfs_build` → set `currentStepId` to `statement_structure` (and optionally set a “subtab” or “focus” so we can open the right internal tab if desired).
- If `currentStepId` is `projections` → set to `forecast_drivers`.
- If `currentStepId` is `schedules` or `dcf` or `company_context` or `historicals` → leave unchanged (schedules and dcf keep same id).
- For `completedStepIds`: map any of `is_build`, `bs_build`, `cfs_build` to `statement_structure` (and merge duplicates). Map `projections` to `forecast_drivers`. Other ids stay. This keeps “Done” state for the new consolidated steps.

### 6.3 Implementation order (safest path)

1. **Define new step ids and labels**  
   Add new ids: `statement_structure`, `forecast_drivers`, `projected_statements`. Keep `historicals`, `company_context`, `schedules`, `dcf`. Do **not** remove old ids from the type yet; support both during migration.

2. **Extend wizard steps**  
   Add the three new steps to `WIZARD_STEPS` in the **target** order (e.g. after historicals: statement_structure, forecast_drivers, schedules, projected_statements, dcf). Option A: replace old steps by new steps in one go and rely on migration of persisted state. Option B: add new steps and hide old steps (e.g. feature flag or “new workflow” flag) and migrate state when loading. Recommendation: **Option A** with mapping on load so there is a single canonical list.

3. **Wire Statement Structure**  
   - When `currentStepId === "statement_structure"`, show a sub-nav: Income Statement | Balance Sheet | Cash Flow.  
   - Income Statement: render the same income statement tree/structure UI used today in Historicals/IS Build but **without** revenue method inputs, COGS %, or SG&A % (structure + metadata only).  
   - Balance Sheet: render `BalanceSheetBuilder` with something like `stepId="statement_structure"` so it does **not** show WC/Capex/Intangibles schedule panels (only structure + CF treatment).  
   - Cash Flow: render `CashFlowBuilder` (already structure-oriented).

4. **Wire Forecast Drivers**  
   - When `currentStepId === "forecast_drivers"`, show subsections: Revenue | Operating Costs | Working Capital Drivers | Financing/Taxes.  
   - Revenue: move current IS Build revenue UI here (streams, breakdowns, method per item, allocation). Reuse `revenueProjectionConfig` and engine; no change to store shape.  
   - Operating Costs: move COGS % and SG&A % (and R&D/other opex) UI here.  
   - Working Capital Drivers: move “driver type per WC item” UI from current BS Build/WC card here.  
   - Financing/Taxes: placeholder or minimal UI (interest, tax rate) until Phase 2.

5. **Wire Schedules**  
   - When `currentStepId === "schedules"`, show subsections: Working Capital | Capex & Depreciation | Intangibles & Amortization | Debt Schedule.  
   - Move the existing WC rollforward, Capex & D&A, and Intangibles components from BS Build into these subsections. Debt Schedule: placeholder if not yet built.

6. **Wire Projected Statements**  
   - When `currentStepId === "projected_statements"`, show integrated IS/BS/CFS (e.g. `ExcelPreview` with all three or a dedicated “projected only” view). No assumption inputs; review and sanity check only.

7. **Apply step-id mapping on load**  
   - In the place where project state is restored (e.g. `loadProject`), run the mapping from old step ids to new and rewrite `currentStepId` and `completedStepIds` so saved projects never reference removed ids.

8. **Remove old step ids**  
   - After the new flow is stable, remove `is_build`, `bs_build`, `cfs_build`, `projections` from `WizardStepId` and from any remaining branches. Ensure mapping has been in place long enough that no stored project still uses old ids without mapping.

### 6.4 Files to touch (checklist)

- **types/finance.ts** — `WizardStepId` (new ids; later remove old), `WIZARD_STEPS` (new order and entries).
- **app/project/[id]/page.tsx** — `STEP_LABEL` for new ids; right-panel preview routing (e.g. what to show for `statement_structure`, `forecast_drivers`, `schedules`, `projected_statements`).
- **components/sidebar-steps.tsx** — No change if it only iterates `WIZARD_STEPS`.
- **components/builder-panel.tsx** — Branch on new step ids; render Statement Structure (with sub-nav + structure-only builders), Forecast Drivers (with sub-nav + moved driver UIs), Schedules (with sub-nav + moved schedule components), Projected Statements (integrated view). Remove or repurpose branches for `is_build`, `bs_build`, `cfs_build`, `projections`.
- **store/useModelStore.ts** — `loadProject` (or equivalent): map old step ids to new in `currentStepId` and `completedStepIds`. `continueToNextStep` / `completeCurrentStep`: use new step list.
- **Revenue/COGS/SG&A UI** — Move from `ISBuildView` into Forecast Drivers (same components, new container). Optionally split `ISBuildView` into smaller components (structure vs revenue vs operating costs) for reuse.
- **BalanceSheetBuilder** — Extend `stepId` handling: when `stepId === "statement_structure"`, hide WC/Capex/Intangibles schedule panels; when step is Schedules, those panels are not in BS Build anymore (they’re in Schedules tab). So BS Build as a step goes away; BalanceSheetBuilder is only used in Historicals (unchanged) and in Statement Structure (structure only).
- **Excel preview** — Ensure it can show projected view when right panel is “Projected Statements” or when step is `projected_statements`; reuse existing projection logic (revenue engine, COGS/SG&A, etc.).

### 6.5 What stays completely unchanged

- All Historicals UI and logic (`currentStepId === "historicals"`).
- Income Statement / Balance Sheet / Cash Flow **data structures** and store shape (incomeStatement, balanceSheet, cashFlow, schedules).
- Revenue projection **engine** and **config** shape (`revenueProjectionConfig`, `computeRevenueProjections`).
- Classification, review workflow, and balance check used only in Historicals.
- Company Context and DCF step ids and their current behavior (even if “coming soon”).

---

## 7. Summary for Implementation

- **Final tab order:** Company Context → Historicals → Statement Structure → Forecast Drivers → Schedules → Projected Statements → DCF Valuation.
- **Statement Structure:** One tab, subtabs IS / BS / CFS; structure and metadata only; reuses existing builders in structure-only mode.
- **Forecast Drivers:** One tab, subsections Revenue, Operating Costs, WC Drivers, Financing/Taxes; all direct forecast assumptions; reuse current revenue, COGS, SG&A, and WC driver UIs moved from IS Build / BS Build.
- **Schedules:** One tab, subsections WC, Capex & D&A, Intangibles, Debt; reuse current schedule components moved out of BS Build.
- **Projected Statements:** New tab; integrated projected IS/BS/CFS for review; reuse Excel preview/projection logic.
- **Row-family mapping:** Revenue and operating costs in Forecast Drivers; WC method in Forecast Drivers, WC rollforward in Schedules; Capex/Intangibles/Debt in Schedules; Financing/Taxes in Forecast Drivers; cash and retained earnings derived in Projected Statements.
- **Migration:** Map old step ids to new on project load; then switch wizard to new steps and remove old ids. Do not change Historicals.

This document is the lock for the forecasting workflow architecture and tab structure before implementing additional forecasting formulas (starting with revenue in the correct place under Forecast Drivers → Revenue).
