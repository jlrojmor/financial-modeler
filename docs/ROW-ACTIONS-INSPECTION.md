# Row Actions Inspection (Historicals Builders)

## 1. Where action buttons are decided

### Income Statement (`components/income-statement-builder.tsx`)
- Rows are rendered via **UnifiedItemCard** (lines ~461–483, ~500–523).
- Props passed: `showRemove={!isCalculatedOutput && !allProtectedItems.includes(row.id)}`, `showConfirm={!isCalculatedOutput}`, `protectedRows={allProtectedItems}`, `onRemove={handleRemoveItem}`. **No `onConfirm`** is passed.
- The card decides internally: "Confirm" (when expanded), "Edit" (when collapsed and confirmed), "Remove" (when `canRemove`).

### Balance Sheet (`components/balance-sheet-builder-unified.tsx`)
- Rows are rendered via **UnifiedItemCard** in each category (lines ~962–972 and similar blocks).
- Props: `showRemove={!isTotalRow}`, `showConfirm={true}`, `onRemove={handleRemoveItem}`, `protectedRows={protectedTotalRows}`. **No `onConfirm`** passed.
- Same internal logic as IS.

### Cash Flow (`components/cash-flow-builder.tsx`)
- **Custom inline UI** (no UnifiedItemCard) for top-level and WC child rows (lines ~1199–1217, ~1332–1365).
- Buttons: **"Done" / "Edit"** (toggle `confirmedRowIds`), **"Confirm"** (only when `getFinalRowClassificationState(…).reviewState === "needs_confirmation"`, calls `confirmRowReview("cashFlow", row.id)`), **"Remove"**.

---

## 2. What "Done" currently means

- **CFS only.** Shown when the row is **expanded** (`confirmedRowIds[rowId] === false`). Clicking it calls `toggleConfirmedRow(rowId)` → sets `confirmedRowIds[rowId] = true` and **collapses** the row (hides value inputs).
- So: **"Done" = "I'm done editing values; collapse this row."**
- IS/BS do not use the label "Done"; they use UnifiedItemCard’s "Confirm" for collapse.

---

## 3. What "Confirm" currently means

- **UnifiedItemCard (IS/BS):** The button labeled **"Confirm"** runs `handleConfirm`: sets local `isConfirmed = true`, `isExpanded = false` (collapses the card). If `onConfirm` were passed, it would call `onConfirm(row.id)` — but **IS and BS never pass `onConfirm`**, so "Confirm" in IS/BS is **only** "collapse the card" (i.e. "done editing this card"), not review/classification.
- **CFS:** **"Confirm"** is a **separate** inline button, shown only when `getFinalRowClassificationState(row, "cashFlow", context).reviewState === "needs_confirmation"`. It calls `confirmRowReview("cashFlow", row.id)`, which updates the row to trusted (e.g. `forecastMetadataStatus`, `taxonomyStatus`, `classificationSource`). So in CFS: **"Confirm" = accept suggested classification.**

---

## 4. What "Edit" currently means

- **UnifiedItemCard:** When the card is **collapsed** and `isConfirmed === true`, the card shows an **"Edit"** button. Clicking it runs `handleEdit`: `setIsConfirmed(false)`, `setIsExpanded(true)` → **expands** the card so the user can edit **numeric values**. So **"Edit" = expand to edit values.** There is no "edit row" (label/name or classification) in the card.
- **CFS:** When **collapsed** (`isTopConfirmed` / `isConfirmed` true), **"Edit"** is shown. Clicking toggles `confirmedRowIds[rowId]` to `false` → **expands** the row to show value inputs. So **"Edit" = expand to edit values.** No label or classification edit in the row UI.

---

## 5. Which rows are removable vs non-removable

| Builder | Non-removable | Removable |
|--------|----------------|-----------|
| **IS** | Calculated outputs (gross_profit, gross_margin, ebit, ebit_margin, ebt, ebt_margin, net_income, net_income_margin); core inputs (rev, cogs, tax, operating_expenses) | Operating-expense children (SG&A, R&D, etc.), Interest & Other items, breakdown children |
| **BS** | Total rows (`row.id.startsWith("total_")` or `kind === "total"`) | All non-total rows in each category |
| **CFS** | `operating_cf`, `investing_cf`, `financing_cf`, `net_change_cash`, `net_income`, `fx_effect_on_cash`, and section total row | All other rows (including WC children and custom CFI/CFF rows) |

---

## 6. Which rows are editable by values only vs full row metadata

- **IS:** All rows in UnifiedItemCard get **value inputs** when expanded. Section/operating are editable via **metadata UI** in some flows (`updateIncomeStatementRowMetadata`). There is **no** inline "edit row label" in the card.
- **BS:** Same: value inputs in the card; **cashFlowBehavior** dropdown in some cases. No inline label edit.
- **CFS:** Value inputs when not "confirmed" (expanded). No label edit in the row card; classification is via the inline **"Confirm"** (when needs_confirmation) or elsewhere. Store has **`renameRow(statement, rowId, label)`** but it is not wired to the CFS row UI.

---

## Summary

- **Confirm** in IS/BS = collapse card (no review/classification). **Confirm** in CFS = accept suggested classification.
- **Done** (CFS) = collapse row after editing values.
- **Edit** (all) = expand to edit numeric values only; no "edit row" (label/classification) in any builder.
- Removability is per-builder (IS: protected list; BS: total rows; CFS: protected list).
- No shared, explicit "Edit row" or label-edit flow; no re-run of classification on label change.

---

## Post-implementation: standardized action model

After implementation:

1. **UnifiedItemCard (IS/BS)**  
   - **Confirm** is shown only when `reviewState === "needs_confirmation"` and calls `onConfirmSuggestion(row.id)` (accept suggested classification).  
   - **Edit values** = expand/collapse value inputs (collapsed: button "Edit values" expands; no "Done").  
   - **Edit row** = when `showEditRow` and `onEditRow`, opens inline label edit (parent passes `editingLabelRowId`, `editingLabelValue`, save/cancel callbacks).  
   - **Remove** unchanged; collapse is via chevron only.

2. **CFS builder**  
   - **Edit values** when collapsed / **Collapse** when expanded (replaces Done/Edit).  
   - **Edit row** for non-standard rows; inline label edit with Save/Cancel.  
   - **Confirm** only when `getFinalRowClassificationState(…).reviewState === "needs_confirmation"` (inline small button).  
   - **Remove** unchanged.

3. **Label-edit rule**  
   - `renameRow(statement, rowId, label)` in the store: after renaming, if the row is not a template/anchor row, re-applies taxonomy via `applyTaxonomyToRow` and sets `forecastMetadataStatus` and `taxonomyStatus` to `"needs_review"` so the row enters needs_confirmation.

4. **Deterministic/template rows**  
   - No Remove when protected (IS: allProtectedItems; BS: total rows; CFS: protected list).  
   - Confirm only when there is a pending suggestion (`reviewState === "needs_confirmation"`).  
   - Edit row: IS/BS show for custom (showRemove) rows; CFS for non-standard rows.

5. **Calculated rows**  
   - No edit/remove actions (UnifiedItemCard: isCalculated → no value inputs; CFS: protected rows no Remove).
