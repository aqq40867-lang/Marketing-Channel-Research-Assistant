"use client";
import { useState } from "react";
import { funnel } from "@/lib/leadStats";
import { store, useStoreVersion } from "@/lib/storage";
import type { FailReason } from "@/lib/types";
import { FAIL_REASON_LABEL, STAGE_LABEL } from "@/lib/types";

type SourceFilter = "all" | "tool" | "manual";

export default function StatsPage() {
  const v = useStoreVersion();
  const [src, setSrc] = useState<SourceFilter>("all");
  const all = v >= 0 ? store.listLeads() : [];
  const leads = src === "all" ? all : all.filter((l) => l.source === src);

  // Reached a stage = the highest stage reached is at or after it (moving back or restoring from failed never reduces this)
  const { reached, current, sent, won } = funnel(leads);
  const failed = leads.filter((l) => l.failed);
  const reasons = (Object.keys(FAIL_REASON_LABEL) as FailReason[])
    .map((r) => ({ r, n: failed.filter((l) => l.failReason === r).length }))
    .sort((a, b) => b.n - a.n);
  const maxReached = Math.max(1, ...reached.map((x) => x.n));
  const maxReason = Math.max(1, ...reasons.map((x) => x.n));
  const mismatch = reasons.find((x) => x.r === "audience_mismatch")?.n ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Statistics</h1>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {(["all", "tool", "manual"] as SourceFilter[]).map((s) => (
            <button key={s} onClick={() => setSrc(s)} className={`rounded-md px-3 py-1 ${src === s ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>
              {s === "all" ? "All" : s === "tool" ? "Recommended" : "Added manually"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Channels in follow-up" value={leads.length} />
        <Stat label="Sent" value={sent} />
        <Stat label="Won" value={won} />
        <Stat label="Overall conversion (Won ÷ Sent)" value={sent ? `${Math.round((won / sent) * 100)}%` : "—"} hint={sent ? `${won} / ${sent}` : "No channels sent yet"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-1 font-semibold">Funnel: channels that reached each stage</h2>
          <p className="mb-4 text-xs text-slate-500">Counted by the highest stage reached, so moving back doesn't reduce it; failed channels count at the highest stage they reached before failing</p>
          <ul className="space-y-2.5">
            {reached.map(({ s, n }, i) => (
              <li key={s} className="grid grid-cols-[64px_1fr_72px] items-center gap-3 text-sm">
                <span className="text-slate-600">{STAGE_LABEL[s]}</span>
                <div className="h-6 rounded bg-slate-100">
                  <div className="h-6 rounded bg-brand" style={{ width: `${(n / maxReached) * 100}%`, opacity: 1 - i * 0.13 }} />
                </div>
                <span className="text-right tabular-nums">
                  {n}
                  <span className="ml-1 text-xs text-slate-400">(now {current[i].n})</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-5">
          <h2 className="mb-1 font-semibold">Failure reasons</h2>
          <p className="mb-4 text-xs text-slate-500">{failed.length} failed in total</p>
          {failed.length === 0 ? (
            <p className="text-sm text-slate-400">No failures yet</p>
          ) : (
            <ul className="space-y-2.5">
              {reasons.map(({ r, n }) => (
                <li key={r} className="grid grid-cols-[112px_1fr_32px] items-center gap-3 text-sm">
                  <span className="text-slate-600">{FAIL_REASON_LABEL[r]}</span>
                  <div className="h-5 rounded bg-slate-100">
                    <div className={`h-5 rounded ${r === "audience_mismatch" ? "bg-amber-500" : "bg-red-400"}`} style={{ width: `${(n / maxReason) * 100}%` }} />
                  </div>
                  <span className="text-right tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          )}
          {mismatch > 0 && mismatch >= failed.length / 3 && (
            <p className="mt-4 rounded-md bg-amber-50 p-2.5 text-xs text-amber-900">
              “Audience mismatch” accounts for {Math.round((mismatch / failed.length) * 100)}% of failures: the research may be judging audiences too loosely. Try describing your target customers more specifically, or read the “Audience match” quote more carefully before adding to follow-up.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
