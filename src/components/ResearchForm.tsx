"use client";
import { useState } from "react";
import { PRESETS } from "@/lib/presets";
import { MIN_FIELD_LENGTH } from "@/lib/schemas";
import type { CollabForm, ResearchInput } from "@/lib/types";
import { COLLAB_FORM_LABEL } from "@/lib/types";

type Errors = Partial<Record<"product" | "audience" | "market", string>>;

export function validateInput(v: ResearchInput): Errors {
  const e: Errors = {};
  if (v.product.trim().length < MIN_FIELD_LENGTH)
    e.product = `Product description is too short (at least ${MIN_FIELD_LENGTH} characters): say what it does, e.g. "helps small teams assign tasks and track deadlines".`;
  if (v.audience.trim().length < MIN_FIELD_LENGTH)
    e.audience = `Target customers is too short (at least ${MIN_FIELD_LENGTH} characters): describe the customer type and size, e.g. "owners of UK small businesses with 1–20 people".`;
  if (v.market.trim().length < 2) e.market = "Enter a target market, e.g. UK.";
  return e;
}

export const EMPTY_INPUT: ResearchInput = {
  product: "",
  audience: "",
  market: "",
  productName: "",
  productUrl: "",
  collabForms: [],
  excludeUrls: [],
};

export function ResearchForm({
  value,
  onChange,
  onSubmit,
  busy,
  autoExcluded,
  useAutoExclude,
  setUseAutoExclude,
}: {
  value: ResearchInput;
  onChange: (v: ResearchInput) => void;
  onSubmit: () => void;
  busy: boolean;
  autoExcluded: string[];
  useAutoExclude: boolean;
  setUseAutoExclude: (b: boolean) => void;
}) {
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof ResearchInput>(k: K, v: ResearchInput[K]) => {
    const next = { ...value, [k]: v };
    onChange(next);
    if (touched) setErrors(validateInput(next));
  };
  const toggleForm = (f: CollabForm) =>
    set("collabForms", value.collabForms.includes(f) ? value.collabForms.filter((x) => x !== f) : [...value.collabForms, f]);

  const submit = () => {
    setTouched(true);
    const e = validateInput(value);
    setErrors(e);
    if (Object.keys(e).length === 0) onSubmit();
  };

  return (
    <div className="card p-5">
      <div className="mb-4">
        <p className="mb-2 text-xs font-medium tracking-wide text-slate-500">Example (click to fill)</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700 hover:border-brand hover:text-brand"
              onClick={() => {
                onChange({ ...p.input });
                setErrors({});
                setTouched(false);
              }}
              disabled={busy}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Product description" required error={errors.product}>
          <textarea
            className="input min-h-20"
            value={value.product}
            onChange={(e) => set("product", e.target.value)}
            placeholder="What the product does, who it is for, key features"
          />
        </Field>
        <Field label="Target customers" required error={errors.audience}>
          <input className="input" value={value.audience} onChange={(e) => set("audience", e.target.value)} placeholder="Customer type, size, role" />
        </Field>
        <Field label="Target market" required error={errors.market}>
          <input className="input" value={value.market} onChange={(e) => set("market", e.target.value)} placeholder="e.g. UK" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Product name">
            <input className="input" value={value.productName} onChange={(e) => set("productName", e.target.value)} placeholder="Left as a placeholder in the email if empty" />
          </Field>
          <Field label="Product URL">
            <input className="input" value={value.productUrl} onChange={(e) => set("productUrl", e.target.value)} placeholder="https://" />
          </Field>
        </div>
        <Field label="Preferred collaboration forms">
          <div className="flex gap-2">
            {(Object.keys(COLLAB_FORM_LABEL) as CollabForm[]).map((f) => (
              <label
                key={f}
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${value.collabForms.includes(f) ? "border-brand bg-brand-soft text-brand" : "border-slate-300 text-slate-600"}`}
              >
                <input type="checkbox" className="sr-only" checked={value.collabForms.includes(f)} onChange={() => toggleForm(f)} />
                {COLLAB_FORM_LABEL[f]}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Excluded channels" hint="One URL or domain per line; skipped during research">
          <textarea
            className="input min-h-16 font-mono text-xs"
            value={value.excludeUrls.join("\n")}
            onChange={(e) => set("excludeUrls", e.target.value.split("\n"))}
            placeholder="example.co.uk"
          />
          {autoExcluded.length > 0 && (
            <label className="mt-2 flex items-start gap-2 text-xs text-slate-600">
              <input type="checkbox" className="mt-0.5" checked={useAutoExclude} onChange={(e) => setUseAutoExclude(e.target.checked)} />
              <span>
                Don't recommend channels already in follow-up
                <span className="block text-slate-400">{autoExcluded.slice(0, 4).join(", ")}{autoExcluded.length > 4 ? " …" : ""}</span>
              </span>
            </label>
          )}
        </Field>
        <button type="submit" className="btn-primary w-full py-2.5" disabled={busy}>
          {busy ? "Researching…" : "Start research"}
        </button>
        <p className="text-center text-xs text-slate-400">About 30–60 seconds; roughly 10 searches + 8 page fetches per run</p>
      </form>
    </div>
  );
}

function Field({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
        {hint && <span className="ml-2 text-xs font-normal text-slate-400">{hint}</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
