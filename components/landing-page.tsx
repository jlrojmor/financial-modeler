"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useModelStore } from "@/store/useModelStore";
import ModelSetup from "@/components/model-setup";
import type { ModelMeta } from "@/store/useModelStore";
import {
  Calendar,
  Sliders,
  DollarSign,
  FileInput,
  LineChart,
  Sparkles,
  Settings,
  TrendingUp,
  FileSpreadsheet,
  Play,
} from "lucide-react";

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
      <div className="flex min-h-screen items-center justify-center bg-[#0f1419]">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (showNewProject) {
    return (
      <div className="min-h-screen bg-[#0f1419] p-4">
        <div className="mx-auto max-w-2xl">
          <button
            type="button"
            onClick={() => setShowNewProject(false)}
            className="mb-4 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            ← Back
          </button>
          <ModelSetup onCreateProject={handleCreateProject} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1419] text-white antialiased">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-slate-800/50">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `linear-gradient(135deg, transparent 40%, rgba(59, 130, 246, 0.03) 50%, transparent 60%)`,
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-6 py-16 md:py-24 lg:flex lg:items-center lg:gap-16">
          <div className="lg:max-w-xl">
            <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl">
              Build Your DCF Model
              <br />
              <span className="text-3xl md:text-4xl text-slate-300">in Minutes</span>
            </h1>
            <p className="mt-4 text-lg text-slate-400">
              Turn your historical data into a full DCF valuation model in just a few clicks.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <button
                type="button"
                onClick={startCta}
                className="rounded-lg bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:bg-blue-500"
              >
                Get Started
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-600 bg-transparent px-6 py-3 text-base font-medium text-white transition hover:border-slate-500 hover:bg-slate-800/50"
              >
                <span className="flex items-center gap-2">
                  <Play className="h-4 w-4" />
                  Watch Demo
                </span>
              </button>
            </div>
          </div>
          <div className="mt-12 lg:mt-0 lg:flex-1 lg:flex lg:justify-end">
            <AppMockup />
          </div>
        </div>
      </section>

      {/* Key features - 3 cards */}
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <div className="grid gap-6 md:grid-cols-3">
          <FeatureCard
            icon={<Calendar className="h-8 w-8 text-emerald-500" />}
            title="Input Financials"
            description="Upload your historical data with ease."
          />
          <FeatureCard
            icon={<Sliders className="h-8 w-8 text-slate-400" />}
            title="Customize Assumptions"
            description="Set growth rates & key drivers."
          />
          <FeatureCard
            icon={<DollarSign className="h-8 w-8 text-blue-500" />}
            title="Get Your Valuation"
            description="Generate your DCF model instantly."
          />
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-slate-800/50 bg-slate-900/30 py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold text-white md:text-4xl">
            How It Works
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <StepCard
              step={1}
              icon={<FileInput className="h-7 w-7 text-slate-400" />}
              title="Import Your Data"
              description="Upload historical financials in seconds."
            />
            <StepCard
              step={2}
              icon={<Sliders className="h-7 w-7 text-blue-500" />}
              title="Define Your Projections"
              description="Choose your assumptions for Revenue, Costs, and more."
            />
            <StepCard
              step={3}
              icon={<LineChart className="h-7 w-7 text-blue-500" />}
              title="Get Your DCF Valuation"
              description="Instantly generate your discounted cash flow analysis."
            />
          </div>
        </div>
      </section>

      {/* Powerful tools */}
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <h2 className="text-center text-3xl font-bold text-white md:text-4xl">
          Powerful Tools for Financial Modeling
        </h2>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <ToolCard
            icon={<Sparkles className="h-7 w-7 text-slate-400" />}
            title="Automated Forecasts"
            description="AI-driven projections tailored in seconds."
          />
          <ToolCard
            icon={<Settings className="h-7 w-7 text-slate-400" />}
            title="Dynamic Adjustments"
            description="Modify assumptions in real-time."
          />
          <ToolCard
            icon={<TrendingUp className="h-7 w-7 text-blue-500" />}
            title="Sensitivity Analysis"
            description="Stress test your valuation with scenarios."
          />
          <ToolCard
            icon={<FileSpreadsheet className="h-7 w-7 text-emerald-500" />}
            title="Export to Excel"
            description="Download your model in XLSX format."
          />
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-slate-800/50 bg-slate-900/30 py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold text-white md:text-4xl">
            Ready to Get Started?
          </h2>
          <button
            type="button"
            onClick={startCta}
            className="mt-6 rounded-lg bg-blue-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-600/25 transition hover:bg-blue-500"
          >
            Start Your DCF Model Now
          </button>
        </div>
      </section>

      {/* Trust */}
      <section className="border-t border-slate-800/50 py-12">
        <p className="text-center text-sm text-slate-500">
          Trusted by finance professionals worldwide
        </p>
        <div className="mx-auto mt-6 flex max-w-2xl flex-wrap justify-center gap-6 px-6">
          {["Goldman Sachs", "Morgan Stanley", "Deloitte"].map((name) => (
            <div
              key={name}
              className="rounded-lg border border-slate-700/80 bg-slate-800/50 px-6 py-3 text-sm font-medium text-slate-300"
            >
              {name}
            </div>
          ))}
        </div>
      </section>

      {/* Your projects - existing functionality */}
      <section className="mx-auto max-w-4xl px-6 py-12">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Your projects
            </h2>
            <button
              type="button"
              onClick={startCta}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              + New project
            </button>
          </div>
          {projects.length === 0 ? (
            <p className="text-slate-500">No projects yet. Create one to get started.</p>
          ) : (
            <ul className="space-y-2">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/project/${p.id}`)}
                    className="w-full rounded-lg border border-slate-700/80 bg-slate-800/50 px-4 py-3 text-left transition hover:border-slate-600 hover:bg-slate-800"
                  >
                    <span className="font-medium text-slate-200">{p.name}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      Updated {new Date(p.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function AppMockup() {
  const years = ["2023A", "2024E", "2025E", "2026E", "2027E"];
  const rows = [
    { label: "Revenue", values: [12500, 13200, 13900, 14600, 15400] },
    { label: "COGS", values: [-7200, -7600, -8000, -8400, -8800] },
    { label: "Gross Profit", values: [5300, 5600, 5900, 6200, 6600] },
    { label: "SG&A", values: [-2100, -2200, -2300, -2400, -2500] },
    { label: "EBIT", values: [3200, 3400, 3600, 3800, 4100] },
  ];

  return (
    <div
      className="overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900 shadow-2xl"
      style={{ transform: "perspective(800px) rotateY(-2deg) rotateX(2deg)" }}
    >
      <div className="flex items-center gap-2 border-b border-slate-700/80 bg-slate-800/80 px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
        </div>
        <span className="ml-2 text-xs font-medium text-slate-400">Income Statement</span>
      </div>
      <div className="p-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[280px] text-xs">
            <thead>
              <tr>
                <th className="pb-2 pr-4 text-left font-medium text-slate-500"></th>
                {years.map((y) => (
                  <th key={y} className="pb-2 text-right font-medium text-slate-500">
                    {y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td className="py-1 pr-4 text-slate-300">{row.label}</td>
                  {row.values.map((v, i) => (
                    <td key={i} className="py-1 text-right text-slate-300">
                      {v < 0 ? `(${Math.abs(v)})` : v.toLocaleString()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 h-16 rounded-lg bg-slate-800/80 flex items-center justify-center">
          <LineChart className="h-8 w-8 text-blue-500/70" />
        </div>
        <div className="mt-3 rounded-lg bg-blue-600/90 px-3 py-2 text-right">
          <span className="text-sm font-semibold text-white">
            Enterprise Value: $15,420M
          </span>
        </div>
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
    <div className="rounded-xl border border-slate-700/80 bg-slate-800/50 p-6 shadow-lg transition hover:border-slate-600/80">
      <div className="mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-slate-400">{description}</p>
    </div>
  );
}

function StepCard({
  step,
  icon,
  title,
  description,
}: {
  step: number;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-800/50 p-6 shadow-lg">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-sm font-bold text-white">
          {step}
        </span>
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-slate-400">{description}</p>
    </div>
  );
}

function ToolCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-800/40 p-6 transition hover:border-slate-600/80">
      <div className="mb-4">{icon}</div>
      <h3 className="font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-slate-400">{description}</p>
    </div>
  );
}
