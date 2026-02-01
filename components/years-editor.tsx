"use client";

import { useState, useMemo } from "react";
import { useModelStore } from "@/store/useModelStore";
import CollapsibleSection from "@/components/collapsible-section";

export default function YearsEditor() {
  const meta = useModelStore((s) => s.meta);
  const updateYears = useModelStore((s) => s.updateYears);
  
  const currentYear = new Date().getFullYear();
  
  // Parse current years to get base year and counts
  const baseYear = useMemo(() => {
    if (meta.years.historical.length > 0) {
      // Get the most recent historical year (e.g., "2024A" -> 2024)
      const lastHistorical = meta.years.historical[meta.years.historical.length - 1];
      return parseInt(lastHistorical.replace("A", "")) || currentYear;
    }
    return currentYear;
  }, [meta.years.historical, currentYear]);
  
  const [numHistoricalYears, setNumHistoricalYears] = useState(meta.years.historical.length);
  const [forecastPeriod, setForecastPeriod] = useState<5 | 10>(meta.years.projection.length as 5 | 10);
  const [newBaseYear, setNewBaseYear] = useState(baseYear);
  
  const [errors, setErrors] = useState<{
    numHistoricalYears?: string;
    baseYear?: string;
  }>({});
  
  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    
    if (numHistoricalYears < 1 || numHistoricalYears > 10) {
      newErrors.numHistoricalYears = "Must be between 1 and 10 years";
    }
    
    if (newBaseYear < 2000 || newBaseYear > currentYear + 1) {
      newErrors.baseYear = `Must be between 2000 and ${currentYear + 1}`;
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  
  const handleSave = () => {
    if (!validate()) {
      return;
    }
    
    // Generate new year arrays
    const historical: string[] = [];
    const projection: string[] = [];
    
    // Historical years (going backwards from base year)
    for (let i = numHistoricalYears - 1; i >= 0; i--) {
      const year = newBaseYear - i;
      historical.push(`${year}A`);
    }
    
    // Projection years (going forward from base year)
    for (let i = 1; i <= forecastPeriod; i++) {
      const year = newBaseYear + i;
      projection.push(`${year}E`);
    }
    
    // Update years in store (this will handle data migration)
    updateYears({
      historical,
      projection,
    });
  };
  
  const previewHistorical = useMemo(() => {
    return Array.from({ length: numHistoricalYears }, (_, i) => {
      const year = newBaseYear - (numHistoricalYears - 1 - i);
      return `${year}A`;
    });
  }, [numHistoricalYears, newBaseYear]);
  
  const previewProjection = useMemo(() => {
    return Array.from({ length: forecastPeriod }, (_, i) => {
      const year = newBaseYear + i + 1;
      return `${year}E`;
    });
  }, [forecastPeriod, newBaseYear]);
  
  return (
    <CollapsibleSection
      sectionId="years_editor"
      title="Edit Years Configuration"
      description="Modify historical years and forecast periods. Changes will update all financial statements."
      colorClass="blue"
      defaultExpanded={false}
      confirmButtonLabel="Save Years"
      onConfirm={handleSave}
    >
      <div className="space-y-6">
        {/* Base Year */}
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-200">
            Base Year (Most Recent Historical Year) <span className="text-red-400">*</span>
          </label>
          <input
            type="number"
            value={newBaseYear}
            onChange={(e) =>
              setNewBaseYear(parseInt(e.target.value) || currentYear)
            }
            min={2000}
            max={currentYear + 1}
            className={[
              "w-full rounded-lg border bg-slate-950 px-4 py-2 text-sm text-slate-100",
              errors.baseYear
                ? "border-red-500"
                : "border-slate-700 focus:border-blue-500 focus:outline-none",
            ].join(" ")}
          />
          {errors.baseYear && (
            <p className="mt-1 text-xs text-red-400">{errors.baseYear}</p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            The most recent historical year (e.g., {currentYear} for {currentYear} financials)
          </p>
        </div>
        
        {/* Historical Years */}
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-200">
            Number of Historical Years
          </label>
          <input
            type="number"
            value={numHistoricalYears}
            onChange={(e) =>
              setNumHistoricalYears(parseInt(e.target.value) || 2)
            }
            min={1}
            max={10}
            className={[
              "w-full rounded-lg border bg-slate-950 px-4 py-2 text-sm text-slate-100",
              errors.numHistoricalYears
                ? "border-red-500"
                : "border-slate-700 focus:border-blue-500 focus:outline-none",
            ].join(" ")}
          />
          {errors.numHistoricalYears && (
            <p className="mt-1 text-xs text-red-400">
              {errors.numHistoricalYears}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            How many years of historical financial data? (1-10)
          </p>
          {previewHistorical.length > 0 && (
            <div className="mt-2 rounded-md border border-blue-800/40 bg-blue-950/20 p-2">
              <p className="text-xs text-blue-300">
                Historical years: <span className="font-semibold text-blue-200">{previewHistorical.join(", ")}</span>
              </p>
            </div>
          )}
        </div>
        
        {/* Forecast Period */}
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-200">
            Forecast Period
          </label>
          <div className="grid grid-cols-2 gap-3">
            {([5, 10] as const).map((period) => (
              <button
                key={period}
                type="button"
                onClick={() => setForecastPeriod(period)}
                className={[
                  "rounded-lg border px-4 py-3 text-sm font-medium transition",
                  forecastPeriod === period
                    ? "border-blue-500 bg-blue-950/40 text-blue-300"
                    : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600",
                ].join(" ")}
              >
                {period} Years
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Standard DCF models use 5-year projections. 10-year is for long-term analysis.
          </p>
          {previewProjection.length > 0 && (
            <div className="mt-2 rounded-md border border-blue-800/40 bg-blue-950/20 p-2">
              <p className="text-xs text-blue-300">
                Projection years: <span className="font-semibold text-blue-200">{previewProjection.join(", ")}</span>
              </p>
            </div>
          )}
        </div>
        
        {/* Warning */}
        <div className="rounded-md border border-amber-800/40 bg-amber-950/20 p-3">
          <p className="text-xs text-amber-200 font-semibold mb-1">
            ⚠️ Important
          </p>
          <p className="text-xs text-amber-300/90">
            Changing years will:
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li>Add empty values for new years</li>
              <li>Remove values for deleted years</li>
              <li>Recalculate all formulas for all periods</li>
            </ul>
          </p>
        </div>
      </div>
    </CollapsibleSection>
  );
}
