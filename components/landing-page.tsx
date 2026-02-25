"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useModelStore } from "@/store/useModelStore";
import ModelSetup from "@/components/model-setup";
import type { ModelMeta } from "@/store/useModelStore";
import {
  FileSpreadsheet,
  Sliders,
  TrendingUp,
  Sparkles,
  ChevronRight,
  Calendar,
  DollarSign,
  Upload,
  Settings,
} from "lucide-react";

const ACCENT = "#6B90FF";

export default function LandingPage() {
  const router = useRouter();
  const projects = useModelStore((s) => s.projects);
  const createProject = useModelStore((s) => s.createProject);
  const isInitialized = useModelStore((s) => s.isInitialized);
  const meta = useModelStore((s) => s.meta);
  const hasHydrated = useModelStore((s) => s._hasHydrated);
  const [showNewProject, setShowNewProject] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !hasHydrated) return;
    if (isInitialized && meta && (!projects || projects.length === 0)) {
      const name = meta.companyName?.trim() || "Untitled";
      createProject(name, meta, { fromCurrentState: true });
    }
  }, [mounted, hasHydrated, isInitialized, projects, meta, createProject]);

  const handleCreateProject = (meta: ModelMeta) => {
    const name = meta.companyName?.trim() || "Untitled";
    const id = createProject(name, meta);
    router.push(`/project/${id}`);
  };

  const startCta = () => setShowNewProject(true);

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center landing-bg">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (showNewProject) {
    return (
      <div className="min-h-screen landing-bg p-4">
        <div className="mx-auto max-w-2xl">
          <button
            type="button"
            onClick={() => setShowNewProject(false)}
            className="mb-4 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            ← Back
          </button>
          <ModelSetup onCreateProject={handleCreateProject} />
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen text-white antialiased landing-bg relative font-landing">
      {/* Centered title + subtitle */}
      <section className="pt-16 md:pt-24 pb-10 px-6 text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 tracking-tight">
          Easily Build DCF Models
        </h1>
        <p className="text-lg text-gray-300 max-w-2xl mx-auto mb-8 font-normal">
          Manually input your historical financials and generate a full DCF analysis in minutes.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <button
            type="button"
            onClick={startCta}
            className="bg-[#6B90FF] hover:opacity-90 px-6 py-3 rounded-lg font-medium transition"
          >
            Get Started
          </button>
          <button
            type="button"
            className="border border-gray-500 px-6 py-3 rounded-lg font-medium hover:bg-white/5 transition flex items-center gap-2"
          >
            Watch Demo
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </section>

      {/* Hero: left = step cards, right = mock app window (prominent) */}
      <section className="max-w-7xl mx-auto px-6 pb-20 flex flex-col lg:flex-row gap-8 lg:gap-10 items-stretch">
        {/* Left: step cards */}
        <div className="w-full lg:max-w-[340px] flex-shrink-0 flex flex-col gap-4">
          <StepItem
            step={1}
            icon={<Calendar className="h-5 w-5" />}
            title="Enter Financials"
            description="Manually input historical financial statements."
            active
          />
          <StepItem
            step={2}
            icon={<Sliders className="h-5 w-5" />}
            title="Adjust Assumptions"
            description="Adjust growth rates, margins and assumptions."
          />
          <StepItem
            step={3}
            icon={<DollarSign className="h-5 w-5" />}
            title="Review Valuation"
            description="Review and generate your valuation instantly."
          />
        </div>

        {/* Right: main mock app - bigger, premium focus */}
        <div className="flex-1 min-w-0 min-h-[520px] lg:min-h-[560px] flex items-stretch">
          <MockAppWindow />
        </div>
      </section>

      {/* Feature cards */}
      <section className="max-w-7xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <FeatureCard
            icon={<TrendingUp className="h-5 w-5" />}
            title="Sensitivity Analysis"
            description="Stress test valuation with dynamic scenarios."
          />
          <FeatureCard
            icon={<Sparkles className="h-5 w-5" />}
            title="AI-Powered Projections"
            description="Enhance forecasts with intelligent modeling suggestions."
          />
          <FeatureCard
            icon={<FileSpreadsheet className="h-5 w-5" />}
            title="Export to Excel"
            description="Download your model in XLSX format."
          />
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-white/10 py-16 text-center">
        <h2 className="text-3xl font-semibold mb-6">Ready to Build Your DCF Model?</h2>
        <button
          type="button"
          onClick={startCta}
          className="bg-[#6B90FF] hover:opacity-90 px-8 py-4 rounded-lg font-medium text-lg transition"
        >
          Start Your DCF Model Now
        </button>
      </section>

      {/* Your projects - existing functionality */}
      <section className="border-t border-white/10 py-12 px-6">
        <div className="max-w-4xl mx-auto rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Your projects
            </h2>
            <button
              type="button"
              onClick={startCta}
              className="bg-[#6B90FF] hover:opacity-90 px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              + New project
            </button>
          </div>
          {projects.length === 0 ? (
            <p className="text-gray-500">No projects yet. Create one to get started.</p>
          ) : (
            <ul className="space-y-2">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/project/${p.id}`)}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10"
                  >
                    <span className="font-medium text-gray-200">{p.name}</span>
                    <span className="ml-2 text-xs text-gray-500">
                      Updated {new Date(p.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

function StepItem({
  step,
  icon,
  title,
  description,
  active,
}: {
  step: number;
  icon: React.ReactNode;
  title: string;
  description: string;
  active?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 flex gap-4 items-start transition ${
        active
          ? "bg-white/[0.08] border-white/20 shadow-lg shadow-black/10"
          : "bg-white/[0.04] border-white/10 hover:bg-white/[0.06] hover:border-white/15"
      }`}
    >
      <div
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-white"
        style={{ backgroundColor: active ? ACCENT : "rgba(107, 144, 255, 0.25)" }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
            Step {step}
          </span>
        </div>
        <h3 className="font-semibold text-white text-lg leading-tight">{title}</h3>
        <p className="text-sm text-gray-400 mt-1.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm p-6 flex gap-4 items-start hover:bg-white/[0.06] hover:border-white/15 transition">
      <div
        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-white"
        style={{ backgroundColor: "rgba(107, 144, 255, 0.2)" }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <h4 className="font-semibold text-white text-lg mb-2 leading-tight">{title}</h4>
        <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function MockAppWindow() {
  const years = ["2023A", "2024E", "2025E", "2026E", "2027E"];
  const rows: { label: string; values: number[]; isTotal?: boolean }[] = [
    { label: "Revenue", values: [1920, 2100, 2280, 2480, 2680] },
    { label: "COGS", values: [-520, -580, -620, -680, -720] },
    { label: "SG&A", values: [-680, -720, -760, -800, -840] },
    { label: "R&D", values: [-320, -340, -360, -380, -400] },
    { label: "EBIT", values: [400, 460, 540, 620, 720], isTotal: true },
  ];

  // Chart: Revenue + FCF-style series with proper coords (viewBox 0 0 100 60, padding for axes)
  const chartYears = ["2023", "2024", "2025", "2026", "2027"];
  const revenue = [1920, 2100, 2280, 2480, 2680];
  const fcf = [320, 380, 440, 520, 600]; // proxy FCF
  const padL = 12;
  const padR = 6;
  const padT = 8;
  const padB = 14;
  const w = 100 - padL - padR;
  const h = 60 - padT - padB;
  const toX = (i: number) => padL + (i / (revenue.length - 1)) * w;
  const toYRev = (v: number) => padT + h - ((v - 1500) / 1300) * h; // scale ~1500–2800
  const toYFcf = (v: number) => padT + h - ((v - 200) / 500) * h;   // scale ~200–700
  const revPath =
    revenue
      .map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toYRev(v)}`)
      .join(" ") + ` L ${toX(revenue.length - 1)} ${padT + h} L ${padL} ${padT + h} Z`;
  const fcfPath = fcf.map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toYFcf(v)}`).join(" ");

  // Sensitivity: WACC (cols) vs Terminal growth (rows) -> EV $M
  const waccCols = [7.5, 8.0, 8.5, 9.0];
  const tgRows = [2.0, 2.5, 3.0];
  const sensitivityMatrix: number[][] = [
    [17200, 16200, 15300, 14500],
    [16800, 15800, 14900, 14100],
    [16400, 15400, 14600, 13800],
  ];

  return (
    <div className="w-full h-full min-h-[480px] rounded-2xl border-2 border-[#e0e0e0] bg-[#f5f5f5] shadow-[0_25px_80px_-12px_rgba(0,0,0,0.4)] overflow-hidden flex flex-col">
      {/* Title bar - light, app-like */}
      <div className="flex items-center justify-between bg-[#ebebeb] border-b border-[#d0d0d0] px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <span className="text-[15px] font-semibold text-gray-800">Enter Financial Data</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 transition"
            aria-label="Upload"
          >
            <Upload className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 transition"
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 p-5 flex flex-col min-h-0 gap-5">
        {/* P&L table - clean, professional, light */}
        <div className="flex-shrink-0 overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full min-w-[360px] text-[15px]">
            <thead>
              <tr className="bg-[#fafafa] border-b border-gray-200">
                <th className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  ($ millions)
                </th>
                {years.map((y) => (
                  <th
                    key={y}
                    className="py-3 px-4 text-right text-xs font-semibold text-gray-600 w-20"
                  >
                    {y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row, idx) => (
                <tr
                  key={row.label}
                  className={
                    row.isTotal
                      ? "bg-[#f8f9fc] border-t-2 border-gray-200"
                      : "bg-white hover:bg-gray-50/80 transition"
                  }
                >
                  <td
                    className={`py-3 px-4 font-medium ${
                      row.isTotal ? "text-gray-900" : "text-gray-700"
                    }`}
                  >
                    {row.label}
                  </td>
                  {row.values.map((v, i) => (
                    <td
                      key={i}
                      className={`py-3 px-4 text-right tabular-nums text-[15px] ${
                        v < 0 ? "text-red-600" : "text-gray-800"
                      } ${row.isTotal ? "font-semibold" : ""}`}
                    >
                      {v < 0 ? `(${Math.abs(v).toLocaleString()})` : v.toLocaleString()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Chart + DCF + Sensitivity */}
        <div className="flex-1 min-h-[200px] grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Cool chart - with grid and axes */}
          <div className="lg:col-span-7 rounded-xl border border-gray-200 bg-[#1a1f2e] overflow-hidden shadow-inner">
            <div className="px-3 pt-2 pb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Revenue &amp; FCF
              </span>
              <div className="flex gap-3 text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-0.5 rounded-full bg-[#6B90FF]" /> Revenue
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-0.5 rounded-full bg-[#4ade80]" /> FCF
                </span>
              </div>
            </div>
            <div className="h-[140px] w-full px-2 pb-2">
              <svg viewBox="0 0 100 60" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                {/* Grid */}
                {[0, 1, 2, 3, 4].map((i) => (
                  <line
                    key={`v-${i}`}
                    x1={padL + (i / 4) * w}
                    y1={padT}
                    x2={padL + (i / 4) * w}
                    y2={padT + h}
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="0.4"
                  />
                ))}
                {[0, 1, 2, 3].map((i) => (
                  <line
                    key={`h-${i}`}
                    x1={padL}
                    y1={padT + (i / 3) * h}
                    x2={padL + w}
                    y2={padT + (i / 3) * h}
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="0.4"
                  />
                ))}
                {/* Revenue area + line */}
                <path d={revPath} fill="url(#revFill)" />
                <path
                  d={revenue.map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toYRev(v)}`).join(" ")}
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* FCF line */}
                <path
                  d={fcfPath}
                  fill="none"
                  stroke="#4ade80"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.95}
                />
                {/* Y-axis labels */}
                {[2000, 2400, 2800].map((val, i) => (
                  <text
                    key={val}
                    x={padL - 1}
                    y={toYRev(val) + 1}
                    textAnchor="end"
                    className="fill-gray-500"
                    style={{ fontSize: "4.5px", fontFamily: "inherit" }}
                  >
                    {val}
                  </text>
                ))}
                {/* X-axis labels */}
                {chartYears.map((label, i) => (
                  <text
                    key={label}
                    x={toX(i)}
                    y={58}
                    textAnchor="middle"
                    className="fill-gray-500"
                    style={{ fontSize: "5px", fontFamily: "inherit" }}
                  >
                    {label}
                  </text>
                ))}
              </svg>
            </div>
          </div>

          {/* Right column: DCF valuation + Sensitivity */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* DCF valuation mock */}
            <div className="rounded-xl border border-gray-200 bg-white shadow-md overflow-hidden flex-shrink-0">
              <div className="px-4 py-2 bg-[#f8fafc] border-b border-gray-100">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  DCF Valuation
                </span>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-500">
                  <span>WACC</span>
                  <span className="text-right font-medium text-gray-700">8.5%</span>
                  <span>Terminal growth</span>
                  <span className="text-right font-medium text-gray-700">2.5%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden flex">
                  <div className="bg-[#6B90FF]" style={{ width: "62%" }} title="PV Explicit" />
                  <div className="bg-[#4ade80]" style={{ width: "38%" }} title="PV Terminal" />
                </div>
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>PV Explicit 62%</span>
                  <span>PV Terminal 38%</span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                  <span className="text-xs font-medium text-gray-600">Enterprise Value</span>
                  <span className="text-xl font-bold text-gray-900">$15,420M</span>
                </div>
              </div>
            </div>

            {/* Sensitivity table */}
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden flex-1 min-h-0">
              <div className="px-3 py-2 bg-[#fafafa] border-b border-gray-200">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Sensitivity — EV ($M)
                </span>
              </div>
              <div className="overflow-auto max-h-[100px]">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="py-1.5 px-2 text-left font-medium text-gray-500 w-12">
                        TG \ WACC
                      </th>
                      {waccCols.map((c) => (
                        <th key={c} className="py-1.5 px-1 text-right font-medium text-gray-600">
                          {c}%
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tgRows.map((tg, ri) => (
                      <tr key={tg} className="border-t border-gray-100">
                        <td className="py-1 px-2 text-gray-600 font-medium">{tg}%</td>
                        {sensitivityMatrix[ri].map((ev, ci) => (
                          <td
                            key={ci}
                            className={`py-1 px-1 text-right tabular-nums ${
                              ri === 1 && ci === 2
                                ? "bg-blue-50 font-semibold text-gray-900 ring-1 ring-blue-200"
                                : "text-gray-700"
                            }`}
                          >
                            {ev.toLocaleString()}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
