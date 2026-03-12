# Phase 2 Forecast Routing — Structural Validation

**Purpose:** Diagnostic validation that the current data model and metadata system are sufficient to support the forecast routing design in `docs/PHASE-2-FORECAST-ROUTING-BLUEPRINT.md`. **No code changes, no projection logic, no formulas.**

---

## Part 1 — Metadata Availability Per Statement

### Row type (all statements)

Every `Row` in the store has at least: `id`, `label`, `kind`, `valueType`, `values?`, `children?`. These are required by the template and the Row interface.

### Income Statement row structure (current)

Template rows (from `lib/statement-templates.ts` `createIncomeStatementTemplate`) contain:

- **id**, **label**, **kind**, **valueType**, **values**, **children**
- **sectionOwner** — set on rev, cogs, gross_profit/gross_margin (none), operating_expenses, sga, rd, other_opex, danda, ebit/ebit_margin (none), interest_expense, interest_income, other_income, ebt/ebit_margin (none), tax, net_income/net_income_margin (none)
- **isOperating** — set true/false on all input rows that have sectionOwner
- **isTemplateRow** — not in template; added by backfill for deterministic rows

Backfill (`backfillIncomeStatementClassification`) adds for **custom** rows missing sectionOwner/isOperating:

- **sectionOwner**, **isOperating** (from `getFallbackIsClassification(label)`)
- **classificationSource**: `"fallback"`
- **forecastMetadataStatus**: `"needs_review"`

Backfill does **not** set classificationSource or forecastMetadataStatus on **template** rows (deterministic rows keep existing fields only; `isTemplateRow: true` is set).

Taxonomy backfill (`backfillIsTaxonomy`) adds for **all** rows (when it runs):

- **taxonomyType**, **taxonomyCategory**, **taxonomySource** (`"system"` for template ID, `"fallback"` otherwise)
- **taxonomyStatus** (`"trusted"` for template, `"needs_review"` for fallback)

**1️⃣ Always present (after init/load):** id, label, kind, valueType, values, children. For template IS rows: sectionOwner, isOperating (from template). For custom IS rows after backfill: sectionOwner, isOperating (template or backfill), and taxonomy fields (after taxonomy backfill).

**2️⃣ Sometimes missing:** classificationSource, forecastMetadataStatus — template IS rows do not have these set by backfill (they remain undefined). Taxonomy fields — missing on **newly added rows** until the next load or init, because backfill runs only on `initializeModel` and `loadProject`, not after `addChildRow`.

**3️⃣ Filled by AI/classification pipeline:** When the user uses AI classification (e.g. CFS classify API), rows get classificationSource `"ai"`, classificationReason, classificationConfidence; taxonomy can be set with taxonomySource `"ai"`. Backfill sets classificationSource `"fallback"` and forecastMetadataStatus `"needs_review"` for custom IS rows; taxonomy backfill sets taxonomySource `"system"` or `"fallback"` and taxonomyStatus.

**4️⃣ User-set:** sectionOwner, isOperating (via IS metadata UI); classificationSource, forecastMetadataStatus, taxonomyStatus (via confirmRowReview, updateIsRowMetadataDeep when user sets section/operating). When user sets classification, store actions set classificationSource to `"user"` and forecastMetadataStatus/taxonomyStatus to `"trusted"`.

---

### Balance Sheet row structure (current)

Template rows (from `createBalanceSheetTemplate`) contain:

- **id**, **label**, **kind**, **valueType**, **values**, **children**
- **cashFlowBehavior** — set for all input and total rows (working_capital, investing, financing, non_cash)

Backfill (`backfillBalanceSheetClassification`) adds:

- For **core** rows (by id): **cashFlowBehavior** (and **scheduleOwner** for ppe, intangible_assets from `getCoreLockedBehavior`).
- For **non-core** rows missing behavior: **cashFlowBehavior**: `"unclassified"`, **classificationSource**: `"unresolved"`, **forecastMetadataStatus**: `"needs_review"`.

Taxonomy backfill adds taxonomyType, taxonomyCategory, taxonomySource, taxonomyStatus (same pattern as IS).

**scheduleOwner** is set (1) by backfill for **ppe** and **intangible_assets** only (from `CORE_BS_LOCKED_BEHAVIOR`), and (2) by `applyBsBuildProjectionsToModel` when writing schedule output to those rows.

**1️⃣ Always present (after init/load):** id, label, kind, valueType, values, children. cashFlowBehavior on all rows (from template or backfill). Taxonomy fields after taxonomy backfill.

**2️⃣ Sometimes missing:** scheduleOwner — only on ppe and intangible_assets (and only after backfill or apply). classificationSource, forecastMetadataStatus — not set on template BS rows by backfill; only on non-core rows that get unclassified. Taxonomy — missing on newly added BS rows until next load.

**3️⃣ Filled by backfill/AI:** cashFlowBehavior, scheduleOwner (core rows), classificationSource/forecastMetadataStatus (non-core unresolved), taxonomy (when backfill runs).

**4️⃣ User-set:** cashFlowBehavior (via BS UI); classificationSource, forecastMetadataStatus, taxonomyStatus (via confirmRowReview, setBalanceSheetRowCashFlowBehavior).

---

### Cash Flow Statement row structure (current)

Template rows contain:

- **id**, **label**, **kind**, **valueType**, **values**, **children**
- **cfsForecastDriver** — set for all anchor rows (income_statement, danda_schedule, working_capital_schedule, capex_schedule, debt_schedule, financing_assumption, manual_other, manual_mna)
- **cfsLink** — section, impact, description, cfsItemId for investing/financing/cash_bridge rows (template). Operating anchors (net_income, danda, sbc, wc_change, other_operating, operating_cf) do not have cfsLink in the initial template snippet checked; backfill sets cfsLink.section for all anchors.
- **historicalCfsNature** — set in template for fx_effect_on_cash; other anchors get it from backfill.

Backfill (`backfillCashFlowClassification`) adds for **anchors** (by id):

- **historicalCfsNature** (from `getHistoricalNatureForAnchor`)
- **cfsForecastDriver** (from `getForecastDriverForAnchor`)
- **cfsLink.section** (from sectionByAnchor map)

For **custom** CFS rows missing section/nature: **classificationSource**: `"unresolved"`, **forecastMetadataStatus**: `"needs_review"`.

`backfillCfsMetadataNature` adds **historicalCfsNature** where cfsLink.section exists but historicalCfsNature is missing (investing → reported_investing, financing → reported_financing, cash_bridge → reported_meta, operating only when parentId === "wc_change").

When adding CFS rows via the builder: “Add” dialog and “Suggested CFI/CFF” set **cfsLink.section**, **historicalCfsNature**, **cfsForecastDriver** (and for suggested items, classificationSource `"user"`, forecastMetadataStatus/taxonomyStatus `"trusted"`). When adding a **WC child** via addWcChild, **historicalCfsNature** is set to reported_working_capital_movement; **cfsForecastDriver** and **cfsLink** are not set on that child (driver can be inferred from parent wc_change).

**1️⃣ Always present (after init/load):** id, label, kind, valueType, values, children. For **template/anchor** CFS rows: cfsForecastDriver, cfsLink.section, historicalCfsNature (from template + classification backfill + CFS nature backfill). Taxonomy after taxonomy backfill.

**2️⃣ Sometimes missing:** On **custom** CFS rows added via **addChildRow** (e.g. generic “Add row” under a section without going through the Add dialog): cfsLink, cfsForecastDriver can be missing. WC children get historicalCfsNature but not cfsForecastDriver on the row. Taxonomy missing until next load for any newly added row.

**3️⃣ Filled by backfill/AI:** historicalCfsNature, cfsForecastDriver, cfsLink.section for anchors; backfillCfsMetadataNature for section-known rows missing nature; taxonomy when backfill runs. AI classify sets cfsLink, forecastDriver, historicalCfsNature when user uses AI.

**4️⃣ User-set:** cfsLink, cfsForecastDriver, historicalCfsNature (via CFS metadata UI and updateCashFlowRowMetadataDeep); classificationSource, forecastMetadataStatus, taxonomyStatus (via confirmRowReview and when setting driver/section/nature).

---

## Part 2 — Trust State Reliability

### How the fields are set

- **forecastMetadataStatus:** Set by (1) backfill to `"needs_review"` for custom/unresolved rows; (2) `confirmRowReview` and user classification actions to `"trusted"`; (3) template rows do not have it set by backfill (remain undefined).
- **taxonomyStatus:** Set by (1) taxonomy backfill to `"trusted"` (template/system) or `"needs_review"` (fallback/AI low confidence); (2) `confirmRowReview` and user classification to `"trusted"`; (3) not set on new rows until backfill runs.
- **classificationSource:** Set by (1) backfill to `"fallback"` (IS custom), `"unresolved"` (BS/CFS custom missing metadata); (2) user actions and confirmRowReview to `"user"`; (3) AI classify to `"ai"`. Template rows are not written by backfill (remain undefined).

### Where they are updated

- **confirmRowReview:** Sets forecastMetadataStatus, taxonomyStatus, classificationSource to trusted/user for the given row (updateRowReviewTrustedDeep).
- **updateIsRowMetadataDeep** (IS): When sectionOwner or isOperating is set, sets forecastMetadataStatus, taxonomyStatus, classificationSource to trusted/user.
- **setBalanceSheetRowCashFlowBehavior:** Sets forecastMetadataStatus, taxonomyStatus, classificationSource to trusted/user.
- **updateCashFlowRowMetadataDeep:** When cfsLink, historicalCfsNature, or classificationSource user is set, sets forecastMetadataStatus, taxonomyStatus, classificationSource to trusted/user.
- **Backfills:** Run only in `initializeModel` and `loadProject`; they do not run after addChildRow, insertRow, or renameRow.

### Can they become stale?

- **Yes, in two ways:**
  1. **Newly added rows:** addChildRow and insertRow do not run backfill. New rows get sectionOwner/cashFlowBehavior/classificationSource/forecastMetadataStatus from the add path, but **taxonomyType, taxonomyCategory, taxonomySource, taxonomyStatus** are not set until the next load or init. So new rows can have undefined taxonomy for the rest of the session.
  2. **Label/structural changes:** Renaming a row or moving it does not re-run backfill. So fallback taxonomy (based on label) and classification (e.g. getFallbackIsClassification) are not recomputed. Stored taxonomy and sectionOwner can be out of date with the new label. Trust state itself (trusted vs needs_review) is not auto-reverted when label changes.

### Are they recalculated when rows change?

- **No.** Backfill runs only on load and init. So when the user adds a row, renames it, or changes structure, classification and taxonomy are not recalculated in the same session (except for the initial values set in addChildRow/insertRow for sectionOwner, cashFlowBehavior, etc.).

### Can a row be incorrectly marked trusted?

- **Yes, if:** (1) The user clicks Confirm on a row that was actually misclassified (e.g. fallback put it in the wrong section). Confirm explicitly sets trusted/user and removes it from review. (2) The user sets sectionOwner/cashFlowBehavior/cfsLink in the UI; the store then marks the row trusted. So “incorrectly” is a user intent issue: once the user confirms or sets classification, the system treats it as trusted. There is no automatic re-check that the classification is semantically correct.

### Can a row stay in needs_review after being resolved?

- **Yes, if:** (1) The user fixes the row in the builder (e.g. sets cashFlowBehavior) but the update path does not call the same trusted update (it does — setBalanceSheetRowCashFlowBehavior and updateIsRowMetadataDeep set trusted). So normally fixing in the builder should clear review. (2) If the review panel or final classification state is computed from a different code path that does not see the updated store (e.g. stale closure or memo), the row could still appear in review until re-render. From the code, builder updates do set trusted, so the only risk is UI/recomputation not picking up the new state. (3) If the user only sets metadata that does not trigger the “set trusted” logic (e.g. a field that is not sectionOwner/cashFlowBehavior/cfsLink), the row could remain needs_review until the user clicks Confirm.

---

## Part 3 — Validate Routing Signals (Income Statement)

Blueprint routing keys (priority): sectionOwner → isOperating → taxonomyCategory/taxonomyType → taxonomyStatus → classificationSource → forecastMetadataStatus.

### Is sectionOwner always populated?

- **Template rows:** Yes (set in statement template).
- **Custom rows:** Yes after backfill or addChildRow (backfill uses getFallbackIsClassification; addChildRow sets sectionOwner from parent or getFallbackIsClassification). **Gap:** Custom rows added via a path that does not run backfill and does not set sectionOwner (e.g. insertRow with a raw row that has no sectionOwner) would lack it. Normal addChildRow for IS does set it.

### Is isOperating reliable?

- **Yes** for template and for custom rows that received backfill or addChildRow (template and getFallbackIsClassification set it). Same gap as above for other insertion paths.

### Is taxonomyCategory usable for routing?

- **Yes when present.** Taxonomy backfill sets it for all rows when it runs. **But** for newly added rows in the same session, taxonomyType/taxonomyCategory are not on the row. Routing can still use **getIsTaxonomy(row)** (or getRowTaxonomy) which computes from row.id (template), then sectionOwner, then label, so a routing layer that calls getRowTaxonomy at read time does not require stored taxonomy. So routing can work without stored taxonomy if the implementation uses the taxonomy helpers.

### Would any rows fail routing with this logic?

- **Template rows:** No; they have sectionOwner and isOperating.
- **Custom rows after load:** No; backfill has set sectionOwner, isOperating, and taxonomy.
- **Custom rows added in-session (addChildRow):** sectionOwner/isOperating are set; taxonomy is missing on the row but can be derived via getIsTaxonomy(row). So routing that uses sectionOwner first and taxonomy only when needed (or getIsTaxonomy) would not fail.
- **Rows added via insertRow with minimal payload:** If a row is inserted with only id, label, kind, values, children and no sectionOwner, it would fail sectionOwner-based routing until backfill runs. Such a path exists for CFS (insertRow) but for IS the main add path is addChildRow, which sets sectionOwner. So risk is low for IS.

---

## Part 4 — Validate Routing Signals (Balance Sheet)

Blueprint routing keys: cashFlowBehavior → scheduleOwner → taxonomyCategory/taxonomyType → taxonomyStatus → classificationSource → forecastMetadataStatus.

### Is cashFlowBehavior always set?

- **Template rows:** Yes (in template).
- **Core rows after backfill:** Yes (backfill sets from getCoreLockedBehavior).
- **Non-core rows after backfill:** Yes (backfill sets to `"unclassified"` if missing).
- **Newly added BS rows (addChildRow):** Yes (addChildRow sets cashFlowBehavior to `"unclassified"`). So for all BS rows that go through template or backfill or addChildRow, cashFlowBehavior is set.

### Does scheduleOwner exist yet?

- **Yes.** It is in the Row type and set (1) by backfill for **ppe** and **intangible_assets** (from CORE_BS_LOCKED_BEHAVIOR), and (2) by applyBsBuildProjectionsToModel when applying schedule output to those rows. It is not set for WC rows by backfill; the blueprint says WC schedule ownership can be inferred from cashFlowBehavior === "working_capital". So scheduleOwner is present where it is needed for PP&E and Intangibles; WC routing can use cashFlowBehavior.

### Is taxonomyCategory alone sufficient to identify WC / fixed assets / financing rows?

- **Not alone.** taxonomyCategory is current_asset, fixed_asset, current_liability, etc. It does not directly say “working_capital” vs “cash” vs “debt.” **cashFlowBehavior** is the field that distinguishes working_capital, investing, financing, non_cash. So for BS routing, **cashFlowBehavior is required**; taxonomyCategory can support refinement (e.g. which WC item type for method suggestion). Current state: cashFlowBehavior is set for all rows (template or backfill or addChildRow), so WC vs fixed vs financing can be identified.

### Row types that cannot be routed with current metadata?

- **None** for standard paths. All BS rows get cashFlowBehavior. Custom rows added via addChildRow get unclassified; they can be routed to “manual” or “unclassified” until the user sets behavior. The only theoretical gap is a BS row inserted via a path that does not set cashFlowBehavior (no such path was found in the code; addChildRow sets it).

---

## Part 5 — Validate Routing Signals (Cash Flow Statement)

Blueprint routing keys: cfsForecastDriver → cfsLink.section → historicalCfsNature → taxonomyCategory/taxonomyType → classificationSource → forecastMetadataStatus.

### Does cfsForecastDriver exist?

- **Yes.** In the Row type and in the template for all anchor rows. Backfill sets it for anchors that lack it. Custom rows added via the builder “Add” flow get it (from AI or default). **Gap:** CFS rows added as **children of wc_change** (addWcChild) get historicalCfsNature but **not** cfsForecastDriver on the row. The driver can be inferred from parent (parentId === "wc_change" → working_capital_schedule).

### Is historicalCfsNature consistently populated after backfill?

- **Yes for anchors and section-known rows.** backfillCashFlowClassification sets it for anchors from CFS_ANCHOR_HISTORICAL_NATURE; backfillCfsMetadataNature sets it for rows that have cfsLink.section but missing nature (investing, financing, cash_bridge, and operating only when parentId === "wc_change"). Custom operating rows without section or with section "operating" and not under wc_change are not backfilled for nature by backfillCfsMetadataNature (by design). So consistency is high for template and for rows that have section; custom operating rows may rely on builder-set nature or inference.

### Is cfsLink.section always present?

- **For template/anchor rows:** Yes (template or backfill).
- **For custom rows added via builder:** Yes (Add dialog and Suggested CFI/CFF set cfsLink.section).
- **For WC children (addWcChild):** The child is added under wc_change; the child row does not have cfsLink set in the snippet. So **wc_change children** may have **historicalCfsNature** (reported_working_capital_movement) but **no cfsLink.section** on the row. Section can be inferred from parent (wc_change → operating).

### Can WC children be identified via parentId === "wc_change"?

- **Yes.** The tree structure has wc_change as parent of WC component rows. So for routing, “parentId === 'wc_change'” or “row is in wc_row.children” identifies WC movement rows; driver can be working_capital_schedule without storing cfsForecastDriver on each child.

### Can the CFS structure already support driver-based routing?

- **Yes.** After load/init, every anchor has cfsForecastDriver and cfsLink.section. Custom rows added via the main Add flow get section and driver. WC children can be routed by parent (wc_change) to working_capital_schedule. So a routing layer that (1) uses cfsForecastDriver when present, (2) infers working_capital_schedule for wc_change children when driver is missing, and (3) falls back to cfsLink.section or row id for known anchors can support driver-based routing with the current structure.

---

## Part 6 — Missing Metadata Required for Phase 2

From the blueprint and current types:

- **forecastMethod (or equivalent) on Row:** The blueprint defines forecast *method families* (e.g. growth_rate, percent_of_revenue, from_capex_schedule). The Row type does **not** have a field like `forecastMethod`. The blueprint says routing should *decide* the method from metadata (sectionOwner, cfsForecastDriver, etc.), not necessarily store it. So **no new field is strictly required** if the routing layer computes the method at read time from existing metadata. Optionally, a stored `forecastMethod` could be added later for user overrides.

- **scheduleOwner:** Already exists. Set for ppe and intangible_assets; WC can be inferred from cashFlowBehavior. No new field needed.

- **cfsForecastDriver:** Already exists and is set for anchors and for custom rows added through the builder. No new field needed.

- **routingSource / driverStatement:** Not in the blueprint as required row fields; routing can be implemented as a function(row, statement) → method/driver. No new field required.

**Conclusion:** No new metadata fields are strictly required for Phase 2 routing. The existing fields (sectionOwner, isOperating, cashFlowBehavior, cfsLink.section, cfsForecastDriver, historicalCfsNature, taxonomyType, taxonomyCategory, taxonomyStatus, classificationSource, forecastMetadataStatus) are sufficient, provided the routing layer uses inference for WC children (parentId === "wc_change") and, if needed, getRowTaxonomy(row) when stored taxonomy is missing (e.g. new rows).

**Minimal additions that would improve readiness:**

1. **Run taxonomy backfill (or apply taxonomy at add time) after addChildRow/insertRow** so that newly added rows have taxonomyType, taxonomyCategory, taxonomySource, taxonomyStatus without requiring a reload. Alternatively, the routing layer can use getRowTaxonomy(row) so that stored taxonomy is optional.
2. **Set cfsForecastDriver on WC children** when adding (e.g. "working_capital_schedule") so that driver-based CFS routing does not need parent inference. Optional; inference is sufficient.

---

## Part 7 — Compatibility With Existing Forecast Logic

Table: where current projection logic uses row ID or position vs what metadata could replace it.

| Current logic | Current trigger | Replace with metadata |
|---------------|-----------------|------------------------|
| Revenue forecast | `incomeStatement.find(r => r.id === "rev")`, stream ids from `rev.children` | sectionOwner === "revenue"; revenue rows = rows with sectionOwner === "revenue" (or taxonomy category revenue). Streams = children of the revenue parent (structural). |
| COGS projection | row.id === "cogs", cogs children, label match to stream | sectionOwner === "cogs" (or taxonomy cost_of_revenue); COGS lines = rows with that section. Stream mapping by taxonomy or section, not label. |
| SG&A projection | parent id sga, sga.children | sectionOwner === "sga" (or taxonomy opex_sga); SG&A lines = rows with that section. |
| Operating expenses sum | row.id === "operating_expenses", isOperatingExpenseRow(r) | sectionOwner in (sga, rd, other_operating) or isOperatingExpenseRow (which uses sectionOwner). Keep structural parent or sum by sectionOwner. |
| WC schedule item list | wc_change.children + getRowsForCategory(BS, category) by position | cashFlowBehavior === "working_capital" for BS rows; WC items = BS rows with that behavior (and in current_assets/current_liabilities by category or taxonomy). wc_change.children kept in sync for display. |
| getWcBsBalance / getDeltaWcBs | cashFlowBehavior === "working_capital", getRowsForCategory | Already uses cashFlowBehavior. Replace getRowsForCategory (position) with category from taxonomy or explicit category when available. |
| PP&E / Intangibles write | row.id === "ppe", row.id === "intangible_assets" | scheduleOwner === "capex" / "intangibles" or cashFlowBehavior === "investing" + taxonomy (asset_ppe, asset_intangibles). Row id fallback for anchors. |
| CFS operating_cf | findIndex(net_income), findIndex(operating_cf), sum between | Sum all rows where cfsLink.section === "operating" (and row.id !== "operating_cf"). |
| CFS investing_cf | findIndex(capex), findIndex(investing_cf), sum between; fallback cfsLink.section === "investing" | Sum all rows where cfsLink.section === "investing". |
| CFS financing_cf | findIndex(investing_cf), findIndex(financing_cf); fallback cfsLink.section === "financing" | Sum all rows where cfsLink.section === "financing". |
| CFS net income | rowId === "net_income" | cfsForecastDriver === "income_statement" or row id fallback. |
| CFS wc_change value | row.id === "wc_change", getDeltaWcBs | cfsForecastDriver === "working_capital_schedule" or row id; value from BS ΔWC. |
| CFS capex value | row.id === "capex" (when applying schedule) | cfsForecastDriver === "capex_schedule"; value from Capex schedule. |
| CFS danda value | row.id === "danda" | cfsForecastDriver === "danda_schedule"; value from D&A schedule. |
| applyBsBuildProjectionsToModel | idsToWrite = wc item ids + "ppe" + "intangible_assets" | idsToWrite = BS rows with cashFlowBehavior === "working_capital" (for WC) plus rows with scheduleOwner "capex" / "intangibles" (or id fallback). |

---

## Part 8 — Structural Risks

1. **Rows that can exist without metadata**  
   Newly added rows (addChildRow/insertRow) do not get taxonomy until the next load. They do get sectionOwner (IS), cashFlowBehavior (BS), and for CFS either full metadata (builder Add) or partial (WC child: historicalCfsNature only). So routing must handle missing taxonomy (e.g. via getRowTaxonomy(row)) and, for CFS WC children, missing cfsForecastDriver (infer from parent).

2. **Rows that can be classified but still ambiguous**  
   Rows with taxonomyStatus === "needs_review" or forecastMetadataStatus === "needs_review" have a suggested section/driver but are not confirmed. If the routing layer treats them as trusted and applies a forecast method, the user may have intended a different method. Blueprint: use trust state as a gate; do not silently route needs_review as trusted.

3. **Double-counting**  
   If CFS section totals are computed by position (sum between index i and j) and a custom row is inserted in a different order or appears twice in the tree, it could be missed or double-counted. Mitigation: sum by cfsLink.section so every row with that section is included once.

4. **Forecasting the same row twice**  
   If one path uses row id (e.g. "capex") and another uses cfsForecastDriver === "capex_schedule", and they are not aligned, the same row could be filled from two sources. Mitigation: single routing decision per row (driver or id), one source of value.

5. **Rows that cannot be routed**  
   A CFS row added via a path that sets no cfsLink, no cfsForecastDriver, and no parentId (e.g. a generic insertRow with minimal data) would have no routing signal. Such rows should be treated as manual_other and not receive schedule values until the user sets a driver or section.

6. **Stale trust state**  
   If the user renames a row or moves it, backfill does not re-run; taxonomy and sectionOwner may be wrong. Trust state remains trusted if the user had previously confirmed. So the row could be routed with outdated taxonomy/section. Mitigation: either re-run backfill on structural/label changes (future) or allow routing to prefer getRowTaxonomy(row) at read time so label changes are reflected when taxonomy is computed on the fly.

---

## Part 9 — Phase 2 Readiness Assessment

**Verdict: 2️⃣ MOSTLY READY — small metadata and flow additions recommended before Phase 2.**

### What is already in place

- **Row type** has all routing-relevant fields: sectionOwner, isOperating, cashFlowBehavior, cfsLink, cfsForecastDriver, historicalCfsNature, taxonomyType, taxonomyCategory, taxonomyStatus, taxonomySource, classificationSource, forecastMetadataStatus, scheduleOwner.
- **Templates** set sectionOwner, isOperating (IS), cashFlowBehavior (BS), cfsForecastDriver and cfsLink (CFS) for anchors.
- **Backfills** (classification, taxonomy, CFS nature) run on load and init and set missing metadata; user overrides are preserved.
- **User actions** (confirmRowReview, setBalanceSheetRowCashFlowBehavior, updateIsRowMetadataDeep, updateCashFlowRowMetadataDeep) set trusted/user and keep state consistent.
- **CFS** anchors and builder-added rows have cfsForecastDriver and cfsLink.section; WC children can be inferred from parent wc_change.
- **BS** core rows have cashFlowBehavior and scheduleOwner (ppe, intangible_assets); WC can be identified by cashFlowBehavior === "working_capital".
- **IS** template and backfilled custom rows have sectionOwner and isOperating; getIsTaxonomy supports read-time taxonomy when stored taxonomy is missing.

### Minimum recommended fixes before Phase 2

1. **Newly added rows and taxonomy**  
   Either (a) run taxonomy backfill (or a single-row taxonomy apply) after addChildRow and insertRow so new rows get taxonomyType, taxonomyCategory, taxonomySource, taxonomyStatus in the same session, or (b) document that the Phase 2 routing layer must use getRowTaxonomy(row) (and equivalent for BS/CFS) when stored taxonomy is missing so that new rows are routable without reload.

2. **CFS WC children**  
   Either (a) set cfsForecastDriver = "working_capital_schedule" (and optionally cfsLink.section = "operating") when adding a WC child, or (b) document that driver-based routing must treat “row in wc_change.children” as working_capital_schedule when cfsForecastDriver is missing.

3. **Template rows and trust fields**  
   Template IS/BS rows do not have classificationSource or forecastMetadataStatus set by backfill. The final row classification resolver already treats template rows as trusted without these. Document that routing may treat “deterministic/template row” (e.g. isTemplateRow or id in template set) as trusted for routing even when forecastMetadataStatus is undefined.

No new Row fields are required. With the above (or equivalent routing-time behavior), the current architecture can support the Phase 2 forecast routing blueprint.
