"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useModelStore } from "@/store/useModelStore";
import SidebarSteps from "@/components/sidebar-steps";
import BuilderPanel from "@/components/builder-panel";
import ExcelPreview from "@/components/excel-preview";
import ISBuildPreview from "@/components/is-build-preview";

export default function ProjectPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params?.id as string | undefined;

  const loadProject = useModelStore((s) => s.loadProject);
  const saveCurrentProject = useModelStore((s) => s.saveCurrentProject);
  const projectStates = useModelStore((s) => s.projectStates);
  const projects = useModelStore((s) => s.projects);
  const isInitialized = useModelStore((s) => s.isInitialized);
  const recalculateAll = useModelStore((s) => s.recalculateAll);
  const hasHydrated = useModelStore((s) => s._hasHydrated);
  const currentProjectId = useModelStore((s) => s.currentProjectId);
  const currentStepId = useModelStore((s) => s.currentStepId);

  const [mounted, setMounted] = useState(false);
  const [loadAttempted, setLoadAttempted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load project once when ready
  useEffect(() => {
    if (!mounted || !projectId || loadAttempted) return;
    
    // Wait a bit for hydration, but don't wait forever
    const checkAndLoad = () => {
      const snapshot = projectStates[projectId];
      if (!snapshot) {
        console.log("Project snapshot not found, redirecting...");
        router.replace("/");
        return;
      }
      
      // If project is already loaded and initialized, we're good
      if (currentProjectId === projectId && isInitialized) {
        return;
      }
      
      console.log("Loading project:", projectId);
      setLoadAttempted(true);
      loadProject(projectId);
    };

    // Try immediately, then retry after a short delay if needed
    checkAndLoad();
    const timer = setTimeout(checkAndLoad, 200);
    return () => clearTimeout(timer);
  }, [mounted, projectId, projectStates, currentProjectId, isInitialized, loadProject, router, loadAttempted]);

  useEffect(() => {
    if (!mounted || !isInitialized) return;
    const t = setTimeout(() => recalculateAll(), 100);
    return () => clearTimeout(t);
  }, [mounted, isInitialized, recalculateAll]);

  const handleBackToProjects = () => {
    saveCurrentProject();
    router.push("/");
  };

  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-slate-400">Invalid project ID</div>
      </div>
    );
  }

  const snapshot = projectStates[projectId];
  if (!snapshot) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-slate-400">Project not found. Redirecting...</div>
      </div>
    );
  }

  // Show loading if we haven't loaded the project yet
  if (!isInitialized || currentProjectId !== projectId) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-slate-400">Loading project...</div>
      </div>
    );
  }

  const projectName = projects.find((p) => p.id === projectId)?.name ?? "Project";

  return (
    <main className="h-screen w-screen overflow-hidden flex flex-col">
      <div className="flex-shrink-0 flex items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-3 py-2">
        <button
          type="button"
          onClick={handleBackToProjects}
          className="text-sm text-slate-400 hover:text-slate-200 transition"
        >
          ← Projects
        </button>
        <span className="text-slate-600">|</span>
        <span className="text-sm font-medium text-slate-200 truncate">{projectName}</span>
      </div>
      <div className="flex-1 grid grid-cols-[260px_1fr] min-h-0">
        <SidebarSteps />
        <div className="h-full w-full p-4 overflow-hidden">
          <div className="h-full grid grid-cols-[40%_60%] gap-4 overflow-hidden">
            <BuilderPanel />
            {currentStepId === "is_build" ? (
              <ISBuildPreview />
            ) : (
              <ExcelPreview />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
