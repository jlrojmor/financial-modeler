"use client";

import { useEffect, useState } from "react";
import { useModelStore } from "@/store/useModelStore";
import SidebarSteps from "@/components/sidebar-steps";
import BuilderPanel from "@/components/builder-panel";
import ExcelPreview from "@/components/excel-preview";
import ModelSetup from "@/components/model-setup";

export default function Page() {
  const isInitialized = useModelStore((s) => s.isInitialized);
  const recalculateAll = useModelStore((s) => s.recalculateAll);
  const [isMounted, setIsMounted] = useState(false);

  // Wait for client-side hydration and recalculate on load
  useEffect(() => {
    setIsMounted(true);
    // Recalculate all values when component mounts (in case data was loaded from localStorage)
    if (isInitialized) {
      // Small delay to ensure store is fully hydrated
      setTimeout(() => {
        recalculateAll();
      }, 100);
    }
  }, [isInitialized, recalculateAll]);

  // Show loading state while mounting (prevents hydration mismatch)
  if (!isMounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  // Show setup screen if model hasn't been initialized
  if (!isInitialized) {
    return <ModelSetup />;
  }

  return (
    <main className="h-screen w-screen">
      <div className="h-full w-full grid grid-cols-[260px_1fr]">
        <SidebarSteps />

        <div className="h-full w-full p-4">
          <div className="h-full grid grid-cols-2 gap-4">
            <BuilderPanel />
            <ExcelPreview />
          </div>
        </div>
      </div>
    </main>
  );
}