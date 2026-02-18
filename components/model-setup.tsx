"use client";

import { useState } from "react";
import { useModelStore, type ModelType, type CurrencyUnit, type ModelMeta } from "@/store/useModelStore";
import type { CompanyType } from "@/types/finance";

interface ModelSetupProps {
  /** When provided (e.g. from landing), create project and redirect instead of only initializing */
  onCreateProject?: (meta: ModelMeta) => void;
}

interface SetupFormData {
  modelType: ModelType;
  companyName: string;
  companyType: CompanyType;
  currency: string;
  currencyUnit: CurrencyUnit;
  numHistoricalYears: number;
  forecastPeriod: 5 | 10;
  baseYear: number;
}

export default function ModelSetup({ onCreateProject }: ModelSetupProps = {}) {
  const initializeModel = useModelStore((s) => s.initializeModel);
  
  const currentYear = new Date().getFullYear();
  const [formData, setFormData] = useState<SetupFormData>({
    modelType: "dcf",
    companyName: "",
    companyType: "private",
    currency: "USD",
    currencyUnit: "millions",
    numHistoricalYears: 2,
    forecastPeriod: 5,
    baseYear: currentYear,
  });

  const [errors, setErrors] = useState<Partial<Record<keyof SetupFormData, string>>>({});

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof SetupFormData, string>> = {};

    if (!formData.companyName.trim()) {
      newErrors.companyName = "Company name is required";
    }

    if (formData.numHistoricalYears < 1 || formData.numHistoricalYears > 10) {
      newErrors.numHistoricalYears = "Must be between 1 and 10 years";
    }

    if (formData.baseYear < 2000 || formData.baseYear > currentYear + 1) {
      newErrors.baseYear = `Must be between 2000 and ${currentYear + 1}`;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validate()) {
      return;
    }

    // Generate year labels
    const historical: string[] = [];
    const projection: string[] = [];

    // Historical years (going backwards from base year)
    for (let i = formData.numHistoricalYears - 1; i >= 0; i--) {
      const year = formData.baseYear - i;
      historical.push(`${year}A`);
    }

    // Projection years (going forward from base year)
    for (let i = 1; i <= formData.forecastPeriod; i++) {
      const year = formData.baseYear + i;
      projection.push(`${year}E`);
    }

    const meta: ModelMeta = {
      companyName: formData.companyName.trim(),
      companyType: formData.companyType,
      currency: formData.currency,
      currencyUnit: formData.currencyUnit,
      years: { historical, projection },
      modelType: formData.modelType,
    };

    if (onCreateProject) {
      onCreateProject(meta);
    } else {
      initializeModel(meta);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-100">Financial Model Setup</h1>
          <p className="mt-2 text-sm text-slate-400">
            Let's start by configuring your financial model. We'll guide you through each step.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Model Type */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-200">
              Model Type
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(["dcf", "lbo", "startup"] as ModelType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFormData({ ...formData, modelType: type })}
                  className={[
                    "rounded-lg border px-4 py-3 text-sm font-medium transition",
                    formData.modelType === type
                      ? "border-blue-500 bg-blue-950/40 text-blue-300"
                      : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600",
                  ].join(" ")}
                >
                  {type.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {formData.modelType === "dcf" && "Discounted Cash Flow valuation"}
              {formData.modelType === "lbo" && "Leveraged Buyout model"}
              {formData.modelType === "startup" && "Startup/Pre-revenue valuation"}
            </p>
          </div>

          {/* Company Name */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-200">
              Company Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={formData.companyName}
              onChange={(e) =>
                setFormData({ ...formData, companyName: e.target.value })
              }
              className={[
                "w-full rounded-lg border bg-slate-950 px-4 py-2 text-sm text-slate-100 placeholder:text-slate-500",
                errors.companyName
                  ? "border-red-500"
                  : "border-slate-700 focus:border-blue-500 focus:outline-none",
              ].join(" ")}
              placeholder="e.g., Acme Corporation"
            />
            {errors.companyName && (
              <p className="mt-1 text-xs text-red-400">{errors.companyName}</p>
            )}
          </div>

          {/* Company Type */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-200">
              Company Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(["public", "private"] as CompanyType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFormData({ ...formData, companyType: type })}
                  className={[
                    "rounded-lg border px-4 py-3 text-sm font-medium capitalize transition",
                    formData.companyType === type
                      ? "border-blue-500 bg-blue-950/40 text-blue-300"
                      : "border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600",
                  ].join(" ")}
                >
                  {type}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {formData.companyType === "public"
                ? "Public companies have SEC filings (10-K, 10-Q) available"
                : "Private companies require manual data entry"}
            </p>
          </div>

          {/* Currency, Currency Unit, and Base Year */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200">
                Currency
              </label>
              <select
                value={formData.currency}
                onChange={(e) =>
                  setFormData({ ...formData, currency: e.target.value })
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="JPY">JPY (¥)</option>
                <option value="CAD">CAD (C$)</option>
                <option value="AUD">AUD (A$)</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200">
                Currency Unit
              </label>
              <select
                value={formData.currencyUnit}
                onChange={(e) =>
                  setFormData({ ...formData, currencyUnit: e.target.value as CurrencyUnit })
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="millions">Millions (M)</option>
                <option value="thousands">Thousands (K)</option>
                <option value="units">Units</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Enter values in {formData.currencyUnit === "millions" ? "millions" : formData.currencyUnit === "thousands" ? "thousands" : "units"}
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200">
                Base Year <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                value={formData.baseYear}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    baseYear: parseInt(e.target.value) || currentYear,
                  })
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
                Most recent historical year
              </p>
            </div>
          </div>

          {/* Historical Years */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-200">
              Number of Historical Years
            </label>
            <input
              type="number"
              value={formData.numHistoricalYears}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  numHistoricalYears: parseInt(e.target.value) || 2,
                })
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
              How many years of historical financial data do you have? (1-10)
            </p>
            {formData.numHistoricalYears > 0 && formData.baseYear > 0 && (
              <p className="mt-2 text-xs text-blue-400">
                Historical years:{" "}
                {Array.from({ length: formData.numHistoricalYears }, (_, i) => {
                  const year = formData.baseYear - (formData.numHistoricalYears - 1 - i);
                  return `${year}A`;
                }).join(", ")}
              </p>
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
                  onClick={() =>
                    setFormData({ ...formData, forecastPeriod: period })
                  }
                  className={[
                    "rounded-lg border px-4 py-3 text-sm font-medium transition",
                    formData.forecastPeriod === period
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
            {formData.forecastPeriod > 0 && formData.baseYear > 0 && (
              <p className="mt-2 text-xs text-blue-400">
                Projection years:{" "}
                {Array.from({ length: formData.forecastPeriod }, (_, i) => {
                  const year = formData.baseYear + i + 1;
                  return `${year}E`;
                }).join(", ")}
              </p>
            )}
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500 transition"
            >
              Start Building Model →
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
