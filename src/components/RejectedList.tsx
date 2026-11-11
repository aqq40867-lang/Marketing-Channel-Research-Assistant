"use client";
import { useState } from "react";
import type { RejectedCandidate } from "@/lib/types";

export function RejectedList({ items }: { items: RejectedCandidate[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <button className="text-sm text-brand hover:underline" onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Show"} {items.length} excluded candidate(s) and why
      </button>
      {open && (
        <ul className="card mt-2 divide-y divide-slate-100 text-sm">
          {items.map((r, i) => (
            <li key={i} className="px-4 py-2.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{r.name}</span>
                <a href={r.url} target="_blank" rel="noreferrer" className="truncate text-xs text-brand hover:underline">
                  {r.url}
                </a>
              </div>
              <p className="text-slate-500">{r.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
