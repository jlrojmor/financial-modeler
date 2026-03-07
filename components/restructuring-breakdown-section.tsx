"use client";

import { useMemo, useState, useEffect } from "react";
import { useModelStore } from "@/store/useModelStore";
import {
  displayToStored,
  storedToDisplay,
  getUnitLabel,
} from "@/lib/currency-utils";
import { getEligibleRowsForSbc } from "@/lib/is-disclosure-eligible";
import { getRestructuringDisclosures, getTotalRestructuringByYearFromEmbedded } from "@/lib/embedded-disclosure-restructuring";
import { computeRowValue } from "@/lib/calculations";

/**
 * Restructuring Charges breakdown — uses embedded disclosure (type "restructuring_charges").
 * Same eligible IS rows as other disclosure modules; validation: restructuring ≤ reported row value per year.
 */
export default function RestructuringBreakdownSection() {
  const incomeStatement = useModelStore((s) => s.incomeStatement);
  const meta = useModelStore((s) => s.meta);
  const embeddedDisclosures = useModelStore((s) => s.embeddedDisclosures ?? []);
  const setEmbeddedDisclosureValue = useModelStore((s) => s.setEmbeddedDisclosureValue);

  const years = useMemo(() => meta?.years?.historical ?? [], [meta]);
  const eligibleRows = useMemo(
    () => getEligibleRowsForSbc(incomeStatement ?? []),
    [incomeStatement]
  );

  const allStatements = useMemo(
    () => ({
      incomeStatement: incomeStatement ?? [],
      balanceSheet: [],
      cashFlow: [],
    }),
    [incomeStatement]
  );

  const restructuringDisclosures = useMemo(
    () => getRestructuringDisclosures(embeddedDisclosures),
    [embeddedDisclosures]
  );
  const restructByRowId = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    restructuringDisclosures.forEach((d) => {
      map[d.rowId] = d.values;
    });
    return map;
  }, [restructuringDisclosures]);

  const totalRestructByYear = useMemo(
    () => getTotalRestructuringByYearFromEmbedded(embeddedDisclosures, years),
    [embeddedDisclosures, years]
  );

  return (
    <div className="space-y-3">
      {eligibleRows.length > 0 && (
        <>
          {eligibleRows.map((row) => (
            <RestructuringRowCard
              key={row.id}
              row={row}
              years={years}
              meta={meta}
              incomeStatement={incomeStatement ?? []}
              allStatements={allStatements}
              valuesByYear={restructByRowId[row.id] ?? {}}
              setValue={(year, value) =>
                setEmbeddedDisclosureValue("restructuring_charges", row.id, year, value, row.label)
              }
            />
          ))}
        </>
      )}

      {(() => {
        const hasAnyData = Object.values(totalRestructByYear).some((v) => v !== 0);
        if (!hasAnyData) return null;
        return (
          <div className="rounded-md border border-rose-700/30 bg-rose-950/30 p-3">
            <div className="mb-2 text-xs font-medium text-rose-300/90">
              Total restructuring by year
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
              {years.map((y) => {
                const total = totalRestructByYear[y] ?? 0;
                const displayValue = storedToDisplay(total, meta?.currencyUnit);
                const unitLabel = getUnitLabel(meta?.currencyUnit);
                return (
                  <div key={y} className="block">
                    <div className="mb-1 text-[10px] text-rose-400/70">
                      {y} {unitLabel && `(${unitLabel})`}
                    </div>
                    <div className="rounded-md border border-rose-700/50 bg-rose-950/40 px-2 py-1 text-xs font-medium text-rose-100">
                      {displayValue === 0
                        ? "—"
                        : displayValue.toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0,
                          })}
                      {unitLabel ? ` ${unitLabel}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function RestructuringRowCard({
  row,
  years,
  meta,
  incomeStatement,
  allStatements,
  valuesByYear,
  setValue,
}: {
  row: { id: string; label: string };
  years: string[];
  meta: { currencyUnit?: string };
  incomeStatement: import("@/types/finance").Row[];
  allStatements: { incomeStatement: import("@/types/finance").Row[]; balanceSheet: unknown[]; cashFlow: unknown[] };
  valuesByYear: Record<string, number>;
  setValue: (year: string, value: number) => void;
}) {
  const getRestructValue = (year: string) => valuesByYear[year] ?? 0;

  const maxByYear = useMemo(() => {
    const out: Record<string, number> = {};
    years.forEach((y) => {
      const v = computeRowValue(
        row as import("@/types/finance").Row,
        y,
        incomeStatement,
        incomeStatement,
        allStatements
      );
      out[y] = Math.abs(v);
    });
    return out;
  }, [row, years, incomeStatement, allStatements]);

  const hasData = years.some((y) => getRestructValue(y) !== 0);

  const initializeLocalValues = useMemo(() => {
    const values: Record<string, string> = {};
    years.forEach((y) => {
      const storedValue = getRestructValue(y);
      const displayValue = storedToDisplay(storedValue, meta?.currencyUnit);
      values[y] = displayValue === 0 ? "" : String(displayValue);
    });
    return values;
  }, [years, valuesByYear, meta?.currencyUnit]);

  const [isExpanded, setIsExpanded] = useState(true);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [localValues, setLocalValues] = useState<Record<string, string>>(initializeLocalValues);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (isExpanded && !isConfirmed) {
      setLocalValues(initializeLocalValues);
      setValidationError(null);
    }
  }, [isExpanded, isConfirmed, initializeLocalValues]);

  const handleConfirm = () => {
    let err: string | null = null;
    years.forEach((y) => {
      const localVal = localValues[y] || "";
      if (localVal === "" || localVal === "-") {
        setValue(y, 0);
        return;
      }
      const displayNum = Number(localVal);
      if (!isNaN(displayNum) && displayNum >= 0) {
        const storedNum = displayToStored(displayNum, meta?.currencyUnit);
        const max = maxByYear[y] ?? Infinity;
        if (storedNum > max) {
          err = `${y}: Restructuring cannot exceed reported line value (${storedToDisplay(max, meta?.currencyUnit)})`;
        } else {
          setValue(y, storedNum);
        }
      }
    });
    setValidationError(err);
    if (!err) {
      setIsConfirmed(true);
      setIsExpanded(false);
    }
  };

  const handleEdit = () => {
    setIsConfirmed(false);
    setIsExpanded(true);
    setLocalValues(initializeLocalValues);
    setValidationError(null);
  };

  const handleValueChange = (year: string, value: string) => {
    setLocalValues((prev) => ({ ...prev, [year]: value }));
    setIsConfirmed(false);
    setValidationError(null);
  };

  const unitLabel = getUnitLabel(meta?.currencyUnit);

  if (!isExpanded && isConfirmed) {
    return (
      <div className="rounded-lg border border-rose-700/40 bg-rose-950/20 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="text-xs text-rose-400 hover:text-rose-300"
            >
              ▶
            </button>
            <span className="text-sm font-medium text-rose-200">{row.label}</span>
            {hasData && (
              <span className="text-xs text-rose-400/70">
                {years
                  .map((y) => {
                    const val = getRestructValue(y);
                    return val !== 0
                      ? `${y}: ${storedToDisplay(val, meta?.currencyUnit)}${unitLabel ? ` ${unitLabel}` : ""}`
                      : null;
                  })
                  .filter(Boolean)
                  .join(", ")}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleEdit}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            Edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-rose-700/40 bg-rose-950/20 p-3">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-rose-400 hover:text-rose-300"
            >
              {isExpanded ? "▼" : "▶"}
            </button>
            <span className="text-sm font-medium text-rose-200">{row.label}</span>
          </div>
          <p className="text-xs text-rose-300/70 mt-1">
            Restructuring disclosure by year. Cannot exceed the reported line value for that year.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isConfirmed && (
            <button
              type="button"
              onClick={handleEdit}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Edit
            </button>
          )}
          {!isConfirmed && (
            <button
              type="button"
              onClick={handleConfirm}
              className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-600 transition"
            >
              Confirm
            </button>
          )}
        </div>
      </div>
      {validationError && (
        <p className="text-xs text-red-400 mt-1 mb-2">{validationError}</p>
      )}
      {isExpanded && (
        <div className="ml-5 mt-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {years.map((year) => {
              const displayValue = storedToDisplay(getRestructValue(year), meta?.currencyUnit);
              const localValue =
                localValues[year] ?? (displayValue === 0 ? "" : String(displayValue));
              const maxDisplay = maxByYear[year] != null ? storedToDisplay(maxByYear[year], meta?.currencyUnit) : "—";
              return (
                <div key={year} className="flex flex-col">
                  <label className="text-xs text-rose-300/70 mb-1">
                    {year} {unitLabel && `(${unitLabel})`} — max {maxDisplay}
                  </label>
                  <input
                    type="number"
                    step="any"
                    min={0}
                    value={localValue}
                    onChange={(e) => handleValueChange(year, e.target.value)}
                    onBlur={(e) => {
                      if (e.target.value === "") handleValueChange(year, "");
                    }}
                    placeholder="0"
                    className="w-full rounded border border-rose-700 bg-rose-950/50 px-2 py-1.5 text-sm text-rose-100 placeholder-rose-500/50 focus:border-rose-500 focus:outline-none"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
