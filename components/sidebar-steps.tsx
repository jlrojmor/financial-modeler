"use client";

import React from "react";
import { useModelStore } from "@/store/useModelStore";
import { WIZARD_STEPS } from "@/types/finance";
import { CheckCircle2, Circle } from "lucide-react";

export default function SidebarSteps() {
  const current = useModelStore((s) => s.currentStepId);
  const completed = useModelStore((s) => s.completedStepIds);
  const goToStep = useModelStore((s) => s.goToStep);

  return (
    <aside className="h-full w-full border-r border-slate-800 bg-slate-950 px-3 py-4">
      <div className="px-2 pb-4">
        <div className="text-xs font-semibold tracking-wide text-slate-300">
          MODEL BUILDER
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          Guided steps • IB-style • Inputs blue
        </div>
      </div>

      <nav className="space-y-1">
        {WIZARD_STEPS.map((s) => {
          const isDone = completed.includes(s.id);
          const isActive = current === s.id;

          return (
            <button
              key={s.id}
              onClick={() => goToStep(s.id)}
              className={[
                "w-full rounded-md px-2 py-2 text-left text-sm transition",
                isActive
                  ? "bg-slate-900 text-slate-100"
                  : "text-slate-300 hover:bg-slate-900/60",
              ].join(" ")}
            >
              <div className="flex items-center gap-2">
                {isDone ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Circle className="h-4 w-4 text-slate-600" />
                )}
                <span className="text-sm">{s.label}</span>
              </div>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}