# Cash Flow Statement (CFS) Builder — Architecture Audit

**Purpose:** Technical audit of the current CFS builder implementation to support design of historical CFS logic. No code changes; analysis only.

---

## 1. Where the CFS Builder Is Implemented

### Main files and components

| File / Component | Purpose | Interaction |
|------------------|--------|-------------|
| **`components/cash-flow-builder.tsx`** | CFS builder UI. Renders three collapsible sections (Operating, Investing, Financing), each with `CFSSectionComponent`. Handles add/remove/reorder, WC children, drag-and-drop, link labels, and Net Change in Cash display. | Reads/writes `cashFlow`, `incomeStatement`, `balanceSheet`, `sbcBreakdowns`, `danaBreakdowns`, `danaLocation` from store; calls `updateRowValue`, `insertRow`, `removeRow`, `ensureWcChildrenFromBS`, `reorderCashFlowTopLevel`, `reorderWcChildren`, `moveCashFlowRowIntoWc`, `moveCashFlowRowOutOfWc`, `toggleConfirmedRow`. |
| **`components/builder-panel.tsx`** | Orchestrates builder steps. Renders `CashFlowBuilder` when `currentStepId === "cfs_build"` and also in the Historicals step (with other builders) so CFS is visible there too. | Imports and conditionally renders `CashFlowBuilder`; does not touch CFS state directly. |
| **`components/excel-preview.tsx`** | Right-hand preview. Renders all three statements; CFS is rendered via `StatementTable` with `rows={cashFlow}`, `label="Cash Flow Statement"`. Section headers (Operating / Investing / Financing) and row ordering/signs are derived inside `StatementTable` and `getCFSection`. | Uses `cashFlow` from store; passes `allStatements`, `sbcBreakdowns`, `danaBreakdowns` into `StatementTable` for value resolution. |
| **`lib/statement-templates.ts`** | Defines `createCashFlowTemplate()` used when initializing a new model (e.g. new project or `initializeModel(..., { force: true })`). | Called from store’s `initializeModel`; returns the default CFS row array. |
| **`lib/calculations.ts`** | Calculation engine. Contains CFS-specific logic in `computeFormula` and `computeRowValue`: net_income/danda/sbc from IS/SBC, wc_change (historical vs projection), operating_cf/investing_cf/financing_cf/net_change_cash, and cfo_* items. `recomputeCalculations` updates CFS row values and WC “Other WC / Reclass” child. | Used by store after any change that affects statements; no direct UI. |
| **`store/useModelStore.ts`** | Single source of truth. Holds `cashFlow: Row[]` and CFS-related actions (`ensureWcChildrenFromBS`, `reorderCashFlowTopLevel`, `reorderWcChildren`, `moveCashFlowRowIntoWc`, `moveCashFlowRowOutOfWc`, etc.). Persists full state (including `cashFlow`) per project. | All CFS state and mutations go through this store. |

### Summary

- **CFS builder UI:** `cash-flow-builder.tsx` (and its internal `CFSSectionComponent`).
- **CFS preview:** `excel-preview.tsx` → `StatementTable` with `rows={cashFlow}` and CFS-specific section/label logic.
- **CFS data and logic:** Same global store as IS/BS (`useModelStore`); CFS is one top-level slice (`cashFlow`). Templates live in `lib/statement-templates.ts`; calculations in `lib/calculations.ts`.

---

## 2. Store / State Structure for the CFS

### Where CFS data lives

- **Same store as IS and BS:** `useModelStore` (Zustand with persist).
- **CFS slice:** `state.cashFlow` is a single array of top-level `Row` objects. There is no separate “CFS state slice”; it is just this one array.
- **Location in store:** `ModelState.cashFlow: Row[]` (see `store/useModelStore.ts` around lines 439–440, 767, 856, 928).

### Data shape

- **Row type:** `types/finance.ts` — `Row` has `id`, `label`, `kind`, `valueType`, `values?: Record<string, number>`, `children?: Row[]`, and optional `cfsLink`, `isLink`, etc.
- **Yearly values:** `row.values[year]` (e.g. `row.values["2024A"]`). Same pattern as IS/BS.
- **CFS-specific metadata on a row:**
  - **`cfsLink`:** `{ section: "operating" | "investing" | "financing"; cfsItemId?: string; impact: "positive" | "negative" | "neutral" | "calculated"; description: string }`. Used for section assignment and sign in UI/preview.
  - **`isLink`:** Optional link to an IS item (e.g. for custom operating items).
- **Working capital:** The row `wc_change` can have `children` (e.g. AR, Inventory, AP, Other WC / Reclass). Those children are also `Row` objects with their own `values`; they are not stored in a separate structure.

### Project snapshot

- `ProjectSnapshot` includes `cashFlow: Row[]` (and `incomeStatement`, `balanceSheet`, etc.). So CFS is persisted per project in the same way as IS/BS.

---

## 3. Default CFS Template Structure

**Source:** `lib/statement-templates.ts` — `createCashFlowTemplate()` (lines 464–419).

### Default sections and rows (in order)

| Section | Row id | Label | kind | Editable / locked / calculated |
|--------|--------|--------|------|--------------------------------|
| **Operating** | `net_income` | Net Income | calc | **Calculated** — pulled from IS (no manual input). |
| | `danda` | Depreciation & Amortization | input | **User input** — manual in CFS (not auto from IS). |
| | `sbc` | Stock-Based Compensation | calc | **Calculated** — from `sbcBreakdowns` (see Section 5). |
| | `wc_change` | Change in Working Capital | input | **Hybrid:** historical = user input (or sum of WC children); projection = calculated from BS ΔWC. |
| | `other_operating` | Other Operating Activities | input | **User input.** |
| | `operating_cf` | Cash from Operating Activities | calc | **Calculated** — sum of operating items above. |
| **Investing** | `capex` | Capital Expenditures (CapEx) | input | **User input.** |
| | `investing_cf` | Cash from Investing Activities | calc | **Calculated** — sum of investing items (e.g. capex + others). |
| **Financing** | *(no default line items)* | — | — | Template has no debt_issuance/equity_issuance; user adds via suggestions or custom. |
| | `financing_cf` | Cash from Financing Activities | calc | **Calculated** — sum of financing items. |
| **Bottom** | `net_change_cash` | Net Change in Cash | calc | **Calculated** — operating_cf + investing_cf + financing_cf. |

### Locked / protected rows

- Core CFS rows are protected from removal in the store (`removeRow`): `net_income`, `danda`, `sbc`, `wc_change`, `other_operating`, `operating_cf`, `capex`, `investing_cf`, `financing_cf`, `net_change_cash` (see `coreCFSItems` in `useModelStore.ts` around 2477–2496).
- Section “lock” (Done) is per CollapsibleSection (`sectionLocks[section.sectionId]`); it does not lock individual row IDs.

---

## 4. Row Classification and Grouping (CFO / CFI / CFF)

### How sections are determined

1. **Position in `cashFlow` array:**  
   Sections are implied by order relative to well-known row IDs:
   - Operating: from `net_income` up to and including `operating_cf`.
   - Investing: from `capex` up to and including `investing_cf`.
   - Financing: from first row after `investing_cf` up to and including `financing_cf` (template has no “debt_issuance”, so financing “start” is position-based).

2. **`cfsLink.section`:**  
   Custom rows (and CFO-intelligence rows) carry `cfsLink.section` (`"operating"` | `"investing"` | `"financing"`). The builder and preview use this to include rows in the correct section even if order is nonstandard (see `cash-flow-builder.tsx` sectionItems useMemo and excel-preview’s `getCFSection`).

3. **Fallbacks in builder:**  
   - Operating: also includes items between `operating_cf` and `capex` with `cfsLink?.section === "operating"` or no `cfsLink`.
   - Financing: also includes items between `investing_cf` and `financing_cf` so position-based financing items are not missed.

### Section config in code

- `CFS_SECTIONS` in `cash-flow-builder.tsx` defines `sectionId`, `totalRowId`, and `standardItems` per section. Financing has `standardItems: []`; operating has `["net_income", "danda", "sbc", "wc_change", "other_operating"]`; investing has `["capex"]`.
- **Financing start marker:** UI looks for `debt_issuance` as the start of financing; that row is not in the default template, so financing section items are derived from position (between `investing_cf` and `financing_cf`) and `cfsLink.section === "financing"`.

---

## 5. Links Between CFS and Other Statements

| CFS row | Source | Implementation |
|---------|--------|----------------|
| **Net Income** | Income Statement | In `computeFormula` (calculations.ts): when `rowId === "net_income"` and `isInCFS`, value is taken from `allStatements.incomeStatement` net_income row’s `values[year]` (already computed by recomputeCalculations). No live formula reference; uses stored IS value. |
| **D&A (danda)** | Income Statement (or danaBreakdowns) | In `computeFormula`: when `rowId === "danda"` and `isInCFS`, value is from IS D&A row `values[year]`, else fallback to `danaBreakdowns[year]`. In the UI, D&A is treated as **manual input** in CFS (user types it); the template and description say “Manual input in CFO”. So today CFS D&A can be entered independently of IS D&A. |
| **SBC** | SBC breakdowns (legacy) | In `computeFormula`: when `rowId === "sbc"` and `isInCFS`, value is `getTotalSbcForYear(incomeStatement, sbcBreakdowns, year)`. **Uses `sbcBreakdowns` only**, not `embeddedDisclosures`. So the CFS SBC line is driven by the legacy SBC annotation (sbcBreakdowns), not the embedded disclosure engine. |
| **Working capital change** | User input (historical) or Balance Sheet (projection) | See Section 6. |
| **CapEx** | User input in CFS | Stored on the CFS `capex` row. No automatic link from BS or from Capex schedule in the **historical** CFS builder; projection years can be overwritten by BS Build when `applyBsBuildProjectionsToModel` runs. |
| **Other operating / CFO intelligence** | Custom rows and “CFO intelligence” (cfo_* rows) | Custom operating rows: user input. Rows with `id.startsWith("cfo_")` are calculated from BS balance changes (previous year vs current year) and `cfsLink.impact`. |

### Summary

- **Net Income:** Linked to IS (stored value).
- **D&A:** In code can pull from IS or danaBreakdowns; in practice UI treats CFS D&A as manual.
- **SBC:** Linked to **sbcBreakdowns** (legacy), not to **embeddedDisclosures**.
- **WC change:** Hybrid — historical input, projection from BS.
- **CapEx:** Input on CFS; projection can be overwritten by BS Build.
- **Financing items:** User input (and suggested CFF items).

---

## 6. Working Capital Change Handling

### Design (current)

- **Historical years:**  
  - **Manual.** User can enter either (a) a single “Change in Working Capital” value per year on `wc_change`, or (b) component-level values on `wc_change.children` (e.g. Change in AR, Inventory, AP, Other WC / Reclass).  
  - When children exist, historical `wc_change` value for a year = sum of children’s values for that year (in `computeRowValue` and in `recomputeCalculations`).  
  - “Other WC / Reclass” is set so that **sum of components = ΔWC from Balance Sheet** for that year (reconciliation): `otherReclass = deltaWcCfo - deltaWcBs` (calculations.ts and store’s recompute logic).

- **Projection years:**  
  - **Calculated from Balance Sheet.** `getDeltaWcBs(balanceSheet, year, previousYear)` uses only BS rows with `cashFlowBehavior === "working_capital"` (and excludes cash, st_debt, totals). CFS value = `-deltaWcBs` (increase in WC = use of cash).

### How WC children are created

- **`ensureWcChildrenFromBS`** (store): Calls `ensureWcChildrenInCashFlow(cashFlow, balanceSheet, wcExcludedIds)`.  
  - Builds the list of desired WC components from BS: current_assets and current_liabilities with `cashFlowBehavior === "working_capital"`, excluding cash, st_debt, totals, and rows in `wcExcludedIds`.  
  - For `wc_change`, it replaces/updates `children` so that there is one child per such BS row (same id/label), plus an `other_wc_reclass` child. Existing CFS rows keep their `values`; new children get empty `values`.  
- So: **WC components in CFS are driven by BS structure and `cashFlowBehavior`.** User can exclude a BS row from WC via BS Build (then it’s in `wcExcludedIds` and won’t be added as a child).

### Link to Balance Sheet

- WC balance from BS: `getWcBsBalance(balanceSheet, year)` = sum(CA WC) − sum(CL WC) with same exclusions.  
- ΔWC from BS: `getDeltaWcBs(balanceSheet, year, previousYear)` = WC_BS(year) − WC_BS(previousYear).  
- CFS projection wc_change = `-getDeltaWcBs(...)` so that CFO reconciles with BS WC movement.

---

## 7. Disclosure Integration (SBC, Amortization, Depreciation, Restructuring)

### Current behavior

- **CFS does not use the embedded disclosure engine** (`embeddedDisclosures`) for any calculation.
- **SBC in CFS** comes from **`sbcBreakdowns`** via `getTotalSbcForYear(incomeStatement, sbcBreakdowns, year)` (calculations.ts). That function sums SBC by IS structure (SG&A, COGS, R&D and their children) from `sbcBreakdowns` only.
- **embeddedDisclosures** (SBC, amortization of intangibles, depreciation embedded, restructuring) are used **only for note disclosure tables** in the preview (and export), i.e. “Stock-Based Compensation Expense”, “Amortization of Acquired Intangibles”, etc. They do **not** feed the CFS builder or the CFS totals.

### Double-counting

- **Between CFS and disclosures:** No double-count in the CFS total from disclosures, because CFS does not read `embeddedDisclosures`.
- **Between sbcBreakdowns and embeddedDisclosures:** Two separate systems. If the app ever switches CFS SBC to “total from embeddedDisclosures”, then SBC would need to be sourced from one place only (either legacy sbcBreakdowns or embeddedDisclosures) to avoid double-counting and inconsistency.

---

## 8. Custom Rows in the CFS Builder

### How users add custom rows

- **Operating:** “+ Add Custom Operating Activities Item” — user enters a label. Sign can come from term knowledge (`cfsLink.impact`) or from `inferOperatingSignFromLabel(label)`. Row is inserted before `operating_cf` with `cfsLink.section === "operating"`.
- **Investing:** Same pattern; validation uses CFI intelligence (`validateCFIItem`, `findCFIItem`). User can also add from “Suggested CFI Items”. New row gets `cfsLink.section === "investing"` and impact from suggestion or inference.
- **Financing:** Same; CFF intelligence and “Suggested CFF Items”. New row gets `cfsLink.section === "financing"`.

### Storage and classification

- Custom rows are **full `Row` objects** (id from `uuid()`, label, kind `"input"`, valueType `"currency"`, values, children) and are **inserted into `state.cashFlow`** at a specific index (before the section total row) via `insertRow("cashFlow", insertIndex, newRow)`.
- Classification is stored on the row as **`cfsLink`** (section + impact + description). Section assignment in the builder and preview uses `cfsLink.section` and/or position.

### CFO “intelligence” (auto-add from BS)

- **`analyzeBSItemsForCFO`** (lib/cfo-intelligence.ts) analyzes BS rows (e.g. fixed assets, non-current liabilities) and suggests “auto_add” or “suggest_review”.
- In `CashFlowBuilder`, a `useEffect` auto-adds rows for items with `treatment === "auto_add"` that are not already in CFS (id `cfo_${item.rowId}`). These rows are **calculated** from BS balance changes and `cfsLink.impact` in `computeFormula` (rowId.startsWith("cfo_")).

---

## 9. CFS Preview Rendering

### File and entry point

- **File:** `components/excel-preview.tsx`.  
- **Entry:** When `focusStatement === "all"` and `cashFlow.length > 0`, it renders `<StatementTable rows={cashFlow} label="Cash Flow Statement" ... />` (around lines 2430–2443).

### How rows and sections are determined

- **Flattening:** `flattenRows(cashFlow, ..., { forStatement: "cashflow" })` — same generic flattening as IS/BS, with CFS-specific options (e.g. SBC is not skipped for cashflow so it appears in CFS).
- **Section for each row:** `getCFSection(rowId, rows)` (and similar logic):
  - By row id: `operating_cf` → operating, `investing_cf` → investing, `financing_cf` / `net_change_cash` → financing.
  - By position: rows between `operating_cf` and `capex` → operating; between `capex` and `investing_cf` → investing; between `investing_cf` and `financing_cf` → financing.
- **Order:** Same as `cashFlow` array order; no separate sort key. Section headers (Operating / Investing / Financing) are rendered when the section changes.

### Value resolution in preview

- For each cell, `StatementTable` uses `row.values?.[year]` and, for calculated CFS rows, may call `computeRowValue(row, year, rows, rows, allStatements, sbcBreakdowns, danaBreakdowns)` when the stored value is missing or zero (to show computed net_income, sbc, wc_change for projection, etc.). So preview shows the same logic as the calculation engine.

---

## 10. Data Persistence and Hydration for CFS

### Persistence

- **Mechanism:** Zustand `persist` middleware with name `"financial-model-storage"` (single key in localStorage).
- **What’s persisted:** The whole state is partialized (excluding `_hasHydrated`); `projectStates` is written with the current project’s snapshot. The snapshot includes `cashFlow` (see `getProjectSnapshot` and `ProjectSnapshot`).
- So **CFS is persisted in the same localStorage key as the rest of the app**, per project, inside `projectStates[projectId].cashFlow`.

### New project / load project

- **New project (no fromCurrentState):** `createProject` calls `initializeModel(meta, { force: true })`, which replaces `cashFlow` with `createCashFlowTemplate()` and clears financial input state (including `embeddedDisclosures`, etc.). So **new project gets a clean CFS template**.
- **Load project:** `loadProject(projectId)` applies `applyProjectSnapshot(set, snapshot)`; snapshot includes `cashFlow`, so **loaded project gets that project’s CFS**.
- **Conclusion:** CFS is correctly initialized from template for new projects and from snapshot for loaded projects; no cross-project leakage from CFS state.

---

## 11. Architectural Risks and Weaknesses

1. **Two SBC systems (sbcBreakdowns vs embeddedDisclosures)**  
   CFS uses only `sbcBreakdowns`. Disclosures use `embeddedDisclosures`. If both are ever populated from different UIs, SBC in CFS and SBC in notes can diverge. Unifying on one source (e.g. embeddedDisclosures) for both CFS and disclosures would require a refactor and migration.

2. **D&A: manual in CFS vs in IS**  
   CFS D&A can be entered manually and is not forced to equal IS D&A. So reported CFS can differ from “IS D&A” unless the app enforces a single source (e.g. CFS D&A always from IS or from a shared D&A breakdown).

3. **WC: historical input vs BS-derived**  
   Historical WC change is user input (or sum of components); “Other WC / Reclass” is set so sum(components) = ΔWC_BS. If the user enters only the top-level wc_change and not components, there is no automatic reconciliation to BS; the reconciliation logic only runs when wc_change has children and recomputeCalculations runs.

4. **Fragile section boundaries**  
   Section assignment depends on fixed row IDs (`net_income`, `operating_cf`, `capex`, `investing_cf`, `financing_cf`). If rows are reordered or IDs change, fallbacks (cfsLink, position between markers) reduce but do not eliminate the risk of mis-assignment. Financing “start” is especially brittle because the template has no `debt_issuance` row.

5. **No explicit reconciliation: ending cash vs BS**  
   There is no built-in check that “Beginning Cash + Net Change in Cash = Ending Cash” or that “Ending Cash” ties to Balance Sheet Cash. Such reconciliation would require comparing CFS net_change_cash (and optionally beginning cash) to BS cash; it is not implemented.

6. **CapEx: CFS input vs schedules**  
   Historical CapEx is CFS input only. Projection CapEx can be overwritten by BS Build from schedules. The historical CFS builder does not pull CapEx from a schedule or BS; any tie between reported CapEx and PP&E movement is conceptual, not enforced in code.

7. **CFO auto-add effect**  
   The `useEffect` in CashFlowBuilder that auto-adds `cfo_*` rows runs when `cfoIntelligence` or `cashFlow` changes and can insert rows repeatedly if dependencies or guards are not stable; the code checks `!exists` per item but the effect is broad.

---

## 12. Recommended Implementation Roadmap (High Level)

1. **Clarify single source for CFS drivers**  
   - Decide and document: for historical CFS, which items are “reported” (user types) vs “derived” (from IS/BS/disclosures).  
   - Option A: Keep Net Income and SBC as derived; D&A and WC as user input for historical.  
   - Option B: Allow “reported” mode where user can type Net Income / D&A / SBC / WC and optionally reconcile to IS/BS later.  
   - Unify SBC: either migrate CFS SBC to `embeddedDisclosures` (and deprecate sbcBreakdowns for CFS) or keep both and document that CFS uses sbcBreakdowns only.

2. **Historical CFS without breaking current builder**  
   - Add a clear “historical” vs “projection” (or “reporting” vs “model”) concept for CFS if needed.  
   - Keep existing `cashFlow` structure and core row IDs; add any new rows (e.g. beginning/ending cash) as optional or additive.  
   - Ensure new project and load project continue to set CFS from template or snapshot only.

3. **Reconciliation and validation**  
   - Add optional reconciliation: Beginning Cash + Net Change in Cash = Ending Cash; Ending Cash = BS Cash.  
   - Surface discrepancies in UI (e.g. warning in builder or preview) without blocking save.

4. **WC and D&A consistency**  
   - For historical years, consider: (a) WC either fully input or fully BS-derived with a single “reclass” line, and (b) D&A either from IS or one shared D&A input used by both IS and CFS.  
   - Keep WC children in sync with BS via `ensureWcChildrenFromBS` and document that BS `cashFlowBehavior` drives WC components.

5. **Documentation and tests**  
   - Document in code or docs: which CFS rows are calc vs input, and where each calc gets its inputs (IS, BS, sbcBreakdowns, etc.).  
   - Add tests for: template creation, load/save project (CFS in snapshot), recomputeCalculations for CFS (net_income, sbc, wc_change projection, operating_cf), and section assignment for custom rows.

This roadmap keeps the current builder and store structure intact while allowing a clear path to IB-grade historical CFS (reported vs derived, reconciliation, single source for SBC/D&A/WC) without breaking existing behavior.

---

## Deliverable: Historical CFO Source Hierarchy & Labeling (Completed)

### (1) Files that define historical source resolution

- **`lib/cfo-source-resolution.ts`** – Defines `CfoSourceType`, `CfoSourceResult`, `CfoSourceContext`; implements `resolveHistoricalCfoValue(rowId, year, context)` and `resolveHistoricalCfoValueOnly(rowId, year, context)`.
- **`lib/calculations.ts`** – Uses `resolveHistoricalCfoValueOnly` for CFS `net_income`, `sbc`, and `danda` when `isInCFS` and `allStatements` (and optional `embeddedDisclosures`). `computeRowValue` and `recomputeCalculations` accept optional 8th parameter `embeddedDisclosures`.
- **`store/useModelStore.ts`** – All `recomputeCalculations` call sites pass `state.embeddedDisclosures ?? []`.
- **`components/excel-preview.tsx`** – CFS net_income/danda/sbc use resolver or stored value; passes `embeddedDisclosures` into `computeRowValue`.
- **`components/cash-flow-builder.tsx`** – SBC auto-populated value uses `resolveHistoricalCfoValueOnly("sbc", ...)`; all `computeRowValue` calls pass `embeddedDisclosures`.
- **`lib/excel-export.ts`** – `ExportStatementContext` includes `embeddedDisclosures`; `computeRowValue(..., embeddedDisclosures)` used when resolving cell values.
- **`app/api/generate-excel/route.ts`** – Passes `modelState.embeddedDisclosures ?? []` in export context.
- **`types/finance.ts`** – Optional `Row.cfoSource?: { sourceType; sourceDetail }` for future UI/audit (not yet populated in resolution path).

### (2) Exact hierarchy per row

| Row | Priority 1 | Priority 2 | Priority 3 |
|-----|------------|------------|------------|
| **Net Income** | Income Statement (derived/linked) | — | — |
| **SBC** | User-entered reported CFS value | Embedded disclosure SBC total | 0 |
| **D&A** | User-entered reported CFS D&A | IS D&A row or danaBreakdowns | 0 |
| **Amortization** (if separate row) | Reported CFS | Embedded amortization disclosure total | 0 |
| **WC change** | Historical = reported only | Projection = engine (BS-derived) | — |
| **Other operating** | Manual only | — | — |

SBC and D&A treat “reported” as “value present for that year on the CFS row” (including explicit 0).

### (3) sbcBreakdowns and CFS

- **sbcBreakdowns is not used for CFS SBC.** The CFS path is: reported CFS value → embedded disclosure total (`getTotalSbcForYearFromEmbedded`) → 0. `lib/cfo-source-resolution.ts` does not reference `sbcBreakdowns`. `lib/calculations.ts` uses only the resolver for CFS SBC (no `getTotalSbcForYear`). Preview and cash-flow-builder use `resolveHistoricalCfoValueOnly("sbc", ...)` or `computeRowValue(..., embeddedDisclosures)`.
- **sbcBreakdowns** remains in use for Income Statement SBC breakdown (e.g. IS Build, IS totals). It is isolated from CFS by using the single hierarchy above for CFS.

### (4) Builder historical CFS consistency

- **Store:** `recomputeCalculations` runs with `embeddedDisclosures` and resolves net_income, danda, sbc via `resolveHistoricalCfoValueOnly` inside `computeRowValue` when in CFS. Stored CFS row values are therefore consistent with the hierarchy.
- **Preview:** Uses the same resolver for CFS net_income/danda/sbc (and passes `embeddedDisclosures` to `computeRowValue` in fallback paths). No CFS SBC fallback to `getTotalSbcForYear`.
- **Cash-flow builder:** Suggested/auto-populated SBC uses `resolveHistoricalCfoValueOnly("sbc", ...)`. Displayed values come from store (after recompute) or from `computeRowValue(..., embeddedDisclosures)`.
- **Excel export:** Uses `computeRowValue(..., embeddedDisclosures)` so exported CFS values follow the same resolution.

So builder, preview, and export all resolve historical CFO (Operating) rows consistently.

### (5) UI-visible source labels

- **Not implemented.** The type `Row.cfoSource?: { sourceType; sourceDetail }` exists on `Row` for future use. Resolution logic returns `CfoSourceResult` (value + sourceType + sourceDetail) in `cfo-source-resolution.ts`, but no code currently writes this back onto rows or displays it in the UI. Logic-first phase is done; UI labels can be added later by persisting/displaying `cfoSource` from the resolver.

---

## Validation Check Results (Code Trace)

*Results below are derived from tracing the implementation. Manual UI testing will confirm behavior.*

### 1. Net Income

- **Change IS Net Income → CFS Net Income updates:** Yes. CFS net_income is never read from the CFS row’s stored value; `resolveHistoricalCfoValue("net_income", ...)` always returns `incomeStatement.find(r => r.id === "net_income")?.values?.[year] ?? 0`. So when you change IS Net Income and the store runs `recomputeCalculations` (e.g. after `updateRowValue` on the IS), cash flow is recomputed and `computeRowValue` for the CFS net_income row uses that resolver → CFS Net Income shows the current IS value.
- **CFS Net Income is not manual:** Correct. There is no “reported CFS” branch for net_income; the resolver has no `getStoredCfsValue` check for net_income. The CFS net_income row is effectively read-only from the IS.

### 2. SBC

- **No manual CFS SBC → CFS uses SBC disclosure total:** Yes. Resolver order: (1) `getStoredCfsValue(cashFlowRows, "sbc", year)` — if `reported !== undefined` use it; (2) else `getTotalSbcForYearFromEmbedded(embeddedDisclosures, year)`; (3) else 0. With no value stored on the CFS SBC row, step 1 yields undefined, so the embedded disclosure total is used.
- **Manual CFS SBC entered → reported overrides disclosure:** Yes. As soon as the CFS SBC row has a value for that year (including 0), `reported !== undefined` is true and that value is returned; embedded disclosure is not used for that year.
- **No double counting:** SBC in CFS uses a single path: reported CFS → embedded disclosure total → 0. `sbcBreakdowns` is not used for CFS, so IS SBC breakdown and CFS SBC are not both fed into the same CFS line.

### 3. D&A

- **No manual CFS D&A → fallback used:** Yes. Resolver: (1) reported CFS D&A if present; (2) else IS D&A row value; (3) else `danaBreakdowns[year]`; (4) else 0. With nothing on the CFS D&A row, (2) or (3) supplies the value.
- **Manual CFS D&A entered → reported overrides fallback:** Yes. If the CFS danda row has a value for that year, step (1) returns it and IS/danaBreakdowns are not used.
- **No double counting:** Only one of reported CFS, IS D&A, or danaBreakdowns is used per year; no summing of multiple sources.

### 4. Amortization

- **Separate CFS row:** The default CFS template (`createCashFlowTemplate`) does **not** include an amortization or amortization_intangibles row. Only net_income, danda, sbc, wc_change, other_operating, operating_cf, etc.
- **Source resolution:** If a row with `id` `amortization` or `amortization_intangibles` existed in CFS, the logic in `cfo-source-resolution.ts` would apply: (1) reported CFS value, (2) `getTotalAmortizationForYearFromEmbedded(embeddedDisclosures, year)`, (3) 0. That path is not used by any default row today.
- **Current behavior:** Amortization is not exposed as a separate CFS line in the default UI/template. D&A on CFS is the single “Depreciation & Amortization” row (danda), which uses the D&A hierarchy above (reported → IS → danaBreakdowns → 0).

### 5. Working Capital

- **Historical CFS WC different from BS-implied:** For historical years (`year.endsWith("A")`), `computeRowValue` for `wc_change` does: `const storedValue = findRowValue(statementRows, "wc_change", year); return storedValue;`. No BS or delta calculation is used for historical. So if you enter a historical CFS WC value (e.g. -50), that value is stored and returned; it is never overwritten by a BS-derived number for that historical year.
- **Projection years:** For projection years the engine uses `getDeltaWcBs(...)` and returns `-deltaWcBs`; historical path is separate and remains reported-only.

### 6. Where source metadata is stored/resolved

| Row           | Where resolved | Where (if anywhere) stored |
|---------------|-----------------|-----------------------------|
| **Net Income**| `lib/cfo-source-resolution.ts` → `resolveHistoricalCfoValue("net_income", ...)` always reads IS. `lib/calculations.ts` calls `resolveHistoricalCfoValueOnly("net_income", ...)` when `rowId === "net_income"` and `isInCFS`. | Not stored. Only the numeric value is written to the CFS row via `recomputeCalculations`; `Row.cfoSource` is never set. |
| **SBC**       | Same resolver: reported CFS → embedded disclosure total → 0. Invoked from `calculations.ts` for `rowId === "sbc"` and in operating_cf sum. | Not stored. No code assigns `cfoSource` on the row. |
| **D&A**       | Same resolver: reported CFS → IS D&A → danaBreakdowns → 0. Invoked from `calculations.ts` for `rowId === "danda"` and in operating_cf sum. | Not stored. |
| **Amortization** | Resolver supports `amortization` / `amortization_intangibles`: reported → embedded amortization total → 0. No default CFS row uses it. | Not stored; no CFS row in template. |
| **Working Capital** | Historical: `findRowValue(statementRows, "wc_change", year)` only (stored value). Projection: `getDeltaWcBs` in calculations. Resolver returns `sourceType: "reported"` for historical, `"derived"` for projection. | Not stored on row. |

**Summary:** Source metadata (`sourceType`, `sourceDetail`) is computed inside `resolveHistoricalCfoValue()` in `lib/cfo-source-resolution.ts` and returned as `CfoSourceResult`. Only the `.value` is used by the engine and preview; nothing writes `Row.cfoSource`. So metadata is “resolved” in one place (the resolver) and is not persisted or shown in the UI.

### 7. Observed results summary

- **Net Income:** CFS Net Income tracks IS Net Income; changing IS updates CFS after recompute; CFS Net Income is not editable as a separate source.
- **SBC:** With no CFS SBC input, CFS shows embedded disclosure total; with CFS SBC entered, that value wins; single source per year, no double count.
- **D&A:** With no CFS D&A input, CFS uses IS or danaBreakdowns; with CFS D&A entered, that value wins; single source per year.
- **Amortization:** No separate CFS row in template; resolution exists for a future/optional amortization row (reported → embedded amortization total → 0).
- **Working Capital:** Historical CFS WC is reported-only; a manually entered historical value is kept and not overwritten by BS.
- **Source metadata:** Resolved only in `cfo-source-resolution.ts`; not stored on rows and not visible in the UI.
