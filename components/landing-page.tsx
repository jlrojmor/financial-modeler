"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useModelStore } from "@/store/useModelStore";
import ModelSetup from "@/components/model-setup";
import type { ModelMeta } from "@/store/useModelStore";

export default function LandingPage() {
  const router = useRouter();
  const projects = useModelStore((s) => s.projects);
  const createProject = useModelStore((s) => s.createProject);
  const isInitialized = useModelStore((s) => s.isInitialized);
  const meta = useModelStore((s) => s.meta);
  const hasHydrated = useModelStore((s) => s._hasHydrated);
  const loadProject = useModelStore((s) => s.loadProject);
  const projectStates = useModelStore((s) => s.projectStates);
  const currentProjectId = useModelStore((s) => s.currentProjectId);
  const [showNewProject, setShowNewProject] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Recovery: If we have initialized data but no projects, create one from current state
  useEffect(() => {
    if (!mounted || !hasHydrated) return;
    
    if (isInitialized && meta && (!projects || projects.length === 0)) {
      // We have data but no projects - create one from current state (recovery)
      const name = meta.companyName?.trim() || "Untitled";
      createProject(name, meta, { fromCurrentState: true });
    }
  }, [mounted, hasHydrated, isInitialized, projects, meta, createProject]);

  const handleCreateProject = (meta: ModelMeta) => {
    const name = meta.companyName?.trim() || "Untitled";
    const id = createProject(name, meta);
    router.push(`/project/${id}`);
  };

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (showNewProject) {
    return (
      <div className="min-h-screen bg-slate-950 p-4">
        <div className="mx-auto max-w-2xl">
          <button
            type="button"
            onClick={() => setShowNewProject(false)}
            className="mb-4 text-sm text-slate-400 hover:text-slate-200"
          >
            ← Back to projects
          </button>
          <ModelSetup onCreateProject={handleCreateProject} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Hero / IB-style header */}
      <div className="border-b border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 px-6 py-12 md:py-16">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
            Financial Model Builder
          </h1>
          <p className="mt-3 text-lg text-slate-400">
            Build IB-style financial models with guided steps. Income statement, balance sheet,
            cash flow, and real-time Excel-style preview — all in one place.
          </p>
          <ul className="mt-6 grid gap-2 text-sm text-slate-300 md:grid-cols-2">
            <li className="flex items-center gap-2">
              <span className="text-emerald-500">✓</span>
              Guided build (Historicals → IS → BS → CFS → Projections)
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-500">✓</span>
              Real-time Excel preview &amp; download
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-500">✓</span>
              Multiple projects — save and switch without losing progress
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-500">✓</span>
              DCF, LBO, and startup model types
            </li>
          </ul>
        </div>
      </div>

      {/* Actions */}
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => setShowNewProject(true)}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-emerald-500 transition"
          >
            + New project
          </button>
          <span className="text-slate-500">or open a saved project below</span>
        </div>

        {/* Saved projects */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Saved projects
          </h2>
          {projects.length === 0 ? (
            <p className="mt-4 text-slate-500">
              No projects yet. Create one to get started.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/project/${p.id}`)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-3 text-left transition hover:border-slate-600 hover:bg-slate-800/50"
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
      </div>
    </div>
  );
}
