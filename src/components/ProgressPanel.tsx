import type { StepProgress } from "@/lib/types";
import { STEP_LABEL } from "@/lib/types";

const ICON: Record<StepProgress["state"], string> = {
  pending: "○",
  active: "◌",
  done: "✓",
  skipped: "↺",
  error: "✕",
};
const COLOR: Record<StepProgress["state"], string> = {
  pending: "text-slate-300",
  active: "text-brand animate-pulse",
  done: "text-emerald-600",
  skipped: "text-slate-500",
  error: "text-red-600",
};

export function ProgressPanel({ steps }: { steps: StepProgress[] }) {
  return (
    <ol className="card divide-y divide-slate-100">
      {steps.map((s) => (
        <li key={s.step} className="flex items-start gap-3 px-4 py-2.5 text-sm">
          <span className={`mt-0.5 w-4 text-center font-bold ${COLOR[s.state]}`}>{ICON[s.state]}</span>
          <span className="w-20 shrink-0 font-medium text-slate-700">{STEP_LABEL[s.step]}</span>
          <span className={s.state === "error" ? "text-red-600" : "text-slate-500"}>{s.detail || (s.state === "pending" ? "Waiting" : "")}</span>
        </li>
      ))}
    </ol>
  );
}
