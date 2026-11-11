"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { checkEmail, countEvidenceMarks, EVIDENCE_MARK_RE, hasBlockingIssues, stripEvidenceMarks } from "@/lib/emailCheck";
import { fillPlaceholders, fillValues, hasFillablePlaceholders, PROFILE_LABEL, type SenderProfile } from "@/lib/profile";
import { store, useStoreVersion } from "@/lib/storage";
import type { AppError, Channel, Draft, EvidenceRef, Flag, Research } from "@/lib/types";
import { ErrorBox } from "./ErrorBox";
import { Modal } from "./Modal";

type MarkLevel = Flag["level"] | "evidence";

/** Highlight red / yellow flagged snippets and [E1] evidence marks in the body (read-only preview). */
function Highlighted({ text, flags, evidence }: { text: string; flags: Flag[]; evidence: EvidenceRef[] }) {
  const parts = useMemo(() => {
    const marks = flags
      .filter((f) => f.kind !== "unsupported_claim")
      .map((f) => ({ f, re: new RegExp(f.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), f.kind === "sensitive" ? "gi" : "g") }));
    const ranges: { s: number; e: number; level: MarkLevel; title: string }[] = [];
    const evById = new Map(evidence.map((e) => [e.id.toUpperCase(), e]));
    for (const m of text.matchAll(new RegExp(EVIDENCE_MARK_RE.source, "g"))) {
      if (m.index === undefined) continue;
      const lead = m[0].length - m[0].trimStart().length; // don't highlight the space before the mark
      const id = m[0].trim().slice(1, -1).toUpperCase();
      const e = evById.get(id);
      ranges.push({
        s: m.index + lead,
        e: m.index + m[0].length,
        level: "evidence",
        title: e ? `${id}: “${e.quote}”\n${e.sourceUrl}` : `${id}: evidence not found in this draft`,
      });
    }
    for (const { f, re } of marks) {
      for (const m of text.matchAll(re)) {
        if (m.index === undefined) continue;
        if (f.kind === "sensitive") {
          const before = text[m.index - 1];
          const after = text[m.index + m[0].length];
          if ((before && /[a-z0-9]/i.test(before)) || (after && /[a-z0-9]/i.test(after))) continue;
        }
        ranges.push({ s: m.index, e: m.index + m[0].length, level: f.level, title: f.message });
      }
    }
    for (const f of flags.filter((x) => x.kind === "unsupported_claim")) {
      const i = text.indexOf(f.text);
      if (i >= 0) ranges.push({ s: i, e: i + f.text.length, level: "red", title: f.message });
    }
    ranges.sort((a, b) => a.s - b.s || (a.level === "red" ? -1 : 1));
    const out: { t: string; level?: MarkLevel; title?: string }[] = [];
    let pos = 0;
    for (const r of ranges) {
      if (r.s < pos) continue;
      if (r.s > pos) out.push({ t: text.slice(pos, r.s) });
      out.push({ t: text.slice(r.s, r.e), level: r.level, title: r.title });
      pos = r.e;
    }
    out.push({ t: text.slice(pos) });
    return out;
  }, [text, flags]);
  return (
    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
      {parts.map((p, i) =>
        p.level ? (
          <mark
            key={i}
            title={p.title}
            className={
              p.level === "red"
                ? "rounded bg-red-100 px-0.5 text-red-800"
                : p.level === "evidence"
                  ? "cursor-help rounded bg-sky-100 px-0.5 text-xs font-medium text-sky-800"
                  : "rounded bg-amber-100 px-0.5 text-amber-900"
            }
          >
            {p.t}
          </mark>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </pre>
  );
}

export function DraftEditor({
  research,
  channels,
  activeUrl,
  setActiveUrl,
}: {
  research: Research;
  channels: Channel[];
  activeUrl: string;
  setActiveUrl: (u: string) => void;
}) {
  useStoreVersion();
  const channel = channels.find((c) => c.url === activeUrl);
  const saved = channel ? store.getDraft(research.id, channel.url) : undefined;
  const [subject, setSubject] = useState(saved?.subject ?? "");
  const [body, setBody] = useState(saved?.body ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);
  const loadedFor = useRef<string>("");

  // Sender details (name, role) only replace placeholders locally and are never sent to the model; product name and URL come from the research input
  const profile = store.getProfile();
  const values = fillValues(profile, research.input);
  const senderTexts = [values.senderName, values.senderRole].filter(Boolean);

  // load the matching draft when switching channels
  useEffect(() => {
    if (!channel) return;
    if (loadedFor.current === channel.url) return;
    loadedFor.current = channel.url;
    const d = store.getDraft(research.id, channel.url);
    setSubject(d?.subject ?? "");
    setBody(d?.body ?? "");
    setError(null);
    setCopied(false);
  }, [channel, research.id]);

  // re-check live while editing
  const flags = useMemo(
    () =>
      saved
        ? checkEmail(subject, body, {
            input: research.input,
            allowedTexts: [...(saved.allowedTexts ?? []), ...senderTexts],
            factMap: saved.factMap,
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subject, body, saved, research.input, values.senderName, values.senderRole],
  );

  // autosave (600 ms after typing stops)
  useEffect(() => {
    if (!saved || !channel) return;
    if (saved.subject === subject && saved.body === body) return;
    const t = setTimeout(() => {
      store.saveDraft({ ...saved, subject, body, flags });
    }, 600);
    return () => clearTimeout(t);
  }, [subject, body, flags, saved, channel]);

  if (!channel) return null;

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: research.input, channel }),
        // the server limit is about 100 seconds; allow extra here, and show a clear message on timeout instead of spinning forever
        signal: AbortSignal.timeout(130_000),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? { code: "unknown", message: `Generation failed (HTTP ${res.status})`, suggestion: "Click “Retry”." });
        return;
      }
      // fill placeholders from the sender profile, then re-check the filled-in body
      const filledSubject = fillPlaceholders(data.draft.subject, values);
      const filledBody = fillPlaceholders(data.draft.body, values);
      const d: Draft = {
        researchId: research.id,
        channelUrl: channel.url,
        channelName: channel.name,
        subject: filledSubject,
        body: filledBody,
        flags: checkEmail(filledSubject, filledBody, {
          input: research.input,
          allowedTexts: [...(data.allowedTexts ?? []), ...senderTexts],
          factMap: data.draft.factMap,
        }),
        factMap: data.draft.factMap,
        rewriteNote: data.draft.rewriteNote,
        allowedTexts: data.allowedTexts,
        evidence: data.evidence ?? [],
        updatedAt: new Date().toISOString(),
      };
      store.saveDraft(d);
      setSubject(d.subject);
      setBody(d.body);
    } catch (e) {
      if (e instanceof DOMException && e.name === "TimeoutError") {
        setError({ code: "timeout", message: "Draft generation got no response for over 2 minutes.", suggestion: "Click “Retry” later; if it keeps happening, check the terminal logs." });
        return;
      }
      setError({ code: "network", message: `Cannot connect to the local server: ${e instanceof Error ? e.message : e}`, suggestion: "Make sure npm run dev is still running, then click “Retry”." });
    } finally {
      setLoading(false);
    }
  };

  const doCopy = async () => {
    const text = `Subject: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const { red, placeholders } = hasBlockingIssues(flags);
  const redFlags = flags.filter((f) => f.level === "red");
  const yellowFlags = flags.filter((f) => f.level === "yellow" && f.kind !== "placeholder");
  const phFlags = flags.filter((f) => f.kind === "placeholder");
  const draftsFor = new Set(store.listDrafts(research.id).map((d) => d.channelUrl));
  const canFill = hasFillablePlaceholders(`${subject}\n${body}`, values);
  const marks = countEvidenceMarks(`${subject}\n${body}`);
  const removeMarks = () => {
    setSubject(stripEvidenceMarks(subject));
    setBody(stripEvidenceMarks(body));
  };
  const fillNow = () => {
    setSubject(fillPlaceholders(subject, values));
    setBody(fillPlaceholders(body, values));
  };

  return (
    <section className="card p-5" id="draft-editor">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-base font-semibold">Outreach email</h2>
        {channels.map((c) => (
          <button
            key={c.url}
            onClick={() => setActiveUrl(c.url)}
            className={`rounded-full border px-3 py-1 text-xs ${c.url === activeUrl ? "border-brand bg-brand-soft text-brand" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            {c.name}
            {draftsFor.has(c.url) && " ✎"}
          </button>
        ))}
      </div>

      <ProfileCard profile={profile} />

      {!saved && !loading && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          <p>The AI only sees your input and verified evidence. Your name and role are filled in afterwards and never sent.</p>
          <button className="btn-primary mt-3" onClick={generate}>
            Generate draft
          </button>
        </div>
      )}
      {loading && <p className="animate-pulse rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500">Generating and checking the draft (about 10–30 seconds)…</p>}
      {error && <ErrorBox error={error} onRetry={generate} />}

      {saved && !loading && (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div>
            <label className="label">Subject</label>
            <input className="input mb-3" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <div className="mb-1 flex items-center justify-between">
              <label className="label mb-0">Body</label>
              <div className="flex items-center gap-3">
                {marks > 0 && (
                  <button className="text-xs text-sky-700 hover:underline" onClick={removeMarks} title="Remove every [E1]-style mark from the subject and body">
                    Remove evidence marks ({marks})
                  </button>
                )}
                <button className="text-xs text-brand hover:underline" onClick={() => setPreview(!preview)}>
                  {preview ? "Back to editing" : "Show flags & evidence"}
                </button>
              </div>
            </div>
            {marks > 0 && (
              <p className="mb-1 text-xs text-slate-500">
                Marks like <code className="rounded bg-sky-100 px-1 text-sky-800">[E1]</code> show which verified evidence a sentence relies on (hover them in “Show flags &amp; evidence”, or see the fact-check list). Check them, then remove them before sending.
              </p>
            )}
            {preview ? (
              <div className="min-h-80 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <Highlighted text={body} flags={flags} evidence={saved.evidence ?? []} />
              </div>
            ) : (
              <textarea className="input min-h-80 font-mono text-[13px] leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} />
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="btn-primary" onClick={() => (red || placeholders || marks ? setConfirmOpen(true) : doCopy())}>
                {copied ? "Copied ✓" : "Copy email"}
              </button>
              <button className="btn-ghost" onClick={generate}>
                Regenerate
              </button>
            </div>
          </div>

          <aside className="space-y-4 text-sm">
            {saved.rewriteNote && <p className="rounded-md bg-slate-50 p-2.5 text-xs text-slate-600">{saved.rewriteNote}</p>}
            <FlagGroup title={`Red (${redFlags.length})`} tone="red" flags={redFlags} empty="No unverified numbers or unsourced claims" />
            <FlagGroup title={`Yellow (${yellowFlags.length})`} tone="yellow" flags={yellowFlags} empty="No sensitive wording" />
            <div>
              <div className="mb-1 flex items-center justify-between">
                <h4 className="font-semibold">Placeholders ({phFlags.length})</h4>
                {canFill && (
                  <button className="text-xs text-brand hover:underline" onClick={fillNow}>
                    Fill from sender details
                  </button>
                )}
              </div>
              {phFlags.length ? (
                <div className="flex flex-wrap gap-1">
                  {phFlags.map((f) => (
                    <code key={f.text} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                      {f.text}
                    </code>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-emerald-700">All filled in</p>
              )}
            </div>
            <div>
              <h4 className="mb-1 font-semibold">Fact-check list</h4>
              {saved.factMap.length === 0 && <p className="text-xs text-slate-500">The model listed no factual claims. Read the whole email and check it yourself.</p>}
              <ul className="space-y-2">
                {saved.factMap.map((f, i) => (
                  <li key={i} className={`rounded-md p-2 text-xs ${f.ok ? "bg-slate-50" : "bg-red-50"}`}>
                    <p className="text-slate-800">
                      {f.ok ? "✓" : "✕"}{" "}
                      {f.id && <code className="rounded bg-sky-100 px-1 text-sky-800">[{f.id}]</code>} {f.claim}
                    </p>
                    {!f.ok && f.reason && <p className="mt-0.5 text-red-600">{f.reason}</p>}
                    <p className="mt-0.5 text-slate-500">
                      ←{" "}
                      {f.source === "user_input" ? (
                        <>Your input “{f.ref}”: {f.refText}</>
                      ) : f.ok ? (
                        <>
                          “{f.refText}”{" "}
                          <a href={f.ref} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                            Evidence link ↗
                          </a>
                        </>
                      ) : (
                        <span className="text-red-600">{f.refText}</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      )}

      <Modal
        open={confirmOpen}
        title="The email still has issues to fix"
        onClose={() => setConfirmOpen(false)}
        actions={
          <>
            <button className="btn-ghost" onClick={() => setConfirmOpen(false)}>
              Go back and edit
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setConfirmOpen(false);
                doCopy();
              }}
            >
              I've checked, copy anyway
            </button>
          </>
        }
      >
        <ul className="list-disc space-y-1 pl-5">
          {red > 0 && <li>{red} red flag(s): possibly made-up numbers or unsourced claims.</li>}
          {placeholders > 0 && <li>{placeholders} placeholder(s) not filled in: {phFlags.map((f) => f.text).join(" ")}</li>}
          {marks > 0 && (
            <li>
              {marks} evidence mark(s) like [E1] are still in the email.{" "}
              <button
                className="text-brand hover:underline"
                onClick={() => {
                  removeMarks();
                  if (!red && !placeholders) setConfirmOpen(false);
                }}
              >
                Remove them now
              </button>
            </li>
          )}
        </ul>
      </Modal>
    </section>
  );
}

function FlagGroup({ title, tone, flags, empty }: { title: string; tone: "red" | "yellow"; flags: Flag[]; empty: string }) {
  return (
    <div>
      <h4 className={`mb-1 font-semibold ${tone === "red" ? "text-red-700" : "text-amber-700"}`}>{title}</h4>
      {flags.length === 0 ? (
        <p className="text-xs text-emerald-700">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {flags.map((f, i) => (
            <li key={i} className={`rounded-md p-2 text-xs ${tone === "red" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
              {f.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Sender details: entered once and stored locally; later emails fill the signature placeholders automatically. */
function ProfileCard({ profile }: { profile: SenderProfile }) {
  const keys = Object.keys(PROFILE_LABEL) as (keyof SenderProfile)[];
  const filled = keys.filter((k) => profile[k].trim()).length;
  const set = (k: keyof SenderProfile, v: string) => store.saveProfile({ ...profile, [k]: v });
  // Decide the default open state once on mount; afterwards it is controlled by the user only.
  // (Binding `open` to `filled === 0` collapsed the panel as soon as the first character was typed.)
  const [open, setOpen] = useState(() => filled === 0);
  return (
    <details
      className="mb-4 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-2.5 text-sm"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer select-none text-slate-700">
        <span className="font-medium">Sender details</span>
        <span className={`ml-2 text-xs ${filled === keys.length ? "text-emerald-700" : "text-amber-700"}`}>
          {filled === keys.length ? "Filled in" : `${filled}/${keys.length} filled`}
        </span>
        <span className="ml-2 text-xs text-slate-400">Fill in once; future emails use it in the signature</span>
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {keys.map((k) => (
          <div key={k}>
            <label className="label">{PROFILE_LABEL[k]}</label>
            <input
              className="input"
              value={profile[k]}
              onChange={(e) => set(k, e.target.value)}
              placeholder={k === "senderRole" ? "e.g. Founder" : "e.g. Alex Chen"}
            />
          </div>
        ))}
      </div>
    </details>
  );
}
