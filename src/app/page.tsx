"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChannelCard } from "@/components/ChannelCard";
import { DraftEditor } from "@/components/DraftEditor";
import { ErrorBox } from "@/components/ErrorBox";
import { ProgressPanel } from "@/components/ProgressPanel";
import { RejectedList } from "@/components/RejectedList";
import { EMPTY_INPUT, ResearchForm } from "@/components/ResearchForm";
import { downloadText, researchToMarkdown } from "@/lib/markdown";
import { addLead, store, useStoreVersion } from "@/lib/storage";
import { leadKey } from "@/lib/text";
import type { ResearchInput } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/types";
import { initialProgress, markStaleRuns, useResearchRunner } from "@/lib/useResearchRunner";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ResearchPage />
    </Suspense>
  );
}

function ResearchPage() {
  const v = useStoreVersion();
  const router = useRouter();
  const params = useSearchParams();
  const idParam = params.get("id");
  const draftParam = params.get("draft");
  const { runningId, startNew, resume } = useResearchRunner();

  const [input, setInput] = useState<ResearchInput>(EMPTY_INPUT);
  const [useAutoExclude, setUseAutoExclude] = useState(true);
  const [activeDraft, setActiveDraft] = useState<string | null>(draftParam);
  const [notice, setNotice] = useState<string | null>(null);
  const didInit = useRef(false);

  const hydrated = v >= 0;
  const research = hydrated && idParam ? store.getResearch(idParam) : undefined;
  const leads = hydrated ? store.listLeads() : [];
  const leadKeys = new Set(leads.map((l) => l.url));
  const autoExcluded = leads.map((l) => l.url);

  // First load: mark the last interrupted run; when opening a record from history, fill its input back into the form
  useEffect(() => {
    if (!hydrated || didInit.current) return;
    didInit.current = true;
    markStaleRuns();
    if (idParam) {
      const r = store.getResearch(idParam);
      if (r) setInput(r.input);
    }
  }, [hydrated, idParam]);

  useEffect(() => setActiveDraft(draftParam), [draftParam, idParam]);

  // Remember the research being viewed, so clicking “Research” from other pages comes back here
  useEffect(() => {
    if (research) store.setLastResearchId(research.id);
  }, [research?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeDraft) document.getElementById("draft-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeDraft]);

  const busy = runningId !== null;
  const isRunning = research && runningId === research.id;

  const onSubmit = () => {
    const id = startNew(input, useAutoExclude ? autoExcluded : []);
    setActiveDraft(null);
    router.push(`/?id=${id}`);
  };

  const restart = () => {
    if (!research) return;
    setInput(research.input);
    const id = startNew(research.input, research.autoExcluded);
    setActiveDraft(null);
    router.push(`/?id=${id}`);
  };

  const newResearch = () => {
    setInput(EMPTY_INPUT);
    setActiveDraft(null);
    store.setLastResearchId(null);
    router.push("/");
  };

  const exportMd = () => {
    if (!research) return;
    const md = researchToMarkdown(research, store.listDrafts(research.id));
    const name = (research.input.productName || "research").replace(/[^\w\u4e00-\u9fa5-]+/g, "_");
    downloadText(`channel-research_${name}_${research.createdAt.slice(0, 10)}.md`, md);
  };

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="lg:sticky lg:top-20 lg:self-start">
        <ResearchForm
          value={input}
          onChange={setInput}
          onSubmit={onSubmit}
          busy={busy}
          autoExcluded={autoExcluded}
          useAutoExclude={useAutoExclude}
          setUseAutoExclude={setUseAutoExclude}
        />
      </div>

      <div className="min-w-0 space-y-5">
        {!research && <EmptyState hasId={Boolean(idParam)} />}

        {research && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold">
                  {research.input.productName || research.input.product.slice(0, 28)}
                  <span className="ml-2 text-sm font-normal text-slate-500">→ {research.input.market}</span>
                </h1>
                <p className="text-xs text-slate-500">
                  {new Date(research.createdAt).toLocaleString("en-GB")} · {STATUS_LABEL[research.status]}
                  {research.autoExcluded.length > 0 && ` · ${research.autoExcluded.length} channel(s) already in follow-up excluded automatically`}
                </p>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={newResearch} disabled={busy}>
                  New research
                </button>
                {!isRunning && (
                  <button className="btn-ghost" onClick={exportMd}>
                    Export Markdown
                  </button>
                )}
              </div>
            </div>

            {(isRunning || research.status === "incomplete" || (research.status === "failed" && research.error?.code !== "no_results")) && (
              <ProgressPanel steps={research.progress.length ? research.progress : initialProgress()} />
            )}

            {/* Also shown for partial results: some candidates hit temporary errors and only those can be redone */}
            {!isRunning && research.error && (research.error.retryable || (research.status !== "partial" && research.status !== "done")) && (
              <div className="space-y-2">
                <ErrorBox
                  error={research.error}
                  onRetry={research.error.code === "no_results" && !research.error.retryable ? undefined : () => resume(research)}
                  retryLabel={
                    research.status === "incomplete"
                      ? "Resume"
                      : research.error.retryable
                        ? "Retry failed candidates (completed steps are kept)"
                        : "Retry (completed steps are kept)"
                  }
                />
                <button className="btn-ghost" onClick={restart} disabled={busy}>
                  Start over
                </button>
              </div>
            )}

            {research.status === "failed" && research.error?.code === "no_results" && research.summary && (
              <div className="card p-4 text-sm">
                <p className="mb-2 font-medium">What was searched</p>
                <p className="mb-2 text-slate-500">
                  {research.summary.queries.length} queries, {research.summary.hitCount} sites after deduping, {research.summary.candidateCount} candidates shortlisted.
                </p>
                <ul className="list-disc space-y-0.5 pl-5 font-mono text-xs text-slate-600">
                  {research.summary.queries.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
                <RejectedList items={research.rejected} />
              </div>
            )}

            {research.channels.length > 0 && (
              <>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                  These results were generated with AI assistance and sources were checked automatically. Please manually confirm anything highlighted in yellow before reaching out.
                </div>
                {research.summary?.shortfallNote && (
                  <div className="text-sm text-slate-600">
                    <p>{research.summary.shortfallNote}</p>
                    <p className="text-xs text-slate-400">Want more candidates? Broaden the target customer or market description and run the research again.</p>
                  </div>
                )}
                <RejectedList items={research.rejected} />

                {notice && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}

                <div className="grid gap-4 xl:grid-cols-3">
                  {research.channels.map((c, i) => (
                    <ChannelCard
                      key={c.url}
                      channel={c}
                      index={i}
                      inLeads={leadKeys.has(leadKey(c.url))}
                      hasDraft={Boolean(store.getDraft(research.id, c.url))}
                      onWriteEmail={() => setActiveDraft(c.url)}
                      onAddLead={() => {
                        const r = addLead({ name: c.name, url: c.url, type: c.type, source: "tool", researchId: research.id });
                        if (r.ok) flash(`Added “${c.name}” to the follow-up board (To contact).`);
                        else if (r.reason === "duplicate") flash(`“${c.name}” is already on the follow-up board.`);
                      }}
                    />
                  ))}
                </div>

                {activeDraft && research.channels.some((c) => c.url === activeDraft) && (
                  <DraftEditor
                    key={activeDraft}
                    research={research}
                    channels={research.channels}
                    activeUrl={activeDraft}
                    setActiveUrl={setActiveDraft}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ hasId }: { hasId: boolean }) {
  return (
    <div className="card p-8">
      {hasId ? (
        <p className="text-sm text-slate-600">This research record was not found. It may have been deleted, or the browser data was cleared.</p>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Find promotion channels backed by public evidence</h1>
          <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
            <li>Fill in your product, target customers and market on the left.</li>
            <li>The tool searches industry media, small-business sites, communities and newsletters, fetches the pages and checks the evidence word for word.</li>
            <li>It recommends at most 3 channels; when evidence is thin it recommends fewer and explains why.</li>
            <li>It drafts an outreach email for a chosen channel, and code flags any numbers you didn't provide and any overstated claims.</li>
            <li>After checking the evidence, add the channel to the follow-up board to track progress.</li>
          </ol>
          <p className="mt-4 text-xs text-slate-400">Data is stored only in this browser and is lost if you clear browser data; you can export Markdown at any time.</p>
        </>
      )}
    </div>
  );
}
