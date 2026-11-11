"use client";
import { useState } from "react";
import type { Channel, Check } from "@/lib/types";
import { CHANNEL_TYPE_LABEL, CHECK_LABEL, PAID_LABEL } from "@/lib/types";

const ANSWER: Record<string, string> = { yes: "Yes", no: "No", unclear: "Unclear" };

/** Link with a text fragment: in supporting browsers the quote is highlighted when opened */
export function quoteLink(url: string, quote: string): string {
  const q = quote.trim().replace(/\s+/g, " ").slice(0, 80).replace(/\s\S*$/, "");
  if (!q) return url;
  return `${url.split("#")[0]}#:~:text=${encodeURIComponent(q)}`;
}

function CheckRow({ c }: { c: Check }) {
  const confirmed = c.verified;
  return (
    <li className={`rounded-md px-2.5 py-1.5 ${confirmed ? "" : "bg-amber-50"}`}>
      <div className="flex items-center gap-2">
        <span className="text-slate-500">{CHECK_LABEL[c.key]}</span>
        <span className="font-medium">{ANSWER[c.answer]}</span>
        <span className="flex-1" />
        <span className={`badge ${confirmed ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
          {confirmed ? "Verified" : "Unverified"}
        </span>
      </div>
      {c.note && <p className="mt-0.5 text-xs text-slate-500">{c.note}</p>}
      {c.quote && (
        <p className="mt-0.5 text-xs italic leading-snug text-slate-600">
          “{c.quote}”{" "}
          <a className="not-italic text-brand hover:underline" href={quoteLink(c.sourceUrl, c.quote)} target="_blank" rel="noreferrer">
            Source ↗
          </a>
        </p>
      )}
    </li>
  );
}

export function ChannelCard({
  channel,
  index,
  onWriteEmail,
  onAddLead,
  inLeads,
  hasDraft,
}: {
  channel: Channel;
  index: number;
  onWriteEmail: () => void;
  onAddLead: () => void;
  inLeads: boolean;
  hasDraft: boolean;
}) {
  const [reviewed, setReviewed] = useState(false);
  const c = channel;
  const unconfirmed = c.checks.filter((x) => !x.verified).length + c.evidence.filter((e) => !e.verified).length;
  return (
    <article className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">#{index + 1} · Score {c.scores.total}</p>
          <h3 className="text-lg font-semibold leading-snug">{c.name}</h3>
          <a href={c.url} target="_blank" rel="noreferrer" className="block truncate text-sm text-brand hover:underline">
            {c.url}
          </a>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="badge bg-slate-100 text-slate-700">{CHANNEL_TYPE_LABEL[c.type]}</span>
          <span
            className={`badge ${c.paid === "paid" ? "bg-violet-50 text-violet-700" : c.paid === "free" ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-800"}`}
          >
            {PAID_LABEL[c.paid]}
          </span>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-slate-700">
        <span className="font-medium text-slate-900">Why it fits: </span>
        {c.reason}
      </p>

      <h4 className="mt-4 mb-1 text-xs font-semibold tracking-wide text-slate-500">Key checks</h4>
      <ul className="space-y-1 text-sm">
        {c.checks.map((k) => (
          <CheckRow key={k.key} c={k} />
        ))}
      </ul>

      {c.evidence.length > 0 && (
        <>
          <h4 className="mt-4 mb-1 text-xs font-semibold tracking-wide text-slate-500">Evidence</h4>
          <ul className="space-y-1.5 text-sm">
            {c.evidence.map((e, i) => (
              <li key={i} className={`rounded-md px-2.5 py-1.5 ${e.verified ? "" : "bg-amber-50"}`}>
                <div className="flex items-start gap-2">
                  <span className={`badge mt-0.5 shrink-0 ${e.verified ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                    {e.verified ? "Verified" : "Unverified"}
                  </span>
                  <div>
                    <p>{e.claim}</p>
                    <p className="text-xs italic text-slate-600">
                      “{e.quote}”{" "}
                      <a className="not-italic text-brand hover:underline" href={quoteLink(e.sourceUrl, e.quote)} target="_blank" rel="noreferrer">
                        Source ↗
                      </a>
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {c.recentTitles.some((t) => t.verified) && (
        <>
          <h4 className="mt-4 mb-1 text-xs font-semibold tracking-wide text-slate-500">Recent content (for opening the email)</h4>
          <ul className="list-disc pl-5 text-sm text-slate-600">
            {c.recentTitles.filter((t) => t.verified).map((t) => (
              <li key={t.title}>{t.title}</li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-auto pt-4">
        {unconfirmed > 0 && <p className="mb-2 text-xs text-amber-700">{unconfirmed} item(s) unverified (yellow). Open the source to check before reaching out.</p>}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <button className="btn-primary" onClick={onWriteEmail}>
            {hasDraft ? "View email draft" : "Write email for this channel"}
          </button>
          {inLeads ? (
            <span className="badge bg-emerald-50 text-emerald-700">On follow-up board</span>
          ) : (
            <>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                I've reviewed the evidence
              </label>
              <button className="btn-ghost" disabled={!reviewed} onClick={onAddLead} title={reviewed ? "" : "Open the evidence links to check them first, then tick “I've reviewed the evidence”"}>
                Add to follow-up
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
