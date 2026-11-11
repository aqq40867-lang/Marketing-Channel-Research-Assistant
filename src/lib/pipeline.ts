// Research pipeline (server): understand input → search → shortlist → fetch → judge → verify & rank
// After each step the result is pushed to the browser as a checkpoint; on retry the checkpoint is sent back so completed steps are not redone.
import "server-only";
import { assessCandidate, rankChannels, shortfallNote } from "./assess";
import { chatJson, DeepSeekError, fetchPage, search, toAppError } from "./deepseek";
import {
  JUDGE_SYSTEM,
  judgeUser,
  KEYWORD_SYSTEM,
  keywordUser,
  SHORTLIST_SYSTEM,
  shortlistUser,
} from "./prompts";
import { buildQueries } from "./queries";
import { channelPayload, sign } from "./sign";
import { CHECKPOINT_VERSION, judgementSchema, keywordSchema, normalizeShortlistPicks, shortlistSchema, type JudgementOut } from "./schemas";
import { domainOf, isExcluded, normalizeTld, originOf, truncate } from "./text";
import type {
  AppError,
  Channel,
  Checkpoint,
  FetchedPage,
  RejectedCandidate,
  ResearchInput,
  ResearchStatus,
  ResearchSummary,
  SearchHit,
  StepKey,
} from "./types";

export type PipelineEvent =
  | { type: "progress"; step: StepKey; state: "active" | "done" | "error" | "skipped"; detail: string }
  | { type: "checkpoint"; checkpoint: Checkpoint }
  | {
      type: "result";
      status: ResearchStatus;
      channels: Channel[];
      rejected: RejectedCandidate[];
      summary: ResearchSummary;
      error?: AppError;
    }
  | { type: "error"; error: AppError };

const MAX_HITS = 40;
const MAX_PICKS = 8;
const PAGE_CHARS = 14_000;

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Fatal errors (key, balance) must not be swallowed by a single candidate. */
function isFatal(e: unknown): boolean {
  return e instanceof DeepSeekError && (e.code === "auth" || e.code === "balance" || e.code === "config");
}

/** Temporary errors (rate limit, timeout, server, network): still failing after one automatic retry, may succeed later; must not be treated as “candidate not qualified”. */
const TRANSIENT: AppError["code"][] = ["rate_limit", "timeout", "server", "network"];
function isTransient(e: unknown): boolean {
  return e instanceof DeepSeekError && TRANSIENT.includes(e.code);
}

/** Error attached to the result: no_results when there are no channels; a retryable flag when some candidates hit temporary errors. */
function resultError(
  channelCount: number,
  note: string,
  retry: { count: number; code?: AppError["code"] },
): AppError | undefined {
  const retryMsg = `${retry.count} candidate(s) could not be checked because of temporary errors (rate limit, timeout, server error or bad model output), so there may be fewer results than there should be.`;
  const retrySuggestion = "Click “Retry” later: only the failed candidates are redone; completed searches, fetches and judgements are kept.";
  if (channelCount === 0) {
    return {
      code: "no_results",
      message: retry.count ? `${note} ${retryMsg}` : note,
      suggestion: retry.count
        ? retrySuggestion
        : "Broaden the target customer or market description (e.g. change “coffee shop owners in London” to “UK small business owners”), or remove some exclusions, then run the research again.",
      ...(retry.count ? { retryable: true } : {}),
    };
  }
  if (!retry.count) return undefined;
  return { code: retry.code ?? "unknown", message: retryMsg, suggestion: retrySuggestion, retryable: true };
}

export async function runPipeline(
  input: ResearchInput,
  exclude: string[],
  cp: Checkpoint,
  emit: (e: PipelineEvent) => void,
): Promise<void> {
  const save = () => {
    cp.v = CHECKPOINT_VERSION;
    const { sig: _old, ...data } = cp;
    cp.sig = sign("checkpoint", data);
    emit({ type: "checkpoint", checkpoint: cp });
  };
  let step: StepKey = "plan";

  try {
    // ---------- 1. Understand input → queries ----------
    step = "plan";
    if (cp.plan) {
      emit({ type: "progress", step, state: "skipped", detail: `Reused previous result: ${cp.plan.queries.length} queries` });
    } else {
      emit({ type: "progress", step, state: "active", detail: "Extracting English keywords" });
      const kw = await chatJson({ system: KEYWORD_SYSTEM, user: keywordUser(input), schema: keywordSchema, maxTokens: 300 });
      kw.tld = normalizeTld(kw.tld); // generic domains like .com from the model can't be used to confirm the market
      cp.plan = { keywords: kw, queries: buildQueries(kw) };
      save();
      emit({
        type: "progress",
        step,
        state: "done",
        detail: `Keywords: ${kw.topic} / ${kw.audience} / ${kw.market}; generated ${cp.plan.queries.length} queries`,
      });
    }
    const plan = cp.plan;

    // ---------- 2. Search ----------
    step = "search";
    if (cp.search) {
      emit({ type: "progress", step, state: "skipped", detail: `Reused previous result: ${cp.search.hits.length} candidate sites` });
    } else {
      emit({ type: "progress", step, state: "active", detail: `Running ${plan.queries.length} searches in parallel` });
      const queryStats: { q: string; count: number; error?: string }[] = [];
      let fatal: unknown = null;
      let firstError: unknown = null;
      const results = await pool(plan.queries, 5, async ({ q }) => {
        try {
          const r = await search(q, 10);
          queryStats.push({ q, count: r.length });
          return r.map((x) => ({ ...x, query: q }));
        } catch (e) {
          if (isFatal(e)) fatal = e;
          firstError ??= e;
          queryStats.push({ q, count: 0, error: toAppError(e).message });
          return [];
        }
      });
      if (fatal) throw fatal;
      const failed = queryStats.filter((s) => s.error).length;
      if (failed === plan.queries.length) {
        // throw the real cause (timeout, rate limit, HTTP 400…), not always “server 5xx”
        throw firstError ?? new DeepSeekError("server", "all searches failed");
      }
      // dedupe by domain (keep the highest score) and drop channels the user excluded
      const byDomain = new Map<string, (typeof results)[number][number]>();
      let excludedCount = 0;
      for (const r of results.flat()) {
        if (!r.url || !/^https?:\/\//i.test(r.url)) continue;
        if (isExcluded(r.url, exclude)) {
          excludedCount++;
          continue;
        }
        const d = domainOf(r.url);
        const prev = byDomain.get(d);
        if (!prev || (r.rerank_score ?? 0) > (prev.rerank_score ?? 0)) byDomain.set(d, r);
      }
      const hits: SearchHit[] = [...byDomain.values()]
        .sort((a, b) => (b.rerank_score ?? 0) - (a.rerank_score ?? 0))
        .slice(0, MAX_HITS)
        .map((r, i) => ({
          id: `R${i + 1}`,
          url: r.url,
          title: r.title ?? "",
          snippet: r.snippet || r.summary || "",
          siteName: r.site_name ?? null,
          query: r.query,
          score: r.rerank_score ?? 0,
        }));
      cp.search = { hits, queryStats };
      save();
      emit({
        type: "progress",
        step,
        state: "done",
        detail: `${plan.queries.length} searches${failed ? ` (${failed} failed)` : ""}, ${hits.length} sites after deduping${excludedCount ? `, ${excludedCount} results excluded (already followed up / excluded by you)` : ""}`,
      });
    }
    const hits = cp.search.hits;
    const queries = plan.queries.map((q) => q.q);

    if (hits.length === 0) {
      emit({ type: "progress", step: "shortlist", state: "skipped", detail: "No usable search results" });
      return finish([], [], "The search returned no websites.");
    }

    // ---------- 3. Shortlist (the model can only pick by id; URLs are filled in by code) ----------
    step = "shortlist";
    if (cp.shortlist) {
      emit({ type: "progress", step, state: "skipped", detail: `Reused previous result: ${cp.shortlist.length} candidates` });
    } else {
      emit({ type: "progress", step, state: "active", detail: `Model is picking candidates by id from ${hits.length} results` });
      const out = await chatJson({
        system: SHORTLIST_SYSTEM,
        user: shortlistUser(input, hits),
        schema: shortlistSchema,
        maxTokens: 2000,
        label: "shortlist",
      });
      const { picks: normalized, dropped } = normalizeShortlistPicks(out.picks);
      const validIds = new Set(hits.map((h) => h.id));
      const seen = new Set<string>();
      const invalid = dropped + normalized.filter((p) => !validIds.has(p.id)).length;
      if (invalid) console.warn(`[shortlist] dropped ${invalid} candidate(s) with unrecognised or non-existent ids`);
      cp.shortlist = normalized
        .filter((p) => validIds.has(p.id) && !seen.has(p.id) && (seen.add(p.id), true))
        .slice(0, MAX_PICKS);
      save();
      emit({
        type: "progress",
        step,
        state: "done",
        detail: `Picked ${cp.shortlist.length} candidates${invalid ? ` (dropped ${invalid} with bad ids)` : ""}`,
      });
    }
    const picks = cp.shortlist;
    const hitById = new Map(hits.map((h) => [h.id, h]));

    if (picks.length === 0) {
      return finish([], [], "The model found no reasonable candidate channels in the search results.");
    }

    // ---------- 4. Fetch ----------
    step = "fetch";
    const havePages = new Map((cp.pages ?? []).map((p) => [p.id, p]));
    const todo = picks.filter((p) => !havePages.get(p.id)?.ok);
    if (todo.length === 0) {
      emit({ type: "progress", step, state: "skipped", detail: `Reused previous result: ${havePages.size} pages` });
    } else {
      emit({ type: "progress", step, state: "active", detail: `Fetching ${todo.length} pages` });
      let done = 0;
      let fatal: unknown = null;
      const fetched = await pool(todo, 4, async (p): Promise<FetchedPage> => {
        const hit = hitById.get(p.id)!;
        const tryFetch = async (url: string) => {
          const r = await fetchPage(url);
          if (r.content.trim().length < 80) throw new Error("Page body is too short or empty (possibly blocked)");
          return r;
        };
        let page: FetchedPage;
        try {
          const r = await tryFetch(hit.url);
          page = { id: p.id, url: hit.url, ok: true, title: r.title, content: truncate(r.content, PAGE_CHARS) };
        } catch (e) {
          if (isFatal(e)) fatal = e;
          // fall back to the homepage if the submission page won't open
          const home = originOf(hit.url);
          try {
            if (fatal || home === hit.url) throw e;
            const r = await tryFetch(home);
            page = { id: p.id, url: home, ok: true, title: r.title, content: truncate(r.content, PAGE_CHARS) };
          } catch (e2) {
            if (isFatal(e2)) fatal = e2;
            const msg = e2 instanceof DeepSeekError ? toAppError(e2).message : e2 instanceof Error ? e2.message : String(e2);
            // if either the original URL or the homepage hit a temporary error, count it as temporary: a later retry may succeed
            const transient = isTransient(e) || isTransient(e2);
            page = { id: p.id, url: hit.url, ok: false, title: "", content: "", error: msg, ...(transient ? { transient: true } : {}) };
          }
        }
        done++;
        emit({ type: "progress", step, state: "active", detail: `Fetched ${done}/${todo.length} pages` });
        return page;
      });
      if (fatal) throw fatal;
      for (const f of fetched) havePages.set(f.id, f);
      cp.pages = [...havePages.values()];
      save();
      const okCount = cp.pages.filter((p) => p.ok).length;
      emit({ type: "progress", step, state: "done", detail: `Fetched ${cp.pages.length} pages, ${okCount} succeeded` });
    }
    const pages = new Map((cp.pages ?? []).map((p) => [p.id, p]));

    // ---------- 5. Judge (one call per candidate; one failure doesn't affect the rest) ----------
    step = "judge";
    const haveJ = new Map((cp.judgements ?? []).map((j) => [j.id, j]));
    const judgeTodo = picks.filter((p) => pages.get(p.id)?.ok && !haveJ.has(p.id));
    const judgeErrors = new Map<string, AppError>();
    if (judgeTodo.length === 0) {
      emit({ type: "progress", step, state: "skipped", detail: `Reused previous result: ${haveJ.size} candidates already judged` });
    } else {
      emit({ type: "progress", step, state: "active", detail: `Model is judging ${judgeTodo.length} candidates from page text` });
      let done = 0;
      let fatal: unknown = null;
      await pool(judgeTodo, 4, async (p) => {
        const page = pages.get(p.id)!;
        try {
          const out = await chatJson({
            system: JUDGE_SYSTEM,
            user: judgeUser(input, page.url, page.title, page.content),
            schema: judgementSchema,
            maxTokens: 1800,
          });
          haveJ.set(p.id, { id: p.id, raw: out });
        } catch (e) {
          if (isFatal(e)) fatal = e;
          judgeErrors.set(p.id, toAppError(e));
        }
        done++;
        emit({ type: "progress", step, state: "active", detail: `Judged ${done}/${judgeTodo.length} candidates` });
      });
      if (fatal) throw fatal;
      cp.judgements = [...haveJ.values()];
      save();
      emit({
        type: "progress",
        step,
        state: "done",
        detail: `Judged ${haveJ.size} candidates${judgeErrors.size ? `, ${judgeErrors.size} failed` : ""}`,
      });
    }

    // ---------- 6. Verify quotes + rank (pure code) ----------
    step = "rank";
    emit({ type: "progress", step, state: "active", detail: "Verifying quotes word for word and ranking" });
    const kept: Channel[] = [];
    const rejected: RejectedCandidate[] = [];
    const seenDomain = new Set<string>();
    // Candidates not checked because of temporary errors or failed judgements: offer “Retry” in the result, and redo only these
    const retry: { count: number; code?: AppError["code"] } = { count: 0 };
    const markRetry = (code: AppError["code"]) => {
      retry.count++;
      retry.code ??= code;
    };
    for (const p of picks) {
      const hit = hitById.get(p.id)!;
      const page = pages.get(p.id);
      if (!page?.ok) {
        if (page?.transient) markRetry("rate_limit");
        rejected.push({
          name: hit.siteName || hit.title,
          url: hit.url,
          reason: page?.transient
            ? `Page fetch failed temporarily (${page.error ?? "temporary error"}). Click “Retry” to redo only the failed candidates.`
            : `Page fetch failed, could not verify (${page?.error ?? "not fetched"}). You can open the link manually to check.`,
          stage: "fetch",
        });
        continue;
      }
      const j = haveJ.get(p.id);
      if (!j) {
        // failed judgements are not written to the checkpoint and are re-judged on retry
        const err = judgeErrors.get(p.id);
        markRetry(err?.code ?? "unknown");
        rejected.push({
          name: hit.siteName || hit.title,
          url: hit.url,
          reason: `Model judgement failed: ${err?.message ?? "unknown reason"}. Click “Retry” to redo only the failed candidates.`,
          stage: "judge",
        });
        continue;
      }
      const res = assessCandidate(j.raw as JudgementOut, page, hit, input.market, plan.keywords.tld);
      if (!res.ok) {
        rejected.push(res.rejected);
        continue;
      }
      const d = domainOf(res.channel.url);
      if (seenDomain.has(d)) {
        rejected.push({ name: res.channel.name, url: res.channel.url, reason: "Same website as an already recommended channel", stage: "duplicate" });
        continue;
      }
      seenDomain.add(d);
      kept.push(res.channel);
    }
    const { top, overflow } = rankChannels(kept);
    for (const c of overflow) {
      rejected.push({ name: c.name, url: c.url, reason: `Qualified, but its overall score (${c.scores.total}) is below the top 3`, stage: "rank" });
    }
    emit({
      type: "progress",
      step,
      state: "done",
      detail: `${kept.length} candidates passed verification; recommending ${top.length}`,
    });
    return finish(top, rejected, "", retry);

    function finish(
      unsigned: Channel[],
      rej: RejectedCandidate[],
      emptyReason: string,
      retry: { count: number; code?: AppError["code"] } = { count: 0 },
    ) {
      const channels = unsigned.map((c) => ({ ...c, sig: sign("channel", channelPayload(c)) }));
      const note = channels.length === 0
        ? `No qualified channels found. ${emptyReason || shortfallNote(0, rej, input.market)}`
        : shortfallNote(channels.length, rej, input.market);
      emit({
        type: "result",
        status: channels.length === 0 ? "failed" : channels.length < 3 ? "partial" : "done",
        channels,
        rejected: rej,
        summary: {
          queries,
          hitCount: cp.search?.hits.length ?? 0,
          candidateCount: cp.shortlist?.length ?? 0,
          shortfallNote: note,
        },
        error: resultError(channels.length, note, retry),
      });
    }
  } catch (e) {
    const err = toAppError(e);
    emit({ type: "progress", step, state: "error", detail: err.message });
    emit({ type: "error", error: { ...err, step } });
  }
}
