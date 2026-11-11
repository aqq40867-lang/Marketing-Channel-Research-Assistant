"use client";
import Link from "next/link";
import { downloadText, researchToMarkdown } from "@/lib/markdown";
import { store, useStoreVersion } from "@/lib/storage";
import { STATUS_LABEL } from "@/lib/types";

const STATUS_COLOR: Record<string, string> = {
  done: "bg-emerald-50 text-emerald-700",
  partial: "bg-amber-50 text-amber-800",
  failed: "bg-red-50 text-red-700",
  incomplete: "bg-slate-100 text-slate-600",
  running: "bg-blue-50 text-blue-700",
};

export default function HistoryPage() {
  const v = useStoreVersion();
  const list = v >= 0 ? store.listResearches() : [];

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">History</h1>
      <p className="mb-4 text-sm text-slate-500">All research is stored in this browser. Clearing browser data will delete it, so export important results as Markdown.</p>
      {list.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">No research yet.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Time</th>
                <th className="px-4 py-2.5 font-medium">Product</th>
                <th className="px-4 py-2.5 font-medium">Market</th>
                <th className="px-4 py-2.5 font-medium">Recommended</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{new Date(r.createdAt).toLocaleString("en-GB")}</td>
                  <td className="max-w-xs truncate px-4 py-2.5">{r.input.productName || r.input.product}</td>
                  <td className="px-4 py-2.5">{r.input.market}</td>
                  <td className="px-4 py-2.5 tabular-nums">{r.channels.length}</td>
                  <td className="px-4 py-2.5">
                    <span className={`badge ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <Link className="mr-3 text-brand hover:underline" href={`/?id=${r.id}`}>
                      Open
                    </Link>
                    <button
                      className="mr-3 text-slate-600 hover:underline"
                      onClick={() => downloadText(`channel-research_${r.createdAt.slice(0, 10)}_${r.id}.md`, researchToMarkdown(r, store.listDrafts(r.id)))}
                    >
                      Export
                    </button>
                    <button
                      className="text-red-600 hover:underline"
                      onClick={() => {
                        if (window.confirm("Delete this research and its email drafts? Entries on the follow-up board will be kept.")) store.deleteResearch(r.id);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
