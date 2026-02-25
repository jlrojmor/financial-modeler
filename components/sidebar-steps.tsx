"use client";

import { useModelStore } from "@/store/useModelStore";
import { WIZARD_STEPS } from "@/types/finance";

export default function SidebarSteps() {
  const currentStepId = useModelStore((s) => s.currentStepId);
  const completed = useModelStore((s) => s.completedStepIds);
  const goToStep = useModelStore((s) => s.goToStep);

  return (
    <aside className="h-full w-full border-r border-slate-800 bg-slate-950 p-4">
      <div className="mb-4">
        <div className="text-sm font-semibold text-slate-100">
          Financial Model Builder
        </div>
        <div className="text-xs text-slate-400">
          Guided build (IB-style)
        </div>
      </div>

      <div className="space-y-2">
        {WIZARD_STEPS.map((step) => {
          const isActive = step.id === currentStepId;
          const isDone = completed.includes(step.id);
          const isInProgress = isActive && !isDone;

          return (
            <button
              key={step.id}
              onClick={() => goToStep(step.id)}
              className={[
                "w-full rounded-md border px-3 py-2 text-left transition",
                isActive
                  ? "border-slate-600 bg-slate-900"
                  : "border-slate-900 bg-slate-950 hover:bg-slate-900/60",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-100">
                  {step.label}
                </div>

                <div
                  className={[
                    "text-[10px] px-2 py-0.5 rounded-full",
                    isDone
                      ? "bg-emerald-600/20 text-emerald-300 border border-emerald-700/40"
                      : isInProgress
                        ? "bg-amber-600/20 text-amber-300 border border-amber-700/40"
                        : "bg-slate-800/40 text-slate-400 border border-slate-700/30",
                  ].join(" ")}
                >
                  {isDone ? "Done" : isInProgress ? "In progress" : "Pending"}
                </div>
              </div>

              <div className="mt-1 text-[11px] leading-snug text-slate-400">
                {step.description}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}