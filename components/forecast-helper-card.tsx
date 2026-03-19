"use client";

import { useMemo, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import CollapsibleSection from "@/components/collapsible-section";
import { computeRowValue } from "@/lib/calculations";
import type { Row } from "@/types/finance";
import { getCurrencySymbol } from "@/lib/currency-utils";

type HelperTab = "growth" | "percent_of_x" | "implied_cagr";
type SourceMode = "manual" | "model";

type SeriesRow = {
  id: string;
  year: string;
  valueStr: string;
};

type StatementKey = "income" | "balance" | "cash_flow";
type ModelSeriesOption = {
  key: string;
  statement: StatementKey;
  rowId: string;
  label: string;
};

type ResolvedModelValue = {
  value: number | null;
  meaningful: boolean;
};

function mkId(prefix: string, idx: number) {
  return `${prefix}-${idx}`;
}

function parseMaybeNum(v: string): number | null {
  let t = String(v ?? "").replace(/,/g, "").trim();
  t = t.replace(/^MX\$/i, "").replace(/^C\$/i, "").replace(/^A\$/i, "").trim();
  t = t.replace(/[$€£¥]/g, "").trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/** Leading 4-digit calendar year from labels like "2024A" / "2026E". */
function parseYearFromLabel(label: string): number | null {
  const m = String(label ?? "").trim().match(/^(\d{4})/);
  return m ? parseInt(m[1]!, 10) : null;
}

/** Stored model amounts: symbol + grouped digits (no scientific notation). */
function formatHelperAmountForDisplay(n: number, currencyCode: string): string {
  if (!Number.isFinite(n)) return "";
  const sym = getCurrencySymbol(currencyCode || "USD");
  const body = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 8,
    minimumFractionDigits: 0,
    useGrouping: true,
  }).format(n);
  return sym.length <= 4 ? `${sym}${body}` : `${body} ${currencyCode}`;
}

/** Historical actual year for Growth model mode: meta list and/or common `A` suffix. */
function isHelperHistoricalYear(year: string, historicalYears: string[]): boolean {
  const y = String(year ?? "").trim();
  if (!y) return false;
  if (historicalYears.length && historicalYears.includes(y)) return true;
  return y.endsWith("A");
}

function average(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[m] ?? null;
  const left = s[m - 1];
  const right = s[m];
  if (left == null || right == null) return null;
  return (left + right) / 2;
}

function formatPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function flattenRows(rows: Row[], statement: StatementKey, out: ModelSeriesOption[], prefix = "") {
  for (const r of rows) {
    const label = prefix ? `${prefix} / ${r.label}` : r.label;
    out.push({ key: `${statement}:${r.id}`, statement, rowId: r.id, label: `[${statement}] ${label}` });
    const kids = r.children ?? [];
    if (kids.length) flattenRows(kids, statement, out, label);
  }
}

function findRow(rows: Row[], id: string): Row | null {
  for (const r of rows) {
    if (r.id === id) return r;
    const kids = r.children ?? [];
    if (kids.length) {
      const x = findRow(kids, id);
      if (x) return x;
    }
  }
  return null;
}

function hasOwnYearValue(row: Row, year: string): boolean {
  return !!row.values && Object.prototype.hasOwnProperty.call(row.values, year);
}

function isMeaningfulHelperValue(row: Row, year: string, value: number | null): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  if (hasOwnYearValue(row, year)) return true;
  // For historical years, allow non-zero computed values as meaningful fallback.
  if (year.endsWith("A") && Math.abs(value) > 1e-12) return true;
  // Projection years without explicit stored value are treated as missing in helper.
  return false;
}

export default function ForecastHelperCard() {
  const [tab, setTab] = useState<HelperTab>("growth");

  const incomeStatement = useModelStore((s) => s.incomeStatement ?? []);
  const balanceSheet = useModelStore((s) => s.balanceSheet ?? []);
  const cashFlow = useModelStore((s) => s.cashFlow ?? []);
  const meta = useModelStore((s) => s.meta);
  const sbcBreakdowns = useModelStore((s) => s.sbcBreakdowns ?? {});
  const danaBreakdowns = useModelStore((s) => s.danaBreakdowns ?? {});

  const historicalYears = meta?.years?.historical ?? [];
  const projectionYears = meta?.years?.projection ?? [];
  const helperCurrency = meta?.currency ?? "USD";
  const allYears = useMemo(() => {
    const years = [...historicalYears, ...projectionYears];
    return years.length ? years : ["2026E", "2027E", "2028E"];
  }, [historicalYears, projectionYears]);

  const modelSeriesOptions = useMemo(() => {
    const out: ModelSeriesOption[] = [];
    flattenRows(incomeStatement, "income", out);
    flattenRows(balanceSheet, "balance", out);
    flattenRows(cashFlow, "cash_flow", out);
    return out;
  }, [incomeStatement, balanceSheet, cashFlow]);

  const allStatements = useMemo(
    () => ({ incomeStatement, balanceSheet, cashFlow }),
    [incomeStatement, balanceSheet, cashFlow]
  );

  const resolveValue = (optKey: string, year: string): ResolvedModelValue => {
    const opt = modelSeriesOptions.find((o) => o.key === optKey);
    if (!opt) return { value: null, meaningful: false };
    const statementRows =
      opt.statement === "income" ? incomeStatement : opt.statement === "balance" ? balanceSheet : cashFlow;
    const row = findRow(statementRows, opt.rowId);
    if (!row) return { value: null, meaningful: false };
    const v = computeRowValue(
      row,
      year,
      statementRows,
      statementRows,
      allStatements,
      sbcBreakdowns,
      danaBreakdowns
    );
    const value = Number.isFinite(v) ? v : null;
    return {
      value,
      meaningful: isMeaningfulHelperValue(row, year, value),
    };
  };

  // Growth tab state
  const [growthSource, setGrowthSource] = useState<SourceMode>("manual");
  const [growthModelKey, setGrowthModelKey] = useState("");
  const [growthRows, setGrowthRows] = useState<SeriesRow[]>(
    allYears.slice(0, 5).map((y, i) => ({ id: mkId("g", i), year: y, valueStr: "" }))
  );
  const loadGrowthFromModel = () => {
    if (!growthModelKey) return;
    setGrowthRows((prev) =>
      prev.map((r) => {
        const v = resolveValue(growthModelKey, r.year);
        if (!v.meaningful || v.value == null) return { ...r, valueStr: "" };
        return { ...r, valueStr: formatHelperAmountForDisplay(v.value, helperCurrency) };
      })
    );
  };

  // % of X tab state
  const [valueSource, setValueSource] = useState<SourceMode>("manual");
  const [compareSource, setCompareSource] = useState<SourceMode>("manual");
  const [valueModelKey, setValueModelKey] = useState("");
  const [compareModelKey, setCompareModelKey] = useState("");
  const [numRows, setNumRows] = useState<SeriesRow[]>(
    allYears.slice(0, 5).map((y, i) => ({ id: mkId("n", i), year: y, valueStr: "" }))
  );
  const [denRows, setDenRows] = useState<SeriesRow[]>(
    allYears.slice(0, 5).map((y, i) => ({ id: mkId("d", i), year: y, valueStr: "" }))
  );

  const loadValueSeries = () => {
    if (!valueModelKey) return;
    setNumRows((prev) =>
      prev.map((r) => {
        const v = resolveValue(valueModelKey, r.year);
        if (!v.meaningful || v.value == null) return { ...r, valueStr: "" };
        return { ...r, valueStr: formatHelperAmountForDisplay(v.value, helperCurrency) };
      })
    );
  };

  const loadCompareSeries = () => {
    if (!compareModelKey) return;
    setDenRows((prev) =>
      prev.map((r) => {
        const v = resolveValue(compareModelKey, r.year);
        if (!v.meaningful || v.value == null) return { ...r, valueStr: "" };
        return { ...r, valueStr: formatHelperAmountForDisplay(v.value, helperCurrency) };
      })
    );
  };

  // Implied CAGR state
  const [startSource, setStartSource] = useState<SourceMode>("manual");
  const [endSource, setEndSource] = useState<SourceMode>("manual");
  const [startModelKey, setStartModelKey] = useState("");
  const [endModelKey, setEndModelKey] = useState("");
  const [startYear, setStartYear] = useState(allYears[0] ?? "");
  const [endYear, setEndYear] = useState(allYears[allYears.length - 1] ?? allYears[0] ?? "");
  const [cagrStart, setCagrStart] = useState("");
  const [cagrEnd, setCagrEnd] = useState("");
  const [cagrYears, setCagrYears] = useState("");

  const loadCagrStartFromModel = () => {
    if (!startModelKey || !startYear) return;
    const v = resolveValue(startModelKey, startYear);
    setCagrStart(v.meaningful && v.value != null ? String(v.value) : "");
  };

  const loadCagrEndFromModel = () => {
    if (!endModelKey || !endYear) return;
    const v = resolveValue(endModelKey, endYear);
    setCagrEnd(v.meaningful && v.value != null ? String(v.value) : "");
  };

  // Growth outputs — consecutive valid numeric rows (blanks skipped). Model mode: historical actual years only.
  const growthValidValuePointsAll = useMemo(() => {
    const out: { year: string; value: number }[] = [];
    for (const r of growthRows) {
      const v = parseMaybeNum(r.valueStr ?? "");
      if (v == null || !Number.isFinite(v)) continue;
      out.push({ year: r.year, value: v });
    }
    return out;
  }, [growthRows]);

  const growthValidValuePoints = useMemo(() => {
    if (growthSource !== "model") return growthValidValuePointsAll;
    return growthValidValuePointsAll.filter((p) => isHelperHistoricalYear(p.year, historicalYears));
  }, [growthSource, growthValidValuePointsAll, historicalYears]);

  const growthYoyPoints = useMemo(() => {
    const pts = growthValidValuePoints;
    const out: { fromYear: string; toYear: string; pct: number }[] = [];
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]!;
      const cur = pts[i]!;
      if (prev.value === 0) continue;
      out.push({
        fromYear: prev.year,
        toYear: cur.year,
        pct: ((cur.value - prev.value) / prev.value) * 100,
      });
    }
    return out;
  }, [growthValidValuePoints]);

  const growthYoyPcts = growthYoyPoints.map((x) => x.pct).filter((x) => Number.isFinite(x));
  const avgYoy = average(growthYoyPcts);
  const medYoy = median(growthYoyPcts);
  const lastYoy = growthYoyPcts.length ? growthYoyPcts[growthYoyPcts.length - 1]! : null;

  const cagrFromGrowth = useMemo(() => {
    const pts = growthValidValuePoints;
    if (pts.length < 2) return null;
    const start = pts[0]!.value;
    const end = pts[pts.length - 1]!.value;
    if (start <= 0 || end < 0 || !Number.isFinite(start) || !Number.isFinite(end)) return null;
    const y0 = parseYearFromLabel(pts[0]!.year);
    const y1 = parseYearFromLabel(pts[pts.length - 1]!.year);
    let periods =
      y0 != null && y1 != null && y1 > y0 ? y1 - y0 : pts.length - 1;
    if (periods <= 0) periods = pts.length - 1;
    if (periods <= 0) return null;
    return (Math.pow(end / start, 1 / periods) - 1) * 100;
  }, [growthValidValuePoints]);

  // % of X outputs
  const pctByYear = useMemo(() => {
    return numRows.map((nRow, idx) => {
      const dRow = denRows[idx];
      const n = parseMaybeNum(nRow?.valueStr ?? "");
      const d = parseMaybeNum(dRow?.valueStr ?? "");
      const hasMissing = n == null || d == null;
      const denomZero = !hasMissing && d === 0;
      const pct = !hasMissing && !denomZero ? (n / d) * 100 : null;
      return { year: nRow.year, value: n, compareAgainst: d, hasMissing, denomZero, pct };
    });
  }, [numRows, denRows]);

  const validPcts = pctByYear.map((x) => x.pct).filter((x): x is number => x != null && Number.isFinite(x));
  const latestPct = validPcts.length ? validPcts[validPcts.length - 1] : null;
  const avgPct = average(validPcts);
  const minPct = validPcts.length ? Math.min(...validPcts) : null;
  const maxPct = validPcts.length ? Math.max(...validPcts) : null;

  // Implied CAGR output
  const impliedCagr = useMemo(() => {
    const s = parseMaybeNum(cagrStart);
    const e = parseMaybeNum(cagrEnd);
    const y = parseMaybeNum(cagrYears);
    if (s == null || e == null || y == null || y <= 0 || s <= 0 || e < 0) return null;
    return (Math.pow(e / s, 1 / y) - 1) * 100;
  }, [cagrStart, cagrEnd, cagrYears]);

  return (
    <CollapsibleSection
      sectionId="forecast_helper_v1"
      title="Forecast Helper"
      description="Quick calculations for growth, percentages, and implied CAGR"
      colorClass="slate"
      defaultExpanded={false}
    >
      <div className="space-y-3">
        <p className="text-[10px] text-slate-500">
          This tool does not change the model. Use these results as guidance when entering your forecast assumptions.
        </p>

        <div className="flex flex-wrap gap-2">
          {[
            { id: "growth", label: "Growth" },
            { id: "percent_of_x", label: "% of X" },
            { id: "implied_cagr", label: "Implied CAGR" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as HelperTab)}
              className={`rounded px-2.5 py-1.5 text-[11px] ${
                tab === t.id ? "bg-slate-600 text-slate-100" : "bg-slate-800 text-slate-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "growth" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGrowthSource("manual")}
                  className={`rounded px-2 py-1 text-[10px] ${
                    growthSource === "manual" ? "bg-blue-800/60 text-blue-100" : "bg-slate-800 text-slate-300"
                  }`}
                >
                  Manual input
                </button>
                <button
                  type="button"
                  onClick={() => setGrowthSource("model")}
                  disabled={modelSeriesOptions.length === 0}
                  className={`rounded px-2 py-1 text-[10px] ${
                    growthSource === "model" ? "bg-blue-800/60 text-blue-100" : "bg-slate-800 text-slate-300"
                  } disabled:opacity-35`}
                >
                  Use model values
                </button>
              </div>
              {growthSource === "model" ? (
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <select
                    value={growthModelKey}
                    onChange={(e) => setGrowthModelKey(e.target.value)}
                    className="min-w-0 flex-1 max-w-full rounded border border-slate-600 bg-slate-800 text-[10px] text-slate-200 px-2 py-1"
                  >
                    <option value="">Select model line</option>
                    {modelSeriesOptions.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={loadGrowthFromModel}
                    disabled={!growthModelKey}
                    className="w-16 shrink-0 rounded border border-slate-600 bg-slate-800 text-slate-200 text-[10px] px-2 py-1 disabled:opacity-35"
                  >
                    Load
                  </button>
                </div>
              ) : null}
            </div>
            {growthSource === "model" ? (
              <p className="text-[10px] text-slate-500">
                {growthModelKey ? "Source: model values" : "No model values selected. Enter values manually instead."}
              </p>
            ) : null}

            <div className="rounded border border-slate-700/70">
              <div className="grid grid-cols-[1fr_1fr] text-[10px] text-slate-500 uppercase px-2 py-1.5 border-b border-slate-800">
                <span>Year</span>
                <span className="text-right">Value</span>
              </div>
              {growthRows.map((r) => (
                <div key={r.id} className="grid grid-cols-[1fr_1fr] gap-2 px-2 py-1.5 border-b border-slate-900/80 last:border-0">
                  <input
                    type="text"
                    value={r.year}
                    onChange={(e) =>
                      setGrowthRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, year: e.target.value } : x)))
                    }
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200"
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={r.valueStr}
                    onFocus={() => {
                      const n = parseMaybeNum(r.valueStr);
                      if (n != null) {
                        setGrowthRows((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, valueStr: String(n) } : x))
                        );
                      }
                    }}
                    onChange={(e) =>
                      setGrowthRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, valueStr: e.target.value } : x)))
                    }
                    onBlur={() => {
                      setGrowthRows((prev) =>
                        prev.map((x) => {
                          if (x.id !== r.id) return x;
                          const raw = x.valueStr;
                          const n = parseMaybeNum(raw);
                          if (n == null) return { ...x, valueStr: raw.trim() === "" ? "" : raw };
                          return { ...x, valueStr: formatHelperAmountForDisplay(n, helperCurrency) };
                        })
                      );
                    }}
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 text-right tabular-nums"
                  />
                </div>
              ))}
            </div>

            <div className="rounded border border-slate-700/60 bg-slate-950/40 p-2">
              <div className="text-[10px] text-slate-500 mb-1">
                {growthSource === "model"
                  ? "YoY growth (model: historical actuals only, consecutive valid values)"
                  : "YoY growth (consecutive valid values only)"}
              </div>
              <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-300">
                {growthYoyPoints.length === 0 ? (
                  <div className="col-span-2 text-slate-500">—</div>
                ) : (
                  growthYoyPoints.map((r, i) => (
                    <div key={`${r.fromYear}-${r.toYear}-${i}`} className="tabular-nums">
                      {r.fromYear}→{r.toYear}: {formatPct(r.pct)}
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded border border-slate-700/60 bg-slate-900/30 px-2 py-1.5">Average YoY: {formatPct(avgYoy)}</div>
              <div className="rounded border border-slate-700/60 bg-slate-900/30 px-2 py-1.5">Median YoY: {formatPct(medYoy)}</div>
              <div className="rounded border border-slate-700/60 bg-slate-900/30 px-2 py-1.5">CAGR: {formatPct(cagrFromGrowth)}</div>
              <div className="rounded border border-slate-700/60 bg-slate-900/30 px-2 py-1.5">Last YoY: {formatPct(lastYoy)}</div>
            </div>
          </div>
        ) : null}

        {tab === "percent_of_x" ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="rounded border border-slate-700/60 p-2 space-y-1.5">
                <div className="text-[10px] text-slate-500">Value source</div>
                <select
                  value={valueSource}
                  onChange={(e) => setValueSource(e.target.value as SourceMode)}
                  className="max-w-[180px] w-full rounded border border-slate-600 bg-slate-800 text-[10px] text-slate-200 px-2 py-1"
                >
                  <option value="manual">Manual input</option>
                  <option value="model">Use model values</option>
                </select>
                {valueSource === "model" ? (
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <select
                      value={valueModelKey}
                      onChange={(e) => setValueModelKey(e.target.value)}
                      className="min-w-0 flex-1 max-w-full rounded border border-slate-600 bg-slate-800 text-[10px] text-slate-200 px-2 py-1"
                    >
                      <option value="">Select model line</option>
                      {modelSeriesOptions.map((o) => (
                        <option key={`v-${o.key}`} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={loadValueSeries}
                      disabled={!valueModelKey}
                      className="w-16 shrink-0 rounded border border-slate-600 bg-slate-800 text-slate-200 text-[10px] px-2 py-1 disabled:opacity-35"
                    >
                      Load
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="rounded border border-slate-700/60 p-2 space-y-1.5">
                <div className="text-[10px] text-slate-500">Compare against source</div>
                <select
                  value={compareSource}
                  onChange={(e) => setCompareSource(e.target.value as SourceMode)}
                  className="max-w-[180px] w-full rounded border border-slate-600 bg-slate-800 text-[10px] text-slate-200 px-2 py-1"
                >
                  <option value="manual">Manual input</option>
                  <option value="model">Use model values</option>
                </select>
                {compareSource === "model" ? (
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <select
                      value={compareModelKey}
                      onChange={(e) => setCompareModelKey(e.target.value)}
                      className="min-w-0 flex-1 max-w-full rounded border border-slate-600 bg-slate-800 text-[10px] text-slate-200 px-2 py-1"
                    >
                      <option value="">Select model line</option>
                      {modelSeriesOptions.map((o) => (
                        <option key={`c-${o.key}`} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={loadCompareSeries}
                      disabled={!compareModelKey}
                      className="w-16 shrink-0 rounded border border-slate-600 bg-slate-800 text-slate-200 text-[10px] px-2 py-1 disabled:opacity-35"
                    >
                      Load
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            {(valueSource === "model" || compareSource === "model") ? (
              <p className="text-[10px] text-slate-500">Loaded from model (when selected).</p>
            ) : null}

            <div className="rounded border border-slate-700/70">
              <div className="grid grid-cols-[1fr_1fr_1fr] text-[10px] text-slate-500 uppercase px-2 py-1.5 border-b border-slate-800">
                <span>Year</span>
                <span className="text-right">Value</span>
                <span className="text-right">Compare against</span>
              </div>
              {numRows.map((n, idx) => (
                <div key={n.id} className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-2 py-1.5 border-b border-slate-900/80 last:border-0">
                  <input
                    type="text"
                    value={n.year}
                    onChange={(e) => {
                      const y = e.target.value;
                      setNumRows((prev) => prev.map((x) => (x.id === n.id ? { ...x, year: y } : x)));
                      setDenRows((prev) => prev.map((x, i) => (i === idx ? { ...x, year: y } : x)));
                    }}
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200"
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={n.valueStr}
                    onFocus={() => {
                      const num = parseMaybeNum(n.valueStr);
                      if (num != null) {
                        setNumRows((prev) =>
                          prev.map((x) => (x.id === n.id ? { ...x, valueStr: String(num) } : x))
                        );
                      }
                    }}
                    onChange={(e) =>
                      setNumRows((prev) => prev.map((x) => (x.id === n.id ? { ...x, valueStr: e.target.value } : x)))
                    }
                    onBlur={() => {
                      setNumRows((prev) =>
                        prev.map((x) => {
                          if (x.id !== n.id) return x;
                          const raw = x.valueStr;
                          const num = parseMaybeNum(raw);
                          if (num == null) return { ...x, valueStr: raw.trim() === "" ? "" : raw };
                          return { ...x, valueStr: formatHelperAmountForDisplay(num, helperCurrency) };
                        })
                      );
                    }}
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 text-right tabular-nums"
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={denRows[idx]?.valueStr ?? ""}
                    onFocus={() => {
                      const dStr = denRows[idx]?.valueStr ?? "";
                      const num = parseMaybeNum(dStr);
                      if (num != null) {
                        setDenRows((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, valueStr: String(num) } : x))
                        );
                      }
                    }}
                    onChange={(e) =>
                      setDenRows((prev) => prev.map((x, i) => (i === idx ? { ...x, valueStr: e.target.value } : x)))
                    }
                    onBlur={() => {
                      setDenRows((prev) =>
                        prev.map((x, i) => {
                          if (i !== idx) return x;
                          const raw = x.valueStr;
                          const num = parseMaybeNum(raw);
                          if (num == null) return { ...x, valueStr: raw.trim() === "" ? "" : raw };
                          return { ...x, valueStr: formatHelperAmountForDisplay(num, helperCurrency) };
                        })
                      );
                    }}
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 text-right tabular-nums"
                  />
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-500">Example: line item value vs total revenue, or SG&A vs revenue.</p>

            <div className="space-y-1.5">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">Year-by-year percentage</div>
              <div className="rounded border border-slate-700/70">
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr] text-[10px] text-slate-500 uppercase px-2 py-1.5 border-b border-slate-800">
                  <span>Year</span>
                  <span className="text-right">Value</span>
                  <span className="text-right">Compare against</span>
                  <span className="text-right">Resulting %</span>
                </div>
                {pctByYear.map((r, i) => (
                  <div
                    key={`${r.year}-${i}`}
                    className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 px-2 py-1.5 border-b border-slate-900/80 last:border-0 text-[11px]"
                  >
                    <span className="text-slate-300">{r.year || "—"}</span>
                    <span className="text-right tabular-nums text-slate-300">
                      {r.value == null ? "—" : formatHelperAmountForDisplay(r.value, helperCurrency)}
                    </span>
                    <span className="text-right tabular-nums text-slate-300">
                      {r.compareAgainst == null ? "—" : formatHelperAmountForDisplay(r.compareAgainst, helperCurrency)}
                    </span>
                    <span className={`text-right tabular-nums ${r.denomZero ? "text-amber-300" : "text-slate-200"}`}>
                      {r.hasMissing ? "—" : r.denomZero ? "N/A" : formatPct(r.pct)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded border border-slate-700/60 bg-slate-900/30 px-2 py-1.5">Latest %: {formatPct(latestPct)}</div>
              <div className="rounded border border-slate-700/60 bg-slate-900/30 px-2 py-1.5">Average %: {formatPct(avgPct)}</div>
              <div className="rounded border border-slate-700/60 bg-slate-900/30 px-2 py-1.5">Min %: {formatPct(minPct)}</div>
              <div className="rounded border border-slate-700/60 bg-slate-900/30 px-2 py-1.5">Max %: {formatPct(maxPct)}</div>
            </div>
          </div>
        ) : null}

        {tab === "implied_cagr" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[10px] text-slate-500">
                Starting value
                <input
                  type="text"
                  inputMode="decimal"
                  value={cagrStart}
                  onChange={(e) => setCagrStart(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-200 text-right tabular-nums"
                />
              </label>
              <label className="text-[10px] text-slate-500">
                Ending value
                <input
                  type="text"
                  inputMode="decimal"
                  value={cagrEnd}
                  onChange={(e) => setCagrEnd(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-200 text-right tabular-nums"
                />
              </label>
              <label className="text-[10px] text-slate-500">
                Number of years
                <input
                  type="text"
                  inputMode="decimal"
                  value={cagrYears}
                  onChange={(e) => setCagrYears(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-200 text-right tabular-nums"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div className="rounded border border-slate-700/70 p-2 space-y-1.5">
                <div className="text-[10px] text-slate-500">Starting value source</div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setStartSource("manual")}
                    className={`rounded px-2 py-1 text-[10px] ${startSource === "manual" ? "bg-blue-800/60 text-blue-100" : "bg-slate-800 text-slate-300"}`}
                  >
                    Manual input
                  </button>
                  <button
                    type="button"
                    onClick={() => setStartSource("model")}
                    className={`rounded px-2 py-1 text-[10px] ${startSource === "model" ? "bg-blue-800/60 text-blue-100" : "bg-slate-800 text-slate-300"}`}
                  >
                    Use model value
                  </button>
                </div>
                {startSource === "model" ? (
                  <div className="flex flex-wrap gap-1.5 min-w-0">
                    <select
                      value={startModelKey}
                      onChange={(e) => setStartModelKey(e.target.value)}
                      className="min-w-0 flex-1 max-w-full rounded border border-slate-600 bg-slate-800 text-[10px] text-slate-200 px-2 py-1"
                    >
                      <option value="">Select model line</option>
                      {modelSeriesOptions.map((o) => (
                        <option key={`s-${o.key}`} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={startYear}
                      onChange={(e) => setStartYear(e.target.value)}
                      className="w-24 shrink-0 rounded border border-slate-600 bg-slate-800 text-[10px] text-slate-200 px-2 py-1"
                    >
                      {allYears.map((y) => (
                        <option key={`sy-${y}`} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={loadCagrStartFromModel}
                      disabled={!startModelKey || !startYear}
                      className="w-16 shrink-0 rounded border border-slate-600 bg-slate-800 text-slate-200 text-[10px] px-2 py-1 disabled:opacity-35"
                    >
                      Load
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="rounded border border-slate-700/70 p-2 space-y-1.5">
                <div className="text-[10px] text-slate-500">Ending value source</div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEndSource("manual")}
                    className={`rounded px-2 py-1 text-[10px] ${endSource === "manual" ? "bg-blue-800/60 text-blue-100" : "bg-slate-800 text-slate-300"}`}
                  >
                    Manual input
                  </button>
                  <button
                    type="button"
                    onClick={() => setEndSource("model")}
                    className={`rounded px-2 py-1 text-[10px] ${endSource === "model" ? "bg-blue-800/60 text-blue-100" : "bg-slate-800 text-slate-300"}`}
                  >
                    Use model value
                  </button>
                </div>
                {endSource === "model" ? (
                  <div className="flex flex-wrap gap-1.5 min-w-0">
                    <select
                      value={endModelKey}
                      onChange={(e) => setEndModelKey(e.target.value)}
                      className="min-w-0 flex-1 max-w-full rounded border border-slate-600 bg-slate-800 text-[10px] text-slate-200 px-2 py-1"
                    >
                      <option value="">Select model line</option>
                      {modelSeriesOptions.map((o) => (
                        <option key={`e-${o.key}`} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={endYear}
                      onChange={(e) => setEndYear(e.target.value)}
                      className="w-24 shrink-0 rounded border border-slate-600 bg-slate-800 text-[10px] text-slate-200 px-2 py-1"
                    >
                      {allYears.map((y) => (
                        <option key={`ey-${y}`} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={loadCagrEndFromModel}
                      disabled={!endModelKey || !endYear}
                      className="w-16 shrink-0 rounded border border-slate-600 bg-slate-800 text-slate-200 text-[10px] px-2 py-1 disabled:opacity-35"
                    >
                      Load
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {(startSource === "model" || endSource === "model") ? (
              <p className="text-[10px] text-slate-500">Loaded from model (when selected).</p>
            ) : null}

            <div className="rounded border border-slate-700/60 bg-slate-900/30 px-2 py-1.5 text-[11px]">
              Implied CAGR: {formatPct(impliedCagr)}
            </div>
          </div>
        ) : null}
      </div>
    </CollapsibleSection>
  );
}
