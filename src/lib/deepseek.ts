// DeepSeek client (server only): chat model, Search API and Fetch API, with shared error classification and automatic retry.
import "server-only";
import type { z } from "zod";
import type { AppError } from "./types";

const BASE = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-flash";
// deepseek-flash "thinks" before answering by default, and the thinking counts towards max_tokens.
// Each step's length limit assumes a direct answer: with thinking on, it can use up the budget and the JSON gets cut off halfway.
// Thinking is off by default; set DEEPSEEK_THINKING=on to enable it (slower, more expensive), which automatically reserves extra budget.
const THINKING = (process.env.DEEPSEEK_THINKING || "off").toLowerCase() === "on";
const THINKING_EXTRA_TOKENS = 8000;

export class DeepSeekError extends Error {
  constructor(
    public code: AppError["code"],
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export function toAppError(e: unknown): AppError {
  if (e instanceof DeepSeekError) {
    switch (e.code) {
      case "config":
        return { code: "config", message: "DEEPSEEK_API_KEY was not found.", suggestion: "Add DEEPSEEK_API_KEY=your-key to .env.local in the project root, then restart the server (local: npm run dev; Docker: docker compose up -d)." };
      case "auth":
        return { code: "auth", message: "The DeepSeek API key is invalid (401).", suggestion: "Check that DEEPSEEK_API_KEY in .env.local is complete and has not been revoked, then restart the server." };
      case "balance":
        return { code: "balance", message: "Insufficient DeepSeek account balance (402).", suggestion: "Top up on the DeepSeek platform, then click “Retry”. Completed steps will not be redone." };
      case "rate_limit":
        return { code: "rate_limit", message: "Too many requests: rate-limited by DeepSeek (429), and the automatic retry also failed.", suggestion: "Wait a minute, then click “Retry”. Completed steps will not be redone." };
      case "timeout":
        if (e.message === "deadline") {
          return { code: "timeout", message: "Generation exceeded the time limit (about 100 seconds) and was stopped.", suggestion: "Click “Retry” later; if DeepSeek is slow, try again in a few minutes." };
        }
        return { code: "timeout", message: "The DeepSeek request timed out, and the automatic retry also failed.", suggestion: "Check your network, then click “Retry”. Completed steps will not be redone." };
      case "server":
        return { code: "server", message: `DeepSeek server error (${e.status ?? "5xx"}), and the automatic retry also failed.`, suggestion: "Click “Retry” later. Completed steps will not be redone." };
      case "bad_output":
        return { code: "bad_output", message: "The model output had the wrong format, and the automatic retry was also wrong.", suggestion: "Click “Retry”. If it keeps happening, make your input more specific; the server terminal prints the raw model output and what was wrong with it." };
      case "fetch_blocked":
        return { code: "fetch_blocked", message: `This page could not be fetched (${e.status ?? ""}): ${e.message}`, suggestion: "Only this candidate is affected; other channels are assessed as usual." };
      case "network":
        return { code: "network", message: `Cannot connect to DeepSeek: ${e.message}`, suggestion: "Check your network or proxy settings, then click “Retry”." };
      default:
        return { code: "unknown", message: e.message, suggestion: "Click “Retry”; if it keeps happening, check the terminal logs." };
    }
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { code: "unknown", message: `Unknown error: ${msg}`, suggestion: "Click “Retry”; if it keeps happening, check the terminal logs." };
}

function key(): string {
  const k = process.env.DEEPSEEK_API_KEY;
  if (!k || !k.trim()) throw new DeepSeekError("config", "missing key");
  return k.trim();
}

function classifyStatus(status: number, text: string, path: string): DeepSeekError {
  // Fetch API 403 (blocked by security policy) and 404 (no usable content) only mean this page can't be fetched; they are unrelated to the key and must not be treated as fatal
  if (path.startsWith("/v1/tools/fetch") && (status === 403 || status === 404)) {
    return new DeepSeekError("fetch_blocked", status === 403 ? "blocked by DeepSeek security policy" : "no usable content", status);
  }
  if (status === 401) return new DeepSeekError("auth", text, status);
  if (status === 402) return new DeepSeekError("balance", text, status);
  if (status === 429) return new DeepSeekError("rate_limit", text, status);
  if (status === 408) return new DeepSeekError("timeout", text, status);
  if (status >= 500) return new DeepSeekError("server", text, status);
  return new DeepSeekError("unknown", `HTTP ${status}: ${text.slice(0, 200)}`, status);
}

const RETRYABLE: AppError["code"][] = ["rate_limit", "timeout", "server", "network"];

/**
 * @param deadline optional absolute deadline (Date.now() ms). A single request's timeout never exceeds the remaining time;
 *                 when there isn't enough time left, it does not retry and throws timeout (message "deadline").
 */
async function post<T>(path: string, body: unknown, timeoutMs: number, deadline?: number): Promise<T> {
  const attempt = async (): Promise<T> => {
    const left = deadline === undefined ? timeoutMs : Math.min(timeoutMs, deadline - Date.now());
    if (left <= 0) throw new DeepSeekError("timeout", "deadline");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), left);
    try {
      const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) throw classifyStatus(res.status, await res.text().catch(() => ""), path);
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof DeepSeekError) throw e;
      if (e instanceof Error && e.name === "AbortError") {
        throw new DeepSeekError("timeout", deadline !== undefined && Date.now() >= deadline - 50 ? "deadline" : "timeout");
      }
      throw new DeepSeekError("network", e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await attempt();
  } catch (e) {
    // Rate limit, timeout, server error: retry once automatically
    if (e instanceof DeepSeekError && RETRYABLE.includes(e.code) && e.message !== "deadline") {
      const wait = e.code === "rate_limit" ? 2500 : 800;
      // With a deadline, skip the retry if there isn't time for another attempt (wait + at least 5 seconds)
      if (deadline !== undefined && deadline - Date.now() < wait + 5000) throw e;
      await new Promise((r) => setTimeout(r, wait));
      return attempt();
    }
    throw e;
  }
}

// ---------------- Search ----------------

export interface RawSearchResult {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  site_name: string | null;
  rerank_score: number;
  date: string | null;
}

export async function search(query: string, count = 10): Promise<RawSearchResult[]> {
  const q = query.length > 128 ? query.slice(0, 128) : query;
  const data = await post<{ results?: RawSearchResult[] }>("/v1/tools/search", { query: q, count }, 25_000);
  return data.results ?? [];
}

// ---------------- Fetch ----------------

export async function fetchPage(url: string): Promise<{ title: string; content: string }> {
  const data = await post<{ title?: string; content?: string }>("/v1/tools/fetch", { url }, 30_000);
  return { title: data.title ?? "", content: data.content ?? "" };
}

// ---------------- Chat (JSON output + zod validation) ----------------

interface ChatResponse {
  choices: { message: { content: string | null }; finish_reason?: string }[];
}

/**
 * Call the chat model, require JSON output and validate it with zod. On a shape error, feed the error back to the model and retry once.
 */
export async function chatJson<S extends z.ZodTypeAny>(opts: {
  system: string;
  user: string;
  schema: S;
  temperature?: number;
  maxTokens?: number;
  /** Absolute deadline (Date.now() ms), including the retry for bad format */
  deadline?: number;
  /** Step name written to the terminal log on errors, for debugging */
  label?: string;
}): Promise<z.infer<S>> {
  const tag = `[model output${opts.label ? ` · ${opts.label}` : ""}]`;
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  for (let i = 0; i < 2; i++) {
    const data = await post<ChatResponse>(
      "/chat/completions",
      {
        model: MODEL,
        messages,
        response_format: { type: "json_object" },
        temperature: opts.temperature ?? 0.2,
        ...(THINKING
          ? { reasoning_effort: "low", max_tokens: (opts.maxTokens ?? 2000) + THINKING_EXTRA_TOKENS }
          : { thinking: { type: "disabled" }, max_tokens: opts.maxTokens ?? 2000 }),
      },
      90_000,
      opts.deadline,
    );
    const content = data.choices?.[0]?.message?.content ?? "";
    // When DeepSeek can't produce valid JSON in JSON mode it returns only whitespace (finish_reason may still be stop): just re-request, without adding the blank reply to the conversation
    if (!content.trim()) {
      console.warn(`${tag} attempt ${i + 1} returned blank content (finish_reason=${data.choices?.[0]?.finish_reason ?? "?"})`);
      continue;
    }
    let parsed: unknown;
    let problem = "";
    try {
      parsed = JSON.parse(content);
      const r = opts.schema.safeParse(parsed);
      if (r.success) return r.data;
      problem = r.error.issues
        .slice(0, 6)
        .map((x) => `${x.path.join(".")}: ${x.message}`)
        .join("; ");
    } catch {
      problem = "output is not valid JSON";
    }
    const finish = data.choices?.[0]?.finish_reason;
    console.warn(
      `${tag} attempt ${i + 1} has an invalid format: ${problem}${finish === "length" ? " (answer was cut off by the length limit)" : ""}\n` +
        `--- raw output (first 1500 chars) ---\n${content.slice(0, 1500)}\n--- end ---`,
    );
    messages.push({ role: "assistant", content });
    messages.push({
      role: "user",
      content: `Your JSON did not match the required schema (${problem}). Return the corrected JSON object only.`,
    });
  }
  throw new DeepSeekError("bad_output", "schema mismatch after retry");
}
