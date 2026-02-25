"use client";

import type {
  RevenueProjectionMethod,
  GrowthRateInputs,
  PriceVolumeInputs,
  CustomersArpuInputs,
  PctOfTotalInputs,
  ProductLineInputs,
  RevenueProjectionInputs,
} from "@/types/revenue-projection";

export interface RevenueStreamOption {
  id: string;
  label: string;
}

interface RevenueForecastInputsProps {
  method: RevenueProjectionMethod;
  inputs: RevenueProjectionInputs;
  lastHistoricYear: string;
  projectionYears: string[];
  currencyUnit: "units" | "thousands" | "millions";
  /** Options for "%% of which total?" (Total Revenue + fixed streams). If omitted, only Total Revenue is used. */
  revenueStreamOptions?: RevenueStreamOption[];
  onChange: (inputs: RevenueProjectionInputs) => void;
}

export default function RevenueForecastInputs({
  method,
  inputs,
  lastHistoricYear,
  projectionYears,
  currencyUnit,
  revenueStreamOptions,
  onChange,
}: RevenueForecastInputsProps) {
  const unitLabel = currencyUnit === "millions" ? "M" : currencyUnit === "thousands" ? "K" : "";
  const pctReferenceOptions: RevenueStreamOption[] =
    revenueStreamOptions?.length
      ? revenueStreamOptions
      : [{ id: "rev", label: "Total Revenue" }];

  if (method === "growth_rate") {
    const g = inputs as GrowthRateInputs;
    const isConstant = (g.growthType ?? "constant") === "constant";
    const ratesByYear = g.ratesByYear ?? {};

    return (
      <div className="space-y-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">Growth type</span>
          <select
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
            value={g.growthType ?? "constant"}
            onChange={(e) => {
              const newType = e.target.value as "constant" | "custom_per_year";
              if (newType === "constant") {
                // When switching to constant, keep ratePercent, clear ratesByYear
                onChange({ ...g, growthType: "constant", ratesByYear: undefined });
              } else {
                // When switching to custom, initialize ratesByYear with empty values for each year
                const newRatesByYear: Record<string, number> = {};
                projectionYears.forEach((y) => {
                  newRatesByYear[y] = ratesByYear[y] ?? g.ratePercent ?? 0;
                });
                onChange({ ...g, growthType: "custom_per_year", ratesByYear: newRatesByYear });
              }
            }}
          >
            <option value="constant">Constant % each year</option>
            <option value="custom_per_year">Custom % per year</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-slate-400">Base amount {unitLabel && `(${unitLabel})`} — optional</span>
          <input
            type="number"
            step="any"
            min="0"
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
            value={g.baseAmount ?? ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              const value = raw === "" ? undefined : parseFloat(raw);
              onChange({ ...g, baseAmount: value === undefined || isNaN(value) ? undefined : value });
            }}
            placeholder="Leave empty to use allocation % of parent"
          />
        </label>
        <p className="text-[10px] text-slate-500">
          If set, projections use this $ as the starting point so growth is not tied to allocation weight. If empty, base comes from parent historic × allocation %.
        </p>
        {isConstant ? (
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Growth % per year</span>
            <input
              type="number"
              step="0.1"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
              value={g.ratePercent ?? ""}
              onChange={(e) => {
                const value = parseFloat(e.target.value) || 0;
                onChange({ ...g, ratePercent: value });
              }}
              placeholder="e.g. 5 for 5%"
            />
          </label>
        ) : (
          <div className="space-y-2">
            <span className="text-slate-400 block">Growth % for each projection year:</span>
            <div className="grid grid-cols-2 gap-2">
              {projectionYears.map((year) => (
                <label key={year} className="flex flex-col gap-1">
                  <span className="text-slate-500 text-[10px]">{year}</span>
                  <input
                    type="number"
                    step="0.1"
                    className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
                    value={ratesByYear[year] ?? ""}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value) || 0;
                      onChange({
                        ...g,
                        ratesByYear: { ...ratesByYear, [year]: value },
                      });
                    }}
                    placeholder="%"
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        <p className="text-slate-500 text-[10px]">
          Base: {g.baseAmount != null ? `${g.baseAmount} ${unitLabel}` : `last historic year (${lastHistoricYear}) or allocation % of parent`}. Growth applied year over year.
          {isConstant && g.ratePercent !== undefined && g.ratePercent !== 0 && (
            <span className="block mt-1">
              All {projectionYears.length} projection years will use {g.ratePercent}% growth.
            </span>
          )}
        </p>
      </div>
    );
  }

  if (method === "price_volume") {
    const p = inputs as PriceVolumeInputs;
    return (
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Base year</span>
            <select
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
              value={p.baseYear ?? lastHistoricYear}
              onChange={(e) => onChange({ ...p, baseYear: e.target.value })}
            >
              <option value={lastHistoricYear}>{lastHistoricYear}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Annualize from monthly?</span>
            <select
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
              value={p.annualizeFromMonthly ? "yes" : "no"}
              onChange={(e) =>
                onChange({ ...p, annualizeFromMonthly: e.target.value === "yes" })
              }
            >
              <option value="no">No</option>
              <option value="yes">Yes (×12)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Price {p.annualizeFromMonthly ? "(per month)" : ""} {unitLabel && `(${unitLabel})`}</span>
            <input
              type="number"
              step="any"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
              value={p.price ?? ""}
              onChange={(e) =>
                onChange({ ...p, price: parseFloat(e.target.value) || 0 })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Volume / Quantity</span>
            <input
              type="number"
              step="any"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
              value={p.volume ?? ""}
              onChange={(e) =>
                onChange({ ...p, volume: parseFloat(e.target.value) || 0 })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Price growth % per year</span>
            <input
              type="number"
              step="0.1"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
              value={p.priceGrowthPercent ?? ""}
              onChange={(e) =>
                onChange({ ...p, priceGrowthPercent: parseFloat(e.target.value) || 0 })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Volume growth % per year</span>
            <input
              type="number"
              step="0.1"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
              value={p.volumeGrowthPercent ?? ""}
              onChange={(e) =>
                onChange({ ...p, volumeGrowthPercent: parseFloat(e.target.value) || 0 })
              }
            />
          </label>
        </div>
      </div>
    );
  }

  if (method === "customers_arpu") {
    const c = inputs as CustomersArpuInputs;
    return (
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Base year</span>
            <select
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
              value={c.baseYear ?? lastHistoricYear}
              onChange={(e) => onChange({ ...c, baseYear: e.target.value })}
            >
              <option value={lastHistoricYear}>{lastHistoricYear}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Customers (#)</span>
            <input
              type="number"
              step="any"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
              value={c.customers ?? ""}
              onChange={(e) =>
                onChange({ ...c, customers: parseFloat(e.target.value) || 0 })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">ARPU {unitLabel && `(${unitLabel})`}</span>
            <input
              type="number"
              step="any"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
              value={c.arpu ?? ""}
              onChange={(e) =>
                onChange({ ...c, arpu: parseFloat(e.target.value) || 0 })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Customer growth % per year</span>
            <input
              type="number"
              step="0.1"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
              value={c.customerGrowthPercent ?? ""}
              onChange={(e) =>
                onChange({ ...c, customerGrowthPercent: parseFloat(e.target.value) || 0 })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">ARPU growth % per year</span>
            <input
              type="number"
              step="0.1"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
              value={c.arpuGrowthPercent ?? ""}
              onChange={(e) =>
                onChange({ ...c, arpuGrowthPercent: parseFloat(e.target.value) || 0 })
              }
            />
          </label>
        </div>
      </div>
    );
  }

  if (method === "pct_of_total") {
    const pt = inputs as PctOfTotalInputs;
    const refId = pt.referenceId ?? "rev";
    return (
      <div className="space-y-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">% of which total?</span>
          <select
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200"
            value={refId}
            onChange={(e) =>
              onChange({ ...pt, referenceId: e.target.value })
            }
          >
            {pctReferenceOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">Target % of that total</span>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200 w-24"
            value={pt.pctOfTotal ?? ""}
            onChange={(e) =>
              onChange({ ...pt, pctOfTotal: parseFloat(e.target.value) || 0 })
            }
          />
        </label>
        <p className="text-slate-500">
          This line = that % of the chosen total each projection year.
        </p>
      </div>
    );
  }

  if (method === "product_line" || method === "channel") {
    const pl = inputs as ProductLineInputs;
    const items = pl.items ?? [];
    const sumShare = items.reduce((s, it) => s + (it.sharePercent ?? 0), 0);
    const addLine = () => {
      const id = `line_${Date.now()}`;
      const newItems = [...items, { id, label: "", sharePercent: 0, growthPercent: 0 }];
      onChange({ ...pl, items: newItems });
    };
    const removeLine = (index: number) => {
      const newItems = items.filter((_, i) => i !== index);
      onChange({ ...pl, items: newItems });
    };
    const updateLine = (index: number, patch: Partial<{ label: string; sharePercent: number; growthPercent: number }>) => {
      const newItems = items.map((it, i) => (i === index ? { ...it, ...patch } : it));
      onChange({ ...pl, items: newItems });
    };
    const kindLabel = method === "product_line" ? "Product line" : "Channel";
    return (
      <div className="space-y-3 text-xs">
        <p className="text-slate-500">
          Define {method === "product_line" ? "product lines" : "channels"} with share of revenue (base year) and growth % each. Shares should sum to 100%.
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">Base amount {unitLabel && `(${unitLabel})`} — optional</span>
          <input
            type="number"
            step="any"
            min="0"
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-200 w-32"
            value={pl.baseAmount ?? ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              const value = raw === "" ? undefined : parseFloat(raw);
              onChange({ ...pl, baseAmount: value === undefined || isNaN(value) ? undefined : value });
            }}
            placeholder="Leave empty to use allocation % of parent"
          />
        </label>
        <p className="text-[10px] text-slate-500">
          If set, total base for all lines uses this $ so it is not tied to allocation weight.
        </p>
        {items.map((it, index) => (
          <div
            key={it.id}
            className="rounded border border-slate-700 bg-slate-900/50 p-2 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <input
                type="text"
                className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200"
                placeholder={`${kindLabel} name`}
                value={it.label ?? ""}
                onChange={(e) => updateLine(index, { label: e.target.value })}
              />
              <button
                type="button"
                onClick={() => removeLine(index)}
                className="text-slate-400 hover:text-red-400 shrink-0"
                title="Remove"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-slate-500">Share % (base year)</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200"
                  value={it.sharePercent ?? ""}
                  onChange={(e) =>
                    updateLine(index, { sharePercent: parseFloat(e.target.value) || 0 })
                  }
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-500">Growth % per year</span>
                <input
                  type="number"
                  step="0.1"
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200"
                  value={it.growthPercent ?? ""}
                  onChange={(e) =>
                    updateLine(index, { growthPercent: parseFloat(e.target.value) || 0 })
                  }
                />
              </label>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addLine}
          className="rounded border border-slate-600 px-2 py-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          + Add {kindLabel.toLowerCase()}
        </button>
        {items.length > 0 && Math.abs(sumShare - 100) > 0.1 && (
          <p className="text-amber-400 text-[10px]">
            Shares sum to {sumShare.toFixed(1)}%; they should sum to 100%.
          </p>
        )}
        <p className="text-slate-500 text-[10px]">
          Base: {pl.baseAmount != null ? `${pl.baseAmount} ${unitLabel}` : `last historic year (${lastHistoricYear}) or allocation % of parent`}. Each line compounds at its growth rate.
        </p>
      </div>
    );
  }

  return null;
}
