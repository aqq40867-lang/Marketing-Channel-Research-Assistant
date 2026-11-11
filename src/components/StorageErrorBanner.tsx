"use client";
import { useEffect, useState } from "react";
import { STORAGE_ERROR_EVENT } from "@/lib/storage";

export function StorageErrorBanner() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setMsg((e as CustomEvent<string>).detail || "unknown reason");
    window.addEventListener(STORAGE_ERROR_EVENT, on);
    return () => window.removeEventListener(STORAGE_ERROR_EVENT, on);
  }, []);
  if (!msg) return null;
  return (
    <div className="border-b border-red-200 bg-red-50">
      <div className="mx-auto flex max-w-7xl items-start justify-between gap-4 px-4 py-2 text-sm text-red-700">
        <p>
          <b>Results not saved:</b> writing to browser storage failed ({msg}). This content will be lost when you close the page.
          Click “Export Markdown” in the results now to back it up, or delete old research in “History” to free up space.
        </p>
        <button className="shrink-0 underline" onClick={() => setMsg(null)}>Got it</button>
      </div>
    </div>
  );
}
