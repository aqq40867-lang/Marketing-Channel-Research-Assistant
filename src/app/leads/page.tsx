"use client";
import Link from "next/link";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { addLead, moveLead, now, store, useStoreVersion } from "@/lib/storage";
import { safeUrl } from "@/lib/text";
import type { ChannelType, FailReason, Lead, LeadStage } from "@/lib/types";
import { CHANNEL_TYPE_LABEL, FAIL_REASON_LABEL, STAGE_LABEL, STAGES } from "@/lib/types";

export default function LeadsPage() {
  const v = useStoreVersion();
  const leads = v >= 0 ? store.listLeads() : [];
  const [showAdd, setShowAdd] = useState(false);
  const active = leads.filter((l) => !l.failed);
  const failed = leads.filter((l) => l.failed);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Follow-up board</h1>
          <p className="text-sm text-slate-500">Move channels through stages by hand as things progress; you can mark one as failed at any stage and record why.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>
          + Add channel manually
        </button>
      </div>

      {leads.length === 0 && (
        <div className="card p-8 text-center text-sm text-slate-500">
          No channels in follow-up yet. On a research result card, tick “I've reviewed the evidence” and click “Add to follow-up”, or add one manually.
        </div>
      )}

      {leads.length > 0 && (
        <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-3 xl:grid-cols-6">
          {STAGES.map((s) => (
            <Column key={s} title={STAGE_LABEL[s]} count={active.filter((l) => l.stage === s).length}>
              {active
                .filter((l) => l.stage === s)
                .map((l) => (
                  <LeadCard key={l.url} lead={l} />
                ))}
            </Column>
          ))}
          <Column title="Failed" count={failed.length} tone="red">
            {failed.map((l) => (
              <LeadCard key={l.url} lead={l} />
            ))}
          </Column>
        </div>
      )}

      <AddLeadModal open={showAdd} onClose={() => setShowAdd(false)} />
    </div>
  );
}

function Column({ title, count, children, tone }: { title: string; count: number; children: React.ReactNode; tone?: "red" }) {
  return (
    <section className={`min-w-48 rounded-xl p-2 ${tone === "red" ? "bg-red-50/60" : "bg-slate-100/70"}`}>
      <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-slate-700">
        {title}
        <span className="rounded-full bg-white px-2 text-xs font-normal text-slate-500">{count}</span>
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  const [open, setOpen] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const [notes, setNotes] = useState(lead.notes);
  const idx = STAGES.indexOf(lead.stage);
  const next = STAGES[idx + 1];
  const draft = lead.researchId
    ? store.listDrafts(lead.researchId).find((d) => safeUrl(d.channelUrl)?.hostname.replace(/^www\./, "") === lead.url)
    : undefined;

  const saveNotes = () => {
    if (notes === lead.notes) return;
    store.saveLead({ ...lead, notes, history: [...lead.history, { at: now(), action: "Notes updated" }] });
  };

  return (
    <div className="card p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{lead.name}</p>
          <a href={lead.link} target="_blank" rel="noreferrer" className="block truncate text-xs text-brand hover:underline">
            {lead.url}
          </a>
        </div>
        <span className={`badge shrink-0 ${lead.source === "tool" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
          {lead.source === "tool" ? "Recommended" : "Added manually"}
        </span>
      </div>
      {lead.type && <p className="mt-1 text-xs text-slate-500">{CHANNEL_TYPE_LABEL[lead.type]}</p>}
      {lead.failed && (
        <p className="mt-2 rounded bg-red-100 px-2 py-1 text-xs text-red-700">
          Failed at “{STAGE_LABEL[lead.stage]}”: {lead.failReason ? FAIL_REASON_LABEL[lead.failReason] : ""}
          {lead.failNote ? ` (${lead.failNote})` : ""}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {!lead.failed && next && (
          <button className="btn-primary px-2 py-1 text-xs" onClick={() => moveLead(lead, next)}>
            → {STAGE_LABEL[next]}
          </button>
        )}
        <select
          className="rounded-md border border-slate-300 px-1.5 py-1 text-xs"
          value={lead.failed ? "" : lead.stage}
          onChange={(e) => e.target.value && moveLead(lead, e.target.value as LeadStage)}
        >
          {lead.failed && <option value="">Restore to…</option>}
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
        {!lead.failed && (
          <button className="btn-danger px-2 py-1 text-xs" onClick={() => setFailOpen(true)}>
            Mark failed
          </button>
        )}
        <button className="text-xs text-slate-500 hover:text-slate-800" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Details"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-2">
          <textarea className="input min-h-16 text-xs" placeholder="Notes: contact person, their requirements, etc." value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} />
          <div className="flex flex-wrap gap-3 text-xs">
            {lead.researchId && (
              <Link className="text-brand hover:underline" href={`/?id=${lead.researchId}`}>
                Open research results
              </Link>
            )}
            {lead.researchId && draft && (
              <Link className="text-brand hover:underline" href={`/?id=${lead.researchId}&draft=${encodeURIComponent(draft.channelUrl)}`}>
                Open email draft
              </Link>
            )}
            <button
              className="text-red-600 hover:underline"
              onClick={() => {
                if (window.confirm(`Remove “${lead.name}” from the board? It will appear in research candidates again.`)) store.deleteLead(lead.url);
              }}
            >
              Delete
            </button>
          </div>
          <ol className="space-y-0.5 text-xs text-slate-500">
            {[...lead.history].reverse().map((h, i) => (
              <li key={i}>
                <span className="text-slate-400">{new Date(h.at).toLocaleString("en-GB")}</span> {h.action}
              </li>
            ))}
          </ol>
        </div>
      )}

      <FailModal open={failOpen} lead={lead} onClose={() => setFailOpen(false)} />
    </div>
  );
}

function FailModal({ open, lead, onClose }: { open: boolean; lead: Lead; onClose: () => void }) {
  const [reason, setReason] = useState<FailReason>("no_reply");
  const [note, setNote] = useState("");
  const submit = () => {
    if (reason === "other" && !note.trim()) return;
    store.saveLead({
      ...lead,
      failed: true,
      failReason: reason,
      failNote: note.trim() || undefined,
      history: [...lead.history, { at: now(), action: `Marked failed at “${STAGE_LABEL[lead.stage]}”: ${FAIL_REASON_LABEL[reason]}${note ? ` (${note})` : ""}` }],
    });
    onClose();
  };
  return (
    <Modal
      open={open}
      title={`Mark failed: ${lead.name}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-danger" onClick={submit} disabled={reason === "other" && !note.trim()}>
            Confirm
          </button>
        </>
      }
    >
      <div className="space-y-1.5">
        {(Object.keys(FAIL_REASON_LABEL) as FailReason[]).map((r) => (
          <label key={r} className="flex items-center gap-2">
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
            {FAIL_REASON_LABEL[r]}
          </label>
        ))}
        <input className="input mt-2" placeholder={reason === "other" ? "Enter a reason (required)" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

function AddLeadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState<ChannelType | "">("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const submit = () => {
    if (!name.trim()) return setErr("Enter a channel name.");
    if (!safeUrl(url)) return setErr("Invalid URL, e.g. https://example.co.uk.");
    const r = addLead({ name: name.trim(), url: url.trim(), type: type || undefined, source: "manual", notes });
    if (!r.ok) return setErr(r.reason === "duplicate" ? `This website is already on the board (${r.existing?.name}).` : "Save failed: could not write to browser storage.");
    setName("");
    setUrl("");
    setType("");
    setNotes("");
    setErr("");
    onClose();
  };
  return (
    <Modal
      open={open}
      title="Add channel manually"
      onClose={onClose}
      actions={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit}>
            Add
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Channel name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">URL *</label>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as ChannelType | "")}>
            <option value="">Uncategorised</option>
            {(Object.keys(CHANNEL_TYPE_LABEL) as ChannelType[]).map((t) => (
              <option key={t} value={t}>
                {CHANNEL_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Notes</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
    </Modal>
  );
}
