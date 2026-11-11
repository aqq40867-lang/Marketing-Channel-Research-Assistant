"use client";
// Local storage behind a Store interface: currently localStorage, can be swapped for SQLite later by implementing the same interface.
import { useSyncExternalStore } from "react";
import type { Draft, Lead, LeadStage, Research } from "./types";
import { normalizeProfile, type SenderProfile } from "./profile";
import { STAGE_LABEL } from "./types";
import { leadKey } from "./text";
import { higherStage, maxStageOf } from "./leadStats";

export interface Store {
  listResearches(): Research[];
  getResearch(id: string): Research | undefined;
  saveResearch(r: Research): boolean;
  deleteResearch(id: string): boolean;

  listDrafts(researchId?: string): Draft[];
  getDraft(researchId: string, channelUrl: string): Draft | undefined;
  saveDraft(d: Draft): boolean;

  listLeads(): Lead[];
  getLead(url: string): Lead | undefined;
  saveLead(l: Lead): boolean;
  deleteLead(url: string): boolean;

  getProfile(): SenderProfile;
  saveProfile(p: SenderProfile): boolean;

  /** The research last viewed on the research page, so clicking “Research” from other pages returns to it */
  getLastResearchId(): string | null;
  setLastResearchId(id: string | null): boolean;
}

const K = { research: "mcr:researches", drafts: "mcr:drafts", leads: "mcr:leads", profile: "mcr:profile", lastResearch: "mcr:lastResearchId" } as const;

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
function notify() {
  version++;
  listeners.forEach((l) => l());
}

/** When a write fails (storage full, private mode, etc.), tell the page to show the "results not saved" banner. */
export const STORAGE_ERROR_EVENT = "mcr:storage-error";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    notify();
    return true;
  } catch (e) {
    window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}

const draftKey = (researchId: string, url: string) => `${researchId}::${url}`;

export const localStore: Store = {
  listResearches() {
    return read<Research[]>(K.research, []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  getResearch(id) {
    return read<Research[]>(K.research, []).find((r) => r.id === id);
  },
  saveResearch(r) {
    const all = read<Research[]>(K.research, []).filter((x) => x.id !== r.id);
    all.push({ ...r, updatedAt: new Date().toISOString() });
    return write(K.research, all);
  },
  deleteResearch(id) {
    const ok = write(
      K.research,
      read<Research[]>(K.research, []).filter((x) => x.id !== id),
    );
    const drafts = read<Record<string, Draft>>(K.drafts, {});
    for (const k of Object.keys(drafts)) if (drafts[k].researchId === id) delete drafts[k];
    return write(K.drafts, drafts) && ok;
  },

  listDrafts(researchId) {
    const all = Object.values(read<Record<string, Draft>>(K.drafts, {}));
    return researchId ? all.filter((d) => d.researchId === researchId) : all;
  },
  getDraft(researchId, url) {
    return read<Record<string, Draft>>(K.drafts, {})[draftKey(researchId, url)];
  },
  saveDraft(d) {
    const all = read<Record<string, Draft>>(K.drafts, {});
    all[draftKey(d.researchId, d.channelUrl)] = { ...d, updatedAt: new Date().toISOString() };
    return write(K.drafts, all);
  },

  listLeads() {
    return read<Lead[]>(K.leads, []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  getLead(url) {
    const key = leadKey(url);
    return read<Lead[]>(K.leads, []).find((l) => l.url === key);
  },
  saveLead(l) {
    const key = leadKey(l.url);
    const all = read<Lead[]>(K.leads, []).filter((x) => x.url !== key);
    all.push({ ...l, url: key });
    return write(K.leads, all);
  },
  deleteLead(url) {
    const key = leadKey(url);
    return write(
      K.leads,
      read<Lead[]>(K.leads, []).filter((x) => x.url !== key),
    );
  },

  getProfile() {
    return normalizeProfile(read<unknown>(K.profile, {}));
  },
  saveProfile(p) {
    return write(K.profile, p);
  },

  getLastResearchId() {
    const id = read<string | null>(K.lastResearch, null);
    return id && this.getResearch(id) ? id : null;
  },
  setLastResearchId(id) {
    if (read<string | null>(K.lastResearch, null) === id) return true;
    return write(K.lastResearch, id);
  },
};

export const store: Store = localStore;

/** Subscribe to storage changes (writes in this tab + storage events from other tabs). */
export function useStoreVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => {
        if (e.key?.startsWith("mcr:")) notify();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    () => version,
    () => -1,
  );
}

// ---------- Follow-up operations ----------

export function now(): string {
  return new Date().toISOString();
}

export type AddLeadResult = { ok: true; lead: Lead } | { ok: false; reason: "duplicate" | "storage"; existing?: Lead };

export function addLead(
  input: Omit<Lead, "url" | "link" | "stage" | "failed" | "history" | "createdAt" | "notes"> & { url: string; notes?: string },
): AddLeadResult {
  const existing = store.getLead(input.url);
  if (existing) return { ok: false, reason: "duplicate", existing };
  const lead: Lead = {
    ...input,
    url: leadKey(input.url),
    link: /^https?:\/\//i.test(input.url.trim()) ? input.url.trim() : `https://${input.url.trim()}`,
    notes: input.notes ?? "",
    stage: "todo",
    maxStage: "todo",
    failed: false,
    history: [{ at: now(), action: `Added to follow-up (${input.source === "tool" ? "recommended" : "added manually"}): ${STAGE_LABEL.todo}` }],
    createdAt: now(),
  };
  return store.saveLead(lead) ? { ok: true, lead } : { ok: false, reason: "storage" };
}

export function moveLead(lead: Lead, stage: LeadStage): boolean {
  // a failed lead restored to the same stage it failed at must still have its failed flag cleared, so don't return early
  if (lead.stage === stage && !lead.failed) return true;
  const action = lead.failed
    ? `Restored from failed to “${STAGE_LABEL[stage]}”`
    : `${STAGE_LABEL[lead.stage]} → ${STAGE_LABEL[stage]}`;
  return store.saveLead({
    ...lead,
    stage,
    maxStage: higherStage(maxStageOf(lead), stage),
    failed: false,
    failReason: undefined,
    failNote: undefined,
    history: [...lead.history, { at: now(), action }],
  });
}

export function newId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
