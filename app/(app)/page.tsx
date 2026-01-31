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
  const [isHydrated, setIsHydrated] = useState(false);

  // Wait for client-side hydration
  useEffect(() => {
    setIsMounted(true);
    // Give Zustand persist middleware time to hydrate
    const timer = setTimeout(() => {
      setIsHydrated(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Recalculate all values when component mounts and store is hydrated
  useEffect(() => {
    if (isMounted && isHydrated && isInitialized) {
      // Small delay to ensure store is fully hydrated
      setTimeout(() => {
        recalculateAll();
      }, 100);
    }
  }, [isMounted, isHydrated, isInitialized, recalculateAll]);

  // Show loading state while mounting or while store is hydrating (prevents hydration mismatch)
  if (!isMounted || !isHydrated) {
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
    <main className="h-screen w-screen overflow-hidden">
      <div className="h-full w-full grid grid-cols-[260px_1fr]">
        <SidebarSteps />

        <div className="h-full w-full p-4 overflow-hidden">
          <div className="h-full grid grid-cols-[40%_60%] gap-4 overflow-hidden">
            <BuilderPanel />
            <ExcelPreview />
          </div>
        </div>
      </div>
    </main>
  );
}