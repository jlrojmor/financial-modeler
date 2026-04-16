"use client";

import { useMemo } from "react";
import { useModelStore } from "@/store/useModelStore";
import type { ForecastDriversSubTab } from "@/store/useModelStore";
import type { Row } from "@/types/finance";
import { CheckCircle2, AlertCircle, Clock, Calculator, ArrowRight } from "lucide-react";
import { getBsLineCoverage } from "@/lib/bs-forecast-coverage";
import { getWcScheduleItems, cfsWcChildIdToBalanceSheetId } from "@/lib/working-capital-schedule";

type ForecastStatus = "forecasted" | "schedule" | "derived" | "not_configured" | "cash_plug" | "excluded";
type StatementSection = "is" | "bs" | "cfs";

interface LineItemStatus {
  id: string;
  label: string;
  status: ForecastStatus;
  source: string;
  jumpTo?: { step: "forecast_drivers"; subTab: ForecastDriversSubTab } | null;
  section: StatementSection;
}

const STATUS_CONFIG: Record<ForecastStatus, { label: string; color: string; bg: string; border: string }> = {
  forecasted:      { label: "Forecasted",   color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  schedule:        { label: "Schedule",     color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/30" },
  derived:         { label: "Derived",      color: "text-slate-400",   bg: "bg-slate-500/10",   border: "border-slate-500/30" },
  not_configured:  { label: "Not set",      color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/30" },
  cash_plug:       { label: "CFS plug",     color: "text-violet-400",  bg: "bg-violet-500/10",  border: "border-violet-500/30" },
  excluded:        { label: "Excluded",     color: "text-slate-500",   bg: "bg-slate-600/10",   border: "border-slate-600/30" },
};

const SECTION_LABELS: Record<StatementSection, string> = {
  is: "Income Statement",
  bs: "Balance Sheet",
  cfs: "Cash Flow Statement",
};

function flattenRows(rows: Row[]): Row[] {
  const out: Row[] = [];
  for (const r of rows) {
    out.push(r);
    if (r.children?.length) out.push(...flattenRows(r.children));
  }
  return out;
}

const SCHEDULE_OPEX_TYPES = new Set(["opex_danda", "opex_depreciation", "opex_amortization", "opex_sbc"]);
const EXCLUDED_OPEX_TYPES = new Set(["opex_impairment", "opex_restructuring"]);

function StatusBadge({ status }: { status: ForecastStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${cfg.bg} ${cfg.border} ${cfg.color} whitespace-nowrap`}>
      {cfg.label}
    </span>
  );
}

export default function ProjectedStatementsShell() {
  const meta = useModelStore((s) => s.meta);
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const balanceSheet = useModelStore((s) => s.balanceSheet);
  const cashFlow = useModelStore((s) => s.cashFlow);

  const revenueForecastConfigV1 = useModelStore((s) => s.revenueForecastConfigV1);
  const cogsForecastConfigV1 = useModelStore((s) => s.cogsForecastConfigV1);
  const opexForecastConfigV1 = useModelStore((s) => s.opexForecastConfigV1);
  const wcDriversConfirmed = useModelStore((s) => s.wcDriversConfirmed);
  const otherBsConfirmed = useModelStore((s) => s.otherBsConfirmed);
  const equityRollforwardConfirmed = useModelStore((s) => s.equityRollforwardConfirmed);
  const dandaScheduleConfirmed = useModelStore((s) => s.dandaScheduleConfirmed);
  const intIncomeScheduleConfirmed = useModelStore((s) => s.intIncomeScheduleConfirmed);
  const taxScheduleConfirmed = useModelStore((s) => s.taxScheduleConfirmed);
  const debtPersist = useModelStore((s) => s.debtSchedulePhase2Persist);
  const nonOpDirectByLine = useModelStore((s) => s.nonOperatingPhase2DirectByLine);
  const goToStep = useModelStore((s) => s.goToStep);
  const setForecastDriversSubTab = useModelStore((s) => s.setForecastDriversSubTab);

  const projectionYears = useMemo(() => meta?.years?.projection ?? [], [meta]);
  const debtApplied = debtPersist?.applied != null;

  const wcScheduleRowIds = useMemo(() => {
    const items = getWcScheduleItems(cashFlow ?? [], balanceSheet ?? []);
    return new Set(items.map((i) => i.id));
  }, [cashFlow, balanceSheet]);

  const hasRevenueConfig = useMemo(() => {
    const rows = revenueForecastConfigV1?.rows ?? {};
    return Object.keys(rows).length > 0;
  }, [revenueForecastConfigV1]);

  const hasCogsConfig = useMemo(() => {
    const lines = cogsForecastConfigV1?.lines ?? {};
    return Object.keys(lines).length > 0;
  }, [cogsForecastConfigV1]);

  const equitySbcMethod = useModelStore((s) => s.equitySbcMethod);

  // ── IS line items ──────────────────────────────────────────────────────────
  const isItems = useMemo((): LineItemStatus[] => {
    const items: LineItemStatus[] = [];
    const flat = flattenRows(incomeStatement ?? []);
    const opexLines = opexForecastConfigV1?.lines ?? {};

    for (const row of flat) {
      if (row.kind === "total" || row.kind === "subtotal" || row.kind === "calc") continue;
      if (row.id.startsWith("total_")) continue;

      const tt = row.taxonomyType as string | undefined;
      let status: ForecastStatus = "not_configured";
      let source = "Not configured";
      let jumpTo: LineItemStatus["jumpTo"] = null;

      // ── Revenue (all revenue_* taxonomy types) ──
      if (tt === "rev" || tt?.startsWith("revenue_") || row.id === "rev") {
        // Safety: if this row is actually in the OpEx config, route it there instead
        if (opexLines[row.id]) {
          const lineRoute = opexLines[row.id].routeStatus;
          if (lineRoute === "forecast_direct") { status = "forecasted"; source = "OpEx Direct Forecast"; }
          else if (lineRoute === "excluded_nonrecurring") { status = "excluded"; source = "Excluded (non-recurring)"; }
          else { status = "not_configured"; source = "OpEx (not configured)"; }
          jumpTo = { step: "forecast_drivers", subTab: "operating_costs" };
        } else {
          status = hasRevenueConfig ? "forecasted" : "not_configured";
          source = hasRevenueConfig ? "Revenue Drivers" : "Revenue Drivers (not set)";
          jumpTo = { step: "forecast_drivers", subTab: "revenue" };
        }

      // ── COGS ──
      } else if (tt?.startsWith("cogs_") || row.id === "cogs" || row.id?.startsWith("cogs_")) {
        status = hasCogsConfig ? "forecasted" : "not_configured";
        source = hasCogsConfig ? "COGS Forecast" : "COGS (not set)";
        jumpTo = { step: "forecast_drivers", subTab: "operating_costs" };

      // ── Calculated / derived ──
      } else if (tt?.startsWith("calc_")) {
        status = "derived";
        source = "Calculated";

      // ── Interest Expense (from debt schedule) ──
      } else if (tt === "non_op_interest_expense" || row.id === "interest_expense") {
        status = debtApplied ? "schedule" : "not_configured";
        source = debtApplied ? "Debt Schedule" : "Debt Schedule (not set)";
        jumpTo = { step: "forecast_drivers", subTab: "non_operating_schedules" };

      // ── Interest Income ──
      } else if (tt === "non_op_interest_income" || row.id === "interest_income") {
        status = intIncomeScheduleConfirmed ? "schedule" : "not_configured";
        source = intIncomeScheduleConfirmed ? "Interest Income Schedule" : "Interest Income (not set)";
        jumpTo = { step: "forecast_drivers", subTab: "non_operating_schedules" };

      // ── Tax ──
      } else if (tt === "tax_expense" || row.id === "tax") {
        status = taxScheduleConfirmed ? "schedule" : "not_configured";
        source = taxScheduleConfirmed ? "Tax Schedule" : "Tax Schedule (not set)";
        jumpTo = { step: "forecast_drivers", subTab: "non_operating_schedules" };

      // ── D&A / Depreciation / Amortization / SBC (schedule-driven OpEx) ──
      } else if (tt && SCHEDULE_OPEX_TYPES.has(tt)) {
        if (tt === "opex_sbc") {
          const sbcActive = dandaScheduleConfirmed || equitySbcMethod !== "auto";
          status = sbcActive ? "schedule" : "not_configured";
          source = sbcActive ? "SBC Schedule / Equity" : "SBC (not set)";
        } else {
          status = dandaScheduleConfirmed ? "schedule" : "not_configured";
          source = dandaScheduleConfirmed ? "D&A / Capex Schedule" : "Schedules (not set)";
        }
        jumpTo = { step: "forecast_drivers", subTab: "non_operating_schedules" };

      // ── Impairment / Restructuring (excluded non-recurring) ──
      } else if (tt && EXCLUDED_OPEX_TYPES.has(tt)) {
        const lineRoute = opexLines[row.id]?.routeStatus;
        if (lineRoute === "excluded_nonrecurring") {
          status = "excluded";
          source = "Excluded (non-recurring)";
        } else if (lineRoute === "forecast_direct") {
          status = "forecasted";
          source = "OpEx Direct Forecast";
        } else {
          status = "excluded";
          source = "Excluded (non-recurring)";
        }
        jumpTo = { step: "forecast_drivers", subTab: "operating_costs" };

      // ── Non-operating other lines (other income/expense, FX, investments) ──
      } else if (tt?.startsWith("non_op_")) {
        const directLine = nonOpDirectByLine?.[row.id];
        if (directLine?.applied) {
          status = "forecasted";
          source = "Non-Op Direct Forecast";
        } else {
          status = "not_configured";
          source = "Non-operating (not set)";
        }
        jumpTo = { step: "forecast_drivers", subTab: "non_operating_schedules" };

      // ── Generic OpEx lines (SGA, R&D, etc.) — per-line routeStatus ──
      } else if (tt?.startsWith("opex_") || tt === "sga" || row.id?.startsWith("sga_") || row.id?.startsWith("opex_") || opexLines[row.id]) {
        const lineRoute = opexLines[row.id]?.routeStatus;
        if (lineRoute === "forecast_direct") {
          status = "forecasted";
          source = "OpEx Direct Forecast";
        } else if (lineRoute === "derive_schedule") {
          status = "schedule";
          source = "Schedule-derived";
        } else if (lineRoute === "excluded_nonrecurring") {
          status = "excluded";
          source = "Excluded (non-recurring)";
        } else if (lineRoute === "review_required") {
          status = "not_configured";
          source = "Needs review";
        } else {
          status = "not_configured";
          source = "OpEx (not configured)";
        }
        jumpTo = { step: "forecast_drivers", subTab: "operating_costs" };
      }

      items.push({ id: row.id, label: row.label, status, source, jumpTo, section: "is" });
    }

    return items;
  }, [incomeStatement, hasRevenueConfig, hasCogsConfig, dandaScheduleConfirmed, equitySbcMethod,
      intIncomeScheduleConfirmed, debtApplied, taxScheduleConfirmed, nonOpDirectByLine, opexForecastConfigV1]);

  // ── BS line items (taxonomy-aware via getBsLineCoverage — matches Forecast Drivers routing) ──
  const bsItems = useMemo((): LineItemStatus[] => {
    const items: LineItemStatus[] = [];
    const flat = flattenRows(balanceSheet ?? []);

    const bsCovOpts = {
      wcDriversConfirmed,
      dandaScheduleConfirmed,
      debtApplied,
      equityRollforwardConfirmed,
      otherBsConfirmed,
    };

    for (const row of flat) {
      if (row.kind === "total" || row.kind === "subtotal" || row.kind === "calc") continue;
      if (row.id.startsWith("total_")) continue;

      const cov = getBsLineCoverage(row, bsCovOpts);
      const status = cov.status as ForecastStatus;

      items.push({
        id: row.id,
        label: row.label,
        status,
        source: cov.source,
        jumpTo: cov.jumpTo,
        section: "bs",
      });
    }

    return items;
  }, [balanceSheet, wcDriversConfirmed, dandaScheduleConfirmed, debtApplied,
      equityRollforwardConfirmed, otherBsConfirmed]);

  // ── CFS line items ─────────────────────────────────────────────────────────
  const cfsItems = useMemo((): LineItemStatus[] => {
    const items: LineItemStatus[] = [];
    const flat = flattenRows(cashFlow ?? []);

    for (const row of flat) {
      if (row.kind === "total" || row.kind === "subtotal" || row.kind === "calc") continue;
      if (row.id.startsWith("total_")) continue;

      const tt = row.taxonomyType as string | undefined;
      let status: ForecastStatus = "derived";
      let source = "Auto-derived from IS/BS";
      let jumpTo: LineItemStatus["jumpTo"] = null;

      if (tt === "cfo_net_income" || row.id === "net_income") {
        source = "From Income Statement";
      } else if (row.id === "danda" || tt === "cfo_danda") {
        source = dandaScheduleConfirmed
          ? "PP&E, Capex & D&A Schedule"
          : "Non-operating & Schedules";
        jumpTo = { step: "forecast_drivers", subTab: "non_operating_schedules" };
      } else if (tt === "cfo_da" || tt === "cfo_sbc" || row.id === "sbc" || row.id === "da") {
        source = dandaScheduleConfirmed ? "From schedules" : "From IS/BS changes";
        jumpTo = { step: "forecast_drivers", subTab: "non_operating_schedules" };
      } else if (
        wcScheduleRowIds.has(row.id) ||
        (row.id.startsWith("cfo_") && wcScheduleRowIds.has(cfsWcChildIdToBalanceSheetId(row.id)))
      ) {
        source = wcDriversConfirmed ? "WC Schedule (Forecast Drivers)" : "WC drivers";
        jumpTo = { step: "forecast_drivers", subTab: "wc_drivers" };
      } else if (tt?.startsWith("cfo_wc_") || row.id === "wc_change") {
        source = wcDriversConfirmed ? "From WC Drivers" : "From BS changes";
        jumpTo = { step: "forecast_drivers", subTab: "wc_drivers" };
      } else if (tt === "cfi_capex" || row.id === "capex") {
        source = dandaScheduleConfirmed ? "From Capex Schedule" : "From BS changes";
        jumpTo = { step: "forecast_drivers", subTab: "non_operating_schedules" };
      } else if (tt?.startsWith("cff_")) {
        if (tt === "cff_dividends" || tt === "cff_share_repurchases") {
          source = equityRollforwardConfirmed ? "From Equity Roll-Forward" : "Not linked yet";
          status = equityRollforwardConfirmed ? "derived" : "not_configured";
          jumpTo = { step: "forecast_drivers", subTab: "other_bs_items" };
        } else if (tt === "cff_debt_issued" || tt === "cff_debt_repaid") {
          source = debtApplied ? "From Debt Schedule" : "Not linked yet";
          status = debtApplied ? "derived" : "not_configured";
          jumpTo = { step: "forecast_drivers", subTab: "non_operating_schedules" };
        } else {
          source = "Financing flow";
          jumpTo = { step: "forecast_drivers", subTab: "non_operating_schedules" };
        }
      }

      items.push({ id: row.id, label: row.label, status, source, jumpTo, section: "cfs" });
    }

    return items;
  }, [cashFlow, balanceSheet, dandaScheduleConfirmed, wcDriversConfirmed, equityRollforwardConfirmed, debtApplied, wcScheduleRowIds]);

  // ── Aggregates ─────────────────────────────────────────────────────────────
  const allItems = useMemo(() => [...isItems, ...bsItems, ...cfsItems], [isItems, bsItems, cfsItems]);

  const stats = useMemo(() => {
    const actionable = allItems.filter((i) => i.status !== "derived" && i.status !== "cash_plug" && i.status !== "excluded");
    const configured = actionable.filter((i) => i.status === "forecasted" || i.status === "schedule");
    return {
      total: actionable.length,
      configured: configured.length,
      pct: actionable.length > 0 ? Math.round((configured.length / actionable.length) * 100) : 0,
    };
  }, [allItems]);

  // ── BS check (Assets − Liab+Equity for first proj year) ───────────────────
  const bsCheck = useMemo(() => {
    if (projectionYears.length === 0) return null;
    const flat = flattenRows(balanceSheet ?? []);
    const y = projectionYears[0];
    const totalAssets = flat.find((r) => r.id === "total_assets")?.values?.[y];
    const totalLE =
      flat.find((r) => r.id === "total_liab_and_equity")?.values?.[y] ??
      flat.find((r) => r.id === "total_liabilities_equity")?.values?.[y];
    if (totalAssets == null || totalLE == null) return null;
    return { diff: Math.round(totalAssets - totalLE), year: y };
  }, [balanceSheet, projectionYears]);

  const handleJump = (jumpTo: LineItemStatus["jumpTo"]) => {
    if (!jumpTo) return;
    goToStep(jumpTo.step);
    setForecastDriversSubTab(jumpTo.subTab);
  };

  // ── Section renderer ───────────────────────────────────────────────────────
  const renderSection = (section: StatementSection, items: LineItemStatus[]) => {
    if (items.length === 0) return null;
    const sectionConfigured = items.filter((i) => i.status === "forecasted" || i.status === "schedule" || i.status === "derived" || i.status === "cash_plug" || i.status === "excluded").length;
    const allDone = sectionConfigured === items.length;

    return (
      <div key={section} className="rounded-lg border border-slate-700/50 bg-slate-900/30 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-slate-800/40 border-b border-slate-700/30">
          <div className="flex items-center gap-2">
            {allDone ? (
              <CheckCircle2 size={14} className="text-emerald-400" />
            ) : (
              <Clock size={14} className="text-amber-400" />
            )}
            <span className="text-[11px] font-semibold text-slate-200">{SECTION_LABELS[section]}</span>
          </div>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${allDone ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-amber-500/10 text-amber-400 border border-amber-500/30"}`}>
            {sectionConfigured}/{items.length}
          </span>
        </div>
        <div className="divide-y divide-slate-800/50 max-h-[220px] overflow-y-auto">
          {items.map((item) => {
            const isClickable = item.jumpTo != null;
            return (
              <div
                key={item.id}
                className={`flex items-center justify-between px-3 py-1.5 transition-colors group ${isClickable ? "cursor-pointer hover:bg-slate-800/30" : "hover:bg-slate-800/20"}`}
                onClick={isClickable ? () => handleJump(item.jumpTo!) : undefined}
                title={isClickable ? `Go to: ${item.source}` : item.source}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-[10px] text-slate-300 truncate max-w-[120px]" title={item.label}>
                    {item.label}
                  </span>
                  <StatusBadge status={item.status} />
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[9px] text-slate-500 hidden group-hover:inline">{item.source}</span>
                  {isClickable && (
                    <ArrowRight size={10} className="text-slate-500 group-hover:text-slate-300 transition-colors" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (projectionYears.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-6 text-center">
        <AlertCircle size={20} className="mx-auto text-amber-400 mb-2" />
        <p className="text-sm text-slate-300">No projection years configured yet.</p>
        <p className="text-xs text-slate-500 mt-1">Set up projection years in Company Context or Historicals to see forecast coverage.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 h-full overflow-y-auto pr-1">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold text-slate-100">Forecast Coverage</h2>
        <p className="text-[10px] text-slate-500 mt-0.5">
          Track which line items are forecasted, schedule-driven, derived, or missing.
        </p>
      </div>

      {/* Summary bar */}
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 px-3 py-2.5 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-400">Forecast coverage</span>
          <span className={`text-xs font-semibold ${stats.pct === 100 ? "text-emerald-400" : stats.pct >= 50 ? "text-amber-400" : "text-red-400"}`}>
            {stats.configured}/{stats.total} items ({stats.pct}%)
          </span>
        </div>
        <div className="w-full bg-slate-700/50 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all ${stats.pct === 100 ? "bg-emerald-500" : stats.pct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
            style={{ width: `${stats.pct}%` }}
          />
        </div>
      </div>

      {/* BS Check */}
      {bsCheck && (
        <div className={`rounded-lg border px-3 py-2 flex items-center gap-2 ${Math.abs(bsCheck.diff) < 1 ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
          {Math.abs(bsCheck.diff) < 1 ? (
            <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle size={14} className="text-red-400 shrink-0" />
          )}
          <div>
            <span className={`text-[10px] font-medium ${Math.abs(bsCheck.diff) < 1 ? "text-emerald-300" : "text-red-300"}`}>
              {Math.abs(bsCheck.diff) < 1
                ? `Balance Sheet checks (${bsCheck.year})`
                : `BS imbalance: ${bsCheck.diff.toLocaleString()} (${bsCheck.year})`}
            </span>
            {Math.abs(bsCheck.diff) >= 1 && (
              <p className="text-[9px] text-red-400/70 mt-0.5">
                Total Assets ≠ Total Liabilities + Equity. Cash will close the gap when CFS is built.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-1">
        {(["forecasted", "schedule", "derived", "cash_plug", "excluded", "not_configured"] as ForecastStatus[]).map((s) => (
          <div key={s} className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${STATUS_CONFIG[s].color.replace("text-", "bg-")}`} />
            <span className="text-[8px] text-slate-500">{STATUS_CONFIG[s].label}</span>
          </div>
        ))}
      </div>

      {/* Sections */}
      {renderSection("is", isItems)}
      {renderSection("bs", bsItems)}
      {renderSection("cfs", cfsItems)}

      {/* CFS note */}
      <div className="rounded-lg border border-slate-700/30 bg-slate-800/20 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Calculator size={12} className="text-violet-400 shrink-0" />
          <span className="text-[9px] text-slate-400">
            Cash is derived from the Cash Flow Statement. It will auto-populate once the CFS engine is built (Phase 3).
          </span>
        </div>
      </div>
    </div>
  );
}
