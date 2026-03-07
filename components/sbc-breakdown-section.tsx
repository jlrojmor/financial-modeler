"use client";

import { useMemo, useState, useEffect } from "react";
import type { Row } from "@/types/finance";
import { useModelStore } from "@/store/useModelStore";
import {
  displayToStored,
  storedToDisplay,
  getUnitLabel,
  type CurrencyUnit,
} from "@/lib/currency-utils";
import { getEligibleRowsForSbc } from "@/lib/is-disclosure-eligible";
import { getSbcDisclosures, getTotalSbcByYearFromEmbedded } from "@/lib/embedded-disclosure-sbc";
import { computeRowValue } from "@/lib/calculations";

/**
 * SBC Breakdown Section — uses generic embedded disclosure engine (type "sbc").
 * Lists eligible IS expense rows dynamically; one SBC entry per rowId; values do not modify reported IS.
 */
export default function SbcBreakdownSection() {
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
    (): { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] } => ({
      incomeStatement: incomeStatement ?? [],
      balanceSheet: [] as Row[],
      cashFlow: [] as Row[],
    }),
    [incomeStatement]
  );

  const sbcDisclosures = useMemo(
    () => getSbcDisclosures(embeddedDisclosures),
    [embeddedDisclosures]
  );
  const sbcByRowId = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    sbcDisclosures.forEach((d) => {
      map[d.rowId] = d.values;
    });
    return map;
  }, [sbcDisclosures]);

  const totalSbcByYear = useMemo(
    () => getTotalSbcByYearFromEmbedded(embeddedDisclosures, years),
    [embeddedDisclosures, years]
  );

  return (
    <div className="space-y-3">
      {eligibleRows.length > 0 && (
        <>
          {eligibleRows.map((row) => (
            <SbcRowCard
              key={row.id}
              row={row}
              years={years}
              meta={meta}
              incomeStatement={incomeStatement ?? []}
              allStatements={allStatements}
              valuesByYear={sbcByRowId[row.id] ?? {}}
              setValue={(year, value) =>
                setEmbeddedDisclosureValue("sbc", row.id, year, value, row.label)
              }
            />
          ))}
        </>
      )}

      {(() => {
        const hasAnyData = Object.values(totalSbcByYear).some((v) => v !== 0);
        if (!hasAnyData) return null;
        return (
          <div className="rounded-md border border-amber-700/30 bg-amber-950/30 p-3">
            <div className="mb-2 text-xs font-medium text-amber-300/90">
              Total SBC by year
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
              {years.map((y) => {
                const total = totalSbcByYear[y] ?? 0;
                const displayValue = storedToDisplay(total, (meta?.currencyUnit ?? "units") as CurrencyUnit);
                const unitLabel = getUnitLabel((meta?.currencyUnit ?? "units") as CurrencyUnit);
                return (
                  <div key={y} className="block">
                    <div className="mb-1 text-[10px] text-amber-400/70">
                      {y} {unitLabel && `(${unitLabel})`}
                    </div>
                    <div className="rounded-md border border-amber-700/50 bg-amber-950/40 px-2 py-1 text-xs font-medium text-amber-100">
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

function SbcRowCard({
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
  allStatements: { incomeStatement: Row[]; balanceSheet: Row[]; cashFlow: Row[] };
  valuesByYear: Record<string, number>;
  setValue: (year: string, value: number) => void;
}) {
  const getSbcValue = (year: string) => valuesByYear[year] ?? 0;

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

  const hasData = years.some((y) => getSbcValue(y) !== 0);

  const initializeLocalValues = useMemo(() => {
    const values: Record<string, string> = {};
    years.forEach((y) => {
      const storedValue = getSbcValue(y);
      const displayValue = storedToDisplay(storedValue, (meta?.currencyUnit ?? "units") as CurrencyUnit);
      values[y] = displayValue === 0 ? "" : String(displayValue);
    });
    return values;
  }, [years, valuesByYear, (meta?.currencyUnit ?? "units") as CurrencyUnit]);

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
        const storedNum = displayToStored(displayNum, (meta?.currencyUnit ?? "units") as CurrencyUnit);
        const max = maxByYear[y] ?? Infinity;
        if (storedNum > max) {
          err = `${y}: SBC cannot exceed reported line value (${storedToDisplay(max, (meta?.currencyUnit ?? "units") as CurrencyUnit)})`;
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

  const unitLabel = getUnitLabel((meta?.currencyUnit ?? "units") as CurrencyUnit);

  if (!isExpanded && isConfirmed) {
    return (
      <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="text-xs text-amber-400 hover:text-amber-300"
            >
              ▶
            </button>
            <span className="text-sm font-medium text-amber-200">{row.label}</span>
            {hasData && (
              <span className="text-xs text-amber-400/70">
                {years
                  .map((y) => {
                    const val = getSbcValue(y);
                    return val !== 0
                      ? `${y}: ${storedToDisplay(val, (meta?.currencyUnit ?? "units") as CurrencyUnit)}${unitLabel ? ` ${unitLabel}` : ""}`
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
    <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-amber-400 hover:text-amber-300"
            >
              {isExpanded ? "▼" : "▶"}
            </button>
            <span className="text-sm font-medium text-amber-200">{row.label}</span>
          </div>
          <p className="text-xs text-amber-300/70 mt-1">
            SBC disclosure by year. Cannot exceed the reported line value for that year.
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
              className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition"
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
              const displayValue = storedToDisplay(getSbcValue(year), (meta?.currencyUnit ?? "units") as CurrencyUnit);
              const localValue =
                localValues[year] ?? (displayValue === 0 ? "" : String(displayValue));
              const maxDisplay = maxByYear[year] != null ? storedToDisplay(maxByYear[year], (meta?.currencyUnit ?? "units") as CurrencyUnit) : "—";
              return (
                <div key={year} className="flex flex-col">
                  <label className="text-xs text-amber-300/70 mb-1">
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
                    className="w-full rounded border border-amber-700 bg-amber-950/50 px-2 py-1.5 text-sm text-amber-100 placeholder-amber-500/50 focus:border-amber-500 focus:outline-none"
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
